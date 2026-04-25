import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Image as ImageIcon, File, History, Lock } from "lucide-react";
import { cn, formatBytes, formatLongDate } from "@/lib/utils";
import { TONE } from "@/lib/tones";
import {
  CATEGORY_LABEL,
  CATEGORY_TONE,
  isVaultCategory,
  type VaultCategory,
} from "@/lib/vault-categories";
import type { Document } from "@/lib/db/schema";
import type { ParentLink } from "@/lib/vault-parent-links";
import { VaultRowActions } from "./vault-row-actions";

function pickIcon(contentType: string) {
  if (contentType === "application/pdf") return FileText;
  if (contentType.startsWith("image/")) return ImageIcon;
  return File;
}

function CategoryPill({ value }: { value: string }) {
  const known = isVaultCategory(value);
  const cat = (known ? value : "other") as VaultCategory;
  const tone = TONE[CATEGORY_TONE[cat]];
  const label = known ? CATEGORY_LABEL[cat] : value;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        tone.border,
        tone.bg,
        tone.text,
      )}
    >
      {label}
    </span>
  );
}

export function VaultTable({
  rows,
  parentLinks,
}: {
  rows: Document[];
  parentLinks: Map<string, ParentLink>;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border/40 bg-muted/20 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">File</th>
                <th className="px-4 py-3 text-left font-semibold">Category</th>
                <th className="px-4 py-3 text-left font-semibold">Linked to</th>
                <th className="px-4 py-3 text-right font-semibold">Size</th>
                <th className="px-4 py-3 text-left font-semibold">Uploaded</th>
                <th className="px-2 py-3 text-right font-semibold sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const Icon = pickIcon(row.contentType);
                const parent = parentLinks.get(row.id) ?? null;
                const versioned = row.version > 1 || !!row.supersedesDocumentId;
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-border/30 transition-colors hover:bg-muted/20",
                      row.archived && "opacity-60",
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <Icon className="mt-0.5 size-4 shrink-0 text-cyan-400/80" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <a
                              href={`/api/documents/${row.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate font-medium text-foreground hover:text-cyan-300 hover:underline"
                              title={row.name}
                            >
                              {row.name}
                            </a>
                            {row.archived && (
                              <span className="rounded bg-muted/40 px-1.5 py-px text-[9px] uppercase tracking-wider text-muted-foreground">
                                Archived
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <Lock className="size-3" />
                            <span className="font-mono">{row.contentType}</span>
                            {versioned && (
                              <span className="inline-flex items-center gap-1">
                                <History className="size-3" /> v{row.version}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <CategoryPill value={row.category} />
                    </td>
                    <td className="px-4 py-3">
                      {parent ? (
                        <Link
                          href={parent.href}
                          className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/20 px-2 py-0.5 text-[11px] text-foreground/80 transition-colors hover:border-primary/50 hover:text-foreground"
                          title={`Bound to ${parent.kind} — opens parent page`}
                        >
                          {parent.label}
                        </Link>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                      {formatBytes(Number(row.sizeBytes))}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs">{formatLongDate(row.uploadedAt.toISOString().slice(0, 10))}</div>
                      {row.uploadedBy && (
                        <div className="text-[11px] text-muted-foreground">{row.uploadedBy}</div>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <VaultRowActions
                        row={{
                          id: row.id,
                          name: row.name,
                          archived: row.archived,
                          parentLabel: parent?.label ?? null,
                          parentHref: parent?.href ?? null,
                          // Ancillary contract attachments are vault-owned —
                          // user can delete/archive them from /vault. Only
                          // primary parent-owned docs lock the row.
                          parentOwned:
                            !!parent && parent.kind !== "contract-attachment",
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
