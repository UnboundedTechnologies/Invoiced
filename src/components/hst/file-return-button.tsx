"use client";

import { useActionState, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fileReturn } from "@/server/actions/hst";
import { formatCAD } from "@/lib/utils";

export function FileReturnButton({
  fiscalYear,
  netCents,
  method,
  version,
}: {
  fiscalYear: number;
  netCents: number;
  method: "regular" | "quick";
  version: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const [state, action, pending] = useActionState(
    fileReturn.bind(null, fiscalYear),
    undefined as { ok?: string; error?: string } | undefined,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.ok);
      setOpen(false);
      router.refresh();
    }
    if (state?.error) toast.error(state.error);
  }, [state, router]);

  return (
    <>
      <Button
        variant="default"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <FileCheck className="size-4" />
        File return
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <form action={action}>
            <input type="hidden" name="expectedVersion" value={version} />
            <AlertDialogHeader>
              <AlertDialogTitle>File HST return — FY {fiscalYear}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>
                    Freezes the snapshot at <strong>{formatCAD(netCents)}</strong> net tax (
                    {method === "quick" ? "Quick Method" : "Regular Method"}) and locks all
                    invoices + expenses in this period against edits or deletion. This cannot
                    be reversed from within Invoiced — corrections go on the next period&rsquo;s
                    return via CRA form GST189.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="my-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="craConfirmationNumber">CRA confirmation number</Label>
                <Input
                  id="craConfirmationNumber"
                  name="craConfirmationNumber"
                  required
                  autoComplete="off"
                  data-gramm="false"
                  placeholder="e.g., 123456789012"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="filedAt">Filed on</Label>
                <Input
                  id="filedAt"
                  name="filedAt"
                  type="date"
                  required
                  defaultValue={today}
                />
              </div>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={pending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction type="submit" disabled={pending}>
                {pending ? "Filing…" : "File + lock"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
