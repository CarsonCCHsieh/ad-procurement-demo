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
  campaignName: string;
  adsetName: string;
  adName: string;
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
  detailedTargetingText: string;
  fbPositions: string[];
  igPositions: string[];
};

type Errors = Partial<Record<keyof FormState, string>>;

const FB_POSITION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "feed", label: "Facebook 動態消息" },
  { value: "profile_feed", label: "Facebook 個人檔案動態消息" },
  { value: "story", label: "Facebook 限時動態" },
  { value: "facebook_reels", label: "Facebook Reels" },
  { value: "video_feeds", label: "Facebook Reels 廣告 / 影片動態消息" },
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
    campaignName: "",
    adsetName: "",
    adName: "",
    goal: "fb_post_engagement",
    landingUrl: "",
    message: "",
    ctaType: "LEARN_MORE",
    useExistingPost: true,
    existingPostId: "",
    dailyBudget: "1000",
    startTime: toInputDateTimeLocal(start),
    endTime: "",
    countriesCsv: "TW",
    ageMin: "18",
    ageMax: "49",
    gender: "all",
    detailedTargetingText: "",
    fbPositions: ["feed", "profile_feed", "story", "facebook_reels", "video_feeds", "search"],
    igPositions: ["stream", "story", "reels", "explore"],
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

