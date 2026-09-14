// Sprint 8 server/client security boundary check — see the Sprint 8 plan,
// "Server/client security boundary." Proves the BROWSER-targeted build
// output never contains server secrets or server-only packages, the same
// way apps/web relies on OPENAI_API_KEY never being sent to the browser
// (docs/AI-COPILOT.md) but made into a permanent, automated check here
// rather than a stated rule alone — mirrors how DEC-043's live-discovered
// risk became `tool-schema-strict-mode.test.ts`.
//
// Extended Sprint 9 Phase 3 fix-up (docs/DECISIONS.md DEC-100) to cover the
// auth/Postgres surface added this sprint: BETTER_AUTH_SECRET, DATABASE_URL,
// BETTER_AUTH_URL, the node-postgres driver, and Better Auth's server-only
// entry points (its Drizzle adapter, its TanStack Start cookie plugin).
// Deliberately precise about Better Auth: `better-auth/react` (the browser
// client `login.tsx`/`cadastro.tsx`/`recuperar-senha.tsx` actually use) must
// stay allowed — only `better-auth/adapters/drizzle` and
// `better-auth/tanstack-start`, which nothing client-side ever imports, are
// forbidden markers here.
//
// Extended Sprint 9 Phase 5 (docs/DECISIONS.md DEC-114) to also reject the
// local dev-only test login's literal credentials (`teste@ritmo.local`/
// `RitmoTeste123!`, DEC-104) — always forbidden, not gated on an env var,
// since they're hardcoded constants in dev-seed.server.ts, not something
// that varies per environment.
//
// Usage: node scripts/check-client-bundle.mjs
// Exits non-zero (and prints exactly what matched, where) on any violation.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const CLIENT_DIR = path.resolve(import.meta.dirname, "../.output/public");
const APP_ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Precise server-only markers. Each is a real, unique identifier from a
 * server-only package or entry point — chosen so it cannot appear in
 * legitimate client-side code by coincidence, unlike e.g. bare `"pg"` or
 * bare `"better-auth"` (both of which have entirely client-safe cousins
 * or are too generic — `"pg"` collides with ordinary English text).
 */
export const FORBIDDEN_PACKAGE_MARKERS = [
  { label: 'server-only package "@electric-sql/pglite"', needle: "@electric-sql/pglite" },
  { label: 'server-only package "pluggy-sdk"', needle: "pluggy-sdk" },
  { label: 'server-only package "openai"', needle: "openai" },
  {
    label: 'server-only Postgres driver "pg" (via its pg-connection-string dependency)',
    needle: "pg-connection-string",
  },
  {
    label: 'server-only Postgres driver "pg" (via its pg-protocol dependency)',
    needle: "pg-protocol",
  },
  {
    label: "server-only Drizzle Postgres adapter (drizzle-orm/node-postgres)",
    needle: "drizzle-orm/node-postgres",
  },
  {
    label: "server-only Better Auth Drizzle adapter (better-auth/adapters/drizzle)",
    needle: "better-auth/adapters/drizzle",
  },
  {
    label: "server-only Better Auth TanStack Start cookie plugin (better-auth/tanstack-start)",
    needle: "better-auth/tanstack-start",
  },
  {
    // Sprint 9 Phase 6A (DEC-120): the Resend SDK's own internal user-agent
    // prefix — a real, distinctive string read from the installed package
    // itself, not the bare word "resend" (too generic — plausible as
    // ordinary UI copy, e.g. "reenviar"/"resend the message").
    label: 'server-only package "resend"',
    needle: "resend-node:",
  },
];

/**
 * Always-forbidden literal strings, unconditional on any env var being set
 * (Sprint 9 Phase 5, DEC-114) — hardcoded dev-only constants that must
 * never reach a client bundle regardless of which environment built it.
 */
export const FORBIDDEN_LITERAL_STRINGS = [
  { label: "the local dev test account email (teste@ritmo.local)", needle: "teste@ritmo.local" },
  { label: "the local dev test account password (RitmoTeste123!)", needle: "RitmoTeste123!" },
];

/**
 * Env var NAMEs whose literal string is itself forbidden client-side.
 * Deliberately excludes BETTER_AUTH_SECRET/BETTER_AUTH_URL: better-auth's
 * own official `better-auth/react` client bundle legitimately enumerates
 * both names itself (a generic cross-runtime env-getter helper it ships
 * with), so checking for those bare names against real build output is a
 * guaranteed false positive against a real, client-safe dependency — not a
 * finding. Their real VALUES (below) are still checked.
 */
