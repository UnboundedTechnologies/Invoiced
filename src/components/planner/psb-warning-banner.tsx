import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function PsbWarningBanner({ risk }: { risk: "amber" | "red" }) {
  const isRed = risk === "red";
  const tone = isRed
    ? "border-rose-500/40 bg-rose-500/10"
    : "border-amber-500/40 bg-amber-500/10";
  const iconTone = isRed ? "text-rose-400" : "text-amber-400";
  const dotTone = isRed ? "bg-rose-500/20" : "bg-amber-500/20";

  return (
    <Card className={tone}>
      <CardContent className="flex items-start gap-3 py-4">
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-md ${dotTone}`}>
          <ShieldAlert className={`size-4 ${iconTone}`} />
        </div>
        <div className="space-y-1 text-sm">
          <p className="font-semibold">
            PSB risk: {isRed ? "RED" : "amber"}
          </p>
          <p className="text-muted-foreground">
            {isRed
              ? "Planner recommendations assume CCPC active-business treatment. A PSB reclass would push your corp rate toward 44.5% and disallow deductions beyond salary. Tighten your "
              : "Consider tightening your "}
            <Link href="/psb" className="underline underline-offset-2 hover:text-foreground">
              /psb checklist
            </Link>
            {" "}before committing to a salary strategy. Consult a CPA if in doubt.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
