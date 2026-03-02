import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getMetaConfig } from "../config/metaConfig";
import { buildMetaPayloads } from "../lib/metaPayload";
import { META_AD_GOALS, listMetaGoals, type MetaAdGoalKey } from "../lib/metaGoals";
import { addMetaOrder, type MetaOrderInput } from "../lib/metaOrdersStore";
import { submitMetaOrderToGraph } from "../lib/metaGraphApi";
import { isValidUrl } from "../lib/validate";

type FormState = {
  title: string;
  goal: MetaAdGoalKey;
  landingUrl: string;
  message: string;
  ctaType: string;
  useExistingPost: boolean;
  existingPostId: string;
  dailyBudget: string;
  startTime: string;
  endTime: string;
  countriesCsv: string;
  ageMin: string;
  ageMax: string;
  gender: "all" | "male" | "female";
};

type Errors = Partial<Record<keyof FormState, string>>;

function toInputDateTimeLocal(d = new Date()): string {
  const dt = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return dt.toISOString().slice(0, 16);
}

function toIsoFromLocalInput(s: string): string {
  if (!s.trim()) return "";
  return new Date(s).toISOString();
}

function defaultState(): FormState {
  const start = new Date(Date.now() + 15 * 60 * 1000);
  return {
    title: "",
    goal: "fb_post_engagement",
    landingUrl: "",
    message: "",
    ctaType: "LEARN_MORE",
    useExistingPost: false,
    existingPostId: "",
    dailyBudget: "500",
    startTime: toInputDateTimeLocal(start),
    endTime: "",
    countriesCsv: "TW",
    ageMin: "18",
    ageMax: "45",
    gender: "all",
  };
}

function toGenders(g: FormState["gender"]): number[] {
  if (g === "male") return [1];
  if (g === "female") return [2];
  return [];
}

function validate(s: FormState): Errors {
  const e: Errors = {};
  if (!s.title.trim()) e.title = "請填寫任務名稱";
  if (!s.useExistingPost) {
    if (!s.landingUrl.trim()) e.landingUrl = "請填寫導流網址";
    else if (!isValidUrl(s.landingUrl.trim())) e.landingUrl = "導流網址需為完整 URL（https://...）";
  } else if (!s.existingPostId.trim()) {
    e.existingPostId = "使用既有貼文時，請填寫貼文 ID";
  }

  const b = Number(s.dailyBudget);
  if (!Number.isFinite(b) || b <= 0) e.dailyBudget = "日預算需為正數；最低金額以 Meta API 規範為準";

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
  return e;
}

