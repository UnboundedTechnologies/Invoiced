"use client";

/**
 * Single dropdown consolidating every T4 / T5 slip action for a tax year.
 *
 * Replaces the 3–4 separate buttons with one indigo trigger per slip type.
 * Menu items keep their semantic colors:
 *   - neutral (default): download working copy PDF, download CSV
 *   - indigo: file slip (primary action)
 *   - emerald: download filed PDF
 *   - rose: void slip
 *
 * Dialogs (File + Void) are rendered as siblings to the dropdown — clicking
 * the menu item closes the dropdown AND opens the dialog via state.
 */

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDown,
  FileText,
  Table as TableIcon,
  FileCheck,
  Lock,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  fileT4Slip,
  fileT5Slip,
  fileT4aSlip,
  voidSlip,
  generateT4WorkingCopyPdf,
  generateT5WorkingCopyPdf,
  generateT4aWorkingCopyPdf,
  generateT4WorkingCopyCsv,
  generateT5WorkingCopyCsv,
  generateT4aWorkingCopyCsv,
} from "@/server/actions/slips";

type Kind = "T4" | "T5" | "T4A";
type Filed = { id: string };

export type SlipActionsMenuProps = {
  kind: Kind;
  taxYear: number;
  /** Zero means no activity for this CY → all slip actions are blocked. */
  activityCount: number;
  /** RP (T4) or RZ (T5) active — gates the File action (not the downloads). */
  programAccountActive: boolean;
  /** Filed slip row, or null when still in draft. */
  filed: Filed | null;
};

function downloadBase64(base64: string, filename: string, mime: string) {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function SlipActionsMenu({
  kind,
  taxYear,
  activityCount,
  programAccountActive,
  filed,
}: SlipActionsMenuProps) {
  const [pendingDownload, startDownload] = useTransition();
  const [fileOpen, setFileOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);

  const hasActivity = activityCount > 0;
  const activityNoun =
    kind === "T4"
      ? "issued paycheques"
      : kind === "T5"
        ? "paid dividends"
        : "shareholder-loan benefits";
  const zeroActivityReason = `No ${activityNoun} in CY ${taxYear} — nothing to generate.`;
  const programGate =
    kind === "T4"
      ? "Activate the RP payroll account in Settings first."
      : "Activate the RZ info-returns account in Settings first.";

  function downloadWorkingCopyPdf() {
    startDownload(async () => {
      const r =
        kind === "T4"
          ? await generateT4WorkingCopyPdf(taxYear)
          : kind === "T5"
            ? await generateT5WorkingCopyPdf(taxYear)
            : await generateT4aWorkingCopyPdf(taxYear);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      if (!r.pdfBase64 || !r.filename) {
        toast.error("No PDF returned.");
        return;
      }
      downloadBase64(r.pdfBase64, r.filename, "application/pdf");
      toast.success(`${kind} working copy downloaded.`);
    });
  }

  function downloadCsv() {
    startDownload(async () => {
      const r =
        kind === "T4"
          ? await generateT4WorkingCopyCsv(taxYear)
          : kind === "T5"
            ? await generateT5WorkingCopyCsv(taxYear)
            : await generateT4aWorkingCopyCsv(taxYear);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      if (!r.csvBase64 || !r.filename) {
        toast.error("No CSV returned.");
        return;
      }
      downloadBase64(r.csvBase64, r.filename, "text/csv;charset=utf-8");
      toast.success(`${kind} CSV downloaded.`);
    });
  }

  function downloadFiledPdf() {
    if (!filed) return;
    // Browser navigation (same-origin) does the fetch + download.
    window.location.href = `/api/slips/${filed.id}/pdf?download=1`;
  }

  const isFiled = !!filed;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="default" size="sm" className="gap-2" disabled={pendingDownload}>
            <FileCheck className="size-4" />
            {kind} slip
            <ChevronDown className="size-4 opacity-80" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-[260px]">
          {/* Always-available: working-copy PDF + CSV */}
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              if (!hasActivity) return toast.error(zeroActivityReason);
              downloadWorkingCopyPdf();
            }}
            disabled={!hasActivity}
          >
            <FileText className="text-muted-foreground" />
            Download working copy PDF
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              if (!hasActivity) return toast.error(zeroActivityReason);
              downloadCsv();
            }}
            disabled={!hasActivity}
          >
            <TableIcon className="text-muted-foreground" />
            Download CSV (Web Forms re-key)
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {isFiled ? (
            <>
              <DropdownMenuItem
                className="text-emerald-300 focus:bg-emerald-500/10 focus:text-emerald-200"
                onSelect={(e) => {
                  e.preventDefault();
                  downloadFiledPdf();
                }}
              >
                <Lock className="text-emerald-400" />
                Download filed PDF
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-rose-300 focus:bg-rose-500/10 focus:text-rose-200"
                onSelect={(e) => {
                  e.preventDefault();
                  setVoidOpen(true);
                }}
              >
                <Undo2 className="text-rose-400" />
                Void slip
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem
              className="text-indigo-200 focus:bg-indigo-500/10 focus:text-indigo-100"
              onSelect={(e) => {
                e.preventDefault();
                if (!hasActivity) return toast.error(zeroActivityReason);
                if (!programAccountActive) return toast.error(programGate);
                setFileOpen(true);
              }}
              disabled={!hasActivity || !programAccountActive}
            >
              <FileCheck className="text-indigo-400" />
              File {kind} slip
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {!isFiled && (
        <FileDialog
          kind={kind}
          taxYear={taxYear}
          open={fileOpen}
          onOpenChange={setFileOpen}
        />
      )}
      {isFiled && filed && (
        <VoidDialog
          slipId={filed.id}
          kind={kind}
          taxYear={taxYear}
          open={voidOpen}
          onOpenChange={setVoidOpen}
        />
      )}
    </>
  );
}

