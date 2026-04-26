import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { fetchMetaConfigFromServer, getMetaConfig, type MetaConfigV1 } from "../config/metaConfig";
import { getDefaultMetaIndustry, getManagedMetaAccount, getMetaPresetConfig, type MetaIndustryPreset } from "../config/metaPresetConfig";
import {
  META_CAMPAIGN_OBJECTIVE_OPTIONS,
  META_PERFORMANCE_GOALS,
  getPerformanceGoal,
  listPerformanceGoalsByObjective,
  type MetaAdGoalKey,
  type MetaCampaignObjective,
} from "../lib/metaGoals";
import { getPerformanceGoalTargetLabel, getTrackedMetricKeyForPerformanceGoal } from "../lib/metaOrderCapabilities";
import { apiUrl } from "../lib/apiBase";
import { listMetaOrders, replaceMetaOrders, type MetaOrder } from "../lib/metaOrdersStore";

type DeliveryMode = "direct" | "optimized";

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

function parseInterestObjects(value: string) {
  return value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, name] = line.split("|").map((item) => item.trim());
      return /^\d+$/.test(id) ? { id, name: name || undefined } : null;
    })
    .filter((item): item is { id: string; name: string | undefined } => !!item);
}

function toGenders(value: FormState["gender"]) {
  if (value === "male") return [1];
  if (value === "female") return [2];
  return [];
}

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function applyIndustry(base: FormState, industry: MetaIndustryPreset): FormState {
  const objective = base.campaignObjective;
  const goal = listPerformanceGoalsByObjective(objective).find((item) => industry.recommendedGoals.includes(item.defaultGoal)) ??
    META_PERFORMANCE_GOALS.find((item) => industry.recommendedGoals.includes(item.defaultGoal)) ??
    META_PERFORMANCE_GOALS[0];
  return {
    ...base,
    industryKey: industry.key,
    performanceGoalCode: goal.code,
    countriesCsv: industry.countriesCsv || "TW",
    ageMin: String(industry.ageMin || 18),
    ageMax: String(industry.ageMax || 49),
    gender: industry.gender,
    detailedTargetingText: industry.detailedTargetingText,
    dailyBudget: String(industry.dailyBudget || 1000),
    fbPositions: industry.fbPositions,
    igPositions: industry.igPositions,
  };
}

