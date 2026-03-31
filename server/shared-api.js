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
let instagramAccountsCache = null;
const instagramMediaCache = new Map();
let backgroundSyncRunning = false;

const APP_CONFIG_KEY = "ad_demo_config_v1";
const VENDOR_KEYS_KEY = "ad_demo_vendor_keys_v1";
const ORDERS_KEY = "ad_demo_orders_v1";
const DEFAULT_VENDOR_BASES = {
  smmraja: "https://www.smmraja.com/api/v3",
  urpanel: "https://urpanel.com/api/v2",
  justanotherpanel: "https://justanotherpanel.com/api/v2",
};
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

function isVendorKey(value) {
  return value === "smmraja" || value === "urpanel" || value === "justanotherpanel";
}

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

function buildMetaTrackingRef({
  platform,
  refId,
  sourceUrl,
  canonicalUrl,
  pageId,
  pageName,
  resolver,
}) {
  const normalizedRefId = String(refId || "").trim();
  if (!normalizedRefId) return null;
  return {
    platform: platform === "instagram" ? "instagram" : "facebook",
    refId: normalizedRefId,
    sourceUrl: String(sourceUrl || "").trim(),
    canonicalUrl: String(canonicalUrl || "").trim() || undefined,
    pageId: String(pageId || "").trim() || undefined,
    pageName: String(pageName || "").trim() || undefined,
    resolver: String(resolver || "").trim() || undefined,
    resolvedAt: new Date().toISOString(),
  };
}

function normalizeTrackingRef(value) {
  if (!value || typeof value !== "object") return null;
  const row = value;
  const refId = String(row.refId || "").trim();
  if (!refId) return null;
  return {
    platform: row.platform === "instagram" ? "instagram" : "facebook",
    refId,
    sourceUrl: String(row.sourceUrl || "").trim(),
    canonicalUrl: String(row.canonicalUrl || "").trim() || undefined,
    pageId: String(row.pageId || "").trim() || undefined,
    pageName: String(row.pageName || "").trim() || undefined,
    resolver: String(row.resolver || "").trim() || undefined,
    resolvedAt: String(row.resolvedAt || "").trim() || undefined,
  };
}

function tryParseUrl(rawUrl) {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function isInstagramHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host.endsWith("instagram.com") || host.endsWith("instagr.am");
}

function isFacebookHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host.endsWith("facebook.com") || host.endsWith("fb.com");
}

