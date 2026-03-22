import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import type { AdPlacement } from "../lib/pricing";
import { isValidUrl, parseLinks } from "../lib/validate";
import { getConfig, getEnabledPlacements, getPlacementConfig, getPlacementLabel, type VendorKey } from "../config/appConfig";
import { planSplit } from "../lib/split";
import { addOrder, insertOrder, type DemoOrder, type OrderSubmitMode } from "../lib/ordersStore";
import { calcInternalLineAmount, shouldShowPrices } from "../lib/internalPricing";
import { getPlacementMinUnit } from "../config/pricingConfig";
import { apiUrl } from "../lib/apiBase";
import { flushAllSharedState, pullSharedState, SHARED_SYNC_EVENT } from "../lib/sharedSync";
import { buildAverageBatches, buildInstantBatches, countAverageExecutionDays } from "../lib/orderSchedule";

type OrderKind = "new" | "upsell";

type LineItem = {
  placement: AdPlacement;
  target: string;
};

type FormState = {
  orderNo: string;
  caseName: string;
  kind: OrderKind;
  submitMode: OrderSubmitMode;
  scheduleStartDate: string;
  scheduleEndDate: string;
  linksRaw: string;
  items: LineItem[];
};

type FormErrors = Partial<Record<Exclude<keyof FormState, "items">, string>> & {
  items?: Array<{ placement?: string; target?: string }>;
};

function nowString() {
  return new Date().toLocaleString("zh-TW");
}

function defaultState(defaultPlacement: AdPlacement): FormState {
  return {
    orderNo: "",
    caseName: "",
    kind: "new",
    submitMode: "instant",
    scheduleStartDate: "",
    scheduleEndDate: "",
    linksRaw: "",
    items: [{ placement: defaultPlacement, target: String(getPlacementMinUnit(defaultPlacement)) }],
  };
}

function validate(state: FormState): FormErrors {
  const errors: FormErrors = {};

  if (!state.orderNo.trim()) errors.orderNo = "請填寫委刊單號";
  if (!state.caseName.trim()) errors.caseName = "請填寫案件名稱";

  if (state.submitMode === "average") {
    if (!state.scheduleStartDate) errors.scheduleStartDate = "請選擇起始日";
    if (!state.scheduleEndDate) errors.scheduleEndDate = "請選擇結束日";
    if (state.scheduleStartDate && state.scheduleEndDate) {
      const dayCount = countAverageExecutionDays(state.scheduleStartDate, state.scheduleEndDate);
      if (dayCount <= 0) {
        errors.scheduleEndDate = "結束日需晚於起始日，系統會在結束日前一天完成";
      }
    }
  }

  const links = parseLinks(state.linksRaw);
  if (links.length === 0) {
    errors.linksRaw = "請至少提供 1 個連結";
  } else if (links.length > 1) {
    errors.linksRaw = "一次只能填 1 個連結";
  } else if (!links.every(isValidUrl)) {
    errors.linksRaw = "連結格式需為完整 URL，例如 https://...";
  }

  if (!state.items.length) {
    errors.items = [{ placement: "請至少新增 1 筆投放項目" }];
    return errors;
  }

  errors.items = state.items.map((item) => {
    const fieldErrors: { placement?: string; target?: string } = {};
    if (!item.placement) fieldErrors.placement = "請選擇投放項目";
    const qty = Number(item.target);
    const minUnit = getPlacementMinUnit(item.placement);
    const averageDays =
      state.submitMode === "average" && state.scheduleStartDate && state.scheduleEndDate
        ? countAverageExecutionDays(state.scheduleStartDate, state.scheduleEndDate)
        : 0;
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
      fieldErrors.target = "請輸入正整數";
    } else if (qty % minUnit !== 0) {
      fieldErrors.target = `數量需為 ${minUnit.toLocaleString()} 的倍數`;
    } else if (state.submitMode === "average") {
      const totalUnits = qty / minUnit;
      if (averageDays <= 0) {
        fieldErrors.target = "請先完成平均模式的日期設定";
      } else if (totalUnits < averageDays) {
        fieldErrors.target = `平均模式共有 ${averageDays.toLocaleString()} 天可執行，總數量至少需能分成 ${averageDays.toLocaleString()} 個最小單位`;
      }
    }
    return fieldErrors;
  });

  if (errors.items.every((item) => !item.placement && !item.target)) delete errors.items;
  return errors;
}

