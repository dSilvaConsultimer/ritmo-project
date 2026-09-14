/**
 * This module should NOT export anything directly. Server functions that need
 * profile context should import from `profile.server.ts` directly within their
 * handler functions, where server-only code is safe. This file is kept as a
 * marker/documentation module for now.
 *
 * If you need CurrentProfileContext, import directly from:
 *   import { getCurrentProfileContext } from "./profile.server";
 *
 * within your server function handler (the async function inside createServerFn).
 */