function normalizeComparableUrl(rawUrl) {
  const parsed = tryParseUrl(rawUrl);
  if (!parsed) return String(rawUrl || "").trim();
  parsed.hash = "";
  for (const key of ["locale", "igsh", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    parsed.searchParams.delete(key);
  }
  let out = parsed.toString();
  if (out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

async function followRedirectUrl(rawUrl) {
  const src = String(rawUrl || "").trim();
  if (!src) return src;
  const parsed = tryParseUrl(src);
  if (!parsed) return src;

  try {
    const res = await fetch(src, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });
    return res?.url ? String(res.url) : src;
  } catch {
    return src;
  }
}

function parseFacebookPostUrl(rawUrl) {
  const parsed = tryParseUrl(rawUrl);
  if (!parsed) return null;
  if (!isFacebookHost(parsed.hostname)) return null;
  const segments = parsed.pathname.split("/").filter(Boolean);
  const username = segments.length > 0 ? segments[0] : "";
  const token = segments.find((value) => /^pfbid/i.test(value)) || "";
  const postIdToken = segments.find((value) => /^\d{6,}$/.test(value)) || "";
  const storyFbid = String(parsed.searchParams.get("story_fbid") || parsed.searchParams.get("fbid") || "").trim();
  const pageIdFromQuery = String(parsed.searchParams.get("id") || "").trim();
  const reelId = segments[0] === "reel" && /^\d{6,}$/.test(segments[1] || "") ? segments[1] : "";
  const videoId = segments.includes("videos")
    ? segments[segments.indexOf("videos") + 1] || ""
    : "";
  return {
    username,
    token,
    postIdToken: postIdToken || reelId || (String(videoId).match(/^\d{6,}$/) ? videoId : ""),
    storyFbid,
    pageIdFromQuery,
    rawUrl: parsed.toString(),
  };
}

function parseInstagramMediaUrl(rawUrl) {
  const parsed = tryParseUrl(rawUrl);
  if (!parsed) return null;
  if (!isInstagramHost(parsed.hostname)) return null;
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const type = segments[0];
  if (!["p", "reel", "reels", "tv"].includes(type)) return null;
  const shortcode = String(segments[1] || "").trim();
  if (!shortcode) return null;
  return {
    shortcode,
    rawUrl: parsed.toString(),
  };
}

async function listInstagramAccounts(metaSecrets) {
  const now = Date.now();
  if (instagramAccountsCache && now - instagramAccountsCache.fetchedAt < 5 * 60 * 1000) {
    return instagramAccountsCache.accounts;
  }

  const pages = await listAvailablePages(metaSecrets);
  const accounts = [];

  for (const page of pages) {
    const pageId = String(page?.id || "").trim();
    const pageToken = String(page?.access_token || "").trim();
    if (!pageId || !pageToken) continue;
    try {
      const detail = await graphApiGet(
        metaSecrets.apiVersion,
        pageToken,
        `/${encodeURIComponent(pageId)}`,
        { fields: "id,name,instagram_business_account{id,username}" },
      );
      const ig = detail?.instagram_business_account;
      const igId = String(ig?.id || "").trim();
      if (!igId) continue;
      accounts.push({
        pageId,
        pageName: String(detail?.name || page?.name || "").trim(),
        pageToken,
        igId,
        igUsername: String(ig?.username || "").trim(),
      });
    } catch {
      // ignore pages without IG account or unavailable permission
    }
  }

  instagramAccountsCache = {
    fetchedAt: now,
    accounts,
  };
  return accounts;
}

async function resolveInstagramMediaIdFromUrl(metaSecrets, rawUrl, preloadedAccounts = null) {
  const expandedUrl = await followRedirectUrl(rawUrl);
  const parsed = parseInstagramMediaUrl(expandedUrl) || parseInstagramMediaUrl(rawUrl);
  if (!parsed?.shortcode) return null;

  const cacheKey = parsed.shortcode.toLowerCase();
  const cached = instagramMediaCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
    return cached.value;
  }

  const accounts = Array.isArray(preloadedAccounts) ? preloadedAccounts : await listInstagramAccounts(metaSecrets);
  const shortcodeNeedle = `/${parsed.shortcode.toLowerCase()}`;

  for (const account of accounts) {
    let after = "";
    for (let pageIndex = 0; pageIndex < 8; pageIndex += 1) {
      let media;
      try {
        media = await graphApiGet(
          metaSecrets.apiVersion,
          account.pageToken,
          `/${encodeURIComponent(account.igId)}/media`,
          {
            fields: "id,permalink,media_type,like_count,comments_count,timestamp",
            limit: 100,
            after: after || undefined,
          },
        );
      } catch {
        break;
      }

      const rows = Array.isArray(media?.data) ? media.data : [];
      for (const row of rows) {
        const permalink = String(row?.permalink || "").trim().toLowerCase();
        if (!permalink) continue;
        if (permalink.includes(shortcodeNeedle)) {
          const mediaId = String(row?.id || "").trim();
          if (!mediaId) continue;
          const value = {
            mediaId,
            account,
            sourceUrl: String(row?.permalink || "").trim(),
          };
          instagramMediaCache.set(cacheKey, { at: Date.now(), value });
          return value;
        }
      }

      const nextAfter = String(media?.paging?.cursors?.after || "").trim();
      if (!nextAfter || nextAfter === after) break;
      after = nextAfter;
    }
  }

  instagramMediaCache.set(cacheKey, { at: Date.now(), value: null });
  return null;
}

async function resolveInstagramTrackingFromUrl(metaSecrets, rawUrl, preloadedAccounts = null) {
  const resolved = await resolveInstagramMediaIdFromUrl(metaSecrets, rawUrl, preloadedAccounts);
  if (!resolved?.mediaId) return null;
  return buildMetaTrackingRef({
    platform: "instagram",
    refId: resolved.mediaId,
    sourceUrl: rawUrl,
    canonicalUrl: resolved.sourceUrl || rawUrl,
    pageId: resolved.account?.igId || "",
    pageName: resolved.account?.igUsername || resolved.account?.pageName || "",
    resolver: "instagram_shortcode_scan",
  });
}

async function resolveFacebookTrackingFromUrl(metaSecrets, rawUrl) {
  const expandedUrl = await followRedirectUrl(rawUrl);
  const info = parseFacebookPostUrl(expandedUrl) || parseFacebookPostUrl(rawUrl);
  if (!info?.username) return null;

  let pageId = "";
  try {
    const page = await graphApiGet(metaSecrets.apiVersion, metaSecrets.userAccessToken, `/${encodeURIComponent(info.username)}`, {
      fields: "id",
    });
    pageId = typeof page?.id === "string" ? page.id.trim() : "";
  } catch {
    pageId = "";
  }
  if (!pageId && info.pageIdFromQuery && /^\d+$/.test(info.pageIdFromQuery)) {
    pageId = info.pageIdFromQuery;
  }
  if (!pageId) return null;

  const pages = await listAvailablePages(metaSecrets);
  const page = pages.find((item) => String(item?.id || "") === pageId);
  const pageName = String(page?.name || "").trim();
  const feedToken = typeof page?.access_token === "string" && page.access_token.trim()
    ? page.access_token.trim()
    : metaSecrets.userAccessToken;

  if (info.storyFbid && /^\d+$/.test(info.storyFbid)) {
    return buildMetaTrackingRef({
      platform: "facebook",
      refId: `${pageId}_${info.storyFbid}`,
      sourceUrl: rawUrl,
      canonicalUrl: expandedUrl || rawUrl,
      pageId,
      pageName,
      resolver: "facebook_story_fbid",
    });
  }

  const urlCandidates = [expandedUrl, rawUrl]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item, idx, arr) => arr.indexOf(item) === idx);

  for (const candidate of urlCandidates) {
    try {
      const resolved = await graphApiGet(metaSecrets.apiVersion, metaSecrets.userAccessToken, "/", {
        id: candidate,
        fields: "id",
      });
      const directId = typeof resolved?.id === "string" ? resolved.id.trim() : "";
      if (directId && directId !== candidate && directId.includes("_")) {
        return buildMetaTrackingRef({
          platform: "facebook",
          refId: directId,
          sourceUrl: rawUrl,
          canonicalUrl: candidate,
          pageId: derivePageIdFromPostId(directId) || pageId,
          pageName,
          resolver: "facebook_graph_id",
        });
      }
    } catch {
      // fallback below
    }
  }

  const matchToken = info.token || info.postIdToken;
  if (!matchToken) return null;

  const normalizedSource = normalizeComparableUrl(info.rawUrl || expandedUrl || rawUrl);
  for (const edge of ["posts", "feed"]) {
    let after = "";
    for (let pageIndex = 0; pageIndex < 6; pageIndex += 1) {
      let feed = null;
      try {
        feed = await graphApiGet(metaSecrets.apiVersion, feedToken, `/${encodeURIComponent(pageId)}/${edge}`, {
          fields: "id,permalink_url,created_time",
          limit: 100,
          after: after || undefined,
        });
      } catch {
        break;
      }

      const rows = Array.isArray(feed?.data) ? feed.data : [];
      for (const row of rows) {
        const permalink = typeof row?.permalink_url === "string" ? row.permalink_url : "";
        const normalizedPermalink = normalizeComparableUrl(permalink);
        if (
          permalink &&
          (permalink.includes(matchToken) ||
            normalizedPermalink.includes(matchToken) ||
            normalizedPermalink === normalizedSource)
        ) {
          const id = typeof row?.id === "string" ? row.id.trim() : "";
          if (id) {
            return buildMetaTrackingRef({
              platform: "facebook",
              refId: id,
              sourceUrl: rawUrl,
              canonicalUrl: permalink || normalizedPermalink || rawUrl,
              pageId,
              pageName,
              resolver: `facebook_${edge}_scan`,
            });
          }
        }
      }

      const nextAfter = typeof feed?.paging?.cursors?.after === "string" ? feed.paging.cursors.after : "";
      if (!nextAfter || nextAfter === after) break;
      after = nextAfter;
    }
  }

  if (info.postIdToken && /^\d+$/.test(info.postIdToken) && /^\d+$/.test(pageId)) {
    return buildMetaTrackingRef({
      platform: "facebook",
      refId: `${pageId}_${info.postIdToken}`,
      sourceUrl: rawUrl,
      canonicalUrl: expandedUrl || rawUrl,
      pageId,
      pageName,
      resolver: "facebook_page_postid_fallback",
    });
  }

  return null;
}

