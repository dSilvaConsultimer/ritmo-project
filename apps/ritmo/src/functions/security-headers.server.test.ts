import { describe, expect, it } from "vitest";
import { applySecurityHeaders } from "./security-headers.server";

describe("applySecurityHeaders (Sprint 9 Phase 5, DEC-110)", () => {
  it("is a no-op in development — preserves Vite HMR's needs", () => {
    const response = new Response("ok");
    const result = applySecurityHeaders(response, "development");
    expect(result.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("applies CSP, frame protection, and content-type sniffing protection in production", () => {
    const response = new Response("ok");
    const result = applySecurityHeaders(response, "production");
    const csp = result.headers.get("Content-Security-Policy");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(result.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(result.headers.get("X-Frame-Options")).toBe("DENY");
    expect(result.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("includes the real Pluggy widget and Google Fonts origins, never a wildcard", () => {
    const result = applySecurityHeaders(new Response("ok"), "production");
    const csp = result.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("https://connect.pluggy.ai");
    expect(csp).toContain("https://fonts.googleapis.com");
    expect(csp).toContain("https://fonts.gstatic.com");
    expect(csp).not.toContain("*");
  });

  it("sets HSTS in production and staging, not test", () => {
    expect(
      applySecurityHeaders(new Response("ok"), "production").headers.get(
        "Strict-Transport-Security",
      ),
    ).not.toBeNull();
    expect(
      applySecurityHeaders(new Response("ok"), "staging").headers.get("Strict-Transport-Security"),
    ).not.toBeNull();
    expect(
      applySecurityHeaders(new Response("ok"), "test").headers.get("Strict-Transport-Security"),
    ).toBeNull();
  });

  it("applies headers in test too (so this suite itself exercises the real production shape)", () => {
    const result = applySecurityHeaders(new Response("ok"), "test");
    expect(result.headers.get("Content-Security-Policy")).not.toBeNull();
  });

  it("preserves the original response status and body", async () => {
    const response = new Response("hello", { status: 404 });
    const result = applySecurityHeaders(response, "production");
    expect(result.status).toBe(404);
    expect(await result.text()).toBe("hello");
  });
});
