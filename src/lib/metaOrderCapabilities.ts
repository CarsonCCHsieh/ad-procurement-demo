import { getGoalPrimaryMetricKey, type MetaAdGoalKey, type MetaCampaignObjective, type MetaKpiMetricKey } from "./metaGoals";

const PRIMARY_METRIC_LABEL: Record<MetaKpiMetricKey, string> = {
  likes: "按讚數",
  all_clicks: "所有點擊",
  comments: "留言數",
  shares: "分享數",
  interactions_total: "互動總數",
  impressions: "曝光數",
  reach: "觸及數",
  video_3s_views: "3秒觀看",
  thruplays: "完整觀看",
  followers: "增粉數",
  profile_visits: "個人檔案造訪",
  spend: "花費",
};

export const CONVERSION_LOCATION_OPTIONS: Record<
  string,
  { value: string; label: string }[]
> = {
  website: [{ value: "website", label: "網站" }],
  messenger: [{ value: "messenger", label: "Messenger" }],
  instagram_profile: [{ value: "instagram_profile", label: "Instagram 個人檔案" }],
  on_ad: [{ value: "on_ad", label: "Meta 內表單 / 直接互動" }],
  app: [{ value: "app", label: "應用程式" }],
  lead_flexible: [
    { value: "website", label: "網站" },
    { value: "on_ad", label: "Meta 內表單 / 直接互動" },
    { value: "messenger", label: "Messenger" },
  ],
};

export const WEB_CONVERSION_EVENT_OPTIONS = [
  { value: "PURCHASE", label: "PURCHASE 購買" },
  { value: "LEAD", label: "LEAD 名單" },
  { value: "COMPLETE_REGISTRATION", label: "COMPLETE_REGISTRATION 完成註冊" },
  { value: "ADD_TO_CART", label: "ADD_TO_CART 加入購物車" },
  { value: "INITIATE_CHECKOUT", label: "INITIATE_CHECKOUT 開始結帳" },
  { value: "CONTACT", label: "CONTACT 聯絡" },
  { value: "SUBSCRIBE", label: "SUBSCRIBE 訂閱" },
  { value: "VIEW_CONTENT", label: "VIEW_CONTENT 內容瀏覽" },
];

export const APP_EVENT_OPTIONS = [
  { value: "MOBILE_APP_INSTALL", label: "MOBILE_APP_INSTALL 安裝" },
  { value: "PURCHASE", label: "PURCHASE 購買" },
  { value: "ADD_TO_CART", label: "ADD_TO_CART 加入購物車" },
  { value: "COMPLETE_REGISTRATION", label: "COMPLETE_REGISTRATION 完成註冊" },
  { value: "ACHIEVEMENT_UNLOCKED", label: "ACHIEVEMENT_UNLOCKED 達成成就" },
  { value: "TUTORIAL_COMPLETION", label: "TUTORIAL_COMPLETION 完成教學" },
];

function getPrimaryMetricLabel(goal: MetaAdGoalKey): string {
  return PRIMARY_METRIC_LABEL[getGoalPrimaryMetricKey(goal)] ?? "目標數值";
}

export function getPerformanceGoalTargetLabel(performanceGoalCode: string, fallbackGoal: MetaAdGoalKey): string {
  if (performanceGoalCode.includes("DAILY_UNIQUE_REACH")) return "單日不重複觸及人數";
  if (performanceGoalCode.includes("REACH")) return "觸及人數";
  if (performanceGoalCode.includes("IMPRESSIONS")) return "曝光次數";
  if (performanceGoalCode.includes("AD_RECALL")) return "廣告回想提升幅度";
  if (performanceGoalCode.includes("THRUPLAY")) return "ThruPlay 觀看次數";
  if (performanceGoalCode.includes("2S_CONTINUOUS_VIDEO_VIEWS")) return "連續觀看 2 秒以上次數";
  if (performanceGoalCode.includes("LANDING_PAGE_VIEWS")) return "連結頁面瀏覽次數";
  if (performanceGoalCode.includes("LINK_CLICKS")) return "連結點擊次數";
  if (performanceGoalCode.includes("CONVERSATIONS")) return "對話數量";
  if (performanceGoalCode.includes("INSTAGRAM_PROFILE")) return "Instagram 個人檔案瀏覽次數";
  if (performanceGoalCode.includes("CALLS")) return "通話次數";
  if (performanceGoalCode.includes("POST_ENGAGEMENT")) return "貼文互動數";
  if (performanceGoalCode.includes("EVENT_RESPONSES")) return "活動回覆數量";
  if (performanceGoalCode.includes("CONVERSIONS")) return "轉換次數";
  if (performanceGoalCode.includes("APP_EVENTS")) return "應用程式事件";
  if (performanceGoalCode.includes("REMINDERS")) return "提醒設定數量";
  if (performanceGoalCode.includes("PAGE_LIKES")) return "粉絲專頁按讚數";
  if (performanceGoalCode.includes("MAXIMIZE_LEADS")) return "潛在顧客人數";
  if (performanceGoalCode.includes("QUALIFIED_LEADS")) return "採取轉換動作的潛在顧客人數";
  if (performanceGoalCode.includes("MESSAGE_LEADS")) return "透過訊息成為潛在顧客的人數";
  if (performanceGoalCode.includes("INSTALLS")) return "應用程式安裝次數";
  if (performanceGoalCode.includes("VALUE")) return "轉換價值";
  if (performanceGoalCode.includes("MESSAGE_PURCHASES")) return "透過訊息購買次數";
  return getPrimaryMetricLabel(fallbackGoal);
}