// ─────────── File dialog ───────────

function FileDialog({
  kind,
  taxYear,
  open,
  onOpenChange,
}: {
  kind: Kind;
  taxYear: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [accountantSignoff, setAccountantSignoff] = useState(false);
  const [typedConfirm, setTypedConfirm] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const expectedPhrase = `FILE ${kind} CY${taxYear}`;
  const action = kind === "T4" ? fileT4Slip : kind === "T5" ? fileT5Slip : fileT4aSlip;

  const [state, formAction, pending] = useActionState(
    action.bind(null, taxYear),
    undefined as { ok?: string; error?: string } | undefined,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.ok);
      onOpenChange(false);
      setAccountantSignoff(false);
      setTypedConfirm("");
      router.refresh();
    }
    if (state?.error) toast.error(state.error);
  }, [state, onOpenChange, router]);

  const typedOk = typedConfirm === expectedPhrase;
  const allOk = typedOk && accountantSignoff;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <form action={formAction}>
          <AlertDialogHeader>
            <AlertDialogTitle>File {kind} slip — CY {taxYear}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Freezes the box snapshot for CY {taxYear} into the database, renders
                  the final PDF, and stores it in the vault. The filed PDF drops the
                  WORKING COPY watermark and carries the FILED ribbon + CRA confirmation.
                </p>
                <p className="text-muted-foreground">
                  Locks every {kind === "T4" ? "paycheque" : kind === "T5" ? "paid dividend" : "shareholder-loan ledger entry"} whose
                  {kind === "T4" ? " pay-date" : kind === "T5" ? " paid-date" : " entry-date"} falls in CY {taxYear}.
                  Corrections after filing route through {kind === "T4" ? "CRA T4-ADJ" : kind === "T5" ? "CRA T5-ADJ" : "an amended T4A"};
                  alternatively, void the slip here to re-open edits.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="my-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="craConfirmationNumber">CRA confirmation number (optional)</Label>
              <Input
                id="craConfirmationNumber"
                name="craConfirmationNumber"
                autoComplete="off"
                data-gramm="false"
                placeholder="From CRA Web Forms submission receipt"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filedAt">Filed on</Label>
              <Input id="filedAt" name="filedAt" type="date" required defaultValue={today} />
            </div>
            <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <Switch
                id="accountantSignoff"
                name="accountantSignoff"
                checked={accountantSignoff}
                onCheckedChange={setAccountantSignoff}
              />
              <Label htmlFor="accountantSignoff" className="text-xs cursor-pointer">
                I have accountant sign-off on the boxes above, or I have reviewed them
                myself against the underlying {kind === "T4" ? "paycheques" : kind === "T5" ? "dividends" : "shareholder-loan timeline"}.
              </Label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="typedConfirm" className="text-xs">
                Type <span className="font-mono font-bold">{expectedPhrase}</span> to confirm
              </Label>
              <Input
                id="typedConfirm"
                name="typedConfirm"
                value={typedConfirm}
                onChange={(e) => setTypedConfirm(e.target.value.toUpperCase())}
                autoComplete="off"
                data-gramm="false"
                placeholder={expectedPhrase}
                className="font-mono"
                required
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={pending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction type="submit" disabled={!allOk || pending}>
              {pending ? "Filing…" : "File + lock"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─────────── Void dialog ───────────

function VoidDialog({
  slipId,
  kind,
  taxYear,
  open,
  onOpenChange,
}: {
  slipId: string;
  kind: Kind;
  taxYear: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [typedConfirm, setTypedConfirm] = useState("");
  const expectedPhrase = `VOID ${kind} CY${taxYear}`;

  const [state, formAction, pending] = useActionState(
    voidSlip.bind(null, slipId),
    undefined as { ok?: string; error?: string } | undefined,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.ok);
      onOpenChange(false);
      setTypedConfirm("");
      router.refresh();
    }
    if (state?.error) toast.error(state.error);
  }, [state, onOpenChange, router]);

  const typedOk = typedConfirm === expectedPhrase;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <form action={formAction}>
          <AlertDialogHeader>
            <AlertDialogTitle>Void {kind} slip — CY {taxYear}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Marks the filed slip row as voided and re-opens{" "}
                  {kind === "T4" ? "paycheques" : kind === "T5" ? "paid dividends" : "shareholder-loan ledger entries"} for CY {taxYear}
                  against edits. The filed PDF stays in the vault for audit trail.
                </p>
                <p className="text-muted-foreground">
                  Use when a box value needs correcting before re-filing. CRA itself
                  requires an amended slip (T4-ADJ / T5-ADJ) for corrections after
                  their submission has been accepted — the Invoiced void is separate
                  from CRA&rsquo;s amendment process and only controls this app&rsquo;s locks.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="my-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason (audit log)</Label>
              <Textarea
                id="reason"
                name="reason"
                required
                rows={3}
                data-gramm="false"
                placeholder="E.g., Box 16 miscalculated due to pay cadence error. Re-filing with corrected CPP."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="typedConfirm" className="text-xs">
                Type <span className="font-mono font-bold">{expectedPhrase}</span> to confirm
              </Label>
              <Input
                id="typedConfirm"
                name="typedConfirm"
                value={typedConfirm}
                onChange={(e) => setTypedConfirm(e.target.value.toUpperCase())}
                autoComplete="off"
                data-gramm="false"
                placeholder={expectedPhrase}
                className="font-mono"
                required
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={pending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              type="submit"
              disabled={!typedOk || pending}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {pending ? "Voiding…" : "Void + re-open data"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
