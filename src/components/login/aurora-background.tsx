import styles from "./aurora-background.module.css";

/**
 * Animated cosmic backdrop for /login.
 *
 * Layers (back to front):
 *   1. Solid near-black base
 *   2. Three parallax star layers — far/mid/near, each with own drift speed
 *      + twinkle. Stars are deterministically generated server-side and
 *      output as static <span>s, so no client JS or hydration cost.
 *   3. Four blurred oklch color blobs (indigo / cyan / violet / sky)
 *      drifting + scaling + slowly hue-rotating
 *   4. Shooting-star streak that runs across the page on a 14s loop
 *   5. SVG fractal-noise overlay (kills the smooth-AI-gradient look)
 *   6. Edge vignette focusing the form card
 *
 * prefers-reduced-motion: drift + twinkle + shooting-star paused; layers
 * remain visible (static composition).
 * Mobile (<=640px): drops the heaviest blob layers + the shooting star.
 */
export function AuroraBackground() {
  return (
    <div className={styles.root} aria-hidden>
      <div className={styles.base} />
      <StarLayer count={120} seed={1} maxSize={1.4} className={styles.starsFar} />
      <StarLayer count={70} seed={2} maxSize={2.2} className={styles.starsMid} />
      <StarLayer count={28} seed={3} maxSize={3.5} className={styles.starsNear} bright />
      <div className={`${styles.blob} ${styles.blobIndigo}`} />
      <div className={`${styles.blob} ${styles.blobCyan}`} />
      <div className={`${styles.blob} ${styles.blobViolet}`} />
      <div className={`${styles.blob} ${styles.blobSky}`} />
      <div className={styles.shooting} />
      <div className={styles.noise} />
      <div className={styles.vignette} />
    </div>
  );
}

function StarLayer({
  count,
  seed,
  maxSize,
  className,
  bright = false,
}: {
  count: number;
  seed: number;
  maxSize: number;
  className: string | undefined;
  bright?: boolean;
}) {
  // Deterministic LCG so SSR + CSR markup match exactly.
  let state = seed * 2654435761;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };

  const stars = Array.from({ length: count }, (_, i) => {
    const left = next() * 100;
    const top = next() * 100;
    const size = 0.6 + next() * (maxSize - 0.6);
    const baseOpacity = bright ? 0.7 + next() * 0.3 : 0.35 + next() * 0.5;
    const twinkleDelay = next() * -8;
    return { i, left, top, size, baseOpacity, twinkleDelay };
  });

  return (
    <div className={className}>
      {stars.map((s) => (
        <span
          key={s.i}
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            opacity: s.baseOpacity,
            animationDelay: `${s.twinkleDelay}s`,
            boxShadow: bright ? `0 0 ${s.size * 2.5}px ${s.size * 0.4}px rgba(255,255,255,${s.baseOpacity * 0.6})` : undefined,
          }}
        />
      ))}
    </div>
  );
}
