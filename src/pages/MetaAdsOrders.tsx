import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getMetaConfig } from "../config/metaConfig";
import { getManagedMetaAccount, getMetaPresetConfig, type MetaIndustryPreset, type MetaManagedAccount } from "../config/metaPresetConfig";
import { buildMetaPayloads } from "../lib/metaPayload";
import { META_AD_GOALS, getGoalPrimaryMetricKey, getGoalPrimaryMetricLabel, listMetaGoals, type MetaAdGoalKey } from "../lib/metaGoals";
import { addMetaOrder, listMetaOrders, updateMetaOrder, type MetaOrder, type MetaOrderInput } from "../lib/metaOrdersStore";
import { listMetaExistingPosts, resolveMetaPostReference, submitMetaOrderToGraph, type MetaExistingPostOption } from "../lib/metaGraphApi";
import type { MetaTrackingRef } from "../lib/ordersStore";
import { isValidUrl } from "../lib/validate";
import { SHARED_SYNC_EVENT } from "../lib/sharedSync";

type ExistingPostMode = "picker" | "url" | "id";

type FormState = {
  accountId: string;
  industryKey: string;
  title: string;
  campaignName: string;
  adsetName: string;
  adName: string;
  goal: MetaAdGoalKey;
  landingUrl: string;
  message: string;
  ctaType: string;
  useExistingPost: boolean;
  existingPostMode: ExistingPostMode;
  existingPostId: string;
  existingPostSource: string;
  trackingPostId: string;
  targetValue: string;
  dailyBudget: string;
  startTime: string;
  endTime: string;
  countriesCsv: string;
  ageMin: string;
  ageMax: string;
  gender: "all" | "male" | "female";
  detailedTargetingText: string;
  customAudienceIdsText: string;
  excludedAudienceIdsText: string;
  fbPositions: string[];
  igPositions: string[];
};

type Errors = Partial<Record<keyof FormState, string>>;

type ResolvedPostSelection = {
  existingPostId?: string;
  existingPostSource?: string;
  trackingPostId?: string;
  trackingRef?: MetaTrackingRef;
  postLabel?: string;
};

const FB_POSITION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "feed", label: "Facebook 動態消息" },
  { value: "profile_feed", label: "Facebook 個人檔案動態消息" },
  { value: "story", label: "Facebook 限時動態" },
  { value: "facebook_reels", label: "Facebook Reels" },
  { value: "video_feeds", label: "Facebook 影片動態消息" },
  { value: "search", label: "Facebook 搜尋結果" },
  { value: "marketplace", label: "Facebook Marketplace" },
  { value: "right_hand_column", label: "Facebook 右欄" },
];

const IG_POSITION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "stream", label: "Instagram 動態消息" },
  { value: "story", label: "Instagram 限時動態" },
  { value: "reels", label: "Instagram Reels" },
  { value: "explore", label: "Instagram 探索" },
  { value: "profile_feed", label: "Instagram 個人檔案動態消息" },
  { value: "search", label: "Instagram 搜尋結果" },
];

const FB_POSITION_LABEL = new Map(FB_POSITION_OPTIONS.map((x) => [x.value, x.label]));
const IG_POSITION_LABEL = new Map(IG_POSITION_OPTIONS.map((x) => [x.value, x.label]));

const GOAL_PRESETS: Record<
  MetaAdGoalKey,
  {
    useExistingPost: boolean;
    ctaType: string;
    dailyBudget: string;
    fbPositions: string[];
    igPositions: string[];
  }
> = {
  fb_post_likes: {
    useExistingPost: true,
    ctaType: "LEARN_MORE",
    dailyBudget: "1000",
    fbPositions: ["feed", "profile_feed", "story", "facebook_reels", "video_feeds", "search"],
    igPositions: ["stream", "story", "reels"],
  },
  fb_post_engagement: {
    useExistingPost: true,
    ctaType: "LEARN_MORE",
    dailyBudget: "1000",
    fbPositions: ["feed", "profile_feed", "story", "facebook_reels", "video_feeds", "search"],
    igPositions: ["stream", "story", "reels"],
  },
  fb_reach: {
    useExistingPost: false,
    ctaType: "VIEW_MORE",
    dailyBudget: "1000",
    fbPositions: ["feed", "story", "facebook_reels", "video_feeds", "search", "marketplace"],
    igPositions: ["stream", "story", "reels", "explore"],
  },
  fb_video_views: {
    useExistingPost: true,
    ctaType: "VIEW_MORE",
    dailyBudget: "1000",
    fbPositions: ["video_feeds", "facebook_reels", "story", "feed"],
    igPositions: ["reels", "story", "stream"],
  },
  ig_post_spread: {
    useExistingPost: true,
    ctaType: "VIEW_MORE",
    dailyBudget: "1000",
    fbPositions: ["feed", "story"],
    igPositions: ["stream", "story", "explore", "profile_feed"],
  },
  ig_reels_spread: {
    useExistingPost: true,
    ctaType: "VIEW_MORE",
    dailyBudget: "1000",
    fbPositions: ["facebook_reels", "story"],
    igPositions: ["reels", "story", "explore"],
  },
  ig_video_views: {
    useExistingPost: true,
    ctaType: "VIEW_MORE",
    dailyBudget: "1000",
    fbPositions: ["video_feeds", "facebook_reels"],
    igPositions: ["reels", "story", "stream"],
  },
  ig_engagement: {
    useExistingPost: true,
    ctaType: "LEARN_MORE",
    dailyBudget: "1000",
    fbPositions: ["feed", "story", "facebook_reels"],
    igPositions: ["stream", "story", "reels", "explore"],
  },
  ig_followers: {
    useExistingPost: false,
    ctaType: "VIEW_MORE",
    dailyBudget: "1000",
    fbPositions: ["feed", "story", "facebook_reels"],
    igPositions: ["stream", "story", "reels", "explore", "profile_feed"],
  },
};

