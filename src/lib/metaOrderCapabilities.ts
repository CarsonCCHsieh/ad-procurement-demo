import {
  getGoalPrimaryMetricKey,
  getPerformanceGoal,
  type MetaAdGoalKey,
  type MetaCampaignObjective,
  type MetaKpiMetricKey,
} from "./metaGoals";

const PRIMARY_METRIC_LABEL: Record<MetaKpiMetricKey, string> = {
  likes: "按讚數",
  all_clicks: "所有點擊",
  comments: "留言數",
  shares: "分享數",
  interactions_total: "總互動",
  impressions: "曝光數",
  reach: "觸及數",
  video_3s_views: "3 秒觀看",
  thruplays: "ThruPlay",
  followers: "增粉數",
  profile_visits: "個人檔案瀏覽",
  leads: "潛在顧客",
  conversions: "轉換數",
  app_events: "App 事件",
  calls: "通話數",
  spend: "花費",
};

export const CONVERSION_LOCATION_OPTIONS: Record<string, { value: string; label: string }[]> = {
  none: [],
  website: [{ value: "website", label: "網站" }],
  on_ad: [{ value: "on_ad", label: "貼文或 Meta 表單" }],
  messenger: [{ value: "messenger", label: "Messenger" }],
  instagram_profile: [{ value: "instagram_profile", label: "Instagram 個人檔案" }],
  app: [{ value: "app", label: "應用程式" }],
};

export const WEB_CONVERSION_EVENT_OPTIONS = [
  { value: "PURCHASE", label: "購買" },
  { value: "LEAD", label: "名單" },
  { value: "COMPLETE_REGISTRATION", label: "完成註冊" },
  { value: "ADD_TO_CART", label: "加入購物車" },
  { value: "INITIATE_CHECKOUT", label: "開始結帳" },
  { value: "CONTACT", label: "聯絡" },
  { value: "SUBSCRIBE", label: "訂閱" },
  { value: "VIEW_CONTENT", label: "內容瀏覽" },
];

export const APP_EVENT_OPTIONS = [
  { value: "MOBILE_APP_INSTALL", label: "App 安裝" },
  { value: "PURCHASE", label: "購買" },
  { value: "ADD_TO_CART", label: "加入購物車" },
  { value: "COMPLETE_REGISTRATION", label: "完成註冊" },
  { value: "ACHIEVEMENT_UNLOCKED", label: "達成成就" },
  { value: "TUTORIAL_COMPLETION", label: "完成教學" },
];

export function getPerformanceGoalTargetLabel(performanceGoalCode: string, fallbackGoal: MetaAdGoalKey): string {
  const metricKey = getTrackedMetricKeyForPerformanceGoal(performanceGoalCode, fallbackGoal);
  if (metricKey) return PRIMARY_METRIC_LABEL[metricKey] ?? metricKey;
  return getPerformanceGoal(performanceGoalCode).label;
}

export function getTrackedMetricKeyForPerformanceGoal(
  performanceGoalCode: string,
  fallbackGoal: MetaAdGoalKey,
): MetaKpiMetricKey | null {
  return getPerformanceGoal(performanceGoalCode).proxyMetricKey ?? getGoalPrimaryMetricKey(fallbackGoal);
}

export function getRecommendedConversionLocation(_objective: MetaCampaignObjective, performanceGoalCode: string): string {
  return getPerformanceGoal(performanceGoalCode).conversionLocation;
}

export function getConversionLocationOptions(
  _objective: MetaCampaignObjective,
  performanceGoalCode: string,
): Array<{ value: string; label: string }> {
  const key = getPerformanceGoal(performanceGoalCode).conversionLocation;
  return CONVERSION_LOCATION_OPTIONS[key] ?? [];
}

export function needsDestinationUrl(_objective: MetaCampaignObjective, conversionLocation: string): boolean {
  return conversionLocation === "website";
}

export function needsPixelSetup(
  objective: MetaCampaignObjective,
  performanceGoalCode: string,
  conversionLocation: string,
): boolean {
  if (conversionLocation !== "website") return false;
  const code = performanceGoalCode.toUpperCase();
  return objective === "OUTCOME_LEADS" || objective === "OUTCOME_SALES" || code.includes("CONVERSIONS") || code.includes("VALUE");
}

export function needsAppSetup(
  objective: MetaCampaignObjective,
  _performanceGoalCode: string,
  conversionLocation: string,
): boolean {
  return objective === "OUTCOME_APP_PROMOTION" || conversionLocation === "app";
}

export function getConversionLocationLabel(value: string): string {
  return Object.values(CONVERSION_LOCATION_OPTIONS).flat().find((option) => option.value === value)?.label ?? value;
}
