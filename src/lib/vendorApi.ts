import type { VendorKey } from "../config/appConfig";

export type VendorStatus = {
  status?: string;
  remains?: number;
  start_count?: number;
  charge?: number;
  currency?: string;
  raw?: unknown;
  error?: string;
};

function toNum(x: unknown): number | undefined {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function formEncode(params: Record<string, string>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) usp.append(k, v);
  return usp.toString();
}

export async function postSmmPanel(params: {
  baseUrl: string;
  key: string;
  action: string;
  payload?: Record<string, string>;
}): Promise<unknown> {
  const body = formEncode({ key: params.key, action: params.action, ...(params.payload ?? {}) });
  const res = await fetch(params.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Some panels may return HTML when blocked/auth issues.
    return { error: "Non-JSON response", raw: text.slice(0, 400) };
  }
}

export function statusParamFor(vendor: VendorKey, orderIds: number[]): { key: string; value: string } {
  const joined = orderIds.join(",");
  if (orderIds.length <= 1) return { key: "order", value: joined };
  // SMM Raja docs show multi-status via "order=1,10,100".
  if (vendor === "smmraja") return { key: "order", value: joined };
  // Many others use "orders" for multi.
  return { key: "orders", value: joined };
}

export function normalizeStatusResponse(orderIds: number[], resp: unknown): Record<number, VendorStatus> {
  const out: Record<number, VendorStatus> = {};

  const idSet = new Set(orderIds);
  const setOne = (id: number, s: VendorStatus) => {
    if (!idSet.has(id)) return;
    out[id] = { ...s, raw: s.raw ?? resp };
  };

  if (!resp || typeof resp !== "object") {
    for (const id of orderIds) setOne(id, { error: "Empty response" });
    return out;
  }

  // Single order: { status: "...", remains: "...", start_count: "...", charge: "..." }
  const r = resp as Record<string, unknown>;
  if (typeof r.status === "string" || typeof r.remains !== "undefined" || typeof r.charge !== "undefined") {
    const id = orderIds[0];
    setOne(id, {
      status: typeof r.status === "string" ? r.status : undefined,
      remains: toNum(r.remains),
      start_count: toNum(r.start_count),
      charge: toNum(r.charge),
      currency: typeof r.currency === "string" ? r.currency : undefined,
      error: typeof r.error === "string" ? r.error : undefined,
    });
    return out;
  }

  // Multi order: { "1": { ... }, "10": { ... } }
  for (const id of orderIds) {
    const v = (resp as Record<string, unknown>)[String(id)];
    if (!v || typeof v !== "object") {
      setOne(id, { error: "Missing order in response" });
      continue;
    }
    const x = v as Record<string, unknown>;
    if (typeof x.error === "string") {
      setOne(id, { error: x.error });
      continue;
    }
    setOne(id, {
      status: typeof x.status === "string" ? x.status : undefined,
      remains: toNum(x.remains),
      start_count: toNum(x.start_count),
      charge: toNum(x.charge),
      currency: typeof x.currency === "string" ? x.currency : undefined,
      error: typeof x.error === "string" ? x.error : undefined,
    });
  }

  return out;
}

