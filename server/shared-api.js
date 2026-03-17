import http from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { DatabaseSync } from "node:sqlite";

const HOST = process.env.SHARED_API_HOST || "0.0.0.0";
const PORT = Number(process.env.SHARED_API_PORT || 8787);
const DB_PATH = resolve(process.cwd(), process.env.SHARED_API_DB || "./data/shared-demo.sqlite");
const DIST_DIR = resolve(process.cwd(), "./dist");
const META_SECRET_PATH = resolve(process.cwd(), process.env.META_LOCAL_SECRET_PATH || "./data/meta-local-secrets.json");
const VENDOR_SECRET_PATH = resolve(process.cwd(), process.env.VENDOR_LOCAL_SECRET_PATH || "./data/vendor-local-secrets.json");

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS state_entries (
    storage_key TEXT PRIMARY KEY,
    storage_value TEXT,
    updated_at TEXT NOT NULL,
    updated_by TEXT
  );
  CREATE TABLE IF NOT EXISTS state_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT INTO state_meta (id, revision, updated_at)
  VALUES (1, 0, CURRENT_TIMESTAMP)
  ON CONFLICT(id) DO NOTHING;
`);

const selectAllStmt = db.prepare("SELECT storage_key, storage_value FROM state_entries");
const selectEntryStmt = db.prepare("SELECT storage_value FROM state_entries WHERE storage_key = ?");
const selectMetaStmt = db.prepare("SELECT revision, updated_at FROM state_meta WHERE id = 1");
const upsertEntryStmt = db.prepare(`
  INSERT INTO state_entries (storage_key, storage_value, updated_at, updated_by)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(storage_key) DO UPDATE SET
    storage_value = excluded.storage_value,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by
`);
const deleteEntryStmt = db.prepare("DELETE FROM state_entries WHERE storage_key = ?");
const bumpRevisionStmt = db.prepare(`
  UPDATE state_meta
  SET revision = revision + 1,
      updated_at = ?
  WHERE id = 1
`);

let metaPagesCache = null;
const APP_CONFIG_KEY = "ad_demo_config_v1";
const VENDOR_KEYS_KEY = "ad_demo_vendor_keys_v1";
const ORDERS_KEY = "ad_demo_orders_v1";
const DEFAULT_VENDOR_BASES = {
  smmraja: "https://www.smmraja.com/api/v3",
  urpanel: "https://urpanel.com/api/v2",
  justanotherpanel: "https://justanotherpanel.com/api/v2",
};

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Cache-Control",
  });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
  const ext = extname(filePath).toLowerCase();
  const contentType =
    ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".js"
        ? "application/javascript; charset=utf-8"
        : ext === ".css"
          ? "text/css; charset=utf-8"
          : ext === ".json"
            ? "application/json; charset=utf-8"
            : ext === ".svg"
              ? "image/svg+xml"
              : ext === ".png"
                ? "image/png"
                : "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType, "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=600" });
  res.end(readFileSync(filePath));
}

function tryServeStatic(req, res) {
  if (!req.url || req.url.startsWith("/api/")) return false;
  if (!existsSync(DIST_DIR)) {
    json(res, 503, { ok: false, error: "dist not found, run npm run build first" });
    return true;
  }

  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const requested = resolve(DIST_DIR, `.${pathname}`);
  if (requested.startsWith(DIST_DIR) && existsSync(requested)) {
    sendFile(res, requested);
    return true;
  }

  sendFile(res, resolve(DIST_DIR, "index.html"));
  return true;
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 5_000_000) {
        rejectBody(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolveBody(raw));
    req.on("error", rejectBody);
  });
}

function loadMetaSecrets() {
  if (!existsSync(META_SECRET_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(META_SECRET_PATH, "utf-8"));
    if (!raw || typeof raw !== "object") return null;
    const userAccessToken = typeof raw.userAccessToken === "string" ? raw.userAccessToken.trim() : "";
    if (!userAccessToken) return null;
    return {
      apiVersion: typeof raw.apiVersion === "string" && raw.apiVersion.trim() ? raw.apiVersion.trim() : "v20.0",
      userAccessToken,
      preferredPageId: typeof raw.preferredPageId === "string" ? raw.preferredPageId.trim() : "",
      preferredPageName: typeof raw.preferredPageName === "string" ? raw.preferredPageName.trim() : "",
    };
  } catch {
    return null;
  }
}

function loadVendorSecrets() {
  if (!existsSync(VENDOR_SECRET_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(VENDOR_SECRET_PATH, "utf-8"));
    return raw && typeof raw === "object" ? raw : null;
  } catch {
    return null;
  }
}

function graphUrl(apiVersion, path, params = {}) {
  const url = new URL(`https://graph.facebook.com/${apiVersion}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function graphApiGet(apiVersion, token, path, params = {}) {
  const url = graphUrl(apiVersion, path, { ...params, access_token: token });
  const res = await fetch(url, { method: "GET" });
  const jsonBody = await res.json();
  if (!res.ok || jsonBody.error) {
    const e = jsonBody?.error;
    throw new Error(e?.error_user_msg || e?.message || `HTTP ${res.status}`);
  }
  return jsonBody;
}

