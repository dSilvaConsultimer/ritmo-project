import { z } from "zod";
import { describe, expect, it } from "vitest";
import { TOOL_REGISTRY } from "./tools";

/**
 * Regression test for a real bug found during Sprint 4.5's live OpenAI
 * validation: OpenAI's strict function-calling mode rejects any tool
 * whose JSON Schema `properties` includes a key not also listed in
 * `required` (the error was: "'required' is required to be supplied and
 * to be an array including every key in properties"). Plain Zod
 * `.optional()` fields are correctly omitted from `required` by
 * `z.toJSONSchema` — which is exactly what OpenAI's strict validator
 * rejects. Every optional tool argument in `tools.ts` was converted to
 * `.nullable().default(null)` to fix this (still omittable in practice —
 * OpenAI sends `null` — while staying listed in `required`).
 *
 * This test would have caught the original bug without needing a live API
 * call at all — see docs/AI-COPILOT.md, "Live OpenAI smoke test."
 */
describe("every tool's JSON Schema satisfies OpenAI strict function-calling mode", () => {
  for (const tool of TOOL_REGISTRY) {
    it(`${tool.name}: every property key appears in 'required'`, () => {
      const jsonSchema = z.toJSONSchema(tool.schema as z.ZodType) as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      const propertyKeys = Object.keys(jsonSchema.properties ?? {});
      const required = jsonSchema.required ?? [];

      for (const key of propertyKeys) {
        expect(required).toContain(key);
      }
      // Also the reverse — `required` should never list a key that isn't
      // an actual property (would be a different, equally invalid schema).
      for (const key of required) {
        expect(propertyKeys).toContain(key);
      }
    });
  }
});
