import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getMetaConfig } from "../config/metaConfig";
import { fetchMetaAdStatus } from "../lib/metaGraphApi";
import { clearMetaOrders, listMetaOrders, updateMetaOrder, type MetaOrder } from "../lib/metaOrdersStore";
import { META_AD_GOALS } from "../lib/metaGoals";

function mapStatus(s: string): MetaOrder["status"] {
  const v = s.toUpperCase();
  if (v.includes("PAUSED")) return "paused";
  if (v.includes("ACTIVE")) return "running";
  if (v.includes("DELETED") || v.includes("ARCHIVED")) return "completed";
  return "submitted";
}

export function MetaAdsPerformancePage() {
  const nav = useNavigate();
  const { user, signOut } = useAuth();
  const [refresh, setRefresh] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});

  const cfg = getMetaConfig();
  const rows = useMemo(() => {
    void refresh;
    return listMetaOrders();
  }, [refresh]);

  const syncOne = async (row: MetaOrder) => {
    const adId = row.submitResult?.adId;
    if (!adId) {
      setMsg("這筆紀錄尚無 ad_id，暫時無法同步。");
      setTimeout(() => setMsg(null), 2600);
      return;
    }
    const key = `sync:${row.id}`;
    setSyncing((s) => ({ ...s, [key]: true }));
    try {
      const result = await fetchMetaAdStatus({ cfg, adId });
      if (!result.ok) {
        updateMetaOrder(row.id, (r) => ({ ...r, error: result.detail ?? "同步失敗" }));
        setMsg(`同步失敗：${result.detail ?? "未知錯誤"}`);
        setTimeout(() => setMsg(null), 3500);
        return;
      }
      const statusText = result.statusText ?? "UNKNOWN";
      updateMetaOrder(row.id, (r) => ({
        ...r,
        status: mapStatus(statusText),
        apiStatusText: statusText,
        error: "",
      }));
      setMsg(`已同步 ad ${adId}：${statusText}`);
      setTimeout(() => setMsg(null), 2600);
      setRefresh((x) => x + 1);
    } finally {
      setSyncing((s) => ({ ...s, [key]: false }));
    }
  };

  const syncAll = async () => {
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      await syncOne(row);
    }
  };

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">Meta 投放成效</div>
          <div className="brand-sub">顯示 Meta 投放建立結果與同步狀態（模擬模式只回傳假狀態）。</div>
        </div>
        <div className="pill">
          <span className="tag">{user?.displayName ?? user?.username}</span>
          <button className="btn" onClick={() => nav("/meta-ads-orders")}>
            Meta 下單
          </button>
          <button className="btn" onClick={() => nav("/ad-orders")}>
            SMM 下單
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
            <div className="card-title">Meta 投放紀錄</div>
            <div className="card-desc">
              目前模式：{cfg.mode === "simulate" ? "模擬模式" : "正式模式"} / 廣告帳號：{cfg.adAccountId || "(未填)"}
            </div>
          </div>
        </div>
        <div className="card-bd">
          <div className="actions inline">
            <button className="btn" onClick={() => setRefresh((x) => x + 1)}>
              重新整理
            </button>
            <button className="btn" onClick={syncAll}>
              全部同步
            </button>
            <button
              className="btn danger"
              onClick={() => {
                clearMetaOrders();
                setRefresh((x) => x + 1);
              }}
            >
              清空紀錄
            </button>
          </div>

          <div className="sep" />

          {rows.length === 0 ? (
            <div className="hint">尚無 Meta 下單紀錄。</div>
          ) : (
            <div className="list">
              {rows.map((r) => {
                const g = META_AD_GOALS[r.goal];
                const syncKey = `sync:${r.id}`;
                return (
                  <div className="item" key={r.id}>
                    <div className="item-hd">
                      <div className="item-title">{r.title}</div>
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
                        <input
                          value={`${r.submitResult?.campaignId ?? "-"} / ${r.submitResult?.adsetId ?? "-"} / ${r.submitResult?.adId ?? "-"}`}
                          readOnly
                        />
                      </div>
                      <div className="field">
                        <div className="label">操作</div>
                        <div className="actions inline">
                          <button className="btn" onClick={() => syncOne(r)} disabled={!!syncing[syncKey]}>
                            {syncing[syncKey] ? "同步中..." : "同步狀態"}
                          </button>
                        </div>
                      </div>
                    </div>

                    {r.error ? (
                      <div className="hint" style={{ marginTop: 8, color: "rgba(220, 38, 38, 0.95)" }}>
                        {r.error}
                      </div>
                    ) : null}

                    <details style={{ marginTop: 10 }}>
                      <summary style={{ cursor: "pointer", fontWeight: 700 }}>檢視 Payload 與 API Log</summary>
                      <div className="hint" style={{ marginTop: 8 }}>Campaign</div>
                      <textarea rows={4} readOnly value={JSON.stringify(r.payloads.campaign, null, 2)} />
                      <div className="hint" style={{ marginTop: 8 }}>AdSet</div>
                      <textarea rows={5} readOnly value={JSON.stringify(r.payloads.adset, null, 2)} />
                      <div className="hint" style={{ marginTop: 8 }}>Creative</div>
                      <textarea rows={5} readOnly value={JSON.stringify(r.payloads.creative, null, 2)} />
                      <div className="hint" style={{ marginTop: 8 }}>Ad</div>
                      <textarea rows={4} readOnly value={JSON.stringify(r.payloads.ad, null, 2)} />
                      <div className="hint" style={{ marginTop: 8 }}>API Log</div>
                      <textarea rows={4} readOnly value={JSON.stringify(r.submitResult?.requestLogs ?? [], null, 2)} />
                    </details>
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

