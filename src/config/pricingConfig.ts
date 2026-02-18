import type { AdPlacement } from "../lib/pricing";
import { PRICING } from "../lib/pricing";

export type PricingConfigV1 = {
  version: 1;
  updatedAt: string; // ISO
  // When false, the order form hides price fields (still calculates internally).
  showPrices: boolean;
  // Internal pricing shown to staff (NTD) per PRICING[placement].minUnit.
  // (This is separate from vendor panel "rate".)
  prices: Partial<Record<AdPlacement, number>>;
};

const STORAGE_KEY = "ad_demo_pricing_v1";

function isoNow() {
  return new Date().toISOString();
}

export const DEFAULT_PRICING_CONFIG: PricingConfigV1 = {
  version: 1,
  updatedAt: isoNow(),
  showPrices: true,
  prices: Object.fromEntries(Object.entries(PRICING).map(([k, v]) => [k, v.price])) as Record<AdPlacement, number>,
};

function normalize(raw: unknown): PricingConfigV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<PricingConfigV1>;
  if (r.version !== 1) return null;
  const prices: Partial<Record<AdPlacement, number>> = {};
  const p = r.prices ?? {};
  for (const key of Object.keys(PRICING) as AdPlacement[]) {
    const n = Number((p as Record<string, unknown>)[key]);
    if (Number.isFinite(n) && n >= 0) prices[key] = n;
  }
  return {
    version: 1,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : isoNow(),
    showPrices: r.showPrices !== false,
    prices,
  };
}

export function getPricingConfig(): PricingConfigV1 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRICING_CONFIG;
    const parsed = JSON.parse(raw);
    return normalize(parsed) ?? DEFAULT_PRICING_CONFIG;
  } catch {
    return DEFAULT_PRICING_CONFIG;
  }
}

export function savePricingConfig(next: PricingConfigV1) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, updatedAt: isoNow() }));
  } catch {
    // ignore
  }
}

export function setShowPrices(showPrices: boolean) {
  const cfg = getPricingConfig();
  savePricingConfig({ ...cfg, showPrices: !!showPrices });
}

export function setPlacementPrice(placement: AdPlacement, pricePerMinUnit: number) {
  const cfg = getPricingConfig();
  const n = Number(pricePerMinUnit);
  if (!Number.isFinite(n) || n < 0) return;
  savePricingConfig({ ...cfg, prices: { ...cfg.prices, [placement]: n } });
}

export function getPlacementPrice(placement: AdPlacement): number {
  const cfg = getPricingConfig();
  const n = cfg.prices[placement];
  if (typeof n === "number" && Number.isFinite(n) && n >= 0) return n;
  return PRICING[placement].price;
}

