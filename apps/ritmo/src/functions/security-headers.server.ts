import { resolveAppEnvironment, type AppEnvironment } from "@money-copilot/config";

/**
 * Server-only, centralized production HTTP security headers (Sprint 9
 * Phase 5 — see docs/DECISIONS.md DEC-110). Applied once, in `server.ts`'s
 * existing response wrapper, to every response — not scattered per-route.
 *
 * Skipped in `development`: Vite's HMR client needs an inline-script-
 * friendly, websocket-connecting environment a strict CSP would break, and
 * dev is local-only (not the security boundary this is protecting). Applied
 * in `test`/`staging`/`production`.
 *
 * **Known, deliberate gap — not pretended to be solved (brief §7):**
 * `script-src` includes `'unsafe-inline'`. TanStack Start's own SSR shell
 * emits required inline bootstrap/hydration `<script>` tags (verified by
 * inspecting real rendered output — e.g. the `$tsr-stream-barrier` script);
 * a strict `script-src 'self'` without it would break hydration on every
 * page. A nonce-based CSP (a per-request nonce threaded into the SSR
 * shell's own inline scripts) would remove this gap but requires deeper
 * customization of TanStack Start's document-shell rendering than this
 * phase's scope — a real follow-up, not a solved problem. This CSP still
 * meaningfully restricts frame-ancestors (clickjacking), object-src,
 * base-uri, and which external origins scripts/styles/connections/frames
 * can reach.
 *
 * External origins are derived from the app's REAL integrations, not
 * guessed: `fonts.googleapis.com`/`fonts.gstatic.com` (Google Fonts,
 * `__root.tsx`'s own `<link>` tags) and `connect.pluggy.ai` (the Pluggy
 * Connect widget's real iframe origin, confirmed by reading
 * `pluggy-connect-sdk`'s bundled source — not assumed).
 */
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://connect.pluggy.ai",
  "frame-src https://connect.pluggy.ai",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

function shouldApplySecurityHeaders(environment: AppEnvironment): boolean {
  return environment !== "development";
}

/**
 * Mutates nothing — returns a new `Response` with security headers added on
 * top of whatever the wrapped handler already set. Pure enough to unit-test
 * directly with an injected environment.
 */
export function applySecurityHeaders(
  response: Response,
  environment: AppEnvironment = resolveAppEnvironment(),
): Response {
  if (!shouldApplySecurityHeaders(environment)) return response;

  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CSP_DIRECTIVES);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (environment === "production" || environment === "staging") {
    // Only meaningful over real HTTPS (Railway terminates TLS in front of
    // the Node process) — browsers ignore this header entirely over plain HTTP.
    headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
