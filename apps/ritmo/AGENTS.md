# Ritmo — visual source of truth

This app was copied from the Lovable-managed repo `meu-ritmo-design`
(`git@github.com:dSilvaConsultimer/meu-ritmo-design.git`) as a one-time snapshot — it is
**not** connected to Lovable's own git sync from here. Pushing/rebasing/amending inside
`money-copilot` has no effect on that separate repo or on Lovable's editor.

`src/routes/`, `src/components/`, `src/styles.css`, and every other visual file are the
**approved product UI** — see `docs/RITMO.md` for the integration architecture and what may
and may not change here. Only `src/server/` and `src/adapters/` (new, added during Sprint 8)
contain logic that doesn't exist in the original Lovable prototype.
