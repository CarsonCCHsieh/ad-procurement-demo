import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { listOrders, clearOrders } from "../lib/ordersStore";
import { PRICING } from "../lib/pricing";
import { getConfig, getVendorLabel, type VendorKey } from "../config/appConfig";
import { useMemo, useState } from "react";
import { findServiceName } from "../config/serviceCatalog";
import { getVendorKey } from "../config/vendorKeys";
import { normalizeStatusResponse, postSmmPanel, statusParamFor } from "../lib/vendorApi";
import { updateOrder } from "../lib/ordersStore";

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

  const cfg = getConfig();

  const setSyncFlag = (k: string, v: boolean) => {
    setSyncing((s) => ({ ...s, [k]: v }));
  };

  const syncVendor = async (vendor: VendorKey) => {
    const vendorCfg = cfg.vendors.find((v) => v.key === vendor);
    if (!vendorCfg || !vendorCfg.enabled) {
      setMsg(`${getVendorLabel(vendor)} 已停用，無法同步。`);
      setTimeout(() => setMsg(null), 2500);
      return;
    }

    const key = getVendorKey(vendor);
    if (!key) {
      setMsg(`缺少 ${getVendorLabel(vendor)} API 金鑰。請到「控制設定」頁面輸入（僅測試）。`);
      setTimeout(() => setMsg(null), 3500);
      return;
    }

    // Collect all vendor order ids from local orders.
    const ids: number[] = [];
    for (const o of orders) {
      for (const ln of o.lines) {
        for (const sp of ln.splits) {
          if (sp.vendor !== vendor) continue;
          if (!sp.vendorOrderId) continue;
          ids.push(sp.vendorOrderId);
        }
      }
    }
    const uniq = Array.from(new Set(ids)).filter((n) => Number.isFinite(n) && n > 0);
    if (uniq.length === 0) {
      setMsg(`尚無 ${getVendorLabel(vendor)} 供應商訂單編號（vendorOrderId），可同步的訂單為 0。`);
      setTimeout(() => setMsg(null), 3000);
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

      // Update local storage orders with the new status.
      for (const o of orders) {
        updateOrder(o.id, (ord) => {
          const next = {
            ...ord,
            lines: ord.lines.map((ln) => ({
              ...ln,
              splits: ln.splits.map((sp) => {
                if (sp.vendor !== vendor) return sp;
                const oid = sp.vendorOrderId;
                if (!oid) return sp;
                const st = mapped[oid];
                if (!st) {
                  return { ...sp, lastSyncAt: new Date().toISOString(), error: "No status" };
                }
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
          };
          return next;
        });
      }

      setMsg(`已同步 ${getVendorLabel(vendor)} 狀態：${uniq.length.toLocaleString()} 筆`);
      setTimeout(() => setMsg(null), 2500);
      setRefresh((x) => x + 1);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Unknown error";
      setMsg(`同步失敗（${getVendorLabel(vendor)}）：${m}`);
      setTimeout(() => setMsg(null), 3500);
    } finally {
      setSyncFlag(syncKey, false);
    }
  };

  const setSplitOrderId = (orderId: string, lineIdx: number, splitIdx: number, vendorOrderIdRaw: string) => {
    const n = Number(vendorOrderIdRaw);
    updateOrder(orderId, (o) => {
      const lines = o.lines.map((ln, li) => {
        if (li !== lineIdx) return ln;
        const splits = ln.splits.map((sp, si) => (si === splitIdx ? { ...sp, vendorOrderId: Number.isFinite(n) ? n : undefined } : sp));
        return { ...ln, splits };
      });
      return { ...o, lines };
    });
    setRefresh((x) => x + 1);
  };

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">投放成效</div>
          <div className="brand-sub">目前顯示「已提交的拆單規劃」。串接供應商後，可在此同步狀態與成效。</div>
        </div>
        <div className="pill">
          <span className="tag">{user?.displayName ?? user?.username}</span>
          <button className="btn" onClick={() => nav("/ad-orders")}>
            回下單
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
        <div className="card" style={{ borderColor: "rgba(16, 185, 129, 0.45)" }}>
          <div className="card-bd">{msg}</div>
        </div>
      )}

      <div className="card">
        <div className="card-hd">
          <div>
            <div className="card-title">已提交工單</div>
            <div className="card-desc">資料儲存在瀏覽器暫存中，因此不同電腦或清除資料後會消失。</div>
          </div>
        </div>
        <div className="card-bd">
          <div className="actions" style={{ justifyContent: "space-between" }}>
            <button className="btn" type="button" onClick={() => setRefresh((x) => x + 1)}>
              重新整理
            </button>
            <div>
              <button className="btn" type="button" onClick={() => syncVendor("smmraja")} disabled={!!syncing["sync:smmraja"]}>
                同步 SMM Raja
              </button>
              <button className="btn" type="button" onClick={() => syncVendor("urpanel")} disabled={!!syncing["sync:urpanel"]}>
                同步 Urpanel
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => syncVendor("justanotherpanel")}
                disabled={!!syncing["sync:justanotherpanel"]}
              >
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
                清空工單
              </button>
            </div>
          </div>

          <div className="sep" />

          {orders.length === 0 ? (
            <div className="hint">尚無提交紀錄。請先到下單頁提交一筆。</div>
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

                  <div className="hint" style={{ marginTop: 6 }}>
                    申請人：{o.applicant} / 類型：{o.kind === "new" ? "新案" : "加購"} / 內部預估總價：NT$ {o.totalAmount.toLocaleString()}
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
                        <div className="hint" style={{ marginTop: 6 }}>
                          拆單：
                        </div>
                        {ln.splits.length === 0 ? (
                          <div className="hint">無（尚未設定服務編號（serviceId）或供應商被停用）</div>
                        ) : (
                          <div className="list" style={{ marginTop: 8 }}>
                            {ln.splits.map((s, splitIdx) => (
                              <div className="item" key={`${o.id}-${idx}-${s.vendor}-${s.serviceId}`}>
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

                                <div className="row cols3" style={{ marginTop: 10 }}>
                                  <div className="field">
                                    <div className="label">供應商訂單編號（vendorOrderId）</div>
                                    <input
                                      value={s.vendorOrderId == null ? "" : String(s.vendorOrderId)}
                                      inputMode="numeric"
                                      onChange={(e) => setSplitOrderId(o.id, idx, splitIdx, e.target.value)}
                                      placeholder="例如 123456（供應商回傳）"
                                    />
                                    <div className="hint">尚未串接下發時，可先手動填入用來測試同步流程。</div>
                                  </div>
                                  <div className="field">
                                    <div className="label">狀態</div>
                                    <input value={s.vendorStatus ?? (s.vendorOrderId ? "（尚未同步）" : "（未下發）")} readOnly />
                                    {s.error ? <div className="hint" style={{ color: "rgba(245, 158, 11, 0.95)" }}>{s.error}</div> : null}
                                  </div>
                                  <div className="field">
                                    <div className="label">剩餘數量（remains）</div>
                                    <input value={s.remains == null ? "" : String(s.remains)} readOnly />
                                    <div className="hint">
                                      最後同步：{s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString("zh-TW") : "-"}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {ln.warnings.length > 0 && (
                          <div className="hint" style={{ marginTop: 6, color: "rgba(245, 158, 11, 0.95)" }}>
                            {ln.warnings.join(" / ")}
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
    </div>
  );
}
