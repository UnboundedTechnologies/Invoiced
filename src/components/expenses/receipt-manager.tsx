"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  FileText,
  Upload,
  ExternalLink,
  Trash2,
  Loader2,
  CloudUpload,
  Image as ImageIcon,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import { uploadReceipt, replaceReceipt, deleteReceipt } from "@/server/actions/expenses";

const MAX_MB = 10;
const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

/**
 * Receipt section shown in the EDIT dialog. Each action (attach / replace /
 * delete) fires its own server action — the main update action never touches
 * the blob, so field edits and receipt edits stay atomic independently.
 */
export function ReceiptManager({
  expenseId,
  hasReceipt,
}: {
  expenseId: string;
  hasReceipt: boolean;
}) {
  const router = useRouter();
  const uploadRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  function validateFile(f: File): string | null {
    if (!ALLOWED_MIMES.has(f.type)) return "Receipt must be PDF, JPEG, PNG, WebP, or HEIC.";
    if (f.size > MAX_MB * 1024 * 1024) return `Receipt too large. Max ${MAX_MB} MB.`;
    return null;
  }

  function doUpload(file: File) {
    const err = validateFile(file);
    if (err) return toast.error(err);
    const fd = new FormData();
    fd.append("receipt", file);
    startTransition(async () => {
      const r = await uploadReceipt(expenseId, fd);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  function doReplace(file: File) {
    const err = validateFile(file);
    if (err) return toast.error(err);
    const fd = new FormData();
    fd.append("receipt", file);
    startTransition(async () => {
      const r = await replaceReceipt(expenseId, fd);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  function doDelete() {
    setDeleteOpen(false);
    startTransition(async () => {
      const r = await deleteReceipt(expenseId);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) {
      if (hasReceipt) doReplace(f);
      else doUpload(f);
    }
  }

  if (hasReceipt) {
    return (
      <div className="space-y-2 rounded-md border border-sky-500/30 bg-sky-500/5 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400">
          <ImageIcon className="size-3.5" />
          Receipt
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <a href={`/api/expenses/${expenseId}/receipt`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" />
              View
            </a>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => replaceRef.current?.click()}
            disabled={pending}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            Replace
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1.5 text-rose-400 hover:bg-rose-500/10 hover:text-rose-400"
            onClick={() => setDeleteOpen(true)}
            disabled={pending}
          >
            <Trash2 className="size-3.5" />
            Remove
          </Button>
        </div>
        <input
          ref={replaceRef}
          type="file"
          accept={Array.from(ALLOWED_MIMES).join(",")}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) doReplace(f);
            e.target.value = "";
          }}
        />
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove receipt?</AlertDialogTitle>
              <AlertDialogDescription>
                The receipt file will be deleted from storage. The expense record stays — you can
                re-attach a different file later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={doDelete}>Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onClick={() => !pending && uploadRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !pending && uploadRef.current?.click()}
      className={cn(
        "relative flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-4 transition-colors",
        dragOver
          ? "border-primary bg-primary/10"
          : "border-border/60 bg-muted/10 hover:border-primary/50 hover:bg-muted/20",
        pending && "pointer-events-none opacity-60",
      )}
    >
      {pending ? (
        <Loader2 className="size-6 shrink-0 animate-spin text-primary" />
      ) : (
        <CloudUpload
          className={cn("size-6 shrink-0", dragOver ? "text-primary" : "text-muted-foreground")}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {pending ? "Uploading…" : "Attach a receipt"}
        </div>
        <div className="text-[11px] text-muted-foreground">
          Drop or click · PDF / JPG / PNG / WebP / HEIC · max {MAX_MB} MB
        </div>
      </div>
      <input
        ref={uploadRef}
        type="file"
        accept={Array.from(ALLOWED_MIMES).join(",")}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) doUpload(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

type FileTypeIcon = typeof FileText;
// Exported in case the row wants the same doc icon rendering
export const ReceiptIcon: FileTypeIcon = FileText;