async function listAvailablePages(metaSecrets) {
  const now = Date.now();
  if (metaPagesCache && now - metaPagesCache.fetchedAt < 5 * 60 * 1000) {
    return metaPagesCache.pages;
  }
  const raw = await graphApiGet(metaSecrets.apiVersion, metaSecrets.userAccessToken, "/me/accounts");
  const pages = Array.isArray(raw.data) ? raw.data : [];
  metaPagesCache = { fetchedAt: now, pages };
  return pages;
}

function derivePageIdFromPostId(postId) {
  const m = String(postId).match(/^(\d+)_/);
  return m ? m[1] : "";
}

function readFirstInsightValue(raw) {
  const row = Array.isArray(raw?.data) ? raw.data[0] : null;
  const valueRow = row && Array.isArray(row.values) ? row.values[0] : null;
  const value = valueRow?.value;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

async function fetchMetaPostMetricsSecure({ postId, pageId, pageName }) {
  const metaSecrets = loadMetaSecrets();
  if (!metaSecrets) {
    return { ok: false, detail: "Meta 本機權杖尚未設定" };
  }

  const normalizedPostId = String(postId || "").trim().replace(/^https?:\/\/[^/]+\//i, "");
  if (!normalizedPostId) {
    return { ok: false, detail: "缺少貼文 ID" };
  }

  const targetPageId = String(pageId || "").trim() || derivePageIdFromPostId(normalizedPostId) || metaSecrets.preferredPageId;
  const targetPageName = String(pageName || "").trim() || metaSecrets.preferredPageName;
  const pages = await listAvailablePages(metaSecrets);
  const page = pages.find((item) =>
    (targetPageId && String(item?.id || "") === targetPageId) ||
    (targetPageName && String(item?.name || "") === targetPageName),
  );
  if (!page?.access_token) {
    return { ok: false, detail: "找不到對應粉專的存取權杖" };
  }

  const pageToken = String(page.access_token);
  const pageLabel = String(page.name || targetPageName || targetPageId || "");
  const base = await graphApiGet(
    metaSecrets.apiVersion,
    pageToken,
    `/${encodeURIComponent(normalizedPostId)}`,
    { fields: "id,created_time,permalink_url,shares,comments.summary(true),reactions.summary(true),attachments{media_type}" },
  );

  const metricMap = {
    impressions: "post_impressions",
    reach: "post_impressions_unique",
    all_clicks: "post_clicks",
    likes: "post_reactions_like_total",
    video_3s_views: "post_video_views",
  };

  const values = {
    likes: Number(base?.reactions?.summary?.total_count || 0),
    comments: Number(base?.comments?.summary?.total_count || 0),
    shares: Number(base?.shares?.count || 0),
    all_clicks: 0,
    interactions_total: 0,
    impressions: 0,
    reach: 0,
    video_3s_views: 0,
    thruplays: 0,
  };

  const validMetrics = [];
  const invalidMetrics = [];

  for (const [key, metric] of Object.entries(metricMap)) {
    try {
      const insight = await graphApiGet(
        metaSecrets.apiVersion,
        pageToken,
        `/${encodeURIComponent(normalizedPostId)}/insights`,
        { metric },
      );
      const metricValue = readFirstInsightValue(insight);
      values[key] = metricValue;
      if (key === "video_3s_views") values.thruplays = metricValue;
      validMetrics.push(metric);
    } catch (error) {
      invalidMetrics.push({
        metric,
        detail: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  values.interactions_total = values.likes + values.comments + values.shares + values.all_clicks;

  return {
    ok: true,
    page: {
      id: String(page.id || ""),
      name: pageLabel,
    },
    values,
    raw: {
      base,
      validMetrics,
      invalidMetrics,
    },
  };
}

function currentState(keys) {
  const allow = Array.isArray(keys) && keys.length > 0 ? new Set(keys) : null;
  const values = {};
  for (const row of selectAllStmt.all()) {
    if (allow && !allow.has(row.storage_key)) continue;
    values[row.storage_key] = row.storage_value;
  }
  const meta = selectMetaStmt.get();
  return {
    revision: Number(meta?.revision ?? 0),
    updatedAt: String(meta?.updated_at ?? new Date().toISOString()),
    values,
  };
}

function readSharedJson(key) {
  try {
    const row = selectEntryStmt.get(key);
    if (!row?.storage_value) return null;
    return JSON.parse(String(row.storage_value));
  } catch {
    return null;
  }
}

function writeSharedJson(key, value, updatedBy = "server") {
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    if (value == null) {
      deleteEntryStmt.run(key);
    } else {
      upsertEntryStmt.run(key, JSON.stringify(value), now, updatedBy);
    }
    bumpRevisionStmt.run(now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function formEncode(params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    body.set(k, String(v));
  }
  return body.toString();
}

async function postVendorPanel({ baseUrl, key, action, payload = {} }) {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formEncode({ key, action, ...payload }),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: "Non-JSON response", raw: text.slice(0, 400) };
  }
}

function toNum(x) {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function getVendorRuntime(vendor) {
  const cfg = readSharedJson(APP_CONFIG_KEY);
  const keys = readSharedJson(VENDOR_KEYS_KEY);
  const vendorCfg = Array.isArray(cfg?.vendors) ? cfg.vendors.find((v) => v?.key === vendor) : null;
  const fallback = loadVendorSecrets()?.vendors?.[vendor] ?? {};
  const key = typeof keys?.keys?.[vendor] === "string" && keys.keys[vendor].trim()
    ? keys.keys[vendor].trim()
    : typeof fallback?.key === "string"
      ? fallback.key.trim()
      : "";
  return {
    baseUrl: typeof vendorCfg?.apiBaseUrl === "string" && vendorCfg.apiBaseUrl.trim()
      ? vendorCfg.apiBaseUrl.trim()
      : typeof fallback?.apiBaseUrl === "string" && fallback.apiBaseUrl.trim()
        ? fallback.apiBaseUrl.trim()
        : DEFAULT_VENDOR_BASES[vendor] || "",
    enabled: vendorCfg?.enabled != null ? !!vendorCfg.enabled : fallback?.enabled !== false,
    key,
  };
}

function statusParamFor(vendor, orderIds) {
  const joined = orderIds.join(",");
  if (orderIds.length <= 1) return { key: "order", value: joined };
  if (vendor === "smmraja") return { key: "order", value: joined };
  return { key: "orders", value: joined };
}

function normalizeSingleStatus(resp) {
  if (!resp || typeof resp !== "object") return { error: "Empty response" };
  if (typeof resp.error === "string") return { error: resp.error };
  return {
    status: typeof resp.status === "string" ? resp.status : undefined,
    remains: toNum(resp.remains),
    start_count: toNum(resp.start_count),
    charge: toNum(resp.charge),
    currency: typeof resp.currency === "string" ? resp.currency : undefined,
    error: typeof resp.error === "string" ? resp.error : undefined,
  };
}

async function fetchVendorStatus(vendor, orderId) {
  const runtime = getVendorRuntime(vendor);
  if (!runtime.enabled || !runtime.baseUrl || !runtime.key) {
    return { error: "供應商設定不完整" };
  }
  const param = statusParamFor(vendor, [orderId]);
  const resp = await postVendorPanel({
    baseUrl: runtime.baseUrl,
    key: runtime.key,
    action: "status",
    payload: { [param.key]: param.value },
  });
  return normalizeSingleStatus(resp);
}

const VENDOR_TERMINAL_STATUS = [
  "complete",
  "completed",
  "done",
  "success",
  "successful",
  "partial",
  "cancel",
  "canceled",
  "cancelled",
  "refund",
  "refunded",
  "fail",
  "failed",
  "error",
];

function isVendorSplitDone(split) {
  const status = String(split?.vendorStatus ?? "").trim().toLowerCase();
  if (status && VENDOR_TERMINAL_STATUS.some((k) => status.includes(k))) return true;
  if (typeof split?.remains === "number" && split.remains <= 0) return true;
  return false;
}

async function syncSharedOrders() {
  const orders = readSharedJson(ORDERS_KEY);
  if (!Array.isArray(orders) || orders.length === 0) {
    return { syncedCount: 0, orders: [] };
  }

  let syncedCount = 0;
  const nextOrders = [];

  for (const order of orders) {
    const nextOrder = {
      ...order,
      lines: Array.isArray(order?.lines)
        ? await Promise.all(
            order.lines.map(async (line) => {
              const splits = Array.isArray(line?.splits) ? line.splits : [];
              const nextSplits = await Promise.all(
                splits.map(async (split) => {
                  if (!split?.vendor || !split?.vendorOrderId) return split;
                  if (isVendorSplitDone(split)) return split;

                  const status = await fetchVendorStatus(split.vendor, split.vendorOrderId);
                  syncedCount += 1;
                  return {
                    ...split,
                    vendorStatus: status.status ?? split.vendorStatus,
                    remains: status.remains ?? split.remains,
                    startCount: status.start_count ?? split.startCount,
                    charge: status.charge ?? split.charge,
                    currency: status.currency ?? split.currency,
                    error: status.error ?? "",
                    lastSyncAt: new Date().toISOString(),
                  };
                }),
              );

              return {
                ...line,
                splits: nextSplits,
              };
            }),
          )
        : [],
    };
    nextOrders.push(nextOrder);
  }

  writeSharedJson(ORDERS_KEY, nextOrders, "server-sync");
  return { syncedCount, orders: nextOrders };
}

async function submitVendorSplit({ vendor, serviceId, quantity, link }) {
  const runtime = getVendorRuntime(vendor);
  if (!runtime.enabled) {
    return { ok: false, error: "供應商未啟用" };
  }
  if (!runtime.baseUrl || !runtime.key) {
    return { ok: false, error: "供應商 API 設定不完整" };
  }
  if (!serviceId || serviceId <= 0) {
    return { ok: false, error: "serviceId 未設定" };
  }

  const resp = await postVendorPanel({
    baseUrl: runtime.baseUrl,
    key: runtime.key,
    action: "add",
    payload: {
      service: serviceId,
      link,
      quantity,
    },
  });

  if (typeof resp?.error === "string") {
    return { ok: false, error: resp.error };
  }

  const vendorOrderId = toNum(resp?.order ?? resp?.id ?? resp?.data?.order);
  if (!vendorOrderId || vendorOrderId <= 0) {
    return { ok: false, error: "供應商未回傳有效訂單編號", raw: resp };
  }

  let status = {
    status: "submitted",
    remains: undefined,
    start_count: undefined,
    charge: undefined,
    currency: undefined,
    error: undefined,
  };
  try {
    status = { ...status, ...await fetchVendorStatus(vendor, vendorOrderId) };
  } catch {
    // Keep submitted status if status API is temporarily unavailable.
  }

  return {
    ok: true,
    vendorOrderId,
    status,
    raw: resp,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      json(res, 404, { ok: false, error: "Not found" });
      return;
    }

    if (req.method === "OPTIONS") {
      json(res, 204, {});
      return;
    }

    if (req.method === "GET" && req.url === "/api/health") {
      json(res, 200, { ok: true, dbPath: DB_PATH, ...currentState() });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/state")) {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      const keys = url.searchParams
        .get("keys")
        ?.split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      json(res, 200, { ok: true, ...currentState(keys) });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/meta/post-metrics")) {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      const result = await fetchMetaPostMetricsSecure({
        postId: url.searchParams.get("postId") || "",
        pageId: url.searchParams.get("pageId") || "",
        pageName: url.searchParams.get("pageName") || "",
      });
      json(res, result.ok ? 200 : 400, result);
      return;
    }

    if (req.method === "POST" && req.url === "/api/vendor/submit-order") {
      const raw = await readBody(req);
      const payload = JSON.parse(String(raw || "{}"));
      const links = Array.isArray(payload?.links) ? payload.links.filter((x) => typeof x === "string" && x.trim()) : [];
      const lines = Array.isArray(payload?.lines) ? payload.lines : [];
      const firstLink = links[0] ?? "";

      if (!firstLink) {
        json(res, 400, { ok: false, error: "缺少可送單的連結" });
        return;
      }
      if (lines.length === 0) {
        json(res, 400, { ok: false, error: "缺少送單項目" });
        return;
      }

      const now = new Date().toISOString();
      const submittedLines = [];
      let successCount = 0;
      let failureCount = 0;

      for (const line of lines) {
        const nextLine = {
          placement: line?.placement,
          quantity: Number(line?.quantity ?? 0),
          amount: Number(line?.amount ?? 0),
          warnings: Array.isArray(line?.warnings) ? [...line.warnings] : [],
          splits: [],
        };
        if (links.length > 1) {
          nextLine.warnings.push("本次供應商自動下單使用第一個連結送出，其餘連結保留在案件紀錄。");
        }

        for (const split of Array.isArray(line?.splits) ? line.splits : []) {
          const result = await submitVendorSplit({
            vendor: split?.vendor,
            serviceId: Number(split?.serviceId ?? 0),
            quantity: Number(split?.quantity ?? 0),
            link: firstLink,
          });

          if (result.ok) {
            successCount += 1;
            nextLine.splits.push({
              ...split,
              vendorOrderId: result.vendorOrderId,
              vendorStatus: result.status?.status ?? "submitted",
              remains: result.status?.remains,
              startCount: result.status?.start_count,
              charge: result.status?.charge,
              currency: result.status?.currency,
              error: result.status?.error ?? "",
              lastSyncAt: now,
            });
          } else {
            failureCount += 1;
            nextLine.splits.push({
              ...split,
              vendorStatus: "failed",
              error: result.error ?? "送單失敗",
              lastSyncAt: now,
            });
          }
        }

        submittedLines.push(nextLine);
      }

      let orderStatus = "submitted";
      if (successCount === 0) orderStatus = "failed";
      else if (failureCount > 0) orderStatus = "partial";

      json(res, 200, {
        ok: true,
        order: {
          id: String(Date.now()),
          createdAt: now,
          applicant: typeof payload?.applicant === "string" ? payload.applicant : "",
          orderNo: typeof payload?.orderNo === "string" ? payload.orderNo : "",
          caseName: typeof payload?.caseName === "string" ? payload.caseName : "",
          kind: payload?.kind === "upsell" ? "upsell" : "new",
          links,
          lines: submittedLines,
          totalAmount: Number(payload?.totalAmount ?? 0),
          status: orderStatus,
        },
        summary: {
          successCount,
          failureCount,
          usedLink: firstLink,
        },
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/vendor/sync-shared-orders") {
      const result = await syncSharedOrders();
      json(res, 200, {
        ok: true,
        syncedCount: result.syncedCount,
        orders: result.orders,
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/state/batch") {
      const raw = await readBody(req);
      const payload = JSON.parse(String(raw || "{}"));
      const values = payload?.values;
      const clientId = typeof payload?.clientId === "string" ? payload.clientId : "unknown";
      if (!values || typeof values !== "object") {
        json(res, 400, { ok: false, error: "values is required" });
        return;
      }

      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        for (const [key, value] of Object.entries(values)) {
          if (typeof key !== "string" || !key.trim()) continue;
          if (value == null) {
            deleteEntryStmt.run(key);
          } else {
            upsertEntryStmt.run(key, String(value), now, clientId);
          }
        }
        bumpRevisionStmt.run(now);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      json(res, 200, { ok: true, ...currentState() });
      return;
    }

    if (tryServeStatic(req, res)) return;
    json(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Local demo server listening on http://${HOST}:${PORT}`);
  console.log(`SQLite file: ${DB_PATH}`);
  const nets = networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const item of list ?? []) {
      if (item.family === "IPv4" && !item.internal) {
        console.log(`LAN URL: http://${item.address}:${PORT}`);
      }
    }
  }
});
