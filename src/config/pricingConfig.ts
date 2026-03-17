import type { AdPlacement } from "../lib/pricing";
import { getDefaultPricingRule, PRICING } from "../lib/pricing";
import { queueSharedWrite } from "../lib/sharedSync";

export type PricingConfigV1 = {
  version: 1;
  updatedAt: string;
  showPrices: boolean;
  prices: Partial<Record<AdPlacement, number>>;
  minUnits: Partial<Record<AdPlacement, number>>;
};

const STORAGE_KEY = "ad_demo_pricing_v1";

function isoNow() {
  return new Date().toISOString();
}

export const DEFAULT_PRICING_CONFIG: PricingConfigV1 = {
  version: 1,
  updatedAt: isoNow(),
  showPrices: true,
  prices: Object.fromEntries(Object.entries(PRICING).map(([k, v]) => [k, v.price])),
  minUnits: Object.fromEntries(Object.entries(PRICING).map(([k, v]) => [k, v.minUnit])),
};

function normalize(raw: unknown): PricingConfigV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<PricingConfigV1>;
  if (r.version !== 1) return null;

  const prices: Partial<Record<AdPlacement, number>> = {};
  const minUnits: Partial<Record<AdPlacement, number>> = {};
  const rawPrices = r.prices && typeof r.prices === "object" ? r.prices : {};
  const rawMinUnits = r.minUnits && typeof r.minUnits === "object" ? r.minUnits : {};

  for (const [key, value] of Object.entries(rawPrices)) {
    const price = Number(value);
    if (Number.isFinite(price) && price >= 0) prices[key] = price;
  }

  for (const [key, value] of Object.entries(rawMinUnits)) {
    const minUnit = Number(value);
    if (Number.isFinite(minUnit) && Number.isInteger(minUnit) && minUnit > 0) minUnits[key] = minUnit;
  }

  return {
    version: 1,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : isoNow(),
    showPrices: r.showPrices !== false,
    prices,
    minUnits,
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
    queueSharedWrite(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function setPlacementPrice(placement: AdPlacement, pricePerMinUnit: number) {
  const cfg = getPricingConfig();
  const value = Number(pricePerMinUnit);
  if (!Number.isFinite(value) || value < 0) return;
  savePricingConfig({ ...cfg, prices: { ...cfg.prices, [placement]: value } });
}

export function setPlacementMinUnit(placement: AdPlacement, minUnitValue: number) {
  const cfg = getPricingConfig();
  const value = Number(minUnitValue);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return;
  savePricingConfig({ ...cfg, minUnits: { ...cfg.minUnits, [placement]: value } });
}

export function getPlacementPrice(placement: AdPlacement): number {
  const cfg = getPricingConfig();
  const value = cfg.prices[placement];
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  return getDefaultPricingRule(placement).price;
}

export function getPlacementMinUnit(placement: AdPlacement): number {
  const cfg = getPricingConfig();
  const value = cfg.minUnits[placement];
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0) return value;
  return getDefaultPricingRule(placement).minUnit;
}
