import type { VendorKey } from "./appConfig";

// Demo-only vendor API keys.
//
// IMPORTANT:
// - This is NOT secure on a static site. Anyone with access to the browser can extract it.
// - For production, move API calls to a backend and never ship vendor keys to the frontend bundle.

type VendorKeysV1 = {
  version: 1;
  updatedAt: string; // ISO
  keys: Partial<Record<VendorKey, string>>;
};

const STORAGE_KEY = "ad_demo_vendor_keys_v1";

function isoNow() {
  return new Date().toISOString();
}

function read(): VendorKeysV1 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, updatedAt: isoNow(), keys: {} };
    const parsed = JSON.parse(raw) as Partial<VendorKeysV1>;
    if (parsed.version !== 1 || !parsed.keys || typeof parsed.keys !== "object") {
      return { version: 1, updatedAt: isoNow(), keys: {} };
    }
    return { version: 1, updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : isoNow(), keys: parsed.keys };
  } catch {
    return { version: 1, updatedAt: isoNow(), keys: {} };
  }
}

function write(next: VendorKeysV1) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, updatedAt: isoNow() }));
  } catch {
    // ignore
  }
}

export function getVendorKey(vendor: VendorKey): string {
  return (read().keys[vendor] ?? "").trim();
}

export function setVendorKey(vendor: VendorKey, key: string) {
  const current = read();
  write({ version: 1, updatedAt: isoNow(), keys: { ...current.keys, [vendor]: key.trim() } });
}

export function clearVendorKey(vendor: VendorKey) {
  const current = read();
  const next = { ...current.keys };
  delete next[vendor];
  write({ version: 1, updatedAt: isoNow(), keys: next });
}

