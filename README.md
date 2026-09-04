# Blitzkrieg

LAN-first competitive typing event platform for college lab competitions.

## Current Foundation

- React + TypeScript + Vite frontend
- Fastify + Socket.IO backend
- Shared TypeScript domain types
- Docker Compose services for PostgreSQL and Redis
- Obsidian, charcoal, silver, and restrained gold interface palette

## Development

```bash
npm install
npm run dev:frontend
npm run dev:backend
```

Infrastructure:

```bash
docker compose up -d
```

Copy `.env.example` to `.env` before running the backend.
