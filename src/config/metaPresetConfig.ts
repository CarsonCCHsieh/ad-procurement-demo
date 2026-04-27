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

const STORAGE_KEY = "ad_demo_meta_preset_config_v4";

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
  audienceQueries: string[];
  goals: MetaAdGoalKey[];
};

const INDUSTRIES: IndustrySeed[] = [
  { key: "sports", label: "運動", note: "運動、健身、賽事與戶外活動。", audienceQueries: ["Fitness and wellness", "Sportswear", "Running", "Gym", "Weight training", "Yoga", "Marathon", "Outdoor recreation", "Sports", "Basketball", "Baseball", "Cycling", "Hiking", "Health and wellness", "Athleisure", "Decathlon"], goals: ["fb_post_engagement", "ig_reels_spread"] },
  { key: "shoes", label: "鞋類", note: "球鞋、街頭文化與鞋款品牌。", audienceQueries: ["Sneakers", "Nike", "Adidas", "New Balance", "Air Jordan", "Converse", "Vans", "Footwear", "Streetwear", "Hypebeast", "Highsnobiety", "Fashion accessories", "Athleisure", "Skateboarding", "Sneaker collecting", "Urban culture"], goals: ["ig_post_spread", "fb_post_engagement"] },
  { key: "apparel", label: "服飾", note: "穿搭、潮流服飾與品牌風格。", audienceQueries: ["Fashion", "Clothing", "Streetwear", "Fashion design", "Outfit of the day", "Zara", "UNIQLO", "H&M", "Vogue", "ELLE", "GQ", "Lifestyle", "Online shopping", "Department store", "Fashion week", "Beauty"], goals: ["ig_post_spread", "ig_engagement"] },
  { key: "beauty", label: "美妝", note: "保養、彩妝、香氛與美容。", audienceQueries: ["Beauty", "Skin care", "Makeup", "Cosmetics", "Perfume", "Sephora", "Watsons", "Sasa", "Vogue", "ELLE", "Fashion", "K-beauty", "Dermatology", "Hair care", "Nail art", "Wellness"], goals: ["ig_engagement", "ig_reels_spread"] },
  { key: "luxury", label: "精品", note: "精品、時尚雜誌與高端消費。", audienceQueries: ["Luxury goods", "Gucci", "Louis Vuitton", "Chanel", "Prada", "Dior", "Hermes", "Burberry", "Luxury lifestyle", "Vogue", "GQ", "High fashion", "Fine jewelry", "Watches", "Business class", "Luxury travel"], goals: ["fb_reach", "ig_post_spread"] },
  { key: "watch_jewelry", label: "鐘錶飾品", note: "鐘錶、珠寶、飾品與設計配件。", audienceQueries: ["Watches", "Jewelry", "Rolex", "Omega", "Cartier", "Tiffany & Co.", "Bracelet", "Necklace", "Luxury goods", "Fashion accessories", "Wedding", "Engagement ring", "Gift", "Vogue", "GQ", "Luxury lifestyle"], goals: ["fb_reach", "ig_post_spread"] },
  { key: "entertainment", label: "影劇娛樂", note: "電影、劇集、音樂與娛樂新聞。", audienceQueries: ["Movies", "Television", "Netflix", "Disney+", "Cinema", "Film", "Drama", "Entertainment", "Pop culture", "Celebrity", "YouTube", "Anime", "Music", "K-pop", "Movie theater", "IMDb"], goals: ["fb_video_views", "ig_video_views"] },
  { key: "restaurant", label: "餐廳", note: "餐廳、美食、聚餐與咖啡廳。", audienceQueries: ["Restaurants", "Foodie", "Fine dining", "Cafe", "Brunch", "Dining out", "Michelin Guide", "Food delivery", "Travel", "Date night", "Family", "Lifestyle", "Nightlife", "Coffee", "Dessert", "Instagram food"], goals: ["ig_post_spread", "fb_post_engagement"] },
  { key: "food_beverage", label: "食品飲料", note: "食品、飲料、零食與便利商店。", audienceQueries: ["Food and drink", "Snack food", "Beverage", "Convenience store", "Supermarket", "Grocery store", "Dessert", "Bubble tea", "Cooking", "Home cooking", "Family", "Office", "Healthy diet", "Coffee", "Tea", "Online shopping"], goals: ["fb_reach", "ig_reels_spread"] },
  { key: "alcohol", label: "酒類", note: "酒吧、調酒、威士忌、啤酒與葡萄酒。", audienceQueries: ["Wine", "Whisky", "Beer", "Cocktail", "Bartending", "Bar", "Craft beer", "Sommelier", "Nightlife", "Fine dining", "Luxury lifestyle", "Travel", "Restaurant", "Music festival", "Hotel", "GQ"], goals: ["fb_reach", "ig_post_spread"] },
  { key: "daily_goods", label: "日用品", note: "生活用品、居家、清潔與量販。", audienceQueries: ["Household goods", "Home cleaning", "Laundry", "Home organization", "Supermarket", "Costco", "Family", "Parenting", "Home decor", "Interior design", "Cooking", "Healthy lifestyle", "Lifestyle", "Online shopping", "DIY", "IKEA"], goals: ["fb_reach", "fb_post_engagement"] },
  { key: "consumer_electronics", label: "3C家電", note: "手機、家電、科技與數位產品。", audienceQueries: ["Consumer electronics", "Technology", "Smartphone", "Apple Inc.", "Samsung", "Computer", "Home appliance", "Gadget", "TechCrunch", "Wired", "Gaming", "YouTube", "Smart home", "Photography", "Streaming media", "E-commerce"], goals: ["fb_post_engagement", "ig_video_views"] },
  { key: "transportation", label: "交通運輸", note: "汽車、機車、大眾運輸與旅遊交通。", audienceQueries: ["Automobiles", "Motorcycle", "Electric vehicle", "Public transport", "Commuting", "Car rental", "Scooter", "Automotive industry", "Travel", "Road trip", "Outdoor recreation", "Technology", "Urban planning", "Navigation", "Family", "Business travel"], goals: ["fb_reach", "fb_post_engagement"] },
  { key: "gaming", label: "遊戲類", note: "電子遊戲、手遊、電競與主機平台。", audienceQueries: ["Video games", "Mobile game", "Esports", "PlayStation", "Nintendo", "Xbox", "Twitch", "Steam", "Anime", "YouTube", "Computer hardware", "Discord", "Gaming computer", "Cosplay", "Pop culture", "Technology"], goals: ["fb_video_views", "ig_reels_spread"] },
  { key: "app", label: "APP", note: "行動應用程式、效率工具與數位服務。", audienceQueries: ["Mobile app", "Productivity software", "Software", "App Store", "Google Play", "Mobile phone", "Technology", "Cloud computing", "Startup company", "Entrepreneurship", "Online learning", "Fintech", "Business", "TechCrunch", "Remote work", "Digital marketing"], goals: ["fb_post_engagement", "ig_engagement"] },
  { key: "ecommerce", label: "EC平台", note: "網路購物、電商、折扣與購物平台。", audienceQueries: ["Online shopping", "E-commerce", "Shopee", "Amazon", "Lazada", "Coupon", "Discount store", "Shopping", "Fashion", "Beauty", "Consumer electronics", "Home decor", "Household goods", "Food and drink", "Parenting", "Lifestyle"], goals: ["fb_post_engagement", "ig_post_spread"] },
  { key: "bags_accessories", label: "包包配件", note: "包款、配件、穿搭與時尚用品。", audienceQueries: ["Handbags", "Fashion accessories", "Wallet", "Jewelry", "Fashion", "Streetwear", "Luxury goods", "Online shopping", "Travel", "Office", "Vogue", "ELLE", "Lifestyle", "Department store", "Gift", "Minimalism"], goals: ["ig_post_spread", "ig_engagement"] },
  { key: "travel", label: "旅遊業", note: "自由行、飯店、航空與景點。", audienceQueries: ["Travel", "Hotels", "Airline", "Backpacking", "Tourism", "Booking.com", "Tripadvisor", "Travel agency", "Photography", "Foodie", "Family vacation", "Outdoor recreation", "Luxury travel", "Road trip", "Culture", "Lifestyle"], goals: ["fb_reach", "ig_reels_spread"] },
  { key: "finance_insurance", label: "金融保險", note: "理財、保險、信用卡與金融服務。", audienceQueries: ["Personal finance", "Insurance", "Credit card", "Investment", "Mortgage loan", "Banking", "Financial planning", "Fintech", "Business", "Family", "Real estate", "Travel", "Luxury goods", "Entrepreneurship", "Retirement planning", "Online banking"], goals: ["fb_reach", "fb_post_engagement"] },
  { key: "retail", label: "零售通路", note: "百貨、量販、超商與門市購物。", audienceQueries: ["Retail", "Department store", "Convenience store", "Supermarket", "Shopping", "Discount store", "Costco", "Hypermarket", "Household goods", "Food and drink", "Family", "Lifestyle", "Gift", "Online shopping", "Cooking", "Parenting"], goals: ["fb_reach", "ig_post_spread"] },
  { key: "eyewear", label: "光學眼鏡", note: "眼鏡、太陽眼鏡、視力保健與配件。", audienceQueries: ["Eyewear", "Sunglasses", "Contact lens", "Optometry", "Vision care", "Ray-Ban", "Oakley", "Fashion accessories", "Fashion", "Outdoor recreation", "Driving", "Computer", "Office", "Lifestyle", "Travel", "Sportswear"], goals: ["ig_post_spread", "fb_post_engagement"] },
  { key: "telecom", label: "電信通訊", note: "5G、手機方案、網路服務與科技。", audienceQueries: ["Telecommunications", "Mobile network", "5G", "Smartphone", "Internet service provider", "Mobile phone", "Technology", "Apple Inc.", "Streaming media", "Gaming", "Remote work", "Smart home", "YouTube", "Netflix", "Computer", "TechCrunch"], goals: ["fb_reach", "fb_post_engagement"] },
  { key: "health_medicine", label: "健康醫藥", note: "健康、保健、醫療與營養補充。", audienceQueries: ["Health care", "Nutrition", "Dietary supplement", "Healthy diet", "Fitness and wellness", "Medical", "Pharmacy", "Wellness", "Family", "Parenting", "Aging", "Running", "Yoga", "Home cooking", "Mental health", "Lifestyle"], goals: ["fb_reach", "ig_post_spread"] },
  { key: "government_politics", label: "政府政黨", note: "公共議題、政策、公民參與與社會議題。", audienceQueries: ["Public policy", "Civic engagement", "Politics", "Government", "News", "Social issues", "Community", "Public service", "Education", "Public transport", "Environmentalism", "Health care", "Family", "Local news", "Urban planning", "Volunteerism"], goals: ["fb_reach", "fb_post_engagement"] },
  { key: "education", label: "文教", note: "教育、學習、課程與親子教育。", audienceQueries: ["Education", "Online learning", "Language learning", "Tutoring", "E-learning", "Study skills", "University", "Book", "Parenting", "Career development", "Personal development", "Business", "Productivity software", "Technology", "Reading", "Teacher"], goals: ["fb_post_engagement", "ig_video_views"] },
  { key: "real_estate", label: "房地產", note: "買房、租屋、室內設計與居家。", audienceQueries: ["Real estate", "Apartment", "Mortgage loan", "Interior design", "Home improvement", "House", "Property", "IKEA", "Family", "Wedding", "Personal finance", "Commuting", "Home decor", "Parenting", "Luxury lifestyle", "Urban planning"], goals: ["fb_reach", "fb_post_engagement"] },
  { key: "baby", label: "嬰幼兒", note: "育兒、嬰兒用品、親子與家庭。", audienceQueries: ["Parenting", "Baby products", "Motherhood", "Pregnancy", "Toys", "Family", "Early childhood education", "Diaper", "Household goods", "Health care", "Education", "Travel", "Home decor", "Supermarket", "Online shopping", "Children's clothing"], goals: ["fb_post_engagement", "ig_post_spread"] },
  { key: "aesthetic_medicine", label: "醫美", note: "醫美、美容、皮膚管理與保養。", audienceQueries: ["Cosmetic surgery", "Dermatology", "Skin care", "Beauty", "Anti-aging", "Laser hair removal", "Aesthetic medicine", "Plastic surgery", "Wedding", "Luxury goods", "Fitness and wellness", "Vogue", "ELLE", "Makeup", "Wellness", "Fashion"], goals: ["ig_engagement", "fb_reach"] },
  { key: "other", label: "其他", note: "生活風格、流行文化、娛樂與社群媒體。", audienceQueries: ["Lifestyle", "Pop culture", "Entertainment", "Social media", "Online shopping", "YouTube", "Instagram", "News", "Family", "Technology", "Travel", "Foodie", "Fashion", "Health and wellness", "Education", "Shopping"], goals: ["fb_post_engagement", "ig_post_spread"] },
];

