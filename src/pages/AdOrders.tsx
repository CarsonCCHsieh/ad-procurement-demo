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
type LineItem = { placement: AdPlacement; target: string };
type Draft = {
  id: string;
  applicant: string;
  orderNo: string;
  caseName: string;
  kind: OrderKind;
  submitMode: OrderSubmitMode;
  scheduleStartDate: string;
  scheduleEndDate: string;
  linksRaw: string;
  items: LineItem[];
};
type DraftError = {
  applicant?: string;
  orderNo?: string;
  caseName?: string;
  linksRaw?: string;
  scheduleStartDate?: string;
  scheduleEndDate?: string;
  items?: Array<{ placement?: string; target?: string }>;
};

function nowString() {
  return new Date().toLocaleString("zh-TW");
}
function makeDraft(defaultPlacement: AdPlacement, applicant: string): Draft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    applicant,
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
function isEmptyDraft(d: Draft) {
  return !d.orderNo.trim() && !d.caseName.trim() && !d.linksRaw.trim();
}
function hasErr(e: DraftError) {
  return Object.keys(e).length > 0;
}
function validateDraft(draft: Draft): DraftError {
  const e: DraftError = {};
  if (!draft.applicant.trim()) e.applicant = "請填寫申請人";
  if (!draft.orderNo.trim()) e.orderNo = "請填寫委刊單號";
  if (!draft.caseName.trim()) e.caseName = "請填寫案件名稱";
  const links = parseLinks(draft.linksRaw);
  if (links.length === 0) e.linksRaw = "請至少提供 1 個連結";
  else if (links.length > 1) e.linksRaw = "一次只能填 1 個連結";
  else if (!links.every(isValidUrl)) e.linksRaw = "連結格式需為完整 URL";
  if (draft.submitMode === "average") {
    if (!draft.scheduleStartDate) e.scheduleStartDate = "請選擇起始日";
    if (!draft.scheduleEndDate) e.scheduleEndDate = "請選擇結束日";
    if (draft.scheduleStartDate && draft.scheduleEndDate && countAverageExecutionDays(draft.scheduleStartDate, draft.scheduleEndDate) <= 0) {
      e.scheduleEndDate = "結束日需晚於起始日";
    }
  }
  e.items = draft.items.map((item) => {
    const fe: { placement?: string; target?: string } = {};
    if (!item.placement) fe.placement = "請選擇投放項目";
    const q = Number(item.target);
    const min = getPlacementMinUnit(item.placement);
    if (!Number.isFinite(q) || !Number.isInteger(q) || q <= 0) fe.target = "請輸入正整數";
    else if (q % min !== 0) fe.target = `數量需為 ${min.toLocaleString()} 的倍數`;
    return fe;
  });
  if (e.items.every((x) => !x.placement && !x.target)) delete e.items;
  return e;
}

