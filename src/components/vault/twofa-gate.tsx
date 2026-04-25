"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, KeyRound } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PinInput } from "./pin-input";
import { verifyVault2fa } from "@/server/actions/vault-2fa";

type Result = { ok?: string; error?: string };
type Mode = "totp" | "backup";

/**
 * Third gate (after session + vault PIN) when the signed-in user has 2FA
 * enabled. Shares the totpFailedCount lockout counter with login 2FA.
 */
export function TwoFAGate() {
  const [state, formAction, pending] = useActionState(verifyVault2fa, undefined as Result | undefined);
  const [mode, setMode] = useState<Mode>("totp");
  const [code, setCode] = useState("");
  const [backupCode, setBackupCode] = useState("");

  useEffect(() => {
    if (state?.ok) toast.success(state.ok);
    if (state?.error) {
      toast.error(state.error);
      setCode("");
    }
  }, [state]);

  const submitDisabled =
    pending || (mode === "totp" ? code.length !== 6 : backupCode.replace(/\s+/g, "").length !== 8);

  return (
    <div className="mx-auto max-w-md pt-10">
      <Card>
        <CardHeader className="items-center text-center">
          <div className="mb-3 flex size-14 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/30">
            <ShieldCheck className="size-7 text-emerald-400" />
          </div>
          <CardTitle>Confirm second factor</CardTitle>
          <CardDescription>
            {mode === "totp"
              ? "PIN accepted. Enter the 6-digit code from your authenticator app."
              : "Enter one of your saved backup codes."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-5">
            <input type="hidden" name="mode" value={mode} />
            {mode === "totp" ? (
              <div className="space-y-2">
                <Label className="block text-center text-xs uppercase tracking-wide text-muted-foreground">
                  Authenticator code
                </Label>
                <PinInput name="code" value={code} onChange={setCode} disabled={pending} mask={false} />
              </div>
            ) : (
              <div className="space-y-2">
                <Label
                  htmlFor="vault-backup-code"
                  className="block text-center text-xs uppercase tracking-wide text-muted-foreground"
                >
                  Backup code
                </Label>
                <Input
                  id="vault-backup-code"
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
              <div className="rounded-md border border-rose-500/40 bg-rose-500/5 p-3 text-center text-xs text-rose-300">
                {state.error}
              </div>
            )}
            <Button type="submit" variant="brand" className="w-full" disabled={submitDisabled}>
              <KeyRound className="size-4" /> {pending ? "Verifying…" : "Unlock vault"}
            </Button>
            <button
              type="button"
              className="block w-full text-center text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => {
                setMode((m) => (m === "totp" ? "backup" : "totp"));
                setCode("");
                setBackupCode("");
              }}
              disabled={pending}
            >
              {mode === "totp" ? "Use a backup code instead" : "Use authenticator app instead"}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
