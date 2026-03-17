import { useEffect, useMemo, useRef, useState, type ChangeEventHandler } from "react";
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
import { clearVendorServices, getVendorServices, importVendorServicesJson } from "../config/serviceCatalog";
import {
  getPlacementMinUnit,
  getPlacementPrice,
  getPricingConfig,
  savePricingConfig,
  setPlacementMinUnit,
  type PricingConfigV1,
} from "../config/pricingConfig";
import { createDemoSnapshot, parseDemoSnapshot, restoreDemoSnapshot } from "../lib/demoState";
import { PRICING, type AdPlacement } from "../lib/pricing";
import { calcInternalLineAmount } from "../lib/internalPricing";
import { SHARED_SYNC_EVENT } from "../lib/sharedSync";

type MsgKind = "success" | "info" | "warn" | "error";

const VENDORS: VendorKey[] = ["smmraja", "urpanel", "justanotherpanel"];
const PLACEMENTS = Object.keys(PRICING) as AdPlacement[];

function placementLabel(placement: AdPlacement) {
  return PRICING[placement].label;
}

function vendorLabel(vendor: VendorKey) {
  return DEFAULT_CONFIG.vendors.find((item) => item.key === vendor)?.label ?? vendor;
}

function cloneConfig(cfg: AppConfigV1): AppConfigV1 {
  return {
    ...cfg,
    vendors: cfg.vendors.map((vendor) => ({ ...vendor })),
    placements: cfg.placements.map((placement) => ({
      ...placement,
      suppliers: placement.suppliers.map((supplier) => ({ ...supplier })),
    })),
  };
}