export function AdOrdersPage() {
  const nav = useNavigate();
  const { user, signOut, hasRole } = useAuth();
  const [, setSharedTick] = useState(0);
  const [step, setStep] = useState<"edit" | "confirm" | "submitted">("edit");
  const cfg = getConfig();
  const enabledPlacements = useMemo(() => getEnabledPlacements(), [cfg.updatedAt]);
  const defaultPlacement = enabledPlacements[0]?.placement ?? cfg.placements[0]?.placement ?? "fb_like";
  const [state, setState] = useState<FormState>(() => defaultState(defaultPlacement));
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedSummary, setSubmittedSummary] = useState("");
  const applicant = user?.displayName ?? user?.username ?? "";
  const canManage = hasRole("admin");
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

  useEffect(() => {
    void pullSharedState(["ad_demo_config_v1", "ad_demo_pricing_v1"]);
  }, []);

  useEffect(() => {
    if (enabledPlacements.length === 0) return;
    setState((current) => ({
      ...current,
      items: current.items.map((item) =>
        enabledPlacements.some((placement) => placement.placement === item.placement)
          ? item
          : { placement: defaultPlacement, target: String(getPlacementMinUnit(defaultPlacement)) },
      ),
    }));
  }, [defaultPlacement, enabledPlacements]);

  const updateItem = (index: number, updater: (item: LineItem) => LineItem) => {
    setState((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (itemIndex === index ? updater(item) : item)),
    }));
  };

  const addItem = () => {
    if (enabledPlacements.length === 0) return;
    setState((current) => ({
      ...current,
      items: [...current.items, { placement: defaultPlacement, target: String(getPlacementMinUnit(defaultPlacement)) }],
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
    mode: state.submitMode,
    scheduleStartDate: state.submitMode === "average" ? state.scheduleStartDate : undefined,
    scheduleEndDate: state.submitMode === "average" ? state.scheduleEndDate : undefined,
    links,
    lines: state.items.map((item, index) => {
      const qty = Number(item.target);
      const amount = Number.isFinite(qty) && qty > 0 ? calcInternalLineAmount(item.placement, qty) : 0;
      const plan = computed.linePlans[index] ?? { splits: [], warnings: [] as string[] };
      const placementCfg = getPlacementConfig(item.placement);
      const appendCfg = placementCfg.appendOnComplete;
      const batches =
        state.submitMode === "average" && state.scheduleStartDate && state.scheduleEndDate
          ? buildAverageBatches({
              startDate: state.scheduleStartDate,
              endDate: state.scheduleEndDate,
              quantity: Number.isFinite(qty) ? qty : 0,
              amount,
              minUnit: getPlacementMinUnit(item.placement),
              warnings: plan.warnings,
              splits: plan.splits,
            })
          : buildInstantBatches({
              quantity: Number.isFinite(qty) ? qty : 0,
              amount,
              warnings: plan.warnings,
              splits: plan.splits,
            });
      return {
        placement: item.placement,
        quantity: Number.isFinite(qty) ? qty : 0,
        amount,
        splits: plan.splits,
        warnings: plan.warnings,
        appendOnComplete:
          appendCfg && appendCfg.enabled && appendCfg.serviceId > 0 && appendCfg.quantity > 0
            ? {
                enabled: true,
                vendor: appendCfg.vendor,
                serviceId: appendCfg.serviceId,
                quantity: appendCfg.quantity,
              }
            : undefined,
        mode: state.submitMode,
        startDate: state.submitMode === "average" ? state.scheduleStartDate : undefined,
        endDate: state.submitMode === "average" ? state.scheduleEndDate : undefined,
        batches,
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
          {canManage ? <button className="btn" onClick={() => nav("/meta-ads-orders")}>Meta官方投廣</button> : null}
          <button className="btn" onClick={() => nav("/ad-performance")}>投放成效</button>
          {canManage ? <button className="btn" onClick={() => nav("/settings")}>控制設定</button> : null}
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
                <div className="field">
                  <div className="label">下單方式<span className="req">*</span></div>
                  <select
                    value={state.submitMode}
                    onChange={(e) => setState((current) => ({ ...current, submitMode: e.target.value as OrderSubmitMode }))}
                  >
                    <option value="instant">預設</option>
                    <option value="average">平均</option>
                  </select>
                  <div className="hint">預設會一次送完；平均會依走期拆成每日批次，並在結束日前一天完成。</div>
                </div>
                {state.submitMode === "average" ? (
                  <>
                    <div className="field">
                      <div className="label">起始日<span className="req">*</span></div>
                      <input
                        type="date"
                        value={state.scheduleStartDate}
                        onChange={(e) => setState((current) => ({ ...current, scheduleStartDate: e.target.value }))}
                      />
                      {errors.scheduleStartDate && <div className="error">{errors.scheduleStartDate}</div>}
                    </div>
                    <div className="field">
                      <div className="label">結束日<span className="req">*</span></div>
                      <input
                        type="date"
                        value={state.scheduleEndDate}
                        onChange={(e) => setState((current) => ({ ...current, scheduleEndDate: e.target.value }))}
                      />
                      <div className="hint">系統會在這一天之前完成，最後一天不再新增新訂單。</div>
                      {errors.scheduleEndDate && <div className="error">{errors.scheduleEndDate}</div>}
                    </div>
                  </>
                ) : (
                  <div className="field" />
                )}
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <div className="label">連結<span className="req">*</span></div>
                  <input
                    value={state.linksRaw}
                    onChange={(e) => setState((current) => ({ ...current, linksRaw: e.target.value }))}
                    placeholder="https://..."
                  />
                  <div className="hint">目前一次只接受 1 個網址。</div>
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
              {enabledPlacements.length === 0 ? (
                <div className="error" style={{ marginBottom: 12 }}>目前沒有可用的投放品項，請通知管理員到控制設定新增或啟用品項。</div>
              ) : null}
              <div className="list">
                {state.items.map((item, index) => {
                  const minUnit = getPlacementMinUnit(item.placement);
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
                          <select value={item.placement} onChange={(e) => updateItem(index, (current) => ({ ...current, placement: e.target.value as AdPlacement, target: String(getPlacementMinUnit(e.target.value as AdPlacement)) }))}>
                            {enabledPlacements.map((placement) => (
                              <option key={placement.placement} value={placement.placement}>{placement.label}</option>
                            ))}
                          </select>
                          {itemErrors?.placement && <div className="error">{itemErrors.placement}</div>}
                        </div>
                        <div className="field">
                          <div className="label">目標數量<span className="req">*</span></div>
                          <input value={item.target} inputMode="numeric" onChange={(e) => updateItem(index, (current) => ({ ...current, target: e.target.value }))} placeholder={String(minUnit)} />
                          <div className="hint">最小單位：{minUnit.toLocaleString()}</div>
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
                <button className="btn primary" type="button" onClick={goConfirm} disabled={enabledPlacements.length === 0}>下一步：確認</button>
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
                <div className="field">
                  <div className="label">下單方式</div>
                  <input value={state.submitMode === "average" ? "平均" : "預設"} readOnly />
                </div>
                <div className="field">
                  <div className="label">走期</div>
                  <input
                    value={
                      state.submitMode === "average" && state.scheduleStartDate && state.scheduleEndDate
                        ? `${state.scheduleStartDate} ~ ${state.scheduleEndDate}`
                        : "一次性送出"
                    }
                    readOnly
                  />
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
                          <div className="item-title">{getPlacementLabel(item.placement)} / 數量 {Number.isFinite(qty) ? qty.toLocaleString() : "-"}</div>
                          <div style={{ fontWeight: 800 }}>{showPrices ? `NT$ ${amount.toLocaleString()}` : "依設定隱藏"}</div>
                        </div>
                        {plan.splits.length === 0 ? (
                          <div className="error" style={{ marginTop: 6 }}>這個投放項目尚未完成系統設定，請通知管理員協助處理。</div>
                        ) : (
                          <div className="hint" style={{ marginTop: 6 }}>
                            {state.submitMode === "average" && state.scheduleStartDate && state.scheduleEndDate
                              ? (() => {
                                  const dayCount = countAverageExecutionDays(state.scheduleStartDate, state.scheduleEndDate);
                                  return dayCount > 0
                                    ? `系統會拆成 ${dayCount} 個執行日批次，並在 ${state.scheduleEndDate} 前一天完成。`
                                    : "系統會依設定自動安排投放。";
                                })()
                              : "系統會依設定自動安排投放，送出後可到投放成效查看最新進度。"}
                          </div>
                        )}
                        {plan.splits.length > 0 && plan.warnings.length > 0 && (
                          <div className="hint" style={{ marginTop: 6, color: "rgba(245, 158, 11, 0.95)" }}>目前設定需要管理員留意，若送出後有提醒請通知管理員。</div>
                        )}
                        {state.submitMode === "average" && state.scheduleStartDate && state.scheduleEndDate ? (
                          <div className="hint" style={{ marginTop: 6 }}>
                            {(() => {
                              const dayCount = countAverageExecutionDays(state.scheduleStartDate, state.scheduleEndDate);
                              return dayCount > 0
                                ? `成效頁會顯示為 ${state.caseName || "案件"}（1/${dayCount} 日）、（2/${dayCount} 日）...`
                                : "請先完成日期設定。";
                            })()}
                          </div>
                        ) : null}
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
