export type MetaCampaignObjective =
  | "OUTCOME_AWARENESS"
  | "OUTCOME_TRAFFIC"
  | "OUTCOME_ENGAGEMENT"
  | "OUTCOME_LEADS"
  | "OUTCOME_APP_PROMOTION"
  | "OUTCOME_SALES";

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

export type MetaOptimizationGoal =
  | "AD_RECALL_LIFT"
  | "APP_INSTALLS"
  | "CONVERSATIONS"
  | "IMPRESSIONS"
  | "LANDING_PAGE_VIEWS"
  | "LEAD_GENERATION"
  | "LINK_CLICKS"
  | "OFFSITE_CONVERSIONS"
  | "POST_ENGAGEMENT"
  | "PROFILE_VISIT"
  | "REACH"
  | "THRUPLAY"
  | "VALUE"
  | "VIDEO_VIEWS";

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
  | "leads"
  | "conversions"
  | "app_events"
  | "calls"
  | "spend";

export type MetaCampaignObjectiveOption = {
  value: MetaCampaignObjective;
  label: string;
  desc: string;
};

export type MetaPerformanceGoalOption = {
  code: string;
  objective: MetaCampaignObjective;
  label: string;
  desc: string;
  optimizationGoal: MetaOptimizationGoal;
  proxyMetricKey: MetaKpiMetricKey | null;
  defaultGoal: MetaAdGoalKey;
  conversionLocation: "website" | "on_ad" | "messenger" | "instagram_profile" | "app" | "none";
  supportedInPostFlow?: boolean;
};

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
  kpiDefinition: string;
  reportMetrics: MetaKpiMetric[];
};

const COMMON_ENGAGEMENT_METRICS: MetaKpiMetric[] = [
  { key: "interactions_total", label: "總互動" },
  { key: "likes", label: "按讚數" },
  { key: "all_clicks", label: "所有點擊" },
  { key: "comments", label: "留言" },
  { key: "shares", label: "分享" },
  { key: "spend", label: "花費" },
];

export const META_CAMPAIGN_OBJECTIVE_OPTIONS: MetaCampaignObjectiveOption[] = [
  { value: "OUTCOME_AWARENESS", label: "品牌認知", desc: "提高觸及、曝光、廣告回想與影片觀看。" },
  { value: "OUTCOME_TRAFFIC", label: "流量", desc: "導流至網站、貼文連結或其他目的地。" },
  { value: "OUTCOME_ENGAGEMENT", label: "互動", desc: "提高貼文互動、影片觀看、活動回覆或粉絲專頁互動。" },
  { value: "OUTCOME_LEADS", label: "潛在顧客", desc: "需要表單、網站轉換或訊息名單設定；本貼文投放流程暫不開放。" },
  { value: "OUTCOME_APP_PROMOTION", label: "應用程式推廣", desc: "需要 App 與 SDK / 事件設定；本貼文投放流程暫不開放。" },
  { value: "OUTCOME_SALES", label: "銷售業績", desc: "需要 Pixel / CAPI / 商品目錄等轉換設定；本貼文投放流程暫不開放。" },
];