const TARGET_RECOMMENDS_TRACKING = new Set([
  "likes",
  "comments",
  "shares",
  "interactions_total",
  "followers",
  "profile_visits",
]);

function parseTextList(raw: string): string[] {
  return raw
    .split(/[\r\n,]+/g)
    .map((value) => value.trim())
    .filter(Boolean);
}

function toInputDateTimeLocal(d = new Date()): string {
  const dt = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return dt.toISOString().slice(0, 16);
}

function toIsoFromLocalInput(s: string): string {
  if (!s.trim()) return "";
  return new Date(s).toISOString();
}

function toInputFromIso(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function applyGoalPreset(prev: FormState, goal: MetaAdGoalKey): FormState {
  const preset = GOAL_PRESETS[goal];
  return {
    ...prev,
    goal,
    useExistingPost: preset.useExistingPost,
    ctaType: preset.ctaType,
    dailyBudget: preset.dailyBudget,
    fbPositions: preset.fbPositions,
    igPositions: preset.igPositions,
  };
}

function applyIndustryPreset(prev: FormState, industry: MetaIndustryPreset): FormState {
  const nextGoal = industry.recommendedGoals.includes(prev.goal)
    ? prev.goal
    : industry.recommendedGoals[0] ?? prev.goal;
  const next = applyGoalPreset(prev, nextGoal);
  return {
    ...next,
    industryKey: industry.key,
    countriesCsv: industry.countriesCsv || next.countriesCsv,
    ageMin: String(industry.ageMin || 18),
    ageMax: String(industry.ageMax || 49),
    gender: industry.gender,
    detailedTargetingText: industry.detailedTargetingText || "",
    customAudienceIdsText: industry.customAudienceIdsText || "",
    excludedAudienceIdsText: industry.excludedAudienceIdsText || "",
    dailyBudget: String(industry.dailyBudget || next.dailyBudget),
    ctaType: industry.ctaType || next.ctaType,
    useExistingPost: industry.useExistingPost,
    fbPositions: industry.fbPositions.length > 0 ? industry.fbPositions : next.fbPositions,
    igPositions: industry.igPositions.length > 0 ? industry.igPositions : next.igPositions,
  };
}

function defaultState(): FormState {
  const presetCfg = getMetaPresetConfig();
  const start = new Date(Date.now() + 15 * 60 * 1000);
  const seed: FormState = {
    accountId: getManagedMetaAccount(presetCfg)?.id ?? "",
    industryKey: presetCfg.industries.find((industry) => industry.enabled)?.key ?? "",
    title: "新投放",
    campaignName: "新行銷活動",
    adsetName: "新廣告組合",
    adName: "新廣告",
    goal: "fb_post_engagement",
    landingUrl: "",
    message: "",
    ctaType: "LEARN_MORE",
    useExistingPost: true,
    existingPostMode: "picker",
    existingPostId: "",
    existingPostSource: "",
    trackingPostId: "",
    targetValue: "",
    dailyBudget: "1000",
    startTime: toInputDateTimeLocal(start),
    endTime: "",
    countriesCsv: "TW",
    ageMin: "18",
    ageMax: "49",
    gender: "all",
    detailedTargetingText: "",
    customAudienceIdsText: "",
    excludedAudienceIdsText: "",
    fbPositions: [],
    igPositions: [],
  };
  const next = applyGoalPreset(seed, seed.goal);
  const defaultIndustry = presetCfg.industries.find((industry) => industry.enabled);
  return defaultIndustry ? applyIndustryPreset(next, defaultIndustry) : next;
}

function fromGenderCodes(genders: number[]): FormState["gender"] {
  if (genders.includes(1)) return "male";
  if (genders.includes(2)) return "female";
  return "all";
}

function inferExistingPostMode(row: MetaOrder): ExistingPostMode {
  if (!row.useExistingPost) return "url";
  if (row.trackingRef?.resolver === "existing_post_picker") return "picker";
  if (row.existingPostSource && /^https?:\/\//i.test(row.existingPostSource)) return "url";
  return "id";
}

function formStateFromOrder(row: MetaOrder): FormState {
  return {
    accountId: row.accountId ?? "",
    industryKey: row.industryKey ?? "",
    title: row.title ?? "",
    campaignName: row.campaignName ?? "",
    adsetName: row.adsetName ?? "",
    adName: row.adName ?? "",
    goal: row.goal,
    landingUrl: row.landingUrl ?? "",
    message: row.message ?? "",
    ctaType: row.ctaType ?? "LEARN_MORE",
    useExistingPost: !!row.useExistingPost,
    existingPostMode: inferExistingPostMode(row),
    existingPostId: row.existingPostId ?? "",
    existingPostSource: row.existingPostSource ?? row.trackingRef?.sourceUrl ?? "",
    trackingPostId: row.trackingPostId ?? row.trackingRef?.refId ?? row.existingPostId ?? "",
    targetValue: row.targetValue == null ? "" : String(row.targetValue),
    dailyBudget: String(row.dailyBudget ?? ""),
    startTime: toInputFromIso(row.startTime),
    endTime: toInputFromIso(row.endTime),
    countriesCsv: row.countries?.join(", ") || "TW",
    ageMin: String(row.ageMin ?? 18),
    ageMax: String(row.ageMax ?? 49),
    gender: fromGenderCodes(row.genders ?? []),
    detailedTargetingText: row.detailedTargetingText ?? "",
    customAudienceIdsText: (row.customAudienceIds ?? []).join("\n"),
    excludedAudienceIdsText: (row.excludedAudienceIds ?? []).join("\n"),
    fbPositions: row.manualPlacements?.facebook ?? [],
    igPositions: row.manualPlacements?.instagram ?? [],
  };
}

function buildResolvedSelectionFromOrder(row: MetaOrder): ResolvedPostSelection | null {
  if (!row.useExistingPost) return null;
  return {
    existingPostId: row.existingPostId,
    existingPostSource: row.existingPostSource ?? row.trackingRef?.sourceUrl,
    trackingPostId: row.trackingPostId ?? row.trackingRef?.refId,
    trackingRef: row.trackingRef,
    postLabel: row.existingPostSource ?? row.existingPostId ?? row.trackingPostId,
  };
}

function toGenders(g: FormState["gender"]): number[] {
  if (g === "male") return [1];
  if (g === "female") return [2];
  return [];
}

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

function formatDateTime(isoOrLocal: string): string {
  if (!isoOrLocal) return "-";
  const dt = new Date(isoOrLocal);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString("zh-TW", { hour12: false });
}

function formatPlatform(platform: "facebook" | "instagram") {
  return platform === "facebook" ? "Facebook" : "Instagram";
}

function buildManualTrackingRef(params: {
  platform: "facebook" | "instagram";
  refId: string;
  sourceUrl?: string;
  account: MetaManagedAccount | null;
  resolver: string;
}): MetaTrackingRef {
  return {
    platform: params.platform,
    refId: params.refId,
    sourceUrl: params.sourceUrl || params.refId,
    canonicalUrl: params.sourceUrl,
    pageId: params.account?.pageId,
    pageName: params.account?.pageName,
    resolver: params.resolver,
    resolvedAt: new Date().toISOString(),
  };
}

function validate(s: FormState, effectiveConfig: { adAccountId: string; pageId: string; instagramActorId: string }): Errors {
  const e: Errors = {};
  if (!s.accountId.trim() && !effectiveConfig.adAccountId.trim()) e.accountId = "請先選擇投放帳號";
  if (!s.title.trim()) e.title = "請填寫任務名稱";
  if (!s.campaignName.trim()) e.campaignName = "請填寫行銷活動名稱";
  if (!s.adsetName.trim()) e.adsetName = "請填寫廣告組合名稱";
  if (!s.adName.trim()) e.adName = "請填寫廣告名稱";

  if (s.useExistingPost) {
    if (s.existingPostMode === "picker" && !s.existingPostId.trim()) e.existingPostId = "請先從近期貼文中選擇一篇";
    if (s.existingPostMode === "url") {
      if (!s.existingPostSource.trim()) e.existingPostSource = "請貼上貼文連結";
      else if (!isValidUrl(s.existingPostSource.trim())) e.existingPostSource = "貼文連結格式不正確";
    }
    if (s.existingPostMode === "id" && !s.existingPostId.trim()) e.existingPostId = "請填寫貼文 ID";
  } else {
    if (!s.landingUrl.trim()) e.landingUrl = "請填寫網址";
    else if (!isValidUrl(s.landingUrl.trim())) e.landingUrl = "網址格式不正確";
  }

  const target = Number(s.targetValue);
  if (s.targetValue.trim() && (!Number.isFinite(target) || target <= 0)) {
    e.targetValue = "目標數值需為正數";
  }

  const b = Number(s.dailyBudget);
  if (!Number.isFinite(b) || b <= 0) e.dailyBudget = "日預算需為正數";

  if (!s.startTime.trim()) e.startTime = "請填寫開始時間";
  if (s.endTime.trim()) {
    const st = Date.parse(s.startTime);
    const ed = Date.parse(s.endTime);
    if (!Number.isFinite(st) || !Number.isFinite(ed) || ed <= st) e.endTime = "結束時間需晚於開始時間";
  }

  const ageMin = Number(s.ageMin);
  const ageMax = Number(s.ageMax);
  if (!Number.isFinite(ageMin) || ageMin < 13) e.ageMin = "最小年齡需為 13 以上";
  if (!Number.isFinite(ageMax) || ageMax < ageMin) e.ageMax = "最大年齡需大於等於最小年齡";

  if (s.fbPositions.length + s.igPositions.length === 0) {
    e.fbPositions = "請至少勾選 1 個版位";
  }
  if (s.goal.startsWith("fb_") && s.useExistingPost && !effectiveConfig.pageId.trim()) e.accountId = "這個帳號尚未設定 Facebook 粉專 ID";
  if (s.goal.startsWith("ig_") && s.useExistingPost && !effectiveConfig.instagramActorId.trim()) e.accountId = "這個帳號尚未設定 Instagram Actor ID";
  return e;
}

export function MetaAdsOrdersPage() {
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, signOut, hasRole } = useAuth();
  const [, setSharedTick] = useState(0);
  const [step, setStep] = useState<"edit" | "confirm" | "submitted">("edit");
  const [state, setState] = useState<FormState>(() => defaultState());
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [resolvedPost, setResolvedPost] = useState<ResolvedPostSelection | null>(null);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [postOptions, setPostOptions] = useState<MetaExistingPostOption[]>([]);
  const [postLoadMessage, setPostLoadMessage] = useState<string | null>(null);
  const [resolvingPost, setResolvingPost] = useState(false);

  const cfg = getMetaConfig();
  const metaPresetCfg = getMetaPresetConfig();
  const applicant = user?.displayName ?? user?.username ?? "";
  const canManage = hasRole("admin");
  const goal = META_AD_GOALS[state.goal];
  const targetMetricLabel = getGoalPrimaryMetricLabel(state.goal);
  const targetMetricKey = getGoalPrimaryMetricKey(state.goal);
  const editId = searchParams.get("edit")?.trim() ?? "";
  const availableAccounts = metaPresetCfg.accounts.filter((account) => account.enabled);
  const availableIndustries = metaPresetCfg.industries.filter((industry) => industry.enabled);
  const selectedAccount = getManagedMetaAccount(metaPresetCfg, state.accountId);
  const selectedIndustry = availableIndustries.find((industry) => industry.key === state.industryKey) ?? null;
  const effectiveCfg = {
    ...cfg,
    adAccountId: selectedAccount?.adAccountId || cfg.adAccountId,
    pageId: selectedAccount?.pageId || cfg.pageId,
    instagramActorId: selectedAccount?.instagramActorId || cfg.instagramActorId,
  };

  const clearEditQuery = () => {
    if (!editId) return;
    const next = new URLSearchParams(searchParams);
    next.delete("edit");
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (!state.accountId && availableAccounts.length > 0) {
      setState((current) => ({ ...current, accountId: selectedAccount?.id ?? availableAccounts[0].id }));
    }
  }, [availableAccounts.length, selectedAccount?.id, state.accountId]);

  useEffect(() => {
    if (!editId) return;
    const row = listMetaOrders().find((x) => x.id === editId);
    if (!row) return;
    setState(formStateFromOrder(row));
    setResolvedPost(buildResolvedSelectionFromOrder(row));
    setErrors({});
    setStep("edit");
    setSubmitMsg(null);
    setEditingOrderId(row.id);
  }, [editId]);

  useEffect(() => {
    const onSharedSync = () => setSharedTick((x) => x + 1);
    window.addEventListener(SHARED_SYNC_EVENT, onSharedSync);
    return () => window.removeEventListener(SHARED_SYNC_EVENT, onSharedSync);
  }, []);

  useEffect(() => {
    setPostOptions([]);
    setPostLoadMessage(null);
  }, [state.goal, state.accountId]);

  const countries = useMemo(
    () =>
      state.countriesCsv
        .split(/[,\s]+/g)
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean),
    [state.countriesCsv],
  );

  const previewInput: MetaOrderInput = useMemo(
    () => ({
      applicant,
      accountId: selectedAccount?.id,
      accountLabel: selectedAccount?.label,
      industryKey: selectedIndustry?.key,
      industryLabel: selectedIndustry?.label,
      title: state.title.trim(),
      campaignName: state.campaignName.trim(),
      adsetName: state.adsetName.trim(),
      adName: state.adName.trim(),
      goal: state.goal,
      landingUrl: state.landingUrl.trim(),
      message: state.message.trim(),
      ctaType: state.ctaType.trim() || "LEARN_MORE",
      useExistingPost: state.useExistingPost,
      existingPostId: state.useExistingPost ? resolvedPost?.existingPostId || state.existingPostId.trim() || undefined : undefined,
      existingPostSource: state.useExistingPost ? resolvedPost?.existingPostSource || state.existingPostSource.trim() || undefined : undefined,
      trackingPostId: state.useExistingPost
        ? (resolvedPost?.trackingPostId || state.trackingPostId.trim() || state.existingPostId.trim()) || undefined
        : undefined,
      trackingRef: state.useExistingPost ? resolvedPost?.trackingRef : undefined,
      targetMetricKey,
      targetValue: state.targetValue.trim() ? Number(state.targetValue) : undefined,
      autoStopByTarget: !!state.targetValue.trim(),
      dailyBudget: Number(state.dailyBudget) || 0,
      startTime: toIsoFromLocalInput(state.startTime),
      endTime: state.endTime.trim() ? toIsoFromLocalInput(state.endTime) : undefined,
      countries,
      ageMin: Number(state.ageMin) || 18,
      ageMax: Number(state.ageMax) || 49,
      genders: toGenders(state.gender),
      customAudienceIds: parseTextList(state.customAudienceIdsText),
      excludedAudienceIds: parseTextList(state.excludedAudienceIdsText),
      manualPlacements: {
        facebook: state.fbPositions,
        instagram: state.igPositions,
      },
      detailedTargetingText: state.detailedTargetingText.trim() || undefined,
      mode: "live",
    }),
    [applicant, countries, resolvedPost, selectedAccount?.id, selectedAccount?.label, selectedIndustry?.key, selectedIndustry?.label, state, targetMetricKey],
  );

  const payloads = useMemo(() => buildMetaPayloads(effectiveCfg, previewInput), [effectiveCfg, previewInput]);
  const fbPlacementLabels = useMemo(
    () => previewInput.manualPlacements.facebook.map((x) => FB_POSITION_LABEL.get(x) ?? x),
    [previewInput.manualPlacements.facebook],
  );
  const igPlacementLabels = useMemo(
    () => previewInput.manualPlacements.instagram.map((x) => IG_POSITION_LABEL.get(x) ?? x),
    [previewInput.manualPlacements.instagram],
  );

  const applyIndustry = (industryKey: string) => {
    const industry = availableIndustries.find((item) => item.key === industryKey);
    if (!industry) {
      setState((current) => ({ ...current, industryKey }));
      return;
    }
    setState((current) => applyIndustryPreset({ ...current, industryKey }, industry));
    setResolvedPost(null);
  };

  const loadExistingPosts = async () => {
    setLoadingPosts(true);
    setPostLoadMessage(null);
    try {
      const result = await listMetaExistingPosts({
        cfg,
        platform: goal.platform,
        pageId: effectiveCfg.pageId,
        instagramActorId: effectiveCfg.instagramActorId,
        limit: 12,
      });
      if (!result.ok || !result.posts) {
        setPostOptions([]);
        setPostLoadMessage(result.detail || "讀取近期貼文失敗");
        return;
      }
      setPostOptions(result.posts);
      setPostLoadMessage(result.posts.length > 0 ? `已載入 ${result.posts.length} 篇近期貼文` : "目前沒有可選的近期貼文");
    } finally {
      setLoadingPosts(false);
    }
  };

  const applyPickedPost = (post: MetaExistingPostOption) => {
    const trackingRef = buildManualTrackingRef({
      platform: post.platform,
      refId: post.id,
      sourceUrl: post.permalink,
      account: selectedAccount,
      resolver: "existing_post_picker",
    });
    setState((current) => ({
      ...current,
      useExistingPost: true,
      existingPostMode: "picker",
      existingPostId: post.id,
      existingPostSource: post.permalink,
      trackingPostId: post.id,
      landingUrl: current.landingUrl || post.permalink,
      message: current.message || post.message || "",
    }));
    setResolvedPost({
      existingPostId: post.id,
      existingPostSource: post.permalink,
      trackingPostId: post.id,
      trackingRef,
      postLabel: post.label,
    });
  };

  const prepareResolvedPost = async (): Promise<ResolvedPostSelection | null> => {
    if (!state.useExistingPost) return null;

    if (state.existingPostMode === "picker") {
      const refId = state.existingPostId.trim();
      if (!refId) return null;
      return {
        existingPostId: refId,
        existingPostSource: state.existingPostSource.trim() || refId,
        trackingPostId: refId,
        trackingRef: buildManualTrackingRef({
          platform: goal.platform,
          refId,
          sourceUrl: state.existingPostSource.trim() || refId,
          account: selectedAccount,
          resolver: "existing_post_picker",
        }),
        postLabel: state.existingPostSource.trim() || refId,
      };
    }

    if (state.existingPostMode === "id") {
      const refId = state.existingPostId.trim();
      if (!refId) return null;
      return {
        existingPostId: refId,
        existingPostSource: state.existingPostSource.trim() || refId,
        trackingPostId: state.trackingPostId.trim() || refId,
        trackingRef: buildManualTrackingRef({
          platform: goal.platform,
          refId: state.trackingPostId.trim() || refId,
          sourceUrl: state.existingPostSource.trim() || refId,
          account: selectedAccount,
          resolver: "manual_id",
        }),
        postLabel: refId,
      };
    }

    const source = state.existingPostSource.trim();
    if (!source) return null;
    const resolved = await resolveMetaPostReference({
      source,
      platform: goal.platform,
      pageId: effectiveCfg.pageId,
      pageName: selectedAccount?.pageName,
    });
    if (!resolved.ok || !resolved.trackingRef) {
      throw new Error(resolved.detail || "貼文連結解析失敗");
    }
    return {
      existingPostId: resolved.existingPostId || resolved.trackingRef.refId,
      existingPostSource: source,
      trackingPostId: resolved.trackingRef.refId,
      trackingRef: resolved.trackingRef,
      postLabel: source,
    };
  };

  const goConfirm = async () => {
    const e = validate(state, effectiveCfg);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setResolvingPost(true);
    try {
      const prepared = await prepareResolvedPost();
      if (state.useExistingPost && !prepared?.trackingPostId && TARGET_RECOMMENDS_TRACKING.has(targetMetricKey) && state.targetValue.trim()) {
        setErrors((current) => ({ ...current, trackingPostId: "這個目標建議提供可追蹤的貼文，才能在達標時自動停投" }));
        return;
      }
      setResolvedPost(prepared);
      setStep("confirm");
    } catch (error) {
      setErrors((current) => ({
        ...current,
        existingPostSource: error instanceof Error ? error.message : "貼文連結解析失敗",
      }));
    } finally {
      setResolvingPost(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const res = await submitMetaOrderToGraph({ cfg: effectiveCfg, input: previewInput, payloads });
      const status = res.status === "submitted" ? "running" : "failed";
      const nextRow = {
        ...previewInput,
        targetCurrentValue: undefined,
        targetLastCheckedAt: undefined,
        targetReachedAt: undefined,
        status,
        apiStatusText: res.status === "submitted" ? "已建立投放" : "建立失敗",
        error: res.error,
        payloads,
        submitResult: res.result,
      };
      if (editingOrderId) {
        const updated = updateMetaOrder(editingOrderId, (old) => ({
          ...old,
          ...nextRow,
        }));
        if (!updated) addMetaOrder(nextRow);
      } else {
        addMetaOrder(nextRow);
      }
      setEditingOrderId(null);
      clearEditQuery();
      if (res.status === "submitted") {
        setSubmitMsg("已送出，系統會依設定建立 Meta 投放，並在成效頁持續檢查是否達標。");
      } else {
        setSubmitMsg(`送出失敗：${res.error ?? "未知錯誤"}`);
      }
      setStep("submitted");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">
            {step === "edit" ? "Meta官方投廣" : step === "confirm" ? "確認送出" : "送出結果"}
          </div>
          <div className="brand-sub">先選投放帳號與產業模板，系統會帶入建議設定，送出後可在成效頁每 5 分鐘檢查是否達標。</div>
        </div>
        <div className="pill">
          <span className="tag">{applicant}</span>
          <button className="btn" onClick={() => nav("/ad-orders")}>
            廠商互動下單
          </button>
          <button className="btn" onClick={() => nav("/ad-performance")}>
            投放成效
          </button>
          <button className="btn primary" onClick={() => nav("/meta-ads-orders")}>
            Meta官方投廣
          </button>
          {canManage ? (
            <button className="btn" onClick={() => nav("/settings")}>
              控制設定
            </button>
          ) : null}
          <button
            className="btn danger"
            onClick={() => {
              signOut();
              nav("/login", { replace: true });
            }}
          >
            登出
          </button>
        </div>
      </div>

      {step === "edit" && (
        <div className="grid">
          <div className="card section section-blue">
            <div className="card-hd">
              <div>
                <div className="card-title">投放預設</div>
                <div className="card-desc">先選帳號與產業模板，系統會把建議設定帶入。</div>
              </div>
            </div>
            <div className="card-bd">
              <div className="row cols2">
                <div className="field">
                  <div className="label">投放帳號<span className="req">*</span></div>
                  <select
                    value={state.accountId}
                    onChange={(e) => {
                      setState((s) => ({ ...s, accountId: e.target.value }));
                      setResolvedPost(null);
                    }}
                  >
                    <option value="">請選擇</option>
                    {availableAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.label} / act_{account.adAccountId}
                      </option>
                    ))}
                  </select>
                  {errors.accountId && <div className="error">{errors.accountId}</div>}
                  <div className="hint">
                    {selectedAccount
                      ? `Facebook 粉專：${selectedAccount.pageName || selectedAccount.pageId || "未設定"} / Instagram Actor：${selectedAccount.instagramActorId || "未設定"}`
                      : "尚未選擇帳號，或控制設定還沒有可用的 Meta 帳號。"}
                  </div>
                </div>
                <div className="field">
                  <div className="label">產業模板</div>
                  <select value={state.industryKey} onChange={(e) => applyIndustry(e.target.value)}>
                    <option value="">不套用</option>
                    {availableIndustries.map((industry) => (
                      <option key={industry.key} value={industry.key}>
                        {industry.label}
                      </option>
                    ))}
                  </select>
                  <div className="hint">選擇後會帶入建議目標、年齡、受眾、地區、版位與預算。</div>
                </div>
              </div>
              {selectedIndustry ? (
                <>
                  <div className="sep" />
                  <div className="hint">{selectedIndustry.description || selectedIndustry.audienceNote || "已套用這個產業模板。"}</div>
                </>
              ) : null}
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <div>
                <div className="card-title">行銷活動</div>
                <div className="card-desc">目標會依投放類型自動設定。</div>
              </div>
            </div>
            <div className="card-bd">
              <div className="row cols2">
                <div className="field">
                  <div className="label">申請人</div>
                  <input value={applicant} readOnly />
                </div>
                <div className="field">
                  <div className="label">任務名稱<span className="req">*</span></div>
                  <input value={state.title} onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))} />
                  {errors.title && <div className="error">{errors.title}</div>}
                </div>

                <div className="field">
                  <div className="label">行銷活動名稱<span className="req">*</span></div>
                  <input value={state.campaignName} onChange={(e) => setState((s) => ({ ...s, campaignName: e.target.value }))} />
                  {errors.campaignName && <div className="error">{errors.campaignName}</div>}
                </div>
                <div className="field">
                  <div className="label">投放目標<span className="req">*</span></div>
                  <select
                    value={state.goal}
                    onChange={(e) =>
                      setState((s) => applyGoalPreset(s, e.target.value as MetaAdGoalKey))
                    }
                  >
                    {listMetaGoals().map((g) => (
                      <option key={g.key} value={g.key}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <div className="label">日預算 TWD<span className="req">*</span></div>
                  <input value={state.dailyBudget} inputMode="numeric" onChange={(e) => setState((s) => ({ ...s, dailyBudget: e.target.value }))} />
                  {errors.dailyBudget && <div className="error">{errors.dailyBudget}</div>}
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <div>
                <div className="card-title">廣告組合</div>
                <div className="card-desc">可設定受眾、排程、版位。</div>
              </div>
            </div>
            <div className="card-bd">
              <div className="row cols2">
                <div className="field">
                  <div className="label">廣告組合名稱<span className="req">*</span></div>
                  <input value={state.adsetName} onChange={(e) => setState((s) => ({ ...s, adsetName: e.target.value }))} />
                  {errors.adsetName && <div className="error">{errors.adsetName}</div>}
                </div>
                <div className="field">
                  <div className="label">國家</div>
                  <input value={state.countriesCsv} onChange={(e) => setState((s) => ({ ...s, countriesCsv: e.target.value }))} placeholder="TW" />
                </div>
                <div className="field">
                  <div className="label">開始時間<span className="req">*</span></div>
                  <input type="datetime-local" value={state.startTime} onChange={(e) => setState((s) => ({ ...s, startTime: e.target.value }))} />
                  {errors.startTime && <div className="error">{errors.startTime}</div>}
                </div>
                <div className="field">
                  <div className="label">結束時間</div>
                  <input type="datetime-local" value={state.endTime} onChange={(e) => setState((s) => ({ ...s, endTime: e.target.value }))} />
                  {errors.endTime && <div className="error">{errors.endTime}</div>}
                </div>
                <div className="field">
                  <div className="label">最小年齡</div>
                  <input value={state.ageMin} inputMode="numeric" onChange={(e) => setState((s) => ({ ...s, ageMin: e.target.value }))} />
                  {errors.ageMin && <div className="error">{errors.ageMin}</div>}
                </div>
                <div className="field">
                  <div className="label">最大年齡</div>
                  <input value={state.ageMax} inputMode="numeric" onChange={(e) => setState((s) => ({ ...s, ageMax: e.target.value }))} />
                  {errors.ageMax && <div className="error">{errors.ageMax}</div>}
                </div>
                <div className="field">
                  <div className="label">性別</div>
                  <select value={state.gender} onChange={(e) => setState((s) => ({ ...s, gender: e.target.value as FormState["gender"] }))}>
                    <option value="all">所有性別</option>
                    <option value="male">男性</option>
                    <option value="female">女性</option>
                  </select>
                </div>
                <div className="field">
                  <div className="label">詳細目標</div>
                  <textarea
                    rows={3}
                    value={state.detailedTargetingText}
                    onChange={(e) => setState((s) => ({ ...s, detailedTargetingText: e.target.value }))}
                    placeholder={"每行一筆 interest_id，可加名稱\n例如 6003139266461|Streetwear"}
                  />
                </div>
                <div className="field">
                  <div className="label">包含自訂受眾 ID</div>
                  <textarea
                    rows={2}
                    value={state.customAudienceIdsText}
                    onChange={(e) => setState((s) => ({ ...s, customAudienceIdsText: e.target.value }))}
                    placeholder={"每行一筆 Audience ID"}
                  />
                </div>
                <div className="field">
                  <div className="label">排除自訂受眾 ID</div>
                  <textarea
                    rows={2}
                    value={state.excludedAudienceIdsText}
                    onChange={(e) => setState((s) => ({ ...s, excludedAudienceIdsText: e.target.value }))}
                    placeholder={"每行一筆 Audience ID"}
                  />
                </div>
              </div>
              <div className="sep" />
              <div className="field">
                <div className="label">手動版位<span className="req">*</span></div>
                <div className="placement-grid">
                  <div className="placement-col">
                    <div className="placement-title">Facebook</div>
                    {FB_POSITION_OPTIONS.map((opt) => (
                      <label key={opt.value} className="check-row">
                        <input
                          type="checkbox"
                          checked={state.fbPositions.includes(opt.value)}
                          onChange={() => setState((s) => ({ ...s, fbPositions: toggleValue(s.fbPositions, opt.value) }))}
                        />
                        <span>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="placement-col">
                    <div className="placement-title">Instagram</div>
                    {IG_POSITION_OPTIONS.map((opt) => (
                      <label key={opt.value} className="check-row">
                        <input
                          type="checkbox"
                          checked={state.igPositions.includes(opt.value)}
                          onChange={() => setState((s) => ({ ...s, igPositions: toggleValue(s.igPositions, opt.value) }))}
                        />
                        <span>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                {errors.fbPositions && <div className="error">{errors.fbPositions}</div>}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <div>
                <div className="card-title">廣告</div>
                <div className="card-desc">優先使用既有貼文推廣，也可改成建立連結廣告。</div>
              </div>
            </div>
            <div className="card-bd">
              <div className="row cols2">
                <div className="field">
                  <div className="label">廣告名稱<span className="req">*</span></div>
                  <input value={state.adName} onChange={(e) => setState((s) => ({ ...s, adName: e.target.value }))} />
                  {errors.adName && <div className="error">{errors.adName}</div>}
                </div>
                <div className="field">
                  <div className="label">素材來源</div>
                  <select
                    value={state.useExistingPost ? "existing" : "link"}
                    onChange={(e) => {
                      setState((s) => ({ ...s, useExistingPost: e.target.value === "existing" }));
                      setResolvedPost(null);
                    }}
                  >
                    <option value="existing">使用既有貼文</option>
                    <option value="link">建立連結廣告</option>
                  </select>
                </div>
                <div className="field">
                  <div className="label">目標 {targetMetricLabel}</div>
                  <input
                    value={state.targetValue}
                    inputMode="numeric"
                    onChange={(e) => setState((s) => ({ ...s, targetValue: e.target.value }))}
                    placeholder="例如 300000"
                  />
                  <div className="hint">達到這個數字後，成效頁會自動嘗試停止投放。</div>
                  {errors.targetValue && <div className="error">{errors.targetValue}</div>}
                </div>
                {state.useExistingPost ? null : (
                  <div className="field">
                    <div className="label">網址<span className="req">*</span></div>
                    <input value={state.landingUrl} onChange={(e) => setState((s) => ({ ...s, landingUrl: e.target.value }))} placeholder="https://..." />
                    {errors.landingUrl && <div className="error">{errors.landingUrl}</div>}
                  </div>
                )}
              </div>

              {state.useExistingPost ? (
                <>
                  <div className="sep" />
                  <div className="actions inline">
                    <button className={`btn ${state.existingPostMode === "picker" ? "primary" : ""}`} type="button" onClick={() => setState((s) => ({ ...s, existingPostMode: "picker" }))}>
                      從近期貼文挑選
                    </button>
                    <button className={`btn ${state.existingPostMode === "url" ? "primary" : ""}`} type="button" onClick={() => setState((s) => ({ ...s, existingPostMode: "url", existingPostId: "", trackingPostId: "" }))}>
                      貼上貼文連結
                    </button>
                    <button className={`btn ${state.existingPostMode === "id" ? "primary" : ""}`} type="button" onClick={() => setState((s) => ({ ...s, existingPostMode: "id" }))}>
                      手動輸入貼文 ID
                    </button>
                  </div>

                  {state.existingPostMode === "picker" ? (
                    <>
                      <div className="sep" />
                      <div className="actions inline">
                        <span className="hint">目前抓取 {formatPlatform(goal.platform)} 的近期貼文。</span>
                        <button className="btn" type="button" onClick={() => void loadExistingPosts()} disabled={loadingPosts}>
                          {loadingPosts ? "載入中..." : "載入近期貼文"}
                        </button>
                      </div>
                      {postLoadMessage && <div className="hint" style={{ marginTop: 8 }}>{postLoadMessage}</div>}
                      {errors.existingPostId && <div className="error" style={{ marginTop: 8 }}>{errors.existingPostId}</div>}
                      <div className="list" style={{ marginTop: 10 }}>
                        {postOptions.map((post) => {
                          const active = state.existingPostId === post.id;
                          return (
                            <button
                              key={post.id}
                              type="button"
                              className={`item meta-post-option ${active ? "is-active" : ""}`}
                              onClick={() => applyPickedPost(post)}
                            >
                              <div className="item-hd">
                                <div className="item-title">{post.label || post.id}</div>
                                <span className="tag">{active ? "已選擇" : "選這篇"}</span>
                              </div>
                              <div className="hint">{post.createdTime ? formatDateTime(post.createdTime) : "未提供時間"}</div>
                              {post.message ? <div className="hint" style={{ marginTop: 6 }}>{post.message}</div> : null}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : null}

                  {state.existingPostMode === "url" ? (
                    <>
                      <div className="sep" />
                      <div className="field">
                        <div className="label">貼文連結<span className="req">*</span></div>
                        <input value={state.existingPostSource} onChange={(e) => setState((s) => ({ ...s, existingPostSource: e.target.value }))} placeholder="https://www.facebook.com/... 或 https://www.instagram.com/..." />
                        {errors.existingPostSource && <div className="error">{errors.existingPostSource}</div>}
                        <div className="hint">確認頁會先解析連結，換成可投放與可追蹤的貼文參照。</div>
                      </div>
                    </>
                  ) : null}

                  {state.existingPostMode === "id" ? (
                    <>
                      <div className="sep" />
                      <div className="row cols2">
                        <div className="field">
                          <div className="label">貼文 ID<span className="req">*</span></div>
                          <input value={state.existingPostId} onChange={(e) => setState((s) => ({ ...s, existingPostId: e.target.value }))} placeholder={goal.platform === "facebook" ? "pageId_postId 或 postId" : "Instagram media id"} />
                          {errors.existingPostId && <div className="error">{errors.existingPostId}</div>}
                        </div>
                        <div className="field">
                          <div className="label">原始連結或備註</div>
                          <input value={state.existingPostSource} onChange={(e) => setState((s) => ({ ...s, existingPostSource: e.target.value }))} placeholder="可留原始連結，供後續查詢" />
                        </div>
                      </div>
                    </>
                  ) : null}
                  {errors.trackingPostId && <div className="error" style={{ marginTop: 8 }}>{errors.trackingPostId}</div>}
                </>
              ) : null}

              <div className="row cols2" style={{ marginTop: 12 }}>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <div className="label">主要文案</div>
                  <textarea rows={4} value={state.message} onChange={(e) => setState((s) => ({ ...s, message: e.target.value }))} />
                </div>

                {state.useExistingPost ? null : (
                  <div className="field">
                    <div className="label">行動呼籲</div>
                    <select value={state.ctaType} onChange={(e) => setState((s) => ({ ...s, ctaType: e.target.value }))}>
                      <option value="LEARN_MORE">了解更多</option>
                      <option value="SHOP_NOW">立即購買</option>
                      <option value="SIGN_UP">立即註冊</option>
                      <option value="CONTACT_US">聯絡我們</option>
                      <option value="VIEW_MORE">查看更多</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="sep" />
              <div className="actions inline">
                <button className="btn primary" type="button" onClick={() => void goConfirm()} disabled={resolvingPost}>
                  {resolvingPost ? "準備中..." : "下一步"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="grid">
          <div className="card">
            <div className="card-hd">
              <div>
                <div className="card-title">確認資料</div>
                <div className="card-desc">確認無誤後送出投放。</div>
              </div>
            </div>
            <div className="card-bd">
              <div className="row cols2">
                <div className="field">
                  <div className="label">投放帳號</div>
                  <input value={selectedAccount ? `${selectedAccount.label} / act_${selectedAccount.adAccountId}` : effectiveCfg.adAccountId || "-"} readOnly />
                </div>
                <div className="field">
                  <div className="label">產業模板</div>
                  <input value={selectedIndustry?.label || "未套用"} readOnly />
                </div>
                <div className="field">
                  <div className="label">任務名稱</div>
                  <input value={previewInput.title || "-"} readOnly />
                </div>
                <div className="field">
                  <div className="label">投放目標</div>
                  <input value={goal.label} readOnly />
                </div>
                <div className="field">
                  <div className="label">預算</div>
                  <input value={`NT$ ${previewInput.dailyBudget.toLocaleString("zh-TW")}`} readOnly />
                </div>
                <div className="field">
                  <div className="label">手動版位</div>
                  <input value={`Facebook ${previewInput.manualPlacements.facebook.length} 項 / Instagram ${previewInput.manualPlacements.instagram.length} 項`} readOnly />
                </div>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <div className="label">素材</div>
                  <input value={state.useExistingPost ? resolvedPost?.existingPostSource || resolvedPost?.existingPostId || "既有貼文" : previewInput.landingUrl || "-"} readOnly />
                </div>
                <div className="field">
                  <div className="label">開始時間</div>
                  <input value={formatDateTime(state.startTime)} readOnly />
                </div>
                <div className="field">
                  <div className="label">結束時間</div>
                  <input value={state.endTime ? formatDateTime(state.endTime) : "不設定"} readOnly />
                </div>
                <div className="field">
                  <div className="label">目標 {targetMetricLabel}</div>
                  <input value={previewInput.targetValue == null ? "-" : previewInput.targetValue.toLocaleString("zh-TW")} readOnly />
                </div>
                <div className="field">
                  <div className="label">Facebook 版位</div>
                  <input value={fbPlacementLabels.join("、") || "未設定"} readOnly />
                </div>
                <div className="field">
                  <div className="label">Instagram 版位</div>
                  <input value={igPlacementLabels.join("、") || "未設定"} readOnly />
                </div>
              </div>

              <div className="sep" />
              <div className="actions inline">
                <button className="btn" type="button" onClick={() => setStep("edit")} disabled={submitting}>
                  返回
                </button>
                <button className="btn primary" type="button" onClick={submit} disabled={submitting}>
                  {submitting ? "送出中" : "確認送出"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === "submitted" && (
        <div className="grid">
          <div className="card">
            <div className="card-hd">
              <div>
                <div className="card-title">送出結果</div>
              </div>
            </div>
            <div className="card-bd">
              {submitMsg && <div className="hint">{submitMsg}</div>}
              <div className="sep" />
              <div className="hint">建立完成後，可到投放成效頁查看最新進度與數據。</div>
              <div className="sep" />
              <div className="actions inline">
                <button className="btn" onClick={() => { setState(defaultState()); setEditingOrderId(null); clearEditQuery(); setStep("edit"); }}>
                  再建一筆
                </button>
                <button className="btn primary" onClick={() => nav("/ad-performance")}>
                  前往投放成效
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