export function SettingsPage() {
  const nav = useNavigate();
  const { user, signOut } = useAuth();

  const [cfg, setCfg] = useState<AppConfigV1>(() => cloneConfig(getConfig()));
  const [pricingCfg, setPricingCfg] = useState<PricingConfigV1>(() => getPricingConfig());
  const [msg, setMsg] = useState<{ kind: MsgKind; text: string } | null>(null);
  const [sampleQty, setSampleQty] = useState("2000");
  const [showVendorKeys, setShowVendorKeys] = useState(false);
  const [vendorKeys, setVendorKeys] = useState<Record<VendorKey, string>>({
    smmraja: getVendorKey("smmraja"),
    urpanel: getVendorKey("urpanel"),
    justanotherpanel: getVendorKey("justanotherpanel"),
  });
  const backupFileRef = useRef<HTMLInputElement | null>(null);
  const msgTimer = useRef<number | null>(null);

  const flashMsg = (kind: MsgKind, text: string, ms = 3000) => {
    setMsg({ kind, text });
    if (msgTimer.current != null) window.clearTimeout(msgTimer.current);
    msgTimer.current = window.setTimeout(() => setMsg(null), ms);
  };

  const refreshAll = () => {
    setCfg(cloneConfig(getConfig()));
    setPricingCfg(getPricingConfig());
    setVendorKeys({
      smmraja: getVendorKey("smmraja"),
      urpanel: getVendorKey("urpanel"),
      justanotherpanel: getVendorKey("justanotherpanel"),
    });
  };

  useEffect(() => {
    const onSharedSync = () => refreshAll();
    window.addEventListener(SHARED_SYNC_EVENT, onSharedSync);
    return () => window.removeEventListener(SHARED_SYNC_EVENT, onSharedSync);
  }, []);

  const setVendorField = <K extends keyof AppConfigV1["vendors"][number]>(
    vendorKey: VendorKey,
    field: K,
    value: AppConfigV1["vendors"][number][K],
  ) => {
    setCfg((current) => ({
      ...current,
      vendors: current.vendors.map((vendor) =>
        vendor.key === vendorKey ? { ...vendor, [field]: value } : vendor,
      ),
    }));
  };

  const setPlacementStrategy = (placement: AdPlacement, splitStrategy: "random" | "weighted") => {
    setCfg((current) => ({
      ...current,
      placements: current.placements.map((item) =>
        item.placement === placement ? { ...item, splitStrategy } : item,
      ),
    }));
  };

  const setSupplierField = <K extends keyof SupplierConfig>(
    placement: AdPlacement,
    index: number,
    field: K,
    value: SupplierConfig[K],
  ) => {
    setCfg((current) => ({
      ...current,
      placements: current.placements.map((item) =>
        item.placement !== placement
          ? item
          : {
              ...item,
              suppliers: item.suppliers.map((supplier, supplierIndex) =>
                supplierIndex === index ? { ...supplier, [field]: value } : supplier,
              ),
            },
      ),
    }));
  };

  const addSupplier = (placement: AdPlacement) => {
    setCfg((current) => ({
      ...current,
      placements: current.placements.map((item) =>
        item.placement !== placement
          ? item
          : {
              ...item,
              suppliers: [
                ...item.suppliers,
                { vendor: "smmraja", serviceId: 0, weight: 1, enabled: true } satisfies SupplierConfig,
              ],
            },
      ),
    }));
  };

  const removeSupplier = (placement: AdPlacement, index: number) => {
    setCfg((current) => ({
      ...current,
      placements: current.placements.map((item) =>
        item.placement !== placement
          ? item
          : { ...item, suppliers: item.suppliers.filter((_, supplierIndex) => supplierIndex !== index) },
      ),
    }));
  };

  const saveAll = () => {
    saveConfig(cfg);
    savePricingConfig(pricingCfg);
    refreshAll();
    flashMsg("success", "設定已儲存。");
  };

  const resetAll = () => {
    resetConfig();
    savePricingConfig(getPricingConfig());
    refreshAll();
    flashMsg("info", "已重設拆單設定。");
  };

  const setShowPrices = (showPrices: boolean) => {
    setPricingCfg((current) => ({ ...current, showPrices }));
  };

  const setPrice = (placement: AdPlacement, value: number) => {
    const price = Number(value);
    if (!Number.isFinite(price) || price < 0) return;
    setPricingCfg((current) => ({
      ...current,
      prices: { ...current.prices, [placement]: price },
    }));
  };

  const setMinUnit = (placement: AdPlacement, value: number) => {
    const minUnit = Number(value);
    if (!Number.isFinite(minUnit) || !Number.isInteger(minUnit) || minUnit <= 0) return;
    setPricingCfg((current) => ({
      ...current,
      minUnits: { ...current.minUnits, [placement]: minUnit },
    }));
  };

  const loadServicesFromSite = async (vendor: VendorKey, silent = false) => {
    try {
      const res = await fetch(`./services/${vendor}.json`, { cache: "no-store" });
      if (!res.ok) {
        if (!silent) flashMsg("error", `載入 ${vendorLabel(vendor)} 服務清單失敗：HTTP ${res.status}`, 4500);
        return;
      }
      const json = await res.json();
      const result = importVendorServicesJson(vendor, JSON.stringify(json));
      if (!result.ok) {
        if (!silent) flashMsg("error", result.message ?? `載入 ${vendorLabel(vendor)} 後解析失敗`, 4500);
        return;
      }
      if (!silent) flashMsg("success", `已載入 ${vendorLabel(vendor)} 服務清單：${(result.count ?? 0).toLocaleString()} 筆`);
      refreshAll();
    } catch {
      if (!silent) flashMsg("error", `載入 ${vendorLabel(vendor)} 服務清單失敗：網路錯誤`, 4500);
    }
  };

  const loadAllServices = async () => {
    let count = 0;
    for (const vendor of VENDORS) {
      // eslint-disable-next-line no-await-in-loop
      await loadServicesFromSite(vendor, true);
      if (getVendorServices(vendor).length > 0) count += 1;
    }
    refreshAll();
    flashMsg("info", `已載入全部服務清單（成功 ${count}/${VENDORS.length} 家）。`, 3500);
  };

  const exportSnapshot = (includeSecrets: boolean) => {
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
    flashMsg("success", includeSecrets ? "完整備份已下載。" : "一般備份已下載。", 3500);
  };

  const onImportFile: ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = parseDemoSnapshot(await file.text());
      if (!parsed.ok) {
        flashMsg("error", parsed.message, 4000);
      } else {
        restoreDemoSnapshot(parsed.snapshot);
        refreshAll();
        flashMsg("success", "備份已匯入。", 3500);
      }
    } catch {
      flashMsg("error", "匯入備份失敗，請確認檔案是否完整。", 4000);
    } finally {
      e.target.value = "";
    }
  };

  const setupStats = useMemo(() => {
    const loadedVendorCount = VENDORS.filter((vendor) => getVendorServices(vendor).length > 0).length;
    const configuredPlacementCount = cfg.placements.filter((placement) =>
      placement.suppliers.some((supplier) => supplier.enabled && supplier.serviceId > 0),
    ).length;
    return { loadedVendorCount, configuredPlacementCount };
  }, [cfg]);

  return (
    <div className="container settings-page">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">控制設定</div>
          <div className="brand-sub">管理 Meta、供應商、拆單邏輯與前台定價。</div>
        </div>
        <div className="pill">
          <span className="tag">{user?.displayName ?? user?.username}</span>
          <button className="btn" onClick={() => nav("/ad-orders")}>廠商互動下單</button>
          <button className="btn" onClick={() => nav("/meta-ads-orders")}>Meta官方投廣</button>
          <button className="btn" onClick={() => nav("/ad-performance")}>投放成效</button>
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

      {msg ? (
        <div className={`toast toast-${msg.kind}`} role="status" aria-live="polite">
          <div className="toast-text">{msg.text}</div>
          <button className="btn ghost sm" type="button" onClick={() => setMsg(null)}>關閉</button>
        </div>
      ) : null}

      <div className="card settings-setup">
        <div className="card-hd">
          <div>
            <div className="card-title">快速檢查</div>
            <div className="card-desc">先確認 Meta、服務清單、品項對應與定價都已設定。</div>
          </div>
        </div>
        <div className="card-bd">
          <div className="setup-grid">
            <div className="setup-step">
              <div className="setup-title">Meta 設定</div>
              <div className={`setup-status ${"ok"}`}>請在下方設定</div>
            </div>
            <div className="setup-step">
              <div className="setup-title">供應商服務清單</div>
              <div className={`setup-status ${setupStats.loadedVendorCount > 0 ? "ok" : "pending"}`}>
                {setupStats.loadedVendorCount > 0 ? `已載入 ${setupStats.loadedVendorCount} 家` : "尚未載入"}
              </div>
            </div>
            <div className="setup-step">
              <div className="setup-title">品項對應</div>
              <div className={`setup-status ${setupStats.configuredPlacementCount > 0 ? "ok" : "pending"}`}>
                {setupStats.configuredPlacementCount > 0 ? `已設定 ${setupStats.configuredPlacementCount} 個品項` : "尚未設定"}
              </div>
            </div>
            <div className="setup-step">
              <div className="setup-title">前台定價與最小單位</div>
              <div className="setup-status ok">可調整</div>
            </div>
          </div>
          <div className="actions inline" style={{ marginTop: 10 }}>
            <button className="btn" type="button" onClick={saveAll}>儲存設定</button>
            <button className="btn" type="button" onClick={loadAllServices}>載入全部服務清單</button>
            <button className="btn danger" type="button" onClick={resetAll}>重設拆單設定</button>
          </div>
        </div>
      </div>

      <MetaSettingsCard onNotice={flashMsg} />

      <CollapsibleCard
        accent="blue"
        title="前台定價與最小單位"
        desc="管理下單頁的金額顯示與每個品項的最小下單單位。"
        tag="定價"
        storageKey="sec:pricing"
        defaultOpen
      >
        <div className="dense-toolbar">
          <div className="field">
            <div className="label">前台顯示價格</div>
            <select value={pricingCfg.showPrices ? "on" : "off"} onChange={(e) => setShowPrices(e.target.value === "on")}>
              <option value="on">顯示</option>
              <option value="off">隱藏</option>
            </select>
          </div>
          <div className="field">
            <div className="label">示例數量</div>
            <input value={sampleQty} inputMode="numeric" onChange={(e) => setSampleQty(e.target.value)} />
          </div>
        </div>

        <div className="sep" />

        <div className="dense-table">
          <div className="dense-th">品項</div>
          <div className="dense-th">最小單位</div>
          <div className="dense-th">內部單價</div>
          <div className="dense-th">示例金額</div>

          {PLACEMENTS.map((placement) => {
            const qty = Number(sampleQty);
            const sampleOk = Number.isFinite(qty) && qty > 0;
            const sampleAmt = sampleOk ? calcInternalLineAmount(placement, qty) : 0;
            return (
              <div className="dense-tr" key={placement}>
                <div className="dense-td dense-main">
                  <div className="dense-title">{placementLabel(placement)}</div>
                  <div className="dense-meta">{placement}</div>
                </div>
                <div className="dense-td">
                  <input
                    className="dense-input"
                    value={String(getPlacementMinUnit(placement))}
                    inputMode="numeric"
                    onChange={(e) => setMinUnit(placement, Number(e.target.value))}
                  />
                </div>
                <div className="dense-td">
                  <input
                    className="dense-input"
                    value={String(getPlacementPrice(placement))}
                    inputMode="numeric"
                    onChange={(e) => setPrice(placement, Number(e.target.value))}
                  />
                </div>
                <div className="dense-td">
                  <div className="dense-title">{sampleOk ? `NT$ ${sampleAmt.toLocaleString()}` : "-"}</div>
                  <div className="dense-meta">{sampleOk ? `數量 ${qty.toLocaleString()}` : "數量無效"}</div>
                </div>
              </div>
            );
          })}
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        accent="green"
        title="資料備份與交接"
        desc="可匯出備份或匯入既有備份。"
        tag="備份"
        storageKey="sec:backup"
        defaultOpen={false}
      >
        <input ref={backupFileRef} type="file" accept="application/json,.json" hidden onChange={onImportFile} />
        <div className="hint">一般備份不含 API Key 與 Meta Token；完整備份包含敏感資料，僅限管理員保管。</div>
        <div className="actions inline" style={{ marginTop: 10 }}>
          <button className="btn" type="button" onClick={() => exportSnapshot(false)}>下載一般備份</button>
          <button className="btn" type="button" onClick={() => exportSnapshot(true)}>下載完整備份</button>
          <button className="btn" type="button" onClick={() => backupFileRef.current?.click()}>匯入備份</button>
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        accent="amber"
        title="供應商設定"
        desc="管理供應商啟用狀態、API 入口、金鑰與服務清單。"
        tag="供應商"
        storageKey="sec:vendors"
        defaultOpen={false}
      >
        <div className="actions inline" style={{ marginBottom: 10 }}>
          <button className="btn" type="button" onClick={() => setShowVendorKeys((value) => !value)}>
            {showVendorKeys ? "隱藏 API Key" : "顯示 API Key"}
          </button>
          <button className="btn" type="button" onClick={loadAllServices}>載入全部服務清單</button>
        </div>

        <div className="list">
          {cfg.vendors.map((vendor) => (
            <div className="item" key={vendor.key}>
              <div className="item-hd">
                <div className="item-title">{vendor.label}</div>
                <span className="tag">{vendor.key}</span>
              </div>

              <div className="row cols2">
                <div className="field">
                  <div className="label">啟用</div>
                  <select
                    value={vendor.enabled ? "on" : "off"}
                    onChange={(e) => setVendorField(vendor.key, "enabled", e.target.value === "on")}
                  >
                    <option value="on">啟用</option>
                    <option value="off">停用</option>
                  </select>
                </div>
                <div className="field">
                  <div className="label">API 入口網址</div>
                  <input
                    value={vendor.apiBaseUrl}
                    onChange={(e) => setVendorField(vendor.key, "apiBaseUrl", e.target.value)}
                  />
                </div>
                <div className="field">
                  <div className="label">API Key</div>
                  <input
                    type={showVendorKeys ? "text" : "password"}
                    value={vendorKeys[vendor.key]}
                    onChange={(e) => {
                      const next = e.target.value;
                      setVendorKeys((current) => ({ ...current, [vendor.key]: next }));
                      setVendorKey(vendor.key, next);
                    }}
                    placeholder="請輸入 API Key"
                  />
                </div>
                <div className="field">
                  <div className="label">服務清單</div>
                  <input value={`${getVendorServices(vendor.key).length.toLocaleString()} 筆`} readOnly />
                  <div className="actions inline" style={{ marginTop: 8 }}>
                    <button className="btn" type="button" onClick={() => void loadServicesFromSite(vendor.key)}>載入服務</button>
                    <button className="btn danger" type="button" onClick={() => { clearVendorServices(vendor.key); refreshAll(); }}>清空清單</button>
                    <button className="btn" type="button" onClick={() => { clearVendorKey(vendor.key); refreshAll(); }}>清空 Key</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        accent="slate"
        title="品項對應"
        desc="設定每個前台品項要拆到哪些供應商服務。"
        tag="拆單"
        storageKey="sec:routing"
        defaultOpen={false}
      >
        <div className="list">
          {cfg.placements.map((placementCfg) => (
            <div className="item" key={placementCfg.placement}>
              <div className="item-hd">
                <div className="item-title">{placementLabel(placementCfg.placement)}</div>
                <div className="actions inline">
                  <select
                    value={placementCfg.splitStrategy ?? "random"}
                    onChange={(e) => setPlacementStrategy(placementCfg.placement, e.target.value as "random" | "weighted")}
                  >
                    <option value="random">隨機</option>
                    <option value="weighted">按配比</option>
                  </select>
                  <button className="btn" type="button" onClick={() => addSupplier(placementCfg.placement)}>新增供應商</button>
                </div>
              </div>

              <div className="dense-table suppliers-table">
                <div className="dense-th">啟用</div>
                <div className="dense-th">供應商</div>
                <div className="dense-th">serviceId</div>
                <div className="dense-th">預設配比</div>
                <div className="dense-th">單筆上限</div>
                <div className="dense-th">操作</div>

                {placementCfg.suppliers.map((supplier, index) => (
                  <div className="dense-tr" key={`${placementCfg.placement}-${index}`}>
                    <div className="dense-td">
                      <select
                        value={supplier.enabled ? "on" : "off"}
                        onChange={(e) => setSupplierField(placementCfg.placement, index, "enabled", e.target.value === "on")}
                      >
                        <option value="on">啟用</option>
                        <option value="off">停用</option>
                      </select>
                    </div>
                    <div className="dense-td">
                      <select
                        value={supplier.vendor}
                        onChange={(e) => setSupplierField(placementCfg.placement, index, "vendor", e.target.value as VendorKey)}
                      >
                        {VENDORS.map((vendor) => (
                          <option key={vendor} value={vendor}>{vendorLabel(vendor)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="dense-td">
                      <input
                        className="dense-input"
                        value={String(supplier.serviceId)}
                        inputMode="numeric"
                        onChange={(e) => setSupplierField(placementCfg.placement, index, "serviceId", Number(e.target.value) || 0)}
                      />
                      <ServicePicker
                        vendor={supplier.vendor}
                        currentServiceId={supplier.serviceId}
                        onPick={(service) => setSupplierField(placementCfg.placement, index, "serviceId", service.id)}
                        compact
                        buttonLabel="從清單挑選"
                        buttonClassName="btn ghost sm"
                      />
                    </div>
                    <div className="dense-td">
                      <input
                        className="dense-input"
                        value={String(supplier.weight)}
                        inputMode="decimal"
                        onChange={(e) => setSupplierField(placementCfg.placement, index, "weight", Number(e.target.value) || 0)}
                      />
                    </div>
                    <div className="dense-td">
                      <input
                        className="dense-input"
                        value={supplier.maxPerOrder == null ? "" : String(supplier.maxPerOrder)}
                        inputMode="numeric"
                        placeholder="留空不限"
                        onChange={(e) =>
                          setSupplierField(
                            placementCfg.placement,
                            index,
                            "maxPerOrder",
                            e.target.value.trim() ? Number(e.target.value) || undefined : undefined,
                          )
                        }
                      />
                    </div>
                    <div className="dense-td">
                      <button className="btn danger" type="button" onClick={() => removeSupplier(placementCfg.placement, index)}>
                        移除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleCard>
    </div>
  );
}
