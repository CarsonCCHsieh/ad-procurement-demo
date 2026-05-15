export function getCustomCommentLines(value: string | undefined | null): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function countCustomCommentLines(value: string | undefined | null): number {
  return getCustomCommentLines(value).length;
}

export function isCustomCommentsPlacementText(value: string | undefined | null): boolean {
  const text = String(value ?? "").toLowerCase();
  const hasCustom = text.includes("custom") || text.includes("自訂") || text.includes("自定義");
  const hasComments = text.includes("comment") || text.includes("留言") || text.includes("評論");
  return hasCustom && hasComments;
}


export function isCustomCommentsService(value: { name?: string; type?: string; category?: string } | undefined | null): boolean {
  if (!value) return false;
  return isCustomCommentsPlacementText([value.name, value.type, value.category].filter(Boolean).join(" "));
}

export function assignCustomCommentsToBatches<
  TBatch extends { quantity: number; splits: Array<TSplit> },
  TSplit extends { quantity: number },
>(batches: TBatch[], commentsText: string | undefined | null): TBatch[] {
  const lines = getCustomCommentLines(commentsText);
  let cursor = 0;

  return batches.map((batch) => {
    const splits = batch.splits.map((split) => {
      const take = Math.max(0, Math.floor(Number(split.quantity) || 0));
      const comments = lines.slice(cursor, cursor + take).join("\n");
      cursor += take;
      return { ...split, comments };
    });

    return {
      ...batch,
      comments: splits
        .map((split) => (typeof split.comments === "string" ? split.comments : ""))
        .filter(Boolean)
        .join("\n"),
      splits,
    };
  });
}
