import { useMemo, useRef, useState, type ChangeEventHandler } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ServicePicker } from "../components/ServicePicker";
import { CollapsibleCard } from "../components/CollapsibleCard";
import { MetaSettingsCard } from "../components/MetaSettingsCard";
import {
  DEFAULT_CONFIG,
  getConfig,
  resetConfig,
  saveConfig,
  type AppConfigV1,
  type SupplierConfig,
  type VendorKey,
} from "../config/appConfig";
import { clearVendorKey, getVendorKey, setVendorKey } from "../config/vendorKeys";
import { clearVendorServices, findServiceName, getVendorServices, importVendorServicesJson, type VendorService } from "../config/serviceCatalog";
import { getMetaConfig } from "../config/metaConfig";
import { PRICING, type AdPlacement } from "../lib/pricing";
import { getPlacementPrice, getPricingConfig, savePricingConfig } from "../config/pricingConfig";
import { createDemoSnapshot, parseDemoSnapshot, restoreDemoSnapshot } from "../lib/demoState";
import { planSplit } from "../lib/split";
import { calcInternalLineAmount } from "../lib/internalPricing";

function placementLabel(p: AdPlacement) {
  return PRICING[p]?.label ?? p;
}

function vendorLabel(key: VendorKey) {
  return DEFAULT_CONFIG.vendors.find((v) => v.key === key)?.label ?? key;
}

const ALL_VENDORS: VendorKey[] = ["smmraja", "urpanel", "justanotherpanel"];

type MsgKind = "success" | "info" | "warn" | "error";

