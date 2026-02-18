import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { listOrders, clearOrders } from "../lib/ordersStore";
import { PRICING } from "../lib/pricing";
import { getVendorLabel } from "../config/appConfig";
import { useMemo, useState } from "react";
import { findServiceName } from "../config/serviceCatalog";

export function AdPerformancePage() {
  const nav = useNavigate();
  const { user, signOut } = useAuth();
  const [refresh, setRefresh] = useState(0);

  const orders = useMemo(() => {
    void refresh;
    return listOrders();
  }, [refresh]);

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">投放成效（Demo 占位）</div>
          <div className="brand-sub">目前顯示「已提交的拆單計畫」，正式版再接 API 回寫狀態與成效。</div>
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

      <div className="card">
        <div className="card-hd">
          <div>
            <div className="card-title">已提交工單（Demo）</div>
            <div className="card-desc">資料儲存在瀏覽器 localStorage，因此不同電腦或清除資料後會消失。</div>
          </div>
          <span className="tag">#/ad-performance</span>
        </div>
        <div className="card-bd">
          <div className="actions" style={{ justifyContent: "space-between" }}>
            <button className="btn" type="button" onClick={() => setRefresh((x) => x + 1)}>
              重新整理
            </button>
            <button
              className="btn danger"
              type="button"
              onClick={() => {
                clearOrders();
                setRefresh((x) => x + 1);
              }}
            >
              清空（僅 Demo）
            </button>
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
                    申請人：{o.applicant} / 類型：{o.kind === "new" ? "新案" : "加購"} / 總價（暫定）：NT$ {o.totalAmount.toLocaleString()}
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
                          <div className="hint">無（尚未設定 serviceId 或供應商被停用）</div>
                        ) : (
                          <div className="list" style={{ marginTop: 8 }}>
                            {ln.splits.map((s) => (
                              <div className="item" key={`${o.id}-${idx}-${s.vendor}-${s.serviceId}`}>
                                <div className="item-hd">
                                  <div className="item-title">
                                    {getVendorLabel(s.vendor)} / serviceId {s.serviceId}
                                  </div>
                                  <div style={{ fontWeight: 800 }}>{s.quantity.toLocaleString()}</div>
                                </div>
                                {findServiceName(s.vendor, s.serviceId) && (
                                  <div className="hint" style={{ marginTop: 6 }}>
                                    {findServiceName(s.vendor, s.serviceId)}
                                  </div>
                                )}
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
