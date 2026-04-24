"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Table } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  generateT4WorkingCopyCsv,
  generateT5WorkingCopyCsv,
} from "@/server/actions/slips";

type Kind = "T4" | "T5";

export function GenerateSlipCsvButton({
  kind,
  taxYear,
  disabled,
  disabledReason,
}: {
  kind: Kind;
  taxYear: number;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (disabled) {
      if (disabledReason) toast.error(disabledReason);
      return;
    }
    startTransition(async () => {
      const r =
        kind === "T4"
          ? await generateT4WorkingCopyCsv(taxYear)
          : await generateT5WorkingCopyCsv(taxYear);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      if (!r.csvBase64 || !r.filename) {
        toast.error("No CSV returned.");
        return;
      }
      const bytes = atob(r.csvBase64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      // UTF-8 BOM is already at the start of the buffer. MIME per RFC 7111.
      const blob = new Blob([arr], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`${kind} CSV downloaded.`);
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={pending || disabled}
      className="gap-2"
      title={disabled ? disabledReason : undefined}
    >
      <Table className="size-4" />
      {pending ? "Generating…" : `Download ${kind} CSV`}
    </Button>
  );
}
