import { useEffect, useMemo, useRef, useState, type ChangeEventHandler } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { CollapsibleCard } from "../components/CollapsibleCard";
import { MetaSettingsCard } from "../components/MetaSettingsCard";
import { ServicePicker } from "../components/ServicePicker";
import {
  DEFAULT_CONFIG,
  getConfig,
  resetConfig,
  saveConfig,
  type AppConfigV1,
  type PlacementConfig,
  type SupplierConfig,
  type VendorKey,
} from "../config/appConfig";
import { DEFAULT_PRICING_CONFIG, getPricingConfig, savePricingConfig, type PricingConfigV1 } from "../config/pricingConfig";
import { clearVendorKey, getVendorKey, setVendorKey } from "../config/vendorKeys";
import { clearVendorServices, getVendorServices, importVendorServicesJson } from "../config/serviceCatalog";
import { createDemoSnapshot, parseDemoSnapshot, restoreDemoSnapshot } from "../lib/demoState";
import { calcInternalLineAmount } from "../lib/internalPricing";
import { getDefaultPricingRule, type AdPlacement } from "../lib/pricing";
import { flushAllSharedState, pullSharedState, SHARED_STORAGE_KEYS, SHARED_SYNC_EVENT } from "../lib/sharedSync";

type MsgKind = "success" | "info" | "warn" | "error";

const VENDORS: VendorKey[] = ["smmraja", "urpanel", "justanotherpanel"];

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

function vendorLabel(vendor: VendorKey) {
  return DEFAULT_CONFIG.vendors.find((item) => item.key === vendor)?.label ?? vendor;
}

function readCurrentPrice(pricingCfg: PricingConfigV1, placement: AdPlacement) {
  const value = pricingCfg.prices[placement];
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  return getDefaultPricingRule(placement).price;
}

function readCurrentMinUnit(pricingCfg: PricingConfigV1, placement: AdPlacement) {
  const value = pricingCfg.minUnits[placement];
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0) return value;
  return getDefaultPricingRule(placement).minUnit;
}

