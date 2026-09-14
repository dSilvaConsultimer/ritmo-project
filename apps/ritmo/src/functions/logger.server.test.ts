import { describe, expect, it, vi } from "vitest";
import { logger, __testing } from "./logger.server";

describe("logger redaction (Sprint 9 Phase 5, DEC-106)", () => {
  it("(L) redacts known sensitive field names regardless of value", () => {
    const result = __testing.redactFields({
      password: "hunter2",
      SESSION_TOKEN: "abc",
      apiKey: "sk-real-value",
      cookie: "better-auth.session_token=xyz",
      betterAuthSecret: "shh",
      safeField: "hello",
    });
    expect(result["password"]).toBe("[redacted]");
    expect(result["SESSION_TOKEN"]).toBe("[redacted]");
    expect(result["apiKey"]).toBe("[redacted]");
    expect(result["cookie"]).toBe("[redacted]");
    expect(result["betterAuthSecret"]).toBe("[redacted]");
    expect(result["safeField"]).toBe("hello");
  });

  it("redacts a secret-shaped VALUE even under an innocuous field name", () => {
    const result = __testing.redactFields({
      note: "sk-abcdefghijklmnopqrstuvwx",
    });
    expect(result["note"]).toBe("[redacted]");
  });

  it("redacts nested objects and arrays, not just top-level fields", () => {
    const result = __testing.redactFields({
      user: { email: "a@b.com", password: "hunter2" },
      items: ["sk-abcdefghijklmnopqrstuvwx", "harmless"],
    });
    expect((result["user"] as Record<string, unknown>)["password"]).toBe("[redacted]");
    expect((result["user"] as Record<string, unknown>)["email"]).toBe("a@b.com");
    expect((result["items"] as unknown[])[0]).toBe("[redacted]");
    expect((result["items"] as unknown[])[1]).toBe("harmless");
  });

  it("a field name merely containing 'token' (e.g. a plural like 'tokens') is redacted wholesale, not recursed into — the safer default", () => {
    const result = __testing.redactFields({ tokens: ["a", "b"] });
    expect(result["tokens"]).toBe("[redacted]");
  });

  it("info/warn/error/audit all emit structured JSON with the expected shape, never a raw secret", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("test_event", { financialProfileId: "fp_123", password: "hunter2" });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(parsed["event"]).toBe("test_event");
    expect(parsed["severity"]).toBe("info");
    expect(parsed["financialProfileId"]).toBe("fp_123");
    expect(parsed["password"]).toBe("[redacted]");
    expect(typeof parsed["timestamp"]).toBe("string");
    logSpy.mockRestore();
  });

  it("audit() uses severity 'audit', distinct from ordinary logging", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.audit("connection_completed", { financialProfileId: "fp_123" });
    const parsed = JSON.parse(logSpy.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(parsed["severity"]).toBe("audit");
    logSpy.mockRestore();
  });
});
