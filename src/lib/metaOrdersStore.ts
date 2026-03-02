import type { MetaAdGoalKey } from "./metaGoals";

export type MetaOrderStatus = "draft" | "submitted" | "running" | "paused" | "failed" | "completed";

export type MetaOrderInput = {
  applicant: string;
  title: string;
  goal: MetaAdGoalKey;
  landingUrl: string;
  message: string;
  ctaType: string;
  useExistingPost: boolean;
  existingPostId?: string;
  dailyBudget: number;
  startTime: string; // ISO
  endTime?: string; // ISO
  countries: string[];
  ageMin: number;
  ageMax: number;
  genders: number[]; // 0=all,1=male,2=female
  mode: "simulate" | "live";
};

export type MetaSubmitResult = {
  campaignId?: string;
  adsetId?: string;
  creativeId?: string;
  adId?: string;
  requestLogs: Array<{ step: string; ok: boolean; detail: string }>;
};

export type MetaPerformanceSnapshot = {
  updatedAt: string; // ISO
  metrics: Array<{ key: string; label: string; value: number }>;
  raw?: Record<string, unknown>;
};

export type MetaOrder = MetaOrderInput & {
  id: string;
  createdAt: string; // ISO
  status: MetaOrderStatus;
  apiStatusText?: string;
  error?: string;
  performance?: MetaPerformanceSnapshot;
  payloads: {
    campaign: Record<string, unknown>;
    adset: Record<string, unknown>;
    creative: Record<string, unknown>;
    ad: Record<string, unknown>;
  };
  submitResult?: MetaSubmitResult;
};

const STORAGE_KEY = "ad_demo_meta_orders_v1";

function readAll(): MetaOrder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as MetaOrder[];
  } catch {
    return [];
  }
}

function writeAll(rows: MetaOrder[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // ignore
  }
}

export function listMetaOrders(): MetaOrder[] {
  return readAll().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function addMetaOrder(order: Omit<MetaOrder, "id" | "createdAt">): MetaOrder {
  const full: MetaOrder = {
    ...order,
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  const all = readAll();
  all.push(full);
  writeAll(all);
  return full;
}

export function updateMetaOrder(orderId: string, updater: (row: MetaOrder) => MetaOrder): MetaOrder | null {
  const all = readAll();
  const idx = all.findIndex((x) => x.id === orderId);
  if (idx < 0) return null;
  const next = updater(all[idx]);
  all[idx] = next;
  writeAll(all);
  return next;
}

export function clearMetaOrders() {
  writeAll([]);
}

