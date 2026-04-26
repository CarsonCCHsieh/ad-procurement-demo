import type { MetaAdGoalKey } from "../lib/metaGoals";
import { queueSharedWrite } from "../lib/sharedSync";

export type MetaPresetGender = "all" | "male" | "female";

export type MetaManagedAccount = {
  id: string;
  label: string;
  adAccountId: string;
  pageId: string;
  pageName: string;
  instagramActorId: string;
  isDefault: boolean;
};

export type MetaIndustryPreset = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  recommendedGoals: MetaAdGoalKey[];
  countriesCsv: string;
  ageMin: number;
  ageMax: number;
  gender: MetaPresetGender;
  detailedTargetingText: string;
  customAudienceIdsText: string;
  excludedAudienceIdsText: string;
  audienceNote: string;
  dailyBudget: number;
  ctaType: string;
  fbPositions: string[];
  igPositions: string[];
};

export type MetaOptimizationConfig = {
  enabled: boolean;
  autoStopCheckMinutes: number;
  maxRowsPerRun: number;
  rowGapMs: number;
  minSpendForAdvice: number;
  minResultForDecision: number;
  losingRatioThreshold: number;
  lowCtrThreshold: number;
  highCpmThreshold: number;
  highCpcThreshold: number;
  highCostPerResultThreshold: number;
};

export type MetaPresetConfigV1 = {
  version: 1;
  updatedAt: string;
  optimization: MetaOptimizationConfig;
  accounts: MetaManagedAccount[];
  industries: MetaIndustryPreset[];
};

const STORAGE_KEY = "ad_demo_meta_preset_config_v1";

export const DEFAULT_META_OPTIMIZATION_CONFIG: MetaOptimizationConfig = {
  enabled: true,
  autoStopCheckMinutes: 5,
  maxRowsPerRun: 8,
  rowGapMs: 300,
  minSpendForAdvice: 150,
  minResultForDecision: 20,
  losingRatioThreshold: 0.72,
  lowCtrThreshold: 0.6,
  highCpmThreshold: 250,
  highCpcThreshold: 20,
  highCostPerResultThreshold: 60,
};

const DEFAULT_FB_POSITIONS = ["feed", "profile_feed", "story", "facebook_reels", "video_feeds", "search"];
const DEFAULT_IG_POSITIONS = ["stream", "story", "reels", "explore", "profile_feed"];

type IndustrySeed = {
  key: string;
  label: string;
  note: string;
  keywords: string[];
  goals: MetaAdGoalKey[];
};

