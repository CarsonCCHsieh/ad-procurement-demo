import type { MetaConfigV1 } from "../config/metaConfig";
import { META_AD_GOALS } from "./metaGoals";
import type { MetaOrderInput } from "./metaOrdersStore";

function sanitizePostId(raw: string): string {
  return raw.trim().replace(/^https?:\/\/[^/]+\//i, "");
}

function toObjectStoryId(pageId: string, postIdRaw: string): string {
  const v = sanitizePostId(postIdRaw);
  if (v.includes("_")) return v;
  return `${pageId}_${v}`;
}

function normalizePlacements(input: MetaOrderInput["manualPlacements"]): {
  publisher_platforms: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
  device_platforms: string[];
} {
  const facebook = Array.from(new Set(input.facebook.map((x) => x.trim()).filter(Boolean)));
  const instagram = Array.from(new Set(input.instagram.map((x) => x.trim()).filter(Boolean)));

  const publishers: string[] = [];
  if (facebook.length > 0) publishers.push("facebook");
  if (instagram.length > 0) publishers.push("instagram");

  const fallbackPublishers = publishers.length > 0 ? publishers : ["facebook", "instagram"];
  const out: {
    publisher_platforms: string[];
    facebook_positions?: string[];
    instagram_positions?: string[];
    device_platforms: string[];
  } = {
    publisher_platforms: fallbackPublishers,
    device_platforms: ["mobile", "desktop"],
  };

  if (facebook.length > 0) out.facebook_positions = facebook;
  if (instagram.length > 0) out.instagram_positions = instagram;
  return out;
}

function parseInterestObjects(raw: string): Array<{ id: string; name?: string }> {
  const lines = raw
    .split(/\r?\n/g)
    .map((x) => x.trim())
    .filter(Boolean);
  const out: Array<{ id: string; name?: string }> = [];
  for (const line of lines) {
    const m = line.match(/^(\d+)(?:\s*[|,]\s*(.+))?$/);
    if (!m) continue;
    const id = m[1];
    const name = m[2]?.trim();
    out.push(name ? { id, name } : { id });
  }
  return out;
}

function parseIdList(raw: string[] | undefined): Array<{ id: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string }> = [];
  for (const item of raw) {
    const id = String(item ?? "").trim();
    if (!id || out.some((row) => row.id === id)) continue;
    out.push({ id });
  }
  return out;
}

function normalizeDestinationType(raw?: string): string | undefined {
  const value = String(raw ?? "").trim().toUpperCase();
  if (!value) return undefined;
  if (["WEBSITE", "APP", "MESSENGER", "ON_AD", "INSTAGRAM_PROFILE"].includes(value)) return value;
  return undefined;
}

export function buildMetaPayloads(cfg: MetaConfigV1, input: MetaOrderInput): {
  campaign: Record<string, unknown>;
  adset: Record<string, unknown>;
  creative: Record<string, unknown>;
  ad: Record<string, unknown>;
} {
  const goal = META_AD_GOALS[input.goal];
  const countries = input.countries.length > 0 ? input.countries : ["TW"];
  const placement = normalizePlacements(input.manualPlacements);
  const interests = parseInterestObjects(input.detailedTargetingText ?? "");
  const savedAudienceTargeting =
    input.savedAudienceTargeting && typeof input.savedAudienceTargeting === "object"
      ? { ...input.savedAudienceTargeting }
      : {};

  const targeting: Record<string, unknown> = {
    ...savedAudienceTargeting,
    geo_locations: { countries },
    age_min: input.ageMin,
    age_max: input.ageMax,
    genders: input.genders,
    publisher_platforms: placement.publisher_platforms,
    device_platforms: placement.device_platforms,
  };
  if (placement.facebook_positions && placement.facebook_positions.length > 0) {
    targeting.facebook_positions = placement.facebook_positions;
  }
  if (placement.instagram_positions && placement.instagram_positions.length > 0) {
    targeting.instagram_positions = placement.instagram_positions;
  }
  if (interests.length > 0) {
    targeting.flexible_spec = [{ interests }];
  }
  const customAudiences = parseIdList(input.customAudienceIds);
  if (customAudiences.length > 0) {
    targeting.custom_audiences = customAudiences;
  }
  const excludedAudiences = parseIdList(input.excludedAudienceIds);
  if (excludedAudiences.length > 0) {
    targeting.excluded_custom_audiences = excludedAudiences;
  }

  const promotedObject: Record<string, unknown> = {};
  if (cfg.pageId) promotedObject.page_id = cfg.pageId;
  if (cfg.instagramActorId) promotedObject.instagram_actor_id = cfg.instagramActorId;
  if (input.pixelId) promotedObject.pixel_id = input.pixelId;
  if (input.conversionEvent) promotedObject.custom_event_type = input.conversionEvent;
  if (input.appId) promotedObject.application_id = input.appId;
  if (input.appStoreUrl) promotedObject.object_store_url = input.appStoreUrl;
  if (input.appEventType && !input.conversionEvent) promotedObject.custom_event_type = input.appEventType;

  const campaign: Record<string, unknown> = {
    name: input.campaignName || `${input.title}_campaign`,
    buying_type: "AUCTION",
    objective: input.campaignObjective || goal.objective,
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: false,
    status: "PAUSED",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    daily_budget: String(Math.max(100, Math.round(input.dailyBudget * 100))),
  };

  const adset: Record<string, unknown> = {
    name: input.adsetName || `${input.title}_adset`,
    campaign_id: "{campaign_id}",
    billing_event: "IMPRESSIONS",
    optimization_goal: goal.optimizationGoal,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    is_adset_budget_sharing_enabled: false,
    start_time: input.startTime,
    status: "PAUSED",
    targeting,
  };
  const destinationType = normalizeDestinationType(input.conversionLocation);
  if (destinationType) {
    adset.destination_type = destinationType;
  } else if (goal.optimizationGoal === "POST_ENGAGEMENT") {
    adset.destination_type = "ON_AD";
  }
  if (input.endTime) adset.end_time = input.endTime;
  if (Object.keys(promotedObject).length > 0) adset.promoted_object = promotedObject;

  const creative: Record<string, unknown> = {
    name: `${input.adName || input.title}_creative`,
  };

  if (input.useExistingPost && input.existingPostId) {
    if (goal.platform === "instagram") {
      creative.source_instagram_media_id = sanitizePostId(input.existingPostId);
    } else if (cfg.pageId) {
      creative.object_story_id = toObjectStoryId(cfg.pageId, input.existingPostId);
    }
  } else {
    const resolvedLink = input.destinationUrl || input.landingUrl;
    const linkData: Record<string, unknown> = {
      message: input.message,
      link: resolvedLink,
      call_to_action: {
        type: input.ctaType || "LEARN_MORE",
        value: { link: resolvedLink },
      },
    };
    const objectStorySpec: Record<string, unknown> = {
      page_id: cfg.pageId || undefined,
      link_data: linkData,
    };
    if (cfg.instagramActorId) {
      objectStorySpec.instagram_actor_id = cfg.instagramActorId;
    }
    creative.object_story_spec = objectStorySpec;
  }

  const ad: Record<string, unknown> = {
    name: input.adName || `${input.title}_ad`,
    adset_id: "{adset_id}",
    creative: { creative_id: "{creative_id}" },
    status: "PAUSED",
  };

  return { campaign, adset, creative, ad };
}
