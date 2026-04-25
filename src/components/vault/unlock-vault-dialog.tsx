"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, KeyRound, FolderLock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PinInput } from "./pin-input";
import { verifyVaultPin } from "@/server/actions/vault-pin";
import { verifyVault2fa } from "@/server/actions/vault-2fa";

type Result = { ok?: string; error?: string; retryAfter?: string };
type Stage = "pin" | "twofa";
type TwoFAMode = "totp" | "backup";

/**
 * Reusable inline unlock dialog. Used from any page that wants to open a
 * vault-PIN-gated resource without forcing the user to detour through /vault.
 *
 * Sequence:
 *   1. PIN  — PinInput → verifyVaultPin (sets __Host-vault-pin cookie)
 *   2. 2FA  — only if `twofaEnrolled` → verifyVault2fa (sets __Host-vault-2fa)
 *   3. done — calls onUnlocked() and closes
 *
 * The onUnlocked callback fires inside a click handler (the PinInput / submit
 * button click that resolved the last step), so window.open() inside it
 * inherits transient activation and isn't popup-blocked in current browsers.
 */
export function UnlockVaultDialog({
  open,
  onOpenChange,
  onUnlocked,
  twofaEnrolled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUnlocked: () => void;
  twofaEnrolled: boolean;
}) {
  const [stage, setStage] = useState<Stage>("pin");
  const [pin, setPin] = useState("");
  const [twofaMode, setTwofaMode] = useState<TwoFAMode>("totp");
  const [code, setCode] = useState("");
  const [backupCode, setBackupCode] = useState("");

  const [pinState, pinAction, pinPending] = useActionState(verifyVaultPin, undefined as Result | undefined);
  const [twofaState, twofaAction, twofaPending] = useActionState(
    verifyVault2fa,
    undefined as Result | undefined,
  );

  // Reset everything when the dialog closes (no stale state for the next open).
  useEffect(() => {
    if (!open) {
      setStage("pin");
      setPin("");
      setCode("");
      setBackupCode("");
      setTwofaMode("totp");
    }
  }, [open]);

  // PIN succeeded — advance to 2FA or unlock immediately.
  useEffect(() => {
    if (pinState?.ok) {
      if (twofaEnrolled) {
        setStage("twofa");
      } else {
        onUnlocked();
      }
    }
    if (pinState?.error) {
      toast.error(pinState.error);
      setPin("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinState]);

  // 2FA succeeded — done.
  useEffect(() => {
    if (twofaState?.ok) {
      onUnlocked();
    }
    if (twofaState?.error) {
      toast.error(twofaState.error);
      setCode("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twofaState]);

  const isLockout = pinState?.retryAfter != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {stage === "pin" ? (
              <FolderLock className="size-5 text-cyan-400" />
            ) : (
              <ShieldCheck className="size-5 text-emerald-400" />
            )}
            {stage === "pin" ? "Vault locked" : "Confirm second factor"}
          </DialogTitle>
          <DialogDescription>
            {stage === "pin"
              ? "Enter your 6-digit vault PIN to open this attachment."
              : twofaMode === "totp"
                ? "PIN accepted. Enter the 6-digit code from your authenticator app."
                : "Enter one of your saved backup codes."}
          </DialogDescription>
        </DialogHeader>

        {stage === "pin" && (
          <form action={pinAction} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="block text-center text-xs uppercase tracking-wide text-muted-foreground">
                Vault PIN
              </Label>
              <PinInput
                name="pin"
                value={pin}
                onChange={setPin}
                disabled={pinPending || isLockout}
                invalid={!!pinState?.error}
              />
              {pinState?.error && (
                <p className="text-center text-xs text-rose-400">{pinState.error}</p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={pinPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="brand"
                disabled={pinPending || pin.length !== 6 || isLockout}
              >
                <KeyRound className="size-4" /> {pinPending ? "Verifying…" : "Unlock"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {stage === "twofa" && (
          <form action={twofaAction} className="space-y-4 py-2">
            <input type="hidden" name="mode" value={twofaMode} />
            {twofaMode === "totp" ? (
              <div className="space-y-2">
                <Label className="block text-center text-xs uppercase tracking-wide text-muted-foreground">
                  Authenticator code
                </Label>
                <PinInput
                  name="code"
                  value={code}
                  onChange={setCode}
                  disabled={twofaPending}
                  mask={false}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label
                  htmlFor="unlock-backup-code"
                  className="block text-center text-xs uppercase tracking-wide text-muted-foreground"
                >
                  Backup code
                </Label>
                <Input
                  id="unlock-backup-code"
                  name="code"
                  inputMode="text"
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  maxLength={9}
                  className="text-center font-mono tracking-widest"
                  placeholder="XXXXXXXX"
                  value={backupCode}
                  onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                  disabled={twofaPending}
                />
              </div>
            )}
            {twofaState?.error && (
              <p className="text-center text-xs text-rose-400">{twofaState.error}</p>
            )}
            <DialogFooter className="flex-col gap-2">
              <Button
                type="submit"
                variant="brand"
                className="w-full"
                disabled={
                  twofaPending ||
                  (twofaMode === "totp"
                    ? code.length !== 6
                    : backupCode.replace(/\s+/g, "").length !== 8)
                }
              >
                <KeyRound className="size-4" /> {twofaPending ? "Verifying…" : "Unlock"}
              </Button>
              <button
                type="button"
                className="block w-full text-center text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => {
                  setTwofaMode((m) => (m === "totp" ? "backup" : "totp"));
                  setCode("");
                  setBackupCode("");
                }}
                disabled={twofaPending}
              >
                {twofaMode === "totp" ? "Use a backup code instead" : "Use authenticator app instead"}
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
