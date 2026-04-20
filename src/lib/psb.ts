import type { PsbChecklistItem } from "@/lib/db/schema";

export type PsbRisk = "green" | "amber" | "red";

export function computePsbRisk(items: Pick<PsbChecklistItem, "status" | "weight" | "critical">[]) {
  const applicable = items.filter((i) => i.status !== "not_applicable");
  const totalWeight = applicable.reduce((a, i) => a + i.weight, 0);
  const doneWeight = applicable
    .filter((i) => i.status === "done")
    .reduce((a, i) => a + i.weight, 0);
  const score = totalWeight === 0 ? 0 : Math.round((doneWeight / totalWeight) * 100);
  const criticalMissing = applicable.some((i) => i.critical && i.status !== "done");
  const itemsDone = applicable.filter((i) => i.status === "done").length;
  const itemsTotal = applicable.length;

  let risk: PsbRisk;
  if (criticalMissing || score < 40) risk = "red";
  else if (score < 75) risk = "amber";
  else risk = "green";

  return { score, risk, itemsDone, itemsTotal, criticalMissing };
}
