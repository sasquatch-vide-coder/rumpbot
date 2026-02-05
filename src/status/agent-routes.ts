import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { AgentRegistry } from "../agents/agent-registry.js";
import type { RegistryEvent } from "../agents/agent-registry.js";
import { logger } from "../utils/logger.js";

/**
 * Register agent monitoring routes on the Fastify status server.
 *
 * Routes:
 *   GET /api/agents         — JSON snapshot of all agents + recent history
 *   GET /api/agents/stream  — SSE endpoint streaming real-time agent events
 */
export function registerAgentRoutes(
  app: FastifyInstance,
  registry: AgentRegistry,
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
): void {
  // ── REST: current agent snapshot ──
  app.get("/api/agents", { preHandler: requireAuth }, async () => {
    return registry.getSnapshot();
  });

  // ── SSE: real-time agent event stream ──
  app.get("/api/agents/stream", { preHandler: requireAuth }, async (request, reply) => {
    // Set SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // disable Nginx buffering
    });

    // Helper to write an SSE event
    const sendEvent = (event: string, data: unknown) => {
      try {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        // Client may have disconnected
      }
    };

    // Send initial snapshot so the client has current state immediately
    sendEvent("snapshot", registry.getSnapshot());

    // Subscribe to registry changes
    const onChange = (evt: RegistryEvent) => {
      logger.info({ eventType: evt.type, agentId: evt.agent?.id, role: evt.agent?.role }, "SSE: sending agent event to client");
      sendEvent(evt.type, evt);
    };
    registry.on("change", onChange);
    logger.info("SSE: client connected to agent stream");

    // Heartbeat to keep the connection alive (every 30s)
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`:heartbeat\n\n`);
      } catch {
        // Ignore — cleanup will happen on close
      }
    }, 15_000);

    // Cleanup on client disconnect
    const cleanup = () => {
      logger.info("SSE: client disconnected from agent stream");
      registry.off("change", onChange);
      clearInterval(heartbeat);
    };

    request.raw.on("close", cleanup);
    request.raw.on("error", cleanup);

    // The route handler should not resolve the reply — we manage the raw stream
    // Returning the reply object prevents Fastify from trying to send a JSON response
    return reply;
  });
}
