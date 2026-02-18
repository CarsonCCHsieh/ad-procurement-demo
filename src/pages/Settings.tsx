import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ServicePicker } from "../components/ServicePicker";
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
import { PRICING, type AdPlacement } from "../lib/pricing";

function placementLabel(p: AdPlacement) {
  return PRICING[p]?.label ?? p;
}

function vendorLabel(key: VendorKey) {
  return DEFAULT_CONFIG.vendors.find((v) => v.key === key)?.label ?? key;
}

const ALL_VENDORS: VendorKey[] = ["smmraja", "urpanel", "justanotherpanel"];

export function SettingsPage() {
  const nav = useNavigate();
  const { user, signOut } = useAuth();

  const [cfg, setCfg] = useState<AppConfigV1>(() => getConfig());
  const [msg, setMsg] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [keys, setKeys] = useState<Record<VendorKey, string>>(() => ({
    smmraja: getVendorKey("smmraja"),
    urpanel: getVendorKey("urpanel"),
    justanotherpanel: getVendorKey("justanotherpanel"),
  }));

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

  const save = () => {
    saveConfig(cfg);
    setCfg(getConfig());
    setMsg("已儲存。");
    setTimeout(() => setMsg(null), 2000);
  };

  const doReset = () => {
    resetConfig();
    setCfg(getConfig());
    setMsg("已重設為預設值。");
    setTimeout(() => setMsg(null), 2000);
  };

  const loadServicesFromSite = async (vendor: VendorKey) => {
    try {
      const res = await fetch(`./services/${vendor}.json`, { cache: "no-store" });
      if (!res.ok) {
        setMsg(`載入 ${vendorLabel(vendor)} services 失敗：HTTP ${res.status}（可能尚未產生檔案）`);
        setTimeout(() => setMsg(null), 3500);
        return;
      }
      const json = await res.json();
      // Reuse schema/normalization through the existing importer.
      const r = importVendorServicesJson(vendor, JSON.stringify(json));
      if (!r.ok) {
        setMsg(r.message ?? `載入 ${vendorLabel(vendor)} 後解析失敗`);
        setTimeout(() => setMsg(null), 3500);
        return;
      }
      setMsg(`已載入 ${vendorLabel(vendor)} services：${(r.count ?? 0).toLocaleString()} 筆`);
      setTimeout(() => setMsg(null), 2500);
    } catch {
      setMsg(`載入 ${vendorLabel(vendor)} services 失敗：網路錯誤`);
      setTimeout(() => setMsg(null), 3500);
    }
  };

  const loadAllServicesFromSite = async () => {
    let ok = 0;
    for (const v of ALL_VENDORS) {
      // eslint-disable-next-line no-await-in-loop
      await loadServicesFromSite(v);
      if (getVendorServices(v).length > 0) ok += 1;
    }
    setMsg(`已嘗試載入全部 services（成功 ${ok}/${ALL_VENDORS.length} 家）。`);
    setTimeout(() => setMsg(null), 3000);
  };

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">控制設定（Demo）</div>
          <div className="brand-sub">serviceId 對應、拆單策略（Random/配比），以及供應商 services 清單載入。</div>
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
        <div className="card" style={{ borderColor: "rgba(16, 185, 129, 0.45)" }}>
          <div className="card-bd">{msg}</div>
        </div>
      )}

      <div className="grid">
        <div className="card">
          <div className="card-hd">
            <div>
              <div className="card-title">供應商與 services 清單</div>
              <div className="card-desc">
                services 清單由 GitHub Actions 產生為靜態檔，這裡只做載入與清空。你不需要貼 JSON。
              </div>
            </div>
            <div className="actions" style={{ marginTop: 0 }}>
              <button className="btn" type="button" onClick={loadAllServicesFromSite}>
                載入全部 services
              </button>
              <button className="btn" type="button" onClick={() => setShowKeys((x) => !x)}>
                {showKeys ? "隱藏 API key（Demo）" : "顯示 API key（Demo）"}
              </button>
            </div>
          </div>

          <div className="card-bd">
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
                      <div className="label">API Base URL</div>
                      <input
                        value={v.apiBaseUrl}
                        onChange={(e) =>
                          setCfg((c) => ({
                            ...c,
                            vendors: c.vendors.map((x, i) => (i === idx ? { ...x, apiBaseUrl: e.target.value } : x)),
                          }))
                        }
                      />
                      <div className="hint">SMM Raja: /api/v3，Urpanel/JAP: /api/v2（以文件為準）</div>
                    </div>
                  </div>

                  {showKeys && (
                    <div className="row cols2" style={{ marginTop: 10 }}>
                      <div className="field">
                        <div className="label">API key（Demo only，用於同步狀態）</div>
                        <input
                          type="password"
                          value={keys[v.key]}
                          onChange={(e) => {
                            const next = e.target.value;
                            setKeys((k) => ({ ...k, [v.key]: next }));
                            setVendorKey(v.key, next);
                          }}
                          placeholder="貼上 vendor API key"
                        />
                        <div className="hint">正式版不要放前端，請改後端代打。</div>
                      </div>
                      <div className="field">
                        <div className="label">操作</div>
                        <div className="actions">
                          <button
                            className="btn danger"
                            type="button"
                            onClick={() => {
                              clearVendorKey(v.key);
                              setKeys((k) => ({ ...k, [v.key]: "" }));
                              setMsg(`已清除 ${vendorLabel(v.key)} API key（僅此瀏覽器）。`);
                              setTimeout(() => setMsg(null), 2000);
                            }}
                          >
                            清除 key
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="actions" style={{ justifyContent: "space-between" }}>
                    <div className="hint">
                      services：{getVendorServices(v.key).length.toLocaleString()} 筆
                    </div>
                    <div>
                      <button className="btn" type="button" onClick={() => loadServicesFromSite(v.key)}>
                        從網站載入
                      </button>
                      <button
                        className="btn danger"
                        type="button"
                        onClick={() => {
                          clearVendorServices(v.key);
                          setMsg(`已清空 ${vendorLabel(v.key)} services 清單。`);
                          setTimeout(() => setMsg(null), 2000);
                        }}
                      >
                        清空清單
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="sep" />
            <div className="actions">
              <button className="btn" type="button" onClick={doReset}>
                重設預設值
              </button>
              <button className="btn primary" type="button" onClick={save}>
                儲存
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-hd">
            <div>
              <div className="card-title">品項對應（拆單設定）</div>
              <div className="card-desc">
                `weight` 只有在「配比」才會用到。若不設定策略，預設就是 Random。
              </div>
            </div>
            <span className="tag">routing</span>
          </div>
          <div className="card-bd">
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>說明（點開）</summary>
              <div className="hint" style={{ marginTop: 10 }}>
                1. `serviceId` 來自供應商 services 清單，可能會更換編號，所以這裡要可調整。
                <br />
                2. Random：每次拆單結果會不一樣（不看 weight）。
                <br />
                3. 配比：會依 weight 做比例分配（數字越大拿到越多）。
              </div>
            </details>

            <div className="sep" />

            <div className="list">
              {(Object.keys(PRICING) as AdPlacement[]).map((placement) => {
                const placementCfg = cfg.placements.find((p) => p.placement === placement);
                const suppliers = placementCfg?.suppliers ?? [];
                const splitStrategy = placementCfg?.splitStrategy ?? "random";

                return (
                  <div className="item" key={placement}>
                    <div className="item-hd">
                      <div className="item-title">{placementLabel(placement)}</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span className="tag">{splitStrategy === "random" ? "Random" : "Weighted"}</span>
                        <select
                          value={splitStrategy}
                          onChange={(e) => setPlacementStrategy(placement, e.target.value as "random" | "weighted")}
                        >
                          <option value="random">Random（預設）</option>
                          <option value="weighted">配比（看 weight）</option>
                        </select>
                        <button
                          className="btn"
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
                    </div>

                    {suppliers.length === 0 ? (
                      <div className="hint">尚未設定供應商。</div>
                    ) : (
                      <div className="list">
                        {suppliers.map((s, idx) => (
                          <div className="item" key={`${placement}-${idx}`}>
                            <div className="row cols4">
                              <div className="field">
                                <div className="label">供應商</div>
                                <select
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

                              <div className="field">
                                <div className="label">serviceId</div>
                                <input
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
                                  placeholder="例如 1234"
                                />
                                <div className="hint">搭配下方「從清單挑選」較不會選錯。</div>
                              </div>

                              {splitStrategy === "weighted" ? (
                                <div className="field">
                                  <div className="label">weight（配比）</div>
                                  <input
                                    value={String(s.weight)}
                                    inputMode="numeric"
                                    onChange={(e) => {
                                      const n = Number(e.target.value);
                                      setPlacementSuppliers(
                                        placement,
                                        suppliers.map((x, i) =>
                                          i === idx ? { ...x, weight: Number.isFinite(n) ? n : 0 } : x,
                                        ),
                                      );
                                    }}
                                    placeholder="1"
                                  />
                                  <div className="hint">例：2/1/1 約等於 50%/25%/25%</div>
                                </div>
                              ) : (
                                <div className="field">
                                  <div className="label">weight</div>
                                  <input value="(Random 不使用)" readOnly />
                                </div>
                              )}

                              <div className="field">
                                <div className="label">maxPerOrder（可留空）</div>
                                <input
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
                                  placeholder="例如 1000"
                                />
                              </div>
                            </div>

                            <div className="sep" />
                            <div className="hint">從清單挑選（需先載入該供應商 services）：</div>
                            <ServicePicker
                              vendor={s.vendor}
                              currentServiceId={s.serviceId}
                              onPick={(svc) => {
                                setPlacementSuppliers(
                                  placement,
                                  suppliers.map((x, i) => (i === idx ? { ...x, serviceId: svc.id } : x)),
                                );
                              }}
                            />

                            <div className="actions" style={{ justifyContent: "space-between" }}>
                              <button
                                className="btn"
                                type="button"
                                onClick={() =>
                                  setPlacementSuppliers(
                                    placement,
                                    suppliers.map((x, i) => (i === idx ? { ...x, enabled: !x.enabled } : x)),
                                  )
                                }
                              >
                                {s.enabled ? "已啟用" : "已停用"}
                              </button>
                              <button
                                className="btn danger"
                                type="button"
                                onClick={() => setPlacementSuppliers(placement, suppliers.filter((_, i) => i !== idx))}
                              >
                                刪除
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="sep" />
            <div className="actions">
              <button className="btn" type="button" onClick={doReset}>
                重設預設值
              </button>
              <button className="btn primary" type="button" onClick={save}>
                儲存
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
