import { DEFAULT_PRICING_RULES, type AdPlacement } from "../lib/pricing";
import { queueSharedWrite } from "../lib/sharedSync";

export type VendorKey = "smmraja" | "urpanel" | "justanotherpanel";

export type VendorConfig = {
  key: VendorKey;
  label: string;
  apiBaseUrl: string;
  enabled: boolean;
};

export type SupplierConfig = {
  vendor: VendorKey;
  serviceId: number;
  weight: number;
  maxPerOrder?: number;
  enabled: boolean;
};

export type PlacementConfig = {
  placement: AdPlacement;
  label: string;
  enabled: boolean;
  splitStrategy?: "random" | "weighted";
  suppliers: SupplierConfig[];
};

export type AppConfigV1 = {
  version: 1;
  vendors: VendorConfig[];
  placements: PlacementConfig[];
  updatedAt: string;
};

const STORAGE_KEY = "ad_demo_config_v1";

function isoNow() {
  return new Date().toISOString();
}

function defaultPlacements(): PlacementConfig[] {
  return [
    {
      placement: "fb_like",
      label: DEFAULT_PRICING_RULES.fb_like.label,
      enabled: true,
      splitStrategy: "random",
      suppliers: [
        { vendor: "smmraja", serviceId: 0, weight: 1, maxPerOrder: 1000, enabled: true },
        { vendor: "urpanel", serviceId: 0, weight: 1, maxPerOrder: 1000, enabled: true },
        { vendor: "justanotherpanel", serviceId: 0, weight: 1, maxPerOrder: 1000, enabled: true },
      ],
    },
    {
      placement: "fb_reach",
      label: DEFAULT_PRICING_RULES.fb_reach.label,
      enabled: true,
      splitStrategy: "random",
      suppliers: [
        { vendor: "smmraja", serviceId: 0, weight: 1, enabled: true },
        { vendor: "urpanel", serviceId: 0, weight: 1, enabled: true },
      ],
    },
    {
      placement: "fb_video_views",
      label: DEFAULT_PRICING_RULES.fb_video_views.label,
      enabled: true,
      splitStrategy: "random",
      suppliers: [
        { vendor: "smmraja", serviceId: 0, weight: 1, enabled: true },
        { vendor: "urpanel", serviceId: 0, weight: 1, enabled: true },
      ],
    },
    {
      placement: "ig_like",
      label: DEFAULT_PRICING_RULES.ig_like.label,
      enabled: true,
      splitStrategy: "random",
      suppliers: [
        { vendor: "smmraja", serviceId: 0, weight: 1, enabled: true },
        { vendor: "urpanel", serviceId: 1, weight: 1, enabled: false },
      ],
    },
    {
      placement: "ig_reels_views",
      label: DEFAULT_PRICING_RULES.ig_reels_views.label,
      enabled: true,
      splitStrategy: "random",
      suppliers: [
        { vendor: "smmraja", serviceId: 0, weight: 1, enabled: true },
        { vendor: "justanotherpanel", serviceId: 0, weight: 1, enabled: true },
      ],
    },
  ];
}

export const DEFAULT_CONFIG: AppConfigV1 = {
  version: 1,
  vendors: [
    { key: "smmraja", label: "SMM Raja", apiBaseUrl: "https://www.smmraja.com/api/v3", enabled: true },
    { key: "urpanel", label: "Urpanel", apiBaseUrl: "https://urpanel.com/api/v2", enabled: true },
    { key: "justanotherpanel", label: "JustAnotherPanel", apiBaseUrl: "https://justanotherpanel.com/api/v2", enabled: true },
  ],
  placements: defaultPlacements(),
  updatedAt: isoNow(),
};

function isVendorKey(value: unknown): value is VendorKey {
  return value === "smmraja" || value === "urpanel" || value === "justanotherpanel";
}