function sanitizePlacementKey(raw: string) {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

export function SettingsPage() {
  const nav = useNavigate();
  const { user, signOut } = useAuth();

  const [cfg, setCfg] = useState<AppConfigV1>(() => cloneConfig(getConfig()));
  const [pricingCfg, setPricingCfg] = useState<PricingConfigV1>(() => getPricingConfig());
  const [vendorKeys, setVendorKeys] = useState<Record<VendorKey, string>>({
    smmraja: getVendorKey("smmraja"),
    urpanel: getVendorKey("urpanel"),
    justanotherpanel: getVendorKey("justanotherpanel"),
  });
  const [sampleQty, setSampleQty] = useState("2000");
  const [showVendorKeys, setShowVendorKeys] = useState(false);
  const [newPlacementKey, setNewPlacementKey] = useState("");
  const [newPlacementLabel, setNewPlacementLabel] = useState("");
  const [metaCardKey, setMetaCardKey] = useState(0);
  const [msg, setMsg] = useState<{ kind: MsgKind; text: string } | null>(null);
  const msgTimer = useRef<number | null>(null);
  const backupFileRef = useRef<HTMLInputElement | null>(null);

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
    setMetaCardKey((value) => value + 1);
  };

  useEffect(() => {
    const onSharedSync = () => refreshAll();
    window.addEventListener(SHARED_SYNC_EVENT, onSharedSync);
    return () => window.removeEventListener(SHARED_SYNC_EVENT, onSharedSync);
  }, []);

  useEffect(() => {
    void (async () => {
      await pullSharedState(SHARED_STORAGE_KEYS);
      refreshAll();
    })();
  }, []);

  const setupStats = useMemo(() => {
    const enabledPlacementCount = cfg.placements.filter((placement) => placement.enabled).length;
    const configuredPlacementCount = cfg.placements.filter((placement) =>
      placement.suppliers.some((supplier) => supplier.enabled && supplier.serviceId > 0),
    ).length;
    const loadedVendorCount = VENDORS.filter((vendor) => getVendorServices(vendor).length > 0).length;
    return { enabledPlacementCount, configuredPlacementCount, loadedVendorCount };
  }, [cfg]);

  const setVendorField = <K extends keyof AppConfigV1["vendors"][number]>(
    vendorKey: VendorKey,
    field: K,
    value: AppConfigV1["vendors"][number][K],
  ) => {
    setCfg((current) => ({
      ...current,
      vendors: current.vendors.map((vendor) => (vendor.key === vendorKey ? { ...vendor, [field]: value } : vendor)),
    }));
  };

  const setPlacementField = <K extends keyof PlacementConfig>(
    placement: AdPlacement,
    field: K,
    value: PlacementConfig[K],
  ) => {
    setCfg((current) => ({
      ...current,
      placements: current.placements.map((item) =>
        item.placement === placement ? { ...item, [field]: value } : item,
      ),
    }));
  };

  const persistConfigDraft = (nextCfg: AppConfigV1, nextPricing = pricingCfg) => {
    saveConfig(nextCfg);
    savePricingConfig(nextPricing);
    void flushAllSharedState();
  };

  const setPlacementEnabled = (placement: AdPlacement, enabled: boolean) => {
    setCfg((current) => {
      const nextCfg = {
        ...current,
        placements: current.placements.map((item) =>
          item.placement === placement ? { ...item, enabled } : item,
        ),
      };
      persistConfigDraft(nextCfg);
      return nextCfg;
    });
    flashMsg("success", enabled ? "品項已啟用。" : "品項已停用。", 2200);
  };

  const setPlacementStrategy = (placement: AdPlacement, splitStrategy: "random" | "weighted") => {
    setPlacementField(placement, "splitStrategy", splitStrategy);
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

  const setPrice = (placement: AdPlacement, value: number) => {
    if (!Number.isFinite(value) || value < 0) return;
    setPricingCfg((current) => ({
      ...current,
      prices: { ...current.prices, [placement]: value },
    }));
  };

  const setMinUnit = (placement: AdPlacement, value: number) => {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return;
    setPricingCfg((current) => ({
      ...current,
      minUnits: { ...current.minUnits, [placement]: value },
    }));
  };

  const addPlacement = () => {
    const placement = sanitizePlacementKey(newPlacementKey);
    const label = newPlacementLabel.trim();

    if (!placement || !label) {
      flashMsg("warn", "請先填寫品項代碼與品項名稱。");
      return;
    }

    if (cfg.placements.some((item) => item.placement === placement)) {
      flashMsg("warn", "這個品項代碼已存在。");
      return;
    }

    const defaults = getDefaultPricingRule(placement);
    setCfg((current) => ({
      ...current,
      placements: [
        ...current.placements,
        {
          placement,
          label,
          enabled: true,
          splitStrategy: "random",
          suppliers: [],
        },
      ],
    }));
    setPricingCfg((current) => ({
      ...current,
      prices: { ...current.prices, [placement]: defaults.price },
      minUnits: { ...current.minUnits, [placement]: defaults.minUnit },
    }));
    persistConfigDraft(
      {
        ...cfg,
        placements: [
          ...cfg.placements,
          {
            placement,
            label,
            enabled: true,
            splitStrategy: "random",
            suppliers: [],
          },
        ],
      },
      {
        ...pricingCfg,
        prices: { ...pricingCfg.prices, [placement]: defaults.price },
        minUnits: { ...pricingCfg.minUnits, [placement]: defaults.minUnit },
      },
    );
    setNewPlacementKey("");
    setNewPlacementLabel("");
    flashMsg("success", "已新增品項。");
  };

  const removePlacement = (placement: AdPlacement) => {
    const nextCfg = {
      ...cfg,
      placements: cfg.placements.filter((item) => item.placement !== placement),
    };
    const nextPrices = { ...pricingCfg.prices };
    const nextMinUnits = { ...pricingCfg.minUnits };
    delete nextPrices[placement];
    delete nextMinUnits[placement];
    const nextPricing = {
      ...pricingCfg,
      prices: nextPrices,
      minUnits: nextMinUnits,
    };
    setCfg(nextCfg);
    setPricingCfg(nextPricing);
    persistConfigDraft(nextCfg, nextPricing);
    flashMsg("info", "已刪除品項。");
  };

  const saveAll = async () => {
    saveConfig(cfg);
    savePricingConfig(pricingCfg);
    await flushAllSharedState();
    refreshAll();
    flashMsg("success", "控制設定已儲存。");
  };

  const resetAll = () => {
    resetConfig();
    savePricingConfig(DEFAULT_PRICING_CONFIG);
    refreshAll();
    flashMsg("info", "已重設品項、路由與定價設定。");
  };

  const loadServicesFromSite = async (vendor: VendorKey, silent = false) => {
    try {
      const response = await fetch(`./services/${vendor}.json`, { cache: "no-store" });
      if (!response.ok) {
        if (!silent) flashMsg("error", `載入 ${vendorLabel(vendor)} 服務清單失敗，HTTP ${response.status}。`, 4500);
        return;
      }

      const json = await response.json();
      const result = importVendorServicesJson(vendor, JSON.stringify(json));
      if (!result.ok) {
        if (!silent) flashMsg("error", result.message ?? `載入 ${vendorLabel(vendor)} 服務清單失敗。`, 4500);
        return;
      }

      refreshAll();
      if (!silent) {
        flashMsg("success", `已載入 ${vendorLabel(vendor)} 服務清單，共 ${(result.count ?? 0).toLocaleString("zh-TW")} 筆。`);
      }
    } catch {
      if (!silent) flashMsg("error", `載入 ${vendorLabel(vendor)} 服務清單失敗，請確認網路或 JSON 檔案。`, 4500);
    }
  };

  const loadAllServices = async () => {
    let successCount = 0;
    for (const vendor of VENDORS) {
      // eslint-disable-next-line no-await-in-loop
      await loadServicesFromSite(vendor, true);
      if (getVendorServices(vendor).length > 0) successCount += 1;
    }
    refreshAll();
    flashMsg("info", `已載入全部服務清單，成功 ${successCount}/${VENDORS.length} 家。`, 3500);
  };

  const exportSnapshot = (includeSecrets: boolean) => {
    const snapshot = createDemoSnapshot({ includeSecrets });
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    anchor.href = url;
    anchor.download = includeSecrets ? `ad-demo-full-backup-${stamp}.json` : `ad-demo-backup-${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
    flashMsg("success", includeSecrets ? "完整備份已下載。" : "一般備份已下載。", 3500);
  };

  const onImportFile: ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = parseDemoSnapshot(await file.text());
      if (!parsed.ok) {
        flashMsg("error", parsed.message, 4500);
      } else {
        restoreDemoSnapshot(parsed.snapshot);
        refreshAll();
        flashMsg("success", "備份已匯入。", 3500);
      }
    } catch {
      flashMsg("error", "匯入備份失敗，請確認檔案內容完整。", 4500);
    } finally {
      event.target.value = "";
    }
  };

  const sampleQuantity = Number(sampleQty);

  return (
    <div className="container settings-page">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">控制設定</div>
          <div className="brand-sub">管理品項、定價、供應商與 Meta 設定。</div>
        </div>

        <div className="pill">
          <span className="tag">{user?.displayName ?? user?.username}</span>
          <button className="btn" onClick={() => nav("/ad-orders")}>廠商互動下單</button>
          <button className="btn" onClick={() => nav("/ad-performance")}>投放成效</button>
          <button className="btn" onClick={() => nav("/meta-ads-orders")}>Meta官方投廣</button>
          <button className="btn" type="button" onClick={resetAll}>重設預設值</button>
          <button className="btn primary" type="button" onClick={saveAll}>儲存</button>
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
        </div>
      ) : null}

      <div className="card settings-setup">
        <div className="card-hd">
          <div>
            <div className="card-title">設定總覽</div>
            <div className="card-desc">先確認品項有啟用、定價已填、供應商服務已對應，使用者才會在前台看到正確的下單選項。</div>
          </div>
        </div>
        <div className="card-bd">
          <div className="setup-grid">
            <div className="setup-step" role="button" tabIndex={0} onClick={() => document.getElementById("sec-routing")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <div className="setup-title">品項對應</div>
              <div className={`setup-status ${setupStats.configuredPlacementCount > 0 ? "ok" : "pending"}`}>
                已完成對應 {setupStats.configuredPlacementCount} / {cfg.placements.length} 個品項
              </div>
            </div>
            <div className="setup-step" role="button" tabIndex={0} onClick={() => document.getElementById("sec-pricing")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <div className="setup-title">前台定價</div>
              <div className={`setup-status ${setupStats.enabledPlacementCount > 0 ? "ok" : "pending"}`}>
                目前啟用 {setupStats.enabledPlacementCount} 個可下單品項
              </div>
            </div>
            <div className="setup-step" role="button" tabIndex={0} onClick={() => document.getElementById("sec-vendors")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <div className="setup-title">供應商服務清單</div>
              <div className={`setup-status ${setupStats.loadedVendorCount > 0 ? "ok" : "pending"}`}>
                已載入 {setupStats.loadedVendorCount} / {VENDORS.length} 家供應商
              </div>
            </div>
          </div>
        </div>
      </div>

      <MetaSettingsCard key={metaCardKey} onNotice={flashMsg} />

      <div id="sec-pricing">
        <CollapsibleCard
          accent="blue"
          title="前台定價與最小單位"
          desc="這裡決定使用者下單時看到的金額，以及每個品項允許的最小數量單位。"
          tag="定價"
          storageKey="sec:pricing"
          defaultOpen
        >
          <div className="row cols2" style={{ marginBottom: 12 }}>
            <div className="field">
              <div className="label">試算數量</div>
              <input value={sampleQty} inputMode="numeric" onChange={(event) => setSampleQty(event.target.value)} />
              <div className="hint">可輸入一個數量，右側會即時顯示該品項的前台金額試算。</div>
            </div>
            <div className="field">
              <div className="label">說明</div>
              <div className="hint">停用的品項不會出現在下單頁；最小單位會直接影響使用者可填寫的數量。</div>
            </div>
          </div>

          <div className="dense-table">
            <div className="dense-th">品項</div>
            <div className="dense-th">狀態</div>
            <div className="dense-th">最小單位</div>
            <div className="dense-th">單價</div>
            <div className="dense-th">試算</div>

            {cfg.placements.map((placementCfg) => {
              const qtyValid = Number.isFinite(sampleQuantity) && sampleQuantity > 0;
              const sampleAmount = qtyValid ? calcInternalLineAmount(placementCfg.placement, sampleQuantity) : 0;
              return (
                <div className="dense-tr" key={`pricing-${placementCfg.placement}`}>
                  <div className="dense-td">
                    <div className="dense-title">{placementCfg.label}</div>
                    <div className="dense-meta">{placementCfg.placement}</div>
                  </div>
                  <div className="dense-td">
                    <span className="tag">{placementCfg.enabled ? "啟用" : "停用"}</span>
                  </div>
                  <div className="dense-td">
                    <input
                      className="dense-input"
                      value={String(readCurrentMinUnit(pricingCfg, placementCfg.placement))}
                      inputMode="numeric"
                      onChange={(event) => setMinUnit(placementCfg.placement, Number(event.target.value))}
                    />
                  </div>
                  <div className="dense-td">
                    <input
                      className="dense-input"
                      value={String(readCurrentPrice(pricingCfg, placementCfg.placement))}
                      inputMode="numeric"
                      onChange={(event) => setPrice(placementCfg.placement, Number(event.target.value))}
                    />
                  </div>
                  <div className="dense-td">
                    <div className="dense-title">{qtyValid ? `NT$ ${sampleAmount.toLocaleString("zh-TW")}` : "-"}</div>
                    <div className="dense-meta">{qtyValid ? `數量 ${sampleQuantity.toLocaleString("zh-TW")}` : "請輸入有效數量"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </CollapsibleCard>
      </div>

      <CollapsibleCard
        accent="green"
        title="資料備份與交接"
        desc="可下載一般備份或完整備份，也可以匯入既有備份。"
        tag="備份"
        storageKey="sec:backup"
        defaultOpen={false}
      >
        <input ref={backupFileRef} type="file" accept="application/json,.json" hidden onChange={onImportFile} />
        <div className="hint">一般備份不含 API Key 與 Meta Token；完整備份包含敏感資料，只能由管理員保管。</div>
        <div className="actions inline" style={{ marginTop: 10 }}>
          <button className="btn" type="button" onClick={() => exportSnapshot(false)}>下載一般備份</button>
          <button className="btn" type="button" onClick={() => exportSnapshot(true)}>下載完整備份</button>
          <button className="btn" type="button" onClick={() => backupFileRef.current?.click()}>匯入備份</button>
        </div>
      </CollapsibleCard>

      <div id="sec-vendors">
        <CollapsibleCard
          accent="amber"
          title="供應商設定"
          desc="管理供應商啟用狀態、API 入口、API Key 與服務清單。"
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
                    <div className="label">狀態</div>
                    <select
                      value={vendor.enabled ? "on" : "off"}
                      onChange={(event) => setVendorField(vendor.key, "enabled", event.target.value === "on")}
                    >
                      <option value="on">啟用</option>
                      <option value="off">停用</option>
                    </select>
                  </div>

                  <div className="field">
                    <div className="label">API Base URL</div>
                    <input
                      value={vendor.apiBaseUrl}
                      onChange={(event) => setVendorField(vendor.key, "apiBaseUrl", event.target.value)}
                    />
                  </div>

                  <div className="field">
                    <div className="label">API Key</div>
                    <input
                      type={showVendorKeys ? "text" : "password"}
                      value={vendorKeys[vendor.key]}
                      onChange={(event) => {
                        const next = event.target.value;
                        setVendorKeys((current) => ({ ...current, [vendor.key]: next }));
                        setVendorKey(vendor.key, next);
                      }}
                      placeholder="請貼上 API Key"
                    />
                  </div>

                  <div className="field">
                    <div className="label">服務清單</div>
                    <input value={`${getVendorServices(vendor.key).length.toLocaleString("zh-TW")} 筆`} readOnly />
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
      </div>

      <div id="sec-routing">
        <CollapsibleCard
          accent="slate"
          title="品項對應"
          desc="新增、停用或刪除前台品項，並決定每個品項實際對應哪些供應商服務。"
          tag="品項"
          storageKey="sec:routing"
          defaultOpen
        >
          <div className="row cols2" style={{ marginBottom: 12 }}>
            <div className="field">
              <div className="label">新項目代碼</div>
              <input
                value={newPlacementKey}
                onChange={(event) => setNewPlacementKey(event.target.value)}
                placeholder="例如：fb_comments"
              />
              <div className="hint">建議使用英文、小寫與底線，之後可長期沿用。</div>
            </div>
            <div className="field">
              <div className="label">新項目名稱</div>
              <div className="actions inline">
                <input
                  value={newPlacementLabel}
                  onChange={(event) => setNewPlacementLabel(event.target.value)}
                  placeholder="例如：Facebook 留言"
                />
                <button className="btn" type="button" onClick={addPlacement}>新增品項</button>
              </div>
            </div>
          </div>

          <div className="hint" style={{ marginBottom: 10 }}>
            停用後，該品項不會出現在前台下單頁；刪除後會連同定價設定一起移除。
          </div>

          <div className="list">
            {cfg.placements.map((placementCfg) => (
              <div className="item" key={placementCfg.placement}>
                <div className="item-hd item-summary">
                  <div>
                    <div className="item-title">{placementCfg.label}</div>
                    <div className="hint">{placementCfg.placement}</div>
                  </div>
                  <div className="btn-group actions inline">
                    <span className="tag">{placementCfg.enabled ? "啟用中" : "已停用"}</span>
                    <select
                      value={placementCfg.enabled ? "on" : "off"}
                      onChange={(event) => setPlacementEnabled(placementCfg.placement, event.target.value === "on")}
                    >
                      <option value="on">啟用</option>
                      <option value="off">停用</option>
                    </select>
                    <select
                      value={placementCfg.splitStrategy ?? "random"}
                      onChange={(event) => setPlacementStrategy(placementCfg.placement, event.target.value as "random" | "weighted")}
                    >
                      <option value="random">隨機拆單</option>
                      <option value="weighted">依配比分單</option>
                    </select>
                    <button className="btn" type="button" onClick={() => addSupplier(placementCfg.placement)}>新增供應商</button>
                    <button className="btn danger" type="button" onClick={() => removePlacement(placementCfg.placement)}>刪除品項</button>
                  </div>
                </div>

                <div className="row cols2" style={{ marginBottom: 12 }}>
                  <div className="field">
                    <div className="label">品項名稱</div>
                    <input
                      value={placementCfg.label}
                      onChange={(event) => setPlacementField(placementCfg.placement, "label", event.target.value)}
                    />
                  </div>
                  <div className="field">
                    <div className="label">品項代碼</div>
                    <input value={placementCfg.placement} readOnly />
                  </div>
                </div>

                <div className="dense-table suppliers-table">
                  <div className="dense-th">狀態</div>
                  <div className="dense-th">供應商</div>
                  <div className="dense-th">serviceId</div>
                  <div className="dense-th">預設配比</div>
                  <div className="dense-th">單次上限</div>
                  <div className="dense-th">操作</div>

                  {placementCfg.suppliers.map((supplier, index) => (
                    <div className="dense-tr" key={`${placementCfg.placement}-${index}`}>
                      <div className="dense-td">
                        <select
                          value={supplier.enabled ? "on" : "off"}
                          onChange={(event) => setSupplierField(placementCfg.placement, index, "enabled", event.target.value === "on")}
                        >
                          <option value="on">啟用</option>
                          <option value="off">停用</option>
                        </select>
                      </div>

                      <div className="dense-td">
                        <select
                          value={supplier.vendor}
                          onChange={(event) => setSupplierField(placementCfg.placement, index, "vendor", event.target.value as VendorKey)}
                        >
                          {VENDORS.map((vendor) => (
                            <option key={vendor} value={vendor}>
                              {vendorLabel(vendor)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="dense-td">
                        <input
                          className="dense-input"
                          value={String(supplier.serviceId)}
                          inputMode="numeric"
                          onChange={(event) =>
                            setSupplierField(placementCfg.placement, index, "serviceId", Number(event.target.value) || 0)
                          }
                        />
                        <ServicePicker
                          vendor={supplier.vendor}
                          currentServiceId={supplier.serviceId}
                          onPick={(service) => setSupplierField(placementCfg.placement, index, "serviceId", service.id)}
                          compact
                          buttonLabel="從清單選"
                          buttonClassName="btn ghost sm"
                        />
                      </div>

                      <div className="dense-td">
                        <input
                          className="dense-input"
                          value={String(supplier.weight)}
                          inputMode="decimal"
                          onChange={(event) =>
                            setSupplierField(placementCfg.placement, index, "weight", Number(event.target.value) || 0)
                          }
                        />
                      </div>

                      <div className="dense-td">
                        <input
                          className="dense-input"
                          value={supplier.maxPerOrder == null ? "" : String(supplier.maxPerOrder)}
                          inputMode="numeric"
                          placeholder="留空代表不限"
                          onChange={(event) =>
                            setSupplierField(
                              placementCfg.placement,
                              index,
                              "maxPerOrder",
                              event.target.value.trim() ? Number(event.target.value) || undefined : undefined,
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

                {placementCfg.suppliers.length === 0 ? (
                  <div className="hint" style={{ marginTop: 8 }}>這個品項尚未綁定供應商服務。若保持啟用，前台會提示請通知管理員。</div>
                ) : null}
              </div>
            ))}
          </div>
        </CollapsibleCard>
      </div>
    </div>
  );
}
