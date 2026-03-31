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
  enabled: boolean;
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
  useExistingPost: boolean;
  fbPositions: string[];
  igPositions: string[];
};

export type MetaOptimizationConfig = {
  enabled: boolean;
  minSpendForAdvice: number;
  lowCtrThreshold: number;
  highCpmThreshold: number;
  highCpcThreshold: number;
  highCostPerResultThreshold: number;
};

export type MetaPresetConfigV1 = {
  version: 1;
  updatedAt: string;
  defaultAccountId: string;
  autoStopCheckMinutes: number;
  optimization: MetaOptimizationConfig;
  accounts: MetaManagedAccount[];
  industries: MetaIndustryPreset[];
};

const STORAGE_KEY = "ad_demo_meta_preset_config_v1";

const DEFAULT_FB_POSITIONS = ["feed", "profile_feed", "story", "facebook_reels", "video_feeds", "search"];
const DEFAULT_IG_POSITIONS = ["stream", "story", "reels", "explore"];
const ALLOWED_GOALS: MetaAdGoalKey[] = [
  "fb_post_likes",
  "fb_post_engagement",
  "fb_reach",
  "fb_video_views",
  "ig_post_spread",
  "ig_reels_spread",
  "ig_video_views",
  "ig_engagement",
  "ig_followers",
];

export const DEFAULT_META_OPTIMIZATION_CONFIG: MetaOptimizationConfig = {
  enabled: true,
  minSpendForAdvice: 500,
  lowCtrThreshold: 0.8,
  highCpmThreshold: 220,
  highCpcThreshold: 18,
  highCostPerResultThreshold: 45,
};

function isoNow() {
  return new Date().toISOString();
}

function normalizeKey(raw: string) {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

function uniqueStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const value = String(item ?? "").trim();
    if (!value || out.includes(value)) continue;
    out.push(value);
  }
  return out;
}

function normalizeAccount(raw: unknown, index: number): MetaManagedAccount | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<MetaManagedAccount>;
  const id = normalizeKey(String(row.id || `account_${index + 1}`)) || `account_${index + 1}`;
  const adAccountId = String(row.adAccountId || "").trim().replace(/^act_/i, "");
  return {
    id,
    label: String(row.label || `帳號 ${index + 1}`).trim() || `帳號 ${index + 1}`,
    adAccountId,
    pageId: String(row.pageId || "").trim(),
    pageName: String(row.pageName || "").trim(),
    instagramActorId: String(row.instagramActorId || "").trim(),
    enabled: row.enabled !== false,
  };
}

function normalizeIndustry(raw: unknown, index: number): MetaIndustryPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<MetaIndustryPreset>;
  const key = normalizeKey(String(row.key || `industry_${index + 1}`)) || `industry_${index + 1}`;
  const goals = uniqueStrings(row.recommendedGoals).filter((value): value is MetaAdGoalKey =>
    ALLOWED_GOALS.includes(value as MetaAdGoalKey),
  );
  const ageMin = Number(row.ageMin);
  const ageMax = Number(row.ageMax);
  const dailyBudget = Number(row.dailyBudget);
  const gender = row.gender === "male" || row.gender === "female" ? row.gender : "all";

  return {
    key,
    label: String(row.label || `產業 ${index + 1}`).trim() || `產業 ${index + 1}`,
    description: String(row.description || "").trim(),
    enabled: row.enabled !== false,
    recommendedGoals: goals,
    countriesCsv: String(row.countriesCsv || "TW").trim() || "TW",
    ageMin: Number.isFinite(ageMin) && ageMin >= 13 ? Math.floor(ageMin) : 18,
    ageMax:
      Number.isFinite(ageMax) && ageMax >= 13
        ? Math.max(Math.floor(ageMax), Number.isFinite(ageMin) ? Math.floor(ageMin) : 18)
        : 49,
    gender,
    detailedTargetingText: String(row.detailedTargetingText || "").trim(),
    customAudienceIdsText: String(row.customAudienceIdsText || "").trim(),
    excludedAudienceIdsText: String(row.excludedAudienceIdsText || "").trim(),
    audienceNote: String(row.audienceNote || "").trim(),
    dailyBudget: Number.isFinite(dailyBudget) && dailyBudget > 0 ? Math.round(dailyBudget) : 1000,
    ctaType: String(row.ctaType || "LEARN_MORE").trim() || "LEARN_MORE",
    useExistingPost: row.useExistingPost !== false,
    fbPositions: uniqueStrings(row.fbPositions).length > 0 ? uniqueStrings(row.fbPositions) : [...DEFAULT_FB_POSITIONS],
    igPositions: uniqueStrings(row.igPositions).length > 0 ? uniqueStrings(row.igPositions) : [...DEFAULT_IG_POSITIONS],
  };
}

