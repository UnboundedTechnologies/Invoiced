"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateHstPdf } from "@/server/actions/hst";

export function GeneratePdfButton({ fiscalYear }: { fiscalYear: number }) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const r = await generateHstPdf(fiscalYear);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      if (!r.pdfBase64) {
        toast.error("No PDF returned.");
        return;
      }
      // Convert base64 → Blob → trigger a download in the browser.
      const bytes = atob(r.pdfBase64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const blob = new Blob([arr], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `HST-Return-FY${fiscalYear}.pdf`;
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
      {pending ? "Generating…" : "Filing summary PDF"}
    </Button>
  );
}
