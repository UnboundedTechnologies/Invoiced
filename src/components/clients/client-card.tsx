"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Building2,
  Mail,
  Phone,
  MapPin,
  Pencil,
  Archive,
  ArchiveRestore,
  Plus,
  Calendar,
  Hash,
  Briefcase,
  FileText,
  ExternalLink,
  Paperclip,
} from "lucide-react";
import type { Client, Contract, Document } from "@/lib/db/schema";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { ClientForm } from "./client-form";
import { ContractForm } from "./contract-form";
import { ContractDocumentSection } from "./contract-document-section";
import { archiveClient, restoreClient, archiveContract, reactivateContract } from "@/server/actions/clients";
import { formatCAD } from "@/lib/utils";
import { cn } from "@/lib/utils";

type ContractRow = { contract: Contract; document: Document | null };

const TERMS_LABEL: Record<string, string> = {
  DUE_ON_RECEIPT: "Due on receipt",
  NET_15: "Net 15",
  NET_30: "Net 30",
  NET_45: "Net 45",
  NET_60: "Net 60",
};

const CADENCE_LABEL: Record<string, string> = {
  weekly: "Weekly",
  "bi-weekly": "Bi-weekly",
  "semi-monthly": "Semi-monthly",
  monthly: "Monthly",
};

export function ClientCard({ client, contracts }: { client: Client; contracts: ContractRow[] }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const [editingContractId, setEditingContractId] = useState<string | null>(null);
  const [documentContractId, setDocumentContractId] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Always derive from current contracts array so re-renders show fresh data
  const editingRow = editingContractId
    ? contracts.find((r) => r.contract.id === editingContractId)
    : undefined;
  const documentRow = documentContractId
    ? contracts.find((r) => r.contract.id === documentContractId)
    : undefined;

  async function handleArchive() {
    const r = client.archived ? await restoreClient(client.id) : await archiveClient(client.id);
    if (r.ok) {
      toast.success(r.ok);
      router.refresh();
    }
    if (r.error) toast.error(r.error);
    setArchiveOpen(false);
  }

  function openNewContract() {
    setEditingContractId(null);
    setContractOpen(true);
  }
  function openEditContract(id: string) {
    setEditingContractId(id);
    setContractOpen(true);
  }

  return (
    <Card className={cn(client.archived && "opacity-60")}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/30">
              <Building2 className="size-5 text-emerald-400" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-base truncate">{client.legalName}</h3>
                {client.archived && (
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Archived
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {client.apContactName && (
                  <span className="inline-flex items-center gap-1">
                    <Briefcase className="size-3" /> {client.apContactName}
                  </span>
                )}
                {client.apEmail && (
                  <span className="inline-flex items-center gap-1">
                    <Mail className="size-3" /> {client.apEmail}
                  </span>
                )}
                {client.apPhone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="size-3" /> {client.apPhone}
                  </span>
                )}
                {client.city && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" /> {client.city}
                    {client.province ? `, ${client.province}` : ""}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon" onClick={() => setEditOpen(true)} aria-label="Edit client">
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setArchiveOpen(true)}
              aria-label={client.archived ? "Restore" : "Archive"}
            >
              {client.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <Separator />
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Contracts ({contracts.length})
          </div>
          <Button size="sm" variant="outline" onClick={openNewContract} className="gap-1.5">
            <Plus className="size-3.5" />
            Add contract
          </Button>
        </div>

        {contracts.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/50 p-4 text-center text-sm text-muted-foreground">
            No contracts yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {contracts.map((row) => (
              <ContractRowDisplay
                key={row.contract.id}
                row={row}
                onEdit={() => openEditContract(row.contract.id)}
                onOpenDocument={() => setDocumentContractId(row.contract.id)}
              />
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit client</DialogTitle>
            <DialogDescription>Update {client.legalName}.</DialogDescription>
          </DialogHeader>
          <ClientForm client={client} onDone={() => setEditOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={contractOpen} onOpenChange={setContractOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingRow ? "Edit contract" : "New contract"}</DialogTitle>
            <DialogDescription>{client.legalName}</DialogDescription>
          </DialogHeader>
          <ContractForm
            clientId={client.id}
            contract={editingRow?.contract}
            onDone={() => setContractOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!documentContractId} onOpenChange={(o) => !o && setDocumentContractId(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Contract document</DialogTitle>
            <DialogDescription>
              {documentRow?.contract.label || "Untitled contract"}
            </DialogDescription>
          </DialogHeader>
          {documentRow && (
            <ContractDocumentSection
              key={`${documentRow.contract.id}::${documentRow.document?.id ?? "none"}`}
              contract={documentRow.contract}
              document={documentRow.document}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {client.archived ? "Restore client?" : "Archive client?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {client.archived
                ? `${client.legalName} will appear in the active list again.`
                : `${client.legalName} will be hidden from the active list. Past invoices and contracts stay intact.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive}>
              {client.archived ? "Restore" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ContractRowDisplay({
  row,
  onEdit,
  onOpenDocument,
}: {
  row: ContractRow;
  onEdit: () => void;
  onOpenDocument: () => void;
}) {
  const router = useRouter();
  const { contract, document } = row;
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function toggle() {
    const r = contract.active ? await archiveContract(contract.id) : await reactivateContract(contract.id);
    if (r.ok) {
      toast.success(r.ok);
      router.refresh();
    }
    if (r.error) toast.error(r.error);
    setConfirmOpen(false);
  }

  return (
    <li
      className={cn(
        "rounded-lg border border-border/40 bg-muted/20 p-3 transition-colors hover:border-border",
        !contract.active && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium truncate">
              {contract.label || "Untitled contract"}
            </span>
            {contract.reference && (
              <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                <Hash className="size-2.5" />
                {contract.reference}
              </span>
            )}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                contract.active
                  ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {contract.active ? "Active" : "Inactive"}
            </span>
            {document && (
              <a
                href={`/api/contracts/${contract.id}/document`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20 transition-colors hover:bg-emerald-500/20"
                title={`${document.name} (v${document.version})`}
              >
                <FileText className="size-2.5" />
                v{document.version}
                <ExternalLink className="size-2.5" />
              </a>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="text-foreground font-medium">{formatCAD(contract.rateCents)}</span>
              {" / "}
              {contract.rateUnit}
            </span>
            <span>{CADENCE_LABEL[contract.billingCadence] ?? contract.billingCadence}</span>
            <span>{TERMS_LABEL[contract.paymentTerms] ?? contract.paymentTerms}</span>
            <span>{contract.hstApplicable ? "+ HST" : "No HST"}</span>
            <span className="inline-flex items-center gap-1">
              <Calendar className="size-3" />
              {contract.startDate}
              {contract.endDate ? ` to ${contract.endDate}` : ""}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit contract">
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenDocument}
            aria-label="Manage document"
            className="relative"
          >
            <Paperclip className="size-4" />
            {document && (
              <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-emerald-500 ring-2 ring-card" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setConfirmOpen(true)}
            aria-label={contract.active ? "Deactivate" : "Reactivate"}
          >
            {contract.active ? <Archive className="size-4" /> : <ArchiveRestore className="size-4" />}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {contract.active ? "Deactivate contract?" : "Reactivate contract?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {contract.active
                ? "Past invoices remain linked. New invoices can't use this contract until you reactivate it."
                : "This contract becomes available for new invoices again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={toggle}>
              {contract.active ? "Deactivate" : "Reactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