async function resolveTrackingFromUrl(metaSecrets, url) {
  const expandedUrl = await followRedirectUrl(url);
  const urlCandidates = [expandedUrl, url]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item, idx, arr) => arr.indexOf(item) === idx);

  for (const candidate of urlCandidates) {
    const parsed = tryParseUrl(candidate);
    if (!parsed) continue;
    if (isInstagramHost(parsed.hostname)) {
      const resolved = await resolveInstagramTrackingFromUrl(metaSecrets, candidate);
      if (resolved) return resolved;
    }
    if (isFacebookHost(parsed.hostname)) {
      const resolved = await resolveFacebookTrackingFromUrl(metaSecrets, candidate);
      if (resolved) return resolved;
    }
  }

  return null;
}

async function fetchInstagramMediaMetricsSecure(metaSecrets, rawUrl) {
  const accounts = await listInstagramAccounts(metaSecrets);
  if (accounts.length === 0) {
    return { ok: false, detail: "No linked Instagram business account available for this token" };
  }

  const resolved = await resolveInstagramMediaIdFromUrl(metaSecrets, rawUrl, accounts);
  if (!resolved?.mediaId || !resolved?.account?.pageToken) {
    return { ok: false, detail: "Instagram URL could not be resolved to a readable media ID" };
  }

  let base = null;
  try {
    base = await graphApiGet(
      metaSecrets.apiVersion,
      resolved.account.pageToken,
      `/${encodeURIComponent(resolved.mediaId)}`,
      { fields: "id,media_type,permalink,like_count,comments_count,timestamp" },
    );
  } catch {
    base = null;
  }

  if (!base) {
    return { ok: false, detail: "Instagram media fetch failed" };
  }

  const values = {
    likes: Number(base?.like_count || 0),
    comments: Number(base?.comments_count || 0),
    shares: 0,
    all_clicks: 0,
    interactions_total: 0,
    impressions: 0,
    reach: 0,
    video_3s_views: 0,
    thruplays: 0,
  };

  const metricMap = {
    impressions: "impressions",
    reach: "reach",
    video_3s_views: "video_views",
    thruplays: "video_views",
  };
  const validMetrics = [];
  const invalidMetrics = [];

  for (const [key, metric] of Object.entries(metricMap)) {
    try {
      const insight = await graphApiGet(
        metaSecrets.apiVersion,
        resolved.account.pageToken,
        `/${encodeURIComponent(resolved.mediaId)}/insights`,
        { metric },
      );
      const metricValue = readFirstInsightValue(insight);
      values[key] = metricValue;
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
      id: String(resolved.account.igId || ""),
      name: resolved.account.igUsername || resolved.account.pageName || "Instagram",
    },
    values,
    raw: {
      base,
      mediaId: resolved.mediaId,
      sourceUrl: resolved.sourceUrl || rawUrl,
      validMetrics,
      invalidMetrics,
    },
  };
}

