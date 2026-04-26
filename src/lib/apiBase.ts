const FALLBACK_PUBLIC_API_BASE = "https://medicine-kyle-situation-holidays.trycloudflare.com";
const DEFAULT_LOCAL_API_BASE = "http://127.0.0.1:8787";

export function resolveApiBase() {
  const envBase = (import.meta.env.VITE_SHARED_API_BASE ?? "").trim().replace(/\/$/, "");
  if (envBase) return envBase;
  if (typeof window === "undefined") return FALLBACK_PUBLIC_API_BASE;

  const localBase = (import.meta.env.VITE_LOCAL_SHARED_API_BASE ?? DEFAULT_LOCAL_API_BASE).trim().replace(/\/$/, "");
  const { protocol, hostname, origin, port } = window.location;
  if (protocol === "http:" && !hostname.endsWith("github.io")) {
    if (port === "8787") {
      return origin.replace(/\/$/, "");
    }
    return localBase || FALLBACK_PUBLIC_API_BASE;
  }

  return FALLBACK_PUBLIC_API_BASE;
}

export const API_BASE = resolveApiBase();

export function apiUrl(path: string) {
  if (!path.startsWith("/")) return `${API_BASE}/${path}`;
  return `${API_BASE}${path}`;
}