const INDUSTRIES: IndustrySeed[] = [
  { key: "sports", label: "運動", note: "運動、健身、賽事與戶外活動。", keywords: ["運動", "健身", "跑步", "籃球", "棒球", "戶外活動"], goals: ["fb_post_engagement", "ig_reels_spread"] },
  { key: "shoes", label: "鞋類", note: "球鞋、街頭文化與鞋款品牌。", keywords: ["球鞋", "Sneakers", "Nike", "New Balance", "Adidas", "街頭文化"], goals: ["ig_post_spread", "fb_post_engagement"] },
  { key: "apparel", label: "服飾", note: "穿搭、潮流服飾與品牌風格。", keywords: ["時尚", "穿搭", "潮流服飾", "街頭品牌", "服裝設計"], goals: ["ig_post_spread", "ig_engagement"] },
  { key: "beauty", label: "美妝", note: "保養、彩妝、香氛與美容。", keywords: ["美妝", "保養", "彩妝", "香氛", "美容"], goals: ["ig_engagement", "ig_reels_spread"] },
  { key: "luxury", label: "精品", note: "精品、時尚雜誌與高端消費。", keywords: ["精品", "奢侈品", "精品購物", "時尚雜誌", "高端消費"], goals: ["fb_reach", "ig_post_spread"] },
  { key: "watch_jewelry", label: "鐘錶飾品", note: "鐘錶、珠寶、飾品與設計配件。", keywords: ["手錶", "珠寶", "飾品", "精品配件", "設計"], goals: ["fb_reach", "ig_post_spread"] },
  { key: "entertainment", label: "影劇娛樂", note: "電影、劇集、音樂與娛樂新聞。", keywords: ["電影", "劇集", "音樂", "娛樂新聞", "追星"], goals: ["fb_video_views", "ig_video_views"] },
  { key: "restaurant", label: "餐廳", note: "餐廳、美食、聚餐與咖啡廳。", keywords: ["餐廳", "美食", "咖啡廳", "聚餐", "早午餐"], goals: ["ig_post_spread", "fb_post_engagement"] },
  { key: "food_beverage", label: "食品飲料", note: "食品、飲料、零食與便利商店。", keywords: ["食品", "飲料", "零食", "咖啡", "便利商店"], goals: ["fb_reach", "ig_reels_spread"] },
  { key: "alcohol", label: "酒類", note: "酒吧、調酒、威士忌、啤酒與葡萄酒。", keywords: ["酒吧", "調酒", "威士忌", "啤酒", "葡萄酒"], goals: ["fb_reach", "ig_post_spread"] },
  { key: "daily_goods", label: "日用品", note: "生活用品、居家、清潔與量販。", keywords: ["生活用品", "居家", "清潔", "家庭", "量販"], goals: ["fb_reach", "fb_post_engagement"] },
  { key: "consumer_electronics", label: "3C家電", note: "手機、家電、科技與數位產品。", keywords: ["3C", "手機", "家電", "科技", "數位產品"], goals: ["fb_post_engagement", "ig_video_views"] },
  { key: "transportation", label: "交通運輸", note: "汽車、機車、大眾運輸與旅遊交通。", keywords: ["汽車", "機車", "大眾運輸", "旅遊交通", "租車"], goals: ["fb_reach", "fb_post_engagement"] },
  { key: "gaming", label: "遊戲類", note: "電子遊戲、手遊、電競與主機平台。", keywords: ["電子遊戲", "手遊", "電競", "Steam", "PlayStation"], goals: ["fb_video_views", "ig_reels_spread"] },
  { key: "app", label: "APP", note: "行動應用程式、效率工具與數位服務。", keywords: ["行動應用程式", "科技", "效率工具", "手機遊戲"], goals: ["fb_post_engagement", "ig_engagement"] },
  { key: "ecommerce", label: "EC平台", note: "網路購物、電商、折扣與購物平台。", keywords: ["網路購物", "電商", "折扣", "免運", "購物平台"], goals: ["fb_post_engagement", "ig_post_spread"] },
  { key: "bags_accessories", label: "包包配件", note: "包款、配件、穿搭與時尚用品。", keywords: ["包包", "配件", "飾品", "穿搭", "時尚"], goals: ["ig_post_spread", "ig_engagement"] },
  { key: "travel", label: "旅遊業", note: "自由行、飯店、航空與景點。", keywords: ["旅遊", "自由行", "飯店", "航空", "景點"], goals: ["fb_reach", "ig_reels_spread"] },
  { key: "finance_insurance", label: "金融保險", note: "理財、保險、信用卡與金融服務。", keywords: ["理財", "保險", "信用卡", "投資", "金融服務"], goals: ["fb_reach", "fb_post_engagement"] },
  { key: "retail", label: "零售通路", note: "百貨、量販、超商與門市購物。", keywords: ["百貨", "量販", "超商", "購物", "門市"], goals: ["fb_reach", "ig_post_spread"] },
  { key: "eyewear", label: "光學眼鏡", note: "眼鏡、太陽眼鏡、視力保健與配件。", keywords: ["眼鏡", "太陽眼鏡", "視力保健", "時尚配件"], goals: ["ig_post_spread", "fb_post_engagement"] },
  { key: "telecom", label: "電信通訊", note: "5G、手機方案、網路服務與科技。", keywords: ["電信", "5G", "手機方案", "網路服務", "科技"], goals: ["fb_reach", "fb_post_engagement"] },
  { key: "health_medicine", label: "健康醫藥", note: "健康、保健、醫療與營養補充。", keywords: ["健康", "保健", "醫療", "藥局", "營養補充"], goals: ["fb_reach", "ig_post_spread"] },
  { key: "government_politics", label: "政府政黨", note: "公共議題、政策、公民參與與社會議題。", keywords: ["公共議題", "政策", "公民參與", "社會議題"], goals: ["fb_reach", "fb_post_engagement"] },
  { key: "education", label: "文教", note: "教育、學習、課程與親子教育。", keywords: ["教育", "學習", "語言學習", "課程", "親子教育"], goals: ["fb_post_engagement", "ig_video_views"] },
  { key: "real_estate", label: "房地產", note: "買房、租屋、室內設計與居家。", keywords: ["房地產", "室內設計", "買房", "租屋", "居家"], goals: ["fb_reach", "fb_post_engagement"] },
  { key: "baby", label: "嬰幼兒", note: "育兒、嬰兒用品、親子與家庭。", keywords: ["育兒", "嬰兒用品", "親子", "媽媽", "家庭"], goals: ["fb_post_engagement", "ig_post_spread"] },
  { key: "aesthetic_medicine", label: "醫美", note: "醫美、美容、皮膚管理與保養。", keywords: ["醫美", "美容", "保養", "皮膚管理", "健康"], goals: ["ig_engagement", "fb_reach"] },
  { key: "other", label: "其他", note: "生活風格、流行文化、娛樂與社群媒體。", keywords: ["生活風格", "流行文化", "娛樂", "購物", "社群媒體"], goals: ["fb_post_engagement", "ig_post_spread"] },
];

