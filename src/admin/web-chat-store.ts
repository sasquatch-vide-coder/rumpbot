import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { logger } from "../utils/logger.js";

export interface WebChatMessage {
  id: string;
  role: "user" | "assistant" | "status" | "work_result";
  text: string;
  timestamp: number;
  phase?: string;
  workMeta?: {
    overallSuccess: boolean;
    totalCostUsd: number;
    workerCount?: number;
  };
}

const MAX_MESSAGES = 200;

export class WebChatStore {
  private messages: WebChatMessage[] = [];
  private filePath: string;
  private dirty = false;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, "web-chat.json");
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      this.messages = JSON.parse(raw);
      logger.info({ count: this.messages.length }, "Web chat history loaded");
    } catch {
      logger.info("No existing web chat history, starting fresh");
    }
  }

  private async save(): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(this.messages, null, 2));
      this.dirty = false;
    } catch (err) {
      logger.error({ err }, "Failed to save web chat history");
    }
  }

  async addMessage(msg: WebChatMessage): Promise<void> {
    this.messages.push(msg);
    // Trim old messages if we exceed the cap
    if (this.messages.length > MAX_MESSAGES) {
      this.messages = this.messages.slice(-MAX_MESSAGES);
    }
    await this.save();
  }

  getMessages(): WebChatMessage[] {
    return [...this.messages];
  }

  async clear(): Promise<void> {
    this.messages = [];
    await this.save();
  }
}
