import type { MetaConfigV1 } from "../config/metaConfig";
import type { MetaOrderInput, MetaSubmitResult } from "./metaOrdersStore";

type GraphValue = string | number | boolean | Record<string, unknown> | Array<unknown> | null | undefined;

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

async function graphGet(cfg: MetaConfigV1, token: string, path: string, fields: string): Promise<Record<string, unknown>> {
  const url = `${graphBase(cfg)}${path}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
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