export const META_AD_GOALS: Record<MetaAdGoalKey, MetaAdGoalTemplate> = {
  fb_post_likes: {
    key: "fb_post_likes",
    label: "Facebook 貼文讚",
    platform: "facebook",
    objective: "OUTCOME_ENGAGEMENT",
    optimizationGoal: "POST_ENGAGEMENT",
    recommendedPlacement: "feed",
    desc: "以貼文讚與基礎互動為主要結果。",
    kpiDefinition: "追蹤貼文讚、所有點擊、留言、分享與總互動。",
    reportMetrics: COMMON_ENGAGEMENT_METRICS,
  },
  fb_post_engagement: {
    key: "fb_post_engagement",
    label: "Facebook 互動",
    platform: "facebook",
    objective: "OUTCOME_ENGAGEMENT",
    optimizationGoal: "POST_ENGAGEMENT",
    recommendedPlacement: "mixed",
    desc: "提高貼文讚、點擊、留言、分享等互動。",
    kpiDefinition: "互動定義為貼文讚、所有點擊、留言、分享的總和。",
    reportMetrics: COMMON_ENGAGEMENT_METRICS,
  },
  fb_reach: {
    key: "fb_reach",
    label: "Facebook 觸及",
    platform: "facebook",
    objective: "OUTCOME_AWARENESS",
    optimizationGoal: "REACH",
    recommendedPlacement: "mixed",
    desc: "提高觸及與曝光。",
    kpiDefinition: "追蹤觸及人數與曝光次數。",
    reportMetrics: [
      { key: "reach", label: "觸及" },
      { key: "impressions", label: "曝光" },
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
    desc: "提高影片觀看與 ThruPlay。",
    kpiDefinition: "追蹤 3 秒觀看與 ThruPlay。",
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
    desc: "提高 Instagram 貼文觸及與曝光。",
    kpiDefinition: "追蹤觸及、曝光、個人檔案瀏覽與增粉。",
    reportMetrics: [
      { key: "reach", label: "觸及" },
      { key: "impressions", label: "曝光" },
      { key: "profile_visits", label: "個人檔案瀏覽" },
      { key: "followers", label: "增粉" },
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
    desc: "提高 Reels 觸及與曝光。",
    kpiDefinition: "追蹤觸及、曝光、個人檔案瀏覽與增粉。",
    reportMetrics: [
      { key: "reach", label: "觸及" },
      { key: "impressions", label: "曝光" },
      { key: "profile_visits", label: "個人檔案瀏覽" },
      { key: "followers", label: "增粉" },
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
    desc: "提高 Reels 或影片觀看。",
    kpiDefinition: "追蹤 3 秒觀看、影片觀看與 ThruPlay。",
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
    desc: "提高 Instagram 貼文或 Reels 互動。",
    kpiDefinition: "互動定義為按讚、所有點擊、留言、分享的總和。",
    reportMetrics: COMMON_ENGAGEMENT_METRICS,
  },
  ig_followers: {
    key: "ig_followers",
    label: "Instagram 帳號增粉",
    platform: "instagram",
    objective: "OUTCOME_TRAFFIC",
    optimizationGoal: "PROFILE_VISIT",
    recommendedPlacement: "mixed",
    desc: "導流至 Instagram 個人檔案並觀察增粉。",
    kpiDefinition: "追蹤增粉、個人檔案瀏覽與點擊。",
    reportMetrics: [
      { key: "followers", label: "增粉" },
      { key: "profile_visits", label: "個人檔案瀏覽" },
      { key: "all_clicks", label: "所有點擊" },
      { key: "spend", label: "花費" },
    ],
  },
};

function goal(
  code: string,
  objective: MetaCampaignObjective,
  label: string,
  desc: string,
  optimizationGoal: MetaOptimizationGoal,
  proxyMetricKey: MetaKpiMetricKey | null,
  defaultGoal: MetaAdGoalKey,
  conversionLocation: MetaPerformanceGoalOption["conversionLocation"],
  supportedInPostFlow = true,
): MetaPerformanceGoalOption {
  return { code, objective, label, desc, optimizationGoal, proxyMetricKey, defaultGoal, conversionLocation, supportedInPostFlow };
}

// This list intentionally exposes only combinations that are safe for this product's existing-post workflow.
// Meta's Ads Manager text lists broader possibilities, but several require pixel/app/lead/message assets or are rejected by API versions for ODAX campaigns.
export const META_PERFORMANCE_GOALS: MetaPerformanceGoalOption[] = [
  goal("AWARENESS_REACH", "OUTCOME_AWARENESS", "盡可能提高廣告觸及人數", "盡可能向更多受眾顯示廣告。", "REACH", "reach", "fb_reach", "none"),
  goal("AWARENESS_IMPRESSIONS", "OUTCOME_AWARENESS", "盡可能提高曝光次數", "盡可能提高廣告向受眾顯示的次數。", "IMPRESSIONS", "impressions", "fb_reach", "none"),
  goal("AWARENESS_THRUPLAY", "OUTCOME_AWARENESS", "盡可能提高 ThruPlay 觀看次數", "向可能看完整部短影片或至少 15 秒影片的受眾顯示影片廣告。", "THRUPLAY", "thruplays", "fb_video_views", "none"),
  goal("AWARENESS_2S_VIDEO", "OUTCOME_AWARENESS", "盡可能提高影片連續觀看 2 秒以上的次數", "向可能連續觀看 2 秒以上的受眾顯示影片廣告。", "VIDEO_VIEWS", "video_3s_views", "fb_video_views", "none"),

  goal("TRAFFIC_LINK_CLICKS", "OUTCOME_TRAFFIC", "取得最多連結點擊次數", "向最有可能點擊廣告連結的受眾顯示廣告。", "LINK_CLICKS", "all_clicks", "fb_post_engagement", "website"),
  goal("TRAFFIC_LANDING_PAGE_VIEWS", "OUTCOME_TRAFFIC", "取得最多連結頁面瀏覽次數", "向最有可能查看廣告連結頁面的受眾顯示廣告。", "LANDING_PAGE_VIEWS", "all_clicks", "fb_post_engagement", "website"),
  goal("TRAFFIC_IG_PROFILE_VISITS", "OUTCOME_TRAFFIC", "提高 Instagram 個人檔案瀏覽次數", "向最有可能瀏覽 Instagram 個人檔案的受眾顯示廣告。", "PROFILE_VISIT", "profile_visits", "ig_followers", "instagram_profile"),

  goal("ENGAGEMENT_POST_ENGAGEMENT", "OUTCOME_ENGAGEMENT", "盡可能提升貼文互動率", "向最有可能喜歡、分享貼文或留言的受眾顯示廣告。", "POST_ENGAGEMENT", "interactions_total", "fb_post_engagement", "on_ad"),
  goal("ENGAGEMENT_THRUPLAY", "OUTCOME_ENGAGEMENT", "盡可能提高 ThruPlay 觀看次數", "向可能看完整部短影片或至少 15 秒影片的受眾顯示影片廣告。", "THRUPLAY", "thruplays", "fb_video_views", "none"),
  goal("ENGAGEMENT_2S_VIDEO", "OUTCOME_ENGAGEMENT", "盡可能提高影片連續觀看 2 秒以上的次數", "向可能連續觀看 2 秒以上的受眾顯示影片廣告。", "VIDEO_VIEWS", "video_3s_views", "fb_video_views", "none"),
  goal("ENGAGEMENT_DAILY_UNIQUE_REACH", "OUTCOME_ENGAGEMENT", "盡可能增加單日不重複觸及人數", "每天最多向同一位受眾顯示一次廣告。", "REACH", "reach", "fb_reach", "none"),
];

const GOAL_PRIMARY_METRIC: Record<MetaAdGoalKey, MetaKpiMetricKey> = {
  fb_post_likes: "likes",
  fb_post_engagement: "interactions_total",
  fb_reach: "reach",
  fb_video_views: "video_3s_views",
  ig_post_spread: "reach",
  ig_reels_spread: "reach",
  ig_video_views: "video_3s_views",
  ig_engagement: "interactions_total",
  ig_followers: "profile_visits",
};

export function listMetaGoals(): MetaAdGoalTemplate[] {
  return (Object.keys(META_AD_GOALS) as MetaAdGoalKey[]).map((key) => META_AD_GOALS[key]);
}

export function listPerformanceGoalsByObjective(objective: MetaCampaignObjective): MetaPerformanceGoalOption[] {
  return META_PERFORMANCE_GOALS.filter((item) => item.objective === objective && item.supportedInPostFlow !== false);
}

export function getPerformanceGoal(code: string): MetaPerformanceGoalOption {
  return META_PERFORMANCE_GOALS.find((item) => item.code === code) ?? META_PERFORMANCE_GOALS[0];
}

export function getGoalPrimaryMetricKey(goal: MetaAdGoalKey): MetaKpiMetricKey {
  return GOAL_PRIMARY_METRIC[goal];
}

export function getGoalPrimaryMetricLabel(goal: MetaAdGoalKey): string {
  const key = getGoalPrimaryMetricKey(goal);
  return META_AD_GOALS[goal].reportMetrics.find((metric) => metric.key === key)?.label ?? key;
}

export function getGoalObjective(goal: MetaAdGoalKey): MetaCampaignObjective {
  return META_AD_GOALS[goal].objective;
}

export function listMetaGoalsByObjective(objective: MetaCampaignObjective): MetaAdGoalTemplate[] {
  return listMetaGoals().filter((item) => item.objective === objective);
}