export function MetaAdsOrdersPage() {
  const nav = useNavigate();
  const { user, signOut } = useAuth();
  const [step, setStep] = useState<"edit" | "confirm" | "submitted">("edit");
  const [state, setState] = useState<FormState>(() => defaultState());
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [logs, setLogs] = useState<Array<{ step: string; ok: boolean; detail: string }>>([]);

  const cfg = getMetaConfig();
  const applicant = user?.displayName ?? user?.username ?? "";
  const goal = META_AD_GOALS[state.goal];

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
      title: state.title.trim(),
      goal: state.goal,
      landingUrl: state.landingUrl.trim(),
      message: state.message.trim(),
      ctaType: state.ctaType.trim() || "LEARN_MORE",
      useExistingPost: state.useExistingPost,
      existingPostId: state.existingPostId.trim() || undefined,
      dailyBudget: Number(state.dailyBudget) || 0,
      startTime: toIsoFromLocalInput(state.startTime),
      endTime: state.endTime.trim() ? toIsoFromLocalInput(state.endTime) : undefined,
      countries,
      ageMin: Number(state.ageMin) || 18,
      ageMax: Number(state.ageMax) || 45,
      genders: toGenders(state.gender),
      mode: cfg.mode,
    }),
    [applicant, cfg.mode, countries, state],
  );

  const payloads = useMemo(() => buildMetaPayloads(cfg, previewInput), [cfg, previewInput]);

  const goConfirm = () => {
    const e = validate(state);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setStep("confirm");
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const res = await submitMetaOrderToGraph({ cfg, input: previewInput, payloads });
      const status = res.status === "submitted" ? (cfg.mode === "simulate" ? "submitted" : "running") : "failed";
      addMetaOrder({
        ...previewInput,
        status,
        apiStatusText: res.status === "submitted" ? "已建立投放" : "建立失敗",
        error: res.error,
        payloads,
        submitResult: res.result,
      });
      setLogs(res.result?.requestLogs ?? []);
      if (res.status === "submitted") {
        setSubmitMsg(cfg.mode === "simulate" ? "模擬模式：已完成一筆 Meta 投放流程。" : "正式模式：已送出 Meta API 建立流程。");
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
            {step === "edit" ? "Meta 官方投放下單" : step === "confirm" ? "Meta 投放確認送出" : "Meta 投放結果"}
          </div>
          <div className="brand-sub">支援 Facebook / Instagram 常用投放目標，先用模擬模式驗證流程再切正式模式。</div>
        </div>
        <div className="pill">
          <span className="tag">{applicant}</span>
          <button className="btn" onClick={() => nav("/ad-orders")}>
            SMM 下單
          </button>
          <button className="btn" onClick={() => nav("/meta-ads-performance")}>
            Meta 成效
          </button>
          <button className="btn" onClick={() => nav("/settings")}>
            控制設定
          </button>
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
          <div className="card">
            <div className="card-hd">
              <div>
                <div className="card-title">投放基本設定</div>
                <div className="card-desc">這裡建立 Meta Campaign / AdSet / Creative / Ad 的完整流程參數。</div>
              </div>
              <span className="tag">{cfg.mode === "simulate" ? "模擬模式" : "正式模式"}</span>
            </div>
            <div className="card-bd">
              <div className="row cols2">
                <div className="field">
                  <div className="label">申請人</div>
                  <input value={applicant} readOnly />
                </div>
                <div className="field">
                  <div className="label">任務名稱<span className="req">*</span></div>
                  <input value={state.title} onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))} placeholder="例如：春季活動_FB互動放大" />
                  {errors.title && <div className="error">{errors.title}</div>}
                </div>

                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <div className="label">投放目標<span className="req">*</span></div>
                  <select value={state.goal} onChange={(e) => setState((s) => ({ ...s, goal: e.target.value as MetaAdGoalKey }))}>
                    {listMetaGoals().map((g) => (
                      <option key={g.key} value={g.key}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                  <div className="hint">
                    平台：{goal.platform === "facebook" ? "Facebook" : "Instagram"} / 目標：{goal.desc}
                  </div>
                  <div className="hint">KPI 定義：{goal.kpiDefinition}</div>
                  {goal.notes && <div className="hint">{goal.notes}</div>}
                </div>

                <div className="field">
                  <div className="label">素材來源</div>
                  <select value={state.useExistingPost ? "existing" : "link"} onChange={(e) => setState((s) => ({ ...s, useExistingPost: e.target.value === "existing" }))}>
                    <option value="link">建立連結廣告（Link Ad）</option>
                    <option value="existing">使用既有貼文（需貼文 ID）</option>
                  </select>
                  <div className="hint">素材欄位與可用格式以 Meta API 最終驗證結果為準。</div>
                </div>
                <div className="field">
                  <div className="label">既有貼文 ID</div>
                  <input
                    value={state.existingPostId}
                    onChange={(e) => setState((s) => ({ ...s, existingPostId: e.target.value }))}
                    placeholder="例如 1234567890123456 或 pageId_postId"
                  />
                  {errors.existingPostId && <div className="error">{errors.existingPostId}</div>}
                </div>

                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <div className="label">導流網址{state.useExistingPost ? "" : <span className="req">*</span>}</div>
                  <input
                    value={state.landingUrl}
                    onChange={(e) => setState((s) => ({ ...s, landingUrl: e.target.value }))}
                    placeholder="https://..."
                  />
                  {errors.landingUrl && <div className="error">{errors.landingUrl}</div>}
                </div>

                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <div className="label">文案（Message）</div>
                  <textarea rows={4} value={state.message} onChange={(e) => setState((s) => ({ ...s, message: e.target.value }))} placeholder="輸入要顯示的廣告文案..." />
                </div>

                <div className="field">
                  <div className="label">CTA 按鈕</div>
                  <select value={state.ctaType} onChange={(e) => setState((s) => ({ ...s, ctaType: e.target.value }))}>
                    <option value="LEARN_MORE">了解更多</option>
                    <option value="SHOP_NOW">立即購買</option>
                    <option value="SIGN_UP">立即註冊</option>
                    <option value="CONTACT_US">聯絡我們</option>
                    <option value="VIEW_MORE">查看更多</option>
                  </select>
                </div>
                <div className="field">
                  <div className="label">日預算（{cfg.currency}）<span className="req">*</span></div>
                  <input value={state.dailyBudget} inputMode="numeric" onChange={(e) => setState((s) => ({ ...s, dailyBudget: e.target.value }))} />
                  <div className="hint">最低金額由 Meta API 檢核；此頁只先檢查是否為正數。</div>
                  {errors.dailyBudget && <div className="error">{errors.dailyBudget}</div>}
                </div>

                <div className="field">
                  <div className="label">開始時間<span className="req">*</span></div>
                  <input type="datetime-local" value={state.startTime} onChange={(e) => setState((s) => ({ ...s, startTime: e.target.value }))} />
                  {errors.startTime && <div className="error">{errors.startTime}</div>}
                </div>
                <div className="field">
                  <div className="label">結束時間（可留空）</div>
                  <input type="datetime-local" value={state.endTime} onChange={(e) => setState((s) => ({ ...s, endTime: e.target.value }))} />
                  {errors.endTime && <div className="error">{errors.endTime}</div>}
                </div>

                <div className="field">
                  <div className="label">國家（逗號分隔）</div>
                  <input value={state.countriesCsv} onChange={(e) => setState((s) => ({ ...s, countriesCsv: e.target.value }))} placeholder="TW,HK,SG" />
                </div>
                <div className="field">
                  <div className="label">性別</div>
                  <select value={state.gender} onChange={(e) => setState((s) => ({ ...s, gender: e.target.value as FormState["gender"] }))}>
                    <option value="all">不限</option>
                    <option value="male">男性</option>
                    <option value="female">女性</option>
                  </select>
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
              </div>

              <div className="sep" />
              <div className="actions inline">
                <button className="btn" onClick={() => nav("/settings")}>
                  前往檢查 Meta 設定
                </button>
                <button className="btn primary" type="button" onClick={goConfirm}>
                  下一步：確認
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
                <div className="card-title">Meta 投放確認</div>
                <div className="card-desc">會建立 Campaign / AdSet / Creative / Ad。若為模擬模式，不會真的送 API。</div>
              </div>
            </div>
            <div className="card-bd">
              <div className="row cols2">
                <div className="field">
                  <div className="label">任務名稱</div>
                  <input value={previewInput.title} readOnly />
                </div>
                <div className="field">
                  <div className="label">投放目標</div>
                  <input value={goal.label} readOnly />
                </div>
                <div className="field">
                  <div className="label">模式</div>
                  <input value={cfg.mode === "simulate" ? "模擬模式" : "正式模式"} readOnly />
                </div>
                <div className="field">
                  <div className="label">廣告帳號</div>
                  <input value={cfg.adAccountId || "(未填)"} readOnly />
                </div>
              </div>

              <div className="sep" />
              <div className="hint">即將送出的 Campaign Payload：</div>
              <textarea rows={5} readOnly value={JSON.stringify(payloads.campaign, null, 2)} />
              <div className="hint" style={{ marginTop: 8 }}>即將送出的 AdSet Payload：</div>
              <textarea rows={6} readOnly value={JSON.stringify(payloads.adset, null, 2)} />
              <div className="hint" style={{ marginTop: 8 }}>即將送出的 Creative Payload：</div>
              <textarea rows={6} readOnly value={JSON.stringify(payloads.creative, null, 2)} />
              <div className="hint" style={{ marginTop: 8 }}>即將送出的 Ad Payload：</div>
              <textarea rows={5} readOnly value={JSON.stringify(payloads.ad, null, 2)} />

              <div className="sep" />
              <div className="actions inline">
                <button className="btn" type="button" onClick={() => setStep("edit")} disabled={submitting}>
                  返回修改
                </button>
                <button className="btn primary" type="button" onClick={submit} disabled={submitting}>
                  {submitting ? "送出中..." : "確認送出"}
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
                <div className="card-title">Meta 投放送出結果</div>
                <div className="card-desc">你可以到「Meta 成效」頁面同步狀態。</div>
              </div>
            </div>
            <div className="card-bd">
              {submitMsg && <div className="hint">{submitMsg}</div>}
              <div className="sep" />
              <div className="list">
                {logs.map((x, i) => (
                  <div className="item" key={`${x.step}-${i}`}>
                    <div className="item-hd">
                      <div className="item-title">{x.step}</div>
                      <span className="tag">{x.ok ? "OK" : "FAIL"}</span>
                    </div>
                    <div className="hint">{x.detail}</div>
                  </div>
                ))}
              </div>
              <div className="sep" />
              <div className="actions inline">
                <button className="btn" onClick={() => setStep("edit")}>
                  再建一筆
                </button>
                <button className="btn primary" onClick={() => nav("/meta-ads-performance")}>
                  前往 Meta 成效
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