function nowIso() {
  return new Date().toISOString();
}

function buildTargetingText(seed: IndustrySeed) {
  return seed.keywords.map((keyword) => `# ${keyword}`).join("\n");
}

function buildDefaultIndustries(): MetaIndustryPreset[] {
  return INDUSTRIES.map((industry) => ({
    key: industry.key,
    label: industry.label,
    description: `${industry.label}產業安全預設模板`,
    enabled: true,
    recommendedGoals: industry.goals,
    countriesCsv: "TW",
    ageMin: 18,
    ageMax: 49,
    gender: "all",
    detailedTargetingText: buildTargetingText(industry),
    customAudienceIdsText: "",
    excludedAudienceIdsText: "",
    audienceNote: industry.note,
    dailyBudget: 1000,
    ctaType: "LEARN_MORE",
    fbPositions: DEFAULT_FB_POSITIONS,
    igPositions: DEFAULT_IG_POSITIONS,
  }));
}

export const DEFAULT_META_PRESET_CONFIG: MetaPresetConfigV1 = {
  version: 1,
  updatedAt: nowIso(),
  optimization: { ...DEFAULT_META_OPTIMIZATION_CONFIG },
  accounts: [],
  industries: buildDefaultIndustries(),
};

function normalize(raw: unknown): MetaPresetConfigV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<MetaPresetConfigV1>;
  const defaults = buildDefaultIndustries();
  return {
    version: 1,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : nowIso(),
    optimization: { ...DEFAULT_META_OPTIMIZATION_CONFIG, ...(row.optimization ?? {}) },
    accounts: Array.isArray(row.accounts) ? row.accounts.map((account, index) => ({
      id: String(account?.id || `account-${index + 1}`),
      label: String(account?.label || account?.adAccountId || `廣告帳號 ${index + 1}`),
      adAccountId: String(account?.adAccountId || "").replace(/^act_/i, ""),
      pageId: String(account?.pageId || ""),
      pageName: String(account?.pageName || ""),
      instagramActorId: String(account?.instagramActorId || ""),
      isDefault: !!account?.isDefault,
    })) : [],
    industries: Array.isArray(row.industries) && row.industries.length > 0
      ? row.industries.map((industry, index) => ({
          ...defaults[index % defaults.length],
          ...industry,
          key: String(industry?.key || `industry-${index + 1}`),
          label: String(industry?.label || `產業 ${index + 1}`),
          recommendedGoals: Array.isArray(industry?.recommendedGoals) && industry.recommendedGoals.length > 0
            ? industry.recommendedGoals as MetaAdGoalKey[]
            : ["fb_post_engagement"],
          fbPositions: Array.isArray(industry?.fbPositions) ? industry.fbPositions.map(String) : DEFAULT_FB_POSITIONS,
          igPositions: Array.isArray(industry?.igPositions) ? industry.igPositions.map(String) : DEFAULT_IG_POSITIONS,
        }))
      : defaults,
  };
}

export function getMetaPresetConfig(): MetaPresetConfigV1 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? normalize(JSON.parse(raw)) : null;
    return parsed ?? DEFAULT_META_PRESET_CONFIG;
  } catch {
    return DEFAULT_META_PRESET_CONFIG;
  }
}

export function saveMetaPresetConfig(next: MetaPresetConfigV1) {
  const normalized = normalize(next) ?? DEFAULT_META_PRESET_CONFIG;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...normalized, updatedAt: nowIso() }));
    queueSharedWrite(STORAGE_KEY);
  } catch {
    // ignore cache write failures
  }
}

export function resetMetaPresetConfig() {
  saveMetaPresetConfig(DEFAULT_META_PRESET_CONFIG);
}

export function getDefaultMetaIndustry(config = getMetaPresetConfig()): MetaIndustryPreset | null {
  return config.industries.find((industry) => industry.enabled) ?? config.industries[0] ?? null;
}

export function getManagedMetaAccount(config: MetaPresetConfigV1, accountId?: string): MetaManagedAccount | null {
  return (
    config.accounts.find((account) => account.id === accountId || account.adAccountId === accountId?.replace(/^act_/i, "")) ??
    config.accounts.find((account) => account.isDefault) ??
    config.accounts[0] ??
    null
  );
}
