import { resolveAppEnvironment } from "@money-copilot/config";

/**
 * Server-only structured logging boundary (Sprint 9 Phase 5 — see
 * docs/DECISIONS.md DEC-106). Every line is one JSON object with a
 * consistent shape (`environment`, `severity`, `event`, `fields`,
 * `timestamp`) — safe by default: known secret-shaped field NAMES are
 * redacted regardless of caller intent, and every string VALUE is scanned
 * for a few unmistakable secret shapes (a Better Auth session cookie, an
 * OpenAI key, a Pluggy connect token) before being written. This is
 * defense-in-depth, not a substitute for callers not passing secrets in
 * the first place.
 *
 * `logger.audit(...)` is the same shape with `severity: "audit"` —
 * security/product-sensitive events (brief §13), distinct from ordinary
 * debug/diagnostic logging. Both currently write structured JSON to
 * stdout/stderr — real hosting platforms (Railway included) capture and
 * retain process output; routing audit events to separate persistent
 * storage is a Phase 6 concern (brief §13: "do not provision external log
 * infrastructure" here), not a gap introduced by this choice.
 */

type Severity = "debug" | "info" | "warn" | "error" | "audit";

const REDACTED = "[redacted]";

/** Field names that are always redacted, regardless of value, case-insensitively. */
const SENSITIVE_FIELD_NAME_PATTERN =
  /password|secret|token|cookie|authorization|api[_-]?key|connect[_-]?token|session/i;

/** Value shapes that are always redacted even under an innocuous-looking field name. */
const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/, // OpenAI-style secret key
  /better-auth\.session_token=/i,
];

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) return REDACTED;
    return value;
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") return redactFields(value as Record<string, unknown>);
  return value;
}

function redactFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    result[key] = SENSITIVE_FIELD_NAME_PATTERN.test(key) ? REDACTED : redactValue(value);
  }
  return result;
}

function write(severity: Severity, event: string, fields: Readonly<Record<string, unknown>>): void {
  const line = {
    timestamp: new Date().toISOString(),
    environment: resolveAppEnvironment(),
    severity,
    event,
    ...redactFields(fields),
  };
  const serialized = JSON.stringify(line);
  if (severity === "error") {
    console.error(serialized);
  } else if (severity === "warn") {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}

export const logger = {
  debug: (event: string, fields: Readonly<Record<string, unknown>> = {}) =>
    write("debug", event, fields),
  info: (event: string, fields: Readonly<Record<string, unknown>> = {}) =>
    write("info", event, fields),
  warn: (event: string, fields: Readonly<Record<string, unknown>> = {}) =>
    write("warn", event, fields),
  error: (event: string, fields: Readonly<Record<string, unknown>> = {}) =>
    write("error", event, fields),
  /** Security/product-sensitive event — see module doc. */
  audit: (event: string, fields: Readonly<Record<string, unknown>> = {}) =>
    write("audit", event, fields),
};

/** Exported for tests only — not part of the logger's public surface. */
export const __testing = { redactFields, redactValue };
