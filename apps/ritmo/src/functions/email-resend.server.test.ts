import { describe, expect, it, vi } from "vitest";
import {
  PasswordResetDeliveryFailedError,
  renderPasswordResetEmailHtml,
  sendPasswordResetEmailViaResend,
  type ResendEmailClient,
} from "./email-resend.server";

/**
 * Sprint 9 Phase 6A (docs/DECISIONS.md DEC-120) — Resend adapter tests.
 * Every test uses a mocked `ResendEmailClient`; none ever imports/constructs
 * the real `Resend` SDK client or makes a network call.
 */

describe("renderPasswordResetEmailHtml (brief §E)", () => {
  it("includes Ritmo identity, the reset link, and an ignore-if-not-requested instruction", () => {
    const html = renderPasswordResetEmailHtml("https://ritmo.example.com/reset/abc123");
    expect(html).toContain("Ritmo");
    expect(html).toContain("https://ritmo.example.com/reset/abc123");
    expect(html.toLowerCase()).toContain("ignorar");
    expect(html.toLowerCase()).toContain("redefinir");
  });

  it("states the real Better Auth default expiry (1 hour) — never an invented value", () => {
    const html = renderPasswordResetEmailHtml("https://ritmo.example.com/reset/abc123");
    expect(html).toContain("1 hora");
  });

  it("never includes any financial data or figures", () => {
    const html = renderPasswordResetEmailHtml("https://ritmo.example.com/reset/abc123");
    expect(html).not.toMatch(/R\$\s?\d|saldo|transa[cç][ãa]o|gast/i);
  });
});

describe("sendPasswordResetEmailViaResend (mocked transport only)", () => {
  it("calls the injected client with the correct payload shape", async () => {
    const send = vi.fn().mockResolvedValue({ error: null });
    const client: ResendEmailClient = { emails: { send } };

    await sendPasswordResetEmailViaResend(client, {
      from: "Ritmo <naoresponda@ritmo.example.com>",
      to: "user@example.com",
      resetUrl: "https://ritmo.example.com/reset/xyz",
    });

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]![0];
    expect(payload.from).toBe("Ritmo <naoresponda@ritmo.example.com>");
    expect(payload.to).toBe("user@example.com");
    expect(payload.subject).toContain("senha");
    expect(payload.html).toContain("https://ritmo.example.com/reset/xyz");
  });

  it("throws PasswordResetDeliveryFailedError — never the raw provider message — on failure", async () => {
    const client: ResendEmailClient = {
      emails: {
        send: vi.fn().mockResolvedValue({
          error: { name: "rate_limit_exceeded", message: "raw internal detail" },
        }),
      },
    };

    let caught: unknown;
    try {
      await sendPasswordResetEmailViaResend(client, {
        from: "Ritmo <naoresponda@ritmo.example.com>",
        to: "user@example.com",
        resetUrl: "https://ritmo.example.com/reset/xyz",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PasswordResetDeliveryFailedError);
    expect(String((caught as Error).message)).not.toContain("raw internal detail");
  });

  it("resolves successfully with no error thrown when the provider reports no error", async () => {
    const client: ResendEmailClient = {
      emails: { send: vi.fn().mockResolvedValue({ error: null }) },
    };
    await expect(
      sendPasswordResetEmailViaResend(client, {
        from: "Ritmo <naoresponda@ritmo.example.com>",
        to: "user@example.com",
        resetUrl: "https://ritmo.example.com/reset/xyz",
      }),
    ).resolves.toBeUndefined();
  });
});
