# Ritmo — canonical brand assets (V1)

This directory holds the **official V1 canonical Ritmo brand assets**, consumed
directly by `RitmoMark`/`RitmoWordmark` (`apps/ritmo/src/components/ritmo/RitmoMark.tsx`):

- `ritmo-symbol-light.png` — the symbol alone, light/primary expression ("Humana & Inteligente")
- `ritmo-symbol-dark.png` — the symbol alone, dark/premium expression ("Premium & Tech")
- `ritmo-logo-light.png` — symbol + "Ritmo" wordmark + tagline, light
- `ritmo-logo-dark.png` — symbol + "Ritmo" wordmark + tagline, dark

## Format: raster PNG, not vector — by design, for V1

These are **raster PNG files**, derived directly from the Founder-approved brand
board. **No original vector master exists** — the brand was never produced as an
editable vector file, only as the board image itself — so V1 uses these PNGs
as-is rather than fabricating a vector trace of them. See docs/DECISIONS.md
DEC-125 for the full history of how this was resolved.

Consuming code renders them as plain `<img>` elements: no CSS recoloring,
filtering, or geometry changes of any kind. The correct light/dark file is
selected by the app's theme — there is no single asset that works for both.

## History (why this replaced an earlier recreation)

An earlier pass (Sprint 8, Lovable-generated UI) shipped a hand-authored inline
SVG approximating the brand board — never an extracted/exported official asset.
A later attempt to source a replacement produced four files with a `.svg`
extension that were actually raster PNGs generated through an AI image
pipeline (confirmed via embedded C2PA content-provenance metadata referencing
OpenAI's own attribution icon) — explicitly rejected by the Founder as not
being genuine board-derived exports. The four files now in this directory are
the Founder-confirmed replacement: real PNGs derived directly from the brand
board, not AI-redrawn, and are the accepted V1 source of truth.

## If a real vector master is produced later

Should a genuine vector export of the mark ever exist (e.g. an Illustrator/
Figma source file get created), `RitmoMark`/`RitmoWordmark` should be updated
to consume `.svg` versions instead — a small, mechanical change, since every
call site already goes through those two components.
