import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { API_BASE, apiUrl } from "../lib/apiBase";
import { getConfig, getPlacementLabel, type VendorKey } from "../config/appConfig";
import { getVendorKey } from "../config/vendorKeys";
import { normalizeStatusResponse, postSmmPanel, statusParamFor } from "../lib/vendorApi";
import {
  clearOrders,
  listOrders,
  removeOrder,
  updateOrder,
  type DemoOrder,
  type DemoOrderBatch,
  type VendorSplitExec,
} from "../lib/ordersStore";
import { clearMetaOrders, listMetaOrders, updateMetaOrder, type MetaOrder } from "../lib/metaOrdersStore";
import { getMetaConfig } from "../config/metaConfig";
import { fetchMetaAdSnapshot, fetchMetaPostMetrics, updateMetaAdDelivery } from "../lib/metaGraphApi";
import { getGoalPrimaryMetricKey, getGoalPrimaryMetricLabel, META_AD_GOALS, type MetaKpiMetricKey } from "../lib/metaGoals";
import { fetchSharedValues, flushAllSharedState, pullSharedState, SHARED_SYNC_EVENT } from "../lib/sharedSync";
import { getLineBatches } from "../lib/orderSchedule";

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
  if (status && VENDOR_TERMINAL_STATUS.some((keyword) => status.includes(keyword))) return true;
  if (typeof split.remains === "number" && split.remains <= 0) return true;
  return false;
}

function formatVendorUserMessage(error?: string): string {
  const raw = String(error ?? "").trim();
  if (!raw) return "";

  const lower = raw.toLowerCase();
  if (lower.includes("not enough funds") || lower.includes("insufficient") || raw.includes("餘額不足")) {
    return "供應商餘額不足，請通知管理員補充餘額後再重新送單。";
  }

  return raw;
}

const META_AUTO_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const HOURLY_AUTO_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const VENDOR_POST_METRIC_ENABLED = false;

function metricValueFromPerformance(row: MetaOrder, key: MetaKpiMetricKey): number | null {
  const hit = row.performance?.metrics?.find((metric) => metric.key === key);
  return typeof hit?.value === "number" ? hit.value : null;
}

function summarizeVendorProgress(batch: { splits: VendorSplitExec[]; warnings: string[] }): string {
  if (batch.splits.length === 0) return "請通知管理員完成設定。";

  const firstError = batch.splits.map((split) => formatVendorUserMessage(split.error)).find(Boolean);
  if (firstError) return firstError;
  if (batch.warnings.length > 0) return "請通知管理員確認設定。";

  const statuses = Array.from(
    new Set(
      batch.splits
        .map((split) => split.vendorStatus ?? (split.vendorOrderId ? "待更新" : "處理中"))
        .map((status) => String(status).trim())
        .filter(Boolean),
    ),
  );

  if (statuses.length === 0) return "處理中";
  if (statuses.length === 1) return statuses[0];
  return `${statuses[0]} 等 ${statuses.length} 項`;
}

function summarizeVendorRemains(batch: { splits: VendorSplitExec[] }): string {
  if (batch.splits.length === 0) return "-";
  const values = batch.splits
    .map((split) => (typeof split.remains === "number" && Number.isFinite(split.remains) ? split.remains : null))
    .filter((value): value is number => value != null);
  if (values.length === 0) return "-";
  return values.reduce((sum, value) => sum + value, 0).toLocaleString("zh-TW");
}

