import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { fetchMetaConfigFromServer, getMetaConfig, type MetaConfigV1 } from "../config/metaConfig";
import {
  getDefaultMetaIndustry,
  getManagedMetaAccount,
  getMetaPresetConfig,
  type MetaIndustryPreset,
} from "../config/metaPresetConfig";
import {
  META_CAMPAIGN_OBJECTIVE_OPTIONS,
  getPerformanceGoal,
  listPerformanceGoalsByObjective,
  type MetaAdGoalKey,
  type MetaCampaignObjective,
} from "../lib/metaGoals";
import { getPerformanceGoalTargetLabel, getTrackedMetricKeyForPerformanceGoal } from "../lib/metaOrderCapabilities";
import { apiUrl } from "../lib/apiBase";
import { listMetaOrders, replaceMetaOrders, type MetaOrder } from "../lib/metaOrdersStore";

type DeliveryMode = "direct" | "optimized";
type WizardStep = "campaign" | "creative" | "audience" | "review" | "done";

type ResolvedPost = {
  trackingRef?: Record<string, unknown>;
  existingPostId?: string;
  preview?: {
    id?: string;
    createdTime?: string;
    message?: string;
    permalink?: string;
  } | null;
};

type FormState = {
  applicant: string;
  title: string;
  industryKey: string;
  deliveryMode: DeliveryMode;
  campaignObjective: MetaCampaignObjective;
  performanceGoalCode: string;
  campaignName: string;
  adsetName: string;
  adName: string;
  postUrl: string;
  destinationUrl: string;
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
  audienceNote: string;
  fbPositions: string[];
  igPositions: string[];
};

const FB_POSITION_OPTIONS = [
  { value: "feed", label: "Facebook 動態消息" },
  { value: "profile_feed", label: "Facebook 個人檔案動態消息" },
  { value: "story", label: "Facebook 限時動態" },
  { value: "facebook_reels", label: "Facebook Reels" },
  { value: "video_feeds", label: "Facebook 影片動態消息" },
  { value: "search", label: "Facebook 搜尋結果" },
];

const IG_POSITION_OPTIONS = [
  { value: "stream", label: "Instagram 動態消息" },
  { value: "story", label: "Instagram 限時動態" },
  { value: "reels", label: "Instagram Reels" },
  { value: "explore", label: "Instagram 探索" },
  { value: "profile_feed", label: "Instagram 個人檔案動態消息" },
];

const STEP_META: Array<{ key: WizardStep; label: string; desc: string }> = [
  { key: "campaign", label: "1. 投放目標", desc: "產業、目標、預算與投遞模式" },
  { key: "creative", label: "2. 貼文驗證", desc: "貼上貼文連結並確認素材" },
  { key: "audience", label: "3. 受眾與版位", desc: "套用模板並補充 TA 方向" },
  { key: "review", label: "4. 確認送出", desc: "檢查建立內容" },
];

const WIZARD_STEP_ORDER: WizardStep[] = ["campaign", "creative", "audience", "review"];

function toLocalInput(date = new Date(Date.now() + 15 * 60 * 1000)) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function localInputToIso(value: string) {
  return value ? new Date(value).toISOString() : "";
}

function parseCsv(value: string) {
  return value.split(/[,，\n]/g).map((item) => item.trim()).filter(Boolean);
}

function parseIdLines(value: string) {
  return value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("|")[0]?.trim())
    .filter((id) => /^\d+$/.test(id));
}

function parseInterestObjects(value: string) {
  return value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [id, name] = line.split("|").map((item) => item.trim());
      return /^\d+$/.test(id) ? { id, name: name || undefined } : null;
    })
    .filter((item): item is { id: string; name: string | undefined } => !!item);
}

