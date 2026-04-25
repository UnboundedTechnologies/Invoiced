"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PinInput } from "@/components/vault/pin-input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TotpEnrollmentWizard } from "./totp-enrollment-wizard";
import { revoke } from "@/server/actions/totp";
import { ShieldCheck, ShieldOff, Sparkles } from "lucide-react";

export function TotpStatusCard({ totpEnabledAt }: { totpEnabledAt: Date | null }) {
  const enrolled = !!totpEnabledAt;
  const [wizardOpen, setWizardOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const [revokeState, revokeAction, revokePending] = useActionState(revoke, undefined);

  useEffect(() => {
    if (revokeState?.ok) {
      toast.success(revokeState.ok);
      setRevokeOpen(false);
      setPassword("");
      setCode("");
    }
    if (revokeState?.error) toast.error(revokeState.error);
  }, [revokeState]);

  const enrolledLabel = totpEnabledAt
    ? new Date(totpEnabledAt).toLocaleDateString("en-CA", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className={enrolled ? "size-5 text-emerald-400" : "size-5 text-muted-foreground"} />
            Two-factor authentication
          </CardTitle>
          <CardDescription>
            A TOTP code from your authenticator app, on top of your password. Required at every login and
            every vault unlock once enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {enrolled ? (
            <>
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
                <p className="text-sm font-medium text-emerald-300">2FA active</p>
                <p className="mt-0.5 text-xs text-emerald-300/70">
                  Enrolled {enrolledLabel}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => setRevokeOpen(true)}
                className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
              >
                <ShieldOff className="size-4" /> Revoke / change device
              </Button>
            </>
          ) : (
            <>
              <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
                Not enrolled yet. Enabling 2FA now will require a code from your authenticator app on
                every login. Backup codes are generated for the case where your phone is lost.
              </div>
              <Button variant="brand" onClick={() => setWizardOpen(true)}>
                <Sparkles className="size-4" /> Enable 2FA
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <TotpEnrollmentWizard open={wizardOpen} onOpenChange={setWizardOpen} />

      <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldOff className="size-5 text-rose-400" />
              Revoke 2FA?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes 2FA from your account. Login + vault drop back to password-only (vault still
              uses the PIN). All backup codes are invalidated. Re-enroll any time after.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form action={revokeAction} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="totp-revoke-password">Current password</Label>
              <Input
                id="totp-revoke-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={revokePending}
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Current 2FA code
              </Label>
              <PinInput name="code" value={code} onChange={setCode} disabled={revokePending} mask={false} />
            </div>
            {revokeState?.error && (
              <p className="text-sm text-destructive" role="alert">{revokeState.error}</p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={revokePending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                type="submit"
                disabled={revokePending || code.length !== 6 || !password}
                className="bg-rose-500 text-white hover:bg-rose-600 focus:ring-rose-500/40"
              >
                {revokePending ? "Revoking…" : "Revoke 2FA"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
