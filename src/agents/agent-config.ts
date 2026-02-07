import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { logger } from "../utils/logger.js";
import type { AgentTier } from "./types.js";

export interface AgentTierConfig {
  model: string;
  maxTurns: number;
  timeoutMs: number;
}

export interface AgentConfigData {
  chat: AgentTierConfig;
  executor: AgentTierConfig;
}

const DEFAULT_CONFIG: AgentConfigData = {
  chat: {
    model: "claude-haiku-4-5-20251001",
    maxTurns: 3,
    timeoutMs: 30000,
  },
  executor: {
    model: "claude-opus-4-5-20251101",
    maxTurns: 50,
    timeoutMs: 0,
  },
};

export class AgentConfigManager {
  private config: AgentConfigData = structuredClone(DEFAULT_CONFIG);
  private filePath: string;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, "agent-config.json");
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const data = JSON.parse(raw) as Partial<AgentConfigData>;
      // Merge with defaults so new fields are always present
      // Also handle legacy configs that had orchestrator/worker keys
      this.config = {
        chat: { ...DEFAULT_CONFIG.chat, ...data.chat },
        executor: { ...DEFAULT_CONFIG.executor, ...data.executor },
      };
      logger.info("Agent config loaded");
    } catch {
      logger.info("No existing agent config, using defaults");
    }
  }

  async save(): Promise<void> {
    await mkdir(join(this.filePath, ".."), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.config, null, 2));
    logger.debug("Agent config saved");
  }

  getConfig(tier: AgentTier): AgentTierConfig {
    return this.config[tier];
  }

  setModel(tier: AgentTier, model: string): void {
    this.config[tier].model = model;
  }

  setMaxTurns(tier: AgentTier, turns: number): void {
    this.config[tier].maxTurns = turns;
  }

  setTimeoutMs(tier: AgentTier, ms: number): void {
    this.config[tier].timeoutMs = ms;
  }

  getAll(): AgentConfigData {
    return structuredClone(this.config);
  }

  getDefaults(): AgentConfigData {
    return structuredClone(DEFAULT_CONFIG);
  }
}