function listTemplateNotes(value: string) {
  return value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("#") && !line.startsWith("##"))
    .map((line) => line.replace(/^#\s*/, ""))
    .filter(Boolean);
}

function mergeInterestText(existing: string, interests: Array<{ id?: string; name?: string }>) {
  const lines = existing.split(/\r?\n/g).map((line) => line.trim()).filter(Boolean);
  const existingIds = new Set(parseInterestObjects(existing).map((item) => item.id));
  const additions = interests
    .filter((item) => item.id && /^\d+$/.test(item.id) && !existingIds.has(item.id))
    .map((item) => `${item.id}|${item.name || item.id}`);
  return [...lines, ...additions].join("\n");
}

function toGenders(value: FormState["gender"]) {
  if (value === "male") return [1];
  if (value === "female") return [2];
  return [];
}

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function labelFor(options: Array<{ value: string; label: string }>, value: string) {
  return options.find((item) => item.value === value)?.label ?? value;
}

function isLikelyMetaPostUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl.trim());
    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split("/").filter(Boolean);
    if (host.endsWith("instagram.com") || host.endsWith("instagr.am")) {
      return ["p", "reel", "reels", "tv"].includes(segments[0] || "") && !!segments[1];
    }
    if (host.endsWith("facebook.com") || host.endsWith("fb.com")) {
      if (url.searchParams.get("story_fbid") || url.searchParams.get("fbid")) return true;
      if (segments.includes("posts") || segments.includes("videos")) return true;
      if (segments[0] === "reel" && segments[1]) return true;
      if (segments.some((item) => /^pfbid/i.test(item))) return true;
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

function buildInitialState(applicant: string): FormState {
  const presets = getMetaPresetConfig();
  const industry = getDefaultMetaIndustry(presets);
  const defaultName = "新投放任務";
  const seed: FormState = {
    applicant,
    title: defaultName,
    industryKey: industry?.key || "",
    deliveryMode: "direct",
    campaignObjective: "OUTCOME_ENGAGEMENT",
    performanceGoalCode: "ENGAGEMENT_POST_ENGAGEMENT",
    campaignName: defaultName,
    adsetName: defaultName,
    adName: defaultName,
    postUrl: "",
    destinationUrl: "",
    targetValue: "",
    dailyBudget: "1000",
    startTime: toLocalInput(),
    endTime: "",
    countriesCsv: "TW",
    ageMin: "18",
    ageMax: "49",
    gender: "all",
    detailedTargetingText: "",
    customAudienceIdsText: "",
    excludedAudienceIdsText: "",
    audienceNote: "",
    fbPositions: [],
    igPositions: [],
  };
  return industry ? applyIndustry(seed, industry) : seed;
}

function applyIndustry(base: FormState, industry: MetaIndustryPreset): FormState {
  const goals = listPerformanceGoalsByObjective(base.campaignObjective);
  const nextGoal = goals.find((item) => industry.recommendedGoals.includes(item.defaultGoal)) ?? goals[0];
  return {
    ...base,
    industryKey: industry.key,
    performanceGoalCode: nextGoal.code,
    countriesCsv: industry.countriesCsv || "TW",
    ageMin: String(industry.ageMin || 18),
    ageMax: String(industry.ageMax || 49),
    gender: industry.gender,
    detailedTargetingText: industry.detailedTargetingText,
    customAudienceIdsText: industry.customAudienceIdsText,
    excludedAudienceIdsText: industry.excludedAudienceIdsText,
    audienceNote: "",
    dailyBudget: String(industry.dailyBudget || 1000),
    fbPositions: [],
    igPositions: [],
  };
}

function StepNav({ step, setStep, canReview }: { step: WizardStep; setStep: (step: WizardStep) => void; canReview: boolean }) {
  const currentIndex = WIZARD_STEP_ORDER.indexOf(step);
  return (
    <div className="meta-step-nav">
      {STEP_META.map((item) => {
        const targetIndex = WIZARD_STEP_ORDER.indexOf(item.key);
        const disabled = targetIndex > currentIndex || (item.key === "review" && !canReview);
        return (
          <button
            key={item.key}
            className={`meta-step ${step === item.key ? "is-active" : ""}`}
            disabled={disabled}
            type="button"
            onClick={() => setStep(item.key)}
          >
            <span>{item.label}</span>
            <small>{item.desc}</small>
          </button>
        );
      })}
    </div>
  );
}

export function MetaAdsOrdersPage() {
  const nav = useNavigate();
  const { user, signOut, hasRole } = useAuth();
  const canManage = hasRole("admin");
  const presets = useMemo(() => getMetaPresetConfig(), []);
  const [cfg, setCfg] = useState<MetaConfigV1>(() => getMetaConfig());
  const [state, setState] = useState<FormState>(() => buildInitialState(user?.displayName ?? user?.username ?? ""));
  const [resolved, setResolved] = useState<ResolvedPost | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolvingAudience, setResolvingAudience] = useState(false);
  const [audienceQueries, setAudienceQueries] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<WizardStep>("campaign");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetchMetaConfigFromServer().then(setCfg).catch(() => undefined);
  }, []);

  const availableIndustries = presets.industries.filter((industry) => industry.enabled);
  const selectedIndustry = availableIndustries.find((industry) => industry.key === state.industryKey) ?? availableIndustries[0] ?? presets.industries[0];
  const objectiveGoals = listPerformanceGoalsByObjective(state.campaignObjective);
  const performanceGoal = getPerformanceGoal(state.performanceGoalCode);
  const targetMetricKey = getTrackedMetricKeyForPerformanceGoal(state.performanceGoalCode, performanceGoal.defaultGoal);
  const targetLabel = getPerformanceGoalTargetLabel(state.performanceGoalCode, performanceGoal.defaultGoal);
  const account = getManagedMetaAccount(presets, cfg.adAccountId);
  const effectiveAccountId = account?.adAccountId || cfg.adAccountId;
  const effectivePageId = account?.pageId || cfg.pageId;
  const effectiveIgActor = account?.instagramActorId || cfg.instagramActorId;
  const interestObjects = parseInterestObjects(state.detailedTargetingText);
  const customAudienceIds = parseIdLines(state.customAudienceIdsText);
  const excludedAudienceIds = parseIdLines(state.excludedAudienceIdsText);
  const templateNotes = listTemplateNotes(state.detailedTargetingText);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setState((current) => {
      if (key === "title") {
        const name = String(value);
        return { ...current, title: name, campaignName: name, adsetName: name, adName: name };
      }
      return { ...current, [key]: value };
    });
    if (key === "postUrl") setResolved(null);
  };

  const setObjective = (objective: MetaCampaignObjective) => {
    const nextGoal = listPerformanceGoalsByObjective(objective)[0];
    setState((current) => ({
      ...current,
      campaignObjective: objective,
      performanceGoalCode: nextGoal.code,
    }));
  };

  const resolvePost = async () => {
    if (!state.postUrl.trim()) {
      setMessage("請先貼上貼文連結。");
      return;
    }
    if (!isLikelyMetaPostUrl(state.postUrl)) {
      setResolved(null);
      setMessage("請貼上單篇 Facebook / Instagram 貼文或 Reels 連結，不要貼粉專首頁、帳號首頁或分享列表頁。");
      return;
    }
    setResolving(true);
    setMessage(null);
    try {
      const response = await fetch(apiUrl("/api/meta/resolve-post"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: state.postUrl, pageId: effectivePageId, pageName: cfg.pageName }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        const detail = data.detail || data.error || `HTTP ${response.status}`;
        const friendly = String(detail).includes("usable Meta post reference")
          ? "無法解析這個連結。請確認連結是公開的單篇 Facebook / Instagram 貼文或 Reels，且不是粉專首頁。"
          : detail;
        throw new Error(friendly);
      }
      setResolved(data);
      setMessage("貼文驗證成功。");
    } catch (error) {
      setResolved(null);
      setMessage(`貼文驗證失敗：${error instanceof Error ? error.message : "未知錯誤"}`);
    } finally {
      setResolving(false);
    }
  };

  const resolveAudience = async () => {
    const text = state.audienceNote.trim() || templateNotes.join("、");
    if (!text) {
      setMessage("請先填寫想補充的 TA 方向，例如品牌、族群、興趣或排除條件。");
      return;
    }
    setResolvingAudience(true);
    setMessage(null);
    try {
      const response = await fetch(apiUrl("/api/meta/resolve-audience"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audienceRequestNote: text,
          detailedTargetingText: state.detailedTargetingText,
          interestObjects,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setState((current) => ({
        ...current,
        detailedTargetingText: mergeInterestText(current.detailedTargetingText, data.interests || []),
      }));
      setAudienceQueries(Array.isArray(data.queries) ? data.queries : []);
      const count = Number(data.addedCount || 0);
      setMessage(count > 0 ? `已補充 ${count} 個可投遞興趣條件。` : "已完成搜尋，但目前沒有新增可投遞興趣條件；系統會保留原本模板設定。");
    } catch (error) {
      setMessage(`TA 補充失敗：${error instanceof Error ? error.message : "未知錯誤"}`);
    } finally {
      setResolvingAudience(false);
    }
  };

  const validate = () => {
    if (!effectiveAccountId) return "請先到控制設定指定預設廣告帳號。";
    if (!effectivePageId) return "請先到控制設定指定 Facebook 粉絲專頁。";
    if (!state.title.trim()) return "請填寫任務名稱。";
    if (!state.postUrl.trim()) return "請貼上貼文連結。";
    if (!resolved?.existingPostId) return "請先驗證貼文，成功後才能送出。";
    if (!Number.isFinite(Number(state.dailyBudget)) || Number(state.dailyBudget) <= 0) return "日預算需為正數。";
    if (state.targetValue.trim() && (!Number.isFinite(Number(state.targetValue)) || Number(state.targetValue) <= 0)) return "達標停投數值只能輸入正數。";
    if (Number(state.ageMin) < 13 || Number(state.ageMax) < Number(state.ageMin)) return "年齡範圍不正確。";
    if (state.fbPositions.length + state.igPositions.length === 0) return "請至少選擇一個版位。";
    return "";
  };

  const goReview = () => {
    const error = validate();
    if (error) {
      setMessage(error);
      return;
    }
    setMessage(null);
    setStep("review");
  };

  const submit = async () => {
    const error = validate();
    if (error) {
      setMessage(error);
      return;
    }
    const taskName = state.title.trim();
    setSubmitting(true);
    setMessage(null);
    try {
      const payload = {
        applicant: state.applicant,
        title: taskName,
        industryKey: selectedIndustry?.key,
        industryLabel: selectedIndustry?.label,
        deliveryMode: state.deliveryMode,
        campaignObjective: state.campaignObjective,
        performanceGoalCode: state.performanceGoalCode,
        performanceGoalLabel: performanceGoal.label,
        optimizationGoal: performanceGoal.optimizationGoal,
        goal: performanceGoal.defaultGoal as MetaAdGoalKey,
        adAccountId: effectiveAccountId,
        pageId: effectivePageId,
        instagramActorId: effectiveIgActor,
        campaignName: taskName,
        adsetName: taskName,
        adName: taskName,
        postUrl: state.postUrl,
        destinationUrl: state.destinationUrl,
        existingPostId: resolved?.existingPostId,
        trackingRef: resolved?.trackingRef,
        dailyBudget: Number(state.dailyBudget),
        targetValue: Number(state.targetValue || 0) || undefined,
        targetMetricKey,
        autoStopByTarget: Number(state.targetValue || 0) > 0,
        startTime: localInputToIso(state.startTime),
        endTime: localInputToIso(state.endTime),
        countries: parseCsv(state.countriesCsv),
        ageMin: Number(state.ageMin || 18),
        ageMax: Number(state.ageMax || 49),
        genders: toGenders(state.gender),
        interestObjects,
        customAudienceIds,
        excludedAudienceIds,
        detailedTargetingText: state.detailedTargetingText,
        audienceRequestNote: state.audienceNote,
        manualPlacements: { facebook: state.fbPositions, instagram: state.igPositions },
      };
      const response = await fetch(apiUrl("/api/meta/orders"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const order = data.order as MetaOrder;
      replaceMetaOrders([order, ...listMetaOrders().filter((row) => row.id !== order.id)]);
      setStep("done");
      setMessage("Meta 投放已建立，預設為暫停狀態，可到投放成效查看與啟用。");
    } catch (error) {
      setMessage(`送出失敗：${error instanceof Error ? error.message : "未知錯誤"}`);
    } finally {
      setSubmitting(false);
    }
  };

  const summaryRows = [
    ["申請人", state.applicant],
    ["任務名稱", state.title],
    ["產業", selectedIndustry?.label || "-"],
    ["投遞模式", state.deliveryMode === "optimized" ? "B. AI 優化投遞：建立 A/B 模板實驗" : "A. 直接投遞：按照常用設定"],
    ["行銷活動目標", labelFor(META_CAMPAIGN_OBJECTIVE_OPTIONS, state.campaignObjective)],
    ["KPI 類型", performanceGoal.label],
    ["日預算", `NT$ ${Number(state.dailyBudget || 0).toLocaleString("zh-TW")}`],
    ["達標停投", state.targetValue ? `${Number(state.targetValue).toLocaleString("zh-TW")} ${targetLabel}` : "未設定"],
    ["已解析貼文", resolved?.preview?.id || resolved?.existingPostId || "-"],
    ["受眾設定", `${interestObjects.length} 個興趣條件、${customAudienceIds.length} 個儲備受眾、排除 ${excludedAudienceIds.length} 個受眾`],
    ["補充 TA", state.audienceNote.trim() || "無"],
  ];

  return (
    <div className="container container--wide meta-page">
      <div className="topbar topbar--meta">
        <div className="brand brand--page">
          <div className="brand-title">Meta 官方投廣</div>
          <div className="brand-sub">依照行銷活動設定建立投放，送出後可在成效頁持續查看進度與是否達標。</div>
        </div>
        <div className="pill pill--nav">
          <span className="tag">{user?.displayName ?? user?.username}</span>
          <button className="btn" onClick={() => nav("/ad-orders")}>廠商互動下單</button>
          <button className="btn" onClick={() => nav("/ad-performance")}>投放成效</button>
          <button className="btn primary" onClick={() => nav("/meta-ads-orders")}>Meta 官方投廣</button>
          {canManage ? <button className="btn" onClick={() => nav("/settings")}>控制設定</button> : null}
          <button className="btn danger" onClick={() => { signOut(); nav("/login", { replace: true }); }}>登出</button>
        </div>
      </div>

      {message ? <div className="toast-like">{message}</div> : null}

      {step === "done" ? (
        <div className="meta-success">
          <div>
            <div className="meta-hero-title">建立完成</div>
            <p>投放已進入系統。安全起見，第一版建立後會先保持暫停，請到投放成效確認後再啟用。</p>
          </div>
          <div className="actions inline">
            <button className="btn primary" onClick={() => nav("/ad-performance")}>查看投放成效</button>
            <button className="btn" onClick={() => { setState(buildInitialState(user?.displayName ?? user?.username ?? "")); setResolved(null); setStep("campaign"); }}>建立下一筆</button>
          </div>
        </div>
      ) : (
        <div className="meta-layout">
          <aside className="meta-aside">
            <StepNav step={step} setStep={setStep} canReview={!!resolved?.existingPostId} />
            <div className="meta-help-card">
              <strong>目前廣告帳號</strong>
              <span>{effectiveAccountId ? `act_${effectiveAccountId}` : "尚未設定"}</span>
              <small>廣告帳號、粉專與 Instagram 帳號由控制設定指定，投放時會自動套用。</small>
            </div>
          </aside>

          <main className="meta-main">
            {step === "campaign" ? (
              <section className="meta-panel">
                <div className="meta-panel-head">
                  <div>
                    <h2>投放目標</h2>
                    <p>先選產業與 Meta 官方目標，系統會帶入建議 KPI、預算與受眾模板。</p>
                  </div>
                  <span className="meta-badge">{state.deliveryMode === "optimized" ? "AI 優化投遞" : "直接投遞"}</span>
                </div>
                <div className="meta-form-grid">
                  <label className="field"><div className="label">申請人</div><input value={state.applicant} onChange={(e) => setField("applicant", e.target.value)} /></label>
                  <label className="field"><div className="label">任務名稱</div><input value={state.title} onChange={(e) => setField("title", e.target.value)} placeholder="例如：2026_新鞋上市互動投放" /></label>
                  <label className="field">
                    <div className="label">案件產業</div>
                    <select value={state.industryKey} onChange={(e) => {
                      const industry = availableIndustries.find((item) => item.key === e.target.value);
                      if (industry) setState((current) => applyIndustry(current, industry));
                    }}>
                      {availableIndustries.map((industry) => <option key={industry.key} value={industry.key}>{industry.label}</option>)}
                    </select>
                    <div className="hint">{selectedIndustry?.audienceNote || selectedIndustry?.description}</div>
                  </label>
                  <label className="field">
                    <div className="label">投遞方式</div>
                    <select value={state.deliveryMode} onChange={(e) => setField("deliveryMode", e.target.value as DeliveryMode)}>
                      <option value="direct">A. 直接投遞：按照過往常用設定建立單一投放</option>
                      <option value="optimized">B. AI 優化投遞：建立 A/B 模板實驗，系統會嘗試暫停低效組</option>
                    </select>
                  </label>
                  <label className="field">
                    <div className="label">行銷活動目標</div>
                    <select value={state.campaignObjective} onChange={(e) => setObjective(e.target.value as MetaCampaignObjective)}>
                      {META_CAMPAIGN_OBJECTIVE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <div className="hint">{META_CAMPAIGN_OBJECTIVE_OPTIONS.find((item) => item.value === state.campaignObjective)?.desc}</div>
                  </label>
                  <label className="field">
                    <div className="label">KPI 類型</div>
                    <select value={state.performanceGoalCode} onChange={(e) => setField("performanceGoalCode", e.target.value)}>
                      {objectiveGoals.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
                    </select>
                    <div className="hint">{performanceGoal.desc}</div>
                  </label>
                  <label className="field"><div className="label">日預算 TWD</div><input inputMode="numeric" value={state.dailyBudget} onChange={(e) => setField("dailyBudget", e.target.value)} /></label>
                  <label className="field"><div className="label">開始時間</div><input type="datetime-local" value={state.startTime} onChange={(e) => setField("startTime", e.target.value)} /></label>
                  <label className="field"><div className="label">結束時間</div><input type="datetime-local" value={state.endTime} onChange={(e) => setField("endTime", e.target.value)} /></label>
                  <label className="field">
                    <div className="label">達標停投數值</div>
                    <input inputMode="numeric" value={state.targetValue} onChange={(e) => setField("targetValue", e.target.value)} placeholder="只輸入數字，例如：300000" />
                    <div className="hint">請只輸入數字，不要加「曝光」「點擊」等文字。留空代表只依預算投放；填入後會追蹤 {targetLabel}，達標即停投。</div>
                  </label>
                </div>
                <div className="meta-footer-actions"><button className="btn primary" onClick={() => setStep("creative")}>下一步：貼文驗證</button></div>
              </section>
            ) : null}

            {step === "creative" ? (
              <section className="meta-panel">
                <div className="meta-panel-head">
                  <div>
                    <h2>貼文素材</h2>
                    <p>貼上 Facebook 或 Instagram 貼文連結。驗證成功後才可進入下一步。</p>
                  </div>
                </div>
                <div className="meta-url-box">
                  <label className="field">
                    <div className="label">貼文連結</div>
                    <input value={state.postUrl} onChange={(e) => setField("postUrl", e.target.value)} placeholder="貼上 Facebook 或 Instagram 貼文 / Reels 連結" />
                  </label>
                  <button className="btn primary" type="button" onClick={() => void resolvePost()} disabled={resolving}>{resolving ? "驗證中..." : "驗證貼文"}</button>
                </div>
                {resolved?.preview || resolved?.existingPostId ? (
                  <div className="meta-preview-card">
                    <div className="dense-title">已取得貼文資訊</div>
                    <div className="meta-preview-grid">
                      <div><span className="dense-meta">貼文 ID</span><strong>{resolved.preview?.id || resolved.existingPostId}</strong></div>
                      <div><span className="dense-meta">發布時間</span><strong>{resolved.preview?.createdTime ? new Date(resolved.preview.createdTime).toLocaleString("zh-TW") : "尚未回傳"}</strong></div>
                      {resolved.preview?.permalink ? <div><span className="dense-meta">連結</span><a href={resolved.preview.permalink} target="_blank" rel="noreferrer">開啟貼文</a></div> : null}
                    </div>
                    <p>{resolved.preview?.message || "已解析貼文 ID；這篇貼文沒有回傳文案，或目前權限只能取得基本資訊。"}</p>
                  </div>
                ) : (
                  <div className="meta-empty-state">貼上連結後按「驗證貼文」，系統會確認是否能解析出投放所需的貼文 ID。</div>
                )}
                <div className="meta-footer-actions">
                  <button className="btn" onClick={() => setStep("campaign")}>返回</button>
                  <button className="btn primary" onClick={() => setStep("audience")} disabled={!resolved?.existingPostId}>下一步：受眾與版位</button>
                </div>
              </section>
            ) : null}

            {step === "audience" ? (
              <section className="meta-panel">
                <div className="meta-panel-head">
                  <div>
                    <h2>TA 範圍與版位</h2>
                    <p>系統會先依產業帶入建議受眾。若你有更明確的 TA 方向，可用文字補充，系統會嘗試轉成可投遞的興趣條件。</p>
                  </div>
                  <span className="meta-badge">使用產業模板</span>
                </div>

                <div className="meta-info-strip">
                  <strong>如何補充想投遞的 TA？</strong>
                  <span>描述你想加強或排除的方向，例如「球鞋收藏者」「街頭文化」「高消費精品受眾」。按下補充後，系統會搜尋可投遞的 Meta 興趣條件並加入目前設定。</span>
                </div>

                <div className="meta-form-grid">
                  <label className="field"><div className="label">地區代碼</div><input value={state.countriesCsv} onChange={(e) => setField("countriesCsv", e.target.value)} /><div className="hint">預設 TW；多國可用逗號分隔。</div></label>
                  <label className="field"><div className="label">性別</div><select value={state.gender} onChange={(e) => setField("gender", e.target.value as FormState["gender"])}><option value="all">不限</option><option value="male">男性</option><option value="female">女性</option></select></label>
                  <label className="field"><div className="label">最低年齡</div><input inputMode="numeric" value={state.ageMin} onChange={(e) => setField("ageMin", e.target.value)} /></label>
                  <label className="field"><div className="label">最高年齡</div><input inputMode="numeric" value={state.ageMax} onChange={(e) => setField("ageMax", e.target.value)} /></label>
                </div>

                <div className="meta-targeting-builder">
                  <div className="meta-targeting-editor">
                    <div className="dense-title">目前套用的產業模板</div>
                    <p className="dense-meta">{selectedIndustry?.label}：{selectedIndustry?.audienceNote || selectedIndustry?.description}</p>
                    <div className="meta-template-tags">
                      {templateNotes.map((note) => <span className="meta-template-tag" key={note}>{note}</span>)}
                      {interestObjects.map((item) => <span className="meta-template-tag is-id" key={item.id}>{item.name || item.id}</span>)}
                      {interestObjects.length === 0 && templateNotes.length === 0 ? <span className="meta-template-tag">尚未加入興趣條件</span> : null}
                    </div>
                    <div className="meta-mini-stats">
                      <span>可投遞興趣條件：{interestObjects.length}</span>
                      <span>儲備受眾：{customAudienceIds.length ? `${customAudienceIds.length} 個` : "未設定"}</span>
                      <span>排除受眾：{excludedAudienceIds.length ? `${excludedAudienceIds.length} 個` : "未設定"}</span>
                    </div>
                    {audienceQueries.length ? <div className="hint">最近搜尋方向：{audienceQueries.join("、")}</div> : null}
                  </div>
                  <div className="meta-targeting-guide">
                    <label className="field">
                      <div className="label">補充 TA 方向</div>
                      <textarea
                        rows={8}
                        value={state.audienceNote}
                        onChange={(e) => setField("audienceNote", e.target.value)}
                        placeholder="例如：希望加強球鞋收藏、街頭文化、30 歲以上高消費族群；排除學生族群。"
                      />
                    </label>
                    <button className="btn primary" type="button" onClick={() => void resolveAudience()} disabled={resolvingAudience}>{resolvingAudience ? "補充中..." : "補充可投遞 TA"}</button>
                  </div>
                </div>

                <div className="placement-grid">
                  <div className="placement-col">
                    <div className="placement-title">Facebook 版位</div>
                    {FB_POSITION_OPTIONS.map((p) => <label className="check-row" key={p.value}><input type="checkbox" checked={state.fbPositions.includes(p.value)} onChange={() => setField("fbPositions", toggle(state.fbPositions, p.value))} /><span>{p.label}</span></label>)}
                  </div>
                  <div className="placement-col">
                    <div className="placement-title">Instagram 版位</div>
                    {IG_POSITION_OPTIONS.map((p) => <label className="check-row" key={p.value}><input type="checkbox" checked={state.igPositions.includes(p.value)} onChange={() => setField("igPositions", toggle(state.igPositions, p.value))} /><span>{p.label}</span></label>)}
                  </div>
                </div>
                <div className="meta-footer-actions">
                  <button className="btn" onClick={() => setStep("creative")}>返回</button>
                  <button className="btn primary" onClick={goReview}>下一步：確認送出</button>
                </div>
              </section>
            ) : null}

            {step === "review" ? (
              <section className="meta-panel">
                <div className="meta-panel-head">
                  <div>
                    <h2>確認送出</h2>
                    <p>確認後會建立 Campaign、Ad Set、Creative、Ad，預設狀態為暫停。</p>
                  </div>
                </div>
                <div className="meta-summary">
                  {summaryRows.map(([label, value]) => (
                    <div className="meta-summary-row" key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <div className="meta-info-strip">
                  <strong>送出後會發生什麼？</strong>
                  <span>{state.deliveryMode === "optimized" ? "系統會建立模板受眾與較廣泛受眾的 A/B 變體；同步時比較目標成效 / 花費，低效組達門檻後自動暫停。" : "系統會依目前設定建立單一投放，後續追蹤成效與達標停投。"}</span>
                </div>
                <div className="meta-footer-actions">
                  <button className="btn" onClick={() => setStep("audience")}>返回修改</button>
                  <button className="btn primary" onClick={() => void submit()} disabled={submitting}>{submitting ? "送出中..." : "確認建立"}</button>
                </div>
              </section>
            ) : null}
          </main>
        </div>
      )}
    </div>
  );
}
