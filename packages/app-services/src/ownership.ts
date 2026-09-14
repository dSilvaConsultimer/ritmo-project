/**
 * Sprint 9 multi-user isolation: the one place every "fetch a resource by
 * bare id, then act on it" function in this package routes its ownership
 * check through, so the check (and its security rationale) exists exactly
 * once rather than being reimplemented slightly differently per resource
 * type. See docs/DECISIONS.md DEC-093 and the Sprint 9 brief §18.
 */

/** Thrown identically whether a resource is missing or belongs to a different profile. */
export class ResourceNotFoundError extends Error {
  constructor(resourceDescription: string) {
    super(`Not found: ${resourceDescription}`);
    this.name = "ResourceNotFoundError";
  }
}

/**
 * A caller must never be able to distinguish "this id doesn't exist" from
 * "this id exists, but belongs to a different profile" — both cases throw
 * the exact same `ResourceNotFoundError`, with the exact same message
 * shape, so neither timing nor error content leaks whether another user's
 * resource exists (brief §18: "never leak whether another user's sensitive
 * resource exists unnecessarily").
 */
export function assertOwnedByProfile<T extends { readonly financialProfileId: string }>(
  resource: T | null | undefined,
  financialProfileId: string,
  resourceDescription: string,
): T {
  if (!resource || resource.financialProfileId !== financialProfileId) {
    throw new ResourceNotFoundError(resourceDescription);
  }
  return resource;
}
