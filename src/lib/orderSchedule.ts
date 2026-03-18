import type { DemoOrderBatch, DemoOrderBatchStatus, DemoOrderLine, OrderSubmitMode, VendorSplitExec } from "./ordersStore";

type BuildBatchesInput = {
  quantity: number;
  amount: number;
  warnings: string[];
  splits: VendorSplitExec[];
};

type BuildAverageBatchesInput = BuildBatchesInput & {
  startDate: string;
  endDate: string;
  minUnit: number;
};

function roundAmount(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function batchStatusFromSplits(splits: VendorSplitExec[]): DemoOrderBatchStatus {
  if (!splits.length) return "scheduled";

  const statuses = splits.map((split) => String(split.vendorStatus ?? "").trim().toLowerCase());
  const hasTerminalSuccess = statuses.some((status) => status.includes("complete") || status.includes("done") || status.includes("success"));
  const hasFailure = statuses.some((status) => status.includes("fail") || status.includes("error") || status.includes("cancel") || status.includes("refund"));
  const hasActiveOrder = splits.some((split) => !!split.vendorOrderId);

  if (hasFailure && !hasTerminalSuccess && !hasActiveOrder) return "failed";
  if (hasFailure) return "partial";
  if (hasActiveOrder && splits.every((split) => typeof split.remains === "number" && split.remains <= 0)) return "completed";
  if (hasActiveOrder) return "submitted";
  return "scheduled";
}

function cloneSplit(split: VendorSplitExec, quantity: number): VendorSplitExec {
  return {
    ...split,
    quantity,
    vendorOrderId: undefined,
    vendorStatus: "scheduled",
    remains: quantity,
    startCount: undefined,
    charge: undefined,
    currency: undefined,
    lastSyncAt: undefined,
    error: "",
  };
}

function batchId(index: number) {
  return `batch-${index + 1}`;
}

function addDays(isoDate: string, offset: number) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function countAverageExecutionDays(startDate: string, endDate: string) {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const start = new Date(sy, (sm ?? 1) - 1, sd ?? 1);
  const end = new Date(ey, (em ?? 1) - 1, ed ?? 1);
  const diffMs = end.getTime() - start.getTime();
  return Math.floor(diffMs / 86_400_000);
}

export function buildInstantBatches(input: BuildBatchesInput): DemoOrderBatch[] {
  return [
    {
      id: batchId(0),
      stageIndex: 1,
      stageCount: 1,
      quantity: input.quantity,
      amount: input.amount,
      warnings: [...input.warnings],
      splits: input.splits.map((split) => ({ ...split })),
      status: batchStatusFromSplits(input.splits),
    },
  ];
}

export function buildAverageBatches(input: BuildAverageBatchesInput): DemoOrderBatch[] {
  const dayCount = countAverageExecutionDays(input.startDate, input.endDate);
  if (dayCount <= 0) return [];

  const totalUnits = Math.floor(input.quantity / input.minUnit);
  const unitPrice = input.quantity > 0 ? input.amount / input.quantity : 0;
  const baseUnits = Math.floor(totalUnits / dayCount);
  const remainder = totalUnits % dayCount;

  return Array.from({ length: dayCount }, (_, index) => {
    const units = baseUnits + (index < remainder ? 1 : 0);
    const quantity = units * input.minUnit;
    const amount = roundAmount(quantity * unitPrice);
    const ratio = input.quantity > 0 ? quantity / input.quantity : 0;
    const splits = input.splits.map((split) => cloneSplit(split, Math.round(split.quantity * ratio)));

    const adjustedSplits = (() => {
      const target = quantity;
      const current = splits.reduce((sum, split) => sum + split.quantity, 0);
      if (current === target || splits.length === 0) return splits;
      const delta = target - current;
      const last = splits[splits.length - 1];
      return [...splits.slice(0, -1), { ...last, quantity: Math.max(0, last.quantity + delta), remains: Math.max(0, last.quantity + delta) }];
    })();

    return {
      id: batchId(index),
      stageIndex: index + 1,
      stageCount: dayCount,
      plannedDate: addDays(input.startDate, index),
      quantity,
      amount,
      warnings: [...input.warnings],
      splits: adjustedSplits,
      status: "scheduled",
    } satisfies DemoOrderBatch;
  });
}

export function getLineBatches(line: DemoOrderLine): DemoOrderBatch[] {
  if (Array.isArray(line.batches) && line.batches.length > 0) return line.batches;
  return buildInstantBatches({
    quantity: line.quantity,
    amount: line.amount,
    warnings: Array.isArray(line.warnings) ? line.warnings : [],
    splits: Array.isArray(line.splits) ? line.splits : [],
  });
}

export function getLineSubmitMode(line: DemoOrderLine): OrderSubmitMode {
  return line.mode ?? (Array.isArray(line.batches) && line.batches.length > 1 ? "average" : "instant");
}