export function AdOrdersPage() {
  const nav = useNavigate();
  const { user, signOut, hasRole } = useAuth();
  const [, setSharedTick] = useState(0);
  const [step, setStep] = useState<"edit" | "confirm" | "submitted">("edit");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedSummary, setSubmittedSummary] = useState("");
  const canManage = hasRole("admin");
  const showPrices = shouldShowPrices();

  const cfg = getConfig();
  const enabledPlacements = useMemo(() => getEnabledPlacements(), [cfg.updatedAt]);
  const defaultPlacement = enabledPlacements[0]?.placement ?? cfg.placements[0]?.placement ?? "fb_like";
  const applicantDefault = user?.displayName ?? user?.username ?? "";

  const [drafts, setDrafts] = useState<Draft[]>(() => [makeDraft(defaultPlacement, applicantDefault)]);
  const [errors, setErrors] = useState<DraftError[]>([]);

  const vendorEnabled = (vendor: VendorKey) => cfg.vendors.some((item) => item.key === vendor && item.enabled);
  const computed = useMemo(() => drafts.map((draft) => {
    const linePlans = draft.items.map((item) => {
      const qty = Number(item.target);
      if (!Number.isFinite(qty) || qty <= 0) return { splits: [], warnings: [] as string[] };
      const placementConfig = getPlacementConfig(item.placement);
      return planSplit({ total: qty, suppliers: placementConfig.suppliers, strategy: placementConfig.splitStrategy ?? "random", vendorEnabled });
    });
    const total = draft.items.reduce((sum, item) => {
      const qty = Number(item.target);
      return Number.isFinite(qty) && qty > 0 ? sum + calcInternalLineAmount(item.placement, qty) : sum;
    }, 0);
    return { linePlans, total };
  }), [drafts, cfg.updatedAt]);

  const activeIndexes = useMemo(() => drafts.map((d, i) => ({ d, i })).filter((x) => !isEmptyDraft(x.d)).map((x) => x.i), [drafts]);
  const totalAll = useMemo(() => activeIndexes.reduce((sum, i) => sum + (computed[i]?.total ?? 0), 0), [activeIndexes, computed]);

  useEffect(() => { void pullSharedState(["ad_demo_config_v1", "ad_demo_pricing_v1"]); }, []);
  useEffect(() => {
    const onSharedSync = () => setSharedTick((v) => v + 1);
    window.addEventListener(SHARED_SYNC_EVENT, onSharedSync);
    return () => window.removeEventListener(SHARED_SYNC_EVENT, onSharedSync);
  }, []);
  useEffect(() => {
    if (!enabledPlacements.length) return;
    setDrafts((cur) => cur.map((d) => ({
      ...d,
      items: d.items.map((x) => enabledPlacements.some((p) => p.placement === x.placement) ? x : { placement: defaultPlacement, target: String(getPlacementMinUnit(defaultPlacement)) }),
    })));
  }, [enabledPlacements, defaultPlacement]);

  const updateDraft = (i: number, updater: (d: Draft) => Draft) => setDrafts((cur) => cur.map((d, idx) => idx === i ? updater(d) : d));
  const addDraft = () => setDrafts((cur) => [...cur, makeDraft(defaultPlacement, applicantDefault)]);
  const removeDraft = (i: number) => { setDrafts((cur) => cur.filter((_, idx) => idx !== i)); setErrors((cur) => cur.filter((_, idx) => idx !== i)); };
  const addLine = (i: number) => updateDraft(i, (d) => ({ ...d, items: [...d.items, { placement: defaultPlacement, target: String(getPlacementMinUnit(defaultPlacement)) }] }));
  const removeLine = (i: number, li: number) => updateDraft(i, (d) => ({ ...d, items: d.items.filter((_, idx) => idx !== li) }));

  const goConfirm = () => {
    setSubmitError(null);
    if (!activeIndexes.length) return setSubmitError("請至少完成 1 筆訂單資料。");
    const nextErr = drafts.map((d) => isEmptyDraft(d) ? {} : validateDraft(d));
    setErrors(nextErr);
    if (nextErr.some(hasErr)) return;
    setStep("confirm");
  };

  const buildPayload = (d: Draft, c: { linePlans: Array<{ splits: ReturnType<typeof planSplit>["splits"]; warnings: string[] }>; total: number }) => {
    const links = parseLinks(d.linksRaw);
    return {
      applicant: d.applicant.trim(),
      orderNo: d.orderNo.trim(),
      caseName: d.caseName.trim(),
      kind: d.kind,
      mode: d.submitMode,
      scheduleStartDate: d.submitMode === "average" ? d.scheduleStartDate : undefined,
      scheduleEndDate: d.submitMode === "average" ? d.scheduleEndDate : undefined,
      links,
      lines: d.items.map((item, idx) => {
        const q = Number(item.target);
        const amount = Number.isFinite(q) && q > 0 ? calcInternalLineAmount(item.placement, q) : 0;
        const plan = c.linePlans[idx] ?? { splits: [], warnings: [] as string[] };
        const placementCfg = getPlacementConfig(item.placement);
        const appendCfg = placementCfg.appendOnComplete;
        const batches = d.submitMode === "average" && d.scheduleStartDate && d.scheduleEndDate
          ? buildAverageBatches({ startDate: d.scheduleStartDate, endDate: d.scheduleEndDate, quantity: Number.isFinite(q) ? q : 0, amount, minUnit: getPlacementMinUnit(item.placement), warnings: plan.warnings, splits: plan.splits })
          : buildInstantBatches({ quantity: Number.isFinite(q) ? q : 0, amount, warnings: plan.warnings, splits: plan.splits });
        return {
          placement: item.placement, quantity: Number.isFinite(q) ? q : 0, amount, splits: plan.splits, warnings: plan.warnings,
          appendOnComplete: appendCfg && appendCfg.enabled && appendCfg.serviceId > 0 && appendCfg.quantity > 0 ? { enabled: true, vendor: appendCfg.vendor, serviceId: appendCfg.serviceId, quantity: appendCfg.quantity } : undefined,
          mode: d.submitMode, startDate: d.submitMode === "average" ? d.scheduleStartDate : undefined, endDate: d.submitMode === "average" ? d.scheduleEndDate : undefined, batches,
        };
      }),
      totalAmount: c.total,
    };
  };

  const submitViaBackend = async (payload: ReturnType<typeof buildPayload>) => {
    await flushAllSharedState();
    const response = await fetch(apiUrl("/api/vendor/submit-order"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const contentType = response.headers.get("content-type") || "";
    const raw = await response.text();
    if (!contentType.includes("application/json")) throw new Error("目前此頁尚未接上共享後端，請先啟動本機 shared-api 服務。");
    const data = JSON.parse(raw) as { ok?: boolean; error?: string; order?: DemoOrder; summary?: { successCount?: number; failureCount?: number } };
    if (!response.ok || !data.ok || !data.order) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  };

  const onConfirmSubmit = async () => {
    setSubmitError(null);
    const payloads = activeIndexes.map((i) => buildPayload(drafts[i], computed[i]));
    if (payloads.some((p) => p.lines.some((l) => l.splits.length === 0))) return setSubmitError("有投放項目尚未完成系統設定，請先到控制設定調整後再送出。");
    setSubmitting(true);
    try {
      let created = 0; let successCount = 0; let failureCount = 0;
      if (window.location.origin.startsWith("http")) {
        for (const payload of payloads) { const data = await submitViaBackend(payload); insertOrder(data.order); created += 1; successCount += Number(data.summary?.successCount ?? 0); failureCount += Number(data.summary?.failureCount ?? 0); }
      } else {
        for (const payload of payloads) { addOrder({ ...payload, status: "planned" }); created += 1; }
      }
      setSubmittedSummary(failureCount > 0 ? `已送出 ${created} 筆訂單，成功分單 ${successCount} 筆，另有 ${failureCount} 筆需管理員處理。` : `已送出 ${created} 筆訂單，系統正在處理。`);
      setStep("submitted");
    } catch (error) {
      setSubmitError(`送出失敗：${error instanceof Error ? error.message : "未知錯誤"}`);
    } finally { setSubmitting(false); }
  };

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand"><div className="brand-title">{step === "edit" ? "廠商互動下單" : step === "confirm" ? "確認送出" : "已送出"}</div><div className="brand-sub">填寫需求、確認資料、送出後追蹤進度。</div></div>
        <div className="pill">
          <span className="tag">{user?.displayName ?? user?.username}</span>
          <button className="btn primary" onClick={() => nav("/ad-orders")}>廠商互動下單</button>
          {canManage ? <button className="btn" onClick={() => nav("/meta-ads-orders")}>Meta官方投廣</button> : null}
          <button className="btn" onClick={() => nav("/ad-performance")}>投放成效</button>
          {canManage ? <button className="btn" onClick={() => nav("/settings")}>控制設定</button> : null}
          <button className="btn danger" onClick={() => { signOut(); nav("/login", { replace: true }); }}>登出</button>
        </div>
      </div>

      {step === "edit" ? (
        <div className="card"><div className="card-hd"><div><div className="card-title">訂單清單</div><div className="card-desc">一次可建立多筆完整訂單，送出時會逐筆建立。</div></div><button className="btn primary" onClick={addDraft}>新增一筆完整訂單</button></div><div className="card-bd">
          {submitError ? <div className="error" style={{ marginBottom: 10 }}>{submitError}</div> : null}
          <div className="list">{drafts.map((draft, i) => { const e = errors[i] ?? {}; const c = computed[i]; return <div className="item" key={draft.id}><div className="item-hd"><div className="item-title">訂單 {i + 1}</div><button className="btn danger" onClick={() => removeDraft(i)} disabled={drafts.length <= 1}>刪除此訂單</button></div>
            <div className="row cols2">
              <div className="field"><div className="label">申請人<span className="req">*</span></div><input value={draft.applicant} onChange={(ev) => updateDraft(i, (x) => ({ ...x, applicant: ev.target.value }))} />{e.applicant ? <div className="error">{e.applicant}</div> : null}</div>
              <div className="field"><div className="label">日期</div><input value={nowString()} readOnly /></div>
              <div className="field"><div className="label">委刊單號<span className="req">*</span></div><input value={draft.orderNo} onChange={(ev) => updateDraft(i, (x) => ({ ...x, orderNo: ev.target.value }))} />{e.orderNo ? <div className="error">{e.orderNo}</div> : null}</div>
              <div className="field"><div className="label">案件名稱<span className="req">*</span></div><input value={draft.caseName} onChange={(ev) => updateDraft(i, (x) => ({ ...x, caseName: ev.target.value }))} />{e.caseName ? <div className="error">{e.caseName}</div> : null}</div>
              <div className="field"><div className="label">種類</div><select value={draft.kind} onChange={(ev) => updateDraft(i, (x) => ({ ...x, kind: ev.target.value as OrderKind }))}><option value="new">新案</option><option value="upsell">加購</option></select></div>
              <div className="field"><div className="label">下單方式</div><select value={draft.submitMode} onChange={(ev) => updateDraft(i, (x) => ({ ...x, submitMode: ev.target.value as OrderSubmitMode }))}><option value="instant">預設</option><option value="average">平均</option></select></div>
              {draft.submitMode === "average" ? <><div className="field"><div className="label">起始日</div><input type="date" value={draft.scheduleStartDate} onChange={(ev) => updateDraft(i, (x) => ({ ...x, scheduleStartDate: ev.target.value }))} />{e.scheduleStartDate ? <div className="error">{e.scheduleStartDate}</div> : null}</div><div className="field"><div className="label">結束日</div><input type="date" value={draft.scheduleEndDate} onChange={(ev) => updateDraft(i, (x) => ({ ...x, scheduleEndDate: ev.target.value }))} />{e.scheduleEndDate ? <div className="error">{e.scheduleEndDate}</div> : null}</div></> : null}
              <div className="field" style={{ gridColumn: "1 / -1" }}><div className="label">連結<span className="req">*</span></div><input value={draft.linksRaw} onChange={(ev) => updateDraft(i, (x) => ({ ...x, linksRaw: ev.target.value }))} placeholder="https://..." /><div className="hint">一次只能填 1 個連結。</div>{e.linksRaw ? <div className="error">{e.linksRaw}</div> : null}</div>
            </div>
            <div className="sep" />
            <div className="item-hd"><div className="item-title">投放項目</div><button className="btn" onClick={() => addLine(i)} disabled={!enabledPlacements.length}>新增投放項目</button></div>
            <div className="list">{draft.items.map((item, li) => { const min = getPlacementMinUnit(item.placement); const q = Number(item.target); const amount = Number.isFinite(q) && q > 0 ? calcInternalLineAmount(item.placement, q) : 0; const le = e.items?.[li]; return <div className="item" key={`${draft.id}-${li}`}><div className="item-hd"><div className="item-title">投放項目 {li + 1}</div><button className="btn danger" disabled={draft.items.length <= 1} onClick={() => removeLine(i, li)}>移除</button></div><div className="row cols3"><div className="field"><div className="label">平台 / 項目</div><select value={item.placement} onChange={(ev) => updateDraft(i, (x) => ({ ...x, items: x.items.map((it, idx) => idx === li ? { ...it, placement: ev.target.value as AdPlacement, target: String(getPlacementMinUnit(ev.target.value as AdPlacement)) } : it) }))}>{enabledPlacements.map((p) => <option key={p.placement} value={p.placement}>{p.label}</option>)}</select>{le?.placement ? <div className="error">{le.placement}</div> : null}</div><div className="field"><div className="label">目標數量</div><input inputMode="numeric" value={item.target} onChange={(ev) => updateDraft(i, (x) => ({ ...x, items: x.items.map((it, idx) => idx === li ? { ...it, target: ev.target.value } : it) }))} /><div className="hint">最小單位：{min.toLocaleString("zh-TW")}</div>{le?.target ? <div className="error">{le.target}</div> : null}</div><div className="field"><div className="label">預估金額</div><input readOnly value={showPrices ? `NT$ ${amount.toLocaleString("zh-TW")}` : "依設定隱藏"} /></div></div></div>; })}</div>
            <div className="kpi"><div className="hint">此筆訂單預估總金額</div><div style={{ fontWeight: 800 }}>{showPrices ? `NT$ ${c.total.toLocaleString("zh-TW")}` : "依設定隱藏"}</div></div>
          </div>; })}</div>
          <div className="sep" />
          <div className="kpi"><div className="hint">全部訂單預估總金額</div><div style={{ fontWeight: 800, fontSize: 18 }}>{showPrices ? `NT$ ${totalAll.toLocaleString("zh-TW")}` : "依設定隱藏"}</div></div>
          <div className="actions"><button className="btn primary" onClick={goConfirm}>下一步：確認</button></div>
        </div></div>
      ) : null}

      {step === "confirm" ? (
        <div className="card"><div className="card-hd"><div><div className="card-title">確認資料</div><div className="card-desc">確認後會逐筆建立訂單。</div></div></div><div className="card-bd">
          <div className="list">{activeIndexes.map((idx, no) => { const d = drafts[idx]; const c = computed[idx]; return <div className="item" key={`cf-${d.id}`}><div className="item-hd"><div className="item-title">訂單 {no + 1}</div><div style={{ fontWeight: 800 }}>{showPrices ? `NT$ ${c.total.toLocaleString("zh-TW")}` : "依設定隱藏"}</div></div><div className="hint">{d.applicant} / {d.orderNo} / {d.caseName}</div><div className="hint">{d.submitMode === "average" ? `${d.scheduleStartDate} ~ ${d.scheduleEndDate}` : "一次送出"}</div><div className="hint" style={{ marginTop: 6 }}>{parseLinks(d.linksRaw)[0]}</div><div className="sep" />{d.items.map((item, li) => { const q = Number(item.target); return <div className="hint" key={`i-${d.id}-${li}`}>{getPlacementLabel(item.placement)} / 數量 {Number.isFinite(q) ? q.toLocaleString("zh-TW") : "-"}</div>; })}</div>; })}</div>
          <div className="sep" />
          <div className="kpi"><div className="hint">全部訂單預估總金額</div><div style={{ fontWeight: 800, fontSize: 18 }}>{showPrices ? `NT$ ${totalAll.toLocaleString("zh-TW")}` : "依設定隱藏"}</div></div>
          <div className="actions"><button className="btn" onClick={() => setStep("edit")}>返回修改</button><button className="btn primary" onClick={() => void onConfirmSubmit()} disabled={submitting}>{submitting ? "送出中..." : "確認送出"}</button></div>
          {submitError ? <div className="error" style={{ marginTop: 8 }}>{submitError}</div> : null}
        </div></div>
      ) : null}

      {step === "submitted" ? (
        <div className="card"><div className="card-hd"><div><div className="card-title">已送出</div><div className="card-desc">送出後可到投放成效查看最新狀態。</div></div></div><div className="card-bd"><div className="hint">{submittedSummary}</div><div className="sep" /><div className="actions"><button className="btn" onClick={() => { setDrafts([makeDraft(defaultPlacement, applicantDefault)]); setErrors([]); setSubmitError(null); setStep("edit"); }}>再建一批訂單</button><button className="btn primary" onClick={() => nav("/ad-performance")}>前往投放成效</button></div></div></div>
      ) : null}
    </div>
  );
}
