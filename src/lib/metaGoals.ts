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

export type MetaCampaignObjectiveOption = {
  value: MetaCampaignObjective;
  label: string;
  desc: string;
};

export type MetaOptimizationGoal =
  | "REACH"
  | "POST_ENGAGEMENT"
  | "THRUPLAY"
  | "PROFILE_VISIT"
  | "LINK_CLICKS";

export type MetaKpiMetricKey =
  | "likes"
  | "all_clicks"
  | "comments"
  | "shares"
  | "interactions_total"
  | "impressions"
  | "reach"
  | "video_3s_views"
  | "thruplays"
  | "followers"
  | "profile_visits"
  | "spend";

export type MetaKpiMetric = {
  key: MetaKpiMetricKey;
  label: string;
};

export type MetaAdGoalTemplate = {
  key: MetaAdGoalKey;
  label: string;
  platform: "facebook" | "instagram";
  objective: MetaCampaignObjective;
  optimizationGoal: MetaOptimizationGoal;
  desc: string;
  recommendedPlacement: "feed" | "reels" | "mixed";
  notes?: string;
  kpiDefinition: string;
  reportMetrics: MetaKpiMetric[];
};

export const META_CAMPAIGN_OBJECTIVE_OPTIONS: MetaCampaignObjectiveOption[] = [
  {
    value: "OUTCOME_AWARENESS",
    label: "認知",
    desc: "提高曝光、觸及與品牌記憶。",
  },
  {
    value: "OUTCOME_ENGAGEMENT",
    label: "互動",
    desc: "提高貼文互動、影片觀看或個人檔案相關互動。",
  },
  {
    value: "OUTCOME_TRAFFIC",
    label: "流量",
    desc: "導流到網站、貼文或其他可點擊目的地。",
  },
  {
    value: "OUTCOME_LEADS",
    label: "名單開發",
    desc: "蒐集表單名單、私訊線索或其他可回收名單。",
  },
  {
    value: "OUTCOME_SALES",
    label: "銷售",
    desc: "以轉換或購買為核心的投放目標。",
  },
  {
    value: "OUTCOME_APP_PROMOTION",
    label: "應用程式推廣",
    desc: "以 App 安裝或 App 內行為為目標。",
  },
];