function summarizeVendorRemainsValue(batch: { splits: VendorSplitExec[] }): number | null {
  if (batch.splits.length === 0) return null;
  const values = batch.splits
    .map((split) => (typeof split.remains === "number" && Number.isFinite(split.remains) ? split.remains : null))
    .filter((value): value is number => value != null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function summarizeBatchProgress(batch: DemoOrderBatch): string {
  if (batch.status === "scheduled") {
    return batch.plannedDate ? `預計 ${batch.plannedDate} 送出` : "待送出";
  }
  return summarizeVendorProgress(batch);
}

function summarizeBatchRemains(batch: DemoOrderBatch): string {
  if (batch.status === "scheduled") return batch.quantity.toLocaleString("zh-TW");
  return summarizeVendorRemains(batch);
}

function sanitizeDisplayText(value: unknown, fallback = ""): string {
  const text = String(value ?? "").replace(/\uFFFD+/g, "").trim();
  return text || fallback;
}

type VendorRow = {
  id: string;
  orderId: string;
  lineIndex: number;
  batchId: string;
  applicant: string;
  caseName: string;
  orderNo: string;
  kind: string;
  amount: number;
  quantity: number;
  remainsValue: number | null;
  remainsText: string;
  progressText: string;
  placementText: string;
  link: string;
  metricKey?: MetaKpiMetricKey;
  metricLabel: string;
  lastSyncAt?: string;
  hasWarning: boolean;
  canRetry: boolean;
  appendStatusText?: string;
  appendWarning?: boolean;
};

type VendorMetricState = {
  loading?: boolean;
  value?: number;
  updatedAt?: string;
  error?: string;
  source?: "meta" | "estimated";
};

const VENDOR_METRIC_BY_PLACEMENT: Partial<Record<string, { key: MetaKpiMetricKey; label: string }>> = {
  fb_like: { key: "likes", label: "目前按讚" },
  ig_like: { key: "likes", label: "目前按讚" },
  fb_reach: { key: "reach", label: "目前觸及" },
  fb_video_views: { key: "video_3s_views", label: "目前播放" },
  ig_reels_views: { key: "video_3s_views", label: "目前播放" },
};

function isBatchRetryable(batch: DemoOrderBatch): boolean {
  if (batch.status === "scheduled") return false;
  return batch.splits.some((split) => !split.vendorOrderId && (!!split.error || String(split.vendorStatus ?? "").toLowerCase().includes("fail")));
}

function buildVendorRows(source: DemoOrder[]): VendorRow[] {
  return source.flatMap((order) =>
    order.lines.flatMap((line, lineIndex) =>
      getLineBatches(line).map((batch) => {
        const metric = VENDOR_METRIC_BY_PLACEMENT[line.placement];
        const firstLink = Array.isArray(order.links)
          ? order.links.find((value) => typeof value === "string" && value.trim()) ?? ""
          : "";

        const appendEnabled = line.appendOnComplete?.enabled && line.appendOnComplete.quantity > 0;
        const isFinalBatch = Number(batch.stageIndex) === Number(batch.stageCount);
        const appendExec = line.appendExec;
        const appendStatusText = (() => {
          if (!appendEnabled) return "";
          if (!isFinalBatch) return "追加：等待最終批次完成";
          if (!appendExec || appendExec.status === "pending") return "追加：待觸發";
          if (appendExec.status === "failed") return `追加失敗：${appendExec.error || "請通知管理員"}`;
          if (appendExec.status === "completed") return "追加：已完成";
          if (appendExec.status === "submitted") return "追加：執行中";
          return "";
        })();

        const safeCaseName = sanitizeDisplayText(order.caseName, "未命名案件");

        return {
          id: `${order.id}-${lineIndex}-${batch.id}`,
          orderId: order.id,
          lineIndex,
          batchId: batch.id,
          applicant: sanitizeDisplayText(order.applicant, "-"),
          caseName: batch.stageCount > 1 ? `${safeCaseName}（${batch.stageIndex}/${batch.stageCount} 日）` : safeCaseName,
          orderNo: sanitizeDisplayText(order.orderNo, "-"),
          kind: order.kind === "new" ? "新案" : "加購",
          amount: batch.amount,
          quantity: batch.quantity,
          remainsValue: summarizeVendorRemainsValue(batch),
          remainsText: summarizeBatchRemains(batch),
          progressText: summarizeBatchProgress(batch),
          placementText: getPlacementLabel(line.placement) ?? line.placement,
          link: firstLink,
          metricKey: metric?.key,
          metricLabel: metric?.label ?? "目前指標",
          lastSyncAt:
            batch.lastSyncAt ??
            batch.submittedAt ??
            batch.splits
              .map((split) => split.lastSyncAt)
              .filter((value): value is string => !!value)
              .sort()
              .at(-1) ??
            order.createdAt,
          hasWarning: batch.warnings.length > 0 || batch.splits.some((split) => !!split.error),
          canRetry: isBatchRetryable(batch),
          appendStatusText,
          appendWarning: appendExec?.status === "failed",
        };
      }),
    ),
  );
}

export function AdPerformancePage() {
  const nav = useNavigate();
  const { user, signOut, hasRole } = useAuth();
  const [refresh, setRefresh] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [vendorRefreshing, setVendorRefreshing] = useState(false);
  const [retryingVendorRows, setRetryingVendorRows] = useState<Record<string, boolean>>({});
  const [vendorMetrics, setVendorMetrics] = useState<Record<string, VendorMetricState>>({});
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

  const vendorRows = useMemo(() => buildVendorRows(orders), [orders]);
  const vendorFallbackRows = useMemo(() => buildVendorRows(remoteOrdersFallback), [remoteOrdersFallback]);
  const visibleVendorRows = vendorRows.length > 0 ? vendorRows : vendorFallbackRows;

  const canManage = hasRole("admin");
  const cfg = getConfig();
  const metaCfg = getMetaConfig();

  const setSyncFlag = (key: string, value: boolean) => setSyncing((state) => ({ ...state, [key]: value }));

  const deriveOrderStatus = (lines: Array<{ batches?: DemoOrderBatch[] }>) => {
    const batches = lines.flatMap((line) => line.batches ?? []);
    if (batches.length === 0) return "planned" as const;

    const statuses = batches.map((batch) => batch.status);
    if (statuses.every((status) => status === "scheduled")) return "planned" as const;
    if (statuses.every((status) => status === "failed")) return "failed" as const;
    if (statuses.some((status) => status === "failed" || status === "partial")) return "partial" as const;
    return "submitted" as const;
  };

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
      setRefresh((value) => value + 1);
    } catch {
      try {
        const remote = await fetchSharedValues(["ad_demo_orders_v1"]);
        const raw = remote.values.ad_demo_orders_v1;
        if (typeof raw === "string") {
          const parsed = JSON.parse(raw);
          setRemoteOrdersFallback(Array.isArray(parsed) ? (parsed as DemoOrder[]) : []);
          setRefresh((value) => value + 1);
        }
      } catch {
        // keep local state if shared fetch fails
      }
    }
  };

  const deleteVendorRow = async (orderId: string, lineIndex: number, batchId: string) => {
    const order = listOrders().find((item) => item.id === orderId);
    if (!order) return;

    const nextLines = order.lines
      .map((line, currentLineIndex) => {
        const batches = getLineBatches(line);
        if (currentLineIndex !== lineIndex) {
          return { ...line, batches, splits: batches.flatMap((batch) => batch.splits) };
        }

        const remainingBatches = batches.filter((batch) => batch.id !== batchId);
        if (remainingBatches.length === 0) return null;

        return {
          ...line,
          quantity: remainingBatches.reduce((sum, batch) => sum + batch.quantity, 0),
          amount: remainingBatches.reduce((sum, batch) => sum + batch.amount, 0),
          batches: remainingBatches,
          splits: remainingBatches.flatMap((batch) => batch.splits),
        };
      })
      .filter(Boolean) as DemoOrder["lines"];

    if (nextLines.length === 0) {
      removeOrder(orderId);
    } else {
      updateOrder(orderId, (current) => ({
        ...current,
        lines: nextLines,
        totalAmount: nextLines.reduce((sum, line) => sum + line.amount, 0),
        status: deriveOrderStatus(nextLines),
      }));
    }

    await flushAllSharedState();
    await pullLatestOrders();
    setRefresh((value) => value + 1);
  };

  const retryVendorBatch = async (row: VendorRow) => {
    setRetryingVendorRows((current) => ({ ...current, [row.id]: true }));
    try {
      const response = await fetch(apiUrl("/api/vendor/retry-batch"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: row.orderId,
          lineIndex: row.lineIndex,
          batchId: row.batchId,
        }),
      });
      const data = (await response.json()) as { ok?: boolean; submittedCount?: number; failureCount?: number; error?: string };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      await pullLatestOrders();
      setMsg(
        data.submittedCount
          ? `已重新送出 ${Number(data.submittedCount).toLocaleString("zh-TW")} 筆供應商訂單`
          : "已重新整理失敗批次狀態",
      );
      setTimeout(() => setMsg(null), 2500);
    } catch (error) {
      setMsg(`重新送單失敗：${error instanceof Error ? error.message : "未知錯誤"}`);
      setTimeout(() => setMsg(null), 3500);
    } finally {
      setRetryingVendorRows((current) => ({ ...current, [row.id]: false }));
    }
  };

  const syncVendorMetric = async (row: VendorRow) => {
    if (!row.metricKey || !row.link) return;

    setVendorMetrics((current) => ({
      ...current,
      [row.id]: { ...current[row.id], loading: true, error: "" },
    }));

    try {
      const result = await fetchMetaPostMetrics({ cfg: metaCfg, postId: row.link });
      if (!result.ok) {
        const estimatedValue =
          typeof row.remainsValue === "number" && Number.isFinite(row.remainsValue)
            ? Math.max(0, row.quantity - row.remainsValue)
            : null;
        setVendorMetrics((current) => ({
          ...current,
          [row.id]: {
            loading: false,
            updatedAt: new Date().toISOString(),
            value: estimatedValue != null ? estimatedValue : undefined,
            source: estimatedValue != null ? "estimated" : undefined,
            error: estimatedValue != null ? "" : result.detail || "讀取失敗",
          },
        }));
        return;
      }

      const value = typeof result.values?.[row.metricKey] === "number" ? (result.values?.[row.metricKey] as number) : 0;
      setVendorMetrics((current) => ({
        ...current,
        [row.id]: {
          loading: false,
          updatedAt: new Date().toISOString(),
          value,
          source: "meta",
          error: "",
        },
      }));
    } catch (error) {
      setVendorMetrics((current) => ({
        ...current,
        [row.id]: {
          loading: false,
          updatedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "讀取失敗",
        },
      }));
    }
  };

  const syncVendor = async (
    vendor: VendorKey,
    options?: { silent?: boolean },
  ): Promise<{ syncedCount: number; skipped: boolean; error?: string }> => {
    const vendorCfg = cfg.vendors.find((item) => item.key === vendor);
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
    for (const order of orders) {
      for (const line of order.lines) {
        for (const batch of getLineBatches(line)) {
          for (const split of batch.splits) {
            if (split.vendor !== vendor || !split.vendorOrderId) continue;
            if (isVendorSplitDone(split)) continue;
            ids.push(split.vendorOrderId);
          }
        }
      }
    }

    const uniq = Array.from(new Set(ids)).filter((value) => Number.isFinite(value) && value > 0);
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

      for (const order of orders) {
        updateOrder(order.id, (currentOrder) => ({
          ...currentOrder,
          lines: currentOrder.lines.map((line) => {
            const batches = getLineBatches(line).map((batch) => {
              const nextSplits = batch.splits.map((split) => {
                if (split.vendor !== vendor || !split.vendorOrderId) return split;
                if (isVendorSplitDone(split)) return split;

                const status = mapped[split.vendorOrderId];
                if (!status) {
                  return { ...split, lastSyncAt: new Date().toISOString(), error: "No status" };
                }

                return {
                  ...split,
                  vendorStatus: status.status ?? split.vendorStatus,
                  remains: status.remains ?? split.remains,
                  startCount: status.start_count ?? split.startCount,
                  charge: status.charge ?? split.charge,
                  currency: status.currency ?? split.currency,
                  lastSyncAt: new Date().toISOString(),
                  error: status.error ?? "",
                };
              });

              const nextStatus = nextSplits.every((split) => isVendorSplitDone(split))
                ? "completed"
                : nextSplits.some((split) => split.error || String(split.vendorStatus ?? "").toLowerCase().includes("fail"))
                  ? "partial"
                  : nextSplits.some((split) => !!split.vendorOrderId)
                    ? "submitted"
                    : batch.status;

              return {
                ...batch,
                splits: nextSplits,
                status: nextStatus,
                lastSyncAt:
                  nextSplits
                    .map((split) => split.lastSyncAt)
                    .filter((value): value is string => !!value)
                    .sort()
                    .at(-1) ?? batch.lastSyncAt,
              };
            });

            return {
              ...line,
              batches,
              splits: batches.flatMap((batch) => batch.splits),
            };
          }),
        }));
      }

      if (!options?.silent) {
        setMsg(`已更新 ${uniq.length.toLocaleString("zh-TW")} 筆進行中案件。`);
        setTimeout(() => setMsg(null), 2500);
        setRefresh((value) => value + 1);
      }

      return { syncedCount: uniq.length, skipped: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知錯誤";
      if (!options?.silent) {
        setMsg(`同步失敗：${message}`);
        setTimeout(() => setMsg(null), 3500);
      }
      return { syncedCount: 0, skipped: false, error: message };
    } finally {
      setSyncFlag(syncKey, false);
    }
  };

  const refreshVendorTracking = async (options?: { silent?: boolean }) => {
    if (vendorRefreshing) return;
    setVendorRefreshing(true);
    try {
      if (API_BASE) {
        const response = await fetch(apiUrl("/api/vendor/sync-shared-orders"), { method: "POST" });
        const data = (await response.json()) as { ok?: boolean; syncedCount?: number; error?: string };
        if (!response.ok || !data.ok) {
          throw new Error(data.error || `HTTP ${response.status}`);
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
        const result = await syncVendor(vendor, { silent: true });
        syncedCount += result.syncedCount;
        if (result.error) errors.push(formatVendorUserMessage(result.error));
      }

      setRefresh((value) => value + 1);
      if (options?.silent) return;

      if (errors.length > 0) {
        setMsg(`更新完成，但有提醒：${errors.join(" / ")}`);
        setTimeout(() => setMsg(null), 4000);
        return;
      }

      if (syncedCount === 0) {
        setMsg("目前沒有需要追蹤的進行中案件。");
        setTimeout(() => setMsg(null), 2500);
        return;
      }

      setMsg(`已更新 ${syncedCount.toLocaleString("zh-TW")} 筆進行中案件。`);
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
        updateMetaOrder(row.id, (current) => ({
          ...current,
          error: result.detail ?? "同步失敗",
          targetLastCheckedAt: new Date().toISOString(),
        }));
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

      updateMetaOrder(row.id, (current) => ({
        ...current,
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
        setMsg(pausedByTarget ? "已達目標，已自動暫停這筆投放。" : `Meta 已同步：${adId}`);
        setTimeout(() => setMsg(null), 2200);
      }
      if (!options?.fromAutoLoop) setRefresh((value) => value + 1);
      return { ok: true, pausedByTarget };
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步失敗";
      updateMetaOrder(row.id, (current) => ({
        ...current,
        error: message,
        targetLastCheckedAt: new Date().toISOString(),
      }));
      if (!options?.silent) {
        setMsg(`Meta 同步失敗：${message}`);
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
      const result = await syncMetaOne(row, { silent: options?.silent });
      void result;
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

      updateMetaOrder(row.id, (current) => ({
        ...current,
        status: mapMetaStatus(result.statusText ?? nextStatus),
        apiStatusText: result.statusText ?? nextStatus,
        error: "",
      }));

      setMsg(nextStatus === "PAUSED" ? "已暫停 Meta 投放。" : "已重新啟用 Meta 投放。");
      setTimeout(() => setMsg(null), 2200);
      setRefresh((value) => value + 1);
    } finally {
      setSyncFlag(syncKey, false);
    }
  };

  useEffect(() => {
    if (!VENDOR_POST_METRIC_ENABLED) return;
    const targets = visibleVendorRows.filter((row) => !!row.metricKey && !!row.link);
    const now = Date.now();
    const missing = targets.filter((row) => {
      const state = vendorMetrics[row.id];
      if (!state) return true;
      if (state.loading) return false;
      if (!state.updatedAt) return true;
      const ts = Date.parse(state.updatedAt);
      if (!Number.isFinite(ts)) return true;
      return now - ts >= 5 * 60 * 1000;
    });
    if (missing.length === 0) return;

    let canceled = false;
    const run = async () => {
      for (const row of missing) {
        if (canceled) break;
        await syncVendorMetric(row);
      }
    };

    void run();
    return () => {
      canceled = true;
    };
  }, [visibleVendorRows, vendorMetrics]);

  useEffect(() => {
    const tick = async () => {
      if (hourlyAutoRunning) return;
      setHourlyAutoRunning(true);
      try {
        await refreshVendorTracking({ silent: true });
        await syncAllMeta({ silent: true });
        setHourlyAutoLastRunAt(new Date().toISOString());
        setRefresh((value) => value + 1);
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
          const result = await syncMetaOne(row, { silent: true, fromAutoLoop: true });
          if (result.pausedByTarget) pausedCount += 1;
        }
        if (pausedCount > 0) {
          setMsg(`已自動暫停 ${pausedCount} 筆已達目標的 Meta 投放。`);
          setTimeout(() => setMsg(null), 3000);
        }
        setRefresh((value) => value + 1);
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
    const onSharedSync = () => setRefresh((value) => value + 1);
    window.addEventListener(SHARED_SYNC_EVENT, onSharedSync);
    return () => window.removeEventListener(SHARED_SYNC_EVENT, onSharedSync);
  }, []);

  return (
    <div className="container container--wide">
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

      {msg ? (
        <div className="card">
          <div className="card-bd">{msg}</div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-bd">
          <div className="hint">其他同事新增或更新案件後，這頁會自動帶入最新狀態。</div>
          <div className="hint" style={{ marginTop: 6 }}>
            頁面開啟期間，系統每小時會自動更新一次進行中案件；你也可以手動同步。
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            最近一次每小時自動更新：
            {hourlyAutoLastRunAt ? new Date(hourlyAutoLastRunAt).toLocaleString("zh-TW") : "尚未執行"}
            {hourlyAutoRunning ? "（同步中）" : ""}
          </div>
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
            <button className="btn" type="button" onClick={() => void pullLatestOrders()}>
              重新整理
            </button>
            <button className="btn" type="button" onClick={refreshVendorTracking} disabled={vendorRefreshing}>
              {vendorRefreshing ? "同步中..." : "同步進行中案件"}
            </button>
            <button className="btn danger" type="button" onClick={() => { clearOrders(); setRefresh((value) => value + 1); }}>
              清空案件
            </button>
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
              <div className="dense-th">數量</div>
              <div className="dense-th">剩餘數量</div>
              <div className="dense-th">成效</div>
              <div className="dense-th">執行進度</div>
              <div className="dense-th">操作</div>

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
                    <div className="dense-title">{row.quantity.toLocaleString("zh-TW")}</div>
                  </div>
                  <div className="dense-td">
                    <div className="dense-title">{row.remainsText}</div>
                  </div>
                  <div className="dense-td dense-main">
                    <div className="dense-title">{row.metricLabel}</div>
                    <div className="dense-meta">
                      {!VENDOR_POST_METRIC_ENABLED
                        ? "功能保留，暫不啟用"
                        : vendorMetrics[row.id]?.loading
                        ? "讀取中..."
                        : vendorMetrics[row.id]?.error
                          ? "--"
                          : typeof vendorMetrics[row.id]?.value === "number"
                            ? vendorMetrics[row.id]!.value!.toLocaleString("zh-TW")
                            : "-"}
                    </div>
                    {VENDOR_POST_METRIC_ENABLED && vendorMetrics[row.id]?.source === "estimated" ? (
                      <div className="dense-meta">估算值（API 讀取失敗時以執行進度換算）</div>
                    ) : null}
                  </div>
                  <div className="dense-td dense-main">
                    <div className="dense-title" style={row.hasWarning ? { color: "rgba(220, 38, 38, 0.95)" } : undefined}>
                      {row.progressText}
                    </div>
                    {canManage && row.canRetry ? (
                      <div className="actions inline" style={{ marginTop: 8 }}>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => void retryVendorBatch(row)}
                          disabled={!!retryingVendorRows[row.id]}
                        >
                          {retryingVendorRows[row.id] ? "重送中..." : "重送"}
                        </button>
                      </div>
                    ) : null}
                    {row.appendStatusText ? (
                      <div
                        className="dense-meta"
                        style={row.appendWarning ? { color: "rgba(220, 38, 38, 0.95)", marginTop: 4 } : { marginTop: 4 }}
                      >
                        {row.appendStatusText}
                      </div>
                    ) : null}
                    <div className="dense-meta">
                      更新時間：{row.lastSyncAt ? new Date(row.lastSyncAt).toLocaleString("zh-TW") : "-"}
                    </div>
                  </div>
                  <div className="dense-td">
                    <div className="actions inline">
                      <button
                        className="btn sm"
                        type="button"
                        disabled={!row.link}
                        onClick={() => {
                          if (!row.link) return;
                          window.open(row.link, "_blank", "noopener,noreferrer");
                        }}
                      >
                        連結
                      </button>
                      {canManage ? (
                        <button className="btn danger sm" type="button" onClick={() => void deleteVendorRow(row.orderId, row.lineIndex, row.batchId)}>
                          刪除
                        </button>
                      ) : null}
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
              <button className="btn" onClick={() => setRefresh((value) => value + 1)}>重新整理</button>
              <button className="btn" onClick={() => void syncAllMeta()}>全部同步</button>
              <button className="btn" onClick={() => setMetaAutoEnabled((value) => !value)}>
                自動停投：{metaAutoEnabled ? "開啟" : "關閉"}
              </button>
              <button className="btn danger" onClick={() => { clearMetaOrders(); setRefresh((value) => value + 1); }}>
                清空 Meta 案件
              </button>
            </div>

            <div className="sep" />
            <div className="hint">
              本頁開啟期間，系統每小時會自動同步進行中案件；若有設定目標停投，另外每 5 分鐘檢查一次。
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              目標停投檢查：{metaAutoRunning ? "檢查中" : "待命中"}
            </div>

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
                          <input
                            value={
                              row.targetValue
                                ? `${(row.targetCurrentValue ?? 0).toLocaleString("zh-TW")} / ${row.targetValue.toLocaleString("zh-TW")} ${metricLabel}`
                                : "未設定"
                            }
                            readOnly
                          />
                        </div>
                        <div className="field">
                          <div className="label">操作</div>
                          <div className="actions inline">
                            <button className="btn" onClick={() => void syncMetaOne(row)} disabled={!!syncing[syncKey]}>
                              {syncing[syncKey] ? "同步中..." : "同步"}
                            </button>
                            <button className="btn" onClick={() => void updateMetaDeliveryStatus(row, "PAUSED")} disabled={!canPause || !!syncing[syncKey]}>
                              暫停
                            </button>
                            <button className="btn" onClick={() => void updateMetaDeliveryStatus(row, "ACTIVE")} disabled={!canResume || !!syncing[syncKey]}>
                              重新啟用
                            </button>
                            <button className="btn" onClick={() => nav(`/meta-ads-orders?edit=${encodeURIComponent(row.id)}`)}>
                              重新編輯
                            </button>
                          </div>
                        </div>
                      </div>

                      {row.performance?.metrics?.length ? (
                        <>
                          <div className="sep" />
                          <div className="dense-table metrics-table">
                            <div className="dense-th">指標</div>
                            <div className="dense-th">數值</div>
                            {row.performance.metrics.map((metric) => (
                              <div className="dense-tr" key={`${row.id}-${metric.key}`}>
                                <div className="dense-td">
                                  <div className="dense-title">{metric.label}</div>
                                </div>
                                <div className="dense-td">
                                  <div className="dense-title">{metric.value.toLocaleString("zh-TW")}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                          {row.performance.updatedAt ? (
                            <div className="hint" style={{ marginTop: 8 }}>
                              更新時間：{new Date(row.performance.updatedAt).toLocaleString("zh-TW")}
                            </div>
                          ) : null}
                          {row.targetLastCheckedAt ? (
                            <div className="hint" style={{ marginTop: 6 }}>
                              目標檢查時間：{new Date(row.targetLastCheckedAt).toLocaleString("zh-TW")}
                            </div>
                          ) : null}
                          {row.targetReachedAt ? (
                            <div className="hint" style={{ marginTop: 6, color: "rgba(16, 185, 129, 0.95)" }}>
                              已達目標並自動停止：{new Date(row.targetReachedAt).toLocaleString("zh-TW")}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="hint" style={{ marginTop: 8 }}>尚未同步 KPI</div>
                      )}

                      {row.error ? (
                        <div className="hint" style={{ marginTop: 8, color: "rgba(220, 38, 38, 0.95)" }}>
                          {row.error}
                        </div>
                      ) : null}
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
