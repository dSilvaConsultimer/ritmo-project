import { NextRequest, NextResponse } from "next/server";
import { AIError, OpenAIProvider, resolveOpenAIModel } from "@money-copilot/ai";
import {
  getDb,
  DEMO_PROFILE_ID,
  runCopilotTurn,
  listConversationsForProfile,
  listMessagesForConversation,
} from "@money-copilot/app-services";

export const runtime = "nodejs";

// Matches the rest of the (Sprint 1-3) dashboard's fixed "as of" date — see
// app/page.tsx. A real clock/timezone policy is future work, not Sprint 4's.
const ASOF_DATE = "2026-09-05";

function errorStatus(code: AIError["code"]): number {
  switch (code) {
    case "AI_CONFIGURATION_ERROR":
      return 503;
    case "AI_AUTHENTICATION_ERROR":
      return 502;
    case "AI_RATE_LIMITED":
      return 429;
    case "AI_PROVIDER_UNAVAILABLE":
      return 502;
    case "AI_TIMEOUT":
      return 504;
    case "AI_INVALID_TOOL_ARGUMENTS":
      return 400;
    case "AI_TOOL_EXECUTION_FAILED":
    case "AI_GROUNDING_FAILED":
    case "AI_UNKNOWN_ERROR":
      return 500;
  }
}

/**
 * Sends one message to the AI copilot and returns the structured
 * `CopilotResponse`. When `OPENAI_API_KEY` is not configured, this returns
 * a clear `AI_CONFIGURATION_ERROR` rather than silently degrading to a
 * stub assistant — the rest of the (Sprint 1-3) dashboard keeps working
 * regardless. See docs/AI-COPILOT.md, "AI error handling."
 */
export async function POST(request: NextRequest): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { conversationId?: string; message?: string };
  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json(
      { error: { code: "AI_INVALID_TOOL_ARGUMENTS", message: "A non-empty message is required." } },
      { status: 400 },
    );
  }

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    return NextResponse.json(
      {
        error: {
          code: "AI_CONFIGURATION_ERROR",
          message: "AI chat is not configured yet — OPENAI_API_KEY is missing on the server.",
        },
      },
      { status: 503 },
    );
  }

  const db = await getDb();
  const model = resolveOpenAIModel();
  const aiProvider = new OpenAIProvider({ apiKey, model });

  try {
    const response = await runCopilotTurn({
      db,
      financialProfileId: DEMO_PROFILE_ID,
      asOfDate: ASOF_DATE,
      ...(body.conversationId ? { conversationId: body.conversationId } : {}),
      userMessageText: message,
      aiProvider,
      model,
    });
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof AIError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: errorStatus(error.code) },
      );
    }
    return NextResponse.json(
      { error: { code: "AI_UNKNOWN_ERROR", message: "Unexpected error." } },
      { status: 500 },
    );
  }
}

/**
 * `?conversationId=...` returns that conversation's full message history
 * (for reloading the chat UI); with no query param, returns the profile's
 * conversation list, most recently updated first.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const db = await getDb();
  const conversationId = request.nextUrl.searchParams.get("conversationId");

  if (conversationId) {
    const messages = await listMessagesForConversation(db, conversationId);
    return NextResponse.json({ messages });
  }

  const conversations = await listConversationsForProfile(db, DEMO_PROFILE_ID);
  return NextResponse.json({ conversations });
}
