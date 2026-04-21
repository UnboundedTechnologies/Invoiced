"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { FolderLock, KeyRound, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PinInput } from "./pin-input";
import { setupVaultPin, verifyVaultPin } from "@/server/actions/vault-pin";

type Result = { ok?: string; error?: string; warning?: string; retryAfter?: string };

/**
 * Pre-vault gate. Handles both branches:
 *  - mode="setup": no PIN on file → render setup form (6-digit + confirm)
 *  - mode="verify": PIN set → render entry form
 * On success the page revalidates and the vault contents render.
 */
export function PinGate({ mode }: { mode: "setup" | "verify" }) {
  if (mode === "setup") return <SetupCard />;
  return <VerifyCard />;
}

function SetupCard() {
  const [state, formAction, pending] = useActionState(setupVaultPin, undefined as Result | undefined);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.ok);
      if (state.warning) toast.warning(state.warning);
    }
    if (state?.error) toast.error(state.error);
  }, [state]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (pin.length !== 6) {
      e.preventDefault();
      setLocalErr("Enter all 6 digits.");
      return;
    }
    if (pin !== confirmPin) {
      e.preventDefault();
      setLocalErr("PINs don't match.");
      return;
    }
    setLocalErr(null);
  }

  const invalid = !!(localErr || state?.error);

  return (
    <div className="mx-auto max-w-md pt-10">
      <Card>
        <CardHeader className="items-center text-center">
          <div className="mb-3 flex size-14 items-center justify-center rounded-xl bg-cyan-500/15 ring-1 ring-inset ring-cyan-500/30">
            <FolderLock className="size-7 text-cyan-400" />
          </div>
          <CardTitle>Set your vault PIN</CardTitle>
          <CardDescription>
            A second wall on top of login for sensitive docs (incorporation, NDAs, tax returns).
            6 digits. You can change it any time from Settings → Security.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="block text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                New PIN
              </label>
              <PinInput name="pin" value={pin} onChange={setPin} invalid={invalid} disabled={pending} />
            </div>
            <div className="space-y-2">
              <label className="block text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Confirm PIN
              </label>
              <PinInput
                name="_confirm"
                value={confirmPin}
                onChange={setConfirmPin}
                invalid={invalid}
                disabled={pending}
                autoFocus={false}
              />
            </div>

            {(localErr || state?.error) && (
              <div className="rounded-md border border-rose-500/40 bg-rose-500/5 p-3 text-center text-xs text-rose-300">
                {localErr ?? state?.error}
              </div>
            )}

            <Button type="submit" variant="brand" className="w-full" disabled={pending}>
              {pending ? "Setting…" : "Set PIN"}
            </Button>

            <p className="text-center text-[11px] text-muted-foreground">
              Forgot it later? Run <code className="rounded bg-muted px-1 py-0.5">pnpm reset-vault-pin</code> from
              the terminal.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function VerifyCard() {
  const [state, formAction, pending] = useActionState(verifyVaultPin, undefined as Result | undefined);
  const [pin, setPin] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) toast.success(state.ok);
    if (state?.error) toast.error(state.error);
  }, [state]);

  useEffect(() => {
    // If the verify returned an error, clear the inputs to nudge re-entry
    if (state?.error) setPin("");
  }, [state?.error]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (pin.length !== 6) {
      e.preventDefault();
      setLocalErr("Enter all 6 digits.");
      return;
    }
    setLocalErr(null);
  }

  const invalid = !!(localErr || state?.error);
  const isLockout = state?.retryAfter != null;

  return (
    <div className="mx-auto max-w-md pt-10">
      <Card>
        <CardHeader className="items-center text-center">
          <div className="mb-3 flex size-14 items-center justify-center rounded-xl bg-cyan-500/15 ring-1 ring-inset ring-cyan-500/30">
            {isLockout ? (
              <ShieldAlert className="size-7 text-rose-400" />
            ) : (
              <KeyRound className="size-7 text-cyan-400" />
            )}
          </div>
          <CardTitle>Vault locked</CardTitle>
          <CardDescription>
            {isLockout
              ? "Too many failed attempts. Take a break."
              : "Enter your 6-digit vault PIN to unlock."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} onSubmit={handleSubmit} className="space-y-5">
            <PinInput name="pin" value={pin} onChange={setPin} invalid={invalid} disabled={pending || isLockout} />

            {(localErr || state?.error) && (
              <div className="rounded-md border border-rose-500/40 bg-rose-500/5 p-3 text-center text-xs text-rose-300">
                {localErr ?? state?.error}
              </div>
            )}

            <Button type="submit" variant="brand" className="w-full" disabled={pending || isLockout}>
              {pending ? "Verifying…" : isLockout ? `Locked` : "Unlock"}
            </Button>

            <p className="text-center text-[11px] text-muted-foreground">
              Forgot it? Run <code className="rounded bg-muted px-1 py-0.5">pnpm reset-vault-pin</code> from the
              terminal.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
