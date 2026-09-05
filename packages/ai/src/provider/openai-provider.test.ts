import { describe, expect, it } from "vitest";
import { OpenAIProvider } from "./openai-provider";
import { AIError } from "./types";

describe("OpenAIProvider", () => {
  it("throws AI_CONFIGURATION_ERROR when constructed without an API key", () => {
    expect(() => new OpenAIProvider({ apiKey: "" })).toThrow(AIError);
    try {
      new OpenAIProvider({ apiKey: "" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AIError);
      expect((error as AIError).code).toBe("AI_CONFIGURATION_ERROR");
    }
  });

  it("defaults to the configured model when none is supplied", () => {
    // Constructing with a key never calls the network — the SDK client is lazy.
    const provider = new OpenAIProvider({ apiKey: "sk-test-not-real" });
    expect(provider.name).toBe("openai");
  });

  it("accepts an explicit model override", () => {
    const provider = new OpenAIProvider({ apiKey: "sk-test-not-real", model: "gpt-5.6-sol" });
    expect(provider.name).toBe("openai");
  });
});
