"use client";

import { useActionState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuroraBackground } from "@/components/login/aurora-background";
import { loginAction } from "@/server/actions/auth";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <AuroraBackground />

      <Card className="relative z-10 w-full max-w-[20rem] sm:max-w-sm border-border/60 bg-card/60 backdrop-blur-xl shadow-2xl ring-brand-glow animate-in fade-in zoom-in-95 duration-500">
        <CardHeader className="items-center text-center">
          <div className="rounded-full p-1 animate-glow-pulse">
            <Image src="/logo.png" alt="Unbounded Technologies" width={120} height={120} priority />
          </div>
          <CardTitle className="mt-2 text-3xl tracking-tight">
            <span className="text-brand-gradient">Invoiced</span>
          </CardTitle>
          <CardDescription>Unbounded Technologies Inc.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-500" style={{ animationDelay: "100ms", animationFillMode: "backwards" }}>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-500" style={{ animationDelay: "180ms", animationFillMode: "backwards" }}>
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            {state?.error && (
              <p className="text-sm text-destructive animate-in fade-in slide-in-from-top-1 duration-300" role="alert">
                {state.error}
              </p>
            )}
            <Button
              type="submit"
              variant="brand"
              size="lg"
              className="w-full animate-in fade-in slide-in-from-bottom-2 duration-500"
              style={{ animationDelay: "260ms", animationFillMode: "backwards" }}
              disabled={pending}
            >
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
