"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  FileText,
  Upload,
  ExternalLink,
  Trash2,
  History,
  Library,
  Loader2,
  CloudUpload,
} from "lucide-react";
import type { Contract, Document } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  uploadContractDocument,
  replaceContractDocument,
  unlinkContractDocument,
} from "@/server/actions/contract-document";
import { VaultPicker } from "./vault-picker";

const MAX_MB = 10;

type DocumentLite = Pick<
  Document,
  "id" | "name" | "version" | "sizeBytes" | "uploadedAt" | "supersedesDocumentId"
>;

export function ContractDocumentSection({
  contract,
  document,
}: {
  contract: Contract;
  document: DocumentLite | null;
}) {
  const router = useRouter();
  const [vaultOpen, setVaultOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function pickFresh() {
    fileRef.current?.click();
  }
  function pickReplace() {
    replaceRef.current?.click();
  }

  async function doUpload(file: File) {
    if (file.type !== "application/pdf") return toast.error("PDFs only.");
    if (file.size > MAX_MB * 1024 * 1024) return toast.error(`File too large. Max ${MAX_MB} MB.`);
    const fd = new FormData();
    fd.append("document", file);
    startTransition(async () => {
      const r = await uploadContractDocument(contract.id, fd);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  async function doReplace(file: File) {
    if (file.type !== "application/pdf") return toast.error("PDFs only.");
    if (file.size > MAX_MB * 1024 * 1024) return toast.error(`File too large. Max ${MAX_MB} MB.`);
    const fd = new FormData();
    fd.append("document", file);
    startTransition(async () => {
      const r = await replaceContractDocument(contract.id, fd);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  async function doUnlink() {
    startTransition(async () => {
      const r = await unlinkContractDocument(contract.id);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      }
      if (r.error) toast.error(r.error);
    });
  }

  // ─── Drag handlers ───
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }
  function onDragLeave() {
    setDragOver(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) doUpload(file);
  }

  // ─── Already linked: show document card ───
  if (document) {
    const lastDot = document.name.lastIndexOf(".");
    const base = lastDot > 0 ? document.name.slice(0, lastDot) : document.name;
    const ext = lastDot > 0 ? document.name.slice(lastDot) : "";

    return (
      <div className="space-y-2 overflow-hidden">
        <Label>Contract document</Label>
        <div className="overflow-hidden rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/30">
              <FileText className="size-5 text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 min-w-0">
                {/* Middle-truncate: keep first chars + always show extension */}
                <span
                  className="flex min-w-0 flex-1 items-baseline overflow-hidden text-sm"
                  title={document.name}
                >
                  <span className="min-w-0 truncate font-medium">{base}</span>
                  <span className="shrink-0 font-medium">{ext}</span>
                </span>
                <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
                  v{document.version}
                </span>
                {document.supersedesDocumentId && (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"
                    title="Replaces an earlier version"
                  >
                    <History className="size-3" />
                    versioned
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {(document.sizeBytes / 1024).toFixed(0)} KB · uploaded{" "}
                {new Date(document.uploadedAt).toLocaleDateString("en-CA")}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <a href={`/api/contracts/${contract.id}/document`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" />
                View
              </a>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={pickReplace}
              disabled={pending}
              title={`Upload a new version. Current is v${document.version}, new will be v${document.version + 1}.`}
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              Replace
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1.5 text-rose-400 hover:bg-rose-500/10 hover:text-rose-400"
              onClick={doUnlink}
              disabled={pending}
            >
              <Trash2 className="size-3.5" />
              Unlink
            </Button>
          </div>
          <input
            ref={replaceRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) doReplace(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
    );
  }

  // ─── Not linked: drag-drop zone + browse vault ───
  return (
    <div className="space-y-2">
      <Label>Contract document</Label>
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={pickFresh}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && pickFresh()}
        className={cn(
          "relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 transition-all",
          dragOver
            ? "border-primary bg-primary/10 scale-[1.01]"
            : "border-border/60 bg-muted/10 hover:border-primary/50 hover:bg-muted/20",
          pending && "pointer-events-none opacity-60",
        )}
      >
        {pending ? (
          <>
            <Loader2 className="size-8 animate-spin text-primary" />
            <div className="text-sm font-medium">Uploading…</div>
          </>
        ) : (
          <>
            <CloudUpload
              className={cn(
                "size-8 transition-colors",
                dragOver ? "text-primary" : "text-muted-foreground",
              )}
            />
            <div className="text-sm">
              <span className="font-medium">Drop PDF here</span>{" "}
              <span className="text-muted-foreground">or click to browse</span>
            </div>
            <div className="text-[11px] text-muted-foreground">PDF only · max {MAX_MB} MB</div>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) doUpload(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border/40" />
        <span>or</span>
        <span className="h-px flex-1 bg-border/40" />
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full gap-1.5"
        onClick={() => setVaultOpen(true)}
        disabled={pending}
      >
        <Library className="size-4" />
        Choose from vault
      </Button>

      <VaultPicker
        contractId={contract.id}
        open={vaultOpen}
        onOpenChange={setVaultOpen}
      />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-medium leading-none">{children}</div>;
}
