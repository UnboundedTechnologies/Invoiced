"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import type { Client } from "@/lib/db/schema";
import { createClient, updateClient } from "@/server/actions/clients";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";

type Result = { ok?: string; error?: string };

export function ClientForm({ client, onDone }: { client?: Client; onDone: () => void }) {
  const action = client
    ? (updateClient.bind(null, client.id) as (p: Result | undefined, fd: FormData) => Promise<Result>)
    : createClient;
  const [state, formAction, pending] = useActionState(action, undefined as Result | undefined);

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.ok);
      onDone();
    }
    if (state?.error) toast.error(state.error);
  }, [state, onDone]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="legalName">Legal name *</Label>
        <Input id="legalName" name="legalName" defaultValue={client?.legalName ?? ""} required />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="apContactName">AP contact name</Label>
          <Input id="apContactName" name="apContactName" defaultValue={client?.apContactName ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="apEmail">AP email</Label>
          <Input id="apEmail" name="apEmail" type="email" defaultValue={client?.apEmail ?? ""} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="apPhone">AP phone</Label>
          <Input id="apPhone" name="apPhone" type="tel" defaultValue={client?.apPhone ?? ""} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="addressLine1">Address line 1</Label>
          <Input id="addressLine1" name="addressLine1" defaultValue={client?.addressLine1 ?? ""} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="addressLine2">Address line 2</Label>
          <Input id="addressLine2" name="addressLine2" defaultValue={client?.addressLine2 ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="city">City</Label>
          <Input id="city" name="city" defaultValue={client?.city ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="province">Province</Label>
          <Input id="province" name="province" maxLength={2} defaultValue={client?.province ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="postalCode">Postal code</Label>
          <Input id="postalCode" name="postalCode" defaultValue={client?.postalCode ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="country">Country</Label>
          <Input id="country" name="country" maxLength={2} defaultValue={client?.country ?? "CA"} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={3} defaultValue={client?.notes ?? ""} />
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" variant="brand" disabled={pending}>
          {pending ? "Saving…" : client ? "Save changes" : "Create client"}
        </Button>
      </DialogFooter>
    </form>
  );
}
