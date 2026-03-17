import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PRICING, type AdPlacement } from "../lib/pricing";
import { isValidUrl, parseLinks } from "../lib/validate";
import { getConfig, getPlacementConfig, type VendorKey } from "../config/appConfig";
import { planSplit } from "../lib/split";
import { addOrder, insertOrder, type DemoOrder } from "../lib/ordersStore";
import { calcInternalLineAmount, shouldShowPrices } from "../lib/internalPricing";
import { apiUrl } from "../lib/apiBase";
import { flushAllSharedState, SHARED_SYNC_EVENT } from "../lib/sharedSync";

type OrderKind = "new" | "upsell";

type LineItem = {
  placement: AdPlacement;
  target: string;
};

type FormState = {
  orderNo: string;
  caseName: string;
  kind: OrderKind;
  linksRaw: string;
  items: LineItem[];
};

type FormErrors = Partial<Record<Exclude<keyof FormState, "items">, string>> & {
  items?: Array<{ placement?: string; target?: string }>;
};

const PLACEMENT_LABELS: Record<AdPlacement, string> = {
  fb_like: "Facebook 貼文讚",
  fb_reach: "Facebook 觸及數",
  fb_video_views: "Facebook 影片觀看",
  ig_like: "Instagram 貼文讚",
  ig_reels_views: "Instagram Reels 觀看",
};

function nowString() {
  return new Date().toLocaleString("zh-TW");
}

function defaultState(): FormState {
  return {
    orderNo: "",
    caseName: "",
    kind: "new",
    linksRaw: "",
    items: [{ placement: "fb_like", target: String(PRICING.fb_like.minUnit) }],
  };
}

function validate(state: FormState): FormErrors {
  const errors: FormErrors = {};

  if (!state.orderNo.trim()) errors.orderNo = "請填寫委刊單號";
  if (!state.caseName.trim()) errors.caseName = "請填寫案件名稱";

  const links = parseLinks(state.linksRaw);
  if (links.length === 0) {
    errors.linksRaw = "請至少提供 1 個連結";
  } else if (!links.every(isValidUrl)) {
    errors.linksRaw = "連結格式需為完整 URL，建議一行一個，例如 https://...";
  }

  if (!state.items.length) {
    errors.items = [{ placement: "請至少新增 1 筆投放項目" }];
    return errors;
  }

  errors.items = state.items.map((item) => {
    const fieldErrors: { placement?: string; target?: string } = {};
    if (!item.placement) fieldErrors.placement = "請選擇投放項目";
    const qty = Number(item.target);
    const rule = PRICING[item.placement];
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
      fieldErrors.target = "請輸入正整數";
    } else if (qty % rule.minUnit !== 0) {
      fieldErrors.target = `數量需為 ${rule.minUnit.toLocaleString()} 的倍數`;
    }
    return fieldErrors;
  });

  if (errors.items.every((item) => !item.placement && !item.target)) delete errors.items;
  return errors;
}

