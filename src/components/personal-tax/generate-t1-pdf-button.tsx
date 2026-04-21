"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateT1Pdf } from "@/server/actions/t1";

export function GenerateT1PdfButton({ taxYear }: { taxYear: number }) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const r = await generateT1Pdf(taxYear);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      if (!r.pdfBase64) {
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
      a.download = `T1-Prep-CY${taxYear}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("PDF downloaded.");
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={pending} className="gap-2">
      <FileText className="size-4" />
      {pending ? "Generating…" : "Prep summary PDF"}
    </Button>
  );
}
