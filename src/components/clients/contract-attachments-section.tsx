"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Paperclip, FileText, Lock } from "lucide-react";
import type { Document } from "@/lib/db/schema";
import { formatBytes, formatLongDate } from "@/lib/utils";
import { UnlockVaultDialog } from "@/components/vault/unlock-vault-dialog";

type AttachmentRow = Pick<
  Document,
  "id" | "name" | "sizeBytes" | "contentType" | "uploadedAt"
>;

/**
 * Read-only list of vault-uploaded attachments tied to a contract via
 * `documents.contractId`. Each row links to /api/documents/[id] which is
 * gated by session + vault PIN + (if enrolled) vault 2FA.
 *
 * If the vault is currently locked, we intercept the click and pop the
 * inline UnlockVaultDialog. After PIN (and 2FA) verify, window.open() the
 * pending attachment URL — the open is still inside transient activation
 * because the user just clicked the Unlock button.
 */
export function ContractAttachmentsSection({
  attachments,
  vaultUnlocked,
  twofaEnrolled,
}: {
  attachments: AttachmentRow[];
  vaultUnlocked: boolean;
  twofaEnrolled: boolean;
}) {
  const router = useRouter();
  const [unlockOpen, setUnlockOpen] = useState(false);
  const pendingHref = useRef<string | null>(null);

  function handleAttachmentClick(e: React.MouseEvent, href: string) {
    if (vaultUnlocked) return; // let the anchor's target=_blank do its thing
    e.preventDefault();
    pendingHref.current = href;
    setUnlockOpen(true);
  }

  function onUnlocked() {
    const href = pendingHref.current;
    setUnlockOpen(false);
    pendingHref.current = null;
    if (href) {
      // Inside the unlock-button click handler → transient activation still
      // valid → window.open is allowed. noopener prevents the new tab from
      // referencing this window's opener.
      window.open(href, "_blank", "noopener,noreferrer");
    }
    // Refresh so the next render reflects the now-unlocked state — no more
    // intercepts on subsequent clicks within the 60s TTL.
    router.refresh();
  }

  return (
    <section className="mt-6 space-y-2 border-t border-border/40 pt-4">
      <header className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground/80">
          <Paperclip className="size-3.5" /> Attachments
          <span className="text-xs font-normal text-muted-foreground">
            ({attachments.length})
          </span>
          {!vaultUnlocked && attachments.length > 0 && (
            <span
              className="ml-1 inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/5 px-1.5 py-px text-[10px] uppercase tracking-wide text-cyan-300"
              title="PIN required to open"
            >
              <Lock className="size-2.5" /> Locked
            </span>
          )}
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
          {attachments.map((a) => {
            const href = `/api/documents/${a.id}`;
            return (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/10 px-3 py-2 transition-colors hover:bg-muted/20"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="size-4 shrink-0 text-cyan-400/80" />
                  <div className="min-w-0">
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => handleAttachmentClick(e, href)}
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
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => handleAttachmentClick(e, href)}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-cyan-400 transition-colors hover:bg-cyan-500/10"
                  aria-label="Open attachment"
                  title={vaultUnlocked ? "Open" : "Unlock to open"}
                >
                  {vaultUnlocked ? (
                    <ExternalLink className="size-3.5" />
                  ) : (
                    <Lock className="size-3.5" />
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}

      <UnlockVaultDialog
        open={unlockOpen}
        onOpenChange={(v) => {
          setUnlockOpen(v);
          if (!v) pendingHref.current = null;
        }}
        onUnlocked={onUnlocked}
        twofaEnrolled={twofaEnrolled}
      />
    </section>
  );
}