export function SettingsPage() {
  const nav = useNavigate();
  const { user, signOut } = useAuth();

  const [cfg, setCfg] = useState<AppConfigV1>(() => getConfig());
  const [msg, setMsg] = useState<{ kind: MsgKind; text: string } | null>(null);
  const msgTimer = useRef<number | null>(null);
  const backupFileRef = useRef<HTMLInputElement | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [keys, setKeys] = useState<Record<VendorKey, string>>(() => ({
    smmraja: getVendorKey("smmraja"),
    urpanel: getVendorKey("urpanel"),
    justanotherpanel: getVendorKey("justanotherpanel"),
  }));
  const [pricingCfg, setPricingCfg] = useState(() => getPricingConfig());
  const [quotePlacement, setQuotePlacement] = useState<AdPlacement>("fb_like");
  const [quoteQty, setQuoteQty] = useState<string>("2000");
  const [costPlacement, setCostPlacement] = useState<AdPlacement>("fb_like");
  const [costQty, setCostQty] = useState<string>("2000");
  const [sampleQty, setSampleQty] = useState<string>("2000");
  const metaCfg = getMetaConfig();

  const vendorKeys = useMemo(() => cfg.vendors.map((v) => v.key), [cfg.vendors]);
  const loadedVendorCount = useMemo(
    () => cfg.vendors.filter((v) => getVendorServices(v.key).length > 0).length,
    [cfg.vendors, msg],
  );
  const configuredPlacementCount = useMemo(
    () =>
      cfg.placements.filter((p) =>
        p.suppliers.some((s) => s.enabled && Number.isFinite(s.serviceId) && s.serviceId > 0),
      ).length,
    [cfg.placements],
  );
  const metaReady = !!metaCfg.adAccountId && !!metaCfg.pageId;

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const setPlacementSuppliers = (placement: AdPlacement, nextSuppliers: SupplierConfig[]) => {
    setCfg((c) => {
      const placements: AppConfigV1["placements"] = c.placements.some((p) => p.placement === placement)
        ? c.placements.map((p) => (p.placement === placement ? { ...p, suppliers: nextSuppliers } : p))
        : [...c.placements, { placement, splitStrategy: "random" as const, suppliers: nextSuppliers }];
      return { ...c, placements };
    });
  };

  const setPlacementStrategy = (placement: AdPlacement, next: "random" | "weighted") => {
    setCfg((c) => {
      const placements: AppConfigV1["placements"] = c.placements.some((p) => p.placement === placement)
        ? c.placements.map((p) => (p.placement === placement ? { ...p, splitStrategy: next } : p))
        : [...c.placements, { placement, splitStrategy: next, suppliers: [] }];
      return { ...c, placements };
    });
  };

  const flashMsg = (kind: MsgKind, text: string, ms = 2500) => {
    setMsg({ kind, text });
    if (msgTimer.current != null) window.clearTimeout(msgTimer.current);
    msgTimer.current = window.setTimeout(() => setMsg(null), ms);
  };

  const save = () => {
    saveConfig(cfg);
    setCfg(getConfig());
    const t = new Date().toLocaleTimeString("zh-TW", { hour12: false });
    flashMsg("success", `已儲存（${t}）。`, 3000);
  };

  const doReset = () => {
    resetConfig();
    setCfg(getConfig());
    flashMsg("info", "已重設為預設值。", 3000);
  };

  const loadServicesFromSite = async (vendor: VendorKey, opts?: { silent?: boolean }) => {
    try {
      const res = await fetch(`./services/${vendor}.json`, { cache: "no-store" });
      if (!res.ok) {
        if (!opts?.silent) {
          flashMsg("error", `載入 ${vendorLabel(vendor)} 服務清單失敗：HTTP ${res.status}（可能尚未產生檔案）`, 4500);
        }
        return;
      }
      const json = await res.json();
      // Reuse schema/normalization through the existing importer.
      const r = importVendorServicesJson(vendor, JSON.stringify(json));
      if (!r.ok) {
        if (!opts?.silent) {
          flashMsg("error", r.message ?? `載入 ${vendorLabel(vendor)} 後解析失敗`, 4500);
        }
        return;
      }
      if (!opts?.silent) {
        flashMsg("success", `已載入 ${vendorLabel(vendor)} 服務清單：${(r.count ?? 0).toLocaleString()} 筆`, 3000);
      }
    } catch {
      if (!opts?.silent) {
        flashMsg("error", `載入 ${vendorLabel(vendor)} 服務清單失敗：網路錯誤`, 4500);
      }
    }
  };

  const loadAllServicesFromSite = async () => {
    let ok = 0;
    for (const v of ALL_VENDORS) {
      // eslint-disable-next-line no-await-in-loop
      await loadServicesFromSite(v, { silent: true });
      if (getVendorServices(v).length > 0) ok += 1;
    }
    flashMsg("info", `已嘗試載入全部服務清單（成功 ${ok}/${ALL_VENDORS.length} 家）。`, 3500);
  };

  const updatePricing = (patch: Partial<typeof pricingCfg>) => {
    const next = { ...pricingCfg, ...patch };
    savePricingConfig(next);
    setPricingCfg(getPricingConfig());
  };

  const setPrice = (placement: AdPlacement, price: number) => {
    const n = Number(price);
    if (!Number.isFinite(n) || n < 0) return;
    const next = { ...pricingCfg, prices: { ...pricingCfg.prices, [placement]: n } };
    savePricingConfig(next);
    setPricingCfg(getPricingConfig());
  };

  const downloadSnapshot = (includeSecrets: boolean) => {
    const snapshot = createDemoSnapshot({ includeSecrets });
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.href = url;
    a.download = includeSecrets ? `ad-demo-full-backup-${stamp}.json` : `ad-demo-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
    flashMsg(
      "success",
      includeSecrets ? "完整備份已下載，檔案內含 API Key 與 Token，請離線妥善保存。" : "一般備份已下載，可用於換機或交接。",
      4200,
    );
  };

  const importSnapshot = async (file: File) => {
    const text = await file.text();
    const parsed = parseDemoSnapshot(text);
    if (!parsed.ok) {
      flashMsg("error", parsed.message, 4000);
      return;
    }
    restoreDemoSnapshot(parsed.snapshot);
    setCfg(getConfig());
    setPricingCfg(getPricingConfig());
    setKeys({
      smmraja: getVendorKey("smmraja"),
      urpanel: getVendorKey("urpanel"),
      justanotherpanel: getVendorKey("justanotherpanel"),
    });
    flashMsg(
      "success",
      parsed.snapshot.includesSecrets
        ? "備份已匯入，設定、案件與密鑰都已還原。建議重新整理其他已開啟頁面。"
        : "備份已匯入，設定與案件資料已還原。密鑰與 Token 維持目前瀏覽器的內容。",
      4500,
    );
  };

  const onImportFile: ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await importSnapshot(file);
    } catch {
      flashMsg("error", "匯入備份失敗，請確認檔案是否完整。", 4000);
    } finally {
      e.target.value = "";
    }
  };

  const getServiceMeta = (vendor: VendorKey, serviceId: number): VendorService | null => {
    if (!serviceId) return null;
    const hit = getVendorServices(vendor).find((s) => s.id === serviceId);
    return hit ?? null;
  };

  const calcVendorEstimatedCost = (vendor: VendorKey, serviceId: number, qty: number): number | null => {
    const meta = getServiceMeta(vendor, serviceId);
    if (!meta || meta.rate == null) return null;
    return (qty / 1000) * meta.rate;
  };

  return (
    <div className="container settings-page">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">控制設定</div>
          <div className="brand-sub">設定定價、拆單、供應商服務清單與 Meta 投放參數。</div>
        </div>
        <div className="pill">
          <span className="tag">{user?.displayName ?? user?.username}</span>
          <button className="btn" onClick={() => nav("/ad-orders")}>
            廠商互動下單
          </button>
          <button className="btn" onClick={() => nav("/meta-ads-orders")}>
            Meta官方投廣
          </button>
          <button className="btn" onClick={() => nav("/ad-performance")}>
            投放成效
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

      {msg && (
        <div className={`toast toast-${msg.kind}`} role="status" aria-live="polite">
          <div className="toast-text">{msg.text}</div>
          <button className="btn ghost sm" type="button" onClick={() => setMsg(null)}>
            關閉
          </button>
        </div>
      )}

        <div className="grid">
          <div className="card settings-setup">
          <div className="card-hd">
            <div>
              <div className="card-title">快速設定導引</div>
              <div className="card-desc">照順序完成 4 個步驟即可。</div>
            </div>
          </div>
          <div className="card-bd">
            <div className="setup-grid">
              <button className="setup-step" type="button" onClick={() => jump("settings-meta")}>
                <div className="setup-title">1. Meta 投放設定</div>
                <div className={`setup-status ${metaReady ? "ok" : "pending"}`}>
                  {metaReady ? "已完成" : "未完成"}
                </div>
              </button>
              <button className="setup-step" type="button" onClick={() => jump("settings-vendors")}>
                <div className="setup-title">2. 載入供應商服務</div>
                <div className={`setup-status ${loadedVendorCount > 0 ? "ok" : "pending"}`}>
                  {loadedVendorCount > 0 ? `已載入 ${loadedVendorCount} 家` : "尚未載入"}
                </div>
              </button>
              <button className="setup-step" type="button" onClick={() => jump("settings-routing")}>
                <div className="setup-title">3. 設定拆單對應</div>
                <div className={`setup-status ${configuredPlacementCount > 0 ? "ok" : "pending"}`}>
                  {configuredPlacementCount > 0 ? `已設定 ${configuredPlacementCount} 個品項` : "尚未設定"}
                </div>
              </button>
              <button className="setup-step" type="button" onClick={() => jump("settings-pricing")}>
                <div className="setup-title">4. 設定下單定價</div>
                <div className="setup-status ok">可調整</div>
              </button>
            </div>
            <div className="actions inline" style={{ marginTop: 10 }}>
              <button className="btn" type="button" onClick={save}>
                儲存拆單與供應商設定
              </button>
              <button className="btn" type="button" onClick={loadAllServicesFromSite}>
                載入全部服務清單
              </button>
              <button className="btn danger" type="button" onClick={doReset}>
                重設拆單與供應商
              </button>
            </div>
          </div>
        </div>

        <CollapsibleCard
          accent="green"
          title="資料備份與交接"
          desc="目前 demo 版資料保存在本機瀏覽器。若要換電腦、換瀏覽器或交接，請先下載備份。"
          tag="備份"
          storageKey="sec:backup"
          defaultOpen
        >
          <input ref={backupFileRef} type="file" accept="application/json,.json" hidden onChange={onImportFile} />

          <div className="hint">
            一般備份：包含案件、拆單設定、價格與服務清單，不含 API Key 與 Meta Token。
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            完整備份：額外包含供應商 API Key 與 Meta Token，只限管理者離線保存，不建議用 Email 或群組傳送。
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            匯入備份後，其他已開啟頁面不會自動刷新，建議重新整理一次。
          </div>

          <div className="actions inline" style={{ marginTop: 12 }}>
            <button className="btn" type="button" onClick={() => downloadSnapshot(false)}>
              下載一般備份
            </button>
            <button className="btn" type="button" onClick={() => downloadSnapshot(true)}>
              下載完整備份
            </button>
            <button className="btn primary" type="button" onClick={() => backupFileRef.current?.click()}>
              匯入備份
            </button>
          </div>
        </CollapsibleCard>

        <div id="settings-meta">
          <MetaSettingsCard onNotice={flashMsg} />
        </div>

        <div id="settings-pricing">
          <CollapsibleCard
          accent="blue"
          title="定價設定"
          desc="管理下單頁顯示的預估金額。"
          tag="定價"
          storageKey="sec:pricing"
          defaultOpen={false}
        >
            <div className="dense-toolbar">
              <div className="field">
                <div className="label">前台顯示價格</div>
                <select
                  value={pricingCfg.showPrices ? "on" : "off"}
                  onChange={(e) => updatePricing({ showPrices: e.target.value === "on" })}
                >
                  <option value="on">顯示</option>
                  <option value="off">隱藏</option>
                </select>
                <div className="hint">隱藏後，下單頁仍可下單，但不顯示金額。</div>
              </div>

              <div className="field">
                <div className="label">示例數量</div>
                <input value={sampleQty} inputMode="numeric" onChange={(e) => setSampleQty(e.target.value)} />
                <div className="hint">用於下方「示例金額」。</div>
              </div>
            </div>

            <div className="sep" />

          <div className="dense-table">
              <div className="dense-th">品項</div>
              <div className="dense-th">最小單位</div>
              <div className="dense-th">內部單價（NT$ / 最小單位）</div>
              <div className="dense-th">示例金額</div>

              {(Object.keys(PRICING) as AdPlacement[]).map((p) => {
                const rule = PRICING[p];
                const pricePerMinUnit = getPlacementPrice(p);
                const qty = Number(sampleQty);
                const sampleOk = Number.isFinite(qty) && qty > 0;
                const sampleAmt = sampleOk ? calcInternalLineAmount(p, qty) : 0;
                return (
                  <div className="dense-tr" key={p}>
                    <div className="dense-td dense-main">
                      <div className="dense-title">{rule.label}</div>
                      <div className="dense-meta">{p}</div>
                    </div>
                    <div className="dense-td">
                      <span className="tag">{rule.minUnit.toLocaleString()}</span>
                    </div>
                    <div className="dense-td">
                      <input
                        className="dense-input"
                        value={String(pricePerMinUnit)}
                        inputMode="numeric"
                        onChange={(e) => setPrice(p, Number(e.target.value))}
                      />
                    </div>
                    <div className="dense-td">
                      <div className="dense-title">
                        {sampleOk ? `NT$ ${sampleAmt.toLocaleString()}` : "-"}
                      </div>
                      <div className="dense-meta">{sampleOk ? `數量 ${qty.toLocaleString()}` : "數量無效"}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <details className="dense-details">
              <summary className="dense-summary">金額試算</summary>
              <div className="dense-panel">
                <div className="dense-toolbar" style={{ marginTop: 10 }}>
                  <div className="field">
                    <div className="label">品項</div>
                    <select value={quotePlacement} onChange={(e) => setQuotePlacement(e.target.value as AdPlacement)}>
                      {(Object.keys(PRICING) as AdPlacement[]).map((p) => (
                        <option key={p} value={p}>
                          {PRICING[p].label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <div className="label">數量</div>
                    <input value={quoteQty} inputMode="numeric" onChange={(e) => setQuoteQty(e.target.value)} />
                  </div>
                  <div className="field">
                    <div className="label">內部預估金額</div>
                    {(() => {
                      const qty = Number(quoteQty);
                      const ok = Number.isFinite(qty) && qty > 0;
                      return (
                        <input
                          value={ok ? `NT$ ${calcInternalLineAmount(quotePlacement, qty).toLocaleString()}` : "-"}
                          readOnly
                        />
                      );
                    })()}
                  </div>
                </div>
                <div className="hint" style={{ marginTop: 8 }}>
                  此處僅計算下單頁顯示金額。
                </div>
              </div>
            </details>
          </CollapsibleCard>
        </div>

        <div id="settings-cost">
          <CollapsibleCard
          accent="green"
          title="供應商成本試算"
          desc="依服務編號與配比估算供應商採購成本。"
          tag="成本"
          storageKey="sec:vendor-cost"
          defaultOpen={false}
        >
            <div className="dense-toolbar">
              <div className="field">
                <div className="label">品項</div>
                <select value={costPlacement} onChange={(e) => setCostPlacement(e.target.value as AdPlacement)}>
                  {(Object.keys(PRICING) as AdPlacement[]).map((p) => (
                    <option key={p} value={p}>
                      {PRICING[p].label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <div className="label">數量</div>
                <input value={costQty} inputMode="numeric" onChange={(e) => setCostQty(e.target.value)} />
                {(() => {
                  const qty = Number(costQty);
                  const minUnit = PRICING[costPlacement].minUnit;
                  if (!Number.isFinite(qty) || qty <= 0) return <div className="hint">請輸入正整數數量。</div>;
                  if (qty % minUnit !== 0) return <div className="hint">提醒：數量建議為 {minUnit.toLocaleString()} 的倍數。</div>;
                  return null;
                })()}
              </div>
            </div>

            <div className="sep" />

            {(() => {
              const qty = Number(costQty);
              if (!Number.isFinite(qty) || qty <= 0) return <div className="hint">請輸入正整數數量。</div>;
              const pCfg = cfg.placements.find((p) => p.placement === costPlacement);
              const strategy = pCfg?.splitStrategy ?? "random";
              const suppliers = (pCfg?.suppliers ?? []).filter((s) => s.enabled);
              const vendorEnabled = (v: VendorKey) => cfg.vendors.some((x) => x.key === v && x.enabled);
              const plan = planSplit({ total: qty, suppliers, vendorEnabled, strategy });
              if (plan.splits.length === 0) return <div className="hint">尚未設定可用的服務編號（serviceId）（或全部停用），無法試算成本。</div>;

              const rows = plan.splits.map((s) => {
                const meta = getServiceMeta(s.vendor, s.serviceId);
                const vendorCost = calcVendorEstimatedCost(s.vendor, s.serviceId, s.quantity);
                return { s, meta, vendorCost };
              });

              const anyMissingRate = rows.some((r) => r.vendorCost == null);
              const totalCost = anyMissingRate ? null : rows.reduce((a, r) => a + (r.vendorCost ?? 0), 0);

              return (
                <>
                  <div className="kpi" style={{ paddingTop: 0 }}>
                    <div className="hint">拆單方式</div>
                    <div style={{ fontWeight: 800 }}>{strategy === "random" ? "隨機" : "按配比"}</div>
                  </div>

                  <div className="kpi" style={{ paddingTop: 6 }}>
                    <div className="hint">成本合計（估算）</div>
                    <div style={{ fontWeight: 800, fontSize: 18 }}>{totalCost == null ? "-" : totalCost.toFixed(4)}</div>
                  </div>

                  {anyMissingRate && (
                    <div className="hint" style={{ marginTop: 8, color: "rgba(245, 158, 11, 0.95)" }}>
                      部分服務缺少報價（rate），無法計算完整總成本（請先載入服務清單或更換項目）。
                    </div>
                  )}

                  <div className="dense-table" style={{ marginTop: 10 }}>
                    <div className="dense-th">供應商</div>
                    <div className="dense-th">服務</div>
                    <div className="dense-th">數量</div>
                    <div className="dense-th">成本（估算）</div>

                    {rows.map((r) => {
                      const s = r.s;
                      const meta = r.meta;
                      const vendorCost = r.vendorCost;
                      return (
                        <div className="dense-tr" key={`${s.vendor}-${s.serviceId}`}>
                          <div className="dense-td dense-main">
                            <div className="dense-title">{vendorLabel(s.vendor)}</div>
                            <div className="dense-meta">服務編號（serviceId）{s.serviceId}</div>
                          </div>
                          <div className="dense-td">
                            <div className="dense-title">{meta?.name ?? findServiceName(s.vendor, s.serviceId) ?? "-"}</div>
                            <div className="dense-meta">
                              {meta?.rate != null ? `報價（rate）=${meta.rate}` : "報價（rate）=-"}
                              {meta?.min != null ? ` / 最小=${meta.min}` : ""}
                              {meta?.max != null ? ` / 最大=${meta.max}` : ""}
                            </div>
                          </div>
                          <div className="dense-td">
                            <div className="dense-title">{s.quantity.toLocaleString()}</div>
                          </div>
                          <div className="dense-td">
                            <div className="dense-title">{vendorCost == null ? "-" : vendorCost.toFixed(4)}</div>
                            <div className="dense-meta">通常報價為每 1000 單位（以供應商文件為準）</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {plan.warnings.length > 0 && (
                    <div className="hint" style={{ marginTop: 8, color: "rgba(245, 158, 11, 0.95)" }}>
                      {plan.warnings.join(" / ")}
                    </div>
                  )}
                </>
              );
            })()}
          </CollapsibleCard>
        </div>

        <div id="settings-vendors">
          <CollapsibleCard
          accent="amber"
          title="供應商與服務清單"
          desc="管理供應商狀態、服務清單與 API 金鑰。"
          tag="供應商"
          storageKey="sec:vendors"
          defaultOpen
          actions={
            <>
              <button className="btn" type="button" onClick={loadAllServicesFromSite}>
                載入全部服務清單
              </button>
              <button className="btn" type="button" onClick={() => setShowKeys((x) => !x)}>
                {showKeys ? "隱藏 API 金鑰" : "顯示 API 金鑰"}
              </button>
            </>
          }
        >
            <div className="hint" style={{ marginBottom: 10 }}>
              這裡輸入的供應商 API Key 只會保存在目前瀏覽器。若要換電腦，請使用上方「完整備份」。
            </div>
            <div className="list">
              {cfg.vendors.map((v, idx) => (
                <div className="item" key={v.key}>
                  <div className="item-hd">
                    <div className="item-title">{v.label}</div>
                    <span className="tag">{v.key}</span>
                  </div>

                  <div className="row cols4">
                    <div className="field">
                      <div className="label">啟用</div>
                      <select
                        value={v.enabled ? "on" : "off"}
                        onChange={(e) =>
                          setCfg((c) => ({
                            ...c,
                            vendors: c.vendors.map((x, i) =>
                              i === idx ? { ...x, enabled: e.target.value === "on" } : x,
                            ),
                          }))
                        }
                      >
                        <option value="on">啟用</option>
                        <option value="off">停用</option>
                      </select>
                    </div>

                    <div className="field" style={{ gridColumn: "2 / -1" }}>
                      <div className="label">API 入口網址</div>
                      <input
                        value={v.apiBaseUrl}
                        onChange={(e) =>
                          setCfg((c) => ({
                            ...c,
                            vendors: c.vendors.map((x, i) => (i === idx ? { ...x, apiBaseUrl: e.target.value } : x)),
                          }))
                        }
                      />
                      <div className="hint">請填入供應商提供的 API 網址。</div>
                    </div>
                  </div>

                  {showKeys && (
                    <div className="row cols2" style={{ marginTop: 10 }}>
                      <div className="field">
                        <div className="label">API 金鑰</div>
                        <input
                          type="password"
                          value={keys[v.key]}
                          onChange={(e) => {
                            const next = e.target.value;
                            setKeys((k) => ({ ...k, [v.key]: next }));
                            setVendorKey(v.key, next);
                          }}
                          placeholder="貼上供應商 API 金鑰"
                        />
                        <div className="hint">金鑰僅儲存在這台裝置。</div>
                      </div>
                      <div className="field">
                        <div className="label">操作</div>
                        <div className="actions inline">
                          <button
                            className="btn danger"
                            type="button"
                            onClick={() => {
                              clearVendorKey(v.key);
                              setKeys((k) => ({ ...k, [v.key]: "" }));
                              flashMsg("info", `已清除 ${vendorLabel(v.key)} API 金鑰。`, 3000);
                            }}
                          >
                            清除金鑰
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="actions inline" style={{ justifyContent: "space-between" }}>
                    <div className="hint">
                      服務清單：{getVendorServices(v.key).length.toLocaleString()} 筆
                    </div>
                    <div className="btn-group">
                      <button className="btn" type="button" onClick={() => loadServicesFromSite(v.key)}>
                        從網站載入清單
                      </button>
                      <button
                        className="btn danger"
                        type="button"
                        onClick={() => {
                          clearVendorServices(v.key);
                          flashMsg("info", `已清空 ${vendorLabel(v.key)} 服務清單。`, 3000);
                        }}
                      >
                        清空本機清單
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="sep" />
            <div className="actions inline">
              <button className="btn" type="button" onClick={doReset}>
                重設預設值
              </button>
              <button className="btn primary" type="button" onClick={save}>
                儲存
              </button>
            </div>
          </CollapsibleCard>
        </div>

        <div id="settings-routing">
          <CollapsibleCard
          accent="slate"
          title="品項對應"
          desc="可設定隨機拆單或按配比分配。"
          tag="拆單"
          storageKey="sec:routing"
          defaultOpen
        >
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>設定說明</summary>
              <div className="hint" style={{ marginTop: 10 }}>
                1. 服務編號來自供應商服務清單，可隨時調整。
                <br />
                2. 隨機：每次拆單結果可能不同。
                <br />
                3. 按配比：數字越大分到越多。
              </div>
            </details>

            <div className="sep" />

            <div className="list">
              {(Object.keys(PRICING) as AdPlacement[]).map((placement) => {
                const placementCfg = cfg.placements.find((p) => p.placement === placement);
                const suppliers = placementCfg?.suppliers ?? [];
                const splitStrategy = placementCfg?.splitStrategy ?? "random";

                return (
                  <details className="item item-details" key={placement}>
                    <summary className="item-summary">
                      <div className="item-title">{placementLabel(placement)}</div>
                      <div
                        className="btn-group"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <span className="tag">{splitStrategy === "random" ? "隨機" : "按配比"}</span>
                        <select
                          value={splitStrategy}
                          onChange={(e) => setPlacementStrategy(placement, e.target.value as "random" | "weighted")}
                        >
                          <option value="random">隨機（預設）</option>
                          <option value="weighted">按配比（看配比欄位）</option>
                        </select>
                        <button
                          className="btn sm"
                          type="button"
                          onClick={() =>
                            setPlacementSuppliers(placement, [
                              ...suppliers,
                              { vendor: vendorKeys[0] ?? "smmraja", serviceId: 0, weight: 1, enabled: true },
                            ])
                          }
                        >
                          新增供應商
                        </button>
                      </div>
                    </summary>

                    {suppliers.length === 0 ? (
                      <div className="hint">尚未設定供應商。</div>
                    ) : (
                      <div className="dense-table suppliers-table">
                        <div className="dense-th">啟用</div>
                        <div className="dense-th">供應商</div>
                        <div className="dense-th">服務</div>
                        <div className="dense-th">配比</div>
                        <div className="dense-th">單次上限</div>
                        <div className="dense-th">操作</div>

                        {suppliers.map((s, idx) => {
                          const meta = getServiceMeta(s.vendor, s.serviceId);
                          const name = meta?.name ?? findServiceName(s.vendor, s.serviceId) ?? null;

                          return (
                            <div className="dense-tr" key={`${placement}-${idx}`}>
                              <div className="dense-td">
                                <select
                                  className="dense-input"
                                  value={s.enabled ? "on" : "off"}
                                  onChange={(e) =>
                                    setPlacementSuppliers(
                                      placement,
                                      suppliers.map((x, i) =>
                                        i === idx ? { ...x, enabled: e.target.value === "on" } : x,
                                      ),
                                    )
                                  }
                                >
                                  <option value="on">啟用</option>
                                  <option value="off">停用</option>
                                </select>
                              </div>

                              <div className="dense-td">
                                <select
                                  className="dense-input"
                                  value={s.vendor}
                                  onChange={(e) => {
                                    const v = e.target.value as VendorKey;
                                    setPlacementSuppliers(
                                      placement,
                                      suppliers.map((x, i) => (i === idx ? { ...x, vendor: v } : x)),
                                    );
                                  }}
                                >
                                  {vendorKeys.map((k) => (
                                    <option key={k} value={k}>
                                      {vendorLabel(k)}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="dense-td dense-main">
                                <div className="inline-fields">
                                  <input
                                    className="dense-input"
                                    value={String(s.serviceId)}
                                    inputMode="numeric"
                                    onChange={(e) => {
                                      const n = Number(e.target.value);
                                      setPlacementSuppliers(
                                        placement,
                                        suppliers.map((x, i) =>
                                          i === idx ? { ...x, serviceId: Number.isFinite(n) ? n : 0 } : x,
                                        ),
                                      );
                                    }}
                                    placeholder="服務編號"
                                  />
                                  <ServicePicker
                                    vendor={s.vendor}
                                    currentServiceId={s.serviceId}
                                    compact
                                    buttonLabel="挑選服務"
                                    buttonClassName="btn sm"
                                    onPick={(svc) => {
                                      setPlacementSuppliers(
                                        placement,
                                        suppliers.map((x, i) => (i === idx ? { ...x, serviceId: svc.id } : x)),
                                      );
                                    }}
                                  />
                                </div>
                                <div className="dense-meta">
                                  {name
                                    ? `已選：${name}`
                                    : s.serviceId > 0
                                      ? `服務編號（serviceId）${s.serviceId}（未在清單中）`
                                      : "未選擇"}
                                  {meta?.rate != null ? ` / 報價=${meta.rate}` : ""}
                                  {meta?.min != null ? ` / 最小=${meta.min}` : ""}
                                  {meta?.max != null ? ` / 最大=${meta.max}` : ""}
                                </div>
                              </div>

                              <div className="dense-td">
                                <input
                                  className="dense-input"
                                  value={splitStrategy === "weighted" ? String(s.weight) : "-"}
                                  inputMode="numeric"
                                  readOnly={splitStrategy !== "weighted"}
                                  onChange={(e) => {
                                    if (splitStrategy !== "weighted") return;
                                    const n = Number(e.target.value);
                                    setPlacementSuppliers(
                                      placement,
                                      suppliers.map((x, i) =>
                                        i === idx ? { ...x, weight: Number.isFinite(n) ? n : 0 } : x,
                                      ),
                                    );
                                  }}
                                  placeholder="例如 2"
                                />
                              </div>

                              <div className="dense-td">
                                <input
                                  className="dense-input"
                                  value={s.maxPerOrder == null ? "" : String(s.maxPerOrder)}
                                  inputMode="numeric"
                                  onChange={(e) => {
                                    const raw = e.target.value.trim();
                                    const cap = raw === "" ? undefined : Number(raw);
                                    setPlacementSuppliers(
                                      placement,
                                      suppliers.map((x, i) =>
                                        i === idx
                                          ? { ...x, maxPerOrder: cap != null && Number.isFinite(cap) ? cap : undefined }
                                          : x,
                                      ),
                                    );
                                  }}
                                  placeholder="留空=不限"
                                />
                              </div>

                              <div className="dense-td">
                                <div className="btn-group">
                                  <button
                                    className="btn danger sm"
                                    type="button"
                                    onClick={() => setPlacementSuppliers(placement, suppliers.filter((_, i) => i !== idx))}
                                  >
                                    刪除
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </details>
                );
              })}
            </div>

            <div className="sep" />
            <div className="actions inline">
              <button className="btn" type="button" onClick={doReset}>
                重設預設值
              </button>
              <button className="btn primary" type="button" onClick={save}>
                儲存
              </button>
            </div>
          </CollapsibleCard>
        </div>
      </div>
    </div>
  );
}