function validate(s: FormState): Errors {
  const e: Errors = {};
  if (!s.title.trim()) e.title = "請填寫任務名稱";
  if (!s.campaignName.trim()) e.campaignName = "請填寫行銷活動名稱";
  if (!s.adsetName.trim()) e.adsetName = "請填寫廣告組合名稱";
  if (!s.adName.trim()) e.adName = "請填寫廣告名稱";

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

  if (s.fbPositions.length + s.igPositions.length === 0) {
    e.fbPositions = "手動版位至少要勾選 1 個 Facebook 或 Instagram 版位";
  }
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
      campaignName: state.campaignName.trim(),
      adsetName: state.adsetName.trim(),
      adName: state.adName.trim(),
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
      ageMax: Number(state.ageMax) || 49,
      genders: toGenders(state.gender),
      manualPlacements: {
        facebook: state.fbPositions,
        instagram: state.igPositions,
      },
      detailedTargetingText: state.detailedTargetingText.trim() || undefined,
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
          <div className="brand-sub">固定使用 Facebook / Instagram 手動版位（不使用 Audience Network / Messenger / Threads）。</div>
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
                <div className="card-title">行銷活動（Campaign）</div>
                <div className="card-desc">購買類型固定為競價（AUCTION）；目標依你選的投放目標自動映射。</div>
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
                  <input value={state.title} onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))} placeholder="例如：2025_DY_PALLADIUM_互動_David" />
                  {errors.title && <div className="error">{errors.title}</div>}
                </div>

                <div className="field">
                  <div className="label">行銷活動名稱<span className="req">*</span></div>
                  <input
                    value={state.campaignName}
                    onChange={(e) => setState((s) => ({ ...s, campaignName: e.target.value }))}
                    placeholder="例如：2025_DY_PALLADIUM_0411-0414_互動_David"
                  />
                  {errors.campaignName && <div className="error">{errors.campaignName}</div>}
                </div>
                <div className="field">
                  <div className="label">投放目標<span className="req">*</span></div>
                  <select value={state.goal} onChange={(e) => setState((s) => ({ ...s, goal: e.target.value as MetaAdGoalKey }))}>
                    {listMetaGoals().map((g) => (
                      <option key={g.key} value={g.key}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                  <div className="hint">KPI 定義：{goal.kpiDefinition}</div>
                </div>

                <div className="field">
                  <div className="label">預算類型</div>
                  <input value="單日預算（Campaign Daily Budget）" readOnly />
                </div>
                <div className="field">
                  <div className="label">日預算（{cfg.currency}）<span className="req">*</span></div>
                  <input value={state.dailyBudget} inputMode="numeric" onChange={(e) => setState((s) => ({ ...s, dailyBudget: e.target.value }))} />
                  <div className="hint">最低金額由 Meta API 檢核；目前不使用 lifetime budget。</div>
                  {errors.dailyBudget && <div className="error">{errors.dailyBudget}</div>}
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <div>
                <div className="card-title">廣告組合（Ad Set）</div>
                <div className="card-desc">受眾、排程、手動版位都在這層設定。</div>
              </div>
            </div>
            <div className="card-bd">
              <div className="row cols2">
                <div className="field">
                  <div className="label">廣告組合名稱<span className="req">*</span></div>
                  <input value={state.adsetName} onChange={(e) => setState((s) => ({ ...s, adsetName: e.target.value }))} placeholder="例如：2025_DY_PALLADIUM" />
                  {errors.adsetName && <div className="error">{errors.adsetName}</div>}
                </div>
                <div className="field">
                  <div className="label">成效目標（自動）</div>
                  <input value={`${goal.objective} / ${goal.optimizationGoal}`} readOnly />
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
                  <input value={state.countriesCsv} onChange={(e) => setState((s) => ({ ...s, countriesCsv: e.target.value }))} placeholder="TW" />
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
                  <div className="label">最小年齡</div>
                  <input value={state.ageMin} inputMode="numeric" onChange={(e) => setState((s) => ({ ...s, ageMin: e.target.value }))} />
                  {errors.ageMin && <div className="error">{errors.ageMin}</div>}
                </div>
                <div className="field">
                  <div className="label">最大年齡</div>
                  <input value={state.ageMax} inputMode="numeric" onChange={(e) => setState((s) => ({ ...s, ageMax: e.target.value }))} />
                  {errors.ageMax && <div className="error">{errors.ageMax}</div>}
                </div>

                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <div className="label">詳細目標設定（選填）</div>
                  <textarea
                    rows={3}
                    value={state.detailedTargetingText}
                    onChange={(e) => setState((s) => ({ ...s, detailedTargetingText: e.target.value }))}
                    placeholder={"若要直接送到 API，請填 interest_id，每行一筆\n例如：6003139266461|Streetwear"}
                  />
                  <div className="hint">此欄位會嘗試轉為 interests id；純文字關鍵字不一定能被 API 接受。</div>
                </div>
              </div>

              <div className="sep" />

              <div className="field">
                <div className="label">版位（手動）<span className="req">*</span></div>
                <div className="hint">只使用 Facebook 與 Instagram 版位；不送 Messenger / Audience Network / Threads。</div>
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
                <div className="card-title">廣告（Ad）</div>
                <div className="card-desc">身份使用設定頁的粉專 Page ID 與 Instagram Actor ID。</div>
              </div>
            </div>
            <div className="card-bd">
              <div className="row cols2">
                <div className="field">
                  <div className="label">廣告名稱<span className="req">*</span></div>
                  <input value={state.adName} onChange={(e) => setState((s) => ({ ...s, adName: e.target.value }))} placeholder="例如：2025_DY_PALLADIUM_0411-0414_互動_C" />
                  {errors.adName && <div className="error">{errors.adName}</div>}
                </div>
                <div className="field">
                  <div className="label">素材來源</div>
                  <select value={state.useExistingPost ? "existing" : "link"} onChange={(e) => setState((s) => ({ ...s, useExistingPost: e.target.value === "existing" }))}>
                    <option value="existing">使用既有貼文（建議）</option>
                    <option value="link">建立連結廣告（Link Ad）</option>
                  </select>
                </div>

                <div className="field">
                  <div className="label">既有貼文 ID</div>
                  <input
                    value={state.existingPostId}
                    onChange={(e) => setState((s) => ({ ...s, existingPostId: e.target.value }))}
                    placeholder="例如 1092821802873867 或 pageId_postId"
                  />
                  {errors.existingPostId && <div className="error">{errors.existingPostId}</div>}
                </div>
                <div className="field">
                  <div className="label">導流網址{state.useExistingPost ? "" : <span className="req">*</span>}</div>
                  <input value={state.landingUrl} onChange={(e) => setState((s) => ({ ...s, landingUrl: e.target.value }))} placeholder="https://..." />
                  {errors.landingUrl && <div className="error">{errors.landingUrl}</div>}
                </div>

                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <div className="label">主要文案（Message）</div>
                  <textarea rows={4} value={state.message} onChange={(e) => setState((s) => ({ ...s, message: e.target.value }))} placeholder="輸入要顯示的廣告文案..." />
                </div>

                <div className="field">
                  <div className="label">行動呼籲（CTA）</div>
                  <select value={state.ctaType} onChange={(e) => setState((s) => ({ ...s, ctaType: e.target.value }))}>
                    <option value="LEARN_MORE">了解更多</option>
                    <option value="SHOP_NOW">立即購買</option>
                    <option value="SIGN_UP">立即註冊</option>
                    <option value="CONTACT_US">聯絡我們</option>
                    <option value="VIEW_MORE">查看更多</option>
                  </select>
                </div>
                <div className="field">
                  <div className="label">身份來源</div>
                  <input value={`Page ID: ${cfg.pageId || "(未設定)"} / IG Actor: ${cfg.instagramActorId || "(未設定)"}`} readOnly />
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
                  <div className="label">行銷活動 / 廣告組合 / 廣告</div>
                  <input value={`${previewInput.campaignName} / ${previewInput.adsetName} / ${previewInput.adName}`} readOnly />
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
                  <div className="label">手動版位</div>
                  <input
                    value={`FB ${previewInput.manualPlacements.facebook.length} 項 / IG ${previewInput.manualPlacements.instagram.length} 項`}
                    readOnly
                  />
                </div>
              </div>

              <div className="sep" />
              <div className="hint">即將送出的 Campaign Payload：</div>
              <textarea rows={6} readOnly value={JSON.stringify(payloads.campaign, null, 2)} />
              <div className="hint" style={{ marginTop: 8 }}>即將送出的 AdSet Payload：</div>
              <textarea rows={8} readOnly value={JSON.stringify(payloads.adset, null, 2)} />
              <div className="hint" style={{ marginTop: 8 }}>即將送出的 Creative Payload：</div>
              <textarea rows={7} readOnly value={JSON.stringify(payloads.creative, null, 2)} />
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
