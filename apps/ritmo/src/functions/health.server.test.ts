import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetDbCache, getDb } from "@money-copilot/app-services";
import { checkLiveHandler, checkReadyHandler } from "./health.server";

describe("checkLiveHandler (Sprint 9 Phase 5, DEC-112, brief §25.Q)", () => {
  it("always returns ok, synchronously, with no dependency checks", () => {
    expect(checkLiveHandler()).toEqual({ status: "ok" });
  });
});

describe("checkReadyHandler (brief §25.R/S)", () => {
  let tmpDir: string;

  beforeAll(async () => {
    delete process.env["APP_ENV"];
    resetDbCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ritmo-health-"));
    process.env["MONEY_COPILOT_DB_PATH"] = path.join(tmpDir, "test.pglite");
  });

  afterAll(() => {
    resetDbCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("(R) is ok when the database is reachable and (in dev) config has nothing extra required", async () => {
    await getDb();
    const result = await checkReadyHandler();
    expect(result.status).toBe("ok");
    expect(result.checks.database).toBe("ok");
  });

  it("(R) fails safely (degraded, not a crash) when required staging/production config is missing", async () => {
    process.env["APP_ENV"] = "staging";
    const originalDbUrl = process.env["DATABASE_URL"];
    delete process.env["DATABASE_URL"];
    delete process.env["BETTER_AUTH_SECRET"];
    delete process.env["BETTER_AUTH_URL"];

    const result = await checkReadyHandler();
    expect(result.status).toBe("degraded");
    expect(result.checks.config).toBe("error");

    delete process.env["APP_ENV"];
    if (originalDbUrl !== undefined) process.env["DATABASE_URL"] = originalDbUrl;
  });

  it("(S) never includes a secret value, hostname, or raw error detail in its output", async () => {
    const result = await checkReadyHandler();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/postgres:\/\//i);
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/);
    expect(Object.keys(result.checks)).toEqual(["config", "database"]);
  });
});
