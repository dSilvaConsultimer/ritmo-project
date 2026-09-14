import { Resend } from "resend";
import { logger } from "./logger.server";

/**
 * Server-only Resend adapter (Sprint 9 Phase 6A — Founder-selected provider,
 * see docs/DECISIONS.md DEC-120). Behind the exact same provider-neutral
 * boundary `email.server.ts` already established (DEC-098) — nothing
 * outside this file and `email.server.ts`'s production branch knows Resend
 * exists. No live Resend account is required for this file to exist or be
 * tested: `ResendEmailClient` is a narrow interface `createResendClient`
 * implements with the real SDK, and every test injects a fake one instead.
 */

export interface ResendSendResult {
  /** `name` is a bounded provider error-code enum (e.g. "invalid_api_key") — safe to log; `message` is free text and never logged. */
  readonly error: { readonly name: string; readonly message: string } | null;
}

export interface ResendEmailClient {
  readonly emails: {
    send(payload: {
      readonly from: string;
      readonly to: string;
      readonly subject: string;
      readonly html: string;
    }): Promise<ResendSendResult>;
  };
}

/** Real constructor — never called in tests, which inject a fake `ResendEmailClient` instead. */
export function createResendClient(apiKey: string): ResendEmailClient {
  return new Resend(apiKey);
}

export class PasswordResetDeliveryFailedError extends Error {
  constructor() {
    super("Password-reset email delivery failed.");
    this.name = "PasswordResetDeliveryFailedError";
  }
}

/**
 * Minimal Ritmo-branded password-reset email (brief §E). No financial data
 * of any kind. The "expires in 1 hour" line reflects Better Auth's own real
 * default (`resetPasswordTokenExpiresIn` defaults to 3600 seconds — verified
 * by reading `better-auth`'s `password.mjs` source directly; `auth.server.ts`
 * does not override it) — not an invented number.
 */
export function renderPasswordResetEmailHtml(resetUrl: string): string {
  return `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: system-ui, -apple-system, sans-serif; background: #fafafa; margin: 0; padding: 32px 16px;">
    <div style="max-width: 420px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; text-align: center;">
      <p style="font-weight: 800; font-size: 20px; margin: 0 0 24px;">Ritmo</p>
      <h1 style="font-size: 18px; margin: 0 0 12px;">Redefinir sua senha</h1>
      <p style="font-size: 14px; color: #4b5563; margin: 0 0 24px;">
        Recebemos um pedido para redefinir a senha da sua conta Ritmo. Clique no botão abaixo para
        escolher uma nova senha. Este link expira em 1 hora.
      </p>
      <a href="${resetUrl}" style="display: inline-block; background: #111827; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 999px; font-size: 14px; font-weight: 600;">
        Redefinir senha
      </a>
      <p style="font-size: 12px; color: #9ca3af; margin: 24px 0 0;">
        Se você não pediu essa redefinição, pode ignorar este e-mail com segurança — sua senha
        continua a mesma.
      </p>
    </div>
  </body>
</html>`;
}

export async function sendPasswordResetEmailViaResend(
  client: ResendEmailClient,
  params: { readonly from: string; readonly to: string; readonly resetUrl: string },
): Promise<void> {
  const result = await client.emails.send({
    from: params.from,
    to: params.to,
    subject: "Redefinir sua senha do Ritmo",
    html: renderPasswordResetEmailHtml(params.resetUrl),
  });
  if (result.error) {
    // Normalized/redacted (brief §D): only the bounded error-code enum is
    // logged server-side (never `error.message`'s free text, never the
    // reset URL/token itself); the caller gets a generic, typed error,
    // never Resend's raw message.
    logger.error("password_reset_email_delivery_failed", {
      provider: "resend",
      errorCode: result.error.name,
    });
    throw new PasswordResetDeliveryFailedError();
  }
}
