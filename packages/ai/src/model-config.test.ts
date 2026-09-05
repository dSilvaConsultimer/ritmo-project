import { describe, expect, it } from "vitest";
import { DEFAULT_OPENAI_MODEL, resolveOpenAIModel } from "./model-config";

describe("resolveOpenAIModel", () => {
  it("defaults to gpt-5.6-terra when OPENAI_MODEL is unset", () => {
    expect(resolveOpenAIModel({})).toBe(DEFAULT_OPENAI_MODEL);
    expect(DEFAULT_OPENAI_MODEL).toBe("gpt-5.6-terra");
  });

  it("is configurable via the OPENAI_MODEL env var", () => {
    expect(resolveOpenAIModel({ OPENAI_MODEL: "gpt-5.6-sol" })).toBe("gpt-5.6-sol");
  });

  it("falls back to the default for a blank OPENAI_MODEL value", () => {
    expect(resolveOpenAIModel({ OPENAI_MODEL: "  " })).toBe(DEFAULT_OPENAI_MODEL);
  });
});