function normalizePlacementLabel(placement: string, label: unknown) {
  if (typeof label === "string" && label.trim()) return label.trim();
  return DEFAULT_PRICING_RULES[placement]?.label ?? placement;
}

function normalizeConfig(raw: unknown): AppConfigV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<AppConfigV1>;
  if (data.version !== 1) return null;
  if (!Array.isArray(data.vendors) || !Array.isArray(data.placements)) return null;

  const vendors: VendorConfig[] = data.vendors.flatMap((vendor) => {
    if (!vendor || typeof vendor !== "object") return [];
    const item = vendor as Partial<VendorConfig>;
    if (!isVendorKey(item.key)) return [];
    if (typeof item.label !== "string") return [];
    if (typeof item.apiBaseUrl !== "string") return [];
    return [{ key: item.key, label: item.label, apiBaseUrl: item.apiBaseUrl, enabled: item.enabled !== false }];
  });

  const placementsByKey = new Map<string, PlacementConfig>();
  for (const placement of data.placements) {
    if (!placement || typeof placement !== "object") continue;
    const item = placement as Partial<PlacementConfig>;
    const placementKey = String(item.placement ?? "").trim();
    if (!placementKey) continue;
    if (!Array.isArray(item.suppliers)) continue;

    const splitStrategy =
      item.splitStrategy === "random" || item.splitStrategy === "weighted" ? item.splitStrategy : undefined;

    const suppliers: SupplierConfig[] = item.suppliers.flatMap((supplier) => {
      if (!supplier || typeof supplier !== "object") return [];
      const entry = supplier as Partial<SupplierConfig>;
      if (!isVendorKey(entry.vendor)) return [];

      const serviceId = Number(entry.serviceId);
      const weight = Number(entry.weight ?? 1);
      const maxPerOrder = entry.maxPerOrder == null ? undefined : Number(entry.maxPerOrder);

      if (!Number.isFinite(serviceId) || serviceId < 0) return [];
      if (!Number.isFinite(weight) || weight < 0) return [];
      if (maxPerOrder != null && (!Number.isFinite(maxPerOrder) || maxPerOrder <= 0)) return [];

      return [
        {
          vendor: entry.vendor,
          serviceId,
          weight,
          maxPerOrder,
          enabled: entry.enabled !== false,
        },
      ];
    });

    placementsByKey.set(placementKey, {
      placement: placementKey,
      label: normalizePlacementLabel(placementKey, item.label),
      enabled: item.enabled !== false,
      splitStrategy,
      suppliers,
    });
  }

  if (placementsByKey.size === 0) {
    for (const placement of defaultPlacements()) placementsByKey.set(placement.placement, placement);
  }

  return {
    version: 1,
    vendors: vendors.length > 0 ? vendors : DEFAULT_CONFIG.vendors,
    placements: Array.from(placementsByKey.values()),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : isoNow(),
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
    queueSharedWrite(STORAGE_KEY);
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
    if (!normalized) return { ok: false, message: "設定檔格式不正確" };
    saveConfig(normalized);
    return { ok: true };
  } catch {
    return { ok: false, message: "JSON 解析失敗" };
  }
}

export function getVendorLabel(vendor: VendorKey): string {
  return getConfig().vendors.find((item) => item.key === vendor)?.label ?? vendor;
}

export function getPlacementConfig(placement: AdPlacement): PlacementConfig {
  const config = getConfig();
  const found = config.placements.find((item) => item.placement === placement);
  if (found) return found;

  const fallback = DEFAULT_PRICING_RULES[placement];
  return {
    placement,
    label: fallback?.label ?? placement,
    enabled: fallback != null,
    splitStrategy: "random",
    suppliers: [],
  };
}

export function getPlacementLabel(placement: AdPlacement): string {
  return getPlacementConfig(placement).label;
}

export function getEnabledPlacements(): PlacementConfig[] {
  return getConfig().placements.filter((item) => item.enabled);
}
