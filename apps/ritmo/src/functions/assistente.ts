import { createServerFn } from "@tanstack/react-start";
import {
  getAssistenteDataHandler,
  sendMessageInput,
  sendAssistenteMessageHandler,
  type AssistenteData,
  type SendAssistenteMessageResult,
} from "./assistente.server";

/**
 * Server functions for the Assistente screen. These wrap the server-only
 * handlers from `assistente.server.ts` in `createServerFn` for RPC access
 * from routes. The actual server-only code and imports live in the `.server.ts`
 * file to ensure they don't leak into the client bundle.
 */

export const getAssistenteData = createServerFn({ method: "GET" }).handler(
  getAssistenteDataHandler,
);

export type { AssistenteData } from "./assistente.server";

export const sendAssistenteMessage = createServerFn({ method: "POST" })
  .validator(sendMessageInput)
  .handler(({ data }) => sendAssistenteMessageHandler(data));

export type { SendAssistenteMessageResult } from "./assistente.server";
