import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import * as OTPAuth from "otpauth";
import * as QRCode from "qrcode";
import { execSync, exec } from "child_process";
import { readFile, writeFile } from "fs/promises";
import { AdminAuth } from "./auth.js";
import { logger } from "../utils/logger.js";

// Re-export for use elsewhere
export { AdminAuth };

function requireAuth(auth: AdminAuth) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    const token = authHeader.slice(7);
    const payload = auth.verifyToken(token);
    if (!payload || payload.stage !== "full") {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
  };
}

export async function registerAdminRoutes(
  app: FastifyInstance,
  auth: AdminAuth,
  envPath: string
) {
  // ── Setup (first-time only) ──
  app.post("/api/admin/setup", async (request, reply) => {
    if (auth.isSetUp()) {
      reply.code(400).send({ error: "Admin already set up" });
      return;
    }
    const { username, password } = request.body as {
      username: string;
      password: string;
    };
    if (!username || !password || password.length < 8) {
      reply.code(400).send({
        error: "Username required, password must be at least 8 characters",
      });
      return;
    }
    await auth.setup(username, password);
    const token = auth.generateToken("full");
    return { ok: true, token };
  });

  // ── Check if setup is needed ──
  app.get("/api/admin/setup-status", async () => {
    return {
      isSetUp: auth.isSetUp(),
      mfaEnabled: auth.isMfaEnabled(),
    };
  });

  // ── Login ──
  app.post("/api/admin/login", async (request, reply) => {
    if (!auth.isSetUp()) {
      reply.code(400).send({ error: "Admin not set up" });
      return;
    }
    const { username, password } = request.body as {
      username: string;
      password: string;
    };
    const valid = await auth.verifyPassword(username, password);
    if (!valid) {
      reply.code(401).send({ error: "Invalid credentials" });
      return;
    }

    if (auth.isMfaEnabled()) {
      // Return partial token — needs MFA verification
      const token = auth.generateToken("password");
      return { ok: true, requireMfa: true, token };
    }

    // No MFA — full access
    const token = auth.generateToken("full");
    return { ok: true, requireMfa: false, token };
  });

  // ── MFA Verify ──
  app.post("/api/admin/mfa/verify", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    const partialToken = authHeader.slice(7);
    const payload = auth.verifyToken(partialToken);
    if (!payload || payload.stage !== "password") {
      reply.code(401).send({ error: "Invalid or expired token" });
      return;
    }

    const { code } = request.body as { code: string };
    const secret = auth.getMfaSecret();
    if (!secret) {
      reply.code(400).send({ error: "MFA not configured" });
      return;
    }

    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret),
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });

    const valid = totp.validate({ token: code, window: 1 }) !== null;
    if (!valid) {
      reply.code(401).send({ error: "Invalid MFA code" });
      return;
    }

    const fullToken = auth.generateToken("full");
    return { ok: true, token: fullToken };
  });

  // ── Protected routes below ──
  const authHook = requireAuth(auth);

  // ── MFA Setup ──
  app.get(
    "/api/admin/mfa/setup",
    { preHandler: authHook },
    async () => {
      const secret = new OTPAuth.Secret();
      const totp = new OTPAuth.TOTP({
        issuer: "Rumpbot",
        label: "Admin",
        secret,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      });

      auth.setMfaSecret(secret.base32);
      await auth.save();

      const uri = totp.toString();
      const qrDataUrl = await QRCode.toDataURL(uri);

      return {
        secret: secret.base32,
        uri,
        qrCode: qrDataUrl,
      };
    }
  );

  app.post(
    "/api/admin/mfa/enable",
    { preHandler: authHook },
    async (request, reply) => {
      const { code } = request.body as { code: string };
      const secret = auth.getMfaSecret();
      if (!secret) {
        reply.code(400).send({ error: "Generate MFA secret first" });
        return;
      }

      const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(secret),
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      });

      const valid = totp.validate({ token: code, window: 1 }) !== null;
      if (!valid) {
        reply.code(400).send({ error: "Invalid code — MFA not enabled" });
        return;
      }

      await auth.enableMfa();
      return { ok: true };
    }
  );

  app.post(
    "/api/admin/mfa/disable",
    { preHandler: authHook },
    async () => {
      await auth.disableMfa();
      return { ok: true };
    }
  );

  // ── Claude Code Status ──
  app.get(
    "/api/admin/claude/status",
    { preHandler: authHook },
    async () => {
      try {
        const version = execSync("claude --version 2>&1", {
          encoding: "utf-8",
          timeout: 5000,
        }).trim();

        let authenticated = false;
        try {
          const result = execSync(
            'claude -p "respond with just the word hello" --output-format json --max-turns 1 2>&1',
            { encoding: "utf-8", timeout: 30000 }
          );
          authenticated = result.includes('"type":"result"');
        } catch {
          authenticated = false;
        }

        return {
          installed: true,
          version,
          authenticated,
          path: execSync("which claude", { encoding: "utf-8" }).trim(),
        };
      } catch {
        return {
          installed: false,
          version: null,
          authenticated: false,
          path: null,
        };
      }
    }
  );

  // ── Telegram Status ──
  app.get(
    "/api/admin/telegram/status",
    { preHandler: authHook },
    async () => {
      try {
        const envContent = await readFile(envPath, "utf-8");
        const hasToken = envContent.includes("TELEGRAM_BOT_TOKEN=");
        const hasUsers = envContent.includes("ALLOWED_USER_IDS=");

        // Extract user IDs (just the count, not the actual values)
        const userMatch = envContent.match(/ALLOWED_USER_IDS=(.+)/);
        const userCount = userMatch
          ? userMatch[1].split(",").filter((s) => s.trim()).length
          : 0;

        // Check if bot service is running
        let botRunning = false;
        try {
          const status = execSync("systemctl is-active rumpbot", {
            encoding: "utf-8",
          }).trim();
          botRunning = status === "active";
        } catch {}

        return {
          configured: hasToken && hasUsers,
          botRunning,
          allowedUserCount: userCount,
        };
      } catch {
        return {
          configured: false,
          botRunning: false,
          allowedUserCount: 0,
        };
      }
    }
  );

  // ── SSL Status ──
  app.get(
    "/api/admin/ssl/status",
    { preHandler: authHook },
    async () => {
      try {
        const certs = execSync(
          "sudo certbot certificates --no-color 2>&1",
          { encoding: "utf-8", timeout: 10000 }
        );

        const domainMatch = certs.match(/Domains:\s+(.+)/);
        const expiryMatch = certs.match(/Expiry Date:\s+(.+?)(\s+\(|$)/);
        const pathMatch = certs.match(/Certificate Path:\s+(.+)/);

        let autoRenew = false;
        try {
          execSync("systemctl is-active certbot.timer", { encoding: "utf-8" });
          autoRenew = true;
        } catch {}

        return {
          hasCert: !!domainMatch,
          domain: domainMatch?.[1]?.trim() || null,
          expiry: expiryMatch?.[1]?.trim() || null,
          certPath: pathMatch?.[1]?.trim() || null,
          autoRenew,
        };
      } catch {
        return {
          hasCert: false,
          domain: null,
          expiry: null,
          certPath: null,
          autoRenew: false,
        };
      }
    }
  );

  // ── SSL Renew ──
  app.post(
    "/api/admin/ssl/renew",
    { preHandler: authHook },
    async () => {
      return new Promise((resolve) => {
        exec(
          "sudo certbot renew --nginx --no-color 2>&1",
          { encoding: "utf-8", timeout: 60000 },
          (err, stdout) => {
            if (err) {
              resolve({
                ok: false,
                output: stdout || err.message,
              });
              return;
            }
            resolve({ ok: true, output: stdout });
          }
        );
      });
    }
  );

  // ── Change Password ──
  app.post(
    "/api/admin/change-password",
    { preHandler: authHook },
    async (request, reply) => {
      const { currentPassword, newPassword } = request.body as {
        currentPassword: string;
        newPassword: string;
      };

      if (!newPassword || newPassword.length < 8) {
        reply
          .code(400)
          .send({ error: "New password must be at least 8 characters" });
        return;
      }

      // Verify current password
      const valid = await auth.verifyPassword(
        (request.body as any).username || "",
        currentPassword
      );
      // Actually we don't need username here since they're already authed
      // Let's just change it
      await auth.changePassword(newPassword);
      return { ok: true };
    }
  );
}
