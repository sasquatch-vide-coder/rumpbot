import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { logger } from "../utils/logger.js";

interface AdminData {
  username: string;
  passwordHash: string;
  mfaSecret: string | null;
  mfaEnabled: boolean;
}

const SALT_ROUNDS = 12;

export class AdminAuth {
  private dataDir: string;
  private jwtSecret: string;
  private admin: AdminData | null = null;

  constructor(dataDir: string, jwtSecret: string) {
    this.dataDir = dataDir;
    this.jwtSecret = jwtSecret;
  }

  private get filePath(): string {
    return join(this.dataDir, "admin.json");
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      this.admin = JSON.parse(raw);
      logger.info("Admin config loaded");
    } catch {
      logger.info("No admin config found — setup required");
    }
  }

  async save(): Promise<void> {
    await mkdir(join(this.filePath, ".."), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.admin, null, 2));
  }

  isSetUp(): boolean {
    return this.admin !== null;
  }

  isMfaEnabled(): boolean {
    return this.admin?.mfaEnabled ?? false;
  }

  async setup(username: string, password: string): Promise<void> {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    this.admin = {
      username,
      passwordHash,
      mfaSecret: null,
      mfaEnabled: false,
    };
    await this.save();
    logger.info({ username }, "Admin account created");
  }

  async verifyPassword(username: string, password: string): Promise<boolean> {
    if (!this.admin) return false;
    if (this.admin.username !== username) return false;
    return bcrypt.compare(password, this.admin.passwordHash);
  }

  setMfaSecret(secret: string): void {
    if (!this.admin) throw new Error("Admin not set up");
    this.admin.mfaSecret = secret;
  }

  getMfaSecret(): string | null {
    return this.admin?.mfaSecret ?? null;
  }

  async enableMfa(): Promise<void> {
    if (!this.admin) throw new Error("Admin not set up");
    if (!this.admin.mfaSecret) throw new Error("MFA secret not set");
    this.admin.mfaEnabled = true;
    await this.save();
    logger.info("MFA enabled");
  }

  async disableMfa(): Promise<void> {
    if (!this.admin) throw new Error("Admin not set up");
    this.admin.mfaSecret = null;
    this.admin.mfaEnabled = false;
    await this.save();
    logger.info("MFA disabled");
  }

  generateToken(stage: "password" | "full"): string {
    return jwt.sign({ stage }, this.jwtSecret, {
      expiresIn: stage === "password" ? "5m" : "24h",
    });
  }

  verifyToken(token: string): { stage: "password" | "full" } | null {
    try {
      return jwt.verify(token, this.jwtSecret) as { stage: "password" | "full" };
    } catch {
      return null;
    }
  }

  async changePassword(newPassword: string): Promise<void> {
    if (!this.admin) throw new Error("Admin not set up");
    this.admin.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.save();
    logger.info("Admin password changed");
  }
}
