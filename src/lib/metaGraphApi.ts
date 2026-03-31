import type { MetaConfigV1 } from "../config/metaConfig";
import { META_AD_GOALS, type MetaAdGoalKey, type MetaKpiMetricKey } from "./metaGoals";
import type { MetaOrderInput, MetaPerformanceSnapshot, MetaSubmitResult } from "./metaOrdersStore";
import { apiUrl } from "./apiBase";

export type MetaAdAccountOption = {
  id: string;
  label: string;
  adAccountId: string;
  pageId?: string;
  pageName?: string;
  instagramActorId?: string;
};

export type MetaExistingPostOption = {
  id: string;
  label: string;
  platform: "facebook" | "instagram";
  permalink: string;
  message?: string;
  createdTime?: string;
};

type GraphValue = string | number | boolean | Record<string, unknown> | Array<unknown> | null | undefined;

type ActionValue = {
  action_type?: string;
  value?: string | number;
};

function graphBase(cfg: MetaConfigV1): string {
  const ver = cfg.apiVersion?.trim() || "v23.0";
  return `https://graph.facebook.com/${ver}`;
}

function toFormBody(params: Record<string, unknown>, token: string): URLSearchParams {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      body.set(k, String(v));
    } else {
      body.set(k, JSON.stringify(v as GraphValue));
    }
  }
  body.set("access_token", token);
  return body;
}

async function graphPost(
  cfg: MetaConfigV1,
  token: string,
  path: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${graphBase(cfg)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: toFormBody(params, token),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || json.error) {
    const msg = (() => {
      const e = json.error as { message?: string; error_user_msg?: string } | undefined;
      return e?.error_user_msg || e?.message || `HTTP ${res.status}`;
    })();
    throw new Error(msg);
  }
  return json;
}