async function fetchInstagramMediaMetricsByIdSecure(metaSecrets, trackingRef, pageTokenOverride = "") {
  const ref = normalizeTrackingRef(trackingRef);
  if (!ref?.refId) {
    return { ok: false, detail: "Instagram media id is required" };
  }

  const accounts = await listInstagramAccounts(metaSecrets);
  const matchedAccount =
    accounts.find((account) => String(account?.igId || "") === String(ref.pageId || "")) ||
    accounts.find((account) => String(account?.pageId || "") === String(ref.pageId || "")) ||
    accounts.find((account) => String(account?.igUsername || "").toLowerCase() === String(ref.pageName || "").toLowerCase()) ||
    accounts[0];

  const pageToken = pageTokenOverride || matchedAccount?.pageToken || "";
  if (!pageToken) {
    return { ok: false, detail: "Instagram page token is unavailable" };
  }

  let base = null;
  try {
    base = await graphApiGet(
      metaSecrets.apiVersion,
      pageToken,
      `/${encodeURIComponent(ref.refId)}`,
      { fields: "id,media_type,permalink,like_count,comments_count,timestamp" },
    );
  } catch {
    base = null;
  }

  if (!base) {
    return { ok: false, detail: "Instagram media fetch failed" };
  }

  const values = {
    likes: Number(base?.like_count || 0),
    comments: Number(base?.comments_count || 0),
    shares: 0,
    all_clicks: 0,
    interactions_total: 0,
    impressions: 0,
    reach: 0,
    video_3s_views: 0,
    thruplays: 0,
  };

  const metricMap = {
    impressions: "impressions",
    reach: "reach",
    video_3s_views: "video_views",
    thruplays: "video_views",
  };
  const validMetrics = [];
  const invalidMetrics = [];

  for (const [key, metric] of Object.entries(metricMap)) {
    try {
      const insight = await graphApiGet(
        metaSecrets.apiVersion,
        pageToken,
        `/${encodeURIComponent(ref.refId)}/insights`,
        { metric },
      );
      const metricValue = readFirstInsightValue(insight);
      values[key] = metricValue;
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
      id: String(ref.pageId || matchedAccount?.igId || matchedAccount?.pageId || ""),
      name: ref.pageName || matchedAccount?.igUsername || matchedAccount?.pageName || "Instagram",
    },
    values,
    raw: {
      base,
      tracking: ref,
      mediaId: ref.refId,
      validMetrics,
      invalidMetrics,
    },
  };
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

async function fetchMetaPostMetricsSecure({ postId, platform, pageId, pageName, sourceUrl }) {
  const metaSecrets = loadMetaSecrets();
  if (!metaSecrets) {
    return { ok: false, detail: "Meta local credentials are not configured" };
  }

  const postRef = String(postId || "").trim();
  if (!postRef) {
    return { ok: false, detail: "缂傚倸鎼惃顖滄尒閸忓吋鐎?ID" };
  }

  const hintedPlatform = platform === "instagram" || platform === "facebook" ? platform : "";
  const parsedPostUrl = tryParseUrl(sourceUrl || postRef);
  const urlPlatform = parsedPostUrl
    ? isInstagramHost(parsedPostUrl.hostname)
      ? "instagram"
      : isFacebookHost(parsedPostUrl.hostname)
        ? "facebook"
        : ""
    : "";
  const effectivePlatform = hintedPlatform || urlPlatform || (postRef.includes("_") ? "facebook" : "");

  let resolvedTracking = null;
  if (/^https?:\/\//i.test(postRef)) {
    resolvedTracking = await resolveTrackingFromUrl(metaSecrets, sourceUrl || postRef);
  }

  if (/^https?:\/\//i.test(postRef) && !resolvedTracking) {
    return {
      ok: false,
      detail: "The supplied URL could not be resolved into a trackable Meta post reference",
    };
  }

  const trackingRef = normalizeTrackingRef(
    resolvedTracking ||
      buildMetaTrackingRef({
        platform: effectivePlatform === "instagram" ? "instagram" : "facebook",
        refId: postRef,
        sourceUrl: sourceUrl || postRef,
        pageId: String(pageId || "").trim() || undefined,
        pageName: String(pageName || "").trim() || undefined,
        resolver: "direct_ref",
      }),
  );

  if (trackingRef?.platform === "instagram") {
    return await fetchInstagramMediaMetricsByIdSecure(metaSecrets, trackingRef);
  }

  const normalizedPostId = String(trackingRef?.refId || postRef)
    .replace(/^https?:\/\/[^/]+\//i, "")
    .split("?")[0]
    .split("#")[0]
    .trim();
  if (!normalizedPostId) {
    return { ok: false, detail: "缂傚倸鎼惃顖滄尒閸忓吋鐎?ID" };
  }

  const targetPageId =
    String(pageId || "").trim() ||
    String(trackingRef?.pageId || "").trim() ||
    derivePageIdFromPostId(normalizedPostId) ||
    metaSecrets.preferredPageId;
  const targetPageName = String(pageName || "").trim() || String(trackingRef?.pageName || "").trim() || metaSecrets.preferredPageName;
  const pages = await listAvailablePages(metaSecrets);
  const page = pages.find((item) =>
    (targetPageId && String(item?.id || "") === targetPageId) ||
    (targetPageName && String(item?.name || "") === targetPageName),
  );

  const tokenCandidates = [];
  if (page?.access_token) tokenCandidates.push(String(page.access_token));
  tokenCandidates.push(metaSecrets.userAccessToken);

  let base = null;
  let baseToken = "";
  let lastBaseError = "";
  for (const token of tokenCandidates) {
    try {
      base = await graphApiGet(
        metaSecrets.apiVersion,
        token,
        `/${encodeURIComponent(normalizedPostId)}`,
        { fields: "id,created_time,permalink_url,shares,comments.summary(true),reactions.summary(true),attachments{media_type}" },
      );
      baseToken = token;
      break;
    } catch (error) {
      lastBaseError = error instanceof Error ? error.message : "Facebook post fetch failed";
    }
  }
  if (!base || !baseToken) {
    return { ok: false, detail: lastBaseError || "Facebook post not found" };
  }

  const pageLabel = String(page?.name || targetPageName || targetPageId || "");

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
        baseToken,
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
      id: String(page?.id || targetPageId || ""),
      name: pageLabel,
    },
    values,
    raw: {
      base,
      tracking: trackingRef,
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
  const sharedKey = typeof keys?.keys?.[vendor] === "string" && keys.keys[vendor].trim()
    ? keys.keys[vendor].trim()
    : "";
  const localKey = typeof fallback?.key === "string" ? fallback.key.trim() : "";
  const key = sharedKey || localKey;
  return {
    baseUrl: typeof vendorCfg?.apiBaseUrl === "string" && vendorCfg.apiBaseUrl.trim()
      ? vendorCfg.apiBaseUrl.trim()
      : typeof fallback?.apiBaseUrl === "string" && fallback.apiBaseUrl.trim()
        ? fallback.apiBaseUrl.trim()
        : DEFAULT_VENDOR_BASES[vendor] || "",
    enabled: vendorCfg?.enabled != null ? !!vendorCfg.enabled : fallback?.enabled !== false,
    key,
    keySource: sharedKey ? "shared" : localKey ? "local" : "missing",
  };
}

function statusParamFor(vendor, orderIds) {
  const joined = orderIds.join(",");
  if (orderIds.length <= 1) return { key: "order", value: joined };
  if (vendor === "smmraja") return { key: "order", value: joined };
  return { key: "orders", value: joined };
}

function normalizeVendorStatusByRemains(status, remains) {
  const text = String(status ?? "").trim();
  if (!text) return text;
  if (typeof remains !== "number" || !Number.isFinite(remains)) return text;
  if (remains > 0) return text;

  const lower = text.toLowerCase();
  if (
    lower.includes("progress") ||
    lower.includes("processing") ||
    lower.includes("pending") ||
    lower.includes("queued")
  ) {
    return "Completed";
  }
  return text;
}

function normalizeSingleStatus(resp) {
  if (!resp || typeof resp !== "object") return { error: "Empty response" };
  if (typeof resp.error === "string") return { error: resp.error };
  const remains = toNum(resp.remains);
  const status = normalizeVendorStatusByRemains(resp.status, remains);
  return {
    status: status || undefined,
    remains,
    start_count: toNum(resp.start_count),
    charge: toNum(resp.charge),
    currency: typeof resp.currency === "string" ? resp.currency : undefined,
    error: typeof resp.error === "string" ? resp.error : undefined,
  };
}

async function fetchVendorStatus(vendor, orderId) {
  const runtime = getVendorRuntime(vendor);
  if (!runtime.enabled || !runtime.baseUrl || !runtime.key) {
    return { error: "Vendor runtime is not configured" };
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

function isVendorSplitDone(split) {
  const status = String(split?.vendorStatus ?? "").trim().toLowerCase();
  if (status && VENDOR_TERMINAL_STATUS.some((k) => status.includes(k))) return true;
  if (typeof split?.remains === "number" && split.remains <= 0) return true;
  return false;
}

function normalizeSplitStatusByRemains(split) {
  if (!split || typeof split !== "object") return split;
  const nextStatus = normalizeVendorStatusByRemains(split.vendorStatus, split.remains);
  if (!nextStatus || nextStatus === split.vendorStatus) return split;
  return {
    ...split,
    vendorStatus: nextStatus,
  };
}

function taipeiDateString(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function cloneSplitForSchedule(split, quantity) {
  return {
    ...split,
    quantity,
    vendorOrderId: undefined,
    vendorStatus: "scheduled",
    remains: quantity,
    startCount: undefined,
    charge: undefined,
    currency: undefined,
    lastSyncAt: undefined,
    error: "",
  };
}

function normalizeAppendConfig(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.enabled !== true) return null;
  const vendor = isVendorKey(raw.vendor) ? raw.vendor : null;
  const serviceId = Number(raw.serviceId);
  const quantity = Number(raw.quantity);
  if (!vendor) return null;
  if (!Number.isFinite(serviceId) || serviceId <= 0) return null;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return {
    enabled: true,
    vendor,
    serviceId: Math.floor(serviceId),
    quantity: Math.floor(quantity),
  };
}

function normalizeAppendExec(raw, fallbackConfig = null) {
  if (!raw || typeof raw !== "object") {
    if (!fallbackConfig) return undefined;
    return {
      status: "pending",
      vendor: fallbackConfig.vendor,
      serviceId: fallbackConfig.serviceId,
      quantity: fallbackConfig.quantity,
    };
  }

  const vendor = isVendorKey(raw.vendor)
    ? raw.vendor
    : fallbackConfig?.vendor && isVendorKey(fallbackConfig.vendor)
      ? fallbackConfig.vendor
      : null;
  if (!vendor) return undefined;

  const serviceId = Number(raw.serviceId ?? fallbackConfig?.serviceId ?? 0);
  const quantity = Number(raw.quantity ?? fallbackConfig?.quantity ?? 0);
  if (!Number.isFinite(serviceId) || serviceId <= 0) return undefined;
  if (!Number.isFinite(quantity) || quantity <= 0) return undefined;

  const status = raw.status === "submitted" || raw.status === "failed" || raw.status === "completed" ? raw.status : "pending";

  return {
    status,
    vendor,
    serviceId: Math.floor(serviceId),
    quantity: Math.floor(quantity),
    vendorOrderId: Number.isFinite(Number(raw.vendorOrderId)) ? Number(raw.vendorOrderId) : undefined,
    vendorStatus: typeof raw.vendorStatus === "string" ? raw.vendorStatus : undefined,
    remains: Number.isFinite(Number(raw.remains)) ? Number(raw.remains) : undefined,
    error: typeof raw.error === "string" ? raw.error : "",
    submittedAt: typeof raw.submittedAt === "string" ? raw.submittedAt : undefined,
    lastSyncAt: typeof raw.lastSyncAt === "string" ? raw.lastSyncAt : undefined,
  };
}

function normalizeBatchStatus(batch) {
  const splits = Array.isArray(batch?.splits) ? batch.splits : [];
  if (!splits.length) return "scheduled";
  const hasOrder = splits.some((split) => !!split?.vendorOrderId);
  const hasFailure = splits.some((split) => {
    const status = String(split?.vendorStatus ?? "").toLowerCase();
    return status.includes("fail") || status.includes("error") || status.includes("cancel") || status.includes("refund") || !!split?.error;
  });
  const allDone = splits.every((split) => isVendorSplitDone(split));

  if (allDone) return hasFailure ? "partial" : "completed";
  if (hasFailure && !hasOrder) return "failed";
  if (hasFailure) return "partial";
  if (hasOrder) return "submitted";
  return "scheduled";
}

function normalizeLineBatches(line) {
  if (Array.isArray(line?.batches) && line.batches.length > 0) {
    return line.batches.map((batch, index) => ({
      id: typeof batch?.id === "string" && batch.id.trim() ? batch.id.trim() : `batch-${index + 1}`,
      stageIndex: Number(batch?.stageIndex ?? index + 1),
      stageCount: Number(batch?.stageCount ?? line.batches.length),
      plannedDate: typeof batch?.plannedDate === "string" ? batch.plannedDate : undefined,
      quantity: Number(batch?.quantity ?? 0),
      amount: Number(batch?.amount ?? 0),
      warnings: Array.isArray(batch?.warnings) ? [...batch.warnings] : [],
      splits: Array.isArray(batch?.splits)
        ? batch.splits.map((split) => ({ ...split, quantity: Number(split?.quantity ?? 0) }))
        : [],
      status: typeof batch?.status === "string" ? batch.status : normalizeBatchStatus(batch),
      submittedAt: typeof batch?.submittedAt === "string" ? batch.submittedAt : undefined,
      lastSyncAt: typeof batch?.lastSyncAt === "string" ? batch.lastSyncAt : undefined,
    }));
  }

  return [
    {
      id: "batch-1",
      stageIndex: 1,
      stageCount: 1,
      plannedDate: undefined,
      quantity: Number(line?.quantity ?? 0),
      amount: Number(line?.amount ?? 0),
      warnings: Array.isArray(line?.warnings) ? [...line.warnings] : [],
      splits: Array.isArray(line?.splits)
        ? line.splits.map((split) => ({ ...split, quantity: Number(split?.quantity ?? 0) }))
        : [],
      status: normalizeBatchStatus(line),
      submittedAt: undefined,
      lastSyncAt: undefined,
    },
  ];
}

function flattenBatchSplits(batches) {
  return (Array.isArray(batches) ? batches : []).flatMap((batch) => (Array.isArray(batch?.splits) ? batch.splits : []));
}

function buildLineFromBatches(line, batches) {
  const appendOnComplete = normalizeAppendConfig(line?.appendOnComplete);
  const appendExec = normalizeAppendExec(line?.appendExec, appendOnComplete);
  return {
    ...line,
    quantity: batches.reduce((sum, batch) => sum + Number(batch?.quantity ?? 0), 0),
    amount: batches.reduce((sum, batch) => sum + Number(batch?.amount ?? 0), 0),
    warnings: Array.isArray(line?.warnings) ? [...line.warnings] : [],
    appendOnComplete: appendOnComplete ?? undefined,
    appendExec,
    batches,
    splits: flattenBatchSplits(batches),
  };
}

function deriveOrderStatus(lines) {
  const batches = (Array.isArray(lines) ? lines : []).flatMap((line) => normalizeLineBatches(line));
  if (!batches.length) return "planned";
  const statuses = batches.map((batch) => batch.status);
  if (statuses.every((status) => status === "scheduled")) return "planned";
  if (statuses.every((status) => status === "failed")) return "failed";
  if (statuses.some((status) => status === "failed" || status === "partial")) return "partial";
  return "submitted";
}

function getFinalBatch(batches) {
  const list = Array.isArray(batches) ? batches.slice() : [];
  if (!list.length) return null;
  list.sort((a, b) => Number(a?.stageIndex ?? 0) - Number(b?.stageIndex ?? 0));
  return list[list.length - 1];
}

function isFailureStatus(status) {
  const s = String(status ?? "").trim().toLowerCase();
  if (!s) return false;
  return s.includes("fail") || s.includes("error") || s.includes("cancel") || s.includes("refund");
}

function isAppendCompleted(exec) {
  if (!exec) return false;
  if (exec.status === "completed") return true;
  return isVendorSplitDone(exec);
}

async function refreshAppendExecStatus(appendExec) {
  if (!appendExec?.vendor || !appendExec?.vendorOrderId || isAppendCompleted(appendExec)) {
    return appendExec;
  }
  const status = await fetchVendorStatus(appendExec.vendor, appendExec.vendorOrderId);
  const next = {
    ...appendExec,
    status: "submitted",
    vendorStatus: status.status ?? appendExec.vendorStatus,
    remains: status.remains ?? appendExec.remains,
    error: status.error ?? "",
    lastSyncAt: new Date().toISOString(),
  };
  if (isFailureStatus(next.vendorStatus) || next.error) next.status = "failed";
  else if (isAppendCompleted(next)) next.status = "completed";
  return next;
}

async function maybeHandleLineAppend(line, links) {
  const appendOnComplete = normalizeAppendConfig(line?.appendOnComplete);
  if (!appendOnComplete) return { line, syncedCount: 0 };

  let appendExec = normalizeAppendExec(line?.appendExec, appendOnComplete);
  let syncedCount = 0;

  if (appendExec) {
    const refreshed = await refreshAppendExecStatus(appendExec);
    if (refreshed !== appendExec) {
      appendExec = refreshed;
      syncedCount += 1;
    }
  }

  if (appendExec?.status === "submitted" || appendExec?.status === "completed" || appendExec?.status === "failed") {
    return { line: { ...line, appendOnComplete, appendExec }, syncedCount };
  }

  const finalBatch = getFinalBatch(normalizeLineBatches(line));
  if (!finalBatch || finalBatch.status !== "completed") {
    return {
      line: {
        ...line,
        appendOnComplete,
        appendExec: appendExec ?? {
          status: "pending",
          vendor: appendOnComplete.vendor,
          serviceId: appendOnComplete.serviceId,
          quantity: appendOnComplete.quantity,
        },
      },
      syncedCount,
    };
  }

  const firstLink = Array.isArray(links) ? links.find((value) => typeof value === "string" && value.trim()) : "";
  if (!firstLink) {
    return {
      line: {
        ...line,
        appendOnComplete,
        appendExec: {
          status: "failed",
          vendor: appendOnComplete.vendor,
          serviceId: appendOnComplete.serviceId,
          quantity: appendOnComplete.quantity,
          error: "Missing order link for append submit",
          lastSyncAt: new Date().toISOString(),
        },
      },
      syncedCount,
    };
  }

  const result = await submitVendorSplit({
    vendor: appendOnComplete.vendor,
    serviceId: appendOnComplete.serviceId,
    quantity: appendOnComplete.quantity,
    link: firstLink,
  });

  syncedCount += 1;
  const now = new Date().toISOString();
  if (!result.ok) {
    return {
      line: {
        ...line,
        appendOnComplete,
        appendExec: {
          status: "failed",
          vendor: appendOnComplete.vendor,
          serviceId: appendOnComplete.serviceId,
          quantity: appendOnComplete.quantity,
          error: result.error ?? "Append submit failed",
          lastSyncAt: now,
        },
      },
      syncedCount,
    };
  }

  const nextExec = {
    status: "submitted",
    vendor: appendOnComplete.vendor,
    serviceId: appendOnComplete.serviceId,
    quantity: appendOnComplete.quantity,
    vendorOrderId: result.vendorOrderId,
    vendorStatus: result.status?.status ?? "submitted",
    remains: result.status?.remains ?? appendOnComplete.quantity,
    error: result.status?.error ?? "",
    submittedAt: now,
    lastSyncAt: now,
  };
  if (isFailureStatus(nextExec.vendorStatus) || nextExec.error) nextExec.status = "failed";
  else if (isAppendCompleted(nextExec)) nextExec.status = "completed";

  return {
    line: {
      ...line,
      appendOnComplete,
      appendExec: nextExec,
    },
    syncedCount,
  };
}

async function submitVendorSplit({ vendor, serviceId, quantity, link }) {
  const runtime = getVendorRuntime(vendor);
  if (!runtime.enabled) {
    return { ok: false, error: "Vendor is not enabled" };
  }
  if (!runtime.baseUrl || !runtime.key) {
    return { ok: false, error: "Vendor API config is incomplete" };
  }
  if (!serviceId || serviceId <= 0) {
    return { ok: false, error: "serviceId is missing" };
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
    return { ok: false, error: "Vendor did not return a valid order id", raw: resp };
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

async function submitBatch(batch, links) {
  const firstLink = Array.isArray(links) ? links.find((link) => typeof link === "string" && link.trim()) : "";
  const now = new Date().toISOString();
  if (!firstLink) {
    return {
      batch: {
        ...batch,
        status: "failed",
        lastSyncAt: now,
        splits: (Array.isArray(batch?.splits) ? batch.splits : []).map((split) => ({
          ...split,
          vendorStatus: "failed",
          error: "Missing order link",
          lastSyncAt: now,
        })),
      },
      submittedCount: 0,
      failureCount: Array.isArray(batch?.splits) ? batch.splits.length : 0,
    };
  }

  let submittedCount = 0;
  let failureCount = 0;
  const nextSplits = [];
  for (const split of Array.isArray(batch?.splits) ? batch.splits : []) {
    if (split?.vendorOrderId) {
      nextSplits.push(split);
      continue;
    }
    const result = await submitVendorSplit({
      vendor: split?.vendor,
      serviceId: Number(split?.serviceId ?? 0),
      quantity: Number(split?.quantity ?? 0),
      link: firstLink,
    });

    if (result.ok) {
      submittedCount += 1;
      nextSplits.push({
        ...split,
        vendorOrderId: result.vendorOrderId,
        vendorStatus: result.status?.status ?? "submitted",
        remains: result.status?.remains ?? split?.quantity ?? 0,
        startCount: result.status?.start_count,
        charge: result.status?.charge,
        currency: result.status?.currency,
        error: result.status?.error ?? "",
        lastSyncAt: now,
      });
    } else {
      failureCount += 1;
      nextSplits.push({
        ...split,
        vendorStatus: "failed",
        remains: split?.quantity ?? 0,
        error: result.error ?? "Submit failed",
        lastSyncAt: now,
      });
    }
  }

  const nextBatch = {
    ...batch,
    submittedAt: now,
    lastSyncAt: now,
    splits: nextSplits,
  };
  nextBatch.status = normalizeBatchStatus(nextBatch);
  return { batch: nextBatch, submittedCount, failureCount };
}

async function fetchVendorBalance(vendor) {
  const runtime = getVendorRuntime(vendor);
  if (!runtime.enabled) {
    return { ok: false, error: "Vendor is not enabled", source: runtime.keySource };
  }
  if (!runtime.baseUrl || !runtime.key) {
    return { ok: false, error: "Vendor API config is incomplete", source: runtime.keySource };
  }

  const resp = await postVendorPanel({
    baseUrl: runtime.baseUrl,
    key: runtime.key,
    action: "balance",
  });

  if (typeof resp?.error === "string") {
    return { ok: false, error: resp.error, source: runtime.keySource };
  }

  return {
    ok: true,
    balance: typeof resp?.balance === "string" ? resp.balance : String(resp?.balance ?? ""),
    currency: typeof resp?.currency === "string" ? resp.currency : "",
    source: runtime.keySource,
  };
}

async function retrySharedOrderBatch(orderId, lineIndex, batchId) {
  const orders = readSharedJson(ORDERS_KEY);
  if (!Array.isArray(orders)) {
    throw new Error("Shared order storage not found");
  }

  const orderIndex = orders.findIndex((order) => String(order?.id) === String(orderId));
  if (orderIndex < 0) {
    throw new Error("Order not found");
  }

  const order = orders[orderIndex];
  const lines = Array.isArray(order?.lines) ? order.lines.map((line) => ({ ...line })) : [];
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) {
    throw new Error("Line not found");
  }

  const targetLine = lines[lineIndex];
  const batches = normalizeLineBatches(targetLine);
  const batchIndex = batches.findIndex((batch) => String(batch?.id) === String(batchId));
  if (batchIndex < 0) {
    throw new Error("Batch not found");
  }

  const today = taipeiDateString();
  const targetBatch = batches[batchIndex];
  if (targetBatch.plannedDate && targetBatch.plannedDate > today) {
    throw new Error(`This batch is scheduled for ${targetBatch.plannedDate} and is not retryable yet`);
  }

  const resetBatch = {
    ...targetBatch,
    status: "scheduled",
    splits: targetBatch.splits.map((split) => {
      if (split?.vendorOrderId) return { ...split };
      return {
        ...split,
        vendorStatus: "scheduled",
        remains: Number(split?.quantity ?? 0),
        startCount: undefined,
        charge: undefined,
        currency: undefined,
        lastSyncAt: undefined,
        error: "",
      };
    }),
  };

  const result = await submitBatch(resetBatch, order?.links);
  batches[batchIndex] = result.batch;

  const nextLineBase = buildLineFromBatches(targetLine, batches);
  const appendResult = await maybeHandleLineAppend(nextLineBase, order?.links);
  lines[lineIndex] = appendResult.line;
  const nextOrder = {
    ...order,
    lines,
    status: deriveOrderStatus(lines),
  };

  const nextOrders = orders.slice();
  nextOrders[orderIndex] = nextOrder;
  writeSharedJson(ORDERS_KEY, nextOrders, "server-retry-batch");

  return {
    order: nextOrder,
    batch: result.batch,
    submittedCount: result.submittedCount,
    failureCount: result.failureCount,
  };
}

async function syncSharedOrders() {
  const orders = readSharedJson(ORDERS_KEY);
  if (!Array.isArray(orders) || orders.length === 0) {
    return { syncedCount: 0, orders: [] };
  }

  const metaSecrets = loadMetaSecrets();
  let syncedCount = 0;
  const nextOrders = [];
  const today = taipeiDateString();

  for (const order of orders) {
    let tracking = normalizeTrackingRef(order?.tracking);
    let trackingError = typeof order?.trackingError === "string" ? order.trackingError : "";
    let trackingResolvedAt = typeof order?.trackingResolvedAt === "string" ? order.trackingResolvedAt : "";
    const firstLink =
      Array.isArray(order?.links) && order.links.length > 0 && typeof order.links[0] === "string"
        ? String(order.links[0]).trim()
        : "";

    if (!tracking?.refId && metaSecrets && firstLink) {
      try {
        const resolvedTracking = await resolveTrackingFromUrl(metaSecrets, firstLink);
        if (resolvedTracking?.refId) {
          tracking = resolvedTracking;
          trackingError = "";
          trackingResolvedAt = resolvedTracking.resolvedAt || new Date().toISOString();
        }
      } catch (error) {
        trackingError = error instanceof Error ? error.message : "tracking resolve failed";
        trackingResolvedAt = new Date().toISOString();
      }
    }

    const nextLines = [];
    for (const line of Array.isArray(order?.lines) ? order.lines : []) {
      const nextBatches = [];
      for (const batch of normalizeLineBatches(line)) {
        let nextBatch = {
          ...batch,
          splits: Array.isArray(batch?.splits) ? batch.splits.map((split) => ({ ...split })) : [],
        };

        const isDue = !nextBatch.plannedDate || nextBatch.plannedDate <= today;
        if (nextBatch.status === "scheduled" && isDue) {
          const submitResult = await submitBatch(nextBatch, order?.links);
          nextBatch = submitResult.batch;
          syncedCount += submitResult.submittedCount;
        }

        const refreshedSplits = [];
        for (const split of nextBatch.splits) {
          if (!split?.vendor || !split?.vendorOrderId || isVendorSplitDone(split)) {
            refreshedSplits.push(normalizeSplitStatusByRemains(split));
            continue;
          }
          const status = await fetchVendorStatus(split.vendor, split.vendorOrderId);
          syncedCount += 1;
          const vendorStatus = normalizeVendorStatusByRemains(status.status, status.remains ?? split.remains);
          refreshedSplits.push({
            ...split,
            vendorStatus: vendorStatus ?? split.vendorStatus,
            remains: status.remains ?? split.remains,
            startCount: status.start_count ?? split.startCount,
            charge: status.charge ?? split.charge,
            currency: status.currency ?? split.currency,
            error: status.error ?? "",
            lastSyncAt: new Date().toISOString(),
          });
        }

        nextBatch = {
          ...nextBatch,
          splits: refreshedSplits,
          status: normalizeBatchStatus({ ...nextBatch, splits: refreshedSplits }),
          lastSyncAt:
            refreshedSplits
              .map((split) => split.lastSyncAt)
              .filter(Boolean)
              .sort()
              .at(-1) ?? nextBatch.lastSyncAt,
        };
        nextBatches.push(nextBatch);
      }
      const nextLineBase = buildLineFromBatches(line, nextBatches);
      const appendResult = await maybeHandleLineAppend(nextLineBase, order?.links);
      syncedCount += appendResult.syncedCount;
      nextLines.push(appendResult.line);
    }

    nextOrders.push({
      ...order,
      lines: nextLines,
      status: deriveOrderStatus(nextLines),
      tracking: tracking ?? undefined,
      trackingError: trackingError || undefined,
      trackingResolvedAt: trackingResolvedAt || undefined,
    });
  }

  writeSharedJson(ORDERS_KEY, nextOrders, "server-sync");
  return { syncedCount, orders: nextOrders };
}

async function processScheduledOrdersInBackground() {
  if (backgroundSyncRunning) return;
  backgroundSyncRunning = true;
  try {
    await syncSharedOrders();
  } catch (error) {
    console.error("[scheduled-orders]", error);
  } finally {
    backgroundSyncRunning = false;
  }
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
        platform: url.searchParams.get("platform") || "",
        pageId: url.searchParams.get("pageId") || "",
        pageName: url.searchParams.get("pageName") || "",
        sourceUrl: url.searchParams.get("sourceUrl") || "",
      });
      json(res, result.ok ? 200 : 400, result);
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/vendor/balance")) {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      const vendor = String(url.searchParams.get("vendor") || "").trim();
      if (!vendor) {
        json(res, 400, { ok: false, error: "缂傚倸鎼惃?vendor" });
        return;
      }
      const result = await fetchVendorBalance(vendor);
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
        json(res, 400, { ok: false, error: "Missing order link" });
        return;
      }
      if (links.length > 1) {
        json(res, 400, { ok: false, error: "Only one link is allowed per submission" });
        return;
      }
      if (lines.length === 0) {
        json(res, 400, { ok: false, error: "Missing order lines" });
        return;
      }

      const now = new Date().toISOString();
      const today = taipeiDateString();
      const submittedLines = [];
      let successCount = 0;
      let failureCount = 0;
      const metaSecrets = loadMetaSecrets();
      let tracking = undefined;
      let trackingError = "";
      let trackingResolvedAt = "";

      if (metaSecrets && firstLink) {
        try {
          const resolvedTracking = await resolveTrackingFromUrl(metaSecrets, firstLink);
          if (resolvedTracking?.refId) {
            tracking = resolvedTracking;
            trackingResolvedAt = resolvedTracking.resolvedAt || now;
          } else {
            trackingError = "tracking resolve returned empty";
            trackingResolvedAt = now;
          }
        } catch (error) {
          trackingError = error instanceof Error ? error.message : "tracking resolve failed";
          trackingResolvedAt = now;
        }
      }

      for (const line of lines) {
        const appendOnComplete = normalizeAppendConfig(line?.appendOnComplete);
        const nextLine = {
          placement: line?.placement,
          quantity: Number(line?.quantity ?? 0),
          amount: Number(line?.amount ?? 0),
          warnings: Array.isArray(line?.warnings) ? [...line.warnings] : [],
          appendOnComplete: appendOnComplete ?? undefined,
          appendExec: appendOnComplete
            ? {
                status: "pending",
                vendor: appendOnComplete.vendor,
                serviceId: appendOnComplete.serviceId,
                quantity: appendOnComplete.quantity,
              }
            : undefined,
          splits: [],
          mode: line?.mode === "average" ? "average" : "instant",
          startDate: typeof line?.startDate === "string" ? line.startDate : undefined,
          endDate: typeof line?.endDate === "string" ? line.endDate : undefined,
          batches: [],
        };
        const nextBatches = [];
        for (const batch of normalizeLineBatches(line)) {
          const normalizedBatch = {
            ...batch,
            warnings: [...nextLine.warnings, ...(Array.isArray(batch?.warnings) ? batch.warnings : [])],
            splits: Array.isArray(batch?.splits)
              ? batch.splits.map((split) => cloneSplitForSchedule(split, Number(split?.quantity ?? 0)))
              : [],
          };
          const isDue = !normalizedBatch.plannedDate || normalizedBatch.plannedDate <= today;
          if (!isDue) {
            nextBatches.push({
              ...normalizedBatch,
              status: "scheduled",
            });
            continue;
          }

          const result = await submitBatch(normalizedBatch, links);
          successCount += result.submittedCount;
          failureCount += result.failureCount;
          nextBatches.push(result.batch);
        }

        const nextLineBase = buildLineFromBatches(nextLine, nextBatches);
        const appendResult = await maybeHandleLineAppend(nextLineBase, links);
        submittedLines.push(appendResult.line);
      }

      const order = {
        id: String(Date.now()),
        createdAt: now,
        applicant: typeof payload?.applicant === "string" ? payload.applicant : "",
        orderNo: typeof payload?.orderNo === "string" ? payload.orderNo : "",
        caseName: typeof payload?.caseName === "string" ? payload.caseName : "",
        kind: payload?.kind === "upsell" ? "upsell" : "new",
        mode: payload?.mode === "average" ? "average" : "instant",
        scheduleStartDate: typeof payload?.scheduleStartDate === "string" ? payload.scheduleStartDate : undefined,
        scheduleEndDate: typeof payload?.scheduleEndDate === "string" ? payload.scheduleEndDate : undefined,
        links,
        lines: submittedLines,
        totalAmount: Number(payload?.totalAmount ?? 0),
        status: deriveOrderStatus(submittedLines),
        tracking,
        trackingError: trackingError || undefined,
        trackingResolvedAt: trackingResolvedAt || undefined,
      };

      const existingOrders = readSharedJson(ORDERS_KEY);
      writeSharedJson(ORDERS_KEY, [...(Array.isArray(existingOrders) ? existingOrders : []), order], "server-submit");

      json(res, 200, {
        ok: true,
        order,
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

    if (req.method === "POST" && req.url === "/api/vendor/retry-batch") {
      const raw = await readBody(req);
      const payload = JSON.parse(String(raw || "{}"));
      const orderId = String(payload?.orderId || "").trim();
      const lineIndex = Number(payload?.lineIndex);
      const batchId = String(payload?.batchId || "").trim();

      if (!orderId || !Number.isInteger(lineIndex) || !batchId) {
        json(res, 400, { ok: false, error: "Missing retry parameters" });
        return;
      }

      const result = await retrySharedOrderBatch(orderId, lineIndex, batchId);
      json(res, 200, { ok: true, ...result });
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

void processScheduledOrdersInBackground();
setInterval(() => {
  void processScheduledOrdersInBackground();
}, 60 * 1000);
