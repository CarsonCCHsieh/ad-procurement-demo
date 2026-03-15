import { useEffect } from "react";
import { startSharedStateSync } from "../lib/sharedSync";

export function SharedSyncBoot() {
  useEffect(() => startSharedStateSync({ intervalMs: 10000 }), []);
  return null;
}
