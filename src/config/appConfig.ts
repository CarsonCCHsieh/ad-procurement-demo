import type { AdPlacement } from "../lib/pricing";

export type VendorKey = "smmraja" | "urpanel" | "justanotherpanel";

export type VendorConfig = {
  key: VendorKey;
  label: string;
  apiBaseUrl: string;
  enabled: boolean;
};

export type SupplierConfig = {
  vendor: VendorKey;
  // Vendor service ID (these panels identify each service by an integer ID).
  serviceId: number;
  // Weight for splitting quantity across suppliers (higher = more share).
  weight: number;
  // Optional cap so one vendor doesn't take too much volume.
  maxPerOrder?: number;
  enabled: boolean;
};

export type PlacementConfig = {
  placement: AdPlacement;
  suppliers: SupplierConfig[];
};

export type AppConfigV1 = {
  version: 1;
  vendors: VendorConfig[];
  placements: PlacementConfig[];
  updatedAt: string; // ISO
};

const STORAGE_KEY = "ad_demo_config_v1";

function isoNow() {
  return new Date().toISOString();
}

export const DEFAULT_CONFIG: AppConfigV1 = {
  version: 1,
  vendors: [
    { key: "smmraja", label: "SMM Raja", apiBaseUrl: "https://www.smmraja.com/api/v3", enabled: true },
    { key: "urpanel", label: "Urpanel", apiBaseUrl: "https://urpanel.com/api/v2", enabled: true },
    {
      key: "justanotherpanel",
      label: "JustAnotherPanel",
      apiBaseUrl: "https://justanotherpanel.com/api/v2",
      enabled: true,
    },
  ],
  placements: [
    {
      placement: "fb_like",
      suppliers: [
        { vendor: "smmraja", serviceId: 0, weight: 1, maxPerOrder: 1000, enabled: true },
        { vendor: "urpanel", serviceId: 0, weight: 1, maxPerOrder: 1000, enabled: true },
        { vendor: "justanotherpanel", serviceId: 0, weight: 1, maxPerOrder: 1000, enabled: true },
      ],
    },
    {
      placement: "fb_reach",
      suppliers: [
        { vendor: "smmraja", serviceId: 0, weight: 1, enabled: true },
        { vendor: "urpanel", serviceId: 0, weight: 1, enabled: true },
      ],
    },
    {
      placement: "fb_video_views",
      suppliers: [
        { vendor: "smmraja", serviceId: 0, weight: 1, enabled: true },
        { vendor: "urpanel", serviceId: 0, weight: 1, enabled: true },
      ],
    },
    {
      placement: "ig_like",
      suppliers: [
        { vendor: "smmraja", serviceId: 0, weight: 1, enabled: true },
        { vendor: "urpanel", serviceId: 1, weight: 1, enabled: false },
      ],
    },
    {
      placement: "ig_reels_views",
      suppliers: [
        { vendor: "smmraja", serviceId: 0, weight: 1, enabled: true },
        { vendor: "justanotherpanel", serviceId: 0, weight: 1, enabled: true },
      ],
    },
  ],
  updatedAt: isoNow(),
};

function isVendorKey(x: unknown): x is VendorKey {
  return x === "smmraja" || x === "urpanel" || x === "justanotherpanel";
}

function isPlacement(x: unknown): x is AdPlacement {
  return x === "fb_like" || x === "fb_reach" || x === "fb_video_views" || x === "ig_like" || x === "ig_reels_views";
}

function normalizeConfig(raw: unknown): AppConfigV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<AppConfigV1>;
  if (r.version !== 1) return null;
  if (!Array.isArray(r.vendors) || !Array.isArray(r.placements)) return null;

  const vendors: VendorConfig[] = r.vendors
    .map((v) => {
      if (!v || typeof v !== "object") return null;
      const x = v as Partial<VendorConfig>;
      if (!isVendorKey(x.key)) return null;
      if (typeof x.label !== "string") return null;
      if (typeof x.apiBaseUrl !== "string") return null;
      return { key: x.key, label: x.label, apiBaseUrl: x.apiBaseUrl, enabled: !!x.enabled };
    })
    .filter((x): x is VendorConfig => x != null);

  const placements: PlacementConfig[] = r.placements
    .map((p) => {
      if (!p || typeof p !== "object") return null;
      const x = p as Partial<PlacementConfig>;
      if (!isPlacement(x.placement)) return null;
      if (!Array.isArray(x.suppliers)) return null;
      const suppliers: SupplierConfig[] = x.suppliers
        .map((s) => {
          if (!s || typeof s !== "object") return null;
          const y = s as Partial<SupplierConfig>;
          if (!isVendorKey(y.vendor)) return null;
          const sid = Number(y.serviceId);
          const w = Number(y.weight);
          const cap = y.maxPerOrder == null ? undefined : Number(y.maxPerOrder);
          if (!Number.isFinite(sid) || sid < 0) return null;
          if (!Number.isFinite(w) || w < 0) return null;
          if (cap != null && (!Number.isFinite(cap) || cap <= 0)) return null;
          return { vendor: y.vendor, serviceId: sid, weight: w, maxPerOrder: cap, enabled: !!y.enabled };
        })
        .filter((y): y is SupplierConfig => y != null);
      return { placement: x.placement, suppliers };
    })
    .filter((x): x is PlacementConfig => x != null);

  return {
    version: 1,
    vendors,
    placements,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : isoNow(),
  };
}

export function getConfig(): AppConfigV1 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    return normalizeConfig(parsed) ?? DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(next: AppConfigV1) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, updatedAt: isoNow() }));
  } catch {
    // ignore
  }
}

export function resetConfig() {
  saveConfig(DEFAULT_CONFIG);
}

export function exportConfigJson(): string {
  return JSON.stringify(getConfig(), null, 2);
}

export function importConfigJson(json: string): { ok: boolean; message?: string } {
  try {
    const parsed = JSON.parse(json);
    const normalized = normalizeConfig(parsed);
    if (!normalized) return { ok: false, message: "JSON 格式正確但內容不符合 config schema（version/欄位缺失）" };
    saveConfig(normalized);
    return { ok: true };
  } catch {
    return { ok: false, message: "JSON 解析失敗" };
  }
}

export function getVendorLabel(vendor: VendorKey): string {
  return getConfig().vendors.find((v) => v.key === vendor)?.label ?? vendor;
}

export function getPlacementConfig(placement: AdPlacement): PlacementConfig {
  const cfg = getConfig();
  const found = cfg.placements.find((p) => p.placement === placement);
  if (found) return found;
  return { placement, suppliers: [] };
}

