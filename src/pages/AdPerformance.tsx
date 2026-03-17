import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PRICING } from "../lib/pricing";
import { getConfig, getVendorLabel, type VendorKey } from "../config/appConfig";
import { findServiceName } from "../config/serviceCatalog";
import { getVendorKey } from "../config/vendorKeys";
import { normalizeStatusResponse, postSmmPanel, statusParamFor } from "../lib/vendorApi";
import { clearOrders, listOrders, updateOrder, type VendorSplitExec } from "../lib/ordersStore";
import { clearMetaOrders, listMetaOrders, updateMetaOrder, type MetaOrder } from "../lib/metaOrdersStore";
import { getMetaConfig } from "../config/metaConfig";
import { fetchMetaAdSnapshot, fetchMetaPostMetrics, updateMetaAdDelivery } from "../lib/metaGraphApi";
import { getGoalPrimaryMetricKey, getGoalPrimaryMetricLabel, META_AD_GOALS, type MetaKpiMetricKey } from "../lib/metaGoals";
import { SHARED_SYNC_EVENT } from "../lib/sharedSync";

function mapMetaStatus(s: string): MetaOrder["status"] {
  const v = s.toUpperCase();
  if (v.includes("PAUSED")) return "paused";
  if (v.includes("ACTIVE")) return "running";
  if (v.includes("DELETED") || v.includes("ARCHIVED")) return "completed";
  return "submitted";
}

const VENDOR_TERMINAL_STATUS = [
  "complete",
  "completed",
  "done",
  "success",
  "successful",
  "partial",
  "cancel",
  "canceled",
  "cancelled",
  "refund",
  "refunded",
  "fail",
  "failed",
  "error",
];

function isVendorSplitDone(split: VendorSplitExec): boolean {
  const status = String(split.vendorStatus ?? "").trim().toLowerCase();
  if (status && VENDOR_TERMINAL_STATUS.some((k) => status.includes(k))) return true;
  if (typeof split.remains === "number" && split.remains <= 0) return true;
  return false;
}

const META_AUTO_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const HOURLY_AUTO_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

function metricValueFromPerformance(row: MetaOrder, key: MetaKpiMetricKey): number | null {
  const hit = row.performance?.metrics?.find((m) => m.key === key);
  return typeof hit?.value === "number" ? hit.value : null;
}

