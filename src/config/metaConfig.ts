import { queueSharedWrite } from "../lib/sharedSync";

export type MetaRuntimeMode = "live";

export type MetaConfigV1 = {
  version: 1;
  updatedAt: string; // ISO
  apiVersion: string; // e.g. v23.0
  mode: MetaRuntimeMode;
  adsAccessToken: string;
  facebookAccessToken: string;
  instagramAccessToken: string;
  accessToken: string; // legacy fallback
  adAccountId: string; // without act_ prefix
  pageId: string;
  instagramActorId: string;
  currency: "TWD"; // fixed per requirement
  timezone: string; // Asia/Taipei
};

const STORAGE_KEY = "ad_demo_meta_config_v1";

function isoNow() {
  return new Date().toISOString();
}

export const DEFAULT_META_CONFIG: MetaConfigV1 = {
  version: 1,
  updatedAt: isoNow(),
  apiVersion: "v23.0",
  mode: "live",
  adsAccessToken: "",
  facebookAccessToken: "",
  instagramAccessToken: "",
  accessToken: "",
  adAccountId: "",
  pageId: "",
  instagramActorId: "",
  currency: "TWD",
  timezone: "Asia/Taipei",
};

function normalize(raw: unknown): MetaConfigV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<MetaConfigV1>;
  if (r.version !== 1) return null;
  if (typeof r.apiVersion !== "string") return null;
  return {
    version: 1,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : isoNow(),
    apiVersion: r.apiVersion.trim() || "v23.0",
    mode: "live",
    adsAccessToken: typeof r.adsAccessToken === "string" ? r.adsAccessToken.trim() : "",
    facebookAccessToken: typeof r.facebookAccessToken === "string" ? r.facebookAccessToken.trim() : "",
    instagramAccessToken: typeof r.instagramAccessToken === "string" ? r.instagramAccessToken.trim() : "",
    accessToken: typeof r.accessToken === "string" ? r.accessToken.trim() : "",
    adAccountId: typeof r.adAccountId === "string" ? r.adAccountId.trim() : "",
    pageId: typeof r.pageId === "string" ? r.pageId.trim() : "",
    instagramActorId: typeof r.instagramActorId === "string" ? r.instagramActorId.trim() : "",
    currency: "TWD",
    timezone: typeof r.timezone === "string" && r.timezone.trim() ? r.timezone.trim() : "Asia/Taipei",
  };
}

export function getMetaConfig(): MetaConfigV1 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_META_CONFIG;
    const parsed = JSON.parse(raw);
    return normalize(parsed) ?? DEFAULT_META_CONFIG;
  } catch {
    return DEFAULT_META_CONFIG;
  }
}

export function saveMetaConfig(next: MetaConfigV1) {
  try {
    const normalized = normalize(next) ?? DEFAULT_META_CONFIG;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...normalized, updatedAt: isoNow() }));
    queueSharedWrite(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function patchMetaConfig(patch: Partial<MetaConfigV1>) {
  const current = getMetaConfig();
  const next = { ...current, ...patch };
  saveMetaConfig(next);
}

export function resetMetaConfig() {
  saveMetaConfig(DEFAULT_META_CONFIG);
}

export function pickMetaAccessToken(
  cfg: MetaConfigV1,
  scope: "ads" | "facebook" | "instagram" | "any" = "any",
): string {
  const ads = String(cfg.adsAccessToken || "").trim();
  const fb = String(cfg.facebookAccessToken || "").trim();
  const ig = String(cfg.instagramAccessToken || "").trim();
  const legacy = String(cfg.accessToken || "").trim();

  if (scope === "ads") return ads || fb || ig || legacy;
  if (scope === "facebook") return fb || ads || legacy || ig;
  if (scope === "instagram") return ig || ads || legacy || fb;
  return ads || fb || ig || legacy;
}

