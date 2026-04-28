import http from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  CREATE TABLE IF NOT EXISTS meta_tracking_cache (
    cache_key TEXT PRIMARY KEY,
    tracking_ref TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
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
const selectTrackingCacheStmt = db.prepare("SELECT tracking_ref FROM meta_tracking_cache WHERE cache_key = ?");
const upsertTrackingCacheStmt = db.prepare(`
  INSERT INTO meta_tracking_cache (cache_key, tracking_ref, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(cache_key) DO UPDATE SET
    tracking_ref = excluded.tracking_ref,
    updated_at = excluded.updated_at
`);

let metaPagesCache = null;
let instagramAccountsCache = null;
const instagramMediaCache = new Map();
const metaPostMetricsCache = new Map();
const metaPostMetricsInflight = new Map();
const metaPostMetricsBackoff = new Map();
const metaPostMetricsLastAttemptAt = new Map();
const metaInterestSearchCache = new Map();
let backgroundSyncRunning = false;
let backgroundMetaSyncRunning = false;
let trackingCachePrimed = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const APP_CONFIG_KEY = "ad_demo_config_v1";
const VENDOR_KEYS_KEY = "ad_demo_vendor_keys_v1";
const ORDERS_KEY = "ad_demo_orders_v1";
const META_ORDERS_KEY = "ad_demo_meta_orders_v1";
const META_SETTINGS_KEY = "ad_demo_meta_settings_v2";
const META_SYNC_STATUS_KEY = "ad_demo_meta_sync_status_v1";
const META_BACKGROUND_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const META_POST_METRIC_CACHE_TTL_MS = Number(process.env.META_POST_METRIC_CACHE_TTL_MS || 2 * 60 * 1000);
const META_POST_METRIC_BACKOFF_MS = Number(process.env.META_POST_METRIC_BACKOFF_MS || 90 * 1000);
const META_POST_METRIC_MIN_GAP_MS = Number(process.env.META_POST_METRIC_MIN_GAP_MS || 1200);
const META_SYNC_MAX_ROWS_PER_RUN = Number(process.env.META_SYNC_MAX_ROWS_PER_RUN || 8);
const META_SYNC_ROW_GAP_MS = Number(process.env.META_SYNC_ROW_GAP_MS || 300);
const META_SYNC_MIN_RECHECK_MS = Number(process.env.META_SYNC_MIN_RECHECK_MS || 60 * 1000);
const DEFAULT_VENDOR_BASES = {
  smmraja: "https://www.smmraja.com/api/v3",
  urpanel: "https://urpanel.com/api/v2",
  justanotherpanel: "https://justanotherpanel.com/api/v2",
  hdz: "https://www.hdsrdmp.com/api/v2",
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
  return value === "smmraja" || value === "urpanel" || value === "justanotherpanel" || value === "hdz";
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

function readJsonFileSafe(path) {
  const raw = readFileSync(path, "utf-8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function loadMetaSecrets() {
  if (!existsSync(META_SECRET_PATH)) return null;
  try {
    const raw = readJsonFileSafe(META_SECRET_PATH);
    if (!raw || typeof raw !== "object") return null;
    const adsAccessToken = typeof raw.adsAccessToken === "string" ? raw.adsAccessToken.trim() : "";
    const facebookAccessToken = typeof raw.facebookAccessToken === "string" ? raw.facebookAccessToken.trim() : "";
    const instagramAccessToken = typeof raw.instagramAccessToken === "string" ? raw.instagramAccessToken.trim() : "";
    const userAccessToken =
      (typeof raw.userAccessToken === "string" ? raw.userAccessToken.trim() : "") ||
      adsAccessToken ||
      facebookAccessToken ||
      instagramAccessToken;
    if (!userAccessToken && !adsAccessToken && !facebookAccessToken && !instagramAccessToken) return null;
    return {
      apiVersion: typeof raw.apiVersion === "string" && raw.apiVersion.trim() ? raw.apiVersion.trim() : "v20.0",
      userAccessToken,
      adsAccessToken,
      facebookAccessToken,
      instagramAccessToken,
      preferredPageId: typeof raw.preferredPageId === "string" ? raw.preferredPageId.trim() : "",
      preferredPageName: typeof raw.preferredPageName === "string" ? raw.preferredPageName.trim() : "",
    };
  } catch {
    return null;
  }
}

function getMetaToken(metaSecrets, platform) {
  if (!metaSecrets) return "";
  if (platform === "ads") {
    return String(metaSecrets.adsAccessToken || metaSecrets.userAccessToken || "").trim();
  }
  if (platform === "instagram") {
    return String(metaSecrets.instagramAccessToken || metaSecrets.userAccessToken || "").trim();
  }
  return String(metaSecrets.facebookAccessToken || metaSecrets.userAccessToken || "").trim();
}

function loadVendorSecrets() {
  if (!existsSync(VENDOR_SECRET_PATH)) return null;
  try {
    const raw = readJsonFileSafe(VENDOR_SECRET_PATH);
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

async function graphApiPost(apiVersion, token, path, params = {}) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    body.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  body.set("access_token", token);

  const res = await fetch(graphUrl(apiVersion, path), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
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
  const pageToken = getMetaToken(metaSecrets, "facebook");
  if (!pageToken) return [];
  const raw = await graphApiGet(metaSecrets.apiVersion, pageToken, "/me/accounts");
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
  for (const key of ["locale", "igsh", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "rdid", "share_url"]) {
    parsed.searchParams.delete(key);
  }
  let out = parsed.toString();
  if (out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

function uniqueStrings(values) {
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function sleep(ms) {
  const waitMs = Number(ms);
  if (!Number.isFinite(waitMs) || waitMs <= 0) return Promise.resolve();
  return new Promise((resolvePromise) => setTimeout(resolvePromise, waitMs));
}

function isRateLimitLikeError(detail) {
  const text = String(detail || "").toLowerCase();
  if (!text) return false;
  return (
    text.includes("rate limit") ||
    text.includes("too many requests") ||
    text.includes("user request limit") ||
    text.includes("temporarily blocked") ||
    text.includes("reduce the amount of data") ||
    text.includes("code 4") ||
    text.includes("code 17")
  );
}

function buildMetaPostMetricCacheKey({ postId, platform, pageId, pageName, sourceUrl }) {
  return [
    String(platform || "").trim().toLowerCase() || "auto",
    String(postId || "").trim(),
    String(pageId || "").trim(),
    String(pageName || "").trim().toLowerCase(),
    normalizeComparableUrl(String(sourceUrl || "").trim()),
  ].join("|");
}

function trimMetaPostMetricCaches() {
  const now = Date.now();
  for (const [key, value] of metaPostMetricsCache.entries()) {
    if (!value || Number(value.expiresAt || 0) <= now) {
      metaPostMetricsCache.delete(key);
    }
  }
  for (const [key, value] of metaPostMetricsBackoff.entries()) {
    if (!value || Number(value.until || 0) <= now) {
      metaPostMetricsBackoff.delete(key);
    }
  }
}

function readMetaPostMetricCache(cacheKey) {
  trimMetaPostMetricCaches();
  const row = metaPostMetricsCache.get(cacheKey);
  if (!row || Number(row.expiresAt || 0) <= Date.now()) {
    metaPostMetricsCache.delete(cacheKey);
    return null;
  }
  return row.result;
}

function writeMetaPostMetricCache(cacheKey, result) {
  metaPostMetricsCache.set(cacheKey, {
    expiresAt: Date.now() + META_POST_METRIC_CACHE_TTL_MS,
    result,
  });
  if (metaPostMetricsCache.size > 500) {
    const first = metaPostMetricsCache.keys().next().value;
    if (first) metaPostMetricsCache.delete(first);
  }
}

function readMetaPostMetricBackoff(cacheKey) {
  trimMetaPostMetricCaches();
  const row = metaPostMetricsBackoff.get(cacheKey);
  if (!row || Number(row.until || 0) <= Date.now()) {
    metaPostMetricsBackoff.delete(cacheKey);
    return null;
  }
  return row;
}

function writeMetaPostMetricBackoff(cacheKey, detail) {
  metaPostMetricsBackoff.set(cacheKey, {
    until: Date.now() + META_POST_METRIC_BACKOFF_MS,
    detail: String(detail || "").trim(),
  });
  if (metaPostMetricsBackoff.size > 500) {
    const first = metaPostMetricsBackoff.keys().next().value;
    if (first) metaPostMetricsBackoff.delete(first);
  }
}

function buildTrackingCacheKeys(...urls) {
  const out = [];
  for (const url of urls) {
    const raw = String(url || "").trim();
    if (!raw) continue;
    out.push(raw);
    out.push(normalizeComparableUrl(raw));
    const parsed = tryParseUrl(raw);
    if (parsed) {
      out.push(`${parsed.origin}${parsed.pathname}`.replace(/\/$/, ""));
    }
  }
  return uniqueStrings(out);
}

function readTrackingCache(...urls) {
  const keys = buildTrackingCacheKeys(...urls);
  for (const key of keys) {
    try {
      const row = selectTrackingCacheStmt.get(key);
      if (!row?.tracking_ref) continue;
      const parsed = normalizeTrackingRef(JSON.parse(String(row.tracking_ref)));
      if (parsed) return parsed;
    } catch {
      // ignore broken cache rows
    }
  }
  return null;
}

function writeTrackingCache(trackingRef, ...urls) {
  const normalized = normalizeTrackingRef(trackingRef);
  if (!normalized) return;
  const now = new Date().toISOString();
  const payload = JSON.stringify(normalized);
  const keys = buildTrackingCacheKeys(
    normalized.sourceUrl,
    normalized.canonicalUrl,
    ...urls,
  );
  for (const key of keys) {
    try {
      upsertTrackingCacheStmt.run(key, payload, now);
    } catch {
      // ignore cache write failures
    }
  }
}

function primeTrackingCacheFromStoredOrders() {
  if (trackingCachePrimed) return;
  trackingCachePrimed = true;

  const seedRows = [];
  try {
    const vendorOrdersRow = selectEntryStmt.get(ORDERS_KEY);
    const vendorOrders = JSON.parse(String(vendorOrdersRow?.storage_value || "[]"));
    if (Array.isArray(vendorOrders)) {
      for (const order of vendorOrders) {
        const trackingRef = normalizeTrackingRef(order?.tracking);
        if (!trackingRef) continue;
        const links = Array.isArray(order?.links) ? order.links : [];
        seedRows.push({ trackingRef, urls: links });
      }
    }
  } catch {
    // ignore invalid vendor order cache
  }

  try {
    const metaOrdersRow = selectEntryStmt.get(META_ORDERS_KEY);
    const metaOrders = JSON.parse(String(metaOrdersRow?.storage_value || "[]"));
    if (Array.isArray(metaOrders)) {
      for (const row of metaOrders) {
        const trackingRef = normalizeTrackingRef(row?.trackingRef);
        if (!trackingRef) continue;
        const urls = [
          row?.existingPostSource,
          row?.landingUrl,
          trackingRef.sourceUrl,
          trackingRef.canonicalUrl,
        ];
        seedRows.push({ trackingRef, urls });
      }
    }
  } catch {
    // ignore invalid meta order cache
  }

  for (const row of seedRows) {
    writeTrackingCache(row.trackingRef, ...(Array.isArray(row.urls) ? row.urls : []));
  }
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

function extractOpenGraphUrl(html) {
  const raw = String(html || "");
  if (!raw) return "";
  const match = raw.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)
    || raw.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i);
  return match?.[1] ? String(match[1]).trim() : "";
}

async function fetchOpenGraphUrl(rawUrl) {
  const src = String(rawUrl || "").trim();
  if (!src) return "";
  try {
    const res = await fetch(src, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });
    const html = await res.text();
    const direct = extractOpenGraphUrl(html);
    if (direct) return direct;
    const canonical = res?.url ? String(res.url) : "";
    if (canonical && canonical !== src) {
      const fallbackRes = await fetch(canonical, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      });
      const fallbackHtml = await fallbackRes.text();
      return extractOpenGraphUrl(fallbackHtml);
    }
    return "";
  } catch {
    return "";
  }
}

function extractFacebookProfileIdFromHtml(html) {
  const raw = String(html || "");
  if (!raw) return "";
  const patterns = [
    /fb:\/\/profile\/(\d{8,})/i,
    /profile_id\\?":\\?"?(\d{8,})/i,
    /page_id\\?":\\?"?(\d{8,})/i,
    /entity_id\\?":\\?"?(\d{8,})/i,
    /owning_profile_id\\?":\\?"?(\d{8,})/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return String(match[1]).trim();
  }
  return "";
}

async function fetchFacebookProfileIdByUsername(username) {
  const name = String(username || "").trim();
  if (!name) return "";
  try {
    const res = await fetch(`https://www.facebook.com/${encodeURIComponent(name)}`, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });
    const html = await res.text();
    return extractFacebookProfileIdFromHtml(html);
  } catch {
    return "";
  }
}

async function resolveFacebookTrackingFromPublicUrl(rawUrl) {
  const expandedUrl = await followRedirectUrl(rawUrl);
  const info = parseFacebookPostUrl(expandedUrl) || parseFacebookPostUrl(rawUrl);
  if (!info?.username) return null;

  let pageId = "";
  if (info.pageIdFromQuery && /^\d+$/.test(info.pageIdFromQuery)) {
    pageId = info.pageIdFromQuery;
  }
  if (!pageId) {
    pageId = await fetchFacebookProfileIdByUsername(info.username);
  }

  const pageName = info.username;
  if (info.storyFbid && /^\d+$/.test(info.storyFbid) && pageId) {
    return buildMetaTrackingRef({
      platform: "facebook",
      refId: `${pageId}_${info.storyFbid}`,
      sourceUrl: rawUrl,
      canonicalUrl: expandedUrl || rawUrl,
      pageId,
      pageName,
      resolver: "facebook_story_fbid_public",
    });
  }

  const urlCandidates = [expandedUrl, rawUrl]
    .flatMap((item) => {
      const value = String(item || "").trim();
      if (!value) return [];
      const parsed = tryParseUrl(value);
      if (!parsed) return [value];
      return [value, `${parsed.origin}${parsed.pathname}`, normalizeComparableUrl(value)];
    })
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item, idx, arr) => arr.indexOf(item) === idx);

  for (const candidate of urlCandidates) {
    const canonicalUrl = await fetchOpenGraphUrl(candidate);
    if (!canonicalUrl) continue;
    const canonicalInfo = parseFacebookPostUrl(canonicalUrl);
    if (!canonicalInfo) continue;

    if (!pageId && canonicalInfo.pageIdFromQuery && /^\d+$/.test(canonicalInfo.pageIdFromQuery)) {
      pageId = canonicalInfo.pageIdFromQuery;
    }
    if (!pageId && canonicalInfo.username) {
      pageId = await fetchFacebookProfileIdByUsername(canonicalInfo.username);
    }

    if (canonicalInfo.storyFbid && /^\d+$/.test(canonicalInfo.storyFbid) && pageId) {
      return buildMetaTrackingRef({
        platform: "facebook",
        refId: `${pageId}_${canonicalInfo.storyFbid}`,
        sourceUrl: rawUrl,
        canonicalUrl,
        pageId,
        pageName: canonicalInfo.username || pageName,
        resolver: "facebook_og_story_public",
      });
    }

    if (canonicalInfo.postIdToken && /^\d+$/.test(canonicalInfo.postIdToken) && pageId) {
      return buildMetaTrackingRef({
        platform: "facebook",
        refId: `${pageId}_${canonicalInfo.postIdToken}`,
        sourceUrl: rawUrl,
        canonicalUrl,
        pageId,
        pageName: canonicalInfo.username || pageName,
        resolver: "facebook_og_postid_public",
      });
    }
  }

  if (info.postIdToken && /^\d+$/.test(info.postIdToken) && pageId) {
    return buildMetaTrackingRef({
      platform: "facebook",
      refId: `${pageId}_${info.postIdToken}`,
      sourceUrl: rawUrl,
      canonicalUrl: expandedUrl || rawUrl,
      pageId,
      pageName,
      resolver: "facebook_page_postid_public",
    });
  }

  return null;
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
  const publicResolved = await resolveFacebookTrackingFromPublicUrl(rawUrl);
  if (publicResolved) return publicResolved;

  const expandedUrl = await followRedirectUrl(rawUrl);
  const info = parseFacebookPostUrl(expandedUrl) || parseFacebookPostUrl(rawUrl);
  if (!info?.username) return null;

  let pageId = "";
  if (!pageId && info.pageIdFromQuery && /^\d+$/.test(info.pageIdFromQuery)) {
    pageId = info.pageIdFromQuery;
  }
  if (!pageId) {
    pageId = await fetchFacebookProfileIdByUsername(info.username);
  }
  let pageName = info.username;
  let feedToken = getMetaToken(metaSecrets, "facebook");

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
    .flatMap((item) => {
      const value = String(item || "").trim();
      if (!value) return [];
      const parsed = tryParseUrl(value);
      if (!parsed) return [value];
      return [
        value,
        `${parsed.origin}${parsed.pathname}`,
        normalizeComparableUrl(value),
      ];
    })
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item, idx, arr) => arr.indexOf(item) === idx);

  for (const candidate of urlCandidates) {
    const canonicalUrl = await fetchOpenGraphUrl(candidate);
    if (!canonicalUrl) continue;
    const canonicalInfo = parseFacebookPostUrl(canonicalUrl);
    if (!pageId && canonicalInfo?.pageIdFromQuery && /^\d+$/.test(canonicalInfo.pageIdFromQuery)) {
      pageId = canonicalInfo.pageIdFromQuery;
    }
    if (!pageId && canonicalInfo?.username) {
      pageId = await fetchFacebookProfileIdByUsername(canonicalInfo.username);
    }
    if (canonicalInfo?.username) {
      pageName = canonicalInfo.username;
    }
    if (canonicalInfo?.storyFbid && /^\d+$/.test(canonicalInfo.storyFbid)) {
      return buildMetaTrackingRef({
        platform: "facebook",
        refId: `${pageId}_${canonicalInfo.storyFbid}`,
        sourceUrl: rawUrl,
        canonicalUrl,
        pageId,
        pageName,
        resolver: "facebook_og_url_story",
      });
    }
    if (canonicalInfo?.postIdToken && /^\d+$/.test(canonicalInfo.postIdToken)) {
      if (!pageId && canonicalInfo?.username) {
        pageId = await fetchFacebookProfileIdByUsername(canonicalInfo.username);
      }
      if (!pageId) continue;
      return buildMetaTrackingRef({
        platform: "facebook",
        refId: `${pageId}_${canonicalInfo.postIdToken}`,
        sourceUrl: rawUrl,
        canonicalUrl,
        pageId,
        pageName,
        resolver: "facebook_og_url_postid",
      });
    }
  }

  if (!pageId) return null;

  let pages = [];
  try {
    pages = await listAvailablePages(metaSecrets);
  } catch {
    pages = [];
  }
  const page = pages.find((item) => String(item?.id || "") === pageId);
  if (String(page?.name || "").trim()) {
    pageName = String(page.name).trim();
  }
  if (typeof page?.access_token === "string" && page.access_token.trim()) {
    feedToken = page.access_token.trim();
  }

  for (const candidate of urlCandidates) {
    try {
      const resolved = await graphApiGet(metaSecrets.apiVersion, getMetaToken(metaSecrets, "facebook"), "/", {
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
  primeTrackingCacheFromStoredOrders();
  const expandedUrl = await followRedirectUrl(url);
  const cached = readTrackingCache(url, expandedUrl);
  if (cached) {
    return {
      ...cached,
      sourceUrl: String(url || "").trim() || cached.sourceUrl,
      resolver: cached.resolver || "cache",
      resolvedAt: new Date().toISOString(),
    };
  }

  const urlCandidates = uniqueStrings([expandedUrl, url]);

  for (const candidate of urlCandidates) {
    const parsed = tryParseUrl(candidate);
    if (!parsed) continue;
    if (isInstagramHost(parsed.hostname)) {
      let resolved = null;
      try {
        resolved = await resolveInstagramTrackingFromUrl(metaSecrets, candidate);
      } catch {
        resolved = null;
      }
      if (resolved) {
        writeTrackingCache(resolved, url, expandedUrl, candidate);
        return resolved;
      }
    }
    if (isFacebookHost(parsed.hostname)) {
      let resolved = null;
      try {
        resolved = await resolveFacebookTrackingFromPublicUrl(candidate);
      } catch {
        resolved = null;
      }
      if (resolved) {
        writeTrackingCache(resolved, url, expandedUrl, candidate);
        return resolved;
      }
      try {
        resolved = await resolveFacebookTrackingFromUrl(metaSecrets, candidate);
      } catch {
        resolved = null;
      }
      if (resolved) {
        writeTrackingCache(resolved, url, expandedUrl, candidate);
        return resolved;
      }
    }
  }

  return null;
}

async function fetchInstagramMediaMetricsSecure(metaSecrets, rawUrl) {
  let accounts = [];
  try {
    accounts = await listInstagramAccounts(metaSecrets);
  } catch {
    accounts = [];
  }
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

  const tokenCandidates = uniqueStrings([
    pageTokenOverride,
    matchedAccount?.pageToken,
    getMetaToken(metaSecrets, "instagram"),
  ]);
  if (tokenCandidates.length === 0) {
    return { ok: false, detail: "Instagram access token is unavailable" };
  }

  let baseToken = "";
  let base = null;
  let baseError = "";
  for (const token of tokenCandidates) {
    try {
      base = await graphApiGet(
        metaSecrets.apiVersion,
        token,
        `/${encodeURIComponent(ref.refId)}`,
        { fields: "id,media_type,permalink,like_count,comments_count,timestamp" },
      );
      baseToken = token;
      break;
    } catch (error) {
      baseError = error instanceof Error ? error.message : "Instagram media fetch failed";
    }
  }

  if (!base) {
    return { ok: false, detail: baseError || "Instagram media fetch failed" };
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
    let fetched = false;
    let lastError = "";
    for (const token of uniqueStrings([baseToken, ...tokenCandidates])) {
      try {
        const insight = await graphApiGet(
          metaSecrets.apiVersion,
          token,
          `/${encodeURIComponent(ref.refId)}/insights`,
          { metric },
        );
        const metricValue = readFirstInsightValue(insight);
        values[key] = metricValue;
        validMetrics.push(metric);
        fetched = true;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "unknown error";
      }
    }
    if (!fetched) {
      invalidMetrics.push({
        metric,
        detail: lastError || "unknown error",
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

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }
  return 0;
}

function asActions(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object");
}

function sumAcrossActionTypes(value, actionTypes) {
  const rows = asActions(value);
  if (rows.length === 0) return 0;
  const allow = new Set(actionTypes.map((item) => String(item).toLowerCase()));
  return rows
    .filter((row) => allow.has(String(row.action_type || "").toLowerCase()))
    .reduce((sum, row) => sum + toNumber(row.value), 0);
}

function sumActions(value, actionTypes) {
  const rows = asActions(value);
  if (rows.length === 0) return 0;
  const allow = new Set(actionTypes.map((item) => String(item).toLowerCase()));
  const matched = rows
    .filter((row) => allow.has(String(row.action_type || "").toLowerCase()))
    .reduce((sum, row) => sum + toNumber(row.value), 0);
  if (matched > 0) return matched;
  return rows.reduce((sum, row) => sum + toNumber(row.value), 0);
}

function firstInsightRow(raw) {
  const row = Array.isArray(raw?.data) ? raw.data[0] : null;
  return row && typeof row === "object" ? row : null;
}

const META_REPORT_METRICS = {
  fb_post_likes: [
    { key: "likes", label: "貼文讚" },
    { key: "all_clicks", label: "所有點擊" },
    { key: "comments", label: "留言" },
    { key: "shares", label: "分享" },
    { key: "interactions_total", label: "總互動" },
    { key: "spend", label: "花費" },
  ],
  fb_post_engagement: [
    { key: "interactions_total", label: "總互動" },
    { key: "likes", label: "貼文讚" },
    { key: "all_clicks", label: "所有點擊" },
    { key: "comments", label: "留言" },
    { key: "shares", label: "分享" },
    { key: "spend", label: "花費" },
  ],
  fb_reach: [
    { key: "impressions", label: "曝光數" },
    { key: "reach", label: "觸及人數" },
    { key: "spend", label: "花費" },
  ],
  fb_video_views: [
    { key: "video_3s_views", label: "3 秒觀看" },
    { key: "thruplays", label: "ThruPlay" },
    { key: "all_clicks", label: "所有點擊" },
    { key: "spend", label: "花費" },
  ],
  ig_post_spread: [
    { key: "followers", label: "增粉數" },
    { key: "profile_visits", label: "個人檔案瀏覽" },
    { key: "reach", label: "觸及人數" },
    { key: "impressions", label: "曝光數" },
    { key: "spend", label: "花費" },
  ],
  ig_reels_spread: [
    { key: "followers", label: "增粉數" },
    { key: "profile_visits", label: "個人檔案瀏覽" },
    { key: "reach", label: "觸及人數" },
    { key: "impressions", label: "曝光數" },
    { key: "spend", label: "花費" },
  ],
  ig_video_views: [
    { key: "video_3s_views", label: "3 秒觀看" },
    { key: "thruplays", label: "ThruPlay" },
    { key: "all_clicks", label: "所有點擊" },
    { key: "spend", label: "花費" },
  ],
  ig_engagement: [
    { key: "interactions_total", label: "總互動" },
    { key: "likes", label: "按讚數" },
    { key: "all_clicks", label: "所有點擊" },
    { key: "comments", label: "留言" },
    { key: "shares", label: "分享" },
    { key: "spend", label: "花費" },
  ],
  ig_followers: [
    { key: "followers", label: "增粉數" },
    { key: "profile_visits", label: "個人檔案瀏覽" },
    { key: "all_clicks", label: "所有點擊" },
    { key: "spend", label: "花費" },
  ],
};
const META_PRIMARY_METRIC = {
  fb_post_likes: "likes",
  fb_post_engagement: "interactions_total",
  fb_reach: "reach",
  fb_video_views: "video_3s_views",
  ig_post_spread: "followers",
  ig_reels_spread: "followers",
  ig_video_views: "video_3s_views",
  ig_engagement: "interactions_total",
  ig_followers: "followers",
};

function extractAdMetricValues(row) {
  const likes = sumAcrossActionTypes(row?.actions, ["post_reaction", "like", "post_like", "ig_like"]);
  const allClicks = toNumber(row?.clicks);
  const comments = sumAcrossActionTypes(row?.actions, ["comment", "post_comment", "ig_comment"]);
  const shares = sumAcrossActionTypes(row?.actions, ["post_share", "share", "ig_share"]);
  const followers = sumAcrossActionTypes(row?.actions, [
    "follow",
    "ig_follow",
    "instagram_follow",
    "omni_follow",
    "onsite_conversion.follow",
    "profile_follow",
  ]);
  const profileVisits = sumAcrossActionTypes(row?.actions, [
    "profile_visit",
    "ig_profile_visit",
    "instagram_profile_visit",
    "onsite_conversion.profile_visit",
  ]);
  const video3s = sumActions(row?.video_3_sec_watched_actions, ["video_view"]);
  const thruplays = Math.max(
    sumActions(row?.video_thruplay_watched_actions, ["video_view"]),
    sumAcrossActionTypes(row?.actions, ["thruplay", "video_view"]),
  );

  return {
    likes,
    all_clicks: allClicks,
    comments,
    shares,
    interactions_total: likes + allClicks + comments + shares,
    impressions: toNumber(row?.impressions),
    reach: toNumber(row?.reach),
    video_3s_views: video3s,
    thruplays,
    followers,
    profile_visits: profileVisits,
    spend: toNumber(row?.spend),
  };
}

function buildMetaPerformance(goal, values, raw) {
  const metrics = META_REPORT_METRICS[goal] || [];
  return {
    updatedAt: new Date().toISOString(),
    metrics: metrics.map((metric) => ({
      key: metric.key,
      label: metric.label,
      value: values?.[metric.key] ?? 0,
    })),
    raw,
  };
}

function getGoalPrimaryMetricKey(goal) {
  return META_PRIMARY_METRIC[goal] || "reach";
}

function mapMetaOrderStatus(statusText) {
  const text = String(statusText || "").toUpperCase();
  if (text.includes("PAUSED")) return "paused";
  if (text.includes("ACTIVE")) return "running";
  if (text.includes("DELETED") || text.includes("ARCHIVED")) return "completed";
  return "submitted";
}

async function fetchMetaAdSnapshotSecure(metaSecrets, adId, goal) {
  const token = getMetaToken(metaSecrets, "ads");
  if (!token) {
    return { ok: false, detail: "Meta access token is unavailable" };
  }
  try {
    const statusRaw = await graphApiGet(
      metaSecrets.apiVersion,
      token,
      `/${encodeURIComponent(adId)}`,
      { fields: "id,name,status,effective_status,updated_time" },
    );
    const statusText = String(statusRaw.effective_status || statusRaw.status || "UNKNOWN");
    const insightsRaw = await graphApiGet(
      metaSecrets.apiVersion,
      token,
      `/${encodeURIComponent(adId)}/insights`,
      { fields: "impressions,reach,clicks,spend,actions,video_3_sec_watched_actions,video_thruplay_watched_actions" },
    );
    const row = firstInsightRow(insightsRaw) || {};
    return {
      ok: true,
      statusText,
      performance: buildMetaPerformance(goal, extractAdMetricValues(row), insightsRaw),
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "讀取投放狀態失敗",
    };
  }
}

async function updateMetaAdDeliverySecure(metaSecrets, adId, status) {
  const token = getMetaToken(metaSecrets, "ads");
  if (!token) {
    return { ok: false, detail: "Meta access token is unavailable" };
  }
  try {
    await graphApiPost(metaSecrets.apiVersion, token, `/${encodeURIComponent(adId)}`, { status });
    const raw = await graphApiGet(
      metaSecrets.apiVersion,
      token,
      `/${encodeURIComponent(adId)}`,
      { fields: "id,name,status,effective_status,updated_time" },
    );
    return {
      ok: true,
      statusText: String(raw.effective_status || raw.status || status),
      raw,
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "更新投放狀態失敗",
    };
  }
}

function findPageFromList(pages, targetPageId, targetPageName) {
  return (Array.isArray(pages) ? pages : []).find((item) =>
    (targetPageId && String(item?.id || "") === targetPageId) ||
    (targetPageName && String(item?.name || "") === targetPageName),
  ) || null;
}

function buildFacebookPostIdCandidates({
  normalizedPostId,
  targetPageId,
  trackingPageId,
  preferredPageId,
  pages,
}) {
  const postId = String(normalizedPostId || "").trim();
  if (!postId) return [];
  if (postId.includes("_")) return [postId];

  const pageIds = uniqueStrings([
    targetPageId,
    trackingPageId,
    preferredPageId,
    ...(Array.isArray(pages) ? pages.map((row) => String(row?.id || "").trim()) : []),
  ]).filter((row) => /^\d+$/.test(row));

  const composed = pageIds.slice(0, 12).map((pageId) => `${pageId}_${postId}`);
  return uniqueStrings([...composed, postId]);
}

async function fetchFirstInsightMetricValue({
  metaSecrets,
  postId,
  tokens,
  metricCandidates,
}) {
  let lastError = "";
  for (const metric of metricCandidates) {
    for (const token of tokens) {
      try {
        const insight = await graphApiGet(
          metaSecrets.apiVersion,
          token,
          `/${encodeURIComponent(postId)}/insights`,
          { metric },
        );
        return {
          ok: true,
          metric,
          value: readFirstInsightValue(insight),
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : "unknown error";
      }
    }
  }

  return {
    ok: false,
    detail: lastError || "unknown error",
  };
}

async function fetchMetaPostMetricsCoreSecure({ postId, platform, pageId, pageName, sourceUrl }) {
  const metaSecrets = loadMetaSecrets();
  if (!metaSecrets) {
    return { ok: false, detail: "Meta local credentials are not configured" };
  }

  const postRef = String(postId || "").trim();
  if (!postRef) {
    return { ok: false, detail: "缂哄皯璨兼枃 ID" };
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
    return { ok: false, detail: "缂哄皯璨兼枃 ID" };
  }

  const targetPageId =
    String(pageId || "").trim() ||
    String(trackingRef?.pageId || "").trim() ||
    derivePageIdFromPostId(normalizedPostId) ||
    metaSecrets.preferredPageId;
  const targetPageName = String(pageName || "").trim() || String(trackingRef?.pageName || "").trim() || metaSecrets.preferredPageName;
  let pages = Array.isArray(metaPagesCache?.pages) ? metaPagesCache.pages : [];
  if (targetPageId || targetPageName || !normalizedPostId.includes("_")) {
    try {
      pages = await listAvailablePages(metaSecrets);
    } catch {
      // keep cached pages only
    }
  }
  let page = findPageFromList(pages, targetPageId, targetPageName);
  const postIdCandidates = buildFacebookPostIdCandidates({
    normalizedPostId,
    targetPageId,
    trackingPageId: trackingRef?.pageId,
    preferredPageId: metaSecrets.preferredPageId,
    pages,
  });

  let base = null;
  let resolvedPostId = "";
  let baseToken = "";
  let lastBaseError = "";
  for (const candidatePostId of postIdCandidates) {
    const candidatePageId = derivePageIdFromPostId(candidatePostId) || targetPageId;
    const candidatePage = candidatePageId
      ? (Array.isArray(pages) ? pages.find((item) => String(item?.id || "") === candidatePageId) : null)
      : null;
    const tokenCandidates = uniqueStrings([
      String(candidatePage?.access_token || ""),
      String(page?.access_token || ""),
      getMetaToken(metaSecrets, "facebook"),
    ]);

    for (const token of tokenCandidates) {
      try {
        base = await graphApiGet(
          metaSecrets.apiVersion,
          token,
          `/${encodeURIComponent(candidatePostId)}`,
          { fields: "id,created_time,permalink_url,shares,comments.summary(true),reactions.summary(true),attachments{media_type}" },
        );
        resolvedPostId = candidatePostId;
        baseToken = token;
        page = candidatePage || page;
        break;
      } catch (error) {
        lastBaseError = error instanceof Error ? error.message : "Facebook post fetch failed";
      }
    }
    if (base && baseToken) break;
  }
  if (!base || !baseToken) {
    return { ok: false, detail: lastBaseError || "Facebook post not found" };
  }

  const pageLabel = String(page?.name || targetPageName || targetPageId || "");

  const metricMap = {
    impressions: ["post_impressions", "post_impressions_paid", "post_impressions_organic"],
    reach: ["post_impressions_unique"],
    all_clicks: ["post_clicks"],
    likes: ["post_reactions_like_total"],
    video_3s_views: ["post_video_views", "post_video_views_paid", "post_video_views_organic"],
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

  const metricTokens = uniqueStrings([
    String(page?.access_token || ""),
    baseToken,
    getMetaToken(metaSecrets, "facebook"),
  ]);
  const postIdForMetrics = resolvedPostId || normalizedPostId;
  for (const [key, metricCandidates] of Object.entries(metricMap)) {
    const result = await fetchFirstInsightMetricValue({
      metaSecrets,
      postId: postIdForMetrics,
      tokens: metricTokens,
      metricCandidates,
    });
    if (result.ok) {
      values[key] = result.value;
      if (key === "video_3s_views") values.thruplays = result.value;
      validMetrics.push(result.metric);
    } else {
      invalidMetrics.push({
        metric: metricCandidates[0],
        detail: result.detail,
      });
    }
  }

  if (values.impressions <= 0 && values.reach > 0) {
    values.impressions = values.reach;
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
      resolvedPostId: postIdForMetrics,
      tracking: trackingRef,
      validMetrics,
      invalidMetrics,
    },
  };
}

async function fetchMetaPostMetricsSecure(args) {
  const cacheKey = buildMetaPostMetricCacheKey(args);
  const cached = readMetaPostMetricCache(cacheKey);
  if (cached) {
    return {
      ...cached,
      raw: {
        ...(cached.raw || {}),
        cacheHit: true,
      },
    };
  }

  const backoff = readMetaPostMetricBackoff(cacheKey);
  if (backoff) {
    const seconds = Math.max(1, Math.ceil((Number(backoff.until || 0) - Date.now()) / 1000));
    return {
      ok: false,
      detail: `Meta API 鎸囨璁€鍙栨毇鏅傜瘈娴佷腑锛岃珛 ${seconds} 绉掑緦鍐嶈│`,
    };
  }

  const inflight = metaPostMetricsInflight.get(cacheKey);
  if (inflight) return inflight;

  const runner = (async () => {
    const lastAt = Number(metaPostMetricsLastAttemptAt.get(cacheKey) || 0);
    const waitMs = Math.max(0, META_POST_METRIC_MIN_GAP_MS - (Date.now() - lastAt));
    if (waitMs > 0) await sleep(waitMs);

    metaPostMetricsLastAttemptAt.set(cacheKey, Date.now());
    let result;
    try {
      result = await fetchMetaPostMetricsCoreSecure(args);
    } catch (error) {
      result = {
        ok: false,
        detail: error instanceof Error ? error.message : "Meta post metric fetch failed",
      };
    }
    if (result?.ok) {
      writeMetaPostMetricCache(cacheKey, result);
      metaPostMetricsBackoff.delete(cacheKey);
    } else if (isRateLimitLikeError(result?.detail)) {
      writeMetaPostMetricBackoff(cacheKey, result?.detail);
    }
    return result;
  })().finally(() => {
    metaPostMetricsInflight.delete(cacheKey);
  });

  metaPostMetricsInflight.set(cacheKey, runner);
  return runner;
}

async function resolveMetaPostSecure({ url, platform, pageId, pageName }) {
  const metaSecrets = loadMetaSecrets();
  if (!metaSecrets) {
    return { ok: false, detail: "Meta local credentials are not configured" };
  }

  const sourceUrl = String(url || "").trim();
  if (!sourceUrl) {
    return { ok: false, detail: "Missing url" };
  }

  const trackingRef = await resolveTrackingFromUrl(metaSecrets, sourceUrl);
  if (!trackingRef) {
    return { ok: false, detail: "The supplied URL could not be resolved into a usable Meta post reference" };
  }

  const effectivePlatform = platform === "instagram" || platform === "facebook"
    ? platform
    : trackingRef.platform;
  const effectivePageId = String(pageId || trackingRef.pageId || "").trim();
  const effectivePageName = String(pageName || trackingRef.pageName || "").trim();
  let preview = null;

  try {
    if (trackingRef.platform === "instagram") {
      const media = await fetchInstagramMediaMetricsByIdSecure(metaSecrets, trackingRef);
      if (media?.ok && media?.raw?.base) {
        const base = media.raw.base;
        preview = {
          id: String(base.id || trackingRef.refId || ""),
          createdTime: String(base.timestamp || ""),
          message: String(base.caption || ""),
          permalink: String(base.permalink || trackingRef.sourceUrl || ""),
        };
      }
    } else {
      const fbPreview = await fetchMetaPostMetricsSecure({
        postId: trackingRef.refId,
        platform: "facebook",
        pageId: effectivePageId || trackingRef.pageId,
        pageName: effectivePageName || trackingRef.pageName,
        sourceUrl: trackingRef.sourceUrl || url,
      });
      if (fbPreview?.ok && fbPreview?.raw?.base) {
        const base = fbPreview.raw.base;
        preview = {
          id: String(base.id || trackingRef.refId || ""),
          createdTime: String(base.created_time || ""),
          message: String(base.message || ""),
          permalink: String(base.permalink_url || trackingRef.sourceUrl || ""),
        };
      }
    }
  } catch {
    preview = null;
  }

  return {
    ok: true,
    trackingRef: {
      ...trackingRef,
      platform: effectivePlatform,
      pageId: effectivePageId || trackingRef.pageId,
      pageName: effectivePageName || trackingRef.pageName,
    },
    existingPostId: trackingRef.refId,
    preview,
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

function maskToken(token) {
  const text = String(token || "").trim();
  if (!text) return "";
  if (text.length <= 12) return "********";
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function defaultMetaSettings() {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    apiVersion: "v20.0",
    adAccountId: "",
    pageId: "",
    pageName: "",
    instagramActorId: "",
    optimization: {
      enabled: true,
      autoStopCheckMinutes: 5,
      maxRowsPerRun: META_SYNC_MAX_ROWS_PER_RUN,
      rowGapMs: META_SYNC_ROW_GAP_MS,
      minSpendForDecision: 150,
      minResultForDecision: 20,
      losingRatioThreshold: 0.72,
    },
    industries: [],
  };
}

function readMetaSettings() {
  const stored = readSharedJson(META_SETTINGS_KEY);
  const base = defaultMetaSettings();
  if (!stored || typeof stored !== "object") return base;
  return {
    ...base,
    ...stored,
    apiVersion: String(stored.apiVersion || base.apiVersion),
    adAccountId: String(stored.adAccountId || "").replace(/^act_/i, ""),
    pageId: String(stored.pageId || ""),
    pageName: String(stored.pageName || ""),
    instagramActorId: String(stored.instagramActorId || ""),
    optimization: { ...base.optimization, ...(stored.optimization || {}) },
    industries: Array.isArray(stored.industries) ? stored.industries : [],
  };
}

function publicMetaSettings() {
  const settings = readMetaSettings();
  const secrets = loadMetaSecrets();
  return {
    ...settings,
    tokenStatus: {
      user: !!String(secrets?.userAccessToken || "").trim(),
      ads: !!String(secrets?.adsAccessToken || secrets?.userAccessToken || "").trim(),
      facebook: !!String(secrets?.facebookAccessToken || secrets?.userAccessToken || "").trim(),
      instagram: !!String(secrets?.instagramAccessToken || secrets?.userAccessToken || "").trim(),
    },
    tokenPreview: {
      user: maskToken(secrets?.userAccessToken || ""),
      ads: maskToken(secrets?.adsAccessToken || ""),
      facebook: maskToken(secrets?.facebookAccessToken || ""),
      instagram: maskToken(secrets?.instagramAccessToken || ""),
    },
    tokenSource: {
      ads: String(secrets?.adsAccessToken || "").trim() ? "specific" : (String(secrets?.userAccessToken || "").trim() ? "user" : ""),
      facebook: String(secrets?.facebookAccessToken || "").trim() ? "specific" : (String(secrets?.userAccessToken || "").trim() ? "user" : ""),
      instagram: String(secrets?.instagramAccessToken || "").trim() ? "specific" : (String(secrets?.userAccessToken || "").trim() ? "user" : ""),
    },
  };
}

function saveMetaSecretsPatch(patch) {
  const current = existsSync(META_SECRET_PATH) ? (loadMetaSecrets() || {}) : {};
  const next = {
    apiVersion: String(patch.apiVersion || current.apiVersion || "v20.0"),
    userAccessToken: String(current.userAccessToken || ""),
    adsAccessToken: String(current.adsAccessToken || ""),
    facebookAccessToken: String(current.facebookAccessToken || ""),
    instagramAccessToken: String(current.instagramAccessToken || ""),
    preferredPageId: String(patch.pageId || current.preferredPageId || ""),
    preferredPageName: String(patch.pageName || current.preferredPageName || ""),
  };
  for (const key of ["userAccessToken", "adsAccessToken", "facebookAccessToken", "instagramAccessToken"]) {
    if (typeof patch[key] === "string" && patch[key].trim()) {
      next[key] = patch[key].trim();
    }
  }
  mkdirSync(dirname(META_SECRET_PATH), { recursive: true });
  writeFileSync(META_SECRET_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
  metaPagesCache = null;
  instagramAccountsCache = null;
}

async function verifyMetaToken({ scope, token, apiVersion }) {
  const resolvedToken = String(token || "").trim();
  if (!resolvedToken) return { ok: false, error: "請先輸入 API Key" };
  const version = String(apiVersion || "v20.0");
  try {
    if (scope === "user") {
      const me = await graphApiGet(version, resolvedToken, "/me", { fields: "id,name" });
      const adaccounts = await graphApiGet(version, resolvedToken, "/me/adaccounts", { fields: "id,name,account_id,account_status", limit: 3 });
      const pages = await graphApiGet(version, resolvedToken, "/me/accounts", { fields: "id,name", limit: 3 });
      return {
        ok: true,
        sample: {
          me,
          adAccounts: Array.isArray(adaccounts.data) ? adaccounts.data : [],
          pages: Array.isArray(pages.data) ? pages.data : [],
        },
      };
    }
    if (scope === "ads") {
      const raw = await graphApiGet(version, resolvedToken, "/me/adaccounts", { fields: "id,account_id,name,account_status" });
      return { ok: true, sample: Array.isArray(raw.data) ? raw.data.slice(0, 5) : [] };
    }
    if (scope === "facebook") {
      const raw = await graphApiGet(version, resolvedToken, "/me/accounts", { fields: "id,name,instagram_business_account{id,username}" });
      return { ok: true, sample: Array.isArray(raw.data) ? raw.data.slice(0, 5) : [] };
    }
    const raw = await graphApiGet(version, resolvedToken, "/me", { fields: "id,name" });
    return { ok: true, sample: raw };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Meta API 椹楄瓑澶辨晽" };
  }
}

function normalizeAudienceQuery(value) {
  return String(value || "")
    .replace(/^#+\s*/, "")
    .replace(/^(加強|偏向|鎖定|包含|希望|想要|受眾|TA)\s*/i, "")
    .trim();
}

function extractAudienceSearchQueries(input, max = 16) {
  const out = [];
  const add = (raw) => {
    const value = normalizeAudienceQuery(raw);
    if (!value) return;
    if (/^\d+(\s*[|,]\s*.+)?$/.test(value)) return;
    if (/^(排除|不要|不含|避開|exclude|without)\b/i.test(value)) return;
    if (value.length < 2 || value.length > 80) return;
    if (!out.some((item) => item.toLowerCase() === value.toLowerCase())) out.push(value);
  };

  String(input?.detailedTargetingText || "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      if (line.startsWith("##")) return;
      if (line.startsWith("#")) add(line);
    });

  String(input?.audienceRequestNote || "")
    .split(/[\n,，、;；。]/g)
    .forEach(add);

  return out.slice(0, max);
}

function normalizeInterestObject(row, fallbackQuery = "") {
  if (!row || typeof row !== "object") return null;
  const id = String(row.id || "").trim();
  const name = String(row.name || row.title || fallbackQuery || "").trim();
  if (!/^\d+$/.test(id) || !name) return null;
  return { id, name };
}

async function searchMetaInterest({ metaSecrets, apiVersion, query }) {
  const token = getMetaToken(metaSecrets, "ads");
  const q = normalizeAudienceQuery(query);
  if (!token || !q) return null;

  const cacheKey = `${apiVersion}:${q.toLowerCase()}`;
  if (metaInterestSearchCache.has(cacheKey)) return metaInterestSearchCache.get(cacheKey);

  try {
    const raw = await graphApiGet(apiVersion, token, "/search", {
      type: "adinterest",
      q,
      limit: 5,
    });
    const rows = Array.isArray(raw?.data) ? raw.data : [];
    const best = rows.map((row) => normalizeInterestObject(row, q)).find(Boolean) || null;
    metaInterestSearchCache.set(cacheKey, best);
    return best;
  } catch {
    metaInterestSearchCache.set(cacheKey, null);
    return null;
  }
}

async function resolveMetaAudienceInterestsForInput({ metaSecrets, apiVersion, input }) {
  const existing = Array.isArray(input?.interestObjects)
    ? input.interestObjects.map((row) => normalizeInterestObject(row)).filter(Boolean)
    : [];
  const seen = new Set(existing.map((row) => row.id));
  const resolved = [...existing];
  const queries = extractAudienceSearchQueries(input);

  for (const query of queries) {
    const found = await searchMetaInterest({ metaSecrets, apiVersion, query });
    if (found?.id && !seen.has(found.id)) {
      seen.add(found.id);
      resolved.push(found);
    }
    await delay(120);
  }

  return { interests: resolved, queries, addedCount: resolved.length - existing.length };
}

function metaObjectiveFromInput(input) {
  const value = String(input?.campaignObjective || "OUTCOME_ENGAGEMENT");
  return [
    "OUTCOME_AWARENESS",
    "OUTCOME_TRAFFIC",
    "OUTCOME_ENGAGEMENT",
    "OUTCOME_LEADS",
    "OUTCOME_APP_PROMOTION",
    "OUTCOME_SALES",
  ].includes(value) ? value : "OUTCOME_ENGAGEMENT";
}

function metaOptimizationGoalFromInput(input) {
  const value = String(input?.optimizationGoal || "POST_ENGAGEMENT");
  return value || "POST_ENGAGEMENT";
}

function buildMetaTargeting(input, settings, variantIndex) {
  const countries = Array.isArray(input?.countries) && input.countries.length ? input.countries : ["TW"];
  const facebookPositions = Array.isArray(input?.manualPlacements?.facebook) ? input.manualPlacements.facebook.filter(Boolean) : [];
  const instagramPositions = Array.isArray(input?.manualPlacements?.instagram) ? input.manualPlacements.instagram.filter(Boolean) : [];
  const publisherPlatforms = [];
  if (facebookPositions.length) publisherPlatforms.push("facebook");
  if (instagramPositions.length) publisherPlatforms.push("instagram");
  const targeting = {
    geo_locations: { countries },
    age_min: Number(input?.ageMin || 18),
    age_max: Number(input?.ageMax || 49),
    publisher_platforms: publisherPlatforms.length ? publisherPlatforms : ["facebook", "instagram"],
    device_platforms: ["mobile", "desktop"],
  };
  if (facebookPositions.length) targeting.facebook_positions = facebookPositions;
  if (instagramPositions.length) targeting.instagram_positions = instagramPositions;
  if (Array.isArray(input?.genders) && input.genders.length) targeting.genders = input.genders;
  if (Array.isArray(input?.customAudienceIds) && input.customAudienceIds.length) {
    targeting.custom_audiences = input.customAudienceIds.map((id) => ({ id: String(id) }));
  }
  if (Array.isArray(input?.excludedAudienceIds) && input.excludedAudienceIds.length) {
    targeting.excluded_custom_audiences = input.excludedAudienceIds.map((id) => ({ id: String(id) }));
  }
  if (variantIndex === 0 && Array.isArray(input?.interestObjects) && input.interestObjects.length) {
    targeting.flexible_spec = [{ interests: input.interestObjects }];
  }
  return targeting;
}

function buildPromotedObject(input, settings) {
  const out = {};
  const pageId = String(settings.pageId || input?.pageId || "").trim();
  const instagramActorId = String(settings.instagramActorId || input?.instagramActorId || "").trim();
  if (pageId) out.page_id = pageId;
  if (instagramActorId) out.instagram_actor_id = instagramActorId;
  if (input?.pixelId) out.pixel_id = String(input.pixelId);
  if (input?.conversionEvent) out.custom_event_type = String(input.conversionEvent);
  if (input?.appId) out.application_id = String(input.appId);
  if (input?.appStoreUrl) out.object_store_url = String(input.appStoreUrl);
  return out;
}

async function createMetaOrderSecure(input) {
  const settings = readMetaSettings();
  const metaSecrets = loadMetaSecrets();
  const token = getMetaToken(metaSecrets, "ads");
  const apiVersion = settings.apiVersion || metaSecrets?.apiVersion || "v20.0";
  const adAccountId = String(input?.adAccountId || settings.adAccountId || "").replace(/^act_/i, "");
  if (!token) return { ok: false, error: "尚未設定 Meta Ads API Key" };
  if (!adAccountId) return { ok: false, error: "尚未設定預設廣告帳號" };
  if (!String(input?.postUrl || "").trim()) return { ok: false, error: "請先填入並驗證貼文連結" };

  const mode = input?.deliveryMode === "optimized" ? "optimized" : "direct";
  const objective = metaObjectiveFromInput(input);
  const optimizationGoal = metaOptimizationGoalFromInput(input);
  const dailyBudget = Math.max(1, Number(input?.dailyBudget || 0));
  const campaignName = String(input?.campaignName || input?.title || "Meta 投放任務").trim();
  const goal = String(input?.goal || "fb_post_engagement");
  const nowIso = new Date().toISOString();
  const trackingRef = normalizeTrackingRef(input?.trackingRef) ||
    (String(input?.postUrl || "").trim()
      ? await resolveTrackingFromUrl(metaSecrets, String(input.postUrl)).catch(() => null)
      : null);

  const requestLogs = [];
  const audienceResolution = await resolveMetaAudienceInterestsForInput({ metaSecrets, apiVersion, input });
  const enrichedInput = {
    ...input,
    interestObjects: audienceResolution.interests,
  };
  requestLogs.push({
    step: "audience_search",
    ok: true,
    detail: `resolved ${audienceResolution.addedCount} interest(s) from ${audienceResolution.queries.length} query seed(s)`,
  });

  const campaign = await graphApiPost(apiVersion, token, `/act_${adAccountId}/campaigns`, {
    name: campaignName,
    buying_type: "AUCTION",
    objective,
    special_ad_categories: [],
    status: "PAUSED",
  });
  requestLogs.push({ step: "campaign", ok: true, detail: String(campaign.id || "") });

  const variantCount = mode === "optimized" ? 2 : 1;
  const variants = [];
  const totalBudgetCents = Math.round(dailyBudget * 100);
  const variantBudgetCents = Math.max(100, Math.floor(totalBudgetCents / variantCount));
  const promotedObject = buildPromotedObject(input, settings);
  const pageId = String(settings.pageId || input?.pageId || trackingRef?.pageId || "").trim();
  const instagramActorId = String(settings.instagramActorId || input?.instagramActorId || "").trim();
  const postRef = String(input?.existingPostId || trackingRef?.refId || "").trim();

  for (let index = 0; index < variantCount; index += 1) {
    const suffix = variantCount > 1 ? (index === 0 ? "模板受眾" : "廣泛受眾") : "直投";
    const adset = await graphApiPost(apiVersion, token, `/act_${adAccountId}/adsets`, {
      name: `${String(input?.adsetName || campaignName).trim()} - ${suffix}`,
      campaign_id: campaign.id,
      daily_budget: String(variantBudgetCents),
      billing_event: "IMPRESSIONS",
      optimization_goal: optimizationGoal,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      start_time: input?.startTime || nowIso,
      end_time: input?.endTime || undefined,
      targeting: buildMetaTargeting(enrichedInput, settings, index),
      promoted_object: Object.keys(promotedObject).length ? promotedObject : undefined,
      status: "PAUSED",
    });
    requestLogs.push({ step: `adset_${index + 1}`, ok: true, detail: String(adset.id || "") });

    const creativePayload = { name: `${String(input?.adName || campaignName).trim()} - ${suffix}` };
    if (String(trackingRef?.platform || input?.platform || "").toLowerCase() === "instagram") {
      creativePayload.source_instagram_media_id = postRef;
    } else if (pageId && postRef) {
      creativePayload.object_story_id = postRef.includes("_") ? postRef : `${pageId}_${postRef}`;
    } else if (pageId) {
      creativePayload.object_story_spec = {
        page_id: pageId,
        instagram_actor_id: instagramActorId || undefined,
        link_data: {
          message: input?.message || "",
          link: input?.destinationUrl || input?.postUrl,
          call_to_action: { type: input?.ctaType || "LEARN_MORE", value: { link: input?.destinationUrl || input?.postUrl } },
        },
      };
    }

    const creative = await graphApiPost(apiVersion, token, `/act_${adAccountId}/adcreatives`, creativePayload);
    requestLogs.push({ step: `creative_${index + 1}`, ok: true, detail: String(creative.id || "") });

    const ad = await graphApiPost(apiVersion, token, `/act_${adAccountId}/ads`, {
      name: `${String(input?.adName || campaignName).trim()} - ${suffix}`,
      adset_id: adset.id,
      creative: { creative_id: creative.id },
      status: "PAUSED",
    });
    requestLogs.push({ step: `ad_${index + 1}`, ok: true, detail: String(ad.id || "") });

    variants.push({
      id: `${Date.now()}_${index}`,
      label: suffix,
      campaignId: String(campaign.id || ""),
      adsetId: String(adset.id || ""),
      creativeId: String(creative.id || ""),
      adId: String(ad.id || ""),
      budget: variantBudgetCents / 100,
      status: "submitted",
      performance: null,
      proxyRoas: null,
    });
  }

  const submitResult = {
    campaignId: String(campaign.id || ""),
    adsetId: variants[0]?.adsetId,
    creativeId: variants[0]?.creativeId,
    adId: variants[0]?.adId,
    variants,
    requestLogs,
  };

  const order = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: nowIso,
    applicant: String(input?.applicant || ""),
    title: String(input?.title || campaignName),
    accountId: adAccountId,
    accountLabel: String(input?.accountLabel || settings.accountLabel || adAccountId),
    industryKey: String(input?.industryKey || ""),
    industryLabel: String(input?.industryLabel || ""),
    campaignName,
    adsetName: String(input?.adsetName || campaignName),
    adName: String(input?.adName || campaignName),
    campaignObjective: objective,
    performanceGoalCode: String(input?.performanceGoalCode || ""),
    performanceGoalLabel: String(input?.performanceGoalLabel || ""),
    goal,
    deliveryMode: mode,
    landingUrl: String(input?.postUrl || input?.destinationUrl || ""),
    destinationUrl: String(input?.destinationUrl || ""),
    message: String(input?.message || ""),
    ctaType: String(input?.ctaType || "LEARN_MORE"),
    useExistingPost: true,
    existingPostId: postRef,
    existingPostSource: String(input?.postUrl || ""),
    dailyBudget,
    startTime: input?.startTime || nowIso,
    endTime: input?.endTime || "",
    countries: Array.isArray(input?.countries) ? input.countries : ["TW"],
    ageMin: Number(input?.ageMin || 18),
    ageMax: Number(input?.ageMax || 49),
    genders: Array.isArray(input?.genders) ? input.genders : [],
    manualPlacements: input?.manualPlacements || { facebook: [], instagram: [] },
    detailedTargetingText: String(input?.detailedTargetingText || ""),
    audienceRequestNote: String(input?.audienceRequestNote || ""),
    resolvedInterestObjects: audienceResolution.interests,
    audienceSearchQueries: audienceResolution.queries,
    trackingPostId: postRef,
    trackingRef,
    targetMetricKey: input?.targetMetricKey || "",
    targetValue: Number(input?.targetValue || 0) || undefined,
    autoStopByTarget: !!input?.autoStopByTarget,
    mode: "live",
    status: "submitted",
    apiStatusText: "PAUSED",
    error: "",
    payloads: {},
    submitResult,
  };

  const rows = readSharedJson(META_ORDERS_KEY);
  writeSharedJson(META_ORDERS_KEY, [...(Array.isArray(rows) ? rows : []), order], "server-meta-submit");
  return { ok: true, order };
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
  if (vendor === "smmraja" || vendor === "hdz") return { key: "order", value: joined };
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
    return (
      status.includes("partial") ||
      status.includes("fail") ||
      status.includes("error") ||
      status.includes("cancel") ||
      status.includes("refund") ||
      !!split?.error
    );
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
  return s.includes("partial") || s.includes("fail") || s.includes("error") || s.includes("cancel") || s.includes("refund");
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

async function syncSharedMetaOrders(options = {}) {
  const includePaused = !!options.includePaused;
  const manual = !!options.manual;
  const force = !!options.force;
  const metaSecrets = loadMetaSecrets();
  const settings = readMetaSettings();
  const optimization = settings.optimization || {};
  const minSpendForDecision = Number(optimization.minSpendForDecision ?? 150);
  const minResultForDecision = Number(optimization.minResultForDecision ?? 20);
  const losingRatioThreshold = Number(optimization.losingRatioThreshold ?? 0.72);
  const rows = readSharedJson(META_ORDERS_KEY);
  const nextRows = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
  const nowIso = new Date().toISOString();
  const nowTs = Date.now();

  if (!metaSecrets) {
    writeSharedJson(
      META_SYNC_STATUS_KEY,
      {
        ok: false,
        lastRunAt: nowIso,
        syncedCount: 0,
        updatedCount: 0,
        pausedCount: 0,
        error: "尚未設定 Meta 後端憑證",
      },
      "server-meta-sync",
    );
    return { syncedCount: 0, updatedCount: 0, pausedCount: 0, skipped: true, error: "尚未設定 Meta 後端憑證" };
  }

  let syncedCount = 0;
  let updatedCount = 0;
  let pausedCount = 0;
  const eligibleIndexes = [];

  const getVariants = (row) => {
    const variants = Array.isArray(row?.submitResult?.variants) ? row.submitResult.variants : [];
    if (variants.length > 0) {
      return variants
        .map((variant, variantIndex) => ({
          ...variant,
          id: variant.id || `variant_${variantIndex + 1}`,
          label: variant.label || `變體 ${variantIndex + 1}`,
          adId: String(variant.adId || "").trim(),
        }))
        .filter((variant) => variant.adId);
    }
    const adId = String(row?.submitResult?.adId || "").trim();
    return adId ? [{ id: "single", label: "主廣告", adId }] : [];
  };

  for (let index = 0; index < nextRows.length; index += 1) {
    const row = nextRows[index];
    const variants = getVariants(row);
    if (variants.length === 0) continue;
    if (!(row?.status === "running" || row?.status === "submitted" || (includePaused && row?.status === "paused"))) {
      continue;
    }
    if (!manual && !force) {
      const lastCheckedAt = Date.parse(String(row?.targetLastCheckedAt || ""));
      if (Number.isFinite(lastCheckedAt) && nowTs - lastCheckedAt < META_SYNC_MIN_RECHECK_MS) {
        continue;
      }
    }
    eligibleIndexes.push(index);
  }

  const sortedIndexes = eligibleIndexes
    .sort((a, b) => {
      const left = Date.parse(String(nextRows[a]?.targetLastCheckedAt || ""));
      const right = Date.parse(String(nextRows[b]?.targetLastCheckedAt || ""));
      const leftTs = Number.isFinite(left) ? left : 0;
      const rightTs = Number.isFinite(right) ? right : 0;
      return leftTs - rightTs;
    })
    .slice(0, Math.max(1, META_SYNC_MAX_ROWS_PER_RUN));

  const mergePerformance = (goal, snapshots) => {
    const totals = new Map();
    for (const snapshot of snapshots) {
      for (const metric of snapshot?.performance?.metrics || []) {
        totals.set(metric.key, (totals.get(metric.key) || 0) + toNumber(metric.value));
      }
    }
    return buildMetaPerformance(goal, Object.fromEntries(totals), { variants: snapshots.map((snapshot) => snapshot.performance?.raw || {}) });
  };

  for (let cursor = 0; cursor < sortedIndexes.length; cursor += 1) {
    const index = sortedIndexes[cursor];
    const row = nextRows[index];
    const variants = getVariants(row);
    if (variants.length === 0) continue;

    syncedCount += 1;
    const metricKey = row.targetMetricKey || getGoalPrimaryMetricKey(row.goal);
    const targetValue = Number(row.targetValue || 0);
    const shouldAutoStop = !!row.autoStopByTarget && targetValue > 0;
    const snapshots = [];
    const errors = [];
    let rowPausedCount = 0;

    for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
      const variant = variants[variantIndex];
      const snapshot = await fetchMetaAdSnapshotSecure(metaSecrets, variant.adId, row.goal);
      if (!snapshot.ok) {
        errors.push(`${variant.label}：${snapshot.detail || "同步失敗"}`);
        snapshots.push({ ...variant, ok: false, status: "error", error: snapshot.detail || "同步失敗" });
      } else {
        const metricValue = snapshot.performance?.metrics?.find((metric) => metric.key === metricKey)?.value ?? 0;
        const spend = snapshot.performance?.metrics?.find((metric) => metric.key === "spend")?.value ?? 0;
        snapshots.push({
          ...variant,
          ok: true,
          status: mapMetaOrderStatus(snapshot.statusText),
          apiStatusText: snapshot.statusText,
          performance: snapshot.performance,
          currentValue: toNumber(metricValue),
          spend: toNumber(spend),
          score: toNumber(spend) > 0 ? toNumber(metricValue) / toNumber(spend) : 0,
          lastCheckedAt: nowIso,
        });
      }
      if (variantIndex < variants.length - 1 && META_SYNC_ROW_GAP_MS > 0) {
        await sleep(META_SYNC_ROW_GAP_MS);
      }
    }

    let targetCurrent = undefined;
    let postError = "";
    const trackingPostId = String(row.trackingPostId || row.trackingRef?.refId || "").trim();
    if (trackingPostId) {
      const postMetrics = await fetchMetaPostMetricsSecure({
        postId: trackingPostId,
        platform: row?.trackingRef?.platform,
        pageId: row?.trackingRef?.pageId,
        pageName: row?.trackingRef?.pageName,
        sourceUrl: row?.trackingRef?.sourceUrl || row?.existingPostSource || "",
      });
      if (postMetrics.ok && typeof postMetrics.values?.[metricKey] === "number") {
        targetCurrent = postMetrics.values[metricKey];
      } else if (!postMetrics.ok) {
        postError = postMetrics.detail || "";
      }
    }
    if (typeof targetCurrent !== "number") {
      targetCurrent = snapshots.reduce((sum, snapshot) => sum + toNumber(snapshot.currentValue), 0);
    }

    let targetReachedAt = row.targetReachedAt;
    let nextStatus = snapshots.some((snapshot) => snapshot.status === "running") ? "running" : "submitted";
    let nextApiStatus = snapshots.map((snapshot) => snapshot.apiStatusText || snapshot.status).filter(Boolean).join(" / ") || "UNKNOWN";

    if (shouldAutoStop && typeof targetCurrent === "number" && targetCurrent >= targetValue) {
      for (const snapshot of snapshots) {
        if (!snapshot.adId || snapshot.status === "paused") continue;
        const pauseResult = await updateMetaAdDeliverySecure(metaSecrets, snapshot.adId, "PAUSED");
        if (pauseResult.ok) {
          snapshot.status = "paused";
          snapshot.apiStatusText = pauseResult.statusText || "PAUSED";
          snapshot.pausedReason = "target_reached";
          rowPausedCount += 1;
        } else {
          errors.push(`${snapshot.label}：${pauseResult.detail || "達標停投失敗"}`);
        }
      }
      if (rowPausedCount > 0) {
        nextStatus = "paused";
        nextApiStatus = "PAUSED";
        targetReachedAt = nowIso;
        pausedCount += rowPausedCount;
      }
    } else {
      targetReachedAt = undefined;
    }

    const activeSnapshots = snapshots.filter((snapshot) => snapshot.ok && snapshot.status !== "paused");
    const shouldOptimize = row.deliveryMode === "optimized" && activeSnapshots.length >= 2 && !(shouldAutoStop && targetReachedAt);
    if (shouldOptimize) {
      const qualified = activeSnapshots.filter((snapshot) => snapshot.spend >= minSpendForDecision && snapshot.currentValue >= minResultForDecision);
      if (qualified.length >= 2) {
        const best = qualified.reduce((winner, item) => (item.score > winner.score ? item : winner), qualified[0]);
        for (const snapshot of qualified) {
          if (snapshot.adId === best.adId) continue;
          if (snapshot.score < best.score * losingRatioThreshold) {
            const pauseResult = await updateMetaAdDeliverySecure(metaSecrets, snapshot.adId, "PAUSED");
            if (pauseResult.ok) {
              snapshot.status = "paused";
              snapshot.apiStatusText = pauseResult.statusText || "PAUSED";
              snapshot.pausedReason = "ab_loser";
              snapshot.abWinnerAdId = best.adId;
              pausedCount += 1;
            } else {
              errors.push(`${snapshot.label}：${pauseResult.detail || "低效變體停用失敗"}`);
            }
          }
        }
      }
    }

    const successfulSnapshots = snapshots.filter((snapshot) => snapshot.ok);
    if (successfulSnapshots.length > 0) {
      const stillRunning = successfulSnapshots.some((snapshot) => snapshot.status === "running");
      const allPaused = successfulSnapshots.every((snapshot) => snapshot.status === "paused");
      nextStatus = allPaused ? "paused" : stillRunning ? "running" : nextStatus;
      nextApiStatus = successfulSnapshots.map((snapshot) => snapshot.apiStatusText || snapshot.status).filter(Boolean).join(" / ") || nextApiStatus;
    }

    const nextSubmitResult = {
      ...(row.submitResult || {}),
      variants: variants.length > 1 ? snapshots.map((snapshot) => ({
        id: snapshot.id,
        label: snapshot.label,
        adSetId: snapshot.adSetId,
        creativeId: snapshot.creativeId,
        adId: snapshot.adId,
        status: snapshot.status,
        apiStatusText: snapshot.apiStatusText,
        currentValue: snapshot.currentValue,
        spend: snapshot.spend,
        score: snapshot.score,
        pausedReason: snapshot.pausedReason,
        abWinnerAdId: snapshot.abWinnerAdId,
        lastCheckedAt: snapshot.lastCheckedAt,
        error: snapshot.error,
      })) : row.submitResult?.variants,
    };

    nextRows[index] = {
      ...row,
      submitResult: nextSubmitResult,
      status: nextStatus,
      apiStatusText: nextApiStatus,
      performance: successfulSnapshots.length > 0 ? mergePerformance(row.goal, successfulSnapshots) : row.performance,
      targetMetricKey: metricKey,
      targetCurrentValue: typeof targetCurrent === "number" ? targetCurrent : undefined,
      targetLastCheckedAt: nowIso,
      targetReachedAt,
      error: [postError, ...errors].filter(Boolean).join("；"),
    };
    updatedCount += 1;

    if (cursor < sortedIndexes.length - 1 && META_SYNC_ROW_GAP_MS > 0) {
      await sleep(META_SYNC_ROW_GAP_MS);
    }
  }

  writeSharedJson(META_ORDERS_KEY, nextRows, "server-meta-sync");
  writeSharedJson(
    META_SYNC_STATUS_KEY,
    {
      ok: true,
      lastRunAt: nowIso,
      syncedCount,
      updatedCount,
      pausedCount,
      deferredCount: Math.max(0, eligibleIndexes.length - sortedIndexes.length),
      error: "",
    },
    "server-meta-sync",
  );
  return {
    syncedCount,
    updatedCount,
    pausedCount,
    deferredCount: Math.max(0, eligibleIndexes.length - sortedIndexes.length),
    skipped: syncedCount === 0,
  };
}

async function processMetaOrdersInBackground() {
  if (backgroundMetaSyncRunning) return;
  backgroundMetaSyncRunning = true;
  try {
    await syncSharedMetaOrders();
  } catch (error) {
    console.error("[scheduled-meta-orders]", error);
    writeSharedJson(
      META_SYNC_STATUS_KEY,
      {
        ok: false,
        lastRunAt: new Date().toISOString(),
        syncedCount: 0,
        updatedCount: 0,
        pausedCount: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "server-meta-sync",
    );
  } finally {
    backgroundMetaSyncRunning = false;
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

    if (req.method === "GET" && req.url === "/api/meta/settings") {
      json(res, 200, { ok: true, config: publicMetaSettings() });
      return;
    }

    if (req.method === "POST" && req.url === "/api/meta/settings") {
      const raw = await readBody(req);
      const payload = JSON.parse(String(raw || "{}"));
      const current = readMetaSettings();
      const next = {
        ...current,
        apiVersion: String(payload.apiVersion || current.apiVersion || "v20.0"),
        adAccountId: String(payload.adAccountId || current.adAccountId || "").replace(/^act_/i, ""),
        pageId: String(payload.pageId || current.pageId || ""),
        pageName: String(payload.pageName || current.pageName || ""),
        instagramActorId: String(payload.instagramActorId || current.instagramActorId || ""),
        optimization: { ...current.optimization, ...(payload.optimization || {}) },
        industries: Array.isArray(payload.industries) ? payload.industries : current.industries,
        updatedAt: new Date().toISOString(),
      };
      saveMetaSecretsPatch({
        apiVersion: next.apiVersion,
        pageId: next.pageId,
        pageName: next.pageName,
        userAccessToken: payload.userAccessToken,
        adsAccessToken: payload.adsAccessToken,
        facebookAccessToken: payload.facebookAccessToken,
        instagramAccessToken: payload.instagramAccessToken,
      });
      writeSharedJson(META_SETTINGS_KEY, next, "server-meta-settings");
      json(res, 200, { ok: true, config: publicMetaSettings() });
      return;
    }

    if (req.method === "POST" && req.url === "/api/meta/verify-token") {
      const raw = await readBody(req);
      const payload = JSON.parse(String(raw || "{}"));
      const result = await verifyMetaToken({
        scope: String(payload.scope || "ads"),
        token: String(payload.token || ""),
        apiVersion: String(payload.apiVersion || readMetaSettings().apiVersion || "v20.0"),
      });
      json(res, result.ok ? 200 : 400, result);
      return;
    }

    if (req.method === "POST" && req.url === "/api/meta/resolve-audience") {
      const raw = await readBody(req);
      const payload = JSON.parse(String(raw || "{}"));
      const metaSecrets = loadMetaSecrets();
      const settings = readMetaSettings();
      const apiVersion = String(payload.apiVersion || settings.apiVersion || metaSecrets?.apiVersion || "v20.0");
      const input = {
        detailedTargetingText: String(payload.detailedTargetingText || ""),
        audienceRequestNote: String(payload.audienceRequestNote || payload.note || ""),
        interestObjects: Array.isArray(payload.interestObjects) ? payload.interestObjects : [],
      };
      const result = await resolveMetaAudienceInterestsForInput({ metaSecrets, apiVersion, input });
      json(res, 200, {
        ok: true,
        queries: result.queries,
        interests: result.interests,
        addedCount: result.addedCount,
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/meta/resolve-post") {
      const raw = await readBody(req);
      const payload = JSON.parse(String(raw || "{}"));
      const result = await resolveMetaPostSecure({
        url: payload.url || payload.postUrl || "",
        platform: payload.platform || "",
        pageId: payload.pageId || "",
        pageName: payload.pageName || "",
      });
      json(res, result.ok ? 200 : 400, result);
      return;
    }

    if (req.method === "GET" && req.url === "/api/meta/orders") {
      const rows = readSharedJson(META_ORDERS_KEY);
      json(res, 200, { ok: true, orders: Array.isArray(rows) ? rows : [] });
      return;
    }

    if (req.method === "POST" && req.url === "/api/meta/orders") {
      const raw = await readBody(req);
      const payload = JSON.parse(String(raw || "{}"));
      const result = await createMetaOrderSecure(payload);
      json(res, result.ok ? 200 : 400, result);
      return;
    }

    if (req.method === "POST" && /^\/api\/meta\/orders\/[^/]+\/(sync|pause|resume)$/.test(req.url)) {
      const [, orderId, action] = req.url.match(/^\/api\/meta\/orders\/([^/]+)\/(sync|pause|resume)$/) || [];
      const rows = readSharedJson(META_ORDERS_KEY);
      const list = Array.isArray(rows) ? rows : [];
      const row = list.find((item) => String(item?.id) === decodeURIComponent(orderId || ""));
      if (!row) {
        json(res, 404, { ok: false, error: "找不到 Meta 投放案件" });
        return;
      }
      if (action === "sync") {
        const result = await syncSharedMetaOrders({ manual: true, force: true, includePaused: true });
        json(res, result.error ? 400 : 200, { ok: !result.error, ...result });
        return;
      }
      const adIds = Array.isArray(row?.submitResult?.variants)
        ? row.submitResult.variants.map((variant) => String(variant?.adId || "")).filter(Boolean)
        : [String(row?.submitResult?.adId || "")].filter(Boolean);
      const metaSecrets = loadMetaSecrets();
      const status = action === "pause" ? "PAUSED" : "ACTIVE";
      const errors = [];
      for (const adId of adIds) {
        const result = await updateMetaAdDeliverySecure(metaSecrets, adId, status);
        if (!result.ok) errors.push(result.detail || `鏇存柊 ${adId} 澶辨晽`);
      }
      if (errors.length) {
        json(res, 400, { ok: false, error: errors.join("; ") });
        return;
      }
      const next = list.map((item) => String(item?.id) === String(row.id)
        ? { ...item, status: action === "pause" ? "paused" : "running", apiStatusText: status, error: "" }
        : item);
      writeSharedJson(META_ORDERS_KEY, next, "server-meta-delivery");
      json(res, 200, { ok: true });
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

    if (req.method === "GET" && req.url.startsWith("/api/meta/resolve-post")) {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      const result = await resolveMetaPostSecure({
        url: url.searchParams.get("url") || "",
        platform: url.searchParams.get("platform") || "",
        pageId: url.searchParams.get("pageId") || "",
        pageName: url.searchParams.get("pageName") || "",
      });
      json(res, result.ok ? 200 : 400, result);
      return;
    }

    if (req.method === "POST" && req.url === "/api/meta/sync-shared-orders") {
      const raw = await readBody(req);
      const payload = JSON.parse(String(raw || "{}"));
      const result = await syncSharedMetaOrders({
        includePaused: !!payload?.includePaused,
        manual: true,
        force: !!payload?.force,
      });
      json(res, result.error ? 400 : 200, { ok: !result.error, ...result });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/vendor/balance")) {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      const vendor = String(url.searchParams.get("vendor") || "").trim();
      if (!vendor) {
        json(res, 400, { ok: false, error: "缂哄皯 vendor 鍙冩暩" });
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
void processMetaOrdersInBackground();
setInterval(() => {
  void processScheduledOrdersInBackground();
}, 60 * 1000);
setInterval(() => {
  void processMetaOrdersInBackground();
}, META_BACKGROUND_SYNC_INTERVAL_MS);
