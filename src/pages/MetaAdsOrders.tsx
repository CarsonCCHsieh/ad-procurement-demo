import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getMetaConfig } from "../config/metaConfig";
import { getManagedMetaAccount, getMetaPresetConfig, type MetaIndustryPreset } from "../config/metaPresetConfig";
import { buildMetaPayloads } from "../lib/metaPayload";
import { META_AD_GOALS, getGoalPrimaryMetricKey, type MetaAdGoalKey, type MetaKpiMetricKey } from "../lib/metaGoals";
import { addMetaOrder, listMetaOrders, updateMetaOrder, type MetaOrder, type MetaOrderInput } from "../lib/metaOrdersStore";
import { resolveMetaPostReference, submitMetaOrderToGraph, type MetaResolvedPostPreview } from "../lib/metaGraphApi";
import type { MetaTrackingRef } from "../lib/ordersStore";
import { isValidUrl } from "../lib/validate";
import { SHARED_SYNC_EVENT } from "../lib/sharedSync";

type FormState = {
  industryKey: string;
  title: string;
  campaignName: string;
  adsetName: string;
  adName: string;
  goal: MetaAdGoalKey;
  message: string;
  ctaType: string;
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
  preview?: MetaResolvedPostPreview;
};

const GOAL_OPTIONS: Array<{ key: MetaAdGoalKey; label: string; platform: "facebook" | "instagram" }> = [
  { key: "fb_post_likes", label: "Facebook 貼文讚", platform: "facebook" },
  { key: "fb_post_engagement", label: "Facebook 互動", platform: "facebook" },
  { key: "fb_reach", label: "Facebook 觸及", platform: "facebook" },
  { key: "fb_video_views", label: "Facebook 影片觀看", platform: "facebook" },
  { key: "ig_post_spread", label: "Instagram 貼文擴散", platform: "instagram" },
  { key: "ig_reels_spread", label: "Instagram Reels 擴散", platform: "instagram" },
  { key: "ig_video_views", label: "Instagram 影片觀看", platform: "instagram" },
  { key: "ig_engagement", label: "Instagram 互動", platform: "instagram" },
  { key: "ig_followers", label: "Instagram 帳號增粉", platform: "instagram" },
];

const GOAL_LABEL = new Map(GOAL_OPTIONS.map((option) => [option.key, option.label]));

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

const FB_POSITION_LABEL = new Map(FB_POSITION_OPTIONS.map((item) => [item.value, item.label]));
const IG_POSITION_LABEL = new Map(IG_POSITION_OPTIONS.map((item) => [item.value, item.label]));

const CTA_OPTIONS = [
  { value: "LEARN_MORE", label: "了解更多" },
  { value: "SHOP_NOW", label: "立即購買" },
  { value: "SIGN_UP", label: "立即註冊" },
  { value: "CONTACT_US", label: "聯絡我們" },
  { value: "VIEW_MORE", label: "查看更多" },
];

const GOAL_PRESETS: Record<
  MetaAdGoalKey,
  {
    ctaType: string;
    dailyBudget: string;
    fbPositions: string[];
    igPositions: string[];
  }
> = {
  fb_post_likes: { ctaType: "LEARN_MORE", dailyBudget: "1000", fbPositions: ["feed", "profile_feed", "story", "facebook_reels", "video_feeds", "search"], igPositions: ["stream", "story", "reels"] },
  fb_post_engagement: { ctaType: "LEARN_MORE", dailyBudget: "1000", fbPositions: ["feed", "profile_feed", "story", "facebook_reels", "video_feeds", "search"], igPositions: ["stream", "story", "reels"] },
  fb_reach: { ctaType: "VIEW_MORE", dailyBudget: "1000", fbPositions: ["feed", "story", "facebook_reels", "video_feeds", "search", "marketplace"], igPositions: ["stream", "story", "reels", "explore"] },
  fb_video_views: { ctaType: "VIEW_MORE", dailyBudget: "1000", fbPositions: ["video_feeds", "facebook_reels", "story", "feed"], igPositions: ["reels", "story", "stream"] },
  ig_post_spread: { ctaType: "VIEW_MORE", dailyBudget: "1000", fbPositions: ["feed", "story"], igPositions: ["stream", "story", "explore", "profile_feed"] },
  ig_reels_spread: { ctaType: "VIEW_MORE", dailyBudget: "1000", fbPositions: ["facebook_reels", "story"], igPositions: ["reels", "story", "explore"] },
  ig_video_views: { ctaType: "VIEW_MORE", dailyBudget: "1000", fbPositions: ["video_feeds", "facebook_reels"], igPositions: ["reels", "story", "stream"] },
  ig_engagement: { ctaType: "LEARN_MORE", dailyBudget: "1000", fbPositions: ["feed", "story", "facebook_reels"], igPositions: ["stream", "story", "reels", "explore"] },
  ig_followers: { ctaType: "VIEW_MORE", dailyBudget: "1000", fbPositions: ["feed", "story", "facebook_reels"], igPositions: ["stream", "story", "reels", "explore", "profile_feed"] },
};

