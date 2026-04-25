"use client";

import Link from "next/link";
import { ExternalLink, Paperclip, FileText } from "lucide-react";
import type { Document } from "@/lib/db/schema";
import { formatBytes, formatLongDate } from "@/lib/utils";

type AttachmentRow = Pick<
  Document,
  "id" | "name" | "sizeBytes" | "contentType" | "uploadedAt"
>;

/**
 * Read-only list of vault-uploaded attachments tied to a contract via
 * `documents.contractId`. Each row links to /api/documents/[id] which is
 * gated by session + vault PIN + (if enrolled) vault 2FA — same security
 * surface as the rest of /vault. Add / remove is done from /vault.
 */
export function ContractAttachmentsSection({
  attachments,
}: {
  attachments: AttachmentRow[];
}) {
  return (
    <section className="mt-6 space-y-2 border-t border-border/40 pt-4">
      <header className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground/80">
          <Paperclip className="size-3.5" /> Attachments
          <span className="text-xs font-normal text-muted-foreground">
            ({attachments.length})
          </span>
        </h4>
        <Link
          href="/vault?category=contract"
          className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Manage in vault →
        </Link>
      </header>

      {attachments.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/50 bg-muted/10 p-3 text-xs text-muted-foreground">
          Add insurance certificates, codes of conduct, addendums, etc. via{" "}
          <Link href="/vault" className="text-foreground/80 underline-offset-2 hover:underline">
            /vault → Upload → Contract
          </Link>
          {" "}
          and pick this contract.
        </p>
      ) : (
        <ul className="space-y-1">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/10 px-3 py-2 transition-colors hover:bg-muted/20"
            >
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="size-4 shrink-0 text-cyan-400/80" />
                <div className="min-w-0">
                  <a
                    href={`/api/documents/${a.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-sm font-medium hover:text-cyan-300 hover:underline"
                    title={a.name}
                  >
                    {a.name}
                  </a>
                  <div className="text-[11px] text-muted-foreground">
                    {formatBytes(Number(a.sizeBytes))} ·{" "}
                    {formatLongDate(a.uploadedAt.toISOString().slice(0, 10))}
                  </div>
                </div>
              </div>
              <a
                href={`/api/documents/${a.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-cyan-400 transition-colors hover:bg-cyan-500/10"
                aria-label="Open attachment"
                title="Open"
              >
                <ExternalLink className="size-3.5" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
