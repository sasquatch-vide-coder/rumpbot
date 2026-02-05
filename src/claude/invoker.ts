import { spawn } from "child_process";
import { Config } from "../config.js";
import { logger } from "../utils/logger.js";

export interface ClaudeResult {
  result: string;
  sessionId: string;
  costUsd?: number;
  duration?: number;
  isError: boolean;
}

export interface InvokeOptions {
  prompt: string;
  cwd: string;
  sessionId?: string;
  abortSignal?: AbortSignal;
  config: Config;
  onInvocation?: (raw: any) => void;
  systemPrompt?: string;
  model?: string;
  maxTurnsOverride?: number;
  timeoutMsOverride?: number;
  /** Restrict available tools. Empty string disables all tools. */
  allowedTools?: string;
}

export async function invokeClaude(opts: InvokeOptions): Promise<ClaudeResult> {
  try {
    return await invokeClaudeInternal(opts);
  } catch (err: any) {
    // If resume failed, retry without session
    if (opts.sessionId && isSessionError(err)) {
      logger.warn({ sessionId: opts.sessionId }, "Session expired, retrying without resume");
      return invokeClaudeInternal({ ...opts, sessionId: undefined });
    }
    throw err;
  }
}

function isSessionError(err: any): boolean {
  const msg = String(err?.message || err);
  return (
    msg.includes("session") ||
    msg.includes("resume") ||
    msg.includes("not found") ||
    msg.includes("invalid")
  );
}

function invokeClaudeInternal(opts: InvokeOptions): Promise<ClaudeResult> {
  const { prompt, cwd, sessionId, abortSignal, config } = opts;

  return new Promise((resolve, reject) => {
    const args: string[] = [
      "-p", prompt,
      "--output-format", "json",
      "--max-turns", String(opts.maxTurnsOverride ?? config.maxTurns),
      "--verbose",
      "--dangerously-skip-permissions",
    ];

    if (opts.systemPrompt) {
      args.push("--system-prompt", opts.systemPrompt);
    }

    if (opts.model) {
      args.push("--model", opts.model);
    }

    if (opts.allowedTools !== undefined) {
      args.push("--tools", opts.allowedTools);
    }

    if (sessionId) {
      args.push("--resume", sessionId);
    }

    logger.debug({ args, cwd }, "Spawning Claude CLI");

    const proc = spawn(config.claudeCliPath, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      signal: abortSignal,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Timeout (0 = no timeout)
    const effectiveTimeout = opts.timeoutMsOverride ?? config.claudeTimeoutMs;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    if (effectiveTimeout > 0) {
      timeout = setTimeout(() => {
        proc.kill("SIGTERM");
        reject(new Error(`Claude CLI timed out after ${effectiveTimeout}ms`));
      }, effectiveTimeout);
    }

    proc.on("close", (code) => {
      if (timeout) clearTimeout(timeout);

      if (abortSignal?.aborted) {
        reject(new Error("Cancelled"));
        return;
      }

      if (stderr) {
        logger.debug({ stderr }, "Claude CLI stderr");
      }

      if (code !== 0 && !stdout) {
        const errMsg = stderr || `Claude CLI exited with code ${code}`;
        // Check for rate limit
        if (stderr.includes("rate limit") || stderr.includes("429")) {
          reject(new Error(`Rate limited: ${errMsg}`));
          return;
        }
        reject(new Error(errMsg));
        return;
      }

      try {
        const parsed = parseClaudeOutput(stdout, opts.onInvocation);
        resolve(parsed);
      } catch (parseErr) {
        // If JSON parse fails, return raw stdout as result
        if (stdout.trim()) {
          resolve({
            result: stdout.trim(),
            sessionId: sessionId || "",
            isError: false,
          });
        } else {
          reject(parseErr);
        }
      }
    });

    proc.on("error", (err) => {
      if (timeout) clearTimeout(timeout);
      reject(err);
    });
  });
}

function parseClaudeOutput(raw: string, onInvocation?: (raw: any) => void): ClaudeResult {
  // claude --output-format json outputs a JSON object
  // Find the last complete JSON object in the output (may have other output before it)
  const trimmed = raw.trim();

  // Try parsing the full output first
  try {
    const data = JSON.parse(trimmed);
    if (onInvocation) onInvocation(data);
    return extractResult(data);
  } catch {
    // Try to find JSON in the output
  }

  // Look for JSON object or array at the end (verbose mode may prepend text)
  const lastClose = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  if (lastClose === -1) throw new Error("No JSON found in Claude output");

  const closeChar = trimmed[lastClose];
  const openChar = closeChar === "}" ? "{" : "[";

  let depth = 0;
  let start = -1;
  for (let i = lastClose; i >= 0; i--) {
    if (trimmed[i] === closeChar) depth++;
    if (trimmed[i] === openChar) depth--;
    if (depth === 0) {
      start = i;
      break;
    }
  }

  if (start === -1) throw new Error("Malformed JSON in Claude output");

  const jsonStr = trimmed.slice(start, lastClose + 1);
  const data = JSON.parse(jsonStr);
  if (onInvocation) onInvocation(data);
  return extractResult(data);
}

function extractResult(data: any): ClaudeResult {
  // Handle array format from --verbose mode
  if (Array.isArray(data)) {
    const resultEntry = data.find((item: any) => item.type === "result");
    if (resultEntry) {
      return extractResult(resultEntry);
    }
    // Fallback: join any text content
    const text = data.map((b: any) => b.text || "").join("");
    if (text) {
      return { result: text, sessionId: "", isError: false };
    }
    return { result: "No readable response from Claude.", sessionId: "", isError: true };
  }

  // Handle known subtypes that don't produce readable text
  if (data.subtype === "errormaxturns") {
    const turns = data.numturns || data.num_turns || "unknown";
    const cost = data.totalcostusd || data.total_cost_usd || data.cost_usd;
    const costStr = cost ? ` (cost: $${Number(cost).toFixed(2)})` : "";
    return {
      result: `Claude reached the maximum number of turns (${turns}) for this request${costStr}. The work may be partially complete — try asking about the current state or continue the conversation.`,
      sessionId: data.sessionid || data.session_id || "",
      costUsd: cost,
      duration: data.durationms || data.duration_ms,
      isError: false,
    };
  }

  // Handle single result object — prefer readable text, never fall through to raw JSON
  const result = data.result || data.content;

  if (!result) {
    // No readable content — generate a friendly message based on what we know
    const subtype = data.subtype || data.type || "unknown";
    return {
      result: `Claude finished but returned no readable text (type: ${subtype}). The task may still have been completed.`,
      sessionId: data.sessionid || data.session_id || "",
      costUsd: data.totalcostusd || data.total_cost_usd || data.cost_usd,
      duration: data.durationms || data.duration_ms,
      isError: data.is_error || data.iserror || false,
    };
  }

  return {
    result: typeof result === "string" ? result : JSON.stringify(result),
    sessionId: data.sessionid || data.session_id || "",
    costUsd: data.totalcostusd || data.total_cost_usd || data.cost_usd,
    duration: data.durationms || data.duration_ms,
    isError: data.is_error || data.iserror || false,
  };
}