const TARGET_RECOMMENDS_TRACKING = new Set(["likes", "comments", "shares", "interactions_total", "followers", "profile_visits"]);

function parseTextList(raw: string): string[] {
  return raw.split(/[\r\n,]+/g).map((value) => value.trim()).filter(Boolean);
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
  return { ...prev, goal, ctaType: preset.ctaType, dailyBudget: preset.dailyBudget, fbPositions: preset.fbPositions, igPositions: preset.igPositions };
}

function applyIndustryPreset(prev: FormState, industry: MetaIndustryPreset): FormState {
  const nextGoal = industry.recommendedGoals.includes(prev.goal) ? prev.goal : industry.recommendedGoals[0] ?? prev.goal;
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
    fbPositions: industry.fbPositions.length > 0 ? industry.fbPositions : next.fbPositions,
    igPositions: industry.igPositions.length > 0 ? industry.igPositions : next.igPositions,
  };
}

function defaultState(): FormState {
  const presetCfg = getMetaPresetConfig();
  const start = new Date(Date.now() + 15 * 60 * 1000);
  const seed: FormState = {
    industryKey: presetCfg.industries.find((industry) => industry.enabled)?.key ?? "",
    title: "新投放任務",
    campaignName: "新行銷活動",
    adsetName: "新廣告組合",
    adName: "新廣告",
    goal: "fb_post_engagement",
    message: "",
    ctaType: "LEARN_MORE",
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

function formStateFromOrder(row: MetaOrder): FormState {
  return {
    industryKey: row.industryKey ?? "",
    title: row.title ?? "",
    campaignName: row.campaignName ?? "",
    adsetName: row.adsetName ?? "",
    adName: row.adName ?? "",
    goal: row.goal,
    message: row.message ?? "",
    ctaType: row.ctaType ?? "LEARN_MORE",
    existingPostSource: row.existingPostSource ?? row.trackingRef?.sourceUrl ?? row.landingUrl ?? "",
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
    preview: {
      id: row.existingPostId ?? row.trackingPostId ?? row.trackingRef?.refId ?? "",
      permalink: row.existingPostSource ?? row.trackingRef?.sourceUrl,
      message: row.message,
    },
  };
}

function toGenders(gender: FormState["gender"]): number[] {
  if (gender === "male") return [1];
  if (gender === "female") return [2];
  return [];
}

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function formatDateTime(isoOrLocal: string): string {
  if (!isoOrLocal) return "-";
  const dt = new Date(isoOrLocal);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString("zh-TW", { hour12: false });
}

function summarizeAudience(raw: string): string[] {
  return parseTextList(raw)
    .map((line) => {
      const [, label] = line.split("|");
      return (label || line).trim();
    })
    .filter(Boolean)
    .slice(0, 6);
}

function summarizeIds(raw: string): string {
  const count = parseTextList(raw).length;
  return count > 0 ? `已設定 ${count} 組` : "未設定";
}

function getGoalLabel(goal: MetaAdGoalKey): string {
  return GOAL_LABEL.get(goal) ?? goal;
}

function getPrimaryMetricLabel(goal: MetaAdGoalKey): string {
  return PRIMARY_METRIC_LABEL[getGoalPrimaryMetricKey(goal)] ?? "目標數值";
}

function validate(s: FormState, effectiveConfig: { adAccountId: string; pageId: string; instagramActorId: string }): Errors {
  const errors: Errors = {};
  if (!effectiveConfig.adAccountId.trim()) errors.industryKey = "請先由管理員在控制設定完成預設廣告帳號。";
  if (!s.title.trim()) errors.title = "請填寫任務名稱。";
  if (!s.campaignName.trim()) errors.campaignName = "請填寫行銷活動名稱。";
  if (!s.adsetName.trim()) errors.adsetName = "請填寫廣告組合名稱。";
  if (!s.adName.trim()) errors.adName = "請填寫廣告名稱。";
  if (!s.existingPostSource.trim()) errors.existingPostSource = "請貼上貼文連結。";
  else if (!isValidUrl(s.existingPostSource.trim())) errors.existingPostSource = "貼文連結格式不正確。";

  const target = Number(s.targetValue);
  if (s.targetValue.trim() && (!Number.isFinite(target) || target <= 0)) errors.targetValue = "目標數值需為正數。";

  const budget = Number(s.dailyBudget);
  if (!Number.isFinite(budget) || budget <= 0) errors.dailyBudget = "日預算需為正數。";

  if (!s.startTime.trim()) errors.startTime = "請填寫開始時間。";
  if (s.endTime.trim()) {
    const start = Date.parse(s.startTime);
    const end = Date.parse(s.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) errors.endTime = "結束時間需晚於開始時間。";
  }

  const ageMin = Number(s.ageMin);
  const ageMax = Number(s.ageMax);
  if (!Number.isFinite(ageMin) || ageMin < 13) errors.ageMin = "最小年齡需為 13 以上。";
  if (!Number.isFinite(ageMax) || ageMax < ageMin) errors.ageMax = "最大年齡需大於或等於最小年齡。";

  if (s.fbPositions.length + s.igPositions.length === 0) errors.fbPositions = "請至少勾選 1 個版位。";
  if (s.goal.startsWith("fb_") && !effectiveConfig.pageId.trim()) errors.industryKey = "目前未設定 Facebook 粉專資訊，請通知管理員。";
  if (s.goal.startsWith("ig_") && !effectiveConfig.instagramActorId.trim()) errors.industryKey = "目前未設定 Instagram Actor，請通知管理員。";
  return errors;
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
  const [resolvingPost, setResolvingPost] = useState(false);
  const [postValidationMessage, setPostValidationMessage] = useState<string | null>(null);
  const [showAdsetSection, setShowAdsetSection] = useState(false);
  const [showAdSection, setShowAdSection] = useState(false);

  const cfg = getMetaConfig();
  const metaPresetCfg = getMetaPresetConfig();
  const applicant = user?.displayName ?? user?.username ?? "";
  const canManage = hasRole("admin");
  const goal = META_AD_GOALS[state.goal];
  const targetMetricLabel = getPrimaryMetricLabel(state.goal);
  const targetMetricKey = getGoalPrimaryMetricKey(state.goal);
  const editId = searchParams.get("edit")?.trim() ?? "";
  const availableIndustries = metaPresetCfg.industries.filter((industry) => industry.enabled);
  const selectedAccount = getManagedMetaAccount(metaPresetCfg);
  const selectedIndustry = availableIndustries.find((industry) => industry.key === state.industryKey) ?? null;
  const effectiveCfg = {
    ...cfg,
    adAccountId: selectedAccount?.adAccountId || cfg.adAccountId,
    pageId: selectedAccount?.pageId || cfg.pageId,
    instagramActorId: selectedAccount?.instagramActorId || cfg.instagramActorId,
  };
  const selectedAccountSummary = selectedAccount ? `${selectedAccount.label} / act_${selectedAccount.adAccountId}` : effectiveCfg.adAccountId ? `act_${effectiveCfg.adAccountId}` : "尚未設定";
  const audienceLabels = useMemo(() => summarizeAudience(state.detailedTargetingText), [state.detailedTargetingText]);
  const customAudienceSummary = useMemo(() => summarizeIds(state.customAudienceIdsText), [state.customAudienceIdsText]);
  
  const postValidated = !!resolvedPost?.trackingPostId;

  const clearEditQuery = () => {
    if (!editId) return;
    const next = new URLSearchParams(searchParams);
    next.delete("edit");
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (!editId) return;
    const row = listMetaOrders().find((item) => item.id === editId);
    if (!row) return;
    setState(formStateFromOrder(row));
    setResolvedPost(buildResolvedSelectionFromOrder(row));
    setErrors({});
    setStep("edit");
    setSubmitMsg(null);
    setPostValidationMessage(null);
    setEditingOrderId(row.id);
    setShowAdsetSection(true);
    setShowAdSection(true);
  }, [editId]);

  useEffect(() => {
    const onSharedSync = () => setSharedTick((current) => current + 1);
    window.addEventListener(SHARED_SYNC_EVENT, onSharedSync);
    return () => window.removeEventListener(SHARED_SYNC_EVENT, onSharedSync);
  }, []);

  const countries = useMemo(
    () => state.countriesCsv.split(/[,\s]+/g).map((item) => item.trim().toUpperCase()).filter(Boolean),
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
      landingUrl: state.existingPostSource.trim(),
      message: state.message.trim(),
      ctaType: state.ctaType.trim() || "LEARN_MORE",
      useExistingPost: true,
      existingPostId: resolvedPost?.existingPostId || state.trackingPostId.trim() || undefined,
      existingPostSource: resolvedPost?.existingPostSource || state.existingPostSource.trim() || undefined,
      trackingPostId: (resolvedPost?.trackingPostId || state.trackingPostId.trim()) || undefined,
      trackingRef: resolvedPost?.trackingRef,
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
  const fbPlacementLabels = useMemo(() => previewInput.manualPlacements.facebook.map((item) => FB_POSITION_LABEL.get(item) ?? item), [previewInput.manualPlacements.facebook]);
  const igPlacementLabels = useMemo(() => previewInput.manualPlacements.instagram.map((item) => IG_POSITION_LABEL.get(item) ?? item), [previewInput.manualPlacements.instagram]);

  const applyIndustry = (industryKey: string) => {
    const industry = availableIndustries.find((item) => item.key === industryKey);
    if (!industry) {
      setState((current) => ({ ...current, industryKey }));
      return;
    }
    setState((current) => applyIndustryPreset({ ...current, industryKey }, industry));
    setResolvedPost(null);
    setPostValidationMessage(null);
  };

  const prepareResolvedPost = async (): Promise<ResolvedPostSelection | null> => {
    const source = state.existingPostSource.trim();
    if (!source) return null;
    const resolved = await resolveMetaPostReference({
      source,
      platform: goal.platform,
      pageId: effectiveCfg.pageId,
      pageName: selectedAccount?.pageName,
    });
    if (!resolved.ok || !resolved.trackingRef) {
      throw new Error(resolved.detail || "貼文連結解析失敗。");
    }
    return {
      existingPostId: resolved.existingPostId || resolved.trackingRef.refId,
      existingPostSource: source,
      trackingPostId: resolved.trackingRef.refId,
      trackingRef: resolved.trackingRef,
      postLabel: source,
      preview: resolved.preview,
    };
  };

  const validatePostSource = async () => {
    const source = state.existingPostSource.trim();
    if (!source) {
      setErrors((current) => ({ ...current, existingPostSource: "請貼上貼文連結。" }));
      return;
    }
    if (!isValidUrl(source)) {
      setErrors((current) => ({ ...current, existingPostSource: "貼文連結格式不正確。" }));
      return;
    }

    setResolvingPost(true);
    setPostValidationMessage(null);
    try {
      const prepared = await prepareResolvedPost();
      if (!prepared?.trackingPostId) throw new Error("沒有取得可用的貼文 ID。");
      setResolvedPost(prepared);
      setState((current) => ({ ...current, trackingPostId: prepared.trackingPostId || current.trackingPostId, message: current.message || prepared.preview?.message || "" }));
      setErrors((current) => ({ ...current, existingPostSource: undefined, trackingPostId: undefined }));
      setPostValidationMessage(null);
    } catch (error) {
      setResolvedPost(null);
      setErrors((current) => ({ ...current, existingPostSource: error instanceof Error ? error.message : "貼文連結解析失敗。" }));
    } finally {
      setResolvingPost(false);
    }
  };

  const goConfirm = async () => {
    const nextErrors = validate(state, effectiveCfg);
    setErrors(nextErrors);
    setSubmitMsg(null);
    if (Object.keys(nextErrors).length > 0) return;
    if (!showAdsetSection) {
      setSubmitMsg("請先新增廣告組合。");
      return;
    }
    if (!showAdSection) {
      setSubmitMsg("請先新增廣告。");
      return;
    }

    if (!postValidated) {
      setErrors((current) => ({
        ...current,
        trackingPostId: "請先驗證貼文，確認貼文資訊後才能進入下一步。",
      }));
      return;
    }

    if (!resolvedPost?.trackingPostId && TARGET_RECOMMENDS_TRACKING.has(targetMetricKey) && state.targetValue.trim()) {
      setErrors((current) => ({ ...current, trackingPostId: "這個目標需要可追蹤的貼文，驗證完成後才能自動停投。" }));
      return;
    }

    setStep("confirm");
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const result = await submitMetaOrderToGraph({ cfg: effectiveCfg, input: previewInput, payloads });
      const status = result.status === "submitted" ? "running" : "failed";
      const nextRow = {
        ...previewInput,
        targetCurrentValue: undefined,
        targetLastCheckedAt: undefined,
        targetReachedAt: undefined,
        status,
        apiStatusText: result.status === "submitted" ? "已建立投放" : "建立失敗",
        error: result.error,
        payloads,
        submitResult: result.result,
      };
      if (editingOrderId) {
        const updated = updateMetaOrder(editingOrderId, (old) => ({ ...old, ...nextRow }));
        if (!updated) addMetaOrder(nextRow);
      } else {
        addMetaOrder(nextRow);
      }
      setEditingOrderId(null);
      clearEditQuery();
      setSubmitMsg(result.status === "submitted" ? "已送出，系統會依設定建立 Meta 投放，並在成效頁每 5 分鐘檢查是否達標。" : `送出失敗：${result.error ?? "未知錯誤"}`);
      setStep("submitted");
    } finally {
      setSubmitting(false);
    }
  };

  const addAdsetSection = () => {
    setSubmitMsg(null);
    setShowAdsetSection(true);
    setState((current) => ({
      ...current,
      adsetName:
        current.adsetName.trim() && current.adsetName !== "新廣告組合"
          ? current.adsetName
          : current.campaignName.trim() || current.title.trim() || selectedIndustry?.label || "新廣告組合",
    }));
  };

  const addAdSection = () => {
    setSubmitMsg(null);
    setShowAdSection(true);
    setState((current) => ({
      ...current,
      adName:
        current.adName.trim() && current.adName !== "新廣告"
          ? current.adName
          : current.adsetName.trim() || current.campaignName.trim() || current.title.trim() || selectedIndustry?.label || "新廣告",
    }));
  };

  const resetForm = () => {
    setState(defaultState());
    setErrors({});
    setResolvedPost(null);
    setPostValidationMessage(null);
    setEditingOrderId(null);
    setShowAdsetSection(false);
    setShowAdSection(false);
    setSubmitMsg(null);
    clearEditQuery();
    setStep("edit");
  };

  return (
    <div className="container container--wide">
      <div className="topbar topbar--meta">
        <div className="brand brand--page">
          <div className="brand-title">{step === "edit" ? "Meta官方投廣" : step === "confirm" ? "確認送出" : "送出結果"}</div>
          <div className="brand-sub">依照行銷活動設定建立投放，送出後可在成效頁持續查看進度與是否達標。</div>
        </div>
        <div className="pill pill--nav">
          <span className="tag">{applicant}</span>
          <button className="btn" onClick={() => nav("/ad-orders")}>廠商互動下單</button>
          <button className="btn" onClick={() => nav("/ad-performance")}>投放成效</button>
          <button className="btn primary" onClick={() => nav("/meta-ads-orders")}>Meta官方投廣</button>
          {canManage ? <button className="btn" onClick={() => nav("/settings")}>控制設定</button> : null}
          <button className="btn danger" onClick={() => { signOut(); nav("/login", { replace: true }); }}>登出</button>
        </div>
      </div>
      {step === "edit" ? (
        <div className="grid">
          <div className="card section section-blue">
            <div className="card-hd">
              <div>
                <div className="card-title">行銷活動</div>
                <div className="card-desc">先選擇任務目標與產業模板，系統會帶入對應的受眾、版位與預算建議。</div>
              </div>
            </div>
            <div className="card-bd">
              <div className="row cols2">
                <div className="field"><div className="label">申請人</div><input value={applicant} readOnly /></div>
                <div className="field"><div className="label">目前使用帳號</div><input value={selectedAccountSummary} readOnly /><div className="hint">此帳號由管理員在控制設定預先指定。</div></div>
                <div className="field"><div className="label">任務名稱<span className="req">*</span></div><input value={state.title} onChange={(e) => setState((current) => ({ ...current, title: e.target.value }))} placeholder="例如：2026_JUKSY_春季主題投放" />{errors.title ? <div className="error">{errors.title}</div> : null}</div>
                <div className="field"><div className="label">行銷活動名稱<span className="req">*</span></div><input value={state.campaignName} onChange={(e) => setState((current) => ({ ...current, campaignName: e.target.value }))} placeholder="例如：2026_JUKSY_春季互動" />{errors.campaignName ? <div className="error">{errors.campaignName}</div> : null}</div>
                <div className="field"><div className="label">產業模板</div><select value={state.industryKey} onChange={(e) => applyIndustry(e.target.value)}><option value="">不套用</option>{availableIndustries.map((industry) => <option key={industry.key} value={industry.key}>{industry.label}</option>)}</select>{errors.industryKey ? <div className="error">{errors.industryKey}</div> : null}</div>
                <div className="field"><div className="label">投放目標<span className="req">*</span></div><select value={state.goal} onChange={(e) => setState((current) => applyGoalPreset(current, e.target.value as MetaAdGoalKey))}>{GOAL_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></div>
                <div className="field"><div className="label">日預算 TWD<span className="req">*</span></div><input value={state.dailyBudget} inputMode="numeric" onChange={(e) => setState((current) => ({ ...current, dailyBudget: e.target.value }))} />{errors.dailyBudget ? <div className="error">{errors.dailyBudget}</div> : null}</div>
                <div className="field"><div className="label">目標 {targetMetricLabel}</div><input value={state.targetValue} inputMode="numeric" onChange={(e) => setState((current) => ({ ...current, targetValue: e.target.value }))} placeholder="例如：300000" /><div className="hint">若填入目標值，成效頁會依據數據檢查是否已達標並自動停投。</div>{errors.targetValue ? <div className="error">{errors.targetValue}</div> : null}</div>
                <div className="field"><div className="label">開始時間<span className="req">*</span></div><input type="datetime-local" value={state.startTime} onChange={(e) => setState((current) => ({ ...current, startTime: e.target.value }))} />{errors.startTime ? <div className="error">{errors.startTime}</div> : null}</div>
                <div className="field"><div className="label">結束時間</div><input type="datetime-local" value={state.endTime} onChange={(e) => setState((current) => ({ ...current, endTime: e.target.value }))} />{errors.endTime ? <div className="error">{errors.endTime}</div> : null}</div>
              </div>

              {selectedIndustry ? (
                <>
                  <div className="sep" />
                  <div className="meta-preview-card">
                    <div className="meta-preview-grid">
                      <div><div className="label">模板說明</div><div className="hint">{selectedIndustry.description || "此模板會帶入受眾與版位建議。"}</div></div>
                      <div><div className="label">年齡 / 性別</div><div className="hint">{state.ageMin} - {state.ageMax} / {state.gender === "all" ? "不限" : state.gender === "male" ? "男性" : "女性"}</div></div>
                      <div><div className="label">興趣受眾</div><div className="hint">{audienceLabels.length > 0 ? audienceLabels.join("、") : "依模板自動帶入，無需手動輸入 ID。"}</div></div>
                      <div><div className="label">自訂受眾</div><div className="hint">{customAudienceSummary}</div></div>
                      <div><div className="label">排除受眾</div><div className="hint">{excludedAudienceSummary}</div></div>
                      <div><div className="label">版位</div><div className="hint">Facebook {state.fbPositions.length} 個 / Instagram {state.igPositions.length} 個</div></div>
                    </div>
                    {selectedIndustry.audienceNote ? <div className="hint" style={{ marginTop: 10 }}>{selectedIndustry.audienceNote}</div> : null}
                  </div>
                </>
              ) : null}

            </div>
          </div>

          {showAdsetSection ? (
            <div className="card section section-green">
              <div className="card-hd"><div><div className="card-title">廣告組合</div><div className="card-desc">系統已依任務名稱與模板帶入建議設定，你可以再微調。</div></div></div>
              <div className="card-bd">
                <div className="row cols2">
                  <div className="field"><div className="label">廣告組合名稱<span className="req">*</span></div><input value={state.adsetName} onChange={(e) => setState((current) => ({ ...current, adsetName: e.target.value }))} />{errors.adsetName ? <div className="error">{errors.adsetName}</div> : null}</div>
                  <div className="field"><div className="label">投放國家</div><input value={state.countriesCsv} onChange={(e) => setState((current) => ({ ...current, countriesCsv: e.target.value }))} placeholder="TW" /></div>
                  <div className="field"><div className="label">最小年齡</div><input value={state.ageMin} inputMode="numeric" onChange={(e) => setState((current) => ({ ...current, ageMin: e.target.value }))} />{errors.ageMin ? <div className="error">{errors.ageMin}</div> : null}</div>
                  <div className="field"><div className="label">最大年齡</div><input value={state.ageMax} inputMode="numeric" onChange={(e) => setState((current) => ({ ...current, ageMax: e.target.value }))} />{errors.ageMax ? <div className="error">{errors.ageMax}</div> : null}</div>
                  <div className="field"><div className="label">性別</div><select value={state.gender} onChange={(e) => setState((current) => ({ ...current, gender: e.target.value as FormState["gender"] }))}><option value="all">不限</option><option value="male">男性</option><option value="female">女性</option></select></div>
                  <div className="field"><div className="label">受眾摘要</div><input value={audienceLabels.length > 0 ? audienceLabels.join("、") : "已依模板帶入"} readOnly /><div className="hint">Interest ID 與 Audience ID 由模板管理，一般使用者不需手動輸入。</div></div>
                </div>
                <div className="sep" />
                <div className="field">
                  <div className="label">版位<span className="req">*</span></div>
                  <div className="placement-grid">
                    <div className="placement-col"><div className="placement-title">Facebook</div>{FB_POSITION_OPTIONS.map((option) => <label key={option.value} className="check-row"><input type="checkbox" checked={state.fbPositions.includes(option.value)} onChange={() => setState((current) => ({ ...current, fbPositions: toggleValue(current.fbPositions, option.value) }))} /><span>{option.label}</span></label>)}</div>
                    <div className="placement-col"><div className="placement-title">Instagram</div>{IG_POSITION_OPTIONS.map((option) => <label key={option.value} className="check-row"><input type="checkbox" checked={state.igPositions.includes(option.value)} onChange={() => setState((current) => ({ ...current, igPositions: toggleValue(current.igPositions, option.value) }))} /><span>{option.label}</span></label>)}</div>
                  </div>
                  {errors.fbPositions ? <div className="error">{errors.fbPositions}</div> : null}
                </div>
                <div className="actions"><button className="btn primary" type="button" onClick={addAdSection}>新增廣告</button></div>
              </div>
            </div>
          ) : (
            <div className="card meta-flow-placeholder"><div className="card-bd"><div className="card-title">廣告組合</div><div className="card-desc">先完成行銷活動設定，再新增廣告組合。</div><div className="actions"><button className="btn" type="button" onClick={addAdsetSection}>新增廣告組合</button></div></div></div>
          )}

          {showAdSection ? (
            <div className="card section section-amber">
              <div className="card-hd"><div><div className="card-title">廣告</div><div className="card-desc">先貼上要推廣的貼文連結，驗證成功後再送出。</div></div></div>
              <div className="card-bd">
                <div className="row cols2">
                  <div className="field"><div className="label">廣告名稱<span className="req">*</span></div><input value={state.adName} onChange={(e) => setState((current) => ({ ...current, adName: e.target.value }))} />{errors.adName ? <div className="error">{errors.adName}</div> : null}</div>
                  <div className="field"><div className="label">行動按鈕</div><select value={state.ctaType} onChange={(e) => setState((current) => ({ ...current, ctaType: e.target.value }))}>{CTA_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <div className="label">貼文連結<span className="req">*</span></div>
                    <div className="inline-fields meta-inline-validate">
                      <input value={state.existingPostSource} onChange={(e) => { const value = e.target.value; setState((current) => ({ ...current, existingPostSource: value })); setResolvedPost(null); setPostValidationMessage(null); }} placeholder="https://www.facebook.com/... 或 https://www.instagram.com/..." style={{ width: "100%" }} />
                      <button className="btn" type="button" onClick={() => void validatePostSource()} disabled={resolvingPost}>{resolvingPost ? "驗證中..." : "驗證貼文"}</button>
                    </div>
                    {errors.existingPostSource ? <div className="error">{errors.existingPostSource}</div> : null}
                    {errors.trackingPostId ? <div className="error">{errors.trackingPostId}</div> : null}
                  </div>
                  {resolvedPost?.preview ? (
                    <div className="meta-preview-card" style={{ gridColumn: "1 / -1" }}>
                      <div className="meta-preview-grid">
                        <div><div className="label">貼文 ID</div><div className="hint">{resolvedPost.preview.id || resolvedPost.trackingPostId || "-"}</div></div>
                        <div><div className="label">貼文時間</div><div className="hint">{resolvedPost.preview.createdTime ? formatDateTime(resolvedPost.preview.createdTime) : "未提供"}</div></div>
                        <div style={{ gridColumn: "1 / -1" }}><div className="label">文案</div><div className="hint">{resolvedPost.preview.message || "未提供"}</div></div>
                      </div>
                      {resolvedPost.preview.permalink ? <div className="actions" style={{ marginTop: 10 }}><a className="btn" href={resolvedPost.preview.permalink} target="_blank" rel="noreferrer">開啟原貼文</a></div> : null}
                    </div>
                  ) : null}
                  <div className="field" style={{ gridColumn: "1 / -1" }}><div className="label">主要文案</div><textarea rows={5} value={state.message} onChange={(e) => setState((current) => ({ ...current, message: e.target.value }))} placeholder="若驗證成功後有抓到文案，系統會自動帶入。" /></div>
                </div>
                <div className="actions"><button className="btn primary" type="button" onClick={() => void goConfirm()} disabled={resolvingPost || !postValidated}>下一步</button></div>
              </div>
            </div>
          ) : (
            <div className="card meta-flow-placeholder"><div className="card-bd"><div className="card-title">廣告</div><div className="card-desc">新增廣告組合後，才會建立廣告設定與貼文驗證流程。</div><div className="actions"><button className="btn" type="button" onClick={addAdSection} disabled={!showAdsetSection}>新增廣告</button></div></div></div>
          )}

          {submitMsg ? <div className="error">{submitMsg}</div> : null}
        </div>
      ) : null}

      {step === "confirm" ? (
        <div className="grid">
          <div className="card section section-slate">
            <div className="card-hd"><div><div className="card-title">確認送出</div><div className="card-desc">確認系統將建立的行銷活動、廣告組合與廣告內容。</div></div></div>
            <div className="card-bd">
              <div className="row cols2">
                <div className="field"><div className="label">投放帳號</div><input value={selectedAccountSummary} readOnly /></div>
                <div className="field"><div className="label">產業模板</div><input value={selectedIndustry?.label || "未套用"} readOnly /></div>
                <div className="field"><div className="label">任務名稱</div><input value={previewInput.title || "-"} readOnly /></div>
                <div className="field"><div className="label">投放目標</div><input value={getGoalLabel(state.goal)} readOnly /></div>
                <div className="field"><div className="label">行銷活動名稱</div><input value={previewInput.campaignName || "-"} readOnly /></div>
                <div className="field"><div className="label">廣告組合名稱</div><input value={previewInput.adsetName || "-"} readOnly /></div>
                <div className="field"><div className="label">廣告名稱</div><input value={previewInput.adName || "-"} readOnly /></div>
                <div className="field"><div className="label">日預算</div><input value={`NT$ ${previewInput.dailyBudget.toLocaleString("zh-TW")}`} readOnly /></div>
                <div className="field"><div className="label">開始時間</div><input value={formatDateTime(state.startTime)} readOnly /></div>
                <div className="field"><div className="label">結束時間</div><input value={state.endTime ? formatDateTime(state.endTime) : "不設定"} readOnly /></div>
                <div className="field"><div className="label">目標 {targetMetricLabel}</div><input value={previewInput.targetValue == null ? "-" : previewInput.targetValue.toLocaleString("zh-TW")} readOnly /></div>
                <div className="field"><div className="label">版位</div><input value={`Facebook：${fbPlacementLabels.join("、") || "未設定"} / Instagram：${igPlacementLabels.join("、") || "未設定"}`} readOnly /></div>
              </div>
              <div className="sep" />
              <div className="meta-preview-card">
                <div className="meta-preview-grid">
                  <div><div className="label">貼文來源</div><div className="hint">{resolvedPost?.existingPostSource || previewInput.existingPostSource || "-"}</div></div>
                  <div><div className="label">貼文 ID</div><div className="hint">{resolvedPost?.preview?.id || resolvedPost?.trackingPostId || previewInput.trackingPostId || "-"}</div></div>
                  <div><div className="label">貼文時間</div><div className="hint">{resolvedPost?.preview?.createdTime ? formatDateTime(resolvedPost.preview.createdTime) : "未提供"}</div></div>
                  <div><div className="label">行動按鈕</div><div className="hint">{CTA_OPTIONS.find((item) => item.value === state.ctaType)?.label || state.ctaType}</div></div>
                  <div style={{ gridColumn: "1 / -1" }}><div className="label">文案</div><div className="hint">{state.message || resolvedPost?.preview?.message || "未提供"}</div></div>
                </div>
              </div>
              <div className="actions"><button className="btn" type="button" onClick={() => setStep("edit")} disabled={submitting}>返回修改</button><button className="btn primary" type="button" onClick={submit} disabled={submitting}>{submitting ? "送出中..." : "確認送出"}</button></div>
            </div>
          </div>
        </div>
      ) : null}

      {step === "submitted" ? (
        <div className="grid">
          <div className="card section section-green">
            <div className="card-hd"><div><div className="card-title">送出結果</div></div></div>
            <div className="card-bd">
              {submitMsg ? <div className="hint">{submitMsg}</div> : null}
              <div className="sep" />
              <div className="hint">你可以前往投放成效頁查看 Meta 投放狀態、成效數據與是否已達標。</div>
              <div className="actions"><button className="btn" type="button" onClick={resetForm}>再建一筆</button><button className="btn primary" type="button" onClick={() => nav("/ad-performance")}>前往投放成效</button></div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


