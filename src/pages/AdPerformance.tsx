import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { API_BASE, apiUrl } from "../lib/apiBase";
import { PRICING } from "../lib/pricing";
import { getConfig, getVendorLabel, type VendorKey } from "../config/appConfig";
import { getVendorKey } from "../config/vendorKeys";
import { normalizeStatusResponse, postSmmPanel, statusParamFor } from "../lib/vendorApi";
import { clearOrders, listOrders, updateOrder, type DemoOrder, type VendorSplitExec } from "../lib/ordersStore";
import { clearMetaOrders, listMetaOrders, updateMetaOrder, type MetaOrder } from "../lib/metaOrdersStore";
import { getMetaConfig } from "../config/metaConfig";
import { fetchMetaAdSnapshot, fetchMetaPostMetrics, updateMetaAdDelivery } from "../lib/metaGraphApi";
import { getGoalPrimaryMetricKey, getGoalPrimaryMetricLabel, META_AD_GOALS, type MetaKpiMetricKey } from "../lib/metaGoals";
import { fetchSharedValues, pullSharedState, SHARED_SYNC_EVENT } from "../lib/sharedSync";

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

function formatVendorUserMessage(error?: string): string {
  const raw = String(error ?? "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();

  if (lower.includes("not enough funds") || lower.includes("insufficient") || raw.includes("椁橀涓嶈冻")) {
    return "\u4f9b\u61c9\u5546\u9918\u984d\u4e0d\u8db3\uff0c\u8acb\u901a\u77e5\u7ba1\u7406\u54e1\u88dc\u5145\u9918\u984d\u5f8c\u518d\u91cd\u65b0\u9001\u55ae\u3002";
  }

  return raw;
}

const META_AUTO_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const HOURLY_AUTO_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const PLACEMENT_LABELS: Record<string, string> = {
  fb_like: "Facebook 貼文讚",
  fb_reach: "Facebook 觸及數",
  fb_video_views: "Facebook 影片觀看",
  ig_like: "Instagram 貼文讚",
  ig_reels_views: "Instagram Reels 觀看",
};

function metricValueFromPerformance(row: MetaOrder, key: MetaKpiMetricKey): number | null {
  const hit = row.performance?.metrics?.find((m) => m.key === key);
  return typeof hit?.value === "number" ? hit.value : null;
}

function summarizeVendorProgress(line: { splits: VendorSplitExec[]; warnings: string[] }): string {
  if (line.splits.length === 0) return "請通知管理員完成設定";
  const firstError = line.splits.map((split) => formatVendorUserMessage(split.error)).find(Boolean);
  if (firstError) return firstError;
  if (line.warnings.length > 0) return "請通知管理員確認設定";

  const statuses = Array.from(
    new Set(
      line.splits
        .map((split) => split.vendorStatus ?? (split.vendorOrderId ? "待更新" : "處理中"))
        .map((status) => String(status).trim())
        .filter(Boolean),
    ),
  );

  if (statuses.length === 0) return "處理中";
  if (statuses.length === 1) return statuses[0];
  return `${statuses[0]} 等 ${statuses.length} 筆`;
}

function summarizeVendorRemains(line: { quantity: number; splits: VendorSplitExec[] }): string {
  if (line.splits.length === 0) return "-";
  const values = line.splits
    .map((split) => (typeof split.remains === "number" && Number.isFinite(split.remains) ? split.remains : null))
    .filter((value): value is number => value != null);
  if (values.length === 0) return "-";
  return values.reduce((sum, value) => sum + value, 0).toLocaleString("zh-TW");
}

export function AdPerformancePage() {
  const nav = useNavigate();
  const { user, signOut, hasRole } = useAuth();
  const [refresh, setRefresh] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [vendorRefreshing, setVendorRefreshing] = useState(false);
  const [metaAutoEnabled, setMetaAutoEnabled] = useState(true);
  const [metaAutoRunning, setMetaAutoRunning] = useState(false);
  const [hourlyAutoRunning, setHourlyAutoRunning] = useState(false);
  const [hourlyAutoLastRunAt, setHourlyAutoLastRunAt] = useState<string | null>(null);
  const [remoteOrdersFallback, setRemoteOrdersFallback] = useState<DemoOrder[]>([]);

  const orders = useMemo(() => {
    void refresh;
    return listOrders();
  }, [refresh]);
  const metaRows = useMemo(() => {
    void refresh;
    return listMetaOrders();
  }, [refresh]);
  const vendorRows = useMemo(
    () =>
      orders.flatMap((order) =>
        order.lines.map((line, lineIndex) => ({
          id: `${order.id}-${lineIndex}`,
          applicant: order.applicant,
          caseName: order.caseName,
          orderNo: order.orderNo,
          kind: order.kind === "new" ? "新案" : "加購",
          amount: line.amount,
          remainsText: summarizeVendorRemains(line),
          progressText: summarizeVendorProgress(line),
          placementText: `${PLACEMENT_LABELS[line.placement] ?? line.placement} / 數量 ${line.quantity.toLocaleString("zh-TW")}`,
          lastSyncAt: line.splits
            .map((split) => split.lastSyncAt)
            .filter((value): value is string => !!value)
            .sort()
            .at(-1) ?? order.createdAt,
          hasWarning: line.warnings.length > 0 || line.splits.some((split) => !!split.error),
        })),
      ),
    [orders],
  );
  const vendorFallbackRows = useMemo(
    () =>
      remoteOrdersFallback.flatMap((order) =>
        order.lines.map((line, lineIndex) => ({
          id: `${order.id}-${lineIndex}`,
          applicant: order.applicant,
          caseName: order.caseName,
          orderNo: order.orderNo,
          kind: order.kind === "new" ? "新案" : "加購",
          amount: line.amount,
          remainsText: summarizeVendorRemains(line),
          progressText: summarizeVendorProgress(line),
          placementText: `${PLACEMENT_LABELS[line.placement] ?? line.placement} / 數量 ${line.quantity.toLocaleString("zh-TW")}`,
          lastSyncAt: line.splits
            .map((split) => split.lastSyncAt)
            .filter((value): value is string => !!value)
            .sort()
            .at(-1) ?? order.createdAt,
          hasWarning: line.warnings.length > 0 || line.splits.some((split) => !!split.error),
        })),
      ),
    [remoteOrdersFallback],
  );
  const visibleVendorRows = vendorRows.length > 0 ? vendorRows : vendorFallbackRows;
  const canManage = hasRole("admin");

  const cfg = getConfig();
  const metaCfg = getMetaConfig();

  const setSyncFlag = (k: string, v: boolean) => setSyncing((s) => ({ ...s, [k]: v }));

  const pullLatestOrders = async () => {
    try {
      await pullSharedState(["ad_demo_orders_v1", "ad_demo_meta_orders_v1"]);
      const remote = await fetchSharedValues(["ad_demo_orders_v1"]);
      const raw = remote.values.ad_demo_orders_v1;
      if (typeof raw === "string") {
        const parsed = JSON.parse(raw);
        setRemoteOrdersFallback(Array.isArray(parsed) ? (parsed as DemoOrder[]) : []);
      } else {
        setRemoteOrdersFallback([]);
      }
      setRefresh((x) => x + 1);
    } catch {
      try {
        const remote = await fetchSharedValues(["ad_demo_orders_v1"]);
        const raw = remote.values.ad_demo_orders_v1;
        if (typeof raw === "string") {
          const parsed = JSON.parse(raw);
          setRemoteOrdersFallback(Array.isArray(parsed) ? (parsed as DemoOrder[]) : []);
          setRefresh((x) => x + 1);
        }
      } catch {
        // Keep local state view if shared pull is temporarily unavailable.
      }
    }
  };

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
      const error = "系統尚未完成更新設定，請通知管理員處理。";
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
        setMsg(`\u5df2\u66f4\u65b0 ${uniq.length.toLocaleString()} \u7b46\u9032\u884c\u4e2d\u6848\u4ef6\u3002`);
        setTimeout(() => setMsg(null), 2500);
        setRefresh((x) => x + 1);
      }
      return { syncedCount: uniq.length, skipped: false };
    } catch (e) {
      const m = e instanceof Error ? e.message : "未知錯誤";
      if (!options?.silent) {
        setMsg(`\u540c\u6b65\u5931\u6557\uff1a${m}`);
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
      if (API_BASE) {
        const res = await fetch(apiUrl("/api/vendor/sync-shared-orders"), { method: "POST" });
        const data = (await res.json()) as { ok?: boolean; syncedCount?: number; error?: string };
        if (!res.ok || !data.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        await pullLatestOrders();
        if (options?.silent) return;

        if ((data.syncedCount ?? 0) === 0) {
          setMsg("目前沒有需要追蹤的進行中案件。");
          setTimeout(() => setMsg(null), 2500);
          return;
        }

        setMsg(`已更新 ${Number(data.syncedCount ?? 0).toLocaleString("zh-TW")} 筆進行中案件。`);
        setTimeout(() => setMsg(null), 2500);
        return;
      }

      const vendors: VendorKey[] = ["smmraja", "urpanel", "justanotherpanel"];
      let syncedCount = 0;
      const errors: string[] = [];

      for (const vendor of vendors) {
        // eslint-disable-next-line no-await-in-loop
        const result = await syncVendor(vendor, { silent: true });
        syncedCount += result.syncedCount;
        if (result.error) errors.push(formatVendorUserMessage(result.error));
      }

      setRefresh((x) => x + 1);
      if (options?.silent) return;

      if (errors.length > 0) {
        setMsg(`\u66f4\u65b0\u5b8c\u6210\uff0c\u4f46\u6709\u63d0\u9192\uff1a${errors.join(" / ")}`);
        setTimeout(() => setMsg(null), 4000);
        return;
      }
      if (syncedCount === 0) {
        setMsg("\u76ee\u524d\u6c92\u6709\u9700\u8981\u8ffd\u8e64\u7684\u9032\u884c\u4e2d\u6848\u4ef6\u3002");
        setTimeout(() => setMsg(null), 2500);
        return;
      }

      setMsg(`\u5df2\u66f4\u65b0 ${syncedCount.toLocaleString()} \u7b46\u9032\u884c\u4e2d\u6848\u4ef6\u3002`);
      setTimeout(() => setMsg(null), 2500);
    } finally {
      setVendorRefreshing(false);
    }
  };

  const syncMetaOne = async (
    row: MetaOrder,
    options?: { silent?: boolean; fromAutoLoop?: boolean },
  ): Promise<{ ok: boolean; pausedByTarget?: boolean }> => {
    const adId = row.submitResult?.adId;
    if (!adId) {
      if (!options?.silent) {
        setMsg("\u9019\u7b46\u8cc7\u6599\u7f3a\u5c11 ad_id");
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
          setMsg(`Meta \u540c\u6b65\u5931\u6557\uff1a${result.detail ?? "\u672a\u77e5\u932f\u8aa4"}`);
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
        setMsg(pausedByTarget ? "\u5df2\u9054\u76ee\u6a19\uff0c\u5df2\u81ea\u52d5\u66ab\u505c\u9019\u7b46\u6295\u653e\u3002" : `Meta \u5df2\u540c\u6b65\uff1a${adId}`);
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
        setMsg(`Meta \u540c\u6b65\u5931\u6557\uff1a${errMsg}`);
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
      setMsg("\u9019\u7b46\u8cc7\u6599\u7f3a\u5c11 ad_id\uff0c\u7121\u6cd5\u5207\u63db\u72c0\u614b\u3002");
      setTimeout(() => setMsg(null), 2500);
      return;
    }

    const syncKey = `meta:${row.id}`;
    setSyncFlag(syncKey, true);
    try {
      const result = await updateMetaAdDelivery({ cfg: metaCfg, adId, status: nextStatus });
      if (!result.ok) {
        setMsg(`Meta \u72c0\u614b\u66f4\u65b0\u5931\u6557\uff1a${result.detail ?? "\u672a\u77e5\u932f\u8aa4"}`);
        setTimeout(() => setMsg(null), 3500);
        return;
      }
      updateMetaOrder(row.id, (r) => ({
        ...r,
        status: mapMetaStatus(result.statusText ?? nextStatus),
        apiStatusText: result.statusText ?? nextStatus,
        error: "",
      }));
      setMsg(nextStatus === "PAUSED" ? "\u5df2\u66ab\u505c Meta \u6295\u653e\u3002" : "\u5df2\u91cd\u65b0\u555f\u7528 Meta \u6295\u653e\u3002");
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
          setMsg(`\u5df2\u81ea\u52d5\u66ab\u505c ${pausedCount} \u7b46\u5df2\u9054\u76ee\u6a19\u7684 Meta \u6295\u653e\u3002`);
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
    void pullLatestOrders();
  }, []);

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
          <div className="brand-sub">廠商互動與 Meta 投放都在這裡查看。</div>
        </div>
        <div className="pill">
          <span className="tag">{user?.displayName ?? user?.username}</span>
          <button className="btn" onClick={() => nav("/ad-orders")}>廠商互動下單</button>
          {canManage ? <button className="btn" onClick={() => nav("/meta-ads-orders")}>Meta官方投廣</button> : null}
          {canManage ? <button className="btn" onClick={() => nav("/settings")}>控制設定</button> : null}
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
          <div className="hint">其他同事新增或更新案件後，這頁會自動帶入最新狀態。</div>
          <div className="hint" style={{ marginTop: 6 }}>頁面開啟期間，系統每小時會自動更新一次進行中案件；你也可以手動同步。</div>
          <div className="hint" style={{ marginTop: 6 }}>最近一次每小時自動更新：{hourlyAutoLastRunAt ? new Date(hourlyAutoLastRunAt).toLocaleString("zh-TW") : "尚未執行"}{hourlyAutoRunning ? "（同步中）" : ""}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <div>
            <div className="card-title">廠商互動成效</div>
            <div className="card-desc">查看案件最新進度與執行結果。</div>
          </div>
        </div>
        <div className="card-bd">
          <div className="actions inline">
            <button className="btn" type="button" onClick={() => void pullLatestOrders()}>重新整理</button>
            <button className="btn" type="button" onClick={refreshVendorTracking} disabled={vendorRefreshing}>
              {vendorRefreshing ? "同步中" : "同步進行中案件"}
            </button>
            <button className="btn danger" type="button" onClick={() => { clearOrders(); setRefresh((x) => x + 1); }}>清空案件</button>
          </div>

          <div className="sep" />

          {visibleVendorRows.length === 0 ? (
            <div className="hint">目前沒有廠商互動案件。</div>
          ) : (
            <div className="dense-table performance-table">
              <div className="dense-th">申請人</div>
              <div className="dense-th">案件名</div>
              <div className="dense-th">案件種類</div>
              <div className="dense-th">金額</div>
              <div className="dense-th">剩餘數量</div>
              <div className="dense-th">執行進度</div>

              {visibleVendorRows.map((row) => (
                <div className="dense-tr" key={row.id}>
                  <div className="dense-td">
                    <div className="dense-title">{row.applicant}</div>
                  </div>
                  <div className="dense-td dense-main">
                    <div className="dense-title">{row.caseName}</div>
                    <div className="dense-meta">{row.orderNo} / {row.placementText}</div>
                  </div>
                  <div className="dense-td">
                    <div className="dense-title">{row.kind}</div>
                  </div>
                  <div className="dense-td">
                    <div className="dense-title">NT$ {row.amount.toLocaleString("zh-TW")}</div>
                  </div>
                  <div className="dense-td">
                    <div className="dense-title">{row.remainsText}</div>
                  </div>
                  <div className="dense-td dense-main">
                    <div className="dense-title" style={row.hasWarning ? { color: "rgba(220, 38, 38, 0.95)" } : undefined}>
                      {row.progressText}
                    </div>
                    <div className="dense-meta">
                      更新時間：{row.lastSyncAt ? new Date(row.lastSyncAt).toLocaleString("zh-TW") : "-"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {canManage ? (
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-hd">
          <div>
            <div className="card-title">Meta官方投廣成效</div>
            <div className="card-desc">查看投放進度、KPI 與控制操作。</div>
          </div>
        </div>
        <div className="card-bd">
          <div className="actions inline">
            <button className="btn" onClick={() => setRefresh((x) => x + 1)}>重新整理</button>
            <button className="btn" onClick={syncAllMeta}>全部同步</button>
            <button className="btn" onClick={() => setMetaAutoEnabled((value) => !value)}>{metaAutoEnabled ? "自動停投：開啟" : "自動停投：關閉"}</button>
            <button className="btn danger" onClick={() => { clearMetaOrders(); setRefresh((x) => x + 1); }}>清空 Meta 案件</button>
          </div>

          <div className="sep" />
          <div className="hint">本頁開啟期間，系統每小時會自動同步進行中案件；若有設定目標停投，另會每 5 分鐘檢查一次。</div>
          <div className="hint" style={{ marginTop: 6 }}>目標停投檢查：{metaAutoRunning ? "檢查中" : "待命中"}</div>

          {metaRows.length === 0 ? (
            <div className="hint">目前沒有 Meta 投放案件。</div>
          ) : (
            <div className="list">
              {metaRows.map((row) => {
                const goal = META_AD_GOALS[row.goal];
                const syncKey = `meta:${row.id}`;
                const adId = row.submitResult?.adId;
                const canPause = !!adId && row.status !== "paused";
                const canResume = !!adId && row.status === "paused";
                const metricLabel = getGoalPrimaryMetricLabel(row.goal);
                return (
                  <div className="item" key={row.id}>
                    <div className="item-hd">
                      <div className="item-title">{row.campaignName}</div>
                      <span className="tag">{new Date(row.createdAt).toLocaleString("zh-TW")}</span>
                    </div>

                    <div className="row cols2">
                      <div className="field">
                        <div className="label">投放目標</div>
                        <input value={goal.label} readOnly />
                      </div>
                      <div className="field">
                        <div className="label">目前狀態</div>
                        <input value={row.apiStatusText ?? row.status} readOnly />
                      </div>
                      <div className="field">
                        <div className="label">目標進度</div>
                        <input value={row.targetValue ? `${(row.targetCurrentValue ?? 0).toLocaleString("zh-TW")} / ${row.targetValue.toLocaleString("zh-TW")} ${metricLabel}` : "未設定"} readOnly />
                      </div>
                      <div className="field">
                        <div className="label">操作</div>
                        <div className="actions inline">
                          <button className="btn" onClick={() => syncMetaOne(row)} disabled={!!syncing[syncKey]}>{syncing[syncKey] ? "同步中" : "同步"}</button>
                          <button className="btn" onClick={() => updateMetaDeliveryStatus(row, "PAUSED")} disabled={!canPause || !!syncing[syncKey]}>暫停</button>
                          <button className="btn" onClick={() => updateMetaDeliveryStatus(row, "ACTIVE")} disabled={!canResume || !!syncing[syncKey]}>重新啟用</button>
                          <button className="btn" onClick={() => nav(`/meta-ads-orders?edit=${encodeURIComponent(row.id)}`)}>重新編輯</button>
                        </div>
                      </div>
                    </div>

                    {row.performance?.metrics?.length ? (
                      <>
                        <div className="sep" />
                        <div className="dense-table">
                          <div className="dense-th">指標</div>
                          <div className="dense-th">數值</div>
                          {row.performance.metrics.map((metric) => (
                            <div className="dense-tr" key={`${row.id}-${metric.key}`}>
                              <div className="dense-td"><div className="dense-title">{metric.label}</div></div>
                              <div className="dense-td"><div className="dense-title">{metric.value.toLocaleString("zh-TW")}</div></div>
                            </div>
                          ))}
                        </div>
                        {row.performance.updatedAt ? <div className="hint" style={{ marginTop: 8 }}>{new Date(row.performance.updatedAt).toLocaleString("zh-TW")}</div> : null}
                        {row.targetLastCheckedAt ? <div className="hint" style={{ marginTop: 6 }}>{`目標檢查時間：${new Date(row.targetLastCheckedAt).toLocaleString("zh-TW")}`}</div> : null}
                        {row.targetReachedAt ? <div className="hint" style={{ marginTop: 6, color: "rgba(16, 185, 129, 0.95)" }}>{`已達目標並自動停止：${new Date(row.targetReachedAt).toLocaleString("zh-TW")}`}</div> : null}
                      </>
                    ) : (
                      <div className="hint" style={{ marginTop: 8 }}>尚未同步 KPI</div>
                    )}

                    {row.error ? <div className="hint" style={{ marginTop: 8, color: "rgba(220, 38, 38, 0.95)" }}>{row.error}</div> : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      ) : null}
    </div>
  );
}
