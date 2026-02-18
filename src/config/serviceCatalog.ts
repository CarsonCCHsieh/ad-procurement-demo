import type { VendorKey } from "./appConfig";

export type VendorService = {
  id: number;
  name: string;
  category?: string;
  type?: string;
  rate?: number;
  min?: number;
  max?: number;
  refill?: boolean;
  cancel?: boolean;
  dripfeed?: boolean;
};

export type ServiceCatalogV1 = {
  version: 1;
  updatedAt: string; // ISO
  catalogs: Partial<Record<VendorKey, VendorService[]>>;
};

const STORAGE_KEY = "ad_demo_service_catalog_v1";

function isoNow() {
  return new Date().toISOString();
}

const EMPTY: ServiceCatalogV1 = { version: 1, updatedAt: isoNow(), catalogs: {} };

function normalizeServices(raw: unknown): VendorService[] | null {
  // Expected by most SMM Panel APIs: array of objects with fields like:
  // { service: 1, name: "...", category: "...", rate: "...", min: "...", max: "..." }
  if (Array.isArray(raw)) {
    const out: VendorService[] = [];
    for (const it of raw) {
      if (!it || typeof it !== "object") continue;
      const x = it as Record<string, unknown>;
      const id = Number(x.service ?? x.id ?? x.service_id ?? x.serviceId);
      const name = String(x.name ?? x.title ?? "").trim();
      if (!Number.isFinite(id) || id <= 0) continue;
      if (!name) continue;
      const rate = x.rate == null ? undefined : Number(x.rate);
      const min = x.min == null ? undefined : Number(x.min);
      const max = x.max == null ? undefined : Number(x.max);
      const category = x.category == null ? undefined : String(x.category);
      const type = x.type == null ? undefined : String(x.type);
      const refill = x.refill == null ? undefined : Boolean(x.refill);
      const cancel = x.cancel == null ? undefined : Boolean(x.cancel);
      const dripfeed = x.dripfeed == null ? undefined : Boolean(x.dripfeed);

      out.push({
        id,
        name,
        category,
        type,
        rate: rate != null && Number.isFinite(rate) ? rate : undefined,
        min: min != null && Number.isFinite(min) ? min : undefined,
        max: max != null && Number.isFinite(max) ? max : undefined,
        refill,
        cancel,
        dripfeed,
      });
    }
    return out;
  }

  // Some APIs may wrap it: { data: [...] } or { services: [...] }
  if (raw && typeof raw === "object") {
    const x = raw as Record<string, unknown>;
    if (Array.isArray(x.data)) return normalizeServices(x.data);
    if (Array.isArray(x.services)) return normalizeServices(x.services);
  }
  return null;
}

function normalizeCatalog(raw: unknown): ServiceCatalogV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ServiceCatalogV1>;
  if (r.version !== 1) return null;
  const catalogs = (r.catalogs ?? {}) as Partial<Record<VendorKey, unknown>>;

  const out: ServiceCatalogV1 = { version: 1, updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : isoNow(), catalogs: {} };
  for (const key of ["smmraja", "urpanel", "justanotherpanel"] as VendorKey[]) {
    const services = normalizeServices(catalogs[key]);
    if (services && services.length > 0) out.catalogs[key] = services;
  }
  return out;
}

export function getServiceCatalog(): ServiceCatalogV1 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    return normalizeCatalog(parsed) ?? EMPTY;
  } catch {
    return EMPTY;
  }
}

export function saveServiceCatalog(next: ServiceCatalogV1) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, updatedAt: isoNow() }));
  } catch {
    // ignore
  }
}

export function setVendorServices(vendor: VendorKey, services: VendorService[]) {
  const current = getServiceCatalog();
  saveServiceCatalog({
    version: 1,
    updatedAt: isoNow(),
    catalogs: { ...current.catalogs, [vendor]: services },
  });
}

export function clearVendorServices(vendor: VendorKey) {
  const current = getServiceCatalog();
  const next = { ...current.catalogs };
  delete next[vendor];
  saveServiceCatalog({ version: 1, updatedAt: isoNow(), catalogs: next });
}

export function exportServiceCatalogJson(): string {
  return JSON.stringify(getServiceCatalog(), null, 2);
}

export function importVendorServicesJson(vendor: VendorKey, json: string): { ok: boolean; message?: string; count?: number } {
  try {
    const parsed = JSON.parse(json);
    const services = normalizeServices(parsed);
    if (!services || services.length === 0) {
      return { ok: false, message: "匯入失敗：找不到 services 陣列（或格式不符）" };
    }
    setVendorServices(vendor, services);
    return { ok: true, count: services.length };
  } catch {
    return { ok: false, message: "JSON 解析失敗" };
  }
}

export function getVendorServices(vendor: VendorKey): VendorService[] {
  return getServiceCatalog().catalogs[vendor] ?? [];
}

export function findServiceName(vendor: VendorKey, serviceId: number): string | null {
  if (!Number.isFinite(serviceId) || serviceId <= 0) return null;
  const hit = getVendorServices(vendor).find((s) => s.id === serviceId);
  return hit?.name ?? null;
}

