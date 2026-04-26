import { apiUrl } from "../lib/apiBase";
import { queueSharedWrite } from "../lib/sharedSync";

export type MetaRuntimeMode = "live";

export type MetaConfigV1 = {
  version: 1;
  updatedAt: string;
  mode: MetaRuntimeMode;
  apiVersion: string;
  adAccountId: string;
  pageId: string;
  pageName: string;
  instagramActorId: string;
  accessToken: string;
  adsAccessToken: string;
  facebookAccessToken: string;
  instagramAccessToken: string;
  tokenStatus?: {
    ads?: boolean;
    facebook?: boolean;
    instagram?: boolean;
  };
};

const STORAGE_KEY = "ad_demo_meta_config_v1";

export const DEFAULT_META_CONFIG: MetaConfigV1 = {
  version: 1,
  updatedAt: new Date().toISOString(),
  mode: "live",
  apiVersion: "v20.0",
  adAccountId: "",
  pageId: "",
  pageName: "",
  instagramActorId: "",
  accessToken: "",
  adsAccessToken: "",
  facebookAccessToken: "",
  instagramAccessToken: "",
};

function normalize(raw: unknown): MetaConfigV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<MetaConfigV1>;
  return {
    ...DEFAULT_META_CONFIG,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString(),
    apiVersion: typeof row.apiVersion === "string" && row.apiVersion.trim() ? row.apiVersion.trim() : "v20.0",
    adAccountId: String(row.adAccountId || "").replace(/^act_/i, ""),
    pageId: String(row.pageId || ""),
    pageName: String(row.pageName || ""),
    instagramActorId: String(row.instagramActorId || ""),
    // Tokens are intentionally not persisted in browser storage. Backend secrets are the source of truth.
    accessToken: "",
    adsAccessToken: "",
    facebookAccessToken: "",
    instagramAccessToken: "",
    tokenStatus: row.tokenStatus,
  };
}

export function getMetaConfig(): MetaConfigV1 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalize(raw ? JSON.parse(raw) : null) ?? DEFAULT_META_CONFIG;
  } catch {
    return DEFAULT_META_CONFIG;
  }
}

export function saveMetaConfig(next: MetaConfigV1) {
  const normalized = normalize(next) ?? DEFAULT_META_CONFIG;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...normalized, updatedAt: new Date().toISOString() }));
    queueSharedWrite(STORAGE_KEY);
  } catch {
    // ignore cache write failures
  }
}

export function patchMetaConfig(patch: Partial<MetaConfigV1>) {
  saveMetaConfig({ ...getMetaConfig(), ...patch });
}

export function resetMetaConfig() {
  saveMetaConfig(DEFAULT_META_CONFIG);
}

export function pickMetaAccessToken(_cfg: MetaConfigV1, _scope: "ads" | "facebook" | "instagram" | "any" = "any") {
  return "";
}

export async function fetchMetaConfigFromServer(): Promise<MetaConfigV1> {
  const res = await fetch(apiUrl("/api/meta/settings"), { headers: { "Cache-Control": "no-store" } });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  const cfg = normalize(json.config) ?? DEFAULT_META_CONFIG;
  saveMetaConfig(cfg);
  return cfg;
}

export async function saveMetaConfigToServer(input: MetaConfigV1 & {
  adsAccessToken?: string;
  facebookAccessToken?: string;
  instagramAccessToken?: string;
}) {
  const res = await fetch(apiUrl("/api/meta/settings"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  const cfg = normalize(json.config) ?? DEFAULT_META_CONFIG;
  saveMetaConfig(cfg);
  return cfg;
}
