export type MetaAdGoalKey =
  | "fb_post_likes"
  | "fb_post_engagement"
  | "fb_reach"
  | "fb_video_views"
  | "ig_post_spread"
  | "ig_reels_spread"
  | "ig_video_views"
  | "ig_engagement"
  | "ig_followers";

export type MetaCampaignObjective =
  | "OUTCOME_AWARENESS"
  | "OUTCOME_ENGAGEMENT"
  | "OUTCOME_TRAFFIC"
  | "OUTCOME_LEADS"
  | "OUTCOME_SALES"
  | "OUTCOME_APP_PROMOTION";

export type MetaOptimizationGoal =
  | "REACH"
  | "POST_ENGAGEMENT"
  | "THRUPLAY"
  | "PROFILE_VISIT"
  | "LINK_CLICKS";

export type MetaAdGoalTemplate = {
  key: MetaAdGoalKey;
  label: string;
  platform: "facebook" | "instagram";
  objective: MetaCampaignObjective;
  optimizationGoal: MetaOptimizationGoal;
  desc: string;
  recommendedPlacement: "feed" | "reels" | "mixed";
  notes?: string;
};

// Mapping based on Meta Marketing API objective/optimization enum patterns.
// Source baseline: official Facebook Python Business SDK enums.
export const META_AD_GOALS: Record<MetaAdGoalKey, MetaAdGoalTemplate> = {
  fb_post_likes: {
    key: "fb_post_likes",
    label: "Facebook 貼文讚",
    platform: "facebook",
    objective: "OUTCOME_ENGAGEMENT",
    optimizationGoal: "POST_ENGAGEMENT",
    recommendedPlacement: "feed",
    desc: "以貼文互動為優化，偏向貼文讚與互動提升。",
  },
  fb_post_engagement: {
    key: "fb_post_engagement",
    label: "Facebook 互動",
    platform: "facebook",
    objective: "OUTCOME_ENGAGEMENT",
    optimizationGoal: "POST_ENGAGEMENT",
    recommendedPlacement: "feed",
    desc: "以貼文互動為優化，包含留言、分享、按讚等。",
  },
  fb_reach: {
    key: "fb_reach",
    label: "Facebook 觸及",
    platform: "facebook",
    objective: "OUTCOME_AWARENESS",
    optimizationGoal: "REACH",
    recommendedPlacement: "mixed",
    desc: "以觸及人數最大化為目標。",
  },
  fb_video_views: {
    key: "fb_video_views",
    label: "Facebook 影片觀看",
    platform: "facebook",
    objective: "OUTCOME_ENGAGEMENT",
    optimizationGoal: "THRUPLAY",
    recommendedPlacement: "reels",
    desc: "以影片播放為優化（ThruPlay）。",
  },
  ig_post_spread: {
    key: "ig_post_spread",
    label: "Instagram 貼文擴散",
    platform: "instagram",
    objective: "OUTCOME_AWARENESS",
    optimizationGoal: "REACH",
    recommendedPlacement: "feed",
    desc: "以 Instagram 貼文觸及/擴散為目標。",
  },
  ig_reels_spread: {
    key: "ig_reels_spread",
    label: "Instagram Reels 擴散",
    platform: "instagram",
    objective: "OUTCOME_AWARENESS",
    optimizationGoal: "REACH",
    recommendedPlacement: "reels",
    desc: "以 Reels 觸及/擴散為目標。",
  },
  ig_video_views: {
    key: "ig_video_views",
    label: "Instagram 影片觀看",
    platform: "instagram",
    objective: "OUTCOME_ENGAGEMENT",
    optimizationGoal: "THRUPLAY",
    recommendedPlacement: "reels",
    desc: "以影片播放為優化（ThruPlay）。",
  },
  ig_engagement: {
    key: "ig_engagement",
    label: "Instagram 互動",
    platform: "instagram",
    objective: "OUTCOME_ENGAGEMENT",
    optimizationGoal: "POST_ENGAGEMENT",
    recommendedPlacement: "mixed",
    desc: "以 IG 貼文/影音互動提升為目標。",
  },
  ig_followers: {
    key: "ig_followers",
    label: "Instagram 帳號增粉",
    platform: "instagram",
    objective: "OUTCOME_ENGAGEMENT",
    optimizationGoal: "PROFILE_VISIT",
    recommendedPlacement: "mixed",
    desc: "以導流到 IG 個人檔案為主，提升追蹤機率。",
    notes: "Meta 目標通常為「個人檔案造訪」等行為優化，非保證直接新增追蹤。",
  },
};

export function listMetaGoals(): MetaAdGoalTemplate[] {
  return (Object.keys(META_AD_GOALS) as MetaAdGoalKey[]).map((k) => META_AD_GOALS[k]);
}

