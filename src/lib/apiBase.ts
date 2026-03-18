const FALLBACK_PUBLIC_API_BASE = "https://relax-sellers-deployment-critical.trycloudflare.com";

export function resolveApiBase() {
  const envBase = (import.meta.env.VITE_SHARED_API_BASE ?? "").trim().replace(/\/$/, "");
  if (envBase) return envBase;
  if (typeof window === "undefined") return FALLBACK_PUBLIC_API_BASE;

  const { protocol, hostname, origin } = window.location;
  if (protocol === "http:" && !hostname.endsWith("github.io")) {
    return origin.replace(/\/$/, "");
  }

  return FALLBACK_PUBLIC_API_BASE;
}

export const API_BASE = resolveApiBase();

export function apiUrl(path: string) {
  if (!path.startsWith("/")) return `${API_BASE}/${path}`;
  return `${API_BASE}${path}`;
}

