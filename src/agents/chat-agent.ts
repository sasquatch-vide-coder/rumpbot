import { Config } from "../config.js";
import { invokeClaude, ClaudeResult } from "../claude/invoker.js";
import { SessionManager } from "../claude/session-manager.js";
import { AgentConfigManager } from "./agent-config.js";
import { buildChatSystemPrompt } from "./prompts.js";
import type { WorkRequest, ChatAgentResponse } from "./types.js";
import { logger } from "../utils/logger.js";

export class ChatAgent {
  private systemPrompt: string;

  constructor(
    private config: Config,
    private agentConfig: AgentConfigManager,
    private sessionManager: SessionManager,
    personalityMd: string,
  ) {
    this.systemPrompt = buildChatSystemPrompt(personalityMd);
  }

  async invoke(opts: {
    chatId: number;
    prompt: string;
    cwd: string;
    abortSignal?: AbortSignal;
    onInvocation?: (raw: any) => void;
  }): Promise<{
    chatResponse: string;
    workRequest: WorkRequest | null;
    claudeResult: ClaudeResult;
  }> {
    const tierConfig = this.agentConfig.getConfig("chat");
    const sessionId = this.sessionManager.getSessionId(opts.chatId, "chat");

    const result = await invokeClaude({
      prompt: opts.prompt,
      cwd: opts.cwd,
      sessionId,
      abortSignal: opts.abortSignal,
      config: this.config,
      onInvocation: opts.onInvocation,
      systemPrompt: this.systemPrompt,
      model: tierConfig.model,
      maxTurnsOverride: tierConfig.maxTurns,
      timeoutMsOverride: tierConfig.timeoutMs,
    });

    // Save session
    if (result.sessionId) {
      this.sessionManager.set(opts.chatId, result.sessionId, opts.cwd, "chat");
    }

    // Parse response for action blocks
    const parsed = parseChatResponse(result.result);

    logger.info({
      chatId: opts.chatId,
      hasAction: !!parsed.action,
      responseLength: parsed.chatText.length,
    }, "Chat agent response parsed");

    return {
      chatResponse: parsed.chatText,
      workRequest: parsed.action,
      claudeResult: result,
    };
  }
}

function parseChatResponse(text: string): ChatAgentResponse {
  const actionRegex = /<RUMPBOT_ACTION>([\s\S]*?)<\/RUMPBOT_ACTION>/;
  const match = text.match(actionRegex);

  if (!match) {
    return { chatText: text, action: null };
  }

  // Extract chat text (everything outside the action block)
  const chatText = text.replace(actionRegex, "").trim();

  try {
    const action = JSON.parse(match[1].trim()) as WorkRequest;
    // Validate the action has required fields
    if (action.type !== "work_request" || !action.task) {
      logger.warn({ action }, "Invalid action block from chat agent, ignoring");
      return { chatText: text, action: null };
    }
    return { chatText: chatText || "Working on it...", action };
  } catch (err) {
    logger.warn({ err, raw: match[1] }, "Failed to parse action block JSON");
    return { chatText: text, action: null };
  }
}