const FORBIDDEN_SECRET_NAMES = ["OPENAI_API_KEY", "PLUGGY_CLIENT_SECRET", "DATABASE_URL"];

/** Env vars whose real configured VALUE (when set locally) must never appear in client output. */
const SECRET_VALUE_ENV_VARS = [
  { name: "OPENAI_API_KEY", label: "OPENAI_API_KEY value" },
  { name: "PLUGGY_CLIENT_SECRET", label: "PLUGGY_CLIENT_SECRET value" },
  { name: "BETTER_AUTH_SECRET", label: "BETTER_AUTH_SECRET value" },
  { name: "DATABASE_URL", label: "DATABASE_URL value" },
  { name: "BETTER_AUTH_URL", label: "BETTER_AUTH_URL value" },
];

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else if (/\.(js|mjs|html|css|map)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Only checks for the REAL configured secret value when one exists locally —
 * this script runs in CI/dev environments that may not have any of these
 * set, and an unset env var must never produce a false "safe" result
 * silently.
 */
export function buildForbiddenValues(env = process.env) {
  const values = [];
  for (const { name, label } of SECRET_VALUE_ENV_VARS) {
    const value = env[name];
    if (value) values.push({ label, needle: value });
  }
  for (const name of FORBIDDEN_SECRET_NAMES) {
    values.push({ label: `the literal string ${name}`, needle: name });
  }
  values.push(...FORBIDDEN_PACKAGE_MARKERS);
  values.push(...FORBIDDEN_LITERAL_STRINGS);
  return values;
}

/**
 * Extends coverage to whatever is ACTUALLY in a local `.env`/`.env.local`
 * file, not just the names this script happens to know about — catches a
 * stale or newly-added secret before someone remembers to name-check it
 * here. `VITE_`-prefixed keys are skipped: this app's Vite config
 * deliberately inlines those into the client bundle on purpose (see
 * vite.config.ts's own "VITE_* env injection" comment) — flagging them
 * would be a permanent false positive, not a real finding. Short values
 * (under MIN_SECRET_LENGTH) are also skipped — a flag like
 * `DEV_AUTH_BYPASS=true` has a value ("true") that is an ordinary JS
 * boolean literal appearing constantly in unrelated bundled code; only
 * long, effectively-unique values (real keys, tokens, connection strings)
 * are meaningful things to search a whole bundle for.
 */
const MIN_SECRET_LENGTH = 12;

export function parseDotEnvValues(content, sourceLabel) {
  const values = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key.startsWith("VITE_")) continue;
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (value.length >= MIN_SECRET_LENGTH) {
      values.push({ label: `raw ${sourceLabel} value for ${key}`, needle: value });
    }
  }
  return values;
}

async function loadDotEnvValues(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    return parseDotEnvValues(content, path.basename(filePath));
  } catch {
    // File doesn't exist locally — fine, same "only check what's actually present" rule as above.
    return [];
  }
}

export function scanContentForViolations(content, forbidden) {
  const hits = [];
  for (const { label, needle } of forbidden) {
    if (content.includes(needle)) hits.push(label);
  }
  return hits;
}

async function main() {
  let clientFiles;
  try {
    clientFiles = await collectFiles(CLIENT_DIR);
  } catch (error) {
    console.error(
      `[check-client-bundle] Could not read ${CLIENT_DIR} — run "pnpm run build" first. ${error.message}`,
    );
    process.exit(1);
  }

  if (clientFiles.length === 0) {
    console.error(`[check-client-bundle] ${CLIENT_DIR} exists but contains no build output — treating as a failure.`);
    process.exit(1);
  }

  const forbidden = [
    ...buildForbiddenValues(),
    ...(await loadDotEnvValues(path.join(APP_ROOT, ".env.local"))),
    ...(await loadDotEnvValues(path.join(APP_ROOT, ".env"))),
  ];
  const violations = [];

  for (const file of clientFiles) {
    const content = await readFile(file, "utf8");
    for (const label of scanContentForViolations(content, forbidden)) {
      violations.push({ file: path.relative(process.cwd(), file), label });
    }
  }

  if (violations.length > 0) {
    console.error("[check-client-bundle] FAILED — the client bundle exposes server-only content:");
    for (const v of violations) {
      console.error(`  - ${v.file}: contains ${v.label}`);
    }
    process.exit(1);
  }

  console.log(
    `[check-client-bundle] OK — scanned ${clientFiles.length} client file(s) in ${path.relative(process.cwd(), CLIENT_DIR)}, no server secrets or server-only packages found.`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
