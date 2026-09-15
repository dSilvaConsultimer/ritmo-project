import { useTheme } from "@/lib/theme";

/**
 * Canonical Ritmo V1 brand assets (see docs/DECISIONS.md DEC-125 and
 * `apps/ritmo/public/brand/README.md`) — raster PNGs derived directly from
 * the Founder-approved brand board. No original vector master exists, so
 * these are plain `<img>` renders: no CSS recoloring/filtering, no redrawn
 * geometry. The correct light/dark file is selected by theme; there is no
 * single asset that works for both.
 */
const SYMBOL_SRC = {
  light: "/brand/ritmo-symbol-light.png",
  dark: "/brand/ritmo-symbol-dark.png",
} as const;

const LOGO_SRC = {
  light: "/brand/ritmo-logo-light.png",
  dark: "/brand/ritmo-logo-dark.png",
} as const;

/**
 * The symbol alone. Used decoratively, always next to visible "Ritmo" text
 * or brand-context copy elsewhere on screen (Home header, Mais footer,
 * assistant chat avatar) — `alt=""`/`aria-hidden` so it never creates
 * redundant screen-reader noise.
 */
export function RitmoMark({ className = "h-8 w-8" }: { className?: string }) {
  const { theme } = useTheme();
  return (
    <img
      src={SYMBOL_SRC[theme]}
      alt=""
      aria-hidden="true"
      className={`object-contain ${className}`}
    />
  );
}

/**
 * The full symbol + "Ritmo" wordmark + tagline lockup, as one flattened
 * canonical image (the brand board's own logo composition, not something
 * built from separate elements). Only meant for a "strong brand presence"
 * moment with real room to breathe (Auth screens, Mais/About) — the
 * tagline baked into this image becomes illegible noise below roughly
 * h-20; `h-24` is the smallest size this component renders at by default
 * for exactly that reason. Never use this for a compact/header context —
 * see `RitmoMark` + a plain text label instead (e.g. Home's header).
 * `alt="Ritmo"` since there's no separate text node next to it for
 * assistive tech to read.
 */
export function RitmoWordmark({ className = "" }: { className?: string }) {
  const { theme } = useTheme();
  return (
    <img src={LOGO_SRC[theme]} alt="Ritmo" className={`h-24 w-auto object-contain ${className}`} />
  );
}
