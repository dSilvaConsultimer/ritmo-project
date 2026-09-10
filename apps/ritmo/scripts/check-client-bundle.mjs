// Sprint 8 server/client security boundary check — see the Sprint 8 plan,
// "Server/client security boundary." Proves the BROWSER-targeted build
// output never contains server secrets or server-only packages, the same
// way apps/web relies on OPENAI_API_KEY never being sent to the browser
// (docs/AI-COPILOT.md) but made into a permanent, automated check here
// rather than a stated rule alone — mirrors how DEC-043's live-discovered
// risk became `tool-schema-strict-mode.test.ts`.
//
// Usage: node scripts/check-client-bundle.mjs
// Exits non-zero (and prints exactly what matched, where) on any violation.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const CLIENT_DIR = path.resolve(import.meta.dirname, "../.output/public");

const FORBIDDEN_PACKAGE_NAMES = ["@electric-sql/pglite", "pluggy-sdk", "openai"];

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

function buildForbiddenValues() {
  const values = [];
  const openaiKey = process.env["OPENAI_API_KEY"];
  const pluggySecret = process.env["PLUGGY_CLIENT_SECRET"];
  // Only check for the REAL configured secret value when one exists locally —
  // this script runs in CI/dev environments that may not have either set,
  // and an unset env var must never produce a false "safe" result silently.
  if (openaiKey) values.push({ label: "OPENAI_API_KEY value", needle: openaiKey });
  if (pluggySecret) values.push({ label: "PLUGGY_CLIENT_SECRET value", needle: pluggySecret });
  values.push({ label: "the literal string OPENAI_API_KEY", needle: "OPENAI_API_KEY" });
  values.push({ label: "the literal string PLUGGY_CLIENT_SECRET", needle: "PLUGGY_CLIENT_SECRET" });
  for (const pkg of FORBIDDEN_PACKAGE_NAMES) {
    values.push({ label: `server-only package "${pkg}"`, needle: pkg });
  }
  return values;
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

  const forbidden = buildForbiddenValues();
  const violations = [];

  for (const file of clientFiles) {
    const content = await readFile(file, "utf8");
    for (const { label, needle } of forbidden) {
      if (content.includes(needle)) {
        violations.push({ file: path.relative(process.cwd(), file), label });
      }
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

main();