async function graphGet(cfg: MetaConfigV1, token: string, path: string, fields?: string): Promise<Record<string, unknown>> {
  const hasQuery = path.includes("?");
  const base = `${graphBase(cfg)}${path}`;
  const withFields = fields
    ? `${base}${hasQuery ? "&" : "?"}fields=${encodeURIComponent(fields)}`
    : base;
  const url = `${withFields}${withFields.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;

  const res = await fetch(url, { method: "GET" });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || json.error) {
    const msg = (() => {
      const e = json.error as { message?: string; error_user_msg?: string } | undefined;
      return e?.error_user_msg || e?.message || `HTTP ${res.status}`;
    })();
    throw new Error(msg);
  }
  return json;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object") return null;
  return v as Record<string, unknown>;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function asActions(v: unknown): ActionValue[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x && typeof x === "object").map((x) => x as ActionValue);
}

function sumActions(v: unknown, actionTypes: string[]): number {
  const rows = asActions(v);
  if (rows.length === 0) return 0;
  const allow = new Set(actionTypes.map((x) => x.toLowerCase()));
  const hit = rows
    .filter((r) => allow.has(String(r.action_type ?? "").toLowerCase()))
    .reduce((acc, r) => acc + toNumber(r.value), 0);
  if (hit > 0) return hit;
  return rows.reduce((acc, r) => acc + toNumber(r.value), 0);
}

function sumAcrossActionTypes(v: unknown, actionTypes: string[]): number {
  const rows = asActions(v);
  if (rows.length === 0) return 0;
  const allow = new Set(actionTypes.map((x) => x.toLowerCase()));
  return rows
    .filter((r) => allow.has(String(r.action_type ?? "").toLowerCase()))
    .reduce((acc, r) => acc + toNumber(r.value), 0);
}

function firstInsightRow(raw: Record<string, unknown>): Record<string, unknown> | null {
  const data = raw.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const row = data[0];
  if (!row || typeof row !== "object") return null;
  return row as Record<string, unknown>;
}

function readInsightValue(data: unknown, name: string): number {
  if (!Array.isArray(data)) return 0;
  const row = data.find((x) => asRecord(x)?.name === name);
  const values = asRecord(row)?.values;
  if (!Array.isArray(values) || values.length === 0) return 0;
  return toNumber(asRecord(values[0])?.value);
}

async function fetchLocalPostMetricsProxy(postRef: string): Promise<{
  ok: boolean;
  detail?: string;
  values?: Partial<Record<MetaKpiMetricKey, number>>;
  raw?: Record<string, unknown>;
} | null> {
  if (typeof window === "undefined") return null;
  if (!window.location.origin.startsWith("http")) return null;

  try {
    const url = apiUrl(`/api/meta/post-metrics?postId=${encodeURIComponent(postRef)}`);
    const res = await fetch(url, {
      method: "GET",
      headers: { "Cache-Control": "no-store" },
    });
    if (res.status === 404) return null;
    const json = (await res.json()) as {
      ok?: boolean;
      detail?: string;
      values?: Partial<Record<MetaKpiMetricKey, number>>;
      raw?: Record<string, unknown>;
    };
    return {
      ok: !!json.ok,
      detail: typeof json.detail === "string" ? json.detail : undefined,
      values: json.values,
      raw: json.raw,
    };
  } catch {
    return null;
  }
}

async function fetchLocalPostMetricsProxyByRef(params: {
  postRef: string;
  platform?: "facebook" | "instagram";
  pageId?: string;
  pageName?: string;
  sourceUrl?: string;
}): Promise<{
  ok: boolean;
  detail?: string;
  values?: Partial<Record<MetaKpiMetricKey, number>>;
  raw?: Record<string, unknown>;
} | null> {
  if (typeof window === "undefined") return null;
  if (!window.location.origin.startsWith("http")) return null;

  try {
    const qs = new URLSearchParams();
    qs.set("postId", params.postRef);
    if (params.platform) qs.set("platform", params.platform);
    if (params.pageId) qs.set("pageId", params.pageId);
    if (params.pageName) qs.set("pageName", params.pageName);
    if (params.sourceUrl) qs.set("sourceUrl", params.sourceUrl);

    const url = apiUrl(`/api/meta/post-metrics?${qs.toString()}`);
    const res = await fetch(url, {
      method: "GET",
      headers: { "Cache-Control": "no-store" },
    });
    if (res.status === 404) return null;
    const json = (await res.json()) as {
      ok?: boolean;
      detail?: string;
      values?: Partial<Record<MetaKpiMetricKey, number>>;
      raw?: Record<string, unknown>;
    };
    return {
      ok: !!json.ok,
      detail: typeof json.detail === "string" ? json.detail : undefined,
      values: json.values,
      raw: json.raw,
    };
  } catch {
    return null;
  }
}

function extractMetricValues(row: Record<string, unknown>): Record<MetaKpiMetricKey, number> {
  const likes = sumAcrossActionTypes(row.actions, ["post_reaction", "like", "post_like", "ig_like"]);
  const allClicks = toNumber(row.clicks);
  const comments = sumAcrossActionTypes(row.actions, ["comment", "post_comment", "ig_comment"]);
  const shares = sumAcrossActionTypes(row.actions, ["post_share", "share", "ig_share"]);
  const interactionsTotal = likes + allClicks + comments + shares;
  const followers = sumAcrossActionTypes(row.actions, [
    "follow",
    "ig_follow",
    "instagram_follow",
    "omni_follow",
    "onsite_conversion.follow",
    "profile_follow",
  ]);
  const profileVisits = sumAcrossActionTypes(row.actions, [
    "profile_visit",
    "ig_profile_visit",
    "instagram_profile_visit",
    "onsite_conversion.profile_visit",
  ]);

  const video3s = sumActions(row.video_3_sec_watched_actions, ["video_view"]);
  const thruplays = Math.max(
    sumActions(row.video_thruplay_watched_actions, ["video_view"]),
    sumAcrossActionTypes(row.actions, ["thruplay", "video_view"]),
  );

  return {
    likes,
    all_clicks: allClicks,
    comments,
    shares,
    interactions_total: interactionsTotal,
    impressions: toNumber(row.impressions),
    reach: toNumber(row.reach),
    video_3s_views: video3s,
    thruplays,
    followers,
    profile_visits: profileVisits,
    spend: toNumber(row.spend),
  };
}

function buildPerformance(goal: MetaAdGoalKey, values: Record<MetaKpiMetricKey, number>, raw?: Record<string, unknown>): MetaPerformanceSnapshot {
  const tpl = META_AD_GOALS[goal];
  return {
    updatedAt: new Date().toISOString(),
    metrics: tpl.reportMetrics.map((m) => ({
      key: m.key,
      label: m.label,
      value: values[m.key] ?? 0,
    })),
    raw,
  };
}

function extractArray(raw: unknown): Record<string, unknown>[] {
  return Array.isArray(raw) ? raw.filter((item) => item && typeof item === "object") as Record<string, unknown>[] : [];
}

function safeText(raw: unknown, fallback = ""): string {
  const text = String(raw ?? "").trim();
  return text || fallback;
}

function trimActPrefix(raw: string) {
  return raw.trim().replace(/^act_/i, "");
}

export async function listMetaAdAccounts(params: {
  cfg: MetaConfigV1;
}): Promise<{ ok: boolean; detail?: string; accounts?: MetaAdAccountOption[] }> {
  const { cfg } = params;
  const token = cfg.accessToken.trim();
  if (!token) {
    return { ok: false, detail: "請先填入 Meta Access Token" };
  }

  try {
    const adAccountsRaw = await graphGet(
      cfg,
      token,
      "/me/adaccounts",
      "id,account_id,name,account_status,business_name",
    );
    const pageRaw = await graphGet(cfg, token, "/me/accounts", "id,name,instagram_business_account{id,username}");

    const accounts = extractArray(adAccountsRaw.data).map((row) => {
      const accountId = safeText(row.account_id || row.id);
      return {
        id: trimActPrefix(accountId || safeText(row.id)),
        label: safeText(row.name, safeText(row.business_name, `帳號 ${trimActPrefix(accountId)}`)),
        adAccountId: trimActPrefix(accountId || safeText(row.id)),
      } satisfies MetaAdAccountOption;
    });

    const firstPage = extractArray(pageRaw.data)[0];
    const pageId = safeText(firstPage?.id);
    const pageName = safeText(firstPage?.name);
    const instagramActorId = safeText(asRecord(firstPage?.instagram_business_account)?.id);

    return {
      ok: true,
      accounts: accounts.map((account) => ({
        ...account,
        pageId,
        pageName,
        instagramActorId,
      })),
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Meta 廣告帳號讀取失敗",
    };
  }
}

export async function listMetaExistingPosts(params: {
  cfg: MetaConfigV1;
  platform: "facebook" | "instagram";
  pageId?: string;
  instagramActorId?: string;
  limit?: number;
}): Promise<{ ok: boolean; detail?: string; posts?: MetaExistingPostOption[] }> {
  const { cfg, platform } = params;
  const token = cfg.accessToken.trim();
  if (!token) {
    return { ok: false, detail: "請先填入 Meta Access Token" };
  }

  try {
    if (platform === "facebook") {
      const pageId = safeText(params.pageId || cfg.pageId);
      if (!pageId) return { ok: false, detail: "請先設定 Facebook 粉專 ID" };
      const raw = await graphGet(
        cfg,
        token,
        `/${encodeURIComponent(pageId)}/posts?limit=${Math.max(5, Math.min(50, params.limit ?? 12))}`,
        "id,message,created_time,permalink_url",
      );
      const posts = extractArray(raw.data).map((row) => ({
        id: safeText(row.id),
        label: safeText(row.message, safeText(row.id)).slice(0, 80),
        platform: "facebook" as const,
        permalink: safeText(row.permalink_url),
        createdTime: safeText(row.created_time),
        message: safeText(row.message),
      }));
      return { ok: true, posts: posts.filter((post) => !!post.id) };
    }

    const instagramActorId = safeText(params.instagramActorId || cfg.instagramActorId);
    if (!instagramActorId) return { ok: false, detail: "請先設定 Instagram Actor ID" };
    const raw = await graphGet(
      cfg,
      token,
      `/${encodeURIComponent(instagramActorId)}/media?limit=${Math.max(5, Math.min(50, params.limit ?? 12))}`,
      "id,caption,permalink,media_type,timestamp",
    );
    const posts = extractArray(raw.data).map((row) => ({
      id: safeText(row.id),
      label: safeText(row.caption, `${safeText(row.media_type)} ${safeText(row.id)}`).slice(0, 80),
      platform: "instagram" as const,
      permalink: safeText(row.permalink),
      createdTime: safeText(row.timestamp),
      message: safeText(row.caption),
    }));
    return { ok: true, posts: posts.filter((post) => !!post.id) };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "現有貼文讀取失敗",
    };
  }
}

export async function resolveMetaPostReference(params: {
  source: string;
  platform?: "facebook" | "instagram";
  pageId?: string;
  pageName?: string;
}): Promise<{
  ok: boolean;
  detail?: string;
  trackingRef?: {
    platform: "facebook" | "instagram";
    refId: string;
    sourceUrl: string;
    canonicalUrl?: string;
    pageId?: string;
    pageName?: string;
    resolver?: string;
    resolvedAt: string;
  };
  existingPostId?: string;
}> {
  const source = params.source.trim();
  if (!source) return { ok: false, detail: "請輸入貼文連結或貼文 ID" };

  if (!/^https?:\/\//i.test(source)) {
    return {
      ok: true,
      existingPostId: source,
      trackingRef: {
        platform: params.platform === "instagram" ? "instagram" : "facebook",
        refId: source,
        sourceUrl: source,
        pageId: params.pageId,
        pageName: params.pageName,
        resolver: "manual_input",
        resolvedAt: new Date().toISOString(),
      },
    };
  }

  try {
    const qs = new URLSearchParams();
    qs.set("url", source);
    if (params.platform) qs.set("platform", params.platform);
    if (params.pageId) qs.set("pageId", params.pageId);
    if (params.pageName) qs.set("pageName", params.pageName);
    const res = await fetch(apiUrl(`/api/meta/resolve-post?${qs.toString()}`), {
      method: "GET",
      headers: { "Cache-Control": "no-store" },
    });
    const json = (await res.json()) as {
      ok?: boolean;
      detail?: string;
      trackingRef?: {
        platform: "facebook" | "instagram";
        refId: string;
        sourceUrl: string;
        canonicalUrl?: string;
        pageId?: string;
        pageName?: string;
        resolver?: string;
        resolvedAt: string;
      };
      existingPostId?: string;
    };
    if (!res.ok || !json.ok || !json.trackingRef) {
      return { ok: false, detail: json.detail || `HTTP ${res.status}` };
    }
    return {
      ok: true,
      detail: json.detail,
      existingPostId: json.existingPostId || json.trackingRef.refId,
      trackingRef: json.trackingRef,
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "貼文解析失敗",
    };
  }
}

export async function submitMetaOrderToGraph(params: {
  cfg: MetaConfigV1;
  input: MetaOrderInput;
  payloads: {
    campaign: Record<string, unknown>;
    adset: Record<string, unknown>;
    creative: Record<string, unknown>;
    ad: Record<string, unknown>;
  };
}): Promise<{ status: "submitted" | "failed"; result?: MetaSubmitResult; error?: string }> {
  const { cfg, payloads } = params;
  const logs: MetaSubmitResult["requestLogs"] = [];

  const token = cfg.accessToken.trim();
  const accountId = cfg.adAccountId.trim().replace(/^act_/, "");
  if (!token || !accountId) {
    return { status: "failed", error: "請先完成 Meta Access Token 與廣告帳號 ID 設定" };
  }

  try {
    const campaignResp = await graphPost(cfg, token, `/act_${accountId}/campaigns`, payloads.campaign);
    const campaignId = String(campaignResp.id ?? "");
    logs.push({ step: "campaign", ok: true, detail: `campaign_id=${campaignId}` });

    const adsetPayload = { ...payloads.adset, campaign_id: campaignId };
    const adsetResp = await graphPost(cfg, token, `/act_${accountId}/adsets`, adsetPayload);
    const adsetId = String(adsetResp.id ?? "");
    logs.push({ step: "adset", ok: true, detail: `adset_id=${adsetId}` });

    const creativeResp = await graphPost(cfg, token, `/act_${accountId}/adcreatives`, payloads.creative);
    const creativeId = String(creativeResp.id ?? "");
    logs.push({ step: "creative", ok: true, detail: `creative_id=${creativeId}` });

    const adPayload = { ...payloads.ad, adset_id: adsetId, creative: { creative_id: creativeId } };
    const adResp = await graphPost(cfg, token, `/act_${accountId}/ads`, adPayload);
    const adId = String(adResp.id ?? "");
    logs.push({ step: "ad", ok: true, detail: `ad_id=${adId}` });

    return {
      status: "submitted",
      result: { campaignId, adsetId, creativeId, adId, requestLogs: logs },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Meta API 發生未知錯誤";
    logs.push({ step: "submit", ok: false, detail: msg });
    return { status: "failed", error: msg, result: { requestLogs: logs } };
  }
}

export async function fetchMetaAdSnapshot(params: {
  cfg: MetaConfigV1;
  adId: string;
  goal: MetaAdGoalKey;
}): Promise<{ ok: boolean; statusText?: string; detail?: string; performance?: MetaPerformanceSnapshot }> {
  const { cfg, adId, goal } = params;
  const token = cfg.accessToken.trim();
  if (!token) {
    return { ok: false, detail: "請先在控制設定填入 Meta Access Token" };
  }

  try {
    const statusRaw = await graphGet(cfg, token, `/${encodeURIComponent(adId)}`, "id,name,status,effective_status,updated_time");
    const statusText = String(statusRaw.effective_status ?? statusRaw.status ?? "UNKNOWN");

    const insightsRaw = await graphGet(
      cfg,
      token,
      `/${encodeURIComponent(adId)}/insights`,
      "impressions,reach,clicks,spend,actions,video_3_sec_watched_actions,video_thruplay_watched_actions",
    );
    const row = firstInsightRow(insightsRaw) ?? {};
    const perf = buildPerformance(goal, extractMetricValues(row), insightsRaw);

    return { ok: true, statusText, performance: perf };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "讀取投放狀態失敗";
    return { ok: false, detail: msg };
  }
}

export async function fetchMetaAdStatus(params: {
  cfg: MetaConfigV1;
  adId: string;
}): Promise<{ ok: boolean; statusText?: string; detail?: string; raw?: Record<string, unknown> }> {
  const { cfg, adId } = params;
  const token = cfg.accessToken.trim();
  if (!token) {
    return { ok: false, detail: "請先在控制設定填入 Meta Access Token" };
  }

  try {
    const raw = await graphGet(cfg, token, `/${encodeURIComponent(adId)}`, "id,name,status,effective_status,updated_time");
    const statusText = String(raw.effective_status ?? raw.status ?? "UNKNOWN");
    return { ok: true, statusText, raw };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "讀取投放狀態失敗";
    return { ok: false, detail: msg };
  }
}

export async function fetchMetaPostMetrics(params: {
  cfg: MetaConfigV1;
  postId: string;
  platform?: "facebook" | "instagram";
  pageId?: string;
  pageName?: string;
  sourceUrl?: string;
}): Promise<{
  ok: boolean;
  detail?: string;
  values?: Partial<Record<MetaKpiMetricKey, number>>;
  raw?: Record<string, unknown>;
}> {
  const { cfg } = params;
  const token = cfg.accessToken.trim();
  const postRef = params.postId.trim();
  const postId = postRef.replace(/^https?:\/\/[^/]+\//i, "");
  const proxied = await fetchLocalPostMetricsProxyByRef({
    postRef,
    platform: params.platform,
    pageId: params.pageId,
    pageName: params.pageName,
    sourceUrl: params.sourceUrl,
  });
  if (proxied?.ok) {
    return proxied;
  }
  if (!token) {
    return proxied ?? { ok: false, detail: "請先在控制設定填入 Meta Access Token" };
  }
  if (!postId) {
    return { ok: false, detail: "缺少貼文 ID" };
  }

  if (params.platform === "instagram") {
    try {
      const base = await graphGet(
        cfg,
        token,
        `/${encodeURIComponent(postId)}`,
        "id,media_type,permalink,like_count,comments_count,timestamp",
      );

      const likes = toNumber(base.like_count);
      const comments = toNumber(base.comments_count);
      const values: Partial<Record<MetaKpiMetricKey, number>> = {
        likes,
        comments,
        shares: 0,
        all_clicks: 0,
        interactions_total: likes + comments,
      };

      for (const metric of ["impressions", "reach", "video_views"] as const) {
        try {
          const insightRaw = await graphGet(
            cfg,
            token,
            `/${encodeURIComponent(postId)}/insights?metric=${metric}`,
          );
          const data = Array.isArray(insightRaw.data) ? insightRaw.data : [];
          const value = readInsightValue(data, metric);
          if (metric === "impressions") values.impressions = value;
          if (metric === "reach") values.reach = value;
          if (metric === "video_views") {
            values.video_3s_views = value;
            values.thruplays = value;
          }
        } catch {
          // Keep remaining metrics even if one IG insight metric is unavailable.
        }
      }

      return {
        ok: true,
        values,
        raw: {
          base,
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Instagram metrics fetch failed";
      return { ok: false, detail: msg };
    }
  }

  try {
    const base = await graphGet(
      cfg,
      token,
      `/${encodeURIComponent(postId)}`,
      "id,shares,reactions.summary(true),comments.summary(true)",
    );

    let insightData: unknown[] = [];
    try {
      const insightRaw = await graphGet(
        cfg,
        token,
        `/${encodeURIComponent(postId)}/insights?metric=post_impressions,post_impressions_unique,post_video_views,post_clicks`,
      );
      insightData = Array.isArray(insightRaw.data) ? insightRaw.data : [];
    } catch {
      insightData = [];
    }

    const shares = toNumber(asRecord(base.shares)?.count);
    const likes = toNumber(asRecord(asRecord(base.reactions)?.summary)?.total_count);
    const comments = toNumber(asRecord(asRecord(base.comments)?.summary)?.total_count);
    const allClicks = readInsightValue(insightData, "post_clicks");
    const impressions = readInsightValue(insightData, "post_impressions");
    const reach = readInsightValue(insightData, "post_impressions_unique");
    const videoViews = readInsightValue(insightData, "post_video_views");

    const values: Partial<Record<MetaKpiMetricKey, number>> = {
      likes,
      comments,
      shares,
      all_clicks: allClicks,
      interactions_total: likes + comments + shares + allClicks,
      impressions,
      reach,
      video_3s_views: videoViews,
      thruplays: videoViews,
    };

    return {
      ok: true,
      values,
      raw: {
        base,
        insights: insightData,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "讀取貼文指標失敗";
    return { ok: false, detail: msg };
  }
}

export async function updateMetaAdDelivery(params: {
  cfg: MetaConfigV1;
  adId: string;
  status: "PAUSED" | "ACTIVE";
}): Promise<{ ok: boolean; statusText?: string; detail?: string; raw?: Record<string, unknown> }> {
  const { cfg, adId, status } = params;
  const token = cfg.accessToken.trim();
  if (!token) {
    return { ok: false, detail: "請先在控制設定填入 Meta Access Token" };
  }

  try {
    await graphPost(cfg, token, `/${encodeURIComponent(adId)}`, { status });
    const raw = await graphGet(cfg, token, `/${encodeURIComponent(adId)}`, "id,name,status,effective_status,updated_time");
    const statusText = String(raw.effective_status ?? raw.status ?? status);
    return { ok: true, statusText, raw };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "更新投放狀態失敗";
    return { ok: false, detail: msg };
  }
}

