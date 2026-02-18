import type { AdPlacement } from "./pricing";
import type { PlannedSplit } from "./split";

export type DemoOrderLine = {
  placement: AdPlacement;
  quantity: number;
  amount: number;
  splits: PlannedSplit[];
  warnings: string[];
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
  status: "planned";
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
  } catch {
    // ignore
  }
}

export function listOrders(): DemoOrder[] {
  return readAll().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function addOrder(order: Omit<DemoOrder, "id" | "createdAt" | "status">): DemoOrder {
  const full: DemoOrder = {
    ...order,
    id: String(Date.now()),
    createdAt: new Date().toISOString(),
    status: "planned",
  };
  const all = readAll();
  all.push(full);
  writeAll(all);
  return full;
}

export function clearOrders() {
  writeAll([]);
}

