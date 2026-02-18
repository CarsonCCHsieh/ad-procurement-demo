import type { SupplierConfig, VendorKey } from "../config/appConfig";

export type PlannedSplit = {
  vendor: VendorKey;
  serviceId: number;
  quantity: number;
};

function rand01(): number {
  // Prefer crypto for better randomness, fallback to Math.random.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (globalThis as any).crypto;
    if (c?.getRandomValues) {
      const buf = new Uint32Array(1);
      c.getRandomValues(buf);
      return buf[0] / 0xffffffff;
    }
  } catch {
    // ignore
  }
  return Math.random();
}

function pickWeightedIndex(weights: number[]): number {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return 0;
  const r = rand01() * sum;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r <= acc) return i;
  }
  return weights.length - 1;
}

export function planSplit(params: {
  total: number;
  suppliers: SupplierConfig[];
  vendorEnabled: (v: VendorKey) => boolean;
  // If unset, default is "random" (per user requirement).
  strategy?: "random" | "weighted";
}): { splits: PlannedSplit[]; warnings: string[] } {
  const { total, suppliers, vendorEnabled } = params;
  const warnings: string[] = [];

  if (!Number.isFinite(total) || total <= 0) return { splits: [], warnings };

  const eligible = suppliers
    .filter((s) => s.enabled)
    .filter((s) => vendorEnabled(s.vendor))
    .filter((s) => s.serviceId > 0);

  if (eligible.length === 0) {
    warnings.push("尚未設定供應商 serviceId（或全部停用），因此無法拆單。請到「控制設定」頁面設定。");
    return { splits: [], warnings };
  }

  const strategy = params.strategy ?? "random";
  const alloc = eligible.map(() => 0);
  const caps = eligible.map((s) => (s.maxPerOrder == null ? Infinity : s.maxPerOrder));

  if (strategy === "weighted") {
    const filtered = eligible.filter((s) => s.weight > 0);
    if (filtered.length === 0) {
      warnings.push("供應商權重總和為 0，無法拆單。請把 weight 設成正數，或改用 Random。");
      return { splits: [], warnings };
    }

    const sumW = filtered.reduce((a, s) => a + s.weight, 0);
    const idxMap = filtered.map((s) => eligible.indexOf(s));
    for (let i = 0; i < filtered.length; i++) {
      const idx = idxMap[i];
      alloc[idx] = Math.floor((total * filtered[i].weight) / sumW);
    }

    let remainder = total - alloc.reduce((a, b) => a + b, 0);
    while (remainder > 0) {
      const pick = pickWeightedIndex(filtered.map((s) => s.weight));
      alloc[idxMap[pick]] += 1;
      remainder -= 1;
    }
  } else {
    // Random strategy: distribute unit-by-unit across eligible suppliers uniformly,
    // respecting caps when possible.
    let remaining = total;
    while (remaining > 0) {
      const availableIdx = alloc
        .map((a, i) => (a < caps[i] ? i : -1))
        .filter((i) => i >= 0);
      if (availableIdx.length === 0) break;
      const r = Math.floor(rand01() * availableIdx.length);
      alloc[availableIdx[r]] += 1;
      remaining -= 1;
    }
    if (remaining > 0) {
      warnings.push(`供應商 maxPerOrder 容量不足，仍有 ${remaining} 無法分配（Demo 先忽略）。`);
      alloc[0] += remaining;
    }
  }

  // Apply caps and redistribute overflow (weighted strategy primarily; random already checks caps, but keep safe).
  let overflow = 0;
  for (let i = 0; i < alloc.length; i++) {
    if (alloc[i] > caps[i]) {
      overflow += alloc[i] - caps[i];
      alloc[i] = caps[i];
    }
  }
  if (overflow > 0) {
    warnings.push(`供應商 maxPerOrder 容量不足，仍有 ${overflow} 無法分配（Demo 先忽略）。`);
    alloc[0] += overflow;
  }

  const splits: PlannedSplit[] = eligible
    .map((s, i) => ({ vendor: s.vendor, serviceId: s.serviceId, quantity: alloc[i] }))
    .filter((x) => x.quantity > 0);

  return { splits, warnings };
}
