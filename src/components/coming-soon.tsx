import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ComingSoon({ title, phase, gated }: { title: string; phase: string; gated?: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-brand-gradient">Coming in {phase}</CardTitle>
          <CardDescription>This module is part of the planned toolbox and will be wired up next.</CardDescription>
        </CardHeader>
        {gated && (
          <CardContent>
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              ⚠ {gated}
            </p>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