export function getTrackedMetricKeyForPerformanceGoal(
  performanceGoalCode: string,
  fallbackGoal: MetaAdGoalKey,
): MetaKpiMetricKey | null {
  if (performanceGoalCode.includes("DAILY_UNIQUE_REACH") || performanceGoalCode.includes("REACH")) return "reach";
  if (performanceGoalCode.includes("IMPRESSIONS")) return "impressions";
  if (performanceGoalCode.includes("THRUPLAY")) return "thruplays";
  if (performanceGoalCode.includes("2S_CONTINUOUS_VIDEO_VIEWS")) return "video_3s_views";
  if (performanceGoalCode.includes("LINK_CLICKS") || performanceGoalCode.includes("LANDING_PAGE_VIEWS")) {
    return "all_clicks";
  }
  if (performanceGoalCode.includes("INSTAGRAM_PROFILE")) return "profile_visits";
  if (performanceGoalCode.includes("POST_ENGAGEMENT")) return "interactions_total";
  if (performanceGoalCode.includes("PAGE_LIKES")) return null;
  if (performanceGoalCode.includes("AD_RECALL")) return null;
  if (performanceGoalCode.includes("EVENT_RESPONSES")) return null;
  if (performanceGoalCode.includes("CONVERSIONS")) return null;
  if (performanceGoalCode.includes("APP_EVENTS")) return null;
  if (performanceGoalCode.includes("REMINDERS")) return null;
  if (performanceGoalCode.includes("CALLS")) return null;
  if (performanceGoalCode.includes("CONVERSATIONS") || performanceGoalCode.includes("MESSAGE")) return null;
  if (performanceGoalCode.includes("MAXIMIZE_LEADS") || performanceGoalCode.includes("QUALIFIED_LEADS")) return null;
  if (performanceGoalCode.includes("INSTALLS") || performanceGoalCode.includes("VALUE")) return null;
  return getGoalPrimaryMetricKey(fallbackGoal);
}

export function isAppDrivenPerformanceGoal(objective: MetaCampaignObjective, performanceGoalCode: string): boolean {
  return (
    objective === "OUTCOME_APP_PROMOTION" ||
    performanceGoalCode.includes("APP_EVENTS") ||
    performanceGoalCode.includes("INSTALLS")
  );
}

export function getRecommendedConversionLocation(objective: MetaCampaignObjective, performanceGoalCode: string): string {
  if (isAppDrivenPerformanceGoal(objective, performanceGoalCode)) return "app";
  if (performanceGoalCode.includes("INSTAGRAM_PROFILE")) return "instagram_profile";
  if (performanceGoalCode.includes("CALLS")) return "on_ad";
  if (performanceGoalCode.includes("CONVERSATIONS") || performanceGoalCode.includes("MESSAGE")) return "messenger";
  if (objective === "OUTCOME_LEADS" && performanceGoalCode === "LEADS_MAXIMIZE_LEADS") return "on_ad";
  return "website";
}

export function getConversionLocationOptions(
  objective: MetaCampaignObjective,
  performanceGoalCode: string,
): Array<{ value: string; label: string }> {
  if (objective === "OUTCOME_AWARENESS") return [];
  if (isAppDrivenPerformanceGoal(objective, performanceGoalCode)) return CONVERSION_LOCATION_OPTIONS.app;
  if (performanceGoalCode.includes("INSTAGRAM_PROFILE")) return CONVERSION_LOCATION_OPTIONS.instagram_profile;
  if (performanceGoalCode.includes("CALLS")) return CONVERSION_LOCATION_OPTIONS.on_ad;
  if (performanceGoalCode.includes("CONVERSATIONS") || performanceGoalCode.includes("MESSAGE")) {
    return CONVERSION_LOCATION_OPTIONS.messenger;
  }
  if (objective === "OUTCOME_LEADS" && performanceGoalCode === "LEADS_MAXIMIZE_LEADS") {
    return CONVERSION_LOCATION_OPTIONS.lead_flexible;
  }
  return CONVERSION_LOCATION_OPTIONS.website;
}

export function needsDestinationUrl(
  objective: MetaCampaignObjective,
  conversionLocation: string,
): boolean {
  if (objective === "OUTCOME_AWARENESS") return false;
  return conversionLocation === "website";
}

export function needsPixelSetup(
  objective: MetaCampaignObjective,
  performanceGoalCode: string,
  conversionLocation: string,
): boolean {
  if (conversionLocation !== "website") return false;
  if (!(objective === "OUTCOME_LEADS" || objective === "OUTCOME_SALES" || objective === "OUTCOME_ENGAGEMENT")) {
    return false;
  }
  return (
    performanceGoalCode.includes("CONVERSIONS") ||
    performanceGoalCode.includes("VALUE") ||
    performanceGoalCode.includes("QUALIFIED_LEADS")
  );
}

export function needsAppSetup(
  objective: MetaCampaignObjective,
  performanceGoalCode: string,
  conversionLocation: string,
): boolean {
  return conversionLocation === "app" || isAppDrivenPerformanceGoal(objective, performanceGoalCode);
}

export function getConversionLocationLabel(value: string): string {
  return (
    Object.values(CONVERSION_LOCATION_OPTIONS)
      .flat()
      .find((option) => option.value === value)?.label ?? value
  );
}
