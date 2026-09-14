import { createServerFn } from "@tanstack/react-start";
import {
  checkSyncProgressHandler,
  checkSyncProgressInput,
  finishBankConnectionHandler,
  finishConnectionInput,
  getConnectionScreenDataHandler,
  removeBankConnectionHandler,
  removeConnectionInput,
  requestManualSyncHandler,
  requestManualSyncInput,
  startBankConnectionHandler,
} from "./connections.server";

/**
 * Server functions for onboarding / the Bank Connection screen. These wrap
 * the server-only handlers from `connections.server.ts` in `createServerFn`
 * for RPC access from routes — see that file for the real logic. See
 * docs/DECISIONS.md DEC-101.
 */

export const getConnectionScreenData = createServerFn({ method: "GET" }).handler(
  getConnectionScreenDataHandler,
);
export type { ConnectionScreenData, ConnectionSummaryDTO } from "./connections.server";

export const startBankConnection = createServerFn({ method: "POST" }).handler(
  startBankConnectionHandler,
);

export const finishBankConnection = createServerFn({ method: "POST" })
  .validator(finishConnectionInput)
  .handler(({ data }) => finishBankConnectionHandler(data));

export const checkSyncProgress = createServerFn({ method: "POST" })
  .validator(checkSyncProgressInput)
  .handler(({ data }) => checkSyncProgressHandler(data));
export type { SyncProgress } from "./connections.server";

export const removeBankConnection = createServerFn({ method: "POST" })
  .validator(removeConnectionInput)
  .handler(({ data }) => removeBankConnectionHandler(data));

export const requestManualSync = createServerFn({ method: "POST" })
  .validator(requestManualSyncInput)
  .handler(({ data }) => requestManualSyncHandler(data));
