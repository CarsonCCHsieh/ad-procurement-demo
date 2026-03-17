import { API_BASE, apiUrl } from "./apiBase";
const CLIENT_ID_KEY = "ad_demo_shared_client_id";

export const SHARED_STORAGE_KEYS = [
  "ad_demo_config_v1",
  "ad_demo_pricing_v1",
  "ad_demo_orders_v1",
  "ad_demo_meta_orders_v1",
  "ad_demo_service_catalog_v1",
  "ad_demo_vendor_keys_v1",
  "ad_demo_meta_config_v1",
] as const;

export const SHARED_LIGHT_KEYS = [
  "ad_demo_config_v1",
  "ad_demo_pricing_v1",
  "ad_demo_orders_v1",
  "ad_demo_meta_orders_v1",
] as const;

export const SHARED_SYNC_EVENT = "ad-demo-shared-sync";

let lastSeenRevision = 0;
let flushTimer: number | null = null;
let flushRunning = false;
const pendingKeys = new Set<string>();

function currentSharedValues(keys: readonly string[] = SHARED_STORAGE_KEYS): Record<string, string | null> {
  const values: Record<string, string | null> = {};
  for (const key of keys) values[key] = localStorage.getItem(key);
  return values;
}

function getClientId() {
  try {
    const current = localStorage.getItem(CLIENT_ID_KEY);
    if (current) return current;
    const next = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(CLIENT_ID_KEY, next);
    return next;
  } catch {
    return `volatile_${Date.now()}`;
  }
}

function dispatchSyncEvent(changedKeys: string[]) {
  window.dispatchEvent(new CustomEvent(SHARED_SYNC_EVENT, { detail: { changedKeys } }));
}

function applyRemoteValues(values: Record<string, string | null>): string[] {
  const changedKeys: string[] = [];
  for (const [key, next] of Object.entries(values)) {
    if (!SHARED_STORAGE_KEYS.includes(key as (typeof SHARED_STORAGE_KEYS)[number])) continue;
    try {
      const current = localStorage.getItem(key);
      if (next === current) continue;
      if (next == null) localStorage.removeItem(key);
      else localStorage.setItem(key, next);
      changedKeys.push(key);
    } catch {
      // Continue applying smaller, higher-priority keys such as orders/performance
      // even if a large key (for example service catalog) exceeds local storage limits.
    }
  }
  return changedKeys;
}

async function postBatch(values: Record<string, string | null>) {
  const res = await fetch(apiUrl("/api/state/batch"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: getClientId(), values }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { revision?: number };
  if (typeof data.revision === "number") {
    lastSeenRevision = Math.max(lastSeenRevision, data.revision);
  }
}

async function fetchRemoteState(keys: readonly string[] = SHARED_STORAGE_KEYS) {
  const params = new URLSearchParams();
  if (keys.length > 0) params.set("keys", keys.join(","));
  const res = await fetch(apiUrl(`/api/state?${params.toString()}`));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { revision?: number; values?: Record<string, string | null> };
}

export async function fetchSharedValues(keys: readonly string[] = SHARED_LIGHT_KEYS) {
  if (!API_BASE) return { revision: 0, values: {} as Record<string, string | null> };
  const data = await fetchRemoteState(keys);
  return {
    revision: typeof data.revision === "number" ? data.revision : 0,
    values: data.values ?? {},
  };
}

async function flushPending() {
  if (!API_BASE || flushRunning || pendingKeys.size === 0) return;
  flushRunning = true;
  const keys = Array.from(pendingKeys);
  pendingKeys.clear();
  const values: Record<string, string | null> = {};
  for (const key of keys) values[key] = localStorage.getItem(key);
  try {
    await postBatch(values);
  } catch {
    for (const key of keys) pendingKeys.add(key);
  } finally {
    flushRunning = false;
    if (pendingKeys.size > 0) {
      scheduleFlush();
    }
  }
}

function scheduleFlush() {
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushPending();
  }, 300);
}

export function isSharedSyncEnabled() {
  return !!API_BASE;
}

export function queueSharedWrite(key: string) {
  if (!API_BASE) return;
  if (!SHARED_STORAGE_KEYS.includes(key as (typeof SHARED_STORAGE_KEYS)[number])) return;
  pendingKeys.add(key);
  scheduleFlush();
}

export async function pullSharedState(keys: readonly string[] = SHARED_LIGHT_KEYS) {
  if (!API_BASE) return { applied: false, changedKeys: [] as string[] };
  const data = await fetchRemoteState(keys);
  const revision = typeof data.revision === "number" ? data.revision : 0;
  if (revision <= lastSeenRevision || !data.values) {
    return { applied: false, changedKeys: [] as string[] };
  }
  const changedKeys = applyRemoteValues(data.values);
  lastSeenRevision = revision;
  if (changedKeys.length > 0) dispatchSyncEvent(changedKeys);
  return { applied: changedKeys.length > 0, changedKeys };
}

export async function flushAllSharedState() {
  if (!API_BASE) return;
  const values = currentSharedValues();
  await postBatch(values);
}

async function seedMissingLocalState() {
  if (!API_BASE) return;
  const data = await fetchRemoteState(SHARED_LIGHT_KEYS);
  const remoteValues = data.values ?? {};
  const localValues = currentSharedValues();
  const missing: Record<string, string | null> = {};

  for (const key of SHARED_STORAGE_KEYS) {
    const remoteHas = Object.prototype.hasOwnProperty.call(remoteValues, key) && remoteValues[key] != null;
    const localHas = localValues[key] != null;
    if (!remoteHas && localHas) {
      missing[key] = localValues[key];
    }
  }

  if (Object.keys(missing).length > 0) {
    await postBatch(missing);
  }
}

export function startSharedStateSync(options?: { intervalMs?: number; keys?: readonly string[] }) {
  if (!API_BASE) return () => {};
  const intervalMs = options?.intervalMs ?? 10000;
  const keys = options?.keys ?? SHARED_LIGHT_KEYS;
  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      void pullSharedState(keys);
    }
  };
  const onPageHide = () => {
    void flushPending();
  };

  void (async () => {
    await seedMissingLocalState();
    await pullSharedState(keys);
  })();
  const timer = window.setInterval(() => {
    void pullSharedState(keys);
  }, intervalMs);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);

  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
  };
}