function normalizeOptimization(raw: unknown): MetaOptimizationConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_META_OPTIMIZATION_CONFIG };
  const row = raw as Partial<MetaOptimizationConfig>;
  const minSpendForAdvice = Number(row.minSpendForAdvice);
  const lowCtrThreshold = Number(row.lowCtrThreshold);
  const highCpmThreshold = Number(row.highCpmThreshold);
  const highCpcThreshold = Number(row.highCpcThreshold);
  const highCostPerResultThreshold = Number(row.highCostPerResultThreshold);

  return {
    enabled: row.enabled !== false,
    minSpendForAdvice:
      Number.isFinite(minSpendForAdvice) && minSpendForAdvice >= 0 ? Math.round(minSpendForAdvice) : DEFAULT_META_OPTIMIZATION_CONFIG.minSpendForAdvice,
    lowCtrThreshold:
      Number.isFinite(lowCtrThreshold) && lowCtrThreshold >= 0 ? Number(lowCtrThreshold.toFixed(2)) : DEFAULT_META_OPTIMIZATION_CONFIG.lowCtrThreshold,
    highCpmThreshold:
      Number.isFinite(highCpmThreshold) && highCpmThreshold >= 0 ? Number(highCpmThreshold.toFixed(2)) : DEFAULT_META_OPTIMIZATION_CONFIG.highCpmThreshold,
    highCpcThreshold:
      Number.isFinite(highCpcThreshold) && highCpcThreshold >= 0 ? Number(highCpcThreshold.toFixed(2)) : DEFAULT_META_OPTIMIZATION_CONFIG.highCpcThreshold,
    highCostPerResultThreshold:
      Number.isFinite(highCostPerResultThreshold) && highCostPerResultThreshold >= 0
        ? Number(highCostPerResultThreshold.toFixed(2))
        : DEFAULT_META_OPTIMIZATION_CONFIG.highCostPerResultThreshold,
  };
}

function buildDefaultIndustries(): MetaIndustryPreset[] {
  return [
    {
      key: "sneakers",
      label: "球鞋",
      description: "偏潮流、街頭、球鞋文化相關受眾。",
      enabled: true,
      recommendedGoals: ["fb_post_engagement", "ig_engagement", "ig_reels_spread"],
      countriesCsv: "TW",
      ageMin: 18,
      ageMax: 39,
      gender: "all",
      detailedTargetingText: "",
      customAudienceIdsText: "",
      excludedAudienceIdsText: "",
      audienceNote: "可放入球鞋、潮流、街頭文化、品牌粉絲相關受眾。",
      dailyBudget: 1200,
      ctaType: "VIEW_MORE",
      useExistingPost: true,
      fbPositions: ["feed", "profile_feed", "story", "facebook_reels"],
      igPositions: ["stream", "story", "reels", "explore"],
    },
    {
      key: "movie",
      label: "電影",
      description: "偏娛樂、預告片、上映宣傳類型。",
      enabled: true,
      recommendedGoals: ["fb_video_views", "fb_reach", "ig_video_views"],
      countriesCsv: "TW",
      ageMin: 18,
      ageMax: 49,
      gender: "all",
      detailedTargetingText: "",
      customAudienceIdsText: "",
      excludedAudienceIdsText: "",
      audienceNote: "可放入電影、串流平台、影劇新片、品牌粉絲受眾。",
      dailyBudget: 1500,
      ctaType: "VIEW_MORE",
      useExistingPost: true,
      fbPositions: ["video_feeds", "feed", "story", "facebook_reels"],
      igPositions: ["reels", "story", "stream"],
    },
    {
      key: "food_beverage",
      label: "食品飲料",
      description: "偏品牌曝光、檔期活動、新品推廣。",
      enabled: true,
      recommendedGoals: ["fb_reach", "fb_post_engagement", "ig_post_spread"],
      countriesCsv: "TW",
      ageMin: 18,
      ageMax: 49,
      gender: "all",
      detailedTargetingText: "",
      customAudienceIdsText: "",
      excludedAudienceIdsText: "",
      audienceNote: "可放入美食、餐廳、手搖飲、便利商店等受眾。",
      dailyBudget: 1000,
      ctaType: "LEARN_MORE",
      useExistingPost: true,
      fbPositions: ["feed", "story", "search", "marketplace"],
      igPositions: ["stream", "story", "explore"],
    },
    {
      key: "alcohol",
      label: "酒類",
      description: "需注意法規與年齡限制。",
      enabled: true,
      recommendedGoals: ["fb_reach", "ig_engagement", "ig_reels_spread"],
      countriesCsv: "TW",
      ageMin: 25,
      ageMax: 49,
      gender: "all",
      detailedTargetingText: "",
      customAudienceIdsText: "",
      excludedAudienceIdsText: "",
      audienceNote: "建議放入成熟族群、餐酒館、品酒、生活風格受眾。",
      dailyBudget: 1200,
      ctaType: "VIEW_MORE",
      useExistingPost: true,
      fbPositions: ["feed", "story", "facebook_reels"],
      igPositions: ["stream", "story", "reels"],
    },
  ];
}