export function AdOrdersPage() {
  const nav = useNavigate();
  const { user, signOut } = useAuth();
  const [, setSharedTick] = useState(0);
  const [step, setStep] = useState<"edit" | "confirm" | "submitted">("edit");
  const [state, setState] = useState<FormState>(() => defaultState());
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedSummary, setSubmittedSummary] = useState("");

  const cfg = getConfig();
  const applicant = user?.displayName ?? user?.username ?? "";
  const showPrices = shouldShowPrices();
  const links = parseLinks(state.linksRaw);

  const vendorEnabled = (vendor: VendorKey) => cfg.vendors.some((item) => item.key === vendor && item.enabled);

  const computed = useMemo(() => {
    const linePlans = state.items.map((item) => {
      const qty = Number(item.target);
      if (!Number.isFinite(qty) || qty <= 0) return { splits: [], warnings: [] as string[] };
      const placementConfig = getPlacementConfig(item.placement);
      return planSplit({
        total: qty,
        suppliers: placementConfig.suppliers,
        strategy: placementConfig.splitStrategy ?? "random",
        vendorEnabled,
      });
    });

    const total = state.items.reduce((sum, item) => {
      const qty = Number(item.target);
      if (!Number.isFinite(qty) || qty <= 0) return sum;
      return sum + calcInternalLineAmount(item.placement, qty);
    }, 0);

    return { linePlans, total };
  }, [state.items, cfg.updatedAt]);

  useEffect(() => {
    const onSharedSync = () => setSharedTick((value) => value + 1);
    window.addEventListener(SHARED_SYNC_EVENT, onSharedSync);
    return () => window.removeEventListener(SHARED_SYNC_EVENT, onSharedSync);
  }, []);

  const updateItem = (index: number, updater: (item: LineItem) => LineItem) => {
    setState((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (itemIndex === index ? updater(item) : item)),
    }));
  };

  const addItem = () => {
    setState((current) => ({
      ...current,
      items: [...current.items, { placement: "fb_like", target: String(PRICING.fb_like.minUnit) }],
    }));
  };

  const removeItem = (index: number) => {
    setState((current) => ({
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const goConfirm = () => {
    const nextErrors = validate(state);
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0) return;
    setStep("confirm");
  };

  const buildDraftOrder = () => ({
    applicant,
    orderNo: state.orderNo.trim(),
    caseName: state.caseName.trim(),
    kind: state.kind,
    links,
    lines: state.items.map((item, index) => {
      const qty = Number(item.target);
      const amount = Number.isFinite(qty) && qty > 0 ? calcInternalLineAmount(item.placement, qty) : 0;
      const plan = computed.linePlans[index] ?? { splits: [], warnings: [] as string[] };
      return {
        placement: item.placement,
        quantity: Number.isFinite(qty) ? qty : 0,
        amount,
        splits: plan.splits,
        warnings: plan.warnings,
      };
    }),
    totalAmount: computed.total,
  });

  const submitViaBackend = async (draft: ReturnType<typeof buildDraftOrder>) => {
    await flushAllSharedState();
    const response = await fetch(apiUrl("/api/vendor/submit-order"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const contentType = response.headers.get("content-type") || "";
    const raw = await response.text();

    if (!contentType.includes("application/json")) {
      throw new Error("目前這個網站版本尚未連接送單服務，請改用內部版本或通知管理員。");
    }

    const data = JSON.parse(raw) as {
      ok?: boolean;
      error?: string;
      order?: DemoOrder;
      summary?: { successCount?: number; failureCount?: number };
    };

    if (!response.ok || !data.ok || !data.order) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    return data;
  };

  const onConfirmSubmit = async () => {
    setSubmitError(null);
    if (computed.linePlans.some((plan) => plan.splits.length === 0)) {
      setSubmitError("請先完成投放設定，再重新送出。");
      return;
    }

    const draft = buildDraftOrder();
    setSubmitting(true);
    try {
      if (window.location.origin.startsWith("http")) {
        const data = await submitViaBackend(draft);
        insertOrder(data.order);
        const successCount = Number(data.summary?.successCount ?? 0);
        const failureCount = Number(data.summary?.failureCount ?? 0);
        if (failureCount > 0 && successCount > 0) {
          setSubmittedSummary(`已送出，成功 ${successCount} 筆，另有 ${failureCount} 筆需管理員處理。`);
        } else if (failureCount > 0) {
          setSubmittedSummary(`送出未完成，目前有 ${failureCount} 筆需管理員處理。`);
        } else {
          setSubmittedSummary("已送出，系統正在處理。");
        }
      } else {
        addOrder({ ...draft, status: "planned" });
        setSubmittedSummary("系統暫時無法完成送出，請稍後再試或通知管理員。");
      }
      setStep("submitted");
    } catch (error) {
      const message = error instanceof Error ? error.message : "送出失敗";
      setSubmitError(`送出失敗：${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">{step === "edit" ? "廠商互動下單" : step === "confirm" ? "確認送出" : "已送出"}</div>
          <div className="brand-sub">填寫需求、確認資料、送出後追蹤進度。</div>
        </div>

        <div className="pill">
          <span className="tag">{applicant}</span>
          <button className="btn" onClick={() => nav("/meta-ads-orders")}>Meta官方投廣</button>
          <button className="btn" onClick={() => nav("/ad-performance")}>投放成效</button>
          <button className="btn" onClick={() => nav("/settings")}>控制設定</button>
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
                <div className="card-title">基本資訊</div>
                <div className="card-desc">申請人與日期由系統帶入。</div>
              </div>
            </div>
            <div className="card-bd">
              <div className="row cols2">
                <div className="field">
                  <div className="label">申請人</div>
                  <input value={applicant} readOnly />
                </div>
                <div className="field">
                  <div className="label">日期</div>
                  <input value={nowString()} readOnly />
                </div>
                <div className="field">
                  <div className="label">委刊單號<span className="req">*</span></div>
                  <input value={state.orderNo} onChange={(e) => setState((current) => ({ ...current, orderNo: e.target.value }))} placeholder="例如：202509230021" />
                  {errors.orderNo && <div className="error">{errors.orderNo}</div>}
                </div>
                <div className="field">
                  <div className="label">案件名稱<span className="req">*</span></div>
                  <input value={state.caseName} onChange={(e) => setState((current) => ({ ...current, caseName: e.target.value }))} placeholder="例如：2025_DY_GAP 專案" />
                  {errors.caseName && <div className="error">{errors.caseName}</div>}
                </div>
                <div className="field">
                  <div className="label">種類<span className="req">*</span></div>
                  <select value={state.kind} onChange={(e) => setState((current) => ({ ...current, kind: e.target.value as OrderKind }))}>
                    <option value="new">新案</option>
                    <option value="upsell">加購</option>
                  </select>
                </div>
                <div className="field" />
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <div className="label">連結<span className="req">*</span></div>
                  <textarea
                    rows={5}
                    value={state.linksRaw}
                    onChange={(e) => setState((current) => ({ ...current, linksRaw: e.target.value }))}
                    placeholder={"https://...\nhttps://..."}
                  />
                  <div className="hint">一行一個網址，可填多筆。</div>
                  {errors.linksRaw && <div className="error">{errors.linksRaw}</div>}
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <div>
                <div className="card-title">投放項目</div>
                <div className="card-desc">數量需符合品項的最小單位。</div>
              </div>
              <button className="btn primary" type="button" onClick={addItem}>新增一筆</button>
            </div>
            <div className="card-bd">
              <div className="list">
                {state.items.map((item, index) => {
                  const rule = PRICING[item.placement];
                  const qty = Number(item.target);
                  const amount = Number.isFinite(qty) && qty > 0 ? calcInternalLineAmount(item.placement, qty) : 0;
                  const itemErrors = errors.items?.[index];
                  return (
                    <div className="item" key={`${item.placement}-${index}`}>
                      <div className="item-hd">
                        <div className="item-title">第 {index + 1} 筆</div>
                        <button className="btn danger" type="button" disabled={state.items.length <= 1} onClick={() => removeItem(index)}>
                          移除
                        </button>
                      </div>

                      <div className="row cols3">
                        <div className="field">
                          <div className="label">平台 / 項目<span className="req">*</span></div>
                          <select value={item.placement} onChange={(e) => updateItem(index, (current) => ({ ...current, placement: e.target.value as AdPlacement, target: String(PRICING[e.target.value as AdPlacement].minUnit) }))}>
                            {Object.keys(PRICING).map((key) => (
                              <option key={key} value={key}>{PLACEMENT_LABELS[key as AdPlacement]}</option>
                            ))}
                          </select>
                          {itemErrors?.placement && <div className="error">{itemErrors.placement}</div>}
                        </div>
                        <div className="field">
                          <div className="label">目標數量<span className="req">*</span></div>
                          <input value={item.target} inputMode="numeric" onChange={(e) => updateItem(index, (current) => ({ ...current, target: e.target.value }))} placeholder={String(rule.minUnit)} />
                          <div className="hint">最小單位：{rule.minUnit.toLocaleString()}</div>
                          {itemErrors?.target && <div className="error">{itemErrors.target}</div>}
                        </div>
                        <div className="field">
                          <div className="label">預估金額</div>
                          <input value={showPrices ? `NT$ ${amount.toLocaleString()}` : "依設定隱藏"} readOnly />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="sep" />
              <div className="kpi">
                <div className="hint">預估總金額</div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{showPrices ? `NT$ ${computed.total.toLocaleString()}` : "依設定隱藏"}</div>
              </div>

              <div className="actions">
                <button className="btn primary" type="button" onClick={goConfirm}>下一步：確認</button>
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
                <div className="card-desc">確認後系統會依設定自動安排投放。</div>
              </div>
            </div>
            <div className="card-bd">
              <div className="row cols2">
                <div className="field">
                  <div className="label">委刊單號</div>
                  <input value={state.orderNo} readOnly />
                </div>
                <div className="field">
                  <div className="label">案件名稱</div>
                  <input value={state.caseName} readOnly />
                </div>
                <div className="field">
                  <div className="label">種類</div>
                  <input value={state.kind === "new" ? "新案" : "加購"} readOnly />
                </div>
                <div className="field">
                  <div className="label">日期</div>
                  <input value={nowString()} readOnly />
                </div>
              </div>

              <div className="sep" />
              <div className="field">
                <div className="label">連結</div>
                <div className="list">
                  {links.map((url) => (
                    <div className="item" key={url}><div style={{ wordBreak: "break-all" }}>{url}</div></div>
                  ))}
                </div>
              </div>

              <div className="sep" />
              <div className="field">
                <div className="label">投放項目</div>
                <div className="list">
                  {state.items.map((item, index) => {
                    const qty = Number(item.target);
                    const amount = Number.isFinite(qty) && qty > 0 ? calcInternalLineAmount(item.placement, qty) : 0;
                    const plan = computed.linePlans[index] ?? { splits: [], warnings: [] as string[] };
                    return (
                      <div className="item" key={`${item.placement}-${index}`}>
                        <div className="item-hd">
                          <div className="item-title">{PLACEMENT_LABELS[item.placement]} / 數量 {Number.isFinite(qty) ? qty.toLocaleString() : "-"}</div>
                          <div style={{ fontWeight: 800 }}>{showPrices ? `NT$ ${amount.toLocaleString()}` : "依設定隱藏"}</div>
                        </div>
                        {plan.splits.length === 0 ? (
                          <div className="error" style={{ marginTop: 6 }}>這個投放項目尚未完成系統設定，請通知管理員協助處理。</div>
                        ) : (
                          <div className="hint" style={{ marginTop: 6 }}>系統會依設定自動安排投放，送出後可到投放成效查看最新進度。</div>
                        )}
                        {plan.splits.length > 0 && plan.warnings.length > 0 && (
                          <div className="hint" style={{ marginTop: 6, color: "rgba(245, 158, 11, 0.95)" }}>目前設定需要管理員留意，若送出後有提醒請通知管理員。</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="sep" />
              <div className="kpi">
                <div className="hint">預估總金額</div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{showPrices ? `NT$ ${computed.total.toLocaleString()}` : "依設定隱藏"}</div>
              </div>

              <div className="actions">
                <button className="btn" type="button" onClick={() => setStep("edit")}>返回修改</button>
                <button className="btn primary" type="button" onClick={() => void onConfirmSubmit()} disabled={submitting}>
                  {submitting ? "送出中" : "確認送出"}
                </button>
              </div>
              {submitError ? <div className="error" style={{ marginTop: 10 }}>{submitError}</div> : null}
            </div>
          </div>
        </div>
      )}

      {step === "submitted" && (
        <div className="grid">
          <div className="card">
            <div className="card-hd">
              <div>
                <div className="card-title">已送出</div>
                <div className="card-desc">送出後可到投放成效查看最新狀態。</div>
              </div>
            </div>
            <div className="card-bd">
              <div className="hint">{submittedSummary || "送出後可到投放成效查看最新進度。"}</div>
              <div className="sep" />
              <div className="actions">
                <button className="btn" type="button" onClick={() => setStep("edit")}>再建一筆</button>
                <button className="btn primary" type="button" onClick={() => nav("/ad-performance")}>前往投放成效</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
