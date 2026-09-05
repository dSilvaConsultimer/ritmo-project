import { ProviderError, type ProviderErrorCode } from "@money-copilot/financial-engine";

interface LooseProviderErrorShape {
  readonly message?: unknown;
  readonly code?: unknown;
  readonly statusCode?: unknown;
  readonly response?: { readonly statusCode?: unknown };
}

function asLooseShape(error: unknown): LooseProviderErrorShape {
  return typeof error === "object" && error !== null ? (error as LooseProviderErrorShape) : {};
}

function statusOf(shape: LooseProviderErrorShape): number | undefined {
  const status = shape.statusCode ?? shape.response?.statusCode;
  return typeof status === "number" ? status : undefined;
}

function messageOf(shape: LooseProviderErrorShape): string {
  if (typeof shape.message === "string") return shape.message;
  return "Unknown Pluggy error";
}

/**
 * Best-effort normalization of whatever `pluggy-sdk` rejects with (an HTTP
 * error body, or a raw network error with no response) into our internal
 * taxonomy. This mapping could not be validated against live Pluggy error
 * responses in this sprint (no sandbox credentials were available) — see
 * docs/OPEN-FINANCE.md, "Known provider limitations." Every provider
 * adapter must throw only `ProviderError`; nothing upstream ever sees a raw
 * SDK error shape.
 */
export function normalizePluggyError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  const shape = asLooseShape(error);
  const status = statusOf(shape);
  const message = messageOf(shape);
  const lowerMessage = message.toLowerCase();

  let code: ProviderErrorCode = "UNKNOWN_PROVIDER_ERROR";
  let retryable = false;

  if (status === 401 || lowerMessage.includes("invalid credentials") || lowerMessage.includes("unauthorized")) {
    code = "AUTHENTICATION_ERROR";
  } else if (lowerMessage.includes("mfa") || lowerMessage.includes("user action") || lowerMessage.includes("waiting_user")) {
    code = "USER_ACTION_REQUIRED";
  } else if (status === 429 || lowerMessage.includes("rate limit")) {
    code = "RATE_LIMITED";
    retryable = true;
  } else if (status !== undefined && status >= 500) {
    code = "PROVIDER_UNAVAILABLE";
    retryable = true;
  } else if (status === 409 || lowerMessage.includes("conflict")) {
    code = "SYNC_CONFLICT";
  } else if (status === undefined && (error instanceof Error || typeof shape.code === "string")) {
    // No HTTP response at all reached us — most likely a network failure
    // (DNS, connection refused, timeout).
    code = "NETWORK_ERROR";
    retryable = true;
  }

  return new ProviderError(code, "pluggy", message, { retryable, cause: error });
}