function nowIso() {
  return new Date().toISOString();
}

function buildTargetingText(seed: IndustrySeed) {
  const core = seed.audienceQueries.slice(0, 8).map((keyword) => `# ${keyword}`).join("\n");
  const expansion = seed.audienceQueries.slice(8).map((keyword) => `# ${keyword}`).join("\n");
  return [
    "## 模板 A：核心高意圖",
    core,
    "## 模板 B：情境擴量",
    expansion,
  ].filter(Boolean).join("\n");
}

function buildDefaultIndustries(): MetaIndustryPreset[] {
  return INDUSTRIES.map((industry) => ({
    key: industry.key,
    label: industry.label,
    description: `${industry.label}產業預設模板`,
    enabled: true,
    recommendedGoals: industry.goals,
    countriesCsv: "TW",
    ageMin: 18,
    ageMax: 49,
    gender: "all",
    detailedTargetingText: buildTargetingText(industry),
    customAudienceIdsText: "",
    excludedAudienceIdsText: "",
    audienceNote: `${industry.note}預設提供兩組受眾：A 核心高意圖（產品、品牌、品類），B 情境擴量（生活場景、媒體、相鄰興趣）。系統會搜尋可用 interest ID；沒有結果的關鍵字會自動跳過。`,
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

function normalizeAccount(account: Partial<MetaManagedAccount> | undefined, index: number): MetaManagedAccount {
  return {
    id: String(account?.id || `account-${index + 1}`),
    label: String(account?.label || account?.adAccountId || `廣告帳號 ${index + 1}`),
    adAccountId: String(account?.adAccountId || "").replace(/^act_/i, ""),
    pageId: String(account?.pageId || ""),
    pageName: String(account?.pageName || ""),
    instagramActorId: String(account?.instagramActorId || ""),
    isDefault: !!account?.isDefault,
  };
}

function normalizeIndustry(industry: Partial<MetaIndustryPreset> | undefined, fallback: MetaIndustryPreset): MetaIndustryPreset {
  return {
    ...fallback,
    ...industry,
    key: String(industry?.key || fallback.key),
    label: String(industry?.label || fallback.label),
    description: String(industry?.description || fallback.description),
    enabled: typeof industry?.enabled === "boolean" ? industry.enabled : fallback.enabled,
    recommendedGoals: Array.isArray(industry?.recommendedGoals) && industry.recommendedGoals.length > 0
      ? industry.recommendedGoals as MetaAdGoalKey[]
      : fallback.recommendedGoals,
    countriesCsv: String(industry?.countriesCsv || fallback.countriesCsv),
    ageMin: Number(industry?.ageMin || fallback.ageMin),
    ageMax: Number(industry?.ageMax || fallback.ageMax),
    gender: industry?.gender === "male" || industry?.gender === "female" ? industry.gender : fallback.gender,
    detailedTargetingText: String(industry?.detailedTargetingText || fallback.detailedTargetingText),
    customAudienceIdsText: String(industry?.customAudienceIdsText || fallback.customAudienceIdsText),
    excludedAudienceIdsText: String(industry?.excludedAudienceIdsText || fallback.excludedAudienceIdsText),
    audienceNote: String(industry?.audienceNote || fallback.audienceNote),
    dailyBudget: Number(industry?.dailyBudget || fallback.dailyBudget),
    ctaType: String(industry?.ctaType || fallback.ctaType),
    fbPositions: Array.isArray(industry?.fbPositions) ? industry.fbPositions.map(String) : fallback.fbPositions,
    igPositions: Array.isArray(industry?.igPositions) ? industry.igPositions.map(String) : fallback.igPositions,
  };
}

function mergeIndustries(rawIndustries: unknown): MetaIndustryPreset[] {
  const defaults = buildDefaultIndustries();
  const stored = Array.isArray(rawIndustries) ? rawIndustries as Array<Partial<MetaIndustryPreset>> : [];
  const storedByKey = new Map(stored.map((industry) => [String(industry?.key || ""), industry]));
  const mergedDefaults = defaults.map((fallback) => normalizeIndustry(storedByKey.get(fallback.key), fallback));
  const defaultKeys = new Set(defaults.map((industry) => industry.key));
  const custom = stored
    .filter((industry) => industry?.key && !defaultKeys.has(String(industry.key)))
    .map((industry, index) => normalizeIndustry(industry, {
      ...defaults[index % defaults.length],
      key: String(industry.key),
      label: String(industry.label || `自訂產業 ${index + 1}`),
      description: String(industry.description || "管理員新增的自訂產業模板"),
    }));
  return [...mergedDefaults, ...custom];
}

function normalize(raw: unknown): MetaPresetConfigV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<MetaPresetConfigV1>;
  return {
    version: 1,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : nowIso(),
    optimization: { ...DEFAULT_META_OPTIMIZATION_CONFIG, ...(row.optimization ?? {}) },
    accounts: Array.isArray(row.accounts) ? row.accounts.map(normalizeAccount) : [],
    industries: mergeIndustries(row.industries),
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
