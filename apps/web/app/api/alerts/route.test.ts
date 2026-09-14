import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Sprint 7: PATCH /api/alerts is the only client-facing alert mutation
 * surface (mark seen / dismiss) — it must never create, resolve, or
 * re-severity an alert (that's `evaluateAlerts`'s exclusive job, run
 * server-side elsewhere). Missing input is rejected before touching the
 * database; a request for an unknown alert id returns 404, never a raw
 * stack trace.
 */
describe("PATCH /api/alerts", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@money-copilot/app-services");
  });

  function request(body: unknown) {
    return new Request("http://localhost/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns 400 when alertId or action is missing", async () => {
    vi.doMock("@money-copilot/app-services", () => ({
      getDb: vi.fn(async () => ({})),
      DEMO_PROFILE_ID: "demo-profile",
      markAlertSeen: vi.fn(),
      dismissAlert: vi.fn(),
    }));
    const { PATCH } = await import("./route");
    const response = await PATCH(request({ alertId: "alert-1" }) as never);
    expect(response.status).toBe(400);
  });

  it("calls markAlertSeen for action SEEN and returns the updated alert", async () => {
    const updated = { id: "alert-1", status: "ACTIVE_SEEN" };
    const markAlertSeen = vi.fn(async () => updated);
    vi.doMock("@money-copilot/app-services", () => ({
      getDb: vi.fn(async () => ({})),
      DEMO_PROFILE_ID: "demo-profile",
      markAlertSeen,
      dismissAlert: vi.fn(),
    }));
    const { PATCH } = await import("./route");
    const response = await PATCH(request({ alertId: "alert-1", action: "SEEN" }) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ alert: updated });
    expect(markAlertSeen).toHaveBeenCalledWith({}, "demo-profile", "alert-1");
  });

  it("calls dismissAlert for action DISMISS", async () => {
    const updated = { id: "alert-1", status: "DISMISSED" };
    const dismissAlert = vi.fn(async () => updated);
    vi.doMock("@money-copilot/app-services", () => ({
      getDb: vi.fn(async () => ({})),
      DEMO_PROFILE_ID: "demo-profile",
      markAlertSeen: vi.fn(),
      dismissAlert,
    }));
    const { PATCH } = await import("./route");
    const response = await PATCH(request({ alertId: "alert-1", action: "DISMISS" }) as never);
    expect(response.status).toBe(200);
    expect(dismissAlert).toHaveBeenCalledWith({}, "demo-profile", "alert-1");
  });

  it("returns 404 for an unknown alert id rather than a raw error", async () => {
    vi.doMock("@money-copilot/app-services", () => ({
      getDb: vi.fn(async () => ({})),
      DEMO_PROFILE_ID: "demo-profile",
      markAlertSeen: vi.fn(async () => {
        throw new Error("No alert unknown-id");
      }),
      dismissAlert: vi.fn(),
    }));
    const { PATCH } = await import("./route");
    const response = await PATCH(request({ alertId: "unknown-id", action: "SEEN" }) as never);
    expect(response.status).toBe(404);
  });
});
