"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportGifiCsv } from "@/server/actions/t2";

export function ExportGifiButton({ fiscalYear }: { fiscalYear: number }) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const r = await exportGifiCsv(fiscalYear);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      if (!r.csv) {
        toast.error("No CSV returned.");
        return;
      }
      const blob = new Blob([r.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename ?? `gifi-fy${fiscalYear}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("GIFI CSV downloaded.");
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={pending} className="gap-2">
      <FileSpreadsheet className="size-4" />
      {pending ? "Exporting…" : "Export GIFI CSV"}
    </Button>
  );
}
