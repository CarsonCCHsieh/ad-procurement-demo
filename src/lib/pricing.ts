export type AdPlacement =
  | "fb_like"
  | "fb_reach"
  | "fb_video_views"
  | "ig_like"
  | "ig_reels_views";

export type PricingRule = {
  label: string;
  minUnit: number;
  price: number; // price per minUnit
};

// NOTE: Pricing is intentionally hardcoded for demo (vendor pricing is still being negotiated).
export const PRICING: Record<AdPlacement, PricingRule> = {
  fb_like: { label: "Facebook 貼文讚", minUnit: 100, price: 200 },
  fb_reach: { label: "Facebook 觸及數", minUnit: 10_000, price: 200 },
  fb_video_views: { label: "Facebook 影片觀看", minUnit: 1_000, price: 200 },
  ig_like: { label: "Instagram 貼文讚", minUnit: 1_000, price: 300 },
  ig_reels_views: { label: "Instagram Reels 觀看", minUnit: 1_000, price: 50 },
};

export function calcLineAmount(placement: AdPlacement, target: number): number {
  const rule = PRICING[placement];
  return (target / rule.minUnit) * rule.price;
}

