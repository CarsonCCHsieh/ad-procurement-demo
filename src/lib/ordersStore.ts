import type { AdPlacement } from "./pricing";
import type { PlannedSplit } from "./split";
import { queueSharedWrite } from "./sharedSync";

export type VendorKey = "smmraja" | "urpanel" | "justanotherpanel";

export type VendorSplitExec = PlannedSplit & {
  vendorOrderId?: number; // order id returned by vendor after "add"
  vendorStatus?: string;
  remains?: number;
  startCount?: number;
  charge?: number;
  currency?: string;
  lastSyncAt?: string; // ISO
  error?: string;
};

export type OrderSubmitMode = "instant" | "average";

export type CompletionAppendConfig = {
  enabled: boolean;
  vendor: VendorKey;
  serviceId: number;
  quantity: number;
};

export type CompletionAppendExec = {
  status: "pending" | "submitted" | "failed" | "completed";
  vendor: VendorKey;
  serviceId: number;
  quantity: number;
  vendorOrderId?: number;
  vendorStatus?: string;
  remains?: number;
  error?: string;
  submittedAt?: string;
  lastSyncAt?: string;
};

export type DemoOrderBatchStatus = "scheduled" | "submitted" | "partial" | "failed" | "completed";

export type DemoOrderBatch = {
  id: string;
  stageIndex: number;
  stageCount: number;
  plannedDate?: string; // YYYY-MM-DD
  quantity: number;
  amount: number;
  warnings: string[];
  splits: VendorSplitExec[];
  status: DemoOrderBatchStatus;
  submittedAt?: string;
  lastSyncAt?: string;
};

export type DemoOrderLine = {
  placement: AdPlacement;
  quantity: number;
  amount: number;
  splits: VendorSplitExec[];
  warnings: string[];
  appendOnComplete?: CompletionAppendConfig;
  appendExec?: CompletionAppendExec;
  mode?: OrderSubmitMode;
  startDate?: string;
  endDate?: string;
  batches?: DemoOrderBatch[];
};

export type DemoOrder = {
  id: string;
  createdAt: string; // ISO
  applicant: string;
  orderNo: string;
  caseName: string;
  kind: "new" | "upsell";
  links: string[];
  lines: DemoOrderLine[];
  totalAmount: number;
  status: "planned" | "submitted" | "partial" | "failed";
  mode?: OrderSubmitMode;
  scheduleStartDate?: string;
  scheduleEndDate?: string;
};

const STORAGE_KEY = "ad_demo_orders_v1";

function readAll(): DemoOrder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as DemoOrder[];
  } catch {
    return [];
  }
}

function writeAll(orders: DemoOrder[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
    queueSharedWrite(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function listOrders(): DemoOrder[] {
  return readAll().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function addOrder(
  order: Omit<DemoOrder, "id" | "createdAt" | "status"> & { status?: DemoOrder["status"] },
): DemoOrder {
  const full: DemoOrder = {
    ...order,
    id: String(Date.now()),
    createdAt: new Date().toISOString(),
    status: order.status ?? "planned",
  };
  const all = readAll();
  all.push(full);
  writeAll(all);
  return full;
}

export function insertOrder(order: DemoOrder): DemoOrder {
  const all = readAll().filter((x) => x.id !== order.id);
  all.push(order);
  writeAll(all);
  return order;
}

export function updateOrder(orderId: string, updater: (order: DemoOrder) => DemoOrder): DemoOrder | null {
  const all = readAll();
  const idx = all.findIndex((o) => o.id === orderId);
  if (idx < 0) return null;
  const next = updater(all[idx]);
  all[idx] = next;
  writeAll(all);
  return next;
}

export function removeOrder(orderId: string): boolean {
  const all = readAll();
  const next = all.filter((order) => order.id !== orderId);
  if (next.length === all.length) return false;
  writeAll(next);
  return true;
}

export function clearOrders() {
  writeAll([]);
}

export function replaceOrders(orders: DemoOrder[]) {
  writeAll(Array.isArray(orders) ? orders : []);
}
