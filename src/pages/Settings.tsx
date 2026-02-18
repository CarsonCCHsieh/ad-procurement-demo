import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ServicePicker } from "../components/ServicePicker";
import { CollapsibleCard } from "../components/CollapsibleCard";
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
import { PRICING, type AdPlacement } from "../lib/pricing";
import { getPlacementPrice, getPricingConfig, savePricingConfig } from "../config/pricingConfig";
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

  const vendorKeys = useMemo(() => cfg.vendors.map((v) => v.key), [cfg.vendors]);

  const setPlacementSuppliers = (placement: AdPlacement, nextSuppliers: SupplierConfig[]) => {
    setCfg((c) => {
      const placements = c.placements.some((p) => p.placement === placement)
        ? c.placements.map((p) => (p.placement === placement ? { ...p, suppliers: nextSuppliers } : p))
        : [...c.placements, { placement, splitStrategy: "random", suppliers: nextSuppliers }];
      return { ...c, placements };
    });
  };

  const setPlacementStrategy = (placement: AdPlacement, next: "random" | "weighted") => {
    setCfg((c) => {
      const placements = c.placements.some((p) => p.placement === placement)
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

  const getServiceMeta = (vendor: VendorKey, serviceId: number): VendorService | null => {
    if (!serviceId) return null;
    const hit = getVendorServices(vendor).find((s) => s.id === serviceId);
    return hit ?? null;
  };

  const calcVendorEstimatedCost = (vendor: VendorKey, serviceId: number, qty: number): number | null => {
    const meta = getServiceMeta(vendor, serviceId);
    if (!meta || meta.rate == null) return null;
    // Most SMM panels use rate = price per 1000 units.
    return (qty / 1000) * meta.rate;
  };

  return (
    <div className="container settings-page">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">控制設定</div>
          <div className="brand-sub">服務編號（serviceId）對應、拆單方式（隨機/按配比）、供應商服務清單載入與成本試算。</div>
        </div>
        <div className="pill">
          <span className="tag">{user?.displayName ?? user?.username}</span>
          <button className="btn" onClick={() => nav("/ad-orders")}>
            下單
          </button>
          <button className="btn" onClick={() => nav("/ad-performance")}>
            成效
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
        <CollapsibleCard
          accent="blue"
          title="定價設定（內部顯示）"
          desc="這裡管理「內部下單頁」顯示的預估金額（給同仁看）。供應商實際採購成本，請用下方成本試算。"
          tag="定價"
          storageKey="sec:pricing"
          defaultOpen
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
              <summary className="dense-summary">內部金額試算（前台顯示用）</summary>
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
                  這裡只計算「內部顯示金額」，不代表供應商實際採購成本。
                </div>
              </div>
            </details>
        </CollapsibleCard>

        <CollapsibleCard
          accent="green"
          title="供應商成本試算（公司成本）"
          desc="用你在「品項對應（拆單設定）」設定的服務編號（serviceId）與拆單配比，估算公司實際採購成本。"
          tag="成本"
          storageKey="sec:vendor-cost"
          defaultOpen
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

        <CollapsibleCard
          accent="amber"
          title="供應商與服務清單"
          desc="服務清單由 GitHub Actions（自動化）產生為靜態檔；這裡只做載入與清空。你不需要貼上 JSON。"
          tag="供應商"
          storageKey="sec:vendors"
          defaultOpen={false}
          actions={
            <>
              <button className="btn" type="button" onClick={loadAllServicesFromSite}>
                載入全部服務清單
              </button>
              <button className="btn" type="button" onClick={() => setShowKeys((x) => !x)}>
                {showKeys ? "隱藏 API 金鑰（僅測試）" : "顯示 API 金鑰（僅測試）"}
              </button>
            </>
          }
        >
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
                      <div className="hint">例如：SMM Raja 常見為 /api/v3；Urpanel/JustAnotherPanel 常見為 /api/v2（以文件為準）</div>
                    </div>
                  </div>

                  {showKeys && (
                    <div className="row cols2" style={{ marginTop: 10 }}>
                      <div className="field">
                        <div className="label">API 金鑰（僅測試，用於同步狀態）</div>
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
                        <div className="hint">正式環境不要放前端，建議由後端代打供應商 API。</div>
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
                              flashMsg("info", `已清除 ${vendorLabel(v.key)} API 金鑰（僅此瀏覽器）。`, 3000);
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

        <CollapsibleCard
          accent="slate"
          title="品項對應（拆單設定）"
          desc="拆單方式可選「隨機」或「按配比」。配比欄位填寫比例數字即可，不用填 %（例如 2 / 1 / 1 代表約 50% / 25% / 25%）。"
          tag="拆單"
          storageKey="sec:routing"
          defaultOpen={false}
        >
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>說明（點開）</summary>
              <div className="hint" style={{ marginTop: 10 }}>
                1. 服務編號（serviceId）來自供應商「服務清單」，供應商可能會更換編號，所以這裡需要可調整。
                <br />
                2. 隨機：每次拆單結果可能不同（不看配比）。
                <br />
                3. 按配比：會依「配比」欄位做比例分配（數字越大拿到越多）。
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
  );
}
