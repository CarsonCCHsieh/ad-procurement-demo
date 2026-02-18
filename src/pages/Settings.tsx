import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DEFAULT_CONFIG,
  getConfig,
  importConfigJson,
  resetConfig,
  saveConfig,
  type AppConfigV1,
  type SupplierConfig,
  type VendorKey,
} from "../config/appConfig";
import { useAuth } from "../auth/AuthContext";
import { PRICING, type AdPlacement } from "../lib/pricing";
import {
  clearVendorServices,
  exportServiceCatalogJson,
  getVendorServices,
  importVendorServicesJson,
} from "../config/serviceCatalog";
import { ServicePicker } from "../components/ServicePicker";
import { clearVendorKey, getVendorKey, setVendorKey } from "../config/vendorKeys";

function placementLabel(p: AdPlacement) {
  return PRICING[p]?.label ?? p;
}

function vendorLabel(key: VendorKey) {
  return DEFAULT_CONFIG.vendors.find((v) => v.key === key)?.label ?? key;
}

export function SettingsPage() {
  const nav = useNavigate();
  const { user, signOut } = useAuth();

  const [cfg, setCfg] = useState<AppConfigV1>(() => getConfig());
  const [importJson, setImportJson] = useState("");
  const [servicesVendor, setServicesVendor] = useState<VendorKey>("smmraja");
  const [servicesJson, setServicesJson] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [keys, setKeys] = useState<Record<VendorKey, string>>(() => ({
    smmraja: getVendorKey("smmraja"),
    urpanel: getVendorKey("urpanel"),
    justanotherpanel: getVendorKey("justanotherpanel"),
  }));

  const vendorKeys = useMemo(() => cfg.vendors.map((v) => v.key), [cfg.vendors]);

  const upsertPlacement = (placement: AdPlacement, nextSuppliers: SupplierConfig[]) => {
    setCfg((c) => {
      const placements = c.placements.some((p) => p.placement === placement)
        ? c.placements.map((p) => (p.placement === placement ? { ...p, suppliers: nextSuppliers } : p))
        : [...c.placements, { placement, suppliers: nextSuppliers }];
      return { ...c, placements };
    });
  };

  const save = () => {
    saveConfig(cfg);
    setCfg(getConfig());
    setMsg("已儲存（localStorage）。");
    setTimeout(() => setMsg(null), 2000);
  };

  const doReset = () => {
    resetConfig();
    setCfg(getConfig());
    setMsg("已重設為預設設定。");
    setTimeout(() => setMsg(null), 2000);
  };

  const copyExport = async () => {
    const json = JSON.stringify(cfg, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setMsg("已複製設定 JSON 到剪貼簿。");
    } catch {
      setMsg("複製失敗，請手動複製下方 JSON。");
    }
    setTimeout(() => setMsg(null), 2500);
  };

  const doImport = () => {
    const r = importConfigJson(importJson.trim());
    if (!r.ok) {
      setMsg(r.message ?? "匯入失敗");
      return;
    }
    setCfg(getConfig());
    setImportJson("");
    setMsg("已匯入並套用設定。");
    setTimeout(() => setMsg(null), 2500);
  };

  const importServices = () => {
    const r = importVendorServicesJson(servicesVendor, servicesJson.trim());
    if (!r.ok) {
      setMsg(r.message ?? "匯入 services 失敗");
      return;
    }
    setServicesJson("");
    setMsg(`已匯入 ${vendorLabel(servicesVendor)} services：${(r.count ?? 0).toLocaleString()} 筆`);
    setTimeout(() => setMsg(null), 2500);
  };

  const copyServicesExport = async () => {
    const json = exportServiceCatalogJson();
    try {
      await navigator.clipboard.writeText(json);
      setMsg("已複製 services catalog JSON 到剪貼簿。");
    } catch {
      setMsg("複製失敗。");
    }
    setTimeout(() => setMsg(null), 2500);
  };

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">控制設定（Demo）</div>
          <div className="brand-sub">用來對應「內部下單品項」到各家供應商 serviceId，並設定拆單權重與上限。</div>
        </div>
        <div className="pill">
          <span className="tag">{user?.displayName ?? user?.username}</span>
          <button className="btn" onClick={() => nav("/ad-orders")}>
            回下單
          </button>
          <button className="btn" onClick={() => nav("/ad-performance")}>
            成效頁
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
              <div className="card-title">供應商</div>
              <div className="card-desc">
                這裡只做「Base URL / 啟用」管理。實際 API key 不建議放前端（正式版需後端代打）。
              </div>
            </div>
            <span className="tag">#/settings</span>
          </div>
          <div className="card-bd">
            <div className="actions" style={{ justifyContent: "space-between" }}>
              <div className="hint">
                若你想在 Demo 站直接「同步狀態」，可以暫存在瀏覽器（不安全，僅 Demo）。
              </div>
              <button className="btn" type="button" onClick={() => setShowKeys((x) => !x)}>
                {showKeys ? "隱藏 API key" : "顯示 API key（Demo）"}
              </button>
            </div>
            <div className="sep" />

            <div className="list">
              {cfg.vendors.map((v, idx) => (
                <div className="item" key={v.key}>
                  <div className="item-hd">
                    <div className="item-title">{v.label}</div>
                    <span className="tag">{v.key}</span>
                  </div>
                  <div className="row cols3">
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
                        placeholder="https://.../api/v2"
                      />
                      <div className="hint">SMM Raja: /api/v3，Urpanel/JAP: /api/v2（以文件為準）</div>
                    </div>
                  </div>
                  {showKeys && (
                    <div className="row cols2" style={{ marginTop: 12 }}>
                      <div className="field">
                        <div className="label">API key（Demo only）</div>
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
                        <div className="hint">
                          警告：靜態站存 key 不安全。正式版請用後端代打 API。
                        </div>
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
                  <div className="sep" />
                  <div className="hint">
                    services 清單筆數：{getVendorServices(v.key).length.toLocaleString()}（用於下方下拉挑選 service）
                  </div>
                </div>
              ))}
            </div>

            <div className="sep" />
            <div className="actions">
              <button className="btn" type="button" onClick={doReset}>
                重設預設值
              </button>
              <button className="btn" type="button" onClick={copyExport}>
                複製設定 JSON
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
              <div className="card-title">服務清單（下拉選單來源）</div>
              <div className="card-desc">
                你可以把各家 `action=services` 的 JSON 回應貼進來，系統就能提供「可搜尋挑選」的 service 下拉選單。
              </div>
            </div>
            <span className="tag">services</span>
          </div>
          <div className="card-bd">
            <div className="row cols2">
              <div className="field">
                <div className="label">供應商</div>
                <select value={servicesVendor} onChange={(e) => setServicesVendor(e.target.value as VendorKey)}>
                  {vendorKeys.map((k) => (
                    <option key={k} value={k}>
                      {vendorLabel(k)}
                    </option>
                  ))}
                </select>
                <div className="hint">
                  建議做法：你先用 cURL/Postman 呼叫 `{vendorLabel(servicesVendor)}: action=services`，把回傳的 JSON 整段貼入。
                </div>
              </div>
              <div className="field">
                <div className="label">目前筆數</div>
                <input value={getVendorServices(servicesVendor).length.toLocaleString()} readOnly />
              </div>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <div className="label">貼上 services JSON</div>
              <textarea rows={8} value={servicesJson} onChange={(e) => setServicesJson(e.target.value)} placeholder='[{"service":1,"name":"...","rate":"...","min":"...","max":"..."}]' />
            </div>

            <div className="actions" style={{ justifyContent: "space-between" }}>
              <button
                className="btn danger"
                type="button"
                onClick={() => {
                  clearVendorServices(servicesVendor);
                  setMsg(`已清空 ${vendorLabel(servicesVendor)} services 清單。`);
                  setTimeout(() => setMsg(null), 2000);
                }}
              >
                清空此供應商清單
              </button>
              <div>
                <button className="btn" type="button" onClick={copyServicesExport}>
                  複製全部 services catalog JSON
                </button>
                <button className="btn primary" type="button" onClick={importServices} disabled={!servicesJson.trim()}>
                  匯入
                </button>
              </div>
            </div>

            <div className="sep" />
            <div className="hint">
              注意：這是純前端 Demo，所以不會在此頁輸入 API key 直接抓 services（避免 key 暴露、也避免遇到 CORS）。
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-hd">
            <div>
              <div className="card-title">品項對應（拆單設定）</div>
              <div className="card-desc">
                內部人員只看到「Facebook 讚數」等品項；系統會依這裡設定的 serviceId 拆單到多家供應商。
              </div>
            </div>
            <span className="tag">routing</span>
          </div>
          <div className="card-bd">
            <div className="hint">
              說明：
              <br />
              1. `serviceId` 由供應商後台的 services 清單決定，可能會變更，因此要可調整。
              <br />
              2. `weight` 用來決定拆單比例；`maxPerOrder` 可避免單一供應商吃掉太大數量。
              <br />
              3. 這是純前端 Demo，所以不會自動抓 services 清單（正式版需後端代打，避免 CORS 與 key 外洩）。
            </div>

            <div className="sep" />

            <div className="list">
              {(Object.keys(PRICING) as AdPlacement[]).map((placement) => {
                const current = cfg.placements.find((p) => p.placement === placement)?.suppliers ?? [];
                return (
                  <div className="item" key={placement}>
                    <div className="item-hd">
                      <div className="item-title">{placementLabel(placement)}</div>
                      <button
                        className="btn"
                        type="button"
                        onClick={() =>
                          upsertPlacement(placement, [
                            ...current,
                            { vendor: vendorKeys[0] ?? "smmraja", serviceId: 0, weight: 1, enabled: true },
                          ])
                        }
                      >
                        新增供應商
                      </button>
                    </div>

                    <div className="list">
                      {current.length === 0 && <div className="hint">尚未設定供應商。</div>}
                      {current.map((s, idx) => (
                        <div className="item" key={`${placement}-${idx}`}>
                          <div className="row cols4">
                            <div className="field">
                              <div className="label">供應商</div>
                              <select
                                value={s.vendor}
                                onChange={(e) => {
                                  const v = e.target.value as VendorKey;
                                  upsertPlacement(
                                    placement,
                                    current.map((x, i) => (i === idx ? { ...x, vendor: v } : x)),
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
                                  upsertPlacement(
                                    placement,
                                    current.map((x, i) => (i === idx ? { ...x, serviceId: Number.isFinite(n) ? n : 0 } : x)),
                                  );
                                }}
                                placeholder="例如 1234"
                              />
                              <div className="hint">0 代表未設定</div>
                            </div>
                            <div className="field">
                              <div className="label">weight</div>
                              <input
                                value={String(s.weight)}
                                inputMode="numeric"
                                onChange={(e) => {
                                  const n = Number(e.target.value);
                                  upsertPlacement(
                                    placement,
                                    current.map((x, i) => (i === idx ? { ...x, weight: Number.isFinite(n) ? n : 0 } : x)),
                                  );
                                }}
                                placeholder="1"
                              />
                            </div>
                            <div className="field">
                              <div className="label">maxPerOrder</div>
                              <input
                                value={s.maxPerOrder == null ? "" : String(s.maxPerOrder)}
                                inputMode="numeric"
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  const cap = raw === "" ? undefined : Number(raw);
                                  upsertPlacement(
                                    placement,
                                    current.map((x, i) =>
                                      i === idx ? { ...x, maxPerOrder: cap != null && Number.isFinite(cap) ? cap : undefined } : x,
                                    ),
                                  );
                                }}
                                placeholder="可留空"
                              />
                            </div>
                          </div>

                          <div className="sep" />
                          <div className="hint">
                            用下拉選單挑選（需要先匯入該供應商 services 清單）：
                          </div>
                          <ServicePicker
                            vendor={s.vendor}
                            currentServiceId={s.serviceId}
                            onPick={(svc) => {
                              upsertPlacement(
                                placement,
                                current.map((x, i) => (i === idx ? { ...x, serviceId: svc.id } : x)),
                              );
                            }}
                          />

                          <div className="actions" style={{ justifyContent: "space-between" }}>
                            <div>
                              <button
                                className="btn"
                                type="button"
                                onClick={() =>
                                  upsertPlacement(
                                    placement,
                                    current.map((x, i) => (i === idx ? { ...x, enabled: !x.enabled } : x)),
                                  )
                                }
                              >
                                {s.enabled ? "已啟用" : "已停用"}
                              </button>
                            </div>
                            <button
                              className="btn danger"
                              type="button"
                              onClick={() => upsertPlacement(placement, current.filter((_, i) => i !== idx))}
                            >
                              刪除
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="sep" />
            <div className="actions">
              <button className="btn" type="button" onClick={doReset}>
                重設預設值
              </button>
              <button className="btn" type="button" onClick={copyExport}>
                複製設定 JSON
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
              <div className="card-title">匯入設定（JSON）</div>
              <div className="card-desc">用於未來遷移或備份。匯入後會覆蓋現有設定。</div>
            </div>
            <span className="tag">import</span>
          </div>
          <div className="card-bd">
            <div className="field">
              <div className="label">貼上 JSON</div>
              <textarea rows={8} value={importJson} onChange={(e) => setImportJson(e.target.value)} placeholder="{ ... }" />
            </div>
            <div className="actions">
              <button className="btn primary" type="button" onClick={doImport} disabled={!importJson.trim()}>
                匯入並套用
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