function buildInitialState(applicant: string): FormState {
  const presets = getMetaPresetConfig();
  const industry = getDefaultMetaIndustry(presets);
  const seed: FormState = {
    applicant,
    title: "新投放任務",
    industryKey: industry?.key || "",
    deliveryMode: "optimized",
    campaignObjective: "OUTCOME_ENGAGEMENT",
    performanceGoalCode: "ENGAGEMENT_POST_ENGAGEMENT",
    campaignName: "新行銷活動",
    adsetName: "新廣告組合",
    adName: "新廣告",
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
    fbPositions: ["feed", "profile_feed", "story", "facebook_reels", "video_feeds", "search"],
    igPositions: ["stream", "story", "reels", "explore", "profile_feed"],
  };
  return industry ? applyIndustry(seed, industry) : seed;
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
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<"edit" | "confirm" | "done">("edit");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetchMetaConfigFromServer().then(setCfg).catch(() => undefined);
  }, []);

  const selectedIndustry = presets.industries.find((industry) => industry.key === state.industryKey) ?? presets.industries[0];
  const objectiveGoals = listPerformanceGoalsByObjective(state.campaignObjective);
  const performanceGoal = getPerformanceGoal(state.performanceGoalCode);
  const targetMetricKey = getTrackedMetricKeyForPerformanceGoal(state.performanceGoalCode, performanceGoal.defaultGoal);
  const targetLabel = getPerformanceGoalTargetLabel(state.performanceGoalCode, performanceGoal.defaultGoal);
  const account = getManagedMetaAccount(presets, cfg.adAccountId);
  const effectiveAccountId = account?.adAccountId || cfg.adAccountId;
  const effectivePageId = account?.pageId || cfg.pageId;
  const effectiveIgActor = account?.instagramActorId || cfg.instagramActorId;

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setState((current) => ({ ...current, [key]: value }));
    if (key === "postUrl") setResolved(null);
  };

  const setObjective = (objective: MetaCampaignObjective) => {
    const nextGoal = listPerformanceGoalsByObjective(objective)[0] ?? META_PERFORMANCE_GOALS[0];
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
    setResolving(true);
    setMessage(null);
    try {
      const response = await fetch(apiUrl("/api/meta/resolve-post"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: state.postUrl, pageId: effectivePageId, pageName: cfg.pageName }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.detail || data.error || `HTTP ${response.status}`);
      setResolved(data);
      setMessage("貼文驗證成功。");
    } catch (error) {
      setResolved(null);
      setMessage(`貼文驗證失敗：${error instanceof Error ? error.message : "未知錯誤"}`);
    } finally {
      setResolving(false);
    }
  };

  const validate = () => {
    if (!effectiveAccountId) return "請先到控制設定指定預設廣告帳號。";
    if (!effectivePageId) return "請先到控制設定指定 Facebook 粉絲專頁。";
    if (!state.title.trim()) return "請填寫任務名稱。";
    if (!state.campaignName.trim()) return "請填寫行銷活動名稱。";
    if (!state.postUrl.trim()) return "請貼上貼文連結。";
    if (!resolved?.existingPostId) return "請先驗證貼文，成功後才能下一步。";
    if (!Number.isFinite(Number(state.dailyBudget)) || Number(state.dailyBudget) <= 0) return "日預算需為正數。";
    if (state.targetValue.trim() && (!Number.isFinite(Number(state.targetValue)) || Number(state.targetValue) <= 0)) return "目標數值需為正數。";
    if (state.fbPositions.length + state.igPositions.length === 0) return "請至少選擇一個版位。";
    return "";
  };

  const goConfirm = () => {
    const error = validate();
    if (error) {
      setMessage(error);
      return;
    }
    setMessage(null);
    setStep("confirm");
  };

  const submit = async () => {
    const error = validate();
    if (error) {
      setMessage(error);
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const payload = {
        applicant: state.applicant,
        title: state.title,
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
        campaignName: state.campaignName,
        adsetName: state.adsetName,
        adName: state.adName,
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
        interestObjects: parseInterestObjects(state.detailedTargetingText),
        detailedTargetingText: state.detailedTargetingText,
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

  return (
    <div className="container container--wide">
      <div className="topbar topbar--meta">
        <div className="brand">
          <div className="brand-title">Meta官方投廣</div>
          <div className="brand-sub">依產業模板建立投放，系統會追蹤成效並在達標後停投。</div>
        </div>
        <div className="pill">
          <span className="tag">{user?.displayName ?? user?.username}</span>
          <button className="btn" onClick={() => nav("/ad-orders")}>廠商互動下單</button>
          <button className="btn" onClick={() => nav("/ad-performance")}>投放成效</button>
          <button className="btn primary" onClick={() => nav("/meta-ads-orders")}>Meta官方投廣</button>
          {canManage ? <button className="btn" onClick={() => nav("/settings")}>控制設定</button> : null}
          <button className="btn danger" onClick={() => { signOut(); nav("/login", { replace: true }); }}>登出</button>
        </div>
      </div>

      {message ? <div className="card"><div className="card-bd">{message}</div></div> : null}

      {step === "done" ? (
        <div className="card">
          <div className="card-hd"><div><div className="card-title">建立完成</div><div className="card-desc">投放已送至 Meta，預設暫停以避免測試誤投。</div></div></div>
          <div className="card-bd actions inline">
            <button className="btn primary" onClick={() => nav("/ad-performance")}>查看投放成效</button>
            <button className="btn" onClick={() => { setState(buildInitialState(user?.displayName ?? user?.username ?? "")); setResolved(null); setStep("edit"); }}>建立下一筆</button>
          </div>
        </div>
      ) : null}

      {step !== "done" ? (
        <div className="card">
          <div className="card-hd">
            <div>
              <div className="card-title">{step === "edit" ? "行銷活動" : "確認送出"}</div>
              <div className="card-desc">目前使用帳號：{effectiveAccountId ? `act_${effectiveAccountId}` : "尚未設定"}</div>
            </div>
          </div>
          <div className="card-bd">
            {step === "edit" ? (
              <>
                <div className="row cols2">
                  <label className="field"><div className="label">申請人</div><input value={state.applicant} onChange={(e) => setField("applicant", e.target.value)} /></label>
                  <label className="field"><div className="label">任務名稱</div><input value={state.title} onChange={(e) => setField("title", e.target.value)} /></label>
                  <label className="field">
                    <div className="label">產業模板</div>
                    <select value={state.industryKey} onChange={(e) => {
                      const industry = presets.industries.find((item) => item.key === e.target.value);
                      if (industry) setState((current) => applyIndustry(current, industry));
                    }}>
                      {presets.industries.filter((industry) => industry.enabled).map((industry) => <option key={industry.key} value={industry.key}>{industry.label}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <div className="label">投遞方式</div>
                    <select value={state.deliveryMode} onChange={(e) => setField("deliveryMode", e.target.value as DeliveryMode)}>
                      <option value="direct">直投法</option>
                      <option value="optimized">優化投遞法</option>
                    </select>
                  </label>
                  <label className="field">
                    <div className="label">行銷活動目標</div>
                    <select value={state.campaignObjective} onChange={(e) => setObjective(e.target.value as MetaCampaignObjective)}>
                      {META_CAMPAIGN_OBJECTIVE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <div className="label">KPI類型</div>
                    <select value={state.performanceGoalCode} onChange={(e) => setField("performanceGoalCode", e.target.value)}>
                      {objectiveGoals.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="field"><div className="label">行銷活動名稱</div><input value={state.campaignName} onChange={(e) => { setField("campaignName", e.target.value); setField("adsetName", e.target.value); setField("adName", e.target.value); }} /></label>
                  <label className="field"><div className="label">日預算 TWD</div><input inputMode="numeric" value={state.dailyBudget} onChange={(e) => setField("dailyBudget", e.target.value)} /></label>
                  <label className="field"><div className="label">開始時間</div><input type="datetime-local" value={state.startTime} onChange={(e) => setField("startTime", e.target.value)} /></label>
                  <label className="field"><div className="label">結束時間</div><input type="datetime-local" value={state.endTime} onChange={(e) => setField("endTime", e.target.value)} /></label>
                  <label className="field"><div className="label">目標{targetLabel}</div><input inputMode="numeric" value={state.targetValue} onChange={(e) => setField("targetValue", e.target.value)} placeholder="達標後自動停投，可留空" /></label>
                </div>

                <div className="sep" />
                <div className="row cols2">
                  <label className="field">
                    <div className="label">貼文連結</div>
                    <input value={state.postUrl} onChange={(e) => setField("postUrl", e.target.value)} placeholder="貼上 Facebook 或 Instagram 貼文連結" />
                  </label>
                  <div className="field">
                    <div className="label">驗證</div>
                    <button className="btn" type="button" onClick={() => void resolvePost()} disabled={resolving}>{resolving ? "驗證中..." : "驗證貼文"}</button>
                  </div>
                </div>
                {resolved?.preview ? (
                  <div className="meta-preview-card">
                    <div className="dense-title">已取得貼文</div>
                    <div className="dense-meta">ID：{resolved.preview.id || resolved.existingPostId}</div>
                    <div className="dense-meta">時間：{resolved.preview.createdTime ? new Date(resolved.preview.createdTime).toLocaleString("zh-TW") : "-"}</div>
                    <div>{resolved.preview.message || "未取得文案"}</div>
                  </div>
                ) : null}

                <div className="sep" />
                <div className="row cols2">
                  <label className="field"><div className="label">地區</div><input value={state.countriesCsv} onChange={(e) => setField("countriesCsv", e.target.value)} /></label>
                  <label className="field"><div className="label">性別</div><select value={state.gender} onChange={(e) => setField("gender", e.target.value as FormState["gender"])}><option value="all">不限</option><option value="male">男性</option><option value="female">女性</option></select></label>
                  <label className="field"><div className="label">最低年齡</div><input inputMode="numeric" value={state.ageMin} onChange={(e) => setField("ageMin", e.target.value)} /></label>
                  <label className="field"><div className="label">最高年齡</div><input inputMode="numeric" value={state.ageMax} onChange={(e) => setField("ageMax", e.target.value)} /></label>
                  <label className="field" style={{ gridColumn: "1 / -1" }}>
                    <div className="label">興趣受眾</div>
                    <textarea rows={4} value={state.detailedTargetingText} onChange={(e) => setField("detailedTargetingText", e.target.value)} />
                  </label>
                </div>

                <div className="row cols2">
                  <div className="field">
                    <div className="label">Facebook 版位</div>
                    <div className="actions inline">{FB_POSITION_OPTIONS.map((p) => <label className="tag" key={p.value}><input type="checkbox" checked={state.fbPositions.includes(p.value)} onChange={() => setField("fbPositions", toggle(state.fbPositions, p.value))} />{p.label}</label>)}</div>
                  </div>
                  <div className="field">
                    <div className="label">Instagram 版位</div>
                    <div className="actions inline">{IG_POSITION_OPTIONS.map((p) => <label className="tag" key={p.value}><input type="checkbox" checked={state.igPositions.includes(p.value)} onChange={() => setField("igPositions", toggle(state.igPositions, p.value))} />{p.label}</label>)}</div>
                  </div>
                </div>

                <div className="actions inline">
                  <button className="btn primary" type="button" onClick={goConfirm} disabled={!resolved?.existingPostId}>下一步：確認</button>
                </div>
              </>
            ) : (
              <>
                <div className="dense-table">
                  <div className="dense-th">項目</div><div className="dense-th">內容</div>
                  {[
                    ["申請人", state.applicant],
                    ["任務名稱", state.title],
                    ["產業", selectedIndustry?.label || "-"],
                    ["投遞方式", state.deliveryMode === "optimized" ? "優化投遞法：建立 2 組 A/B 變體" : "直投法：建立 1 組投放"],
                    ["行銷活動目標", META_CAMPAIGN_OBJECTIVE_OPTIONS.find((item) => item.value === state.campaignObjective)?.label || state.campaignObjective],
                    ["KPI類型", performanceGoal.label],
                    ["日預算", `NT$ ${Number(state.dailyBudget || 0).toLocaleString("zh-TW")}`],
                    ["達標停投", state.targetValue ? `${Number(state.targetValue).toLocaleString("zh-TW")} ${targetLabel}` : "未設定"],
                    ["貼文 ID", resolved?.preview?.id || resolved?.existingPostId || "-"],
                  ].map(([label, value]) => (
                    <div className="dense-tr" key={label}><div className="dense-td">{label}</div><div className="dense-td dense-main">{value}</div></div>
                  ))}
                </div>
                <div className="actions inline">
                  <button className="btn" type="button" onClick={() => setStep("edit")}>返回修改</button>
                  <button className="btn primary" type="button" onClick={() => void submit()} disabled={submitting}>{submitting ? "送出中..." : "確認建立"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
