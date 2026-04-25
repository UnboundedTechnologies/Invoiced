"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Library, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  listAvailableContractDocuments,
  linkVaultDocumentToContract,
} from "@/server/actions/contract-document";

type VaultDoc = Awaited<ReturnType<typeof listAvailableContractDocuments>>[number];

export function VaultPicker({
  contractId,
  contractVersion,
  open,
  onOpenChange,
}: {
  contractId: string;
  contractVersion: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [docs, setDocs] = useState<VaultDoc[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelected(null);
    listAvailableContractDocuments()
      .then((d) => setDocs(d))
      .finally(() => setLoading(false));
  }, [open]);

  function handleLink() {
    if (!selected) return;
    startTransition(async () => {
      const r = await linkVaultDocumentToContract(contractId, selected, contractVersion);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
        onOpenChange(false);
      }
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Library className="size-5" />
            Choose from vault
          </DialogTitle>
          <DialogDescription>
            Pick a contract PDF you've already uploaded. Each document can be linked to one contract at a time.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto rounded-md border border-border/40 bg-muted/10">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : !docs || docs.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No available documents in the vault. Upload a new PDF instead.
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {docs.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(d.id)}
                    className={cn(
                      "flex w-full items-start gap-3 p-3 text-left transition-colors",
                      selected === d.id
                        ? "bg-primary/10"
                        : "hover:bg-muted/20",
                    )}
                  >
                    <div
                      className={cn(
                        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md ring-1 ring-inset",
                        selected === d.id
                          ? "bg-primary/20 ring-primary/40 text-primary"
                          : "bg-muted ring-border text-muted-foreground",
                      )}
                    >
                      <FileText className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{d.name}</span>
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          v{d.version}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {(d.sizeBytes / 1024).toFixed(0)} KB · uploaded{" "}
                        {new Date(d.uploadedAt).toLocaleDateString("en-CA")}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="brand"
            disabled={!selected || pending}
            onClick={handleLink}
          >
            {pending ? "Linking…" : "Link to contract"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
