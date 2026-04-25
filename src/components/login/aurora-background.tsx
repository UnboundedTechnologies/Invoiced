import styles from "./aurora-background.module.css";

/**
 * Animated oklch mesh-gradient backdrop. Server component, zero JS state, all
 * motion in CSS — ships with `prefers-reduced-motion` fallback (freezes the
 * gradient and hides the orb layer) and a mobile branch that drops the orbs
 * to keep the blur cost in budget.
 *
 * Mounted as the first child of /login (and /login/2fa) so the form card sits
 * on top of the animation. The host is fixed-position with z-index -10, so the
 * card needs no special z-index of its own.
 */
export function AuroraBackground() {
  return (
    <div className={styles.root} aria-hidden>
      <div className={styles.base} />
      <div className={styles.gradient} />
      <div className={`${styles.orb} ${styles.orbA}`} />
      <div className={`${styles.orb} ${styles.orbB}`} />
      <div className={styles.noise} />
      <div className={styles.vignette} />
    </div>
  );
}
