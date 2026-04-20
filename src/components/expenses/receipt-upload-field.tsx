"use client";

import { useRef, useState } from "react";
import { CloudUpload, FileText, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
 * Drag-drop file field for the CREATE dialog. The staged file lives in a
 * hidden <input name="receipt"> inside the main form, so the form's action
 * (createExpense) sees it on submit. No server call happens here.
 */
export function ReceiptUploadField() {
  const fileRef = useRef<HTMLInputElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function accept(f: File) {
    if (!ALLOWED_MIMES.has(f.type)) {
      setErr("Receipt must be PDF, JPEG, PNG, WebP, or HEIC.");
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setErr(`Receipt too large. Max ${MAX_MB} MB.`);
      return;
    }
    setErr(null);
    setStaged(f);
    // Mirror the File into the named hidden input so the enclosing form sees it.
    if (hiddenRef.current) {
      const dt = new DataTransfer();
      dt.items.add(f);
      hiddenRef.current.files = dt.files;
    }
  }

  function clear() {
    setStaged(null);
    setErr(null);
    if (hiddenRef.current) hiddenRef.current.value = "";
    if (fileRef.current) fileRef.current.value = "";
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) accept(f);
  }

  const labelText = staged ? staged.name : "Drop receipt here or click to browse";

  return (
    <div className="space-y-1.5">
      <Label>Receipt (optional)</Label>
      <input ref={hiddenRef} type="file" name="receipt" className="hidden" />
      <div
        onDragOver={onDragOver}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !staged && fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !staged && fileRef.current?.click()}
        className={cn(
          "relative flex items-center gap-3 rounded-lg border-2 border-dashed p-4 transition-colors",
          staged
            ? "border-sky-500/40 bg-sky-500/5"
            : dragOver
              ? "cursor-pointer border-primary bg-primary/10"
              : "cursor-pointer border-border/60 bg-muted/10 hover:border-primary/50 hover:bg-muted/20",
        )}
      >
        {staged ? (
          <FileText className="size-6 shrink-0 text-sky-400" />
        ) : (
          <CloudUpload className={cn("size-6 shrink-0", dragOver ? "text-primary" : "text-muted-foreground")} />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{labelText}</div>
          <div className="text-[11px] text-muted-foreground">
            PDF / JPG / PNG / WebP / HEIC · max {MAX_MB} MB
          </div>
        </div>
        {staged && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              clear();
            }}
            aria-label="Remove staged receipt"
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
      {err && <p className="text-xs text-rose-400">{err}</p>}
      <input
        ref={fileRef}
        type="file"
        accept={Array.from(ALLOWED_MIMES).join(",")}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) accept(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
