import { cn } from "@/lib/utils";
import { TONE, type Tone } from "@/lib/tones";

export function Sparkline({
  data,
  tone = "emerald",
  height = 48,
  className,
  ariaLabel,
}: {
  data: number[];
  tone?: Tone;
  height?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const t = TONE[tone];
  if (data.length === 0) {
    return (
      <div
        className={cn("text-[11px] text-muted-foreground", className)}
        style={{ height }}
        role="img"
        aria-label={ariaLabel ?? "No data"}
      >
        No data
      </div>
    );
  }

  const width = 300;
  // Internal padding — 0 on X so the line's first point is flush with the
  // container's left edge (aligns with text below), a small top padding so
  // peaks don't clip, and a small bottom padding so the area fill reads as
  // separate from the next row.
  const padX = 0;
  const padTop = 4;
  const padBottom = 2;
  const rawMax = Math.max(...data, 0);
  // All-zero (or negative) data reads as "no trend" — render a muted dashed
  // midline so the card keeps its vertical rhythm without implying the series
  // dips to a floor.
  if (rawMax <= 0) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        className={cn("block overflow-visible", className)}
        role="img"
        aria-label={ariaLabel ?? "No trend data"}
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          strokeWidth="1"
          strokeDasharray="4 4"
          stroke="currentColor"
          className="text-muted-foreground/40"
        />
      </svg>
    );
  }
  const max = rawMax;
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const step = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;
  const yTop = padTop;
  const yBottom = height - padBottom;

  const points = data.map((v, i) => {
    const x = padX + i * step;
    const y = yTop + (yBottom - yTop) * (1 - (v - min) / span);
    return [x, y] as const;
  });

  const linePath = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L${points[points.length - 1]![0].toFixed(2)},${yBottom} L${points[0]![0].toFixed(2)},${yBottom} Z`;

  const gradId = `sparkline-grad-${tone}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className={cn("block overflow-visible", className)}
      role="img"
      aria-label={ariaLabel ?? "Trend sparkline"}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className={t.text} stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" className={t.text} stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Baseline grid — faint horizontal line at y = 0 (data min), communicates
          the chart's floor so a late-spike series reads as "flat, then rose"
          rather than an arbitrary line starting mid-air. */}
      <line
        x1={0}
        y1={yBottom}
        x2={width}
        y2={yBottom}
        strokeWidth="1"
        stroke="currentColor"
        className="text-muted-foreground/20"
      />
      <path d={areaPath} fill={`url(#${gradId})`} className={t.text} />
      <path
        d={linePath}
        fill="none"
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className={t.text}
        stroke="currentColor"
      />
      {/* End-dot only — marks "latest" without cluttering the line. */}
      <circle
        cx={points[points.length - 1]![0]}
        cy={points[points.length - 1]![1]}
        r="2.5"
        className={t.text}
        fill="currentColor"
      />
    </svg>
  );
}
