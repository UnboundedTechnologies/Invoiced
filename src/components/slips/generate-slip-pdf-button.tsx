"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  generateT4WorkingCopyPdf,
  generateT5WorkingCopyPdf,
} from "@/server/actions/slips";

type Kind = "T4" | "T5";

export function GenerateSlipPdfButton({
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
          ? await generateT4WorkingCopyPdf(taxYear)
          : await generateT5WorkingCopyPdf(taxYear);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      if (!r.pdfBase64 || !r.filename) {
        toast.error("No PDF returned.");
        return;
      }
      const bytes = atob(r.pdfBase64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const blob = new Blob([arr], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`${kind} working copy downloaded.`);
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
      <FileText className="size-4" />
      {pending ? "Generating…" : `Download ${kind} working copy`}
    </Button>
  );
}
