import type { MetaConfigV1 } from "../config/metaConfig";
import { META_AD_GOALS, type MetaAdGoalTemplate } from "./metaGoals";
import type { MetaOrderInput } from "./metaOrdersStore";

function sanitizePostId(raw: string): string {
  return raw.trim().replace(/^https?:\/\/[^/]+\//i, "");
}

function toObjectStoryId(pageId: string, postIdRaw: string): string {
  const v = sanitizePostId(postIdRaw);
  if (v.includes("_")) return v;
  return `${pageId}_${v}`;
}

function defaultPositions(template: MetaAdGoalTemplate): {
  facebook_positions?: string[];
  instagram_positions?: string[];
} {
  if (template.platform === "facebook") {
    if (template.recommendedPlacement === "reels") return { facebook_positions: ["video_feeds", "feed", "story"] };
    if (template.recommendedPlacement === "feed") return { facebook_positions: ["feed"] };
    return { facebook_positions: ["feed", "video_feeds", "right_hand_column"] };
  }
  if (template.recommendedPlacement === "reels") return { instagram_positions: ["reels", "story"] };
  if (template.recommendedPlacement === "feed") return { instagram_positions: ["stream"] };
  return { instagram_positions: ["stream", "reels", "story", "explore"] };
}

export function buildMetaPayloads(cfg: MetaConfigV1, input: MetaOrderInput): {
  campaign: Record<string, unknown>;
  adset: Record<string, unknown>;
  creative: Record<string, unknown>;
  ad: Record<string, unknown>;
} {
  const goal = META_AD_GOALS[input.goal];
  const nowIso = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const baseName = `${input.title || "meta_order"}_${nowIso}`;

  const countries = input.countries.length > 0 ? input.countries : ["TW"];

  const targeting: Record<string, unknown> = {
    geo_locations: { countries },
    age_min: input.ageMin,
    age_max: input.ageMax,
    genders: input.genders,
    publisher_platforms: [goal.platform],
    ...defaultPositions(goal),
  };

  const promotedObject: Record<string, unknown> = {};
  if (cfg.pageId) promotedObject.page_id = cfg.pageId;
  if (cfg.instagramActorId) promotedObject.instagram_actor_id = cfg.instagramActorId;

  const campaign: Record<string, unknown> = {
    name: `${baseName}_campaign`,
    objective: goal.objective,
    status: "PAUSED",
    special_ad_categories: [],
  };

  const adset: Record<string, unknown> = {
    name: `${baseName}_adset`,
    campaign_id: "{campaign_id}",
    billing_event: "IMPRESSIONS",
    optimization_goal: goal.optimizationGoal,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    daily_budget: String(Math.max(100, Math.round(input.dailyBudget * 100))),
    start_time: input.startTime,
    status: "PAUSED",
    targeting,
  };
  if (input.endTime) adset.end_time = input.endTime;
  if (Object.keys(promotedObject).length > 0) adset.promoted_object = promotedObject;

  const creative: Record<string, unknown> = {
    name: `${baseName}_creative`,
  };

  if (input.useExistingPost && input.existingPostId && cfg.pageId) {
    creative.object_story_id = toObjectStoryId(cfg.pageId, input.existingPostId);
  } else {
    const linkData: Record<string, unknown> = {
      message: input.message,
      link: input.landingUrl,
      call_to_action: {
        type: input.ctaType || "LEARN_MORE",
        value: { link: input.landingUrl },
      },
    };
    const objectStorySpec: Record<string, unknown> = {
      page_id: cfg.pageId || undefined,
      link_data: linkData,
    };
    if (goal.platform === "instagram" && cfg.instagramActorId) {
      objectStorySpec.instagram_actor_id = cfg.instagramActorId;
    }
    creative.object_story_spec = objectStorySpec;
  }

  const ad: Record<string, unknown> = {
    name: `${baseName}_ad`,
    adset_id: "{adset_id}",
    creative: { creative_id: "{creative_id}" },
    status: "PAUSED",
  };

  return { campaign, adset, creative, ad };
}

