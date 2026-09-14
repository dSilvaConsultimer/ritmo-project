/**
 * This module exists as a marker/documentation placeholder. Do not add
 * re-exports here, as they create static imports of .server.ts files that
 * can leak into the client bundle.
 *
 * Server-only code that needs getAuth() should import directly from:
 *   import { getAuth } from "./auth.server";
 *
 * within their handler functions (inside createServerFn or API routes).
 */
