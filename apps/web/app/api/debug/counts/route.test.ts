import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Security regression (Sprint 4.5, DEC-053): GET /api/debug/counts exposes
 * entity counts useful for local dev/live-validation but must never be
 * anonymously reachable in production — it would let anyone inspect
 * financial database counts. This must return 404 in production WITHOUT
 * ever touching the database, so mocking `getDb` to throw is how we prove
 * the gate runs first.
 */
describe("GET /api/debug/counts — production gate", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@money-copilot/app-services");
    vi.unstubAllEnvs();
  });

  it("returns 404 in production without calling getDb", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.doMock("@money-copilot/app-services", () => ({
      getDb: vi.fn(() => {
        throw new Error("getDb must not be called in production");
      }),
      getEntityCounts: vi.fn(),
      DEMO_PROFILE_ID: "financial-profile_fixture",
    }));

    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(404);
  });

  it("returns counts outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const fakeCounts = { connections: { count: 1, byStatus: { CONNECTED: 1 } } };
    vi.doMock("@money-copilot/app-services", () => ({
      getDb: vi.fn(async () => ({})),
      getEntityCounts: vi.fn(async () => fakeCounts),
      DEMO_PROFILE_ID: "financial-profile_fixture",
    }));

    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(fakeCounts);
  });
});