export const META_AD_GOALS: Record<MetaAdGoalKey, MetaAdGoalTemplate> = {
  fb_post_likes: {
    key: "fb_post_likes",
    label: "Facebook 貼文讚",
    platform: "facebook",
    objective: "OUTCOME_ENGAGEMENT",
    optimizationGoal: "POST_ENGAGEMENT",
    recommendedPlacement: "feed",
    desc: "提升貼文按讚與基礎互動。",
    kpiDefinition: "主要追蹤貼文按讚，並同步觀察點擊、留言、分享與總互動。",
    reportMetrics: [
      { key: "likes", label: "貼文讚" },
      { key: "all_clicks", label: "所有點擊" },
      { key: "comments", label: "留言" },
      { key: "shares", label: "分享" },
      { key: "interactions_total", label: "總互動" },
      { key: "spend", label: "花費" },
    ],
  },
  fb_post_engagement: {
    key: "fb_post_engagement",
    label: "Facebook 互動",
    platform: "facebook",
    objective: "OUTCOME_ENGAGEMENT",
    optimizationGoal: "POST_ENGAGEMENT",
    recommendedPlacement: "feed",
    desc: "提升貼文互動，包含按讚、留言、分享與點擊。",
    kpiDefinition: "互動定義為貼文按讚、所有點擊、留言、分享的總和。",
    reportMetrics: [
      { key: "interactions_total", label: "總互動" },
      { key: "likes", label: "貼文讚" },
      { key: "all_clicks", label: "所有點擊" },
      { key: "comments", label: "留言" },
      { key: "shares", label: "分享" },
      { key: "spend", label: "花費" },
    ],
  },
  fb_reach: {
    key: "fb_reach",
    label: "Facebook 觸及",
    platform: "facebook",
    objective: "OUTCOME_AWARENESS",
    optimizationGoal: "REACH",
    recommendedPlacement: "mixed",
    desc: "放大曝光與觸及人數。",
    kpiDefinition: "主要追蹤曝光數與觸及人數。",
    reportMetrics: [
      { key: "impressions", label: "曝光數" },
      { key: "reach", label: "觸及人數" },
      { key: "spend", label: "花費" },
    ],
  },
  fb_video_views: {
    key: "fb_video_views",
    label: "Facebook 影片觀看",
    platform: "facebook",
    objective: "OUTCOME_ENGAGEMENT",
    optimizationGoal: "THRUPLAY",
    recommendedPlacement: "reels",
    desc: "提升影片觀看與完整播放表現。",
    kpiDefinition: "主要追蹤 3 秒觀看與 ThruPlay。",
    reportMetrics: [
      { key: "video_3s_views", label: "3 秒觀看" },
      { key: "thruplays", label: "ThruPlay" },
      { key: "all_clicks", label: "所有點擊" },
      { key: "spend", label: "花費" },
    ],
  },
  ig_post_spread: {
    key: "ig_post_spread",
    label: "Instagram 貼文擴散",
    platform: "instagram",
    objective: "OUTCOME_AWARENESS",
    optimizationGoal: "REACH",
    recommendedPlacement: "feed",
    desc: "提升 Instagram 貼文觸及與擴散。",
    kpiDefinition: "主要觀察增粉、個人檔案瀏覽、觸及與曝光。",
    reportMetrics: [
      { key: "followers", label: "增粉數" },
      { key: "profile_visits", label: "個人檔案瀏覽" },
      { key: "reach", label: "觸及人數" },
      { key: "impressions", label: "曝光數" },
      { key: "spend", label: "花費" },
    ],
  },
  ig_reels_spread: {
    key: "ig_reels_spread",
    label: "Instagram Reels 擴散",
    platform: "instagram",
    objective: "OUTCOME_AWARENESS",
    optimizationGoal: "REACH",
    recommendedPlacement: "reels",
    desc: "提升 Reels 觸及與曝光。",
    kpiDefinition: "主要觀察增粉、個人檔案瀏覽、觸及與曝光。",
    reportMetrics: [
      { key: "followers", label: "增粉數" },
      { key: "profile_visits", label: "個人檔案瀏覽" },
      { key: "reach", label: "觸及人數" },
      { key: "impressions", label: "曝光數" },
      { key: "spend", label: "花費" },
    ],
  },
  ig_video_views: {
    key: "ig_video_views",
    label: "Instagram 影片觀看",
    platform: "instagram",
    objective: "OUTCOME_ENGAGEMENT",
    optimizationGoal: "THRUPLAY",
    recommendedPlacement: "reels",
    desc: "提升影片觀看與完整播放表現。",
    kpiDefinition: "主要追蹤 3 秒觀看與 ThruPlay。",
    reportMetrics: [
      { key: "video_3s_views", label: "3 秒觀看" },
      { key: "thruplays", label: "ThruPlay" },
      { key: "all_clicks", label: "所有點擊" },
      { key: "spend", label: "花費" },
    ],
  },
  ig_engagement: {
    key: "ig_engagement",
    label: "Instagram 互動",
    platform: "instagram",
    objective: "OUTCOME_ENGAGEMENT",
    optimizationGoal: "POST_ENGAGEMENT",
    recommendedPlacement: "mixed",
    desc: "提升貼文或影片互動。",
    kpiDefinition: "互動定義為按讚、所有點擊、留言、分享的總和。",
    reportMetrics: [
      { key: "interactions_total", label: "總互動" },
      { key: "likes", label: "按讚數" },
      { key: "all_clicks", label: "所有點擊" },
      { key: "comments", label: "留言" },
      { key: "shares", label: "分享" },
      { key: "spend", label: "花費" },
    ],
  },
  ig_followers: {
    key: "ig_followers",
    label: "Instagram 帳號增粉",
    platform: "instagram",
    objective: "OUTCOME_ENGAGEMENT",
    optimizationGoal: "PROFILE_VISIT",
    recommendedPlacement: "mixed",
    desc: "導流至 Instagram 帳號，提升追蹤。",
    notes: "Meta 通常以個人檔案瀏覽或相近行為做最佳化，並非保證直接新增追蹤。",
    kpiDefinition: "主要追蹤增粉數，並搭配個人檔案瀏覽觀察。",
    reportMetrics: [
      { key: "followers", label: "增粉數" },
      { key: "profile_visits", label: "個人檔案瀏覽" },
      { key: "all_clicks", label: "所有點擊" },
      { key: "spend", label: "花費" },
    ],
  },
};

export function listMetaGoals(): MetaAdGoalTemplate[] {
  return (Object.keys(META_AD_GOALS) as MetaAdGoalKey[]).map((k) => META_AD_GOALS[k]);
}

const GOAL_PRIMARY_METRIC: Record<MetaAdGoalKey, MetaKpiMetricKey> = {
  fb_post_likes: "likes",
  fb_post_engagement: "interactions_total",
  fb_reach: "reach",
  fb_video_views: "video_3s_views",
  ig_post_spread: "followers",
  ig_reels_spread: "followers",
  ig_video_views: "video_3s_views",
  ig_engagement: "interactions_total",
  ig_followers: "followers",
};

export function getGoalPrimaryMetricKey(goal: MetaAdGoalKey): MetaKpiMetricKey {
  return GOAL_PRIMARY_METRIC[goal];
}

export function getGoalPrimaryMetricLabel(goal: MetaAdGoalKey): string {
  const key = getGoalPrimaryMetricKey(goal);
  const tpl = META_AD_GOALS[goal];
  return tpl.reportMetrics.find((m) => m.key === key)?.label ?? key;
}

export function listMetaGoalsByObjective(objective: MetaCampaignObjective): MetaAdGoalTemplate[] {
  return listMetaGoals().filter((goal) => goal.objective === objective);
}

export function getGoalObjective(goal: MetaAdGoalKey): MetaCampaignObjective {
  return META_AD_GOALS[goal].objective;
}
