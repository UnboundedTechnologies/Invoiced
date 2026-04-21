"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CloudUpload, FileText, X, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  USER_UPLOADABLE,
  CATEGORY_LABEL,
  CATEGORY_HINT,
  type VaultCategory,
} from "@/lib/vault-categories";
import { uploadMiscDocument } from "@/server/actions/vault";

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

type Result = { ok?: string; error?: string; documentId?: string };

export function UploadVaultDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(uploadMiscDocument, undefined as Result | undefined);

  const [category, setCategory] = useState<VaultCategory>("other");
  const [staged, setStaged] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.ok);
      setOpen(false);
      reset();
      router.refresh();
    }
    if (state?.error) toast.error(state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function reset() {
    setCategory("other");
    setStaged(null);
    setFileErr(null);
    setDisplayName("");
    if (hiddenRef.current) hiddenRef.current.value = "";
    if (fileRef.current) fileRef.current.value = "";
  }

  function accept(f: File) {
    if (!ALLOWED_MIMES.has(f.type)) {
      setFileErr("File must be PDF, JPEG, PNG, WebP, or HEIC.");
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setFileErr(`File too large. Max ${MAX_MB} MB.`);
      return;
    }
    setFileErr(null);
    setStaged(f);
    if (hiddenRef.current) {
      const dt = new DataTransfer();
      dt.items.add(f);
      hiddenRef.current.files = dt.files;
    }
  }

  function clear() {
    setStaged(null);
    setFileErr(null);
    if (hiddenRef.current) hiddenRef.current.value = "";
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="brand" className="gap-1.5">
          <Upload className="size-4" />
          Upload
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload to vault</DialogTitle>
          <DialogDescription>
            For misc docs — articles of incorporation, NDAs, filed tax returns, anything
            else you want protected behind the vault PIN.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <Select
              name="category"
              value={category}
              onValueChange={(v) => setCategory(v as VaultCategory)}
            >
              <SelectTrigger id="category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USER_UPLOADABLE.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{CATEGORY_HINT[category]}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="name">
              Display name <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="name"
              name="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={staged?.name ?? "Leave blank to use the file name"}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label>File</Label>
            <input ref={hiddenRef} type="file" name="file" className="hidden" />
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f) accept(f);
              }}
              onClick={() => !staged && fileRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) =>
                (e.key === "Enter" || e.key === " ") && !staged && fileRef.current?.click()
              }
              className={cn(
                "relative flex items-center gap-3 rounded-lg border-2 border-dashed p-4 transition-colors",
                staged
                  ? "border-cyan-500/40 bg-cyan-500/5"
                  : dragOver
                    ? "cursor-pointer border-primary bg-primary/10"
                    : "cursor-pointer border-border/60 bg-muted/10 hover:border-primary/50 hover:bg-muted/20",
              )}
            >
              {staged ? (
                <FileText className="size-6 shrink-0 text-cyan-400" />
              ) : (
                <CloudUpload
                  className={cn("size-6 shrink-0", dragOver ? "text-primary" : "text-muted-foreground")}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {staged ? staged.name : "Drop a file here or click to browse"}
                </div>
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
                  aria-label="Remove staged file"
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
            {fileErr && <p className="text-xs text-rose-400">{fileErr}</p>}
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

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                reset();
              }}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={pending || !staged}>
              {pending ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
