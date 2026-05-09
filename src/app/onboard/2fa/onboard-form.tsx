"use client";

import Image from "next/image";
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PinInput } from "@/components/vault/pin-input";
import { AuroraBackground } from "@/components/login/aurora-background";
import { enrollStart, enrollVerify } from "@/server/actions/totp";
import { logoutAction } from "@/server/actions/auth";
import {
  ShieldCheck,
  Sparkles,
  QrCode,
  Copy,
  Check,
  KeyRound,
  LogOut,
  ArrowRight,
} from "lucide-react";

type Step = "intro" | "qr" | "verify" | "backup";
type EnrollPayload = {
  qrDataUri: string;
  base32Secret: string;
  backupCodes: string[];
};

export function OnboardForm({ email }: { email: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("intro");
  const [payload, setPayload] = useState<EnrollPayload | null>(null);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState<"secret" | "codes" | null>(null);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, startTransition] = useTransition();
  const [, logoutTransition] = useTransition();

  const [verifyState, verifyAction, verifyPending] = useActionState(enrollVerify, undefined);

  useEffect(() => {
    if (verifyState?.ok) {
      toast.success(verifyState.ok);
      setStep("backup");
    }
    if (verifyState?.error) toast.error(verifyState.error);
  }, [verifyState]);

  // Auto-clear the "copied" pill 1.8s after a copy. Cleanup cancels if the
  // user navigates away mid-flight to avoid a setState-on-unmounted warning.
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
      // cancelled if the user navigates away mid-flight.
    } catch {
      toast.error("Couldn't copy. Select and copy manually.");
    }
  }

  function handleFinish() {
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <AuroraBackground />

      <Card className="relative z-10 w-full max-w-[20rem] sm:max-w-md border-border/60 bg-card/60 backdrop-blur-xl shadow-2xl ring-brand-glow animate-in fade-in zoom-in-95 duration-500">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-14 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/30">
            <ShieldCheck className="size-7 text-emerald-400" />
          </div>
          <CardTitle className="text-2xl tracking-tight">
            {step === "intro" && "Enable two-factor authentication"}
            {step === "qr" && "Scan the QR code"}
            {step === "verify" && "Confirm the code"}
            {step === "backup" && "Save your backup codes"}
          </CardTitle>
          <CardDescription>
            {step === "intro" && (
              <>
                One-time setup for <span className="text-foreground/80">{email}</span>. Required before
                you can use the app.
              </>
            )}
            {step === "qr" && "Open your authenticator app, scan this code, then move on."}
            {step === "verify" && "Enter a 6-digit code from your app to prove the link works."}
            {step === "backup" && "Single-use codes for if your phone is lost. Save them somewhere safe."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "intro" && (
            <>
              <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
                Works with any TOTP authenticator: Google Authenticator, Authy, 1Password, Bitwarden, etc.
                Required at every login + every vault unlock.
              </div>
              {startError && (
                <p className="text-sm text-destructive" role="alert">{startError}</p>
              )}
              <div className="flex flex-col gap-2">
                <Button variant="brand" onClick={handleStart} disabled={isStarting} size="lg">
                  <Sparkles className="size-4" />
                  {isStarting ? "Generating…" : "Get started"}
                </Button>
                <button
                  type="button"
                  onClick={() => logoutTransition(() => logoutAction())}
                  className="mx-auto flex items-center gap-1.5 pt-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <LogOut className="size-3.5" /> Sign out instead
                </button>
              </div>
            </>
          )}

          {step === "qr" && payload && (
            <>
              <div className="flex flex-col items-center gap-3">
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
              </div>
              <div className="flex justify-end">
                <Button variant="brand" onClick={() => setStep("verify")}>
                  <QrCode className="size-4" /> I've scanned it
                </Button>
              </div>
            </>
          )}

          {step === "verify" && payload && (
            <form action={verifyAction} className="space-y-4">
              <div className="space-y-2">
                <Label className="block text-center text-xs uppercase tracking-wide text-muted-foreground">
                  Code from your app
                </Label>
                <PinInput name="code" value={code} onChange={setCode} disabled={verifyPending} mask={false} />
                {verifyState?.error && (
                  <p className="text-center text-sm text-destructive" role="alert">{verifyState.error}</p>
                )}
              </div>
              <div className="flex items-center justify-between">
                <Button type="button" variant="ghost" onClick={() => setStep("qr")} disabled={verifyPending}>
                  Back
                </Button>
                <Button type="submit" variant="brand" disabled={verifyPending || code.length !== 6}>
                  <KeyRound className="size-4" />
                  {verifyPending ? "Verifying…" : "Confirm"}
                </Button>
              </div>
            </form>
          )}

          {step === "backup" && payload && (
            <>
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-300">
                These 10 codes are your only way back in if your phone is lost. Each works once. They are
                hashed in the database — we cannot show them again.
              </div>
              <div className="rounded-md border border-border/60 bg-muted/30 p-3">
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
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={savedConfirmed}
                  onChange={(e) => setSavedConfirmed(e.target.checked)}
                  className="size-4 cursor-pointer"
                />
                <span>I&rsquo;ve saved these codes somewhere safe.</span>
              </label>
              <Button variant="brand" disabled={!savedConfirmed} onClick={handleFinish} size="lg" className="w-full">
                <ArrowRight className="size-4" /> Continue to Invoiced
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
