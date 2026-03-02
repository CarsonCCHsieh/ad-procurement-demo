import type { MetaConfigV1 } from "../config/metaConfig";
import { META_AD_GOALS, type MetaAdGoalKey, type MetaKpiMetricKey } from "./metaGoals";
import type { MetaOrderInput, MetaPerformanceSnapshot, MetaSubmitResult } from "./metaOrdersStore";

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
  const url = fields
    ? `${graphBase(cfg)}${path}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`
    : `${graphBase(cfg)}${path}?access_token=${encodeURIComponent(token)}`;
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
  return v
    .filter((x) => x && typeof x === "object")
    .map((x) => x as ActionValue);
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

function simulateMetricValues(): Record<MetaKpiMetricKey, number> {
  const impressions = 4000 + Math.floor(Math.random() * 8000);
  const reach = Math.floor(impressions * (0.42 + Math.random() * 0.35));
  const likes = 80 + Math.floor(Math.random() * 320);
  const allClicks = 120 + Math.floor(Math.random() * 600);
  const comments = 10 + Math.floor(Math.random() * 90);
  const shares = 8 + Math.floor(Math.random() * 80);
  const followers = 5 + Math.floor(Math.random() * 40);
  const profileVisits = 40 + Math.floor(Math.random() * 200);
  const video3s = 120 + Math.floor(Math.random() * 1200);
  const thruplays = Math.max(0, video3s - Math.floor(Math.random() * 180));
  const spend = 150 + Math.floor(Math.random() * 3000);
  return {
    likes,
    all_clicks: allClicks,
    comments,
    shares,
    interactions_total: likes + allClicks + comments + shares,
    impressions,
    reach,
    video_3s_views: video3s,
    thruplays,
    followers,
    profile_visits: profileVisits,
    spend,
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

function mockId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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
  const simulate = cfg.mode === "simulate" || !token || !accountId;

  if (simulate) {
    const result: MetaSubmitResult = {
      campaignId: mockId("cmp"),
      adsetId: mockId("set"),
      creativeId: mockId("cr"),
      adId: mockId("ad"),
      requestLogs: [
        { step: "campaign", ok: true, detail: "模擬模式：已建立 campaign" },
        { step: "adset", ok: true, detail: "模擬模式：已建立 adset" },
        { step: "creative", ok: true, detail: "模擬模式：已建立 creative" },
        { step: "ad", ok: true, detail: "模擬模式：已建立 ad" },
      ],
    };
    return { status: "submitted", result };
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
  const simulate = cfg.mode === "simulate" || !token;
  if (simulate) {
    return {
      ok: true,
      statusText: "PAUSED",
      detail: "模擬模式：未呼叫 Meta API",
      performance: buildPerformance(goal, simulateMetricValues(), { mode: "simulate" }),
    };
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
    const msg = e instanceof Error ? e.message : "讀取狀態失敗";
    return { ok: false, detail: msg };
  }
}

export async function fetchMetaAdStatus(params: {
  cfg: MetaConfigV1;
  adId: string;
}): Promise<{ ok: boolean; statusText?: string; detail?: string; raw?: Record<string, unknown> }> {
  const { cfg, adId } = params;
  const token = cfg.accessToken.trim();
  const simulate = cfg.mode === "simulate" || !token;
  if (simulate) {
    return { ok: true, statusText: "PAUSED", detail: "模擬模式：未呼叫 Meta API" };
  }

  try {
    const raw = await graphGet(cfg, token, `/${encodeURIComponent(adId)}`, "id,name,status,effective_status,updated_time");
    const statusText = String(raw.effective_status ?? raw.status ?? "UNKNOWN");
    return { ok: true, statusText, raw };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "讀取狀態失敗";
    return { ok: false, detail: msg };
  }
}

