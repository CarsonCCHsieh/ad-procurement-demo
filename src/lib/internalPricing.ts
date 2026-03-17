import type { AdPlacement } from "./pricing";
import { getPlacementMinUnit, getPlacementPrice, getPricingConfig } from "../config/pricingConfig";

export function calcInternalLineAmount(placement: AdPlacement, target: number): number {
  const pricePerMinUnit = getPlacementPrice(placement);
  const minUnit = getPlacementMinUnit(placement);
  return (target / minUnit) * pricePerMinUnit;
}

export function shouldShowPrices(): boolean {
  return getPricingConfig().showPrices;
}
