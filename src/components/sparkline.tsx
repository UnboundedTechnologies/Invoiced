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
  const pad = 4;
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
        className={cn("overflow-visible", className)}
        role="img"
        aria-label={ariaLabel ?? "No trend data"}
      >
        <line
          x1={pad}
          y1={height / 2}
          x2={width - pad}
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
  const step = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;

  const points = data.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (height - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });

  const linePath = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L${points[points.length - 1]![0].toFixed(2)},${height - pad} L${points[0]![0].toFixed(2)},${height - pad} Z`;

  const gradId = `sparkline-grad-${tone}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className={cn("overflow-visible", className)}
      role="img"
      aria-label={ariaLabel ?? "Trend sparkline"}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className={t.text} stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" className={t.text} stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} className={t.text} />
      <path
        d={linePath}
        fill="none"
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        className={t.text}
        stroke="currentColor"
      />
      {points.map(([x, y], i) => {
        if (i !== points.length - 1) return null;
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="2.5"
            className={t.text}
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}