export const DEFAULT_META_PRESET_CONFIG: MetaPresetConfigV1 = {
  version: 1,
  updatedAt: isoNow(),
  defaultAccountId: "",
  autoStopCheckMinutes: 5,
  optimization: { ...DEFAULT_META_OPTIMIZATION_CONFIG },
  accounts: [],
  industries: buildDefaultIndustries(),
};

function normalize(raw: unknown): MetaPresetConfigV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<MetaPresetConfigV1>;
  const accounts = Array.isArray(row.accounts)
    ? row.accounts.map((item, index) => normalizeAccount(item, index)).filter((item): item is MetaManagedAccount => !!item)
    : [];
  const industries = Array.isArray(row.industries)
    ? row.industries.map((item, index) => normalizeIndustry(item, index)).filter((item): item is MetaIndustryPreset => !!item)
    : buildDefaultIndustries();
  const defaultAccountId = String(row.defaultAccountId || "").trim();
  const autoStopCheckMinutes = Number(row.autoStopCheckMinutes);
  const optimization = normalizeOptimization(row.optimization);

  return {
    version: 1,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : isoNow(),
    defaultAccountId:
      accounts.some((account) => account.id === defaultAccountId && account.enabled)
        ? defaultAccountId
        : accounts.find((account) => account.enabled)?.id || "",
    autoStopCheckMinutes:
      Number.isFinite(autoStopCheckMinutes) && autoStopCheckMinutes >= 1 && autoStopCheckMinutes <= 60
        ? Math.floor(autoStopCheckMinutes)
        : 5,
    optimization,
    accounts,
    industries: industries.length > 0 ? industries : buildDefaultIndustries(),
  };
}

export function getMetaPresetConfig(): MetaPresetConfigV1 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_META_PRESET_CONFIG;
    return normalize(JSON.parse(raw)) ?? DEFAULT_META_PRESET_CONFIG;
  } catch {
    return DEFAULT_META_PRESET_CONFIG;
  }
}

export function saveMetaPresetConfig(next: MetaPresetConfigV1) {
  const normalized = normalize(next) ?? DEFAULT_META_PRESET_CONFIG;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...normalized,
        updatedAt: isoNow(),
      }),
    );
    queueSharedWrite(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function resetMetaPresetConfig() {
  saveMetaPresetConfig(DEFAULT_META_PRESET_CONFIG);
}

export function getDefaultMetaIndustry(config = getMetaPresetConfig()): MetaIndustryPreset | null {
  return config.industries.find((industry) => industry.enabled) ?? null;
}

export function getManagedMetaAccount(config: MetaPresetConfigV1, accountId?: string): MetaManagedAccount | null {
  const selectedId = String(accountId || "").trim() || config.defaultAccountId;
  const selected = config.accounts.find((account) => account.id === selectedId && account.enabled);
  if (selected) return selected;
  return config.accounts.find((account) => account.enabled) ?? null;
}
