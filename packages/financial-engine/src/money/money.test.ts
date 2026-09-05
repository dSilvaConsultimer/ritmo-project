import { describe, expect, it } from "vitest";
import * as M from "./money";

describe("Money", () => {
  it("represents reais amounts as integer cents", () => {
    expect(M.fromReais(15_000).cents).toBe(1_500_000);
    expect(M.fromReais(476.1).cents).toBe(47_610);
    expect(M.fromReais(0.1).cents).toBe(10);
  });

  it("rejects non-integer cent amounts (no floating point money)", () => {
    expect(() => M.fromCents(10.5)).toThrow(TypeError);
    expect(() => M.fromCents(Number.NaN)).toThrow(TypeError);
    expect(() => M.fromCents(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it("adds and subtracts using exact integer arithmetic", () => {
    const a = M.fromCents(100);
    const b = M.fromCents(33);
    const c = M.fromCents(33);
    const d = M.fromCents(33);
    // Repeated additions of amounts that are lossy in binary floating point
    // (e.g. 0.33) must remain exact when done in integer cents.
    expect(M.add(b, c, d).cents).toBe(99);
    expect(M.subtract(a, b).cents).toBe(67);
  });

  it("never produces floating point drift for classic lossy decimals", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE754 floats; in integer cents it must be exact.
    const tenCents = M.fromReais(0.1);
    const twentyCents = M.fromReais(0.2);
    expect(M.add(tenCents, twentyCents).cents).toBe(30);
  });

  it("compares amounts", () => {
    expect(M.compare(M.fromCents(100), M.fromCents(200))).toBe(-1);
    expect(M.compare(M.fromCents(200), M.fromCents(100))).toBe(1);
    expect(M.compare(M.fromCents(100), M.fromCents(100))).toBe(0);
    expect(M.equals(M.fromCents(50), M.fromCents(50))).toBe(true);
  });

  it("exposes sign helpers", () => {
    expect(M.isNegative(M.fromCents(-1))).toBe(true);
    expect(M.isPositive(M.fromCents(1))).toBe(true);
    expect(M.isZero(M.fromCents(0))).toBe(true);
  });

  it("floors at zero without mutating the sign of positive values", () => {
    expect(M.floorAtZero(M.fromCents(-500)).cents).toBe(0);
    expect(M.floorAtZero(M.fromCents(500)).cents).toBe(500);
  });

  it("finds max/min across a set of values", () => {
    const values = [M.fromCents(300), M.fromCents(100), M.fromCents(200)];
    expect(M.max(...values).cents).toBe(300);
    expect(M.min(...values).cents).toBe(100);
  });

  it("scales by a dimensionless factor, rounding to the nearest cent", () => {
    expect(M.scale(M.fromCents(10_000), 0.15).cents).toBe(1_500);
    expect(M.scale(M.fromCents(100), 1 / 3).cents).toBe(33);
  });

  it("formats as pt-BR currency", () => {
    const formatted = M.format(M.fromReais(1_500));
    expect(formatted).toContain("1.500,00");
  });
});
