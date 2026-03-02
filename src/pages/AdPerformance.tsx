import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PRICING } from "../lib/pricing";
import { getConfig, getVendorLabel, type VendorKey } from "../config/appConfig";
import { findServiceName } from "../config/serviceCatalog";
import { getVendorKey } from "../config/vendorKeys";
import { normalizeStatusResponse, postSmmPanel, statusParamFor } from "../lib/vendorApi";
import { clearOrders, listOrders, updateOrder } from "../lib/ordersStore";
import { clearMetaOrders, listMetaOrders, updateMetaOrder, type MetaOrder } from "../lib/metaOrdersStore";
import { getMetaConfig } from "../config/metaConfig";
import { fetchMetaAdSnapshot } from "../lib/metaGraphApi";
import { META_AD_GOALS } from "../lib/metaGoals";

function mapMetaStatus(s: string): MetaOrder["status"] {
  const v = s.toUpperCase();
  if (v.includes("PAUSED")) return "paused";
  if (v.includes("ACTIVE")) return "running";
  if (v.includes("DELETED") || v.includes("ARCHIVED")) return "completed";
  return "submitted";
}

export function AdPerformancePage() {
  const nav = useNavigate();
  const { user, signOut } = useAuth();
  const [refresh, setRefresh] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});

  const orders = useMemo(() => {
    void refresh;
    return listOrders();
  }, [refresh]);
  const metaRows = useMemo(() => {
    void refresh;
    return listMetaOrders();
  }, [refresh]);

  const cfg = getConfig();
  const metaCfg = getMetaConfig();

  const setSyncFlag = (k: string, v: boolean) => setSyncing((s) => ({ ...s, [k]: v }));

  const syncVendor = async (vendor: VendorKey) => {
    const vendorCfg = cfg.vendors.find((v) => v.key === vendor);
    if (!vendorCfg || !vendorCfg.enabled) {
      setMsg(`${getVendorLabel(vendor)} 已停用`);
      setTimeout(() => setMsg(null), 2500);
      return;
    }

    const key = getVendorKey(vendor);
    if (!key) {
      setMsg(`缺少 ${getVendorLabel(vendor)} API 金鑰`);
      setTimeout(() => setMsg(null), 3000);
      return;
    }

    const ids: number[] = [];
    for (const o of orders) {
      for (const ln of o.lines) {
        for (const sp of ln.splits) {
          if (sp.vendor === vendor && sp.vendorOrderId) ids.push(sp.vendorOrderId);
        }
      }
    }
    const uniq = Array.from(new Set(ids)).filter((n) => Number.isFinite(n) && n > 0);
    if (uniq.length === 0) {
      setMsg(`${getVendorLabel(vendor)} 尚無可同步訂單`);
      setTimeout(() => setMsg(null), 2500);
      return;
    }

    const syncKey = `sync:${vendor}`;
    setSyncFlag(syncKey, true);
    try {
      const param = statusParamFor(vendor, uniq);
      const resp = await postSmmPanel({
        baseUrl: vendorCfg.apiBaseUrl,
        key,
        action: "status",
        payload: { [param.key]: param.value },
      });
      const mapped = normalizeStatusResponse(uniq, resp);

      for (const o of orders) {
        updateOrder(o.id, (ord) => ({
          ...ord,
          lines: ord.lines.map((ln) => ({
            ...ln,
            splits: ln.splits.map((sp) => {
              if (sp.vendor !== vendor || !sp.vendorOrderId) return sp;
              const st = mapped[sp.vendorOrderId];
              if (!st) return { ...sp, lastSyncAt: new Date().toISOString(), error: "No status" };
              return {
                ...sp,
                vendorStatus: st.status ?? sp.vendorStatus,
                remains: st.remains ?? sp.remains,
                startCount: st.start_count ?? sp.startCount,
                charge: st.charge ?? sp.charge,
                currency: st.currency ?? sp.currency,
                lastSyncAt: new Date().toISOString(),
                error: st.error ?? "",
              };
            }),
          })),
        }));
      }

      setMsg(`已同步 ${getVendorLabel(vendor)}：${uniq.length.toLocaleString()} 筆`);
      setTimeout(() => setMsg(null), 2500);
      setRefresh((x) => x + 1);
    } catch (e) {
      const m = e instanceof Error ? e.message : "未知錯誤";
      setMsg(`同步失敗：${m}`);
      setTimeout(() => setMsg(null), 3500);
    } finally {
      setSyncFlag(syncKey, false);
    }
  };

  const setSplitOrderId = (orderId: string, lineIdx: number, splitIdx: number, vendorOrderIdRaw: string) => {
    const n = Number(vendorOrderIdRaw);
    updateOrder(orderId, (o) => ({
      ...o,
      lines: o.lines.map((ln, li) =>
        li !== lineIdx
          ? ln
          : {
              ...ln,
              splits: ln.splits.map((sp, si) => (si === splitIdx ? { ...sp, vendorOrderId: Number.isFinite(n) ? n : undefined } : sp)),
            },
      ),
    }));
    setRefresh((x) => x + 1);
  };

  const syncMetaOne = async (row: MetaOrder) => {
    const adId = row.submitResult?.adId;
    if (!adId) {
      setMsg("此筆缺少 ad_id");
      setTimeout(() => setMsg(null), 2500);
      return;
    }
    const syncKey = `meta:${row.id}`;
    setSyncFlag(syncKey, true);
    try {
      const result = await fetchMetaAdSnapshot({ cfg: metaCfg, adId, goal: row.goal });
      if (!result.ok) {
        updateMetaOrder(row.id, (r) => ({ ...r, error: result.detail ?? "同步失敗" }));
        setMsg(`Meta 同步失敗：${result.detail ?? "未知錯誤"}`);
        setTimeout(() => setMsg(null), 3500);
        return;
      }
      const statusText = result.statusText ?? "UNKNOWN";
      updateMetaOrder(row.id, (r) => ({
        ...r,
        status: mapMetaStatus(statusText),
        apiStatusText: statusText,
        performance: result.performance,
        error: "",
      }));
      setMsg(`Meta 已同步：${adId}`);
      setTimeout(() => setMsg(null), 2200);
      setRefresh((x) => x + 1);
    } finally {
      setSyncFlag(syncKey, false);
    }
  };

  const syncAllMeta = async () => {
    for (const row of metaRows) {
      // eslint-disable-next-line no-await-in-loop
      await syncMetaOne(row);
    }
  };

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">投放成效</div>
          <div className="brand-sub">廠商互動與 Meta 官方投廣都在這裡查看。</div>
        </div>
        <div className="pill">
          <span className="tag">{user?.displayName ?? user?.username}</span>
          <button className="btn" onClick={() => nav("/ad-orders")}>
            廠商互動下單
          </button>
          <button className="btn" onClick={() => nav("/meta-ads-orders")}>
            Meta官方投廣
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

      {msg && (
        <div className="card">
          <div className="card-bd">{msg}</div>
        </div>
      )}

      <div className="card">
        <div className="card-hd">
          <div>
            <div className="card-title">廠商互動成效</div>
            <div className="card-desc">查看拆單結果與廠商回傳狀態。</div>
          </div>
        </div>
        <div className="card-bd">
          <div className="actions inline">
            <button className="btn" type="button" onClick={() => setRefresh((x) => x + 1)}>
              重新整理
            </button>
            <button className="btn" type="button" onClick={() => syncVendor("smmraja")} disabled={!!syncing["sync:smmraja"]}>
              同步 SMM Raja
            </button>
            <button className="btn" type="button" onClick={() => syncVendor("urpanel")} disabled={!!syncing["sync:urpanel"]}>
              同步 Urpanel
            </button>
            <button className="btn" type="button" onClick={() => syncVendor("justanotherpanel")} disabled={!!syncing["sync:justanotherpanel"]}>
              同步 JAP
            </button>
            <button
              className="btn danger"
              type="button"
              onClick={() => {
                clearOrders();
                setRefresh((x) => x + 1);
              }}
            >
              清空廠商紀錄
            </button>
          </div>

          <div className="sep" />

          {orders.length === 0 ? (
            <div className="hint">尚無廠商互動下單紀錄。</div>
          ) : (
            <div className="list">
              {orders.map((o) => (
                <div className="item" key={o.id}>
                  <div className="item-hd">
                    <div className="item-title">
                      {o.orderNo} / {o.caseName}
                    </div>
                    <span className="tag">{new Date(o.createdAt).toLocaleString("zh-TW")}</span>
                  </div>

                  <div className="hint">
                    申請人：{o.applicant} / 類型：{o.kind === "new" ? "新案" : "加購"} / 金額：NT$ {o.totalAmount.toLocaleString()}
                  </div>

                  <div className="sep" />
                  <div className="list">
                    {o.lines.map((ln, idx) => (
                      <div className="item" key={`${o.id}-${idx}`}>
                        <div className="item-hd">
                          <div className="item-title">
                            {PRICING[ln.placement]?.label ?? ln.placement} / 數量 {ln.quantity.toLocaleString()}
                          </div>
                          <div style={{ fontWeight: 800 }}>NT$ {ln.amount.toLocaleString()}</div>
                        </div>

                        {ln.splits.length === 0 ? (
                          <div className="hint">尚未設定可用服務</div>
                        ) : (
                          <div className="list" style={{ marginTop: 8 }}>
                            {ln.splits.map((s, splitIdx) => (
                              <div className="item" key={`${o.id}-${idx}-${s.vendor}-${s.serviceId}`}>
                                <div className="item-hd">
                                  <div className="item-title">
                                    {getVendorLabel(s.vendor)} / 服務編號 {s.serviceId}
                                  </div>
                                  <div style={{ fontWeight: 800 }}>{s.quantity.toLocaleString()}</div>
                                </div>

                                {findServiceName(s.vendor, s.serviceId) && <div className="hint">{findServiceName(s.vendor, s.serviceId)}</div>}

                                <div className="row cols3" style={{ marginTop: 10 }}>
                                  <div className="field">
                                    <div className="label">廠商訂單編號</div>
                                    <input
                                      value={s.vendorOrderId == null ? "" : String(s.vendorOrderId)}
                                      inputMode="numeric"
                                      onChange={(e) => setSplitOrderId(o.id, idx, splitIdx, e.target.value)}
                                      placeholder="例如 123456"
                                    />
                                  </div>
                                  <div className="field">
                                    <div className="label">狀態</div>
                                    <input value={s.vendorStatus ?? (s.vendorOrderId ? "待同步" : "未下發")} readOnly />
                                    {s.error ? <div className="hint" style={{ color: "rgba(245, 158, 11, 0.95)" }}>{s.error}</div> : null}
                                  </div>
                                  <div className="field">
                                    <div className="label">剩餘數量</div>
                                    <input value={s.remains == null ? "" : String(s.remains)} readOnly />
                                    <div className="hint">{s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString("zh-TW") : "-"}</div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-hd">
          <div>
            <div className="card-title">Meta官方投廣成效</div>
            <div className="card-desc">查看官方投廣狀態與 KPI。</div>
          </div>
        </div>
        <div className="card-bd">
          <div className="actions inline">
            <button className="btn" onClick={() => setRefresh((x) => x + 1)}>
              重新整理
            </button>
            <button className="btn" onClick={syncAllMeta}>
              全部同步
            </button>
            <button
              className="btn danger"
              onClick={() => {
                clearMetaOrders();
                setRefresh((x) => x + 1);
              }}
            >
              清空 Meta 紀錄
            </button>
          </div>

          <div className="sep" />

          {metaRows.length === 0 ? (
            <div className="hint">尚無 Meta 官方投廣紀錄。</div>
          ) : (
            <div className="list">
              {metaRows.map((r) => {
                const g = META_AD_GOALS[r.goal];
                const syncKey = `meta:${r.id}`;
                return (
                  <div className="item" key={r.id}>
                    <div className="item-hd">
                      <div className="item-title">{r.campaignName}</div>
                      <span className="tag">{new Date(r.createdAt).toLocaleString("zh-TW")}</span>
                    </div>

                    <div className="row cols2">
                      <div className="field">
                        <div className="label">投放目標</div>
                        <input value={g.label} readOnly />
                      </div>
                      <div className="field">
                        <div className="label">目前狀態</div>
                        <input value={r.apiStatusText ?? r.status} readOnly />
                      </div>
                      <div className="field">
                        <div className="label">Campaign / AdSet / Ad</div>
                        <input value={`${r.submitResult?.campaignId ?? "-"} / ${r.submitResult?.adsetId ?? "-"} / ${r.submitResult?.adId ?? "-"}`} readOnly />
                      </div>
                      <div className="field">
                        <div className="label">操作</div>
                        <div className="actions inline">
                          <button className="btn" onClick={() => syncMetaOne(r)} disabled={!!syncing[syncKey]}>
                            {syncing[syncKey] ? "同步中" : "同步"}
                          </button>
                        </div>
                      </div>
                    </div>

                    {r.performance?.metrics?.length ? (
                      <>
                        <div className="sep" />
                        <div className="dense-table">
                          <div className="dense-th">指標</div>
                          <div className="dense-th">數值</div>
                          {r.performance.metrics.map((m) => (
                            <div className="dense-tr" key={`${r.id}-${m.key}`}>
                              <div className="dense-td">
                                <div className="dense-title">{m.label}</div>
                              </div>
                              <div className="dense-td">
                                <div className="dense-title">{m.value.toLocaleString("zh-TW")}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                        {r.performance.updatedAt && <div className="hint" style={{ marginTop: 8 }}>{new Date(r.performance.updatedAt).toLocaleString("zh-TW")}</div>}
                      </>
                    ) : (
                      <div className="hint" style={{ marginTop: 8 }}>尚未同步 KPI</div>
                    )}

                    {r.error ? <div className="hint" style={{ marginTop: 8, color: "rgba(220, 38, 38, 0.95)" }}>{r.error}</div> : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

