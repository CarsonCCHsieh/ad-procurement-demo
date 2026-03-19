export type AdPlacement = string;

export type PricingRule = {
  label: string;
  minUnit: number;
  price: number;
};

export const DEFAULT_PRICING_RULES: Record<string, PricingRule> = {
  fb_like: { label: "\u0046\u0061\u0063\u0065\u0062\u006f\u006f\u006b \u8cbc\u6587\u8b9a", minUnit: 100, price: 200 },
  fb_reach: { label: "\u0046\u0061\u0063\u0065\u0062\u006f\u006f\u006b \u89f8\u53ca\u6578", minUnit: 10_000, price: 200 },
  fb_video_views: { label: "\u0046\u0061\u0063\u0065\u0062\u006f\u006f\u006b \u5f71\u7247\u89c0\u770b", minUnit: 1_000, price: 200 },
  ig_like: { label: "\u0049\u006e\u0073\u0074\u0061\u0067\u0072\u0061\u006d \u8cbc\u6587\u8b9a", minUnit: 1_000, price: 300 },
  ig_reels_views: { label: "\u0049\u006e\u0073\u0074\u0061\u0067\u0072\u0061\u006d \u0052\u0065\u0065\u006c\u0073 \u89c0\u770b", minUnit: 1_000, price: 50 },
};

export const PRICING = DEFAULT_PRICING_RULES;

export function getDefaultPricingRule(placement: AdPlacement): PricingRule {
  return DEFAULT_PRICING_RULES[placement] ?? { label: placement, minUnit: 1, price: 0 };
}

export function calcLineAmount(placement: AdPlacement, target: number): number {
  const rule = getDefaultPricingRule(placement);
  return (target / rule.minUnit) * rule.price;
}
