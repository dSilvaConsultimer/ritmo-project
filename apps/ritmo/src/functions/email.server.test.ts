import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLastDevPasswordResetEmail,
  isPasswordResetAvailable,
  isTransactionalEmailConfigured,
  PasswordResetUnavailableError,
  resetDevPasswordResetCapture,
  sendPasswordResetEmail,
} from "./email.server";
import { PasswordResetDeliveryFailedError, type ResendEmailClient } from "./email-resend.server";

afterEach(() => {
  resetDevPasswordResetCapture();
});

const FULLY_CONFIGURED_ENV = {
  TRANSACTIONAL_EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "re_test_key_never_real",
  TRANSACTIONAL_EMAIL_FROM: "Ritmo <naoresponda@ritmo.example.com>",
};

describe("isTransactionalEmailConfigured (Sprint 9 Phase 3 fix-up DEC-098; Resend Phase 6A DEC-120)", () => {
  it("is false when nothing is configured — the pre-Phase-6A real state", () => {
    expect(isTransactionalEmailConfigured({})).toBe(false);
  });

  it("is false when only the provider name is set, without an API key or sender", () => {
    expect(isTransactionalEmailConfigured({ TRANSACTIONAL_EMAIL_PROVIDER: "resend" })).toBe(false);
  });

  it("is false when the API key is present but the sender address is missing", () => {
    expect(
      isTransactionalEmailConfigured({
        TRANSACTIONAL_EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "re_test_key",
      }),
    ).toBe(false);
  });

  it("is true only once provider, API key, and sender are all present", () => {
    expect(isTransactionalEmailConfigured(FULLY_CONFIGURED_ENV)).toBe(true);
  });
});

describe("isPasswordResetAvailable", () => {
  it("is always available in development/test regardless of provider configuration", () => {
    expect(isPasswordResetAvailable("development", {})).toBe(true);
    expect(isPasswordResetAvailable("test", {})).toBe(true);
  });

  it("is unavailable in staging/production until Resend is fully configured", () => {
    expect(isPasswordResetAvailable("staging", {})).toBe(false);
    expect(isPasswordResetAvailable("production", {})).toBe(false);
    expect(isPasswordResetAvailable("production", { TRANSACTIONAL_EMAIL_PROVIDER: "resend" })).toBe(
      false,
    );
  });

  it("becomes available in staging/production once Resend is fully configured", () => {
    expect(isPasswordResetAvailable("production", FULLY_CONFIGURED_ENV)).toBe(true);
  });
});

describe("sendPasswordResetEmail", () => {
  it("(M) captures the real reset URL in-memory in development/test — never through ordinary console logging — instead of pretending to email it", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendPasswordResetEmail("development", { to: "a@b.com", url: "http://x/reset/token" });

    const captured = getLastDevPasswordResetEmail();
    expect(captured?.to).toBe("a@b.com");
    expect(captured?.url).toBe("http://x/reset/token");

    // The token/URL itself must never appear in any log line emitted.
    for (const call of logSpy.mock.calls) {
      expect(String(call[0])).not.toContain("http://x/reset/token");
    }
    logSpy.mockRestore();
  });

  it("throws PasswordResetUnavailableError in staging/production when Resend isn't configured", async () => {
    const originalProvider = process.env["TRANSACTIONAL_EMAIL_PROVIDER"];
    delete process.env["TRANSACTIONAL_EMAIL_PROVIDER"];
    await expect(
      sendPasswordResetEmail("production", { to: "a@b.com", url: "http://x/reset/token" }),
    ).rejects.toThrow(PasswordResetUnavailableError);
    if (originalProvider !== undefined)
      process.env["TRANSACTIONAL_EMAIL_PROVIDER"] = originalProvider;
  });

  describe("with Resend fully configured (mocked transport — NEVER a real network call)", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env["TRANSACTIONAL_EMAIL_PROVIDER"] = originalEnv["TRANSACTIONAL_EMAIL_PROVIDER"];
      process.env["RESEND_API_KEY"] = originalEnv["RESEND_API_KEY"];
      process.env["TRANSACTIONAL_EMAIL_FROM"] = originalEnv["TRANSACTIONAL_EMAIL_FROM"];
    });

    function applyConfiguredEnv() {
      Object.assign(process.env, FULLY_CONFIGURED_ENV);
    }

    it("sends via the injected Resend client — no fake success, a real (mocked) provider call happens", async () => {
      applyConfiguredEnv();
      const sendSpy = vi.fn().mockResolvedValue({ error: null });
      const fakeClient: ResendEmailClient = { emails: { send: sendSpy } };
      const fakeCreateClient = vi.fn().mockReturnValue(fakeClient);

      await sendPasswordResetEmail(
        "production",
        { to: "real-user@example.com", url: "https://ritmo.example.com/reset/tok" },
        fakeCreateClient,
      );

      expect(fakeCreateClient).toHaveBeenCalledWith("re_test_key_never_real");
      expect(sendSpy).toHaveBeenCalledTimes(1);
      const payload = sendSpy.mock.calls[0]![0];
      expect(payload.to).toBe("real-user@example.com");
      expect(payload.from).toBe("Ritmo <naoresponda@ritmo.example.com>");
      expect(payload.html).toContain("https://ritmo.example.com/reset/tok");
      expect(payload.html).not.toMatch(/R\$|saldo|transa[cç][ãa]o/i); // no financial data (brief §E)
    });

    it("throws a normalized PasswordResetDeliveryFailedError on a real provider failure — never the raw provider message", async () => {
      applyConfiguredEnv();
      const fakeClient: ResendEmailClient = {
        emails: {
          send: vi.fn().mockResolvedValue({
            error: { name: "invalid_api_key", message: "Sensitive internal detail from Resend" },
          }),
        },
      };

      await expect(
        sendPasswordResetEmail(
          "production",
          { to: "a@b.com", url: "https://ritmo.example.com/reset/tok" },
          () => fakeClient,
        ),
      ).rejects.toBeInstanceOf(PasswordResetDeliveryFailedError);
    });

    it("never makes a real network call — the fake client is the only thing invoked", async () => {
      applyConfiguredEnv();
      const sendSpy = vi.fn().mockResolvedValue({ error: null });
      await sendPasswordResetEmail(
        "production",
        { to: "a@b.com", url: "https://ritmo.example.com/reset/tok" },
        () => ({ emails: { send: sendSpy } }),
      );
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });
  });
});
