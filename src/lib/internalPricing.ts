import { PRICING, type AdPlacement } from "./pricing";
import { getPlacementPrice, getPricingConfig } from "../config/pricingConfig";

export function calcInternalLineAmount(placement: AdPlacement, target: number): number {
  const rule = PRICING[placement];
  const pricePerMinUnit = getPlacementPrice(placement);
  return (target / rule.minUnit) * pricePerMinUnit;
}

export function shouldShowPrices(): boolean {
  return getPricingConfig().showPrices;
}

