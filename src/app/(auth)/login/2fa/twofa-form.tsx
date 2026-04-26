"use client";

import { useActionState, useState, useTransition } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PinInput } from "@/components/vault/pin-input";
import { AuroraBackground } from "@/components/login/aurora-background";
import { login2faAction, cancel2faAction } from "@/server/actions/auth";
import { ShieldCheck, KeyRound } from "lucide-react";

type Mode = "totp" | "backup";

export function TwoFactorForm() {
  const [mode, setMode] = useState<Mode>("totp");
  const [code, setCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [state, formAction, pending] = useActionState(login2faAction, undefined);
  const [, startCancel] = useTransition();

  const submitDisabled =
    pending || (mode === "totp" ? code.length !== 6 : backupCode.replace(/\s+/g, "").length !== 8);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <AuroraBackground />

      <Card className="relative z-10 w-full max-w-[20rem] sm:max-w-sm border-border/60 bg-card/60 backdrop-blur-xl shadow-2xl ring-brand-glow animate-in fade-in zoom-in-95 duration-500">
        <CardHeader className="items-center text-center">
          <div className="rounded-full p-1 animate-glow-pulse">
            <Image src="/logo.png" alt="Unbounded Technologies" width={120} height={120} priority />
          </div>
          <CardTitle className="mt-2 flex items-center gap-2 text-2xl tracking-tight">
            <ShieldCheck className="size-5 text-emerald-400" />
            Second factor
          </CardTitle>
          <CardDescription>
            {mode === "totp"
              ? "Enter the 6-digit code from your authenticator app."
              : "Enter one of your saved backup codes."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="mode" value={mode === "totp" ? "2fa" : "2fa-backup"} />
            {mode === "totp" ? (
              <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Authenticator code
                </Label>
                <PinInput name="code" value={code} onChange={setCode} disabled={pending} mask={false} />
              </div>
            ) : (
              <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <Label htmlFor="backup-code" className="text-xs uppercase tracking-wide text-muted-foreground">
                  Backup code
                </Label>
                <Input
                  id="backup-code"
                  name="code"
                  inputMode="text"
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  maxLength={9}
                  className="text-center font-mono tracking-widest"
                  placeholder="XXXXXXXX"
                  value={backupCode}
                  onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                  disabled={pending}
                />
              </div>
            )}
            {state?.error && (
              <p className="text-sm text-destructive animate-in fade-in slide-in-from-top-1 duration-300" role="alert">
                {state.error}
              </p>
            )}
            <Button
              type="submit"
              variant="brand"
              size="lg"
              className="w-full"
              disabled={submitDisabled}
            >
              <KeyRound className="size-4" />
              {pending ? "Verifying…" : "Verify"}
            </Button>
            <div className="flex items-center justify-between pt-1 text-xs">
              <button
                type="button"
                className="text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => {
                  setMode((m) => (m === "totp" ? "backup" : "totp"));
                  setCode("");
                  setBackupCode("");
                }}
                disabled={pending}
              >
                {mode === "totp" ? "Use a backup code" : "Use authenticator app"}
              </button>
              <button
                type="button"
                className="text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => startCancel(() => cancel2faAction())}
                disabled={pending}
              >
                Back to login
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
