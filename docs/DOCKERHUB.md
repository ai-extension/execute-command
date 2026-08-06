# Command Step Manager (CSM)

CSM is a multi-step command execution and management platform that automates complex operations across multiple servers.

- **Sequential & Parallel Execution** — organize commands into groups and steps with dependency management.
- **Multi-Server Management** — run workflows over SSH or locally.
- **VPN Integration** — connect to private networks (OpenVPN/WireGuard) before running commands.
- **Real-time Orchestration** — follow execution progress and logs from a web dashboard.
- **AI-Powered Automation** — expose workflows to AI agents through the Model Context Protocol (MCP).
- **Safe User Interfaces** — build custom "Pages" so non-technical users can trigger workflows safely.

## Images

| Image | Role |
|-------|------|
| `deeair/execute-command-orchestrator` | API + admin dashboard |
| `deeair/execute-command-agent` | SSH target agent |

## Quick Start

```yaml
version: '3.8'

services:
  db:
    image: postgres:15-alpine
    container_name: csm-db
    restart: always
    environment:
      POSTGRES_USER: ${DB_USER:-csm_user}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-csm_password}
      POSTGRES_DB: ${DB_NAME:-csm_db}
    volumes:
      - csm_db_data:/var/lib/postgresql/data
    networks:
      - csm-network

  orchestrator:
    image: deeair/execute-command-orchestrator:latest
    container_name: csm-orchestrator
    restart: always
    ports:
      - "8080:8080"
    environment:
      DB_HOST: db
      DB_USER: ${DB_USER:-csm_user}
      DB_PASSWORD: ${DB_PASSWORD:-csm_password}
      DB_NAME: ${DB_NAME:-csm_db}
      DB_PORT: 5432
      DB_SSLMODE: disable
      DB_TIMEZONE: UTC
      SERVER_PORT: 8080
      ALLOWED_ORIGIN: http://localhost
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:-admin}
    depends_on:
      - db
    volumes:
      - ./backend/data:/app/data
    networks:
      - csm-network

networks:
  csm-network:
    driver: bridge

volumes:
  csm_db_data:
```

```bash
docker-compose up -d
```

- **Frontend (Admin Dashboard)**: http://localhost:80
- **Backend (API)**: http://localhost:8080

## Default Account

On first start the backend seeds an administrator account:

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `admin` (or the value of `ADMIN_PASSWORD`) |
| Email | `admin@example.com` |

Set a different password before the first run:

```bash
ADMIN_PASSWORD=your-strong-password docker-compose up -d
```

**Warning:** the account is seeded only when no `admin` user exists yet. Changing `ADMIN_PASSWORD` afterwards has no effect — change the password from the dashboard instead. Always replace the default password before exposing CSM outside localhost.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_PORT` | `8080` | API listen port |
| `DB_HOST` / `DB_PORT` | `db` / `5432` | PostgreSQL host and port |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | `csm_user` / `csm_password` / `csm_db` | PostgreSQL credentials |
| `DB_SSLMODE` | `disable` | PostgreSQL SSL mode |
| `ALLOWED_ORIGIN` | `http://localhost` | CORS origin for the dashboard |
| `ADMIN_PASSWORD` | `admin` | Password used when seeding the `admin` user |
| `DATA_ENCRYPTION_KEY` | — | Key used to encrypt stored secrets |

## Source & Documentation

https://github.com/ai-extension/execute-command