export function AdPerformancePage() {
  const nav = useNavigate();
  const { user, signOut } = useAuth();
  const [refresh, setRefresh] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [vendorRefreshing, setVendorRefreshing] = useState(false);
  const [metaAutoEnabled, setMetaAutoEnabled] = useState(true);
  const [metaAutoRunning, setMetaAutoRunning] = useState(false);
  const [hourlyAutoRunning, setHourlyAutoRunning] = useState(false);
  const [hourlyAutoLastRunAt, setHourlyAutoLastRunAt] = useState<string | null>(null);

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

  const syncVendor = async (
    vendor: VendorKey,
    options?: { silent?: boolean },
  ): Promise<{ syncedCount: number; skipped: boolean; error?: string }> => {
    const vendorCfg = cfg.vendors.find((v) => v.key === vendor);
    if (!vendorCfg || !vendorCfg.enabled) {
      return { syncedCount: 0, skipped: true };
    }

    const key = getVendorKey(vendor);
    if (!key) {
      const error = `缺少 ${getVendorLabel(vendor)} API 金鑰`;
      if (!options?.silent) {
        setMsg(error);
        setTimeout(() => setMsg(null), 3000);
      }
      return { syncedCount: 0, skipped: false, error };
    }

    const ids: number[] = [];
    for (const o of orders) {
      for (const ln of o.lines) {
        for (const sp of ln.splits) {
          if (sp.vendor !== vendor || !sp.vendorOrderId) continue;
          if (isVendorSplitDone(sp)) continue;
          ids.push(sp.vendorOrderId);
        }
      }
    }
    const uniq = Array.from(new Set(ids)).filter((n) => Number.isFinite(n) && n > 0);
    if (uniq.length === 0) {
      return { syncedCount: 0, skipped: true };
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
              if (isVendorSplitDone(sp)) return sp;
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

      if (!options?.silent) {
        setMsg(`已同步 ${getVendorLabel(vendor)}：${uniq.length.toLocaleString()} 筆`);
        setTimeout(() => setMsg(null), 2500);
        setRefresh((x) => x + 1);
      }
      return { syncedCount: uniq.length, skipped: false };
    } catch (e) {
      const m = e instanceof Error ? e.message : "未知錯誤";
      if (!options?.silent) {
        setMsg(`同步失敗：${m}`);
        setTimeout(() => setMsg(null), 3500);
      }
      return { syncedCount: 0, skipped: false, error: m };
    } finally {
      setSyncFlag(syncKey, false);
    }
  };

  const refreshVendorTracking = async (options?: { silent?: boolean }) => {
    if (vendorRefreshing) return;
    setVendorRefreshing(true);
    try {
      const vendors: VendorKey[] = ["smmraja", "urpanel", "justanotherpanel"];
      let syncedCount = 0;
      const errors: string[] = [];

      for (const vendor of vendors) {
        // eslint-disable-next-line no-await-in-loop
        const result = await syncVendor(vendor, { silent: true });
        syncedCount += result.syncedCount;
        if (result.error) errors.push(`${getVendorLabel(vendor)}: ${result.error}`);
      }

      setRefresh((x) => x + 1);
      if (options?.silent) return;

      if (errors.length > 0) {
        setMsg(`同步完成，但有錯誤：${errors.join(" / ")}`);
        setTimeout(() => setMsg(null), 4000);
        return;
      }
      if (syncedCount === 0) {
        setMsg("目前沒有需要追蹤的廠商進行中案件。");
        setTimeout(() => setMsg(null), 2500);
        return;
      }

      setMsg(`已同步 ${syncedCount.toLocaleString()} 筆廠商進行中案件。`);
      setTimeout(() => setMsg(null), 2500);
    } finally {
      setVendorRefreshing(false);
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

  const syncMetaOne = async (
    row: MetaOrder,
    options?: { silent?: boolean; fromAutoLoop?: boolean },
  ): Promise<{ ok: boolean; pausedByTarget?: boolean }> => {
    const adId = row.submitResult?.adId;
    if (!adId) {
      if (!options?.silent) {
        setMsg("這筆資料缺少 ad_id");
        setTimeout(() => setMsg(null), 2500);
      }
      return { ok: false };
    }
    const syncKey = `meta:${row.id}`;
    setSyncFlag(syncKey, true);
    try {
      const result = await fetchMetaAdSnapshot({ cfg: metaCfg, adId, goal: row.goal });
      if (!result.ok) {
        updateMetaOrder(row.id, (r) => ({ ...r, error: result.detail ?? "同步失敗", targetLastCheckedAt: new Date().toISOString() }));
        if (!options?.silent) {
          setMsg(`Meta 同步失敗：${result.detail ?? "未知錯誤"}`);
          setTimeout(() => setMsg(null), 3500);
        }
        return { ok: false };
      }
      const statusText = result.statusText ?? "UNKNOWN";
      const metricKey = row.targetMetricKey ?? getGoalPrimaryMetricKey(row.goal);
      const target = row.targetValue ?? 0;
      let targetCurrent = metricValueFromPerformance({ ...row, performance: result.performance }, metricKey);
      let postError = "";

      if (row.trackingPostId) {
        const postMetrics = await fetchMetaPostMetrics({ cfg: metaCfg, postId: row.trackingPostId });
        if (postMetrics.ok) {
          const value = postMetrics.values?.[metricKey];
          if (typeof value === "number") targetCurrent = value;
        } else {
          postError = postMetrics.detail ?? "";
        }
      }

      const nowIso = new Date().toISOString();
      let nextStatus = mapMetaStatus(statusText);
      let nextApiStatus = statusText;
      let pausedByTarget = false;
      let reachedAt = row.targetReachedAt;

      const shouldCheckTarget = !!row.autoStopByTarget && target > 0 && targetCurrent != null;
      if (shouldCheckTarget && targetCurrent >= target) {
        const pauseResult = await updateMetaAdDelivery({ cfg: metaCfg, adId, status: "PAUSED" });
        if (pauseResult.ok) {
          pausedByTarget = true;
          nextStatus = "paused";
          nextApiStatus = pauseResult.statusText ?? "PAUSED";
          reachedAt = nowIso;
        } else if (!postError) {
          postError = pauseResult.detail ?? "達標停投失敗";
        }
      } else if (row.targetReachedAt) {
        reachedAt = undefined;
      }

      updateMetaOrder(row.id, (r) => ({
        ...r,
        status: nextStatus,
        apiStatusText: nextApiStatus,
        performance: result.performance,
        targetMetricKey: metricKey,
        targetCurrentValue: targetCurrent ?? undefined,
        targetLastCheckedAt: nowIso,
        targetReachedAt: reachedAt,
        error: postError,
      }));
      if (!options?.silent) {
        setMsg(pausedByTarget ? "已達目標，已自動暫停這筆 Meta 投放。" : `Meta 已同步：${adId}`);
        setTimeout(() => setMsg(null), 2200);
      }
      if (!options?.fromAutoLoop) setRefresh((x) => x + 1);
      return { ok: true, pausedByTarget };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "同步失敗";
      updateMetaOrder(row.id, (r) => ({
        ...r,
        error: errMsg,
        targetLastCheckedAt: new Date().toISOString(),
      }));
      if (!options?.silent) {
        setMsg(`Meta 同步失敗：${errMsg}`);
        setTimeout(() => setMsg(null), 3500);
      }
      return { ok: false };
    } finally {
      setSyncFlag(syncKey, false);
    }
  };

  const syncAllMeta = async (options?: { silent?: boolean; includePaused?: boolean }) => {
    const activeRows = metaRows.filter((row) => {
      if (!row.submitResult?.adId) return false;
      if (row.status === "running" || row.status === "submitted") return true;
      return !!options?.includePaused && row.status === "paused";
    });
    for (const row of activeRows) {
      // eslint-disable-next-line no-await-in-loop
      await syncMetaOne(row, { silent: options?.silent });
    }
  };

  const updateMetaDeliveryStatus = async (row: MetaOrder, nextStatus: "PAUSED" | "ACTIVE") => {
    const adId = row.submitResult?.adId;
    if (!adId) {
      setMsg("這筆資料缺少 ad_id，無法切換狀態。");
      setTimeout(() => setMsg(null), 2500);
      return;
    }

    const syncKey = `meta:${row.id}`;
    setSyncFlag(syncKey, true);
    try {
      const result = await updateMetaAdDelivery({ cfg: metaCfg, adId, status: nextStatus });
      if (!result.ok) {
        setMsg(`Meta 狀態更新失敗：${result.detail ?? "未知錯誤"}`);
        setTimeout(() => setMsg(null), 3500);
        return;
      }
      updateMetaOrder(row.id, (r) => ({
        ...r,
        status: mapMetaStatus(result.statusText ?? nextStatus),
        apiStatusText: result.statusText ?? nextStatus,
        error: "",
      }));
      setMsg(nextStatus === "PAUSED" ? "已暫停 Meta 投放。" : "已重新啟用 Meta 投放。");
      setTimeout(() => setMsg(null), 2200);
      setRefresh((x) => x + 1);
    } finally {
      setSyncFlag(syncKey, false);
    }
  };

  useEffect(() => {
    const tick = async () => {
      if (hourlyAutoRunning) return;
      setHourlyAutoRunning(true);
      try {
        await refreshVendorTracking({ silent: true });
        await syncAllMeta({ silent: true });
        setHourlyAutoLastRunAt(new Date().toISOString());
        setRefresh((x) => x + 1);
      } finally {
        setHourlyAutoRunning(false);
      }
    };

    const timer = window.setInterval(() => {
      void tick();
    }, HOURLY_AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [hourlyAutoRunning, orders.length, metaRows.length]);

  useEffect(() => {
    if (!metaAutoEnabled || metaAutoRunning) return;

    const tick = async () => {
      if (!metaAutoEnabled || metaAutoRunning) return;
      const candidates = listMetaOrders().filter((row) => {
        if (!row.submitResult?.adId) return false;
        if (!(row.status === "running" || row.status === "submitted")) return false;
        return !!row.autoStopByTarget && (row.targetValue ?? 0) > 0 && !!row.trackingPostId;
      });
      if (candidates.length === 0) return;

      setMetaAutoRunning(true);
      try {
        let pausedCount = 0;
        for (const row of candidates) {
          // eslint-disable-next-line no-await-in-loop
          const result = await syncMetaOne(row, { silent: true, fromAutoLoop: true });
          if (result.pausedByTarget) pausedCount += 1;
        }
        if (pausedCount > 0) {
          setMsg(`自動監控達標，已暫停 ${pausedCount} 筆 Meta 投放。`);
          setTimeout(() => setMsg(null), 3000);
        }
        setRefresh((x) => x + 1);
      } finally {
        setMetaAutoRunning(false);
      }
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, META_AUTO_CHECK_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [metaAutoEnabled, metaAutoRunning]);

  useEffect(() => {
    const onSharedSync = () => setRefresh((x) => x + 1);
    window.addEventListener(SHARED_SYNC_EVENT, onSharedSync);
    return () => window.removeEventListener(SHARED_SYNC_EVENT, onSharedSync);
  }, []);

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
            Meta 官方投廣
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
        <div className="card-bd">
          <div className="hint">
            其他使用者新增或更新案件後，這頁會自動帶入最新狀態與進度。
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            本頁開啟期間，系統會每小時自動更新一次進行中或尚未完成的案件進度；你也可以隨時手動同步。
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            頁面開啟期間會持續檢查最新狀態，方便多人同時追蹤同一批案件。
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            最近一次每小時自動更新：{hourlyAutoLastRunAt ? new Date(hourlyAutoLastRunAt).toLocaleString("zh-TW") : "尚未執行"}
            {hourlyAutoRunning ? "（同步中）" : ""}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <div>
            <div className="card-title">廠商互動成效</div>
            <div className="card-desc">查看拆單結果與供應商回傳狀態。</div>
          </div>
        </div>
        <div className="card-bd">
          <div className="actions inline">
            <button className="btn" type="button" onClick={() => setRefresh((x) => x + 1)}>
              重新整理
            </button>
            <button className="btn" type="button" onClick={refreshVendorTracking} disabled={vendorRefreshing}>
              {vendorRefreshing ? "同步中" : "同步進行中案件"}
            </button>
            <button
              className="btn danger"
              type="button"
              onClick={() => {
                clearOrders();
                setRefresh((x) => x + 1);
              }}
            >
              清空廠商案件
            </button>
          </div>

          <div className="sep" />

          {orders.length === 0 ? (
            <div className="hint">目前沒有廠商互動訂單。</div>
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
                        {ln.warnings.length > 0 ? (
                          <div className="hint" style={{ marginTop: 8, color: "rgba(245, 158, 11, 0.95)" }}>
                            {ln.warnings.join(" / ")}
                          </div>
                        ) : null}

                        {ln.splits.length === 0 ? (
                          <div className="hint">尚未設定可用服務。</div>
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
                                    <input value={s.vendorStatus ?? (s.vendorOrderId ? "待同步" : "未下單")} readOnly />
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
            <div className="card-title">Meta 官方投廣成效</div>
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
            <button className="btn" onClick={() => setMetaAutoEnabled((v) => !v)}>
              {metaAutoEnabled ? "自動停投：開啟" : "自動停投：關閉"}
            </button>
            <button
              className="btn danger"
              onClick={() => {
                clearMetaOrders();
                setRefresh((x) => x + 1);
              }}
            >
              清空 Meta 案件
            </button>
          </div>

          <div className="sep" />
          <div className="hint" style={{ marginBottom: 8 }}>
            本區會每小時自動同步進行中案件；若有設定目標停投，另會每 5 分鐘檢查一次。
          </div>

          <div className="hint" style={{ marginBottom: 8 }}>
            目標停投每 5 分鐘檢查一次執行中案件，達標後會自動暫停投放。
            {metaAutoRunning ? "（檢查中）" : ""}
          </div>

          {metaRows.length === 0 ? (
            <div className="hint">目前沒有 Meta 官方投廣案件。</div>
          ) : (
            <div className="list">
              {metaRows.map((r) => {
                const g = META_AD_GOALS[r.goal];
                const syncKey = `meta:${r.id}`;
                const adId = r.submitResult?.adId;
                const canPause = !!adId && r.status !== "paused";
                const canResume = !!adId && r.status === "paused";
                const metricLabel = getGoalPrimaryMetricLabel(r.goal);
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
                        <div className="label">追蹤貼文 ID</div>
                        <input value={r.trackingPostId ?? "-"} readOnly />
                      </div>
                      <div className="field">
                        <div className="label">目標進度</div>
                        <input
                          value={r.targetValue ? `${(r.targetCurrentValue ?? 0).toLocaleString("zh-TW")} / ${r.targetValue.toLocaleString("zh-TW")} ${metricLabel}` : "未設定"}
                          readOnly
                        />
                      </div>
                      <div className="field">
                        <div className="label">操作</div>
                        <div className="actions inline">
                          <button className="btn" onClick={() => syncMetaOne(r)} disabled={!!syncing[syncKey]}>
                            {syncing[syncKey] ? "同步中" : "同步"}
                          </button>
                          <button className="btn" onClick={() => updateMetaDeliveryStatus(r, "PAUSED")} disabled={!canPause || !!syncing[syncKey]}>
                            暫停
                          </button>
                          <button className="btn" onClick={() => updateMetaDeliveryStatus(r, "ACTIVE")} disabled={!canResume || !!syncing[syncKey]}>
                            重新啟用
                          </button>
                          <button className="btn" onClick={() => nav(`/meta-ads-orders?edit=${encodeURIComponent(r.id)}`)}>
                            重新編輯
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
                        {r.targetLastCheckedAt && (
                          <div className="hint" style={{ marginTop: 6 }}>
                            目標檢查時間：{new Date(r.targetLastCheckedAt).toLocaleString("zh-TW")}
                          </div>
                        )}
                        {r.targetReachedAt && (
                          <div className="hint" style={{ marginTop: 6, color: "rgba(16, 185, 129, 0.95)" }}>
                            已達目標並自動停投：{new Date(r.targetReachedAt).toLocaleString("zh-TW")}
                          </div>
                        )}
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
