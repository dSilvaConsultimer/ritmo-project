import type { Item } from "pluggy-sdk";
import type { ProviderConnectionStatus } from "@money-copilot/financial-engine";

/**
 * Maps Pluggy's `ItemStatus` into our generic `ProviderConnectionStatus`.
 * Nothing downstream of this ever sees a Pluggy-specific status string.
 */
export function mapPluggyItemStatus(status: Item["status"]): ProviderConnectionStatus {
  switch (status) {
    case "UPDATED":
      return "CONNECTED";
    case "UPDATING":
    case "MERGING":
      return "SYNCING";
    case "WAITING_USER_INPUT":
    case "WAITING_USER_ACTION":
      return "USER_ACTION_REQUIRED";
    case "LOGIN_ERROR":
      return "LOGIN_ERROR";
    case "OUTDATED":
      return "ERROR";
    default:
      return "ERROR";
  }
}
