"use client";

import Image from "next/image";
import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PinInput } from "@/components/vault/pin-input";
import { enrollStart, enrollVerify } from "@/server/actions/totp";
import { ShieldCheck, QrCode, Copy, Check, KeyRound, Sparkles } from "lucide-react";

type Step = "intro" | "qr" | "verify" | "backup";

type EnrollPayload = {
  qrDataUri: string;
  base32Secret: string;
  backupCodes: string[];
};

export function TotpEnrollmentWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [step, setStep] = useState<Step>("intro");
  const [payload, setPayload] = useState<EnrollPayload | null>(null);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState<"secret" | "codes" | null>(null);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, startTransition] = useTransition();

  const [verifyState, verifyAction, verifyPending] = useActionState(enrollVerify, undefined);

  useEffect(() => {
    if (verifyState?.ok) {
      toast.success(verifyState.ok);
      setStep("backup");
    }
    if (verifyState?.error) toast.error(verifyState.error);
  }, [verifyState]);

  // Reset everything when the dialog closes.
  useEffect(() => {
    if (!open) {
      setStep("intro");
      setPayload(null);
      setCode("");
      setCopied(null);
      setSavedConfirmed(false);
      setStartError(null);
    }
  }, [open]);

  // Auto-clear the "copied" pill after 1.8s. Cleanup cancels the timeout if
  // the user closes the dialog or copies again before it fires — prevents a
  // setState-on-unmounted-component React warning.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  function handleStart() {
    setStartError(null);
    startTransition(async () => {
      const result = await enrollStart();
      if (!result.ok) {
        setStartError(result.error);
        return;
      }
      setPayload({
        qrDataUri: result.qrDataUri,
        base32Secret: result.base32Secret,
        backupCodes: result.backupCodes,
      });
      setStep("qr");
    });
  }

  async function copy(text: string, kind: "secret" | "codes") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      // Auto-clear handled by the useEffect above so the timeout is properly
      // cancelled if the dialog closes mid-flight.
    } catch {
      toast.error("Couldn't copy. Select and copy manually.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-emerald-400" />
            {step === "intro" && "Enable two-factor authentication"}
            {step === "qr" && "Scan the QR code"}
            {step === "verify" && "Confirm the code"}
            {step === "backup" && "Save your backup codes"}
          </DialogTitle>
          <DialogDescription>
            {step === "intro" && "Adds a second factor on top of your password. Required on every login and every vault access once enabled."}
            {step === "qr" && "Open your authenticator app, scan this code, then move to the next step."}
            {step === "verify" && "Enter a 6-digit code from your app to prove the link works."}
            {step === "backup" && "Single-use codes for if your phone is lost. Save them somewhere safe — they're shown only once."}
          </DialogDescription>
        </DialogHeader>

        {step === "intro" && (
          <div className="space-y-4 py-2">
            <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
              Works with any TOTP authenticator: Google Authenticator, Authy, 1Password, Bitwarden, etc.
              Your secret is encrypted at rest under <code className="rounded bg-background px-1">TOTP_ENCRYPTION_KEY</code>.
            </div>
            {startError && (
              <p className="text-sm text-destructive" role="alert">{startError}</p>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isStarting}>
                Cancel
              </Button>
              <Button variant="brand" onClick={handleStart} disabled={isStarting}>
                <Sparkles className="size-4" />
                {isStarting ? "Generating…" : "Get started"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "qr" && payload && (
          <div className="space-y-4 py-2">
            <Card className="border-border/60 bg-muted/30">
              <CardContent className="flex flex-col items-center gap-3 p-4">
                <Image
                  src={payload.qrDataUri}
                  alt="2FA enrollment QR code"
                  width={224}
                  height={224}
                  unoptimized
                  className="rounded-md border border-border/60 bg-white"
                />
                <div className="w-full space-y-2">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Or enter the secret manually
                  </Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all rounded-md border border-border/60 bg-background px-2 py-1.5 font-mono text-xs">
                      {payload.base32Secret}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => copy(payload.base32Secret, "secret")}
                    >
                      {copied === "secret" ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep("intro")}>Back</Button>
              <Button variant="brand" onClick={() => setStep("verify")}>
                <QrCode className="size-4" /> I've scanned it
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "verify" && payload && (
          <form action={verifyAction} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Code from your app
              </Label>
              <PinInput name="code" value={code} onChange={setCode} disabled={verifyPending} mask={false} />
              {verifyState?.error && (
                <p className="text-sm text-destructive" role="alert">{verifyState.error}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setStep("qr")} disabled={verifyPending}>
                Back
              </Button>
              <Button type="submit" variant="brand" disabled={verifyPending || code.length !== 6}>
                <KeyRound className="size-4" />
                {verifyPending ? "Verifying…" : "Confirm"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === "backup" && payload && (
          <div className="space-y-4 py-2">
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-300">
              These 10 codes are your only way back in if your phone is lost. Each works once. They are
              hashed in the database — we cannot show them again.
            </div>
            <Card className="border-border/60 bg-muted/30">
              <CardContent className="p-4">
                <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                  {payload.backupCodes.map((c) => (
                    <div
                      key={c}
                      className="rounded border border-border/60 bg-background px-2 py-1.5 text-center tracking-widest"
                    >
                      {c}
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => copy(payload.backupCodes.join("\n"), "codes")}
                >
                  {copied === "codes" ? (
                    <><Check className="size-4 text-emerald-400" /> Copied</>
                  ) : (
                    <><Copy className="size-4" /> Copy all</>
                  )}
                </Button>
              </CardContent>
            </Card>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={savedConfirmed}
                onChange={(e) => setSavedConfirmed(e.target.checked)}
                className="size-4 cursor-pointer"
              />
              <span>I&rsquo;ve saved these codes somewhere safe.</span>
            </label>
            <DialogFooter>
              <Button
                variant="brand"
                disabled={!savedConfirmed}
                onClick={() => onOpenChange(false)}
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
