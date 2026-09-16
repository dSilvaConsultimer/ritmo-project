import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * DEC-132: "Categorias e regras" is no longer a separate screen/source of
 * truth — it moved into Planning's "Regras e categorias" section, which now
 * also supports viewing, creating, and deleting rules (this old screen was
 * read-only). This route stays only as a redirect so any existing bookmark/
 * link (including "Mais") keeps working. There is only ONE canonical
 * management experience now — see docs/DECISIONS.md DEC-132.
 */
export const Route = createFileRoute("/_protected/categorias")({
  beforeLoad: () => {
    throw redirect({ to: "/planejamento" });
  },
});
