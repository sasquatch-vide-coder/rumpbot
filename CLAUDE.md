# Rumpbot

Personal Telegram bot that bridges messages to Claude Code CLI.

## Tech Stack
- TypeScript ES modules, Node.js
- grammY for Telegram
- Claude Code CLI spawned via child_process
- JSON file persistence in data/
- Fastify status/dashboard server (React + Vite + Tailwind)

## Commands
- `npm run dev` - Run with tsx (development)
- `npm run build` - Compile TypeScript
- `npm start` - Run compiled JS (production)
- `npm run build:client` - Build status page frontend

## Architecture
Telegram messages → grammY bot (always running) → `claude -p` spawned per message → response sent back.
Sessions are resumed via `--resume <sessionId>` for conversation continuity.

### Status Page
- **Server**: Fastify on port 3069 (`src/status/server.ts`), started alongside the bot
- **Client**: React + Vite + Tailwind in `status/client/`
- **Style**: Neo Brutalist design
- **Proxy**: Nginx reverse proxy on ports 80/443 with Let's Encrypt SSL
- **Domain**: `rumpbot.sasquatchvc.com`
- **API Endpoints**:
  - `GET /api/status` - Service health, system info, sessions, projects
  - `GET /api/logs` - Recent journalctl logs
  - `GET /api/health` - Health check
- **Invocation logging**: Claude CLI results logged to `data/invocations.json` for historical metrics

## Deployment (VPS)
- **Host**: `ubuntu@129.146.23.173`
- **SSH**: `ssh -i "ssh/ssh-key-2026-02-04.key" ubuntu@129.146.23.173`
- **App path**: `/home/ubuntu/rumpbot`
- **Service**: `sudo systemctl {start|stop|restart|status} rumpbot`
- **Logs**: `sudo journalctl -u rumpbot -f`

## GitHub
- **Repo**: https://github.com/sasquatch-vide-coder/rumpbot
- **PAT**: Stored in `.env` as `GITHUB_PAT`

### Deploy steps
```bash
# From local machine (D:\Coding\rumpbot):
scp -i "ssh/ssh-key-2026-02-04.key" -r src/ package.json package-lock.json tsconfig.json rumpbot.service CLAUDE.md .env.example ubuntu@129.146.23.173:/home/ubuntu/rumpbot/

# On VPS:
cd /home/ubuntu/rumpbot && npm install && npm run build
cd status/client && npm install && npm run build
sudo cp rumpbot.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl restart rumpbot
```
