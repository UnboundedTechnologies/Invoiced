"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ShieldCheck,
  Lock,
  ExternalLink,
  ChevronRight,
  Check,
  X,
  AlertTriangle,
} from "lucide-react";
import type { Settings as SettingsRow } from "@/lib/db/schema";
import { activatePayerRz, deactivatePayerRz } from "@/server/actions/settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Result = { ok?: string; error?: string };
type Step = "ask" | "instructions" | "input";

const RZ_REGEX = /^\d{9}RZ\d{4}$/;

export function InfoReturnsCard({ data }: { data: SettingsRow }) {
  if (data.payerRzActive) {
    return <ActiveRzPanel data={data} />;
  }
  return <InactiveRzPanel data={data} />;
}

//  ACTIVE STATE
function ActiveRzPanel({ data }: { data: SettingsRow }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleDeactivate() {
    setPending(true);
    const r = await deactivatePayerRz();
    setPending(false);
    setConfirming(false);
    if (r.ok) toast.success(r.ok);
    if (r.error) toast.error(r.error);
  }

  return (
    <Card className="border-emerald-500/30">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-9 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/30">
              <ShieldCheck className="size-5 text-emerald-400" />
            </div>
            <div>
              <CardTitle>Info-returns (RZ) account: Active</CardTitle>
              <CardDescription>T5 slip generation is unlocked.</CardDescription>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
            <Check className="size-3" /> Live
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            RZ program account
          </div>
          <div className="mt-1 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 font-mono text-sm">
            {data.payerRzAccount}
          </div>
        </div>
        {!confirming ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-400"
            onClick={() => setConfirming(true)}
          >
            Deactivate
          </Button>
        ) : (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/5 p-3 space-y-3">
            <div className="flex gap-2 text-sm">
              <AlertTriangle className="size-4 shrink-0 text-rose-400" />
              <span>
                This locks T5 slip generation. Past filed T5 slips stay in the vault.
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={handleDeactivate}
              >
                {pending ? "Deactivating…" : "Yes, deactivate"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

//  INACTIVE STATE (wizard)
function InactiveRzPanel({ data }: { data: SettingsRow }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("ask");

  return (
    <Card className="border-amber-500/30">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-9 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-inset ring-amber-500/30">
              <Lock className="size-5 text-amber-400" />
            </div>
            <div>
              <CardTitle>Info-returns (RZ) account: Not registered</CardTitle>
              <CardDescription>
                T5 slip generation stays locked until an RZ0001 account is registered with CRA and added here.
              </CardDescription>
            </div>
          </div>
          <Switch
            checked={open}
            onCheckedChange={(v) => {
              setOpen(v);
              if (v) setStep("ask");
            }}
          />
        </div>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
          {step === "ask" && (
            <AskStep
              onYes={() => setStep("input")}
              onNo={() => setStep("instructions")}
              onCancel={() => setOpen(false)}
            />
          )}
          {step === "instructions" && (
            <InstructionsStep onBack={() => setStep("ask")} onClose={() => setOpen(false)} />
          )}
          {step === "input" && (
            <InputStep businessNumber={data.businessNumber} onBack={() => setStep("ask")} />
          )}
        </CardContent>
      )}
    </Card>
  );
}

//  STEP 1 — Ask
function AskStep({
  onYes,
  onNo,
  onCancel,
}: {
  onYes: () => void;
  onNo: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">
        Have you already registered an <span className="font-mono">RZ0001</span> info-returns program account with CRA?
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="brand" className="justify-between" onClick={onYes}>
          Yes, I have the number
          <ChevronRight className="size-4" />
        </Button>
        <Button variant="outline" className="justify-between" onClick={onNo}>
          No, show me how
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}

//  STEP 2a — Instructions
function InstructionsStep({
  onBack,
  onClose,
}: {
  onBack: () => void;
  onClose: () => void;
}) {
  const steps = [
    {
      title: "Sign in to CRA My Business Account",
      body: "Go to canada.ca/my-business-account and authenticate with your CRA login or banking partner.",
    },
    {
      title: "Add a program account",
      body: 'In the "Manage business" section, choose "Add a program account" → select RZ – Information Returns.',
    },
    {
      title: "Answer the registration questions",
      body:
        "CRA asks what kind of information return you'll file (select T5 — Statement of Investment Income) and the expected first filing year.",
    },
    {
      title: "Receive your RZ number",
      body:
        "CRA assigns you a number that looks like 726742430RZ0001. Write it down — same 9-digit root as your BN.",
    },
    {
      title: "Come back here",
      body: 'Toggle this card on again, choose "Yes, I have the number", and paste it in.',
    },
  ];
  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xs font-semibold text-amber-400 ring-1 ring-inset ring-amber-500/30">
              {i + 1}
            </div>
            <div>
              <div className="text-sm font-medium">{s.title}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.body}</div>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="brand" size="sm">
          <a
            href="https://www.canada.ca/en/revenue-agency/services/e-services/digital-services-businesses/business-account.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="size-4" /> Open My Business Account
          </a>
        </Button>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          I&rsquo;ll come back later
        </Button>
      </div>
    </div>
  );
}

//  STEP 2b — Input
function InputStep({
  businessNumber,
  onBack,
}: {
  businessNumber: string;
  onBack: () => void;
}) {
  const [value, setValue] = useState(businessNumber + "RZ0001");
  const [state, formAction, pending] = useActionState(
    activatePayerRz,
    undefined as Result | undefined,
  );

  useEffect(() => {
    if (state?.ok) toast.success(state.ok);
    if (state?.error) toast.error(state.error);
  }, [state]);

  const formatOk = RZ_REGEX.test(value);
  const bnMatchOk = value.slice(0, 9) === businessNumber;
  const allOk = formatOk && bnMatchOk;

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="payerRzAccount">Info-returns account number</Label>
        <div className="mt-1.5 relative">
          <Input
            id="payerRzAccount"
            name="payerRzAccount"
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            className={cn(
              "font-mono pr-9",
              value && allOk && "border-emerald-500/50 focus-visible:ring-emerald-500/30",
              value && !allOk && "border-rose-500/50 focus-visible:ring-rose-500/30",
            )}
            placeholder={`${businessNumber}RZ0001`}
            required
          />
          {value && (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
              {allOk ? (
                <Check className="size-4 text-emerald-400" />
              ) : (
                <X className="size-4 text-rose-400" />
              )}
            </span>
          )}
        </div>
      </div>

      <ul className="space-y-1 text-xs">
        <RuleRow ok={formatOk} text="Format: 9 digits + RZ + 4 digits" />
        <RuleRow ok={bnMatchOk} text={`First 9 digits match your BN (${businessNumber})`} />
      </ul>

      <div className="flex gap-2">
        <Button type="submit" variant="brand" disabled={!allOk || pending}>
          {pending ? "Activating…" : "Activate info-returns"}
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          ← Back
        </Button>
      </div>
    </form>
  );
}

function RuleRow({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li
      className={cn(
        "flex items-center gap-1.5",
        ok ? "text-emerald-400" : "text-muted-foreground",
      )}
    >
      {ok ? <Check className="size-3.5" /> : <X className="size-3.5 opacity-50" />}
      <span>{text}</span>
    </li>
  );
}
