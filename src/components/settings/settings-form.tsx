"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, User, FileSpreadsheet, Wallet, Palette, RotateCcw } from "lucide-react";
import type { Settings as SettingsRow } from "@/lib/db/schema";
import {
  updateDirector,
  updateFiscal,
  updateSelfPay,
  updateBranding,
} from "@/server/actions/settings";
import { PayrollCard } from "@/components/settings/payroll-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEFAULT_PRIMARY = "#6366F1";
const DEFAULT_ACCENT = "#22D3EE";

type Result = { ok?: string; error?: string };

function useFormResult(result: Result | undefined, setDirty: (v: boolean) => void) {
  useEffect(() => {
    if (result?.ok) {
      toast.success(result.ok);
      setDirty(false);
    }
    if (result?.error) toast.error(result.error);
  }, [result, setDirty]);
}

function Field({
  label,
  htmlFor,
  hint,
  children,
  full,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2 space-y-1.5" : "space-y-1.5"}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SaveBar({ pending, dirty }: { pending: boolean; dirty: boolean }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-2">
      {dirty && !pending && (
        <span className="text-xs text-muted-foreground animate-in fade-in">Unsaved changes</span>
      )}
      <Button type="submit" variant="brand" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

export function SettingsForm({ data }: { data: SettingsRow }) {
  return (
    <Tabs defaultValue="corp" className="w-full">
      <TabsList>
        <TabsTrigger value="corp">
          <Building2 className="mr-1.5 size-3.5" /> Corporation
        </TabsTrigger>
        <TabsTrigger value="director">
          <User className="mr-1.5 size-3.5" /> Director
        </TabsTrigger>
        <TabsTrigger value="fiscal">
          <FileSpreadsheet className="mr-1.5 size-3.5" /> Fiscal & HST
        </TabsTrigger>
        <TabsTrigger value="selfpay">
          <Wallet className="mr-1.5 size-3.5" /> Self-pay
        </TabsTrigger>
        <TabsTrigger value="branding">
          <Palette className="mr-1.5 size-3.5" /> Branding
        </TabsTrigger>
      </TabsList>

      <TabsContent value="corp">
        <CorpPanel data={data} />
      </TabsContent>
      <TabsContent value="director">
        <DirectorPanel data={data} />
      </TabsContent>
      <TabsContent value="fiscal">
        <FiscalPanel data={data} />
      </TabsContent>
      <TabsContent value="selfpay">
        <SelfPayPanel data={data} />
      </TabsContent>
      <TabsContent value="branding">
        <BrandingPanel data={data} />
      </TabsContent>
    </Tabs>
  );
}

//  Corporation (read-only) 
function DisplayField({ label, value, full }: { label: string; value: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2 space-y-1.5" : "space-y-1.5"}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-sm">
        {value || <span className="text-muted-foreground">-</span>}
      </div>
    </div>
  );
}

function CanadianAddressBlock({ data }: { data: SettingsRow }) {
  const line1 = data.addressLine1.toUpperCase();
  const line2 = data.addressLine2?.toUpperCase();
  // Canada Post format: CITY PROVINCE  POSTAL CODE  (two spaces before postal)
  const cityLine = `${data.city.toUpperCase()} ${data.province.toUpperCase()}  ${data.postalCode.toUpperCase()}`;
  const country = data.country === "CA" ? "CANADA" : data.country.toUpperCase();
  const lines = [line1, line2, cityLine, country].filter(Boolean) as string[];

  return (
    <div className="sm:col-span-2 space-y-1.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Mailing address</div>
      <div className="relative overflow-hidden rounded-lg border border-border/50 bg-gradient-to-br from-card/80 to-card/40 p-5">
        <div className="absolute right-3 top-2 text-[9px] font-medium uppercase tracking-[0.25em] text-muted-foreground/40">
          Canada Post format
        </div>
        <div className="absolute -bottom-6 -left-6 size-24 rounded-full bg-indigo-500/10 blur-2xl" />
        <div className="font-mono text-sm leading-7 tracking-[0.06em] text-foreground/95">
          {lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CorpPanel({ data }: { data: SettingsRow }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Corporation</CardTitle>
          <CardDescription>
            Locked. These values are filed with CRA + Ontario and almost never change.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <DisplayField label="Legal name" value={data.corpLegalName} full />
          <DisplayField label="Business Number" value={<span className="font-mono">{data.businessNumber}</span>} />
          <DisplayField label="HST account (RT0001)" value={<span className="font-mono">{data.hstAccount}</span>} />
          <DisplayField
            label="Corp income tax account (RC0001)"
            value={<span className="font-mono">{data.corpIncomeTaxAccount}</span>}
          />
          <DisplayField
            label="Payroll account (RP0001)"
            value={
              data.payrollAccount ? (
                <span className="font-mono">{data.payrollAccount}</span>
              ) : (
                <span className="text-muted-foreground italic">Not registered. Manage below ↓</span>
              )
            }
          />
          <CanadianAddressBlock data={data} />
        </CardContent>
      </Card>

      <PayrollCard data={data} />
    </div>
  );
}

//  Director 
function DirectorPanel({ data }: { data: SettingsRow }) {
  const [state, formAction, pending] = useActionState(updateDirector, undefined as Result | undefined);
  const [dirty, setDirty] = useState(false);
  useFormResult(state, setDirty);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Director / Sole employee</CardTitle>
        <CardDescription>You. Used as invoice "from" and on T4/T5 slips.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5" onChange={() => setDirty(true)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Legal name" htmlFor="directorLegalName">
              <Input id="directorLegalName" name="directorLegalName" defaultValue={data.directorLegalName} required />
            </Field>
            <Field label="Email" htmlFor="directorEmail">
              <Input id="directorEmail" name="directorEmail" type="email" defaultValue={data.directorEmail} required />
            </Field>
          </div>
          <SaveBar pending={pending} dirty={dirty} />
        </form>
      </CardContent>
    </Card>
  );
}

//  Fiscal & HST
function FiscalPanel({ data }: { data: SettingsRow }) {
  const [state, formAction, pending] = useActionState(updateFiscal, undefined as Result | undefined);
  const [dirty, setDirty] = useState(false);
  const [hstBps, setHstBps] = useState(data.hstRateBps);
  useFormResult(state, setDirty);
  const hstChanged = hstBps !== data.hstRateBps;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fiscal year & HST</CardTitle>
        <CardDescription>
          Drives all return deadlines. Ontario HST is 13.00% (1300 basis points).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5" onChange={() => setDirty(true)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fiscal year-end month" htmlFor="fiscalYearEndMonth">
              <Input
                id="fiscalYearEndMonth"
                name="fiscalYearEndMonth"
                type="number"
                min={1}
                max={12}
                defaultValue={data.fiscalYearEndMonth}
                required
              />
            </Field>
            <Field label="Fiscal year-end day" htmlFor="fiscalYearEndDay">
              <Input
                id="fiscalYearEndDay"
                name="fiscalYearEndDay"
                type="number"
                min={1}
                max={31}
                defaultValue={data.fiscalYearEndDay}
                required
              />
            </Field>
            <Field label="HST filing frequency" htmlFor="hstFilingFrequency">
              <Select name="hstFilingFrequency" defaultValue={data.hstFilingFrequency}>
                <SelectTrigger id="hstFilingFrequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="HST rate (basis points)" htmlFor="hstRateBps" hint={`${(hstBps / 100).toFixed(2)}% - Ontario standard is 1300`}>
              <Input
                id="hstRateBps"
                name="hstRateBps"
                type="number"
                min={0}
                max={10000}
                value={hstBps}
                onChange={(e) => setHstBps(Number(e.target.value))}
                required
              />
            </Field>
            <Field
              label="Incorporation date"
              htmlFor="incorporationDate"
              hint="Drives the Ontario annual return anniversary on /calendar."
              full
            >
              <Input
                id="incorporationDate"
                name="incorporationDate"
                type="date"
                defaultValue={data.incorporationDate ?? ""}
              />
            </Field>
          </div>
          {hstChanged && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-300">
              <strong className="text-amber-200">HST rate changing:</strong>{" "}
              {(data.hstRateBps / 100).toFixed(2)}% → {(hstBps / 100).toFixed(2)}%. Existing
              invoices keep their snapshotted HST. Any invoice issued from this point will use
              the new rate. Double-check before saving — Ontario&rsquo;s 13.00% has been stable
              for years.
            </div>
          )}
          <SaveBar pending={pending} dirty={dirty} />
        </form>
      </CardContent>
    </Card>
  );
}

//  Self-pay 
function SelfPayPanel({ data }: { data: SettingsRow }) {
  const [state, formAction, pending] = useActionState(updateSelfPay, undefined as Result | undefined);
  const [dirty, setDirty] = useState(false);
  useFormResult(state, setDirty);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Self-pay strategy</CardTitle>
        <CardDescription>
          How you pay yourself. 2026 YMPE is $71,300 - salary up to that caps CPP1 + maxes RRSP room.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5" onChange={() => setDirty(true)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Strategy" htmlFor="paymentStrategy">
              <Select name="paymentStrategy" defaultValue={data.paymentStrategy}>
                <SelectTrigger id="paymentStrategy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="salary_only">Salary only</SelectItem>
                  <SelectItem value="dividends_only">Dividends only</SelectItem>
                  <SelectItem value="blend">Blend (recommended)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Target annual salary (CAD)" htmlFor="targetAnnualSalaryDollars">
              <Input
                id="targetAnnualSalaryDollars"
                name="targetAnnualSalaryDollars"
                type="number"
                min={0}
                step="0.01"
                defaultValue={(data.targetAnnualSalaryCents ?? 0) / 100}
                required
              />
            </Field>
            <Field label="Pay cadence" htmlFor="payCadence">
              <Select name="payCadence" defaultValue={data.payCadence}>
                <SelectTrigger id="payCadence">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="bi-weekly">Bi-weekly</SelectItem>
                  <SelectItem value="semi-monthly">Semi-monthly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Pay-day rule" htmlFor="payDayRule">
              <Select name="payDayRule" defaultValue={data.payDayRule}>
                <SelectTrigger id="payDayRule">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LAST_BUSINESS_DAY">Last business day of period</SelectItem>
                  <SelectItem value="LAST_DAY_OF_MONTH">Last calendar day</SelectItem>
                  <SelectItem value="FIRST_OF_MONTH">First of month</SelectItem>
                  <SelectItem value="DAY_15">15th of month</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <SaveBar pending={pending} dirty={dirty} />
        </form>
      </CardContent>
    </Card>
  );
}

