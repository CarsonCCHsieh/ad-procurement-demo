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

export const META_CAMPAIGN_OBJECTIVE_OPTIONS: MetaCampaignObjectiveOption[] = [
  { value: "OUTCOME_AWARENESS", label: "品牌認知", desc: "提高觸及、曝光、廣告回想與影片觀看。" },
  { value: "OUTCOME_TRAFFIC", label: "流量", desc: "導流至網站、貼文、Instagram 個人檔案、訊息或通話。" },
  { value: "OUTCOME_ENGAGEMENT", label: "互動", desc: "提高貼文互動、影片觀看、訊息、活動回覆或粉絲專頁讚。" },
  { value: "OUTCOME_LEADS", label: "潛在顧客", desc: "取得名單、訊息名單、通話或網站轉換。" },
  { value: "OUTCOME_APP_PROMOTION", label: "應用程式推廣", desc: "增加 App 安裝、App 事件或 App 內轉換價值。" },
  { value: "OUTCOME_SALES", label: "銷售業績", desc: "取得購買、轉換、價值、訊息購買或導流成效。" },
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
    recommendedPlacement: "mixed",
    desc: "提高貼文讚、點擊、留言、分享等互動。",
    kpiDefinition: "互動定義為貼文讚、所有點擊、留言、分享的總和。",
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
    kpiDefinition: "追蹤觸及、曝光、個人檔案瀏覽與追蹤增長。",
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
    kpiDefinition: "追蹤觸及、曝光、個人檔案瀏覽與追蹤增長。",
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
    reportMetrics: [
      { key: "interactions_total", label: "總互動" },
      { key: "likes", label: "按讚" },
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

export const META_PERFORMANCE_GOALS: MetaPerformanceGoalOption[] = [
  { code: "AWARENESS_REACH", objective: "OUTCOME_AWARENESS", label: "盡可能提高廣告觸及人數", desc: "盡可能向更多受眾顯示廣告。", optimizationGoal: "REACH", proxyMetricKey: "reach", defaultGoal: "fb_reach", conversionLocation: "none" },
  { code: "AWARENESS_IMPRESSIONS", objective: "OUTCOME_AWARENESS", label: "盡可能提高曝光次數", desc: "盡可能提高廣告向受眾顯示的次數。", optimizationGoal: "IMPRESSIONS", proxyMetricKey: "impressions", defaultGoal: "fb_reach", conversionLocation: "none" },
  { code: "AWARENESS_AD_RECALL", objective: "OUTCOME_AWARENESS", label: "盡可能提高廣告回想提升幅度", desc: "向可能會記得看過您廣告的受眾顯示廣告。", optimizationGoal: "AD_RECALL_LIFT", proxyMetricKey: null, defaultGoal: "fb_reach", conversionLocation: "none" },
  { code: "AWARENESS_THRUPLAY", objective: "OUTCOME_AWARENESS", label: "盡可能提高 ThruPlay 觀看次數", desc: "向可能觀看完整短影片或至少 15 秒影片的受眾顯示影片廣告。", optimizationGoal: "THRUPLAY", proxyMetricKey: "thruplays", defaultGoal: "fb_video_views", conversionLocation: "none" },
  { code: "AWARENESS_2S_VIDEO", objective: "OUTCOME_AWARENESS", label: "盡可能提高影片連續觀看 2 秒以上的次數", desc: "向可能連續觀看 2 秒以上的受眾顯示影片廣告。", optimizationGoal: "VIDEO_VIEWS", proxyMetricKey: "video_3s_views", defaultGoal: "fb_video_views", conversionLocation: "none" },

  { code: "TRAFFIC_LANDING_PAGE_VIEWS", objective: "OUTCOME_TRAFFIC", label: "取得最多連結頁面瀏覽次數", desc: "向最有可能查看廣告中所連結網站的受眾顯示廣告。", optimizationGoal: "LANDING_PAGE_VIEWS", proxyMetricKey: "all_clicks", defaultGoal: "fb_post_engagement", conversionLocation: "website" },
  { code: "TRAFFIC_LINK_CLICKS", objective: "OUTCOME_TRAFFIC", label: "取得最多連結點擊次數", desc: "向最有可能點擊廣告的受眾顯示廣告。", optimizationGoal: "LINK_CLICKS", proxyMetricKey: "all_clicks", defaultGoal: "fb_post_engagement", conversionLocation: "website" },
  { code: "TRAFFIC_DAILY_UNIQUE_REACH", objective: "OUTCOME_TRAFFIC", label: "盡可能增加單日不重複觸及人數", desc: "每天最多向受眾顯示一次廣告。", optimizationGoal: "REACH", proxyMetricKey: "reach", defaultGoal: "fb_reach", conversionLocation: "none" },
  { code: "TRAFFIC_CONVERSATIONS", objective: "OUTCOME_TRAFFIC", label: "盡可能增加對話數量", desc: "向最有可能透過訊息與您對話的受眾顯示廣告。", optimizationGoal: "CONVERSATIONS", proxyMetricKey: null, defaultGoal: "fb_post_engagement", conversionLocation: "messenger" },
  { code: "TRAFFIC_IMPRESSIONS", objective: "OUTCOME_TRAFFIC", label: "盡可能提高曝光次數", desc: "盡可能提高廣告向受眾顯示的次數。", optimizationGoal: "IMPRESSIONS", proxyMetricKey: "impressions", defaultGoal: "fb_reach", conversionLocation: "none" },
  { code: "TRAFFIC_IG_PROFILE_VISITS", objective: "OUTCOME_TRAFFIC", label: "提高 Instagram 個人檔案瀏覽次數", desc: "向最有可能瀏覽 Instagram 個人檔案的受眾顯示廣告。", optimizationGoal: "PROFILE_VISIT", proxyMetricKey: "profile_visits", defaultGoal: "ig_followers", conversionLocation: "instagram_profile" },
  { code: "TRAFFIC_CALLS", objective: "OUTCOME_TRAFFIC", label: "盡可能增加通話次數", desc: "向最有可能向您致電的受眾顯示廣告。", optimizationGoal: "LINK_CLICKS", proxyMetricKey: "calls", defaultGoal: "fb_post_engagement", conversionLocation: "on_ad" },

  { code: "ENGAGEMENT_CONVERSATIONS", objective: "OUTCOME_ENGAGEMENT", label: "盡可能增加對話數量", desc: "向最有可能透過訊息與您對話的受眾顯示廣告。", optimizationGoal: "CONVERSATIONS", proxyMetricKey: null, defaultGoal: "fb_post_engagement", conversionLocation: "messenger" },
  { code: "ENGAGEMENT_LINK_CLICKS", objective: "OUTCOME_ENGAGEMENT", label: "取得最多連結點擊次數", desc: "向最有可能點擊廣告的受眾顯示廣告。", optimizationGoal: "LINK_CLICKS", proxyMetricKey: "all_clicks", defaultGoal: "fb_post_engagement", conversionLocation: "website" },
  { code: "ENGAGEMENT_IMPRESSIONS", objective: "OUTCOME_ENGAGEMENT", label: "盡可能提高曝光次數", desc: "盡可能提高廣告向受眾顯示的次數。", optimizationGoal: "IMPRESSIONS", proxyMetricKey: "impressions", defaultGoal: "fb_reach", conversionLocation: "none" },
  { code: "ENGAGEMENT_THRUPLAY", objective: "OUTCOME_ENGAGEMENT", label: "盡可能提高 ThruPlay 觀看次數", desc: "向可能觀看完整短影片或至少 15 秒影片的受眾顯示影片廣告。", optimizationGoal: "THRUPLAY", proxyMetricKey: "thruplays", defaultGoal: "fb_video_views", conversionLocation: "none" },
  { code: "ENGAGEMENT_2S_VIDEO", objective: "OUTCOME_ENGAGEMENT", label: "盡可能提高影片連續觀看 2 秒以上的次數", desc: "向可能連續觀看 2 秒以上的受眾顯示影片廣告。", optimizationGoal: "VIDEO_VIEWS", proxyMetricKey: "video_3s_views", defaultGoal: "fb_video_views", conversionLocation: "none" },
  { code: "ENGAGEMENT_POST_ENGAGEMENT", objective: "OUTCOME_ENGAGEMENT", label: "盡可能提升貼文互動率", desc: "向最有可能喜歡、分享貼文或留言的用戶顯示廣告。", optimizationGoal: "POST_ENGAGEMENT", proxyMetricKey: "interactions_total", defaultGoal: "fb_post_engagement", conversionLocation: "on_ad" },
  { code: "ENGAGEMENT_DAILY_UNIQUE_REACH", objective: "OUTCOME_ENGAGEMENT", label: "盡可能增加單日不重複觸及人數", desc: "每天最多向受眾顯示一次廣告。", optimizationGoal: "REACH", proxyMetricKey: "reach", defaultGoal: "fb_reach", conversionLocation: "none" },
  { code: "ENGAGEMENT_PAGE_LIKES", objective: "OUTCOME_ENGAGEMENT", label: "盡可能增加粉絲專頁按讚數", desc: "以最低成本向最有可能對粉絲專頁按讚的受眾顯示廣告。", optimizationGoal: "POST_ENGAGEMENT", proxyMetricKey: "likes", defaultGoal: "fb_post_likes", conversionLocation: "on_ad" },

  { code: "LEADS_CONVERSIONS", objective: "OUTCOME_LEADS", label: "取得最多轉換次數", desc: "向最有可能在網站上採取特定動作的受眾顯示廣告。", optimizationGoal: "OFFSITE_CONVERSIONS", proxyMetricKey: "conversions", defaultGoal: "fb_post_engagement", conversionLocation: "website" },
  { code: "LEADS_LANDING_PAGE_VIEWS", objective: "OUTCOME_LEADS", label: "取得最多連結頁面瀏覽次數", desc: "向最有可能查看廣告中所連結網站的受眾顯示廣告。", optimizationGoal: "LANDING_PAGE_VIEWS", proxyMetricKey: "all_clicks", defaultGoal: "fb_post_engagement", conversionLocation: "website" },
  { code: "LEADS_LINK_CLICKS", objective: "OUTCOME_LEADS", label: "取得最多連結點擊次數", desc: "向最有可能點擊廣告的受眾顯示廣告。", optimizationGoal: "LINK_CLICKS", proxyMetricKey: "all_clicks", defaultGoal: "fb_post_engagement", conversionLocation: "website" },
  { code: "LEADS_DAILY_UNIQUE_REACH", objective: "OUTCOME_LEADS", label: "盡可能增加單日不重複觸及人數", desc: "每天最多向受眾顯示一次廣告。", optimizationGoal: "REACH", proxyMetricKey: "reach", defaultGoal: "fb_reach", conversionLocation: "none" },
  { code: "LEADS_IMPRESSIONS", objective: "OUTCOME_LEADS", label: "盡可能提高曝光次數", desc: "盡可能提高廣告向受眾顯示的次數。", optimizationGoal: "IMPRESSIONS", proxyMetricKey: "impressions", defaultGoal: "fb_reach", conversionLocation: "none" },
  { code: "LEADS_MAXIMIZE_LEADS", objective: "OUTCOME_LEADS", label: "盡可能提高潛在顧客人數", desc: "向最有可能分享聯絡資料的受眾顯示廣告。", optimizationGoal: "LEAD_GENERATION", proxyMetricKey: "leads", defaultGoal: "fb_post_engagement", conversionLocation: "on_ad" },
  { code: "LEADS_CALLS", objective: "OUTCOME_LEADS", label: "盡可能增加通話次數", desc: "向最有可能向您致電的受眾顯示廣告。", optimizationGoal: "LINK_CLICKS", proxyMetricKey: "calls", defaultGoal: "fb_post_engagement", conversionLocation: "on_ad" },

  { code: "APP_APP_EVENTS", objective: "OUTCOME_APP_PROMOTION", label: "取得最多應用程式事件", desc: "向最有可能在應用程式中採取特定動作的受眾顯示廣告。", optimizationGoal: "OFFSITE_CONVERSIONS", proxyMetricKey: "app_events", defaultGoal: "fb_post_engagement", conversionLocation: "app" },
  { code: "APP_INSTALLS", objective: "OUTCOME_APP_PROMOTION", label: "盡可能增加應用程式安裝次數", desc: "向最有可能安裝應用程式的受眾顯示廣告。", optimizationGoal: "APP_INSTALLS", proxyMetricKey: "app_events", defaultGoal: "fb_post_engagement", conversionLocation: "app" },
  { code: "APP_VALUE", objective: "OUTCOME_APP_PROMOTION", label: "獲得最高轉換價值", desc: "向最有可能透過特定動作產生較高價值的用戶顯示廣告。", optimizationGoal: "VALUE", proxyMetricKey: "conversions", defaultGoal: "fb_post_engagement", conversionLocation: "app" },
  { code: "APP_LINK_CLICKS", objective: "OUTCOME_APP_PROMOTION", label: "取得最多連結點擊次數", desc: "向最有可能點擊廣告的受眾顯示廣告。", optimizationGoal: "LINK_CLICKS", proxyMetricKey: "all_clicks", defaultGoal: "fb_post_engagement", conversionLocation: "website" },

  { code: "SALES_CONVERSIONS", objective: "OUTCOME_SALES", label: "取得最多轉換次數", desc: "向最有可能在網站上採取特定動作的受眾顯示廣告。", optimizationGoal: "OFFSITE_CONVERSIONS", proxyMetricKey: "conversions", defaultGoal: "fb_post_engagement", conversionLocation: "website" },
  { code: "SALES_VALUE", objective: "OUTCOME_SALES", label: "獲得最高轉換價值", desc: "向最有可能進行較高額消費的受眾顯示廣告。", optimizationGoal: "VALUE", proxyMetricKey: "conversions", defaultGoal: "fb_post_engagement", conversionLocation: "website" },
  { code: "SALES_LANDING_PAGE_VIEWS", objective: "OUTCOME_SALES", label: "取得最多連結頁面瀏覽次數", desc: "向最有可能查看廣告中所連結網站的受眾顯示廣告。", optimizationGoal: "LANDING_PAGE_VIEWS", proxyMetricKey: "all_clicks", defaultGoal: "fb_post_engagement", conversionLocation: "website" },
  { code: "SALES_LINK_CLICKS", objective: "OUTCOME_SALES", label: "盡可能提高連結點擊次數", desc: "向最有可能點擊廣告的受眾顯示廣告。", optimizationGoal: "LINK_CLICKS", proxyMetricKey: "all_clicks", defaultGoal: "fb_post_engagement", conversionLocation: "website" },
  { code: "SALES_DAILY_UNIQUE_REACH", objective: "OUTCOME_SALES", label: "盡可能增加單日不重複觸及人數", desc: "每天最多向受眾顯示一次廣告。", optimizationGoal: "REACH", proxyMetricKey: "reach", defaultGoal: "fb_reach", conversionLocation: "none" },
  { code: "SALES_IMPRESSIONS", objective: "OUTCOME_SALES", label: "盡可能提高曝光次數", desc: "盡可能提高廣告向受眾顯示的次數。", optimizationGoal: "IMPRESSIONS", proxyMetricKey: "impressions", defaultGoal: "fb_reach", conversionLocation: "none" },
  { code: "SALES_CONVERSATIONS", objective: "OUTCOME_SALES", label: "盡可能增加對話數量", desc: "向最有可能透過訊息與您對話的受眾顯示廣告。", optimizationGoal: "CONVERSATIONS", proxyMetricKey: null, defaultGoal: "fb_post_engagement", conversionLocation: "messenger" },
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
  return META_PERFORMANCE_GOALS.filter((goal) => goal.objective === objective);
}

export function getPerformanceGoal(code: string): MetaPerformanceGoalOption {
  return META_PERFORMANCE_GOALS.find((goal) => goal.code === code) ?? META_PERFORMANCE_GOALS[0];
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
  return listMetaGoals().filter((goal) => goal.objective === objective);
}
