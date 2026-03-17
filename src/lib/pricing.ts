export type AdPlacement = string;

export type PricingRule = {
  label: string;
  minUnit: number;
  price: number;
};

export const DEFAULT_PRICING_RULES: Record<string, PricingRule> = {
  fb_like: { label: "Facebook 貼文讚", minUnit: 100, price: 200 },
  fb_reach: { label: "Facebook 觸及數", minUnit: 10_000, price: 200 },
  fb_video_views: { label: "Facebook 影片觀看", minUnit: 1_000, price: 200 },
  ig_like: { label: "Instagram 貼文讚", minUnit: 1_000, price: 300 },
  ig_reels_views: { label: "Instagram Reels 觀看", minUnit: 1_000, price: 50 },
};

export const PRICING = DEFAULT_PRICING_RULES;

export function getDefaultPricingRule(placement: AdPlacement): PricingRule {
  return DEFAULT_PRICING_RULES[placement] ?? { label: placement, minUnit: 1, price: 0 };
}

export function calcLineAmount(placement: AdPlacement, target: number): number {
  const rule = getDefaultPricingRule(placement);
  return (target / rule.minUnit) * rule.price;
}
