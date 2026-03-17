import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PRICING, type AdPlacement } from "../lib/pricing";
import { isValidUrl, parseLinks } from "../lib/validate";
import { getConfig, getPlacementConfig, getVendorLabel, type VendorKey } from "../config/appConfig";
import { planSplit } from "../lib/split";
import { addOrder, insertOrder, type DemoOrder } from "../lib/ordersStore";
import { findServiceName } from "../config/serviceCatalog";
import { calcInternalLineAmount, shouldShowPrices } from "../lib/internalPricing";
import { flushAllSharedState, SHARED_SYNC_EVENT } from "../lib/sharedSync";

type OrderKind = "new" | "upsell";

type LineItem = {
  placement: AdPlacement;
  target: string; // keep as string for input control
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

function nowString() {
  return new Date().toLocaleString("zh-TW");
}

function defaultState(): FormState {
  return {
    orderNo: "",
    caseName: "",
    kind: "new",
    linksRaw: "",
    items: [{ placement: "fb_like", target: "100" }],
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
    errors.linksRaw = "連結格式需為完整 URL（建議一行一個，例如 https://...）";
  }

  if (!state.items || state.items.length === 0) {
    errors.items = [{ placement: "請至少新增 1 筆投放項目" }];
  } else {
    errors.items = state.items.map((it) => {
      const e: { placement?: string; target?: string } = {};
      if (!it.placement) e.placement = "請選擇投放類型";
      const n = Number(it.target);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        e.target = "請輸入正整數";
      } else {
        const rule = PRICING[it.placement];
        if (n % rule.minUnit !== 0) {
          e.target = `數量需為 ${rule.minUnit.toLocaleString()} 的倍數`;
        }
      }
      return e;
    });
    if (errors.items?.every((x) => !x.placement && !x.target)) {
      delete errors.items;
    }
  }

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
  const [submittedSummary, setSubmittedSummary] = useState<string>("");

  const cfg = getConfig();
  const vendorEnabled = (v: VendorKey) => cfg.vendors.some((x) => x.key === v && x.enabled);

  const computed = useMemo(() => {
    const lineAmounts = state.items.map((it) => {
      const n = Number(it.target);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return calcInternalLineAmount(it.placement, n);
    });
    const total = lineAmounts.reduce((a, b) => a + b, 0);

    const linePlans = state.items.map((it) => {
      const n = Number(it.target);
      if (!Number.isFinite(n) || n <= 0) return { splits: [], warnings: [] as string[] };
      const p = getPlacementConfig(it.placement);
      return planSplit({
        total: n,
        suppliers: p.suppliers,
        strategy: p.splitStrategy ?? "random",
        vendorEnabled: (v) => vendorEnabled(v),
      });
    });

    return { lineAmounts, total, linePlans };
  }, [state.items, cfg.updatedAt]);

  useEffect(() => {
    const onSharedSync = () => setSharedTick((x) => x + 1);
    window.addEventListener(SHARED_SYNC_EVENT, onSharedSync);
    return () => window.removeEventListener(SHARED_SYNC_EVENT, onSharedSync);
  }, []);

  const toConfirm = () => {
    const e = validate(state);
    setErrors(e);
    setSubmitError(null);
    if (Object.keys(e).length > 0) return;
    setStep("confirm");
  };

  const buildDraftOrder = () => {
    const applicant = user?.displayName ?? user?.username ?? "";
    const links = parseLinks(state.linksRaw);
    return {
      applicant,
      orderNo: state.orderNo.trim(),
      caseName: state.caseName.trim(),
      kind: state.kind,
      links,
      lines: state.items.map((it, idx) => {
        const n = Number(it.target);
        const amount = Number.isFinite(n) && n > 0 ? calcInternalLineAmount(it.placement, n) : 0;
        const plan = computed.linePlans[idx] ?? { splits: [], warnings: [] };
        return {
          placement: it.placement,
          quantity: Number.isFinite(n) ? n : 0,
          amount,
          splits: plan.splits,
          warnings: plan.warnings,
        };
      }),
      totalAmount: computed.total,
    };
  };

  const submitViaBackend = async (draft: ReturnType<typeof buildDraftOrder>) => {
    await flushAllSharedState();
    const res = await fetch("/api/vendor/submit-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      order?: DemoOrder;
      summary?: { successCount?: number; failureCount?: number; usedLink?: string };
    };
    if (!res.ok || !data.ok || !data.order) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  };

  const onConfirmSubmit = async () => {
    setSubmitError(null);
    const missingPlan = computed.linePlans.some((plan) => plan.splits.length === 0);
    if (missingPlan) {
      setSubmitError("仍有項目尚未完成拆單設定，無法正式送單。請先到控制設定補齊服務項目。");
      return;
    }

    const draft = buildDraftOrder();
    setSubmitting(true);
    try {
      const sameOriginApi = window.location.origin.startsWith("http");
      if (sameOriginApi) {
        const data = await submitViaBackend(draft);
        insertOrder(data.order);
        const successCount = Number(data.summary?.successCount ?? 0);
        const failureCount = Number(data.summary?.failureCount ?? 0);
        if (failureCount > 0 && successCount > 0) {
          setSubmittedSummary(`已送出，${successCount} 筆成功、${failureCount} 筆失敗。`);
        } else if (failureCount > 0) {
          setSubmittedSummary(`送單失敗，${failureCount} 筆未成功。`);
        } else {
          setSubmittedSummary(`已送出 ${successCount} 筆供應商訂單。`);
        }
      } else {
        addOrder({ ...draft, status: "planned" });
        setSubmittedSummary("目前環境無法直接送到供應商，已先建立待處理工單。");
      }
      setStep("submitted");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "送單失敗";
      setSubmitError(`送單失敗：${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const applicant = user?.displayName ?? user?.username ?? "";
  const links = parseLinks(state.linksRaw);
  const showPrices = shouldShowPrices();

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">
            {step === "edit" ? "廠商互動下單" : step === "confirm" ? "確認送出" : "已送出"}
          </div>
          <div className="brand-sub">填單、確認、送出。</div>
        </div>

        <div className="pill">
          <span className="tag">{applicant}</span>
          <button className="btn" onClick={() => nav("/meta-ads-orders")}>
            Meta官方投廣
          </button>
          <button className="btn" onClick={() => nav("/ad-performance")}>
            投放成效
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
                  <div className="label">
                    委刊單號<span className="req">*</span>
                  </div>
                  <input
                    value={state.orderNo}
                    onChange={(e) => setState((s) => ({ ...s, orderNo: e.target.value }))}
                    placeholder="例如：202509230021"
                  />
                  {errors.orderNo && <div className="error">{errors.orderNo}</div>}
                </div>
                <div className="field">
                  <div className="label">
                    案件名稱<span className="req">*</span>
                  </div>
                  <input
                    value={state.caseName}
                    onChange={(e) => setState((s) => ({ ...s, caseName: e.target.value }))}
                    placeholder="例如：2025_DY_GAP(封面專案)"
                  />
                  {errors.caseName && <div className="error">{errors.caseName}</div>}
                </div>
                <div className="field">
                  <div className="label">
                    種類<span className="req">*</span>
                  </div>
                  <select
                    value={state.kind}
                    onChange={(e) => setState((s) => ({ ...s, kind: e.target.value as OrderKind }))}
                  >
                    <option value="new">新案</option>
                    <option value="upsell">加購</option>
                  </select>
                </div>
                <div className="field" />

                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <div className="label">
                    連結<span className="req">*</span>
                  </div>
                  <textarea
                    rows={5}
                    value={state.linksRaw}
                    onChange={(e) => setState((s) => ({ ...s, linksRaw: e.target.value }))}
                    placeholder={"https://...\nhttps://..."}
                  />
                  <div className="hint">一行一個 URL，可多筆。</div>
                  {errors.linksRaw && <div className="error">{errors.linksRaw}</div>}
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <div>
                <div className="card-title">投放項目</div>
                <div className="card-desc">數量需符合最小單位倍數（暫定定價）。</div>
              </div>
              <button
                className="btn primary"
                type="button"
                onClick={() =>
                  setState((s) => ({
                    ...s,
                    items: [...s.items, { placement: "fb_like", target: "100" }],
                  }))
                }
              >
                新增一筆
              </button>
            </div>
            <div className="card-bd">
              <div className="list">
                {state.items.map((it, idx) => {
                  const rule = PRICING[it.placement];
                  const n = Number(it.target);
                  const amount = Number.isFinite(n) && n > 0 ? calcInternalLineAmount(it.placement, n) : 0;
                  const itemErr = errors.items?.[idx];
                  return (
                    <div className="item" key={idx}>
                      <div className="item-hd">
                        <div className="item-title">第 {idx + 1} 筆</div>
                        <button
                          className="btn danger"
                          type="button"
                          disabled={state.items.length <= 1}
                          onClick={() =>
                            setState((s) => ({
                              ...s,
                              items: s.items.filter((_, i) => i !== idx),
                            }))
                          }
                        >
                          移除
                        </button>
                      </div>

                      <div className="row cols3">
                        <div className="field">
                          <div className="label">
                            平台/類型<span className="req">*</span>
                          </div>
                          <select
                            value={it.placement}
                            onChange={(e) =>
                              setState((s) => ({
                                ...s,
                                items: s.items.map((x, i) =>
                                  i === idx ? { ...x, placement: e.target.value as AdPlacement } : x,
                                ),
                              }))
                            }
                          >
                            {Object.entries(PRICING).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v.label}
                              </option>
                            ))}
                          </select>
                          {itemErr?.placement && <div className="error">{itemErr.placement}</div>}
                        </div>

                        <div className="field">
                          <div className="label">
                            目標數量<span className="req">*</span>
                          </div>
                          <input
                            value={it.target}
                            inputMode="numeric"
                            onChange={(e) =>
                              setState((s) => ({
                                ...s,
                                items: s.items.map((x, i) =>
                                  i === idx ? { ...x, target: e.target.value } : x,
                                ),
                              }))
                            }
                            placeholder={String(rule.minUnit)}
                          />
                          <div className="hint">最小單位：{rule.minUnit.toLocaleString()}</div>
                          {itemErr?.target && <div className="error">{itemErr.target}</div>}
                        </div>

                        <div className="field">
                          <div className="label">預估金額</div>
                          {showPrices ? (
                            <input value={`NT$ ${amount.toLocaleString()}`} readOnly />
                          ) : (
                            <input value="（已隱藏）" readOnly />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="sep" />

              <div className="kpi">
                <div className="hint">預估總價（暫定）</div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>
                  {showPrices ? `NT$ ${computed.total.toLocaleString()}` : "（已隱藏）"}
                </div>
              </div>

              <div className="actions">
                <button className="btn primary" type="button" onClick={toConfirm}>
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
                  <div className="card-title">確認摘要</div>
                <div className="card-desc">請確認資料後送出。</div>
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
                  {links.map((u) => (
                    <div className="item" key={u}>
                      <div style={{ wordBreak: "break-all" }}>{u}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="sep" />

              <div className="field">
                <div className="label">投放項目</div>
                <div className="list">
                  {state.items.map((it, idx) => {
                    const rule = PRICING[it.placement];
                    const n = Number(it.target);
                    const amt = Number.isFinite(n) && n > 0 ? calcInternalLineAmount(it.placement, n) : 0;
                    const plan = computed.linePlans[idx] ?? { splits: [], warnings: [] as string[] };
                    return (
                      <div className="item" key={idx}>
                <div className="item-hd">
                  <div className="item-title">
                    {rule.label} / 數量 {Number.isFinite(n) ? n.toLocaleString() : "-"}
                  </div>
                  <div style={{ fontWeight: 800 }}>{showPrices ? `NT$ ${amt.toLocaleString()}` : "（已隱藏）"}</div>
                </div>

                        <div className="hint" style={{ marginTop: 6 }}>
                          拆單規劃：
                        </div>
                        {plan.splits.length === 0 ? (
                          <div className="error" style={{ marginTop: 6 }}>
                            尚未完成拆單設定，請通知管理員協助設定供應商服務編號（serviceId）（控制設定）。
                          </div>
                        ) : (
                          <div className="list" style={{ marginTop: 8 }}>
                            {plan.splits.map((s) => (
                              <div className="item" key={`${idx}-${s.vendor}-${s.serviceId}`}>
                                <div className="item-hd">
                                  <div className="item-title">
                                    {getVendorLabel(s.vendor)} / 服務編號（serviceId）{s.serviceId}
                                  </div>
                                  <div style={{ fontWeight: 800 }}>{s.quantity.toLocaleString()}</div>
                                </div>
                                {findServiceName(s.vendor, s.serviceId) && (
                                  <div className="hint" style={{ marginTop: 6 }}>
                                    {findServiceName(s.vendor, s.serviceId)}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {plan.splits.length > 0 && plan.warnings.length > 0 && (
                          <div className="hint" style={{ marginTop: 6, color: "rgba(245, 158, 11, 0.95)" }}>
                            {plan.warnings.join(" / ")}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="sep" />

              <div className="kpi">
                <div className="hint">預估總價（暫定）</div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>
                  {showPrices ? `NT$ ${computed.total.toLocaleString()}` : "（已隱藏）"}
                </div>
              </div>

              <div className="actions">
                <button className="btn" type="button" onClick={() => setStep("edit")}>
                  返回修改
                </button>
                <button className="btn primary" type="button" onClick={() => void onConfirmSubmit()} disabled={submitting}>
                  {submitting ? "送出中..." : "確認送出"}
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
                  <div className="card-desc">已建立一筆下單工單（目前儲存在本機瀏覽器）。</div>
              </div>
            </div>
            <div className="card-bd">
              <div className="hint">{submittedSummary || "送出後可到「投放成效」查看進度。"}</div>
              <div className="sep" />
              <div className="actions">
                <button className="btn" type="button" onClick={() => setStep("edit")}>
                  再次下單
                </button>
                <button className="btn primary" type="button" onClick={() => nav("/ad-performance")}>
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
