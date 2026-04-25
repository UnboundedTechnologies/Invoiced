"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Archive, ArchiveRestore, ExternalLink } from "lucide-react";
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
import {
  deleteMiscDocument,
  archiveDocument,
  unarchiveDocument,
} from "@/server/actions/vault";

export type VaultRowMeta = {
  id: string;
  name: string;
  archived: boolean;
  parentLabel: string | null;
  parentHref: string | null;
  /** True when the parent flow OWNS this row (primary contract PDF, an
   * invoice/paystub/receipt PDF) — vault delete + archive are disabled and
   * the user must go to the parent flow to remove. False for ancillary
   * contract attachments which are vault-owned even though they show a
   * "Linked to" pill. */
  parentOwned: boolean;
};

export function VaultRowActions({ row }: { row: VaultRowMeta }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const lockedByParent = row.parentOwned;

  function doDelete() {
    setDeleteOpen(false);
    startTransition(async () => {
      const r = await deleteMiscDocument(row.id);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  function doArchive() {
    startTransition(async () => {
      const r = await archiveDocument(row.id);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  function doUnarchive() {
    startTransition(async () => {
      const r = await unarchiveDocument(row.id);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        <a
          href={`/api/documents/${row.id}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Open / download"
          aria-label="Open document"
          className="inline-flex size-7 items-center justify-center rounded-md text-cyan-400 transition-colors hover:bg-cyan-500/10"
        >
          <ExternalLink className="size-3.5" />
        </a>

        {row.archived ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-400"
            onClick={doUnarchive}
            disabled={pending}
            aria-label="Restore from archive"
            title="Restore"
          >
            <ArchiveRestore className="size-3.5" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            onClick={doArchive}
            disabled={pending || lockedByParent}
            aria-label={lockedByParent ? "Cannot archive — lockedByParent to parent" : "Archive"}
            title={lockedByParent ? `Linked to ${row.parentLabel}. Can't archive while bound.` : "Archive"}
          >
            <Archive className="size-3.5" />
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-rose-400 hover:bg-rose-500/10 hover:text-rose-400 disabled:text-muted-foreground/50"
          onClick={() => setDeleteOpen(true)}
          disabled={pending || lockedByParent}
          aria-label={lockedByParent ? "Cannot delete — lockedByParent to parent" : "Delete"}
          title={lockedByParent ? `Delete from ${row.parentLabel}` : "Delete"}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>
              Wipes &ldquo;{row.name}&rdquo; from the vault and deletes the underlying file
              from blob storage. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
