# Contributing to Blitzkrieg

Thank you for your interest in contributing to Blitzkrieg! We welcome contributions from developers, designers, educators, and typing enthusiasts.

---

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please treat all contributors with respect and professionalism.

---

## Development Prerequisites

Before you begin, ensure you have the following installed:
- **Node.js**: `v22.0.0` or higher
- **npm**: `v10.0.0` or higher
- **Git**: Recent version
- **Docker & Docker Compose** (Optional, for running PostgreSQL/Redis if needed)

---

## Architecture Overview

Blitzkrieg is organized as an npm workspace monorepo:

```
Blitzkrieg/
├── apps/
│   ├── backend/     # Fastify + Socket.IO contest engine, persistence & telemetry
│   └── frontend/    # React 19 + TypeScript + Vite + Tailwind CSS dashboard & typing engine
├── packages/
│   └── shared/      # Shared TypeScript types, schemas, and competition domain models
├── scripts/         # Local development orchestrator (dev.mjs)
└── docker-compose.yml
```

---

## Local Setup

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/ash-ftw/blitzkrieg.git
   cd blitzkrieg
   ```

2. **Install all workspace dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

4. **Start the development environment:**
   ```bash
   npm run dev
   ```
   This concurrent runner launches:
   - **Frontend**: `http://localhost:5173`
   - **Backend**: `http://localhost:4000`

---

## Development Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Launches both backend and frontend concurrently |
| `npm run dev:backend` | Starts only the Fastify backend with hot reload (`tsx watch`) |
| `npm run dev:frontend` | Starts only the Vite development server (`vite --host 0.0.0.0`) |
| `npm run build` | Compiles all packages and applications |
| `npm run typecheck` | Validates TypeScript types across all workspaces |
| `npm run lint` | Runs ESLint across all packages and apps |

---

## Pull Request Guidelines

1. **Create a topic branch:**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. **Commit changes:**
   - Write clear, concise commit messages following conventional commits:
     - `feat: add export to Excel format`
     - `fix: prevent station heartbeat timeout during network switch`
     - `docs: update host guide with firewall configurations`

3. **Verify quality before pushing:**
   ```bash
   npm run typecheck
   npm run lint
   npm run build
   ```

4. **Open a Pull Request:**
   - Reference any relevant issues.
   - Describe the changes, motivation, and verification steps.
   - Include screenshots or terminal logs for UI or significant backend changes.

---

## Submitting Issues

- **Bug Reports**: Please include your OS, Node.js version, browser version, steps to reproduce, expected behavior, and actual error logs.
- **Feature Requests**: Describe the problem you are trying to solve and your proposed solution or workflow.

Thank you for helping make Blitzkrieg the best offline-first competitive typing platform!
