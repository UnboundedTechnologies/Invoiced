import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-6">
      {/* Animated brand backdrop */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 -left-32 size-[36rem] rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="absolute top-1/3 -right-40 size-[40rem] rounded-full bg-cyan-500/12 blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 size-[32rem] rounded-full bg-fuchsia-500/10 blur-3xl" />
      </div>

      <Card className="w-full max-w-md border-border/60 bg-card/70 backdrop-blur-xl shadow-2xl ring-brand-glow animate-in fade-in zoom-in-95 duration-500">
        <CardHeader className="items-center text-center">
          <div className="relative mb-2">
            <Image src="/logo.png" alt="Unbounded Technologies" width={88} height={88} priority className="opacity-90" />
            <div className="absolute -bottom-1 -right-1 flex size-9 items-center justify-center rounded-full bg-rose-500/20 ring-2 ring-background backdrop-blur">
              <FileQuestion className="size-5 text-rose-400" />
            </div>
          </div>
          <CardTitle className="text-5xl tracking-tight">
            <span className="text-brand-gradient">404</span>
          </CardTitle>
          <div className="mt-2 space-y-1">
            <CardDescription className="text-base text-foreground">Page not found</CardDescription>
            <CardDescription className="text-sm">
              The page you're looking for doesn't exist or has been moved.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center">
            <Button asChild variant="brand" size="lg">
              <Link href="/dashboard">
                <ArrowLeft className="size-4" />
                Back to dashboard
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
