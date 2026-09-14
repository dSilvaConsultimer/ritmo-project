// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only, preset overridden below — see docs/DECISIONS.md DEC-090/DEC-099),
//     VITE_* env injection, @ path alias, React/TanStack dedupe, error logger plugins, and
//     sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Sprint 9 (DEC-090, DEC-099): our real server-only dependencies — the
  // `openai` Node SDK, `pluggy-sdk`, Drizzle's node-postgres driver, Better
  // Auth's Node adapter — are not built for the Cloudflare Workers edge
  // runtime this scaffold defaults to (`cloudflare-module`, confirmed by
  // this option's own doc comment in node_modules). `node-server` produces a
  // plain Node entry (`.output/server/index.mjs`) deployable to any Node
  // host (Railway, per DEC-090). This override only applies OUTSIDE a
  // Lovable-sandboxed build (`LOVABLE_NITRO_PRESET` pins Cloudflare inside
  // the sandbox itself, by that option's own doc comment) — irrelevant for
  // our own production/CI builds, which never set that variable.
  nitro: { preset: "node-server" },
});
