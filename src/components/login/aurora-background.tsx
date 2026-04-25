import styles from "./aurora-background.module.css";

/**
 * Animated oklch mesh-gradient backdrop. Server component, zero JS state, all
 * motion in CSS. Mounted as the first child of /login (and /login/2fa) so the
 * form card sits on top of the animation.
 *
 * Effect: four large blurred color blobs (indigo / cyan / violet / sky) drift
 * + scale on staggered loops, cross-fading to produce a slow "aurora" color
 * morph. SVG noise overlay + edge vignette finish it.
 *
 * Fallbacks: prefers-reduced-motion freezes the drift; mobile drops two blobs
 * to keep the blur budget reasonable.
 */
export function AuroraBackground() {
  return (
    <div className={styles.root} aria-hidden>
      <div className={styles.base} />
      <div className={`${styles.blob} ${styles.blobIndigo}`} />
      <div className={`${styles.blob} ${styles.blobCyan}`} />
      <div className={`${styles.blob} ${styles.blobViolet}`} />
      <div className={`${styles.blob} ${styles.blobSky}`} />
      <div className={styles.noise} />
      <div className={styles.vignette} />
    </div>
  );
}