//  Branding & Invoicing 
function BrandingPanel({ data }: { data: SettingsRow }) {
  const [state, formAction, pending] = useActionState(updateBranding, undefined as Result | undefined);
  const [dirty, setDirty] = useState(false);
  useFormResult(state, setDirty);
  const [primary, setPrimary] = useState(data.brandPrimaryHex);
  const [accent, setAccent] = useState(data.brandAccentHex);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Branding & invoice numbering</CardTitle>
            <CardDescription>
              Colors for invoice PDF accents. Logo + banner are loaded from <code>/public/</code>.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setPrimary(DEFAULT_PRIMARY);
              setAccent(DEFAULT_ACCENT);
              setDirty(true);
            }}
            className="gap-1.5 text-xs"
          >
            <RotateCcw className="size-3.5" />
            Reset to defaults
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5" onChange={() => setDirty(true)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Primary color" htmlFor="brandPrimaryHex">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={primary}
                  onChange={(e) => {
                    setPrimary(e.target.value);
                    setDirty(true);
                  }}
                  className="h-9 w-12 cursor-pointer rounded-md border border-input bg-background"
                />
                <Input
                  id="brandPrimaryHex"
                  name="brandPrimaryHex"
                  value={primary}
                  onChange={(e) => setPrimary(e.target.value)}
                  pattern="^#[0-9a-fA-F]{6}$"
                  required
                />
              </div>
            </Field>
            <Field label="Accent color" htmlFor="brandAccentHex">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={accent}
                  onChange={(e) => {
                    setAccent(e.target.value);
                    setDirty(true);
                  }}
                  className="h-9 w-12 cursor-pointer rounded-md border border-input bg-background"
                />
                <Input
                  id="brandAccentHex"
                  name="brandAccentHex"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  pattern="^#[0-9a-fA-F]{6}$"
                  required
                />
              </div>
            </Field>
            <Field label="Invoice prefix" htmlFor="invoicePrefix" hint='e.g., "UT" → invoices look like UT-0001'>
              <Input
                id="invoicePrefix"
                name="invoicePrefix"
                defaultValue={data.invoicePrefix}
                maxLength={8}
                required
              />
            </Field>
            <Field label="Next invoice number" htmlFor="nextInvoiceSeq" hint="Auto-increments after each invoice.">
              <Input
                id="nextInvoiceSeq"
                name="nextInvoiceSeq"
                type="number"
                min={1}
                defaultValue={data.nextInvoiceSeq}
                required
              />
            </Field>
          </div>
          <SaveBar pending={pending} dirty={dirty} />
        </form>
      </CardContent>
    </Card>
  );
}
