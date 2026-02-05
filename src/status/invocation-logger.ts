import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { logger } from "../utils/logger.js";

export interface InvocationEntry {
  timestamp: number;
  chatId: number;
  durationMs?: number;
  durationApiMs?: number;
  costUsd?: number;
  numTurns?: number;
  stopReason?: string;
  isError: boolean;
  tier?: "chat" | "orchestrator" | "worker";
  taskId?: string;
  modelUsage?: Record<string, any>;
}

const MAX_ENTRIES = 100;

export class InvocationLogger {
  private entries: InvocationEntry[] = [];
  private filePath: string;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, "invocations.json");
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      this.entries = JSON.parse(raw);
      logger.info({ count: this.entries.length }, "Invocations loaded");
    } catch {
      logger.info("No existing invocations file, starting fresh");
    }
  }

  async log(entry: InvocationEntry): Promise<void> {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    try {
      await mkdir(join(this.filePath, ".."), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(this.entries, null, 2));
      logger.debug("Invocation logged");
    } catch (err) {
      logger.error({ err }, "Failed to save invocations");
    }
  }

  getRecent(n: number): InvocationEntry[] {
    return this.entries.slice(-n);
  }
}
