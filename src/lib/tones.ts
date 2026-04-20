/**
 * Section tones — each toolbox area gets a color identity that shows up in
 * sidebar labels, active items, stat cards, and quick-action tiles.
 *
 * Static class strings (not template-built) so Tailwind's JIT picks them up.
 */
export type Tone = "indigo" | "emerald" | "amber" | "violet" | "rose" | "cyan" | "sky";

export const TONE: Record<Tone, {
  text: string;        // foreground text color
  textSoft: string;    // softer label color
  bg: string;          // 10% bg
  bgHover: string;     // 18% bg on hover
  border: string;      // 30% border
  ring: string;        // ring color
  topBar: string;      // gradient bar (linear)
  shadow: string;      // brand glow
}> = {
  indigo: {
    text: "text-indigo-400",
    textSoft: "text-indigo-300/80",
    bg: "bg-indigo-500/10",
    bgHover: "hover:bg-indigo-500/15",
    border: "border-indigo-500/30",
    ring: "ring-indigo-500/40",
    topBar: "from-indigo-500/80 via-indigo-400 to-fuchsia-400/70",
    shadow: "shadow-indigo-500/25",
  },
  emerald: {
    text: "text-emerald-400",
    textSoft: "text-emerald-300/80",
    bg: "bg-emerald-500/10",
    bgHover: "hover:bg-emerald-500/15",
    border: "border-emerald-500/30",
    ring: "ring-emerald-500/40",
    topBar: "from-emerald-500/80 via-emerald-400 to-cyan-400/70",
    shadow: "shadow-emerald-500/25",
  },
  amber: {
    text: "text-amber-400",
    textSoft: "text-amber-300/80",
    bg: "bg-amber-500/10",
    bgHover: "hover:bg-amber-500/15",
    border: "border-amber-500/30",
    ring: "ring-amber-500/40",
    topBar: "from-amber-500/80 via-orange-400 to-rose-400/70",
    shadow: "shadow-amber-500/25",
  },
  violet: {
    text: "text-violet-400",
    textSoft: "text-violet-300/80",
    bg: "bg-violet-500/10",
    bgHover: "hover:bg-violet-500/15",
    border: "border-violet-500/30",
    ring: "ring-violet-500/40",
    topBar: "from-violet-500/80 via-fuchsia-400 to-pink-400/70",
    shadow: "shadow-violet-500/25",
  },
  rose: {
    text: "text-rose-400",
    textSoft: "text-rose-300/80",
    bg: "bg-rose-500/10",
    bgHover: "hover:bg-rose-500/15",
    border: "border-rose-500/30",
    ring: "ring-rose-500/40",
    topBar: "from-rose-500/80 via-pink-400 to-orange-400/70",
    shadow: "shadow-rose-500/25",
  },
  cyan: {
    text: "text-cyan-400",
    textSoft: "text-cyan-300/80",
    bg: "bg-cyan-500/10",
    bgHover: "hover:bg-cyan-500/15",
    border: "border-cyan-500/30",
    ring: "ring-cyan-500/40",
    topBar: "from-cyan-500/80 via-teal-400 to-emerald-400/70",
    shadow: "shadow-cyan-500/25",
  },
  sky: {
    text: "text-sky-400",
    textSoft: "text-sky-300/80",
    bg: "bg-sky-500/10",
    bgHover: "hover:bg-sky-500/15",
    border: "border-sky-500/30",
    ring: "ring-sky-500/40",
    topBar: "from-sky-500/80 via-blue-400 to-indigo-400/70",
    shadow: "shadow-sky-500/25",
  },
};
