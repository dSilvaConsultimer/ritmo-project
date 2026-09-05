/**
 * Generic identifier utilities shared across packages/apps.
 * Not financial-domain-specific — that logic lives in @money-copilot/financial-engine.
 */

export type Id<Brand extends string> = string & { readonly __brand: Brand };

let counter = 0;

/**
 * Deterministic, dependency-free id generator for fixtures/tests.
 * Not cryptographically unique — replace with a real generator (uuid, ulid)
 * once persistence is introduced in a future sprint.
 */
export function createId<Brand extends string>(prefix: Brand): Id<Brand> {
  counter += 1;
  return `${prefix}_${counter}_${Date.now().toString(36)}` as Id<Brand>;
}
