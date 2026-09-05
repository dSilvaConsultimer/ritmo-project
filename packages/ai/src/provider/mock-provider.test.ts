import { describe, expect, it } from "vitest";
import { AIError } from "./types";
import { MockAIProvider, mockTextResult, mockToolCallResult } from "./mock-provider";

const baseOptions = { model: "gpt-5.6-terra", instructions: "test", input: [], tools: [] };

describe("MockAIProvider", () => {
  it("never calls any network API — it is a pure in-memory script", async () => {
    const provider = new MockAIProvider([mockTextResult("hello")]);
    const result = await provider.generate(baseOptions);
    expect(result.outcome).toEqual({ kind: "message", text: "hello" });
  });

  it("returns results from a fixed array in call order", async () => {
    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "getSafeToSpend", argumentsJson: "{}" }]),
      mockTextResult("You can spend R$ 100."),
    ]);

    const first = await provider.generate(baseOptions);
    expect(first.outcome.kind).toBe("tool_calls");

    const second = await provider.generate(baseOptions);
    expect(second.outcome).toEqual({ kind: "message", text: "You can spend R$ 100." });
  });

  it("throws AIError when the script is exhausted, instead of returning undefined", async () => {
    const provider = new MockAIProvider([mockTextResult("only one")]);
    await provider.generate(baseOptions);
    await expect(provider.generate(baseOptions)).rejects.toThrow(AIError);
  });

  it("supports a dynamic function script that inspects the actual input sent", async () => {
    const provider = new MockAIProvider((options) => {
      const lastMessage = options.input.find((i) => i.type === "message");
      return mockTextResult(`echo: ${lastMessage && "content" in lastMessage ? lastMessage.content : ""}`);
    });

    const result = await provider.generate({
      ...baseOptions,
      input: [{ type: "message", role: "user", content: "hi" }],
    });
    expect(result.outcome).toEqual({ kind: "message", text: "echo: hi" });
  });

  it("records every call for test assertions", async () => {
    const provider = new MockAIProvider([mockTextResult("a"), mockTextResult("b")]);
    await provider.generate(baseOptions);
    await provider.generate(baseOptions);
    expect(provider.calls).toHaveLength(2);
  });
});
