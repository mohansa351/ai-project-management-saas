# AI Project Management SaaS

**Status:** Epic 1 foundation in place (Stories 1.1–1.5) · Product features start in Epic 2+

A portfolio-grade, multi-tenant project management platform for software teams. The product is designed as a realistic SaaS—organizations, projects, tasks, Kanban, collaboration, analytics, and secure AI assistance—not a toy todo app.

---

## Project overview

|              |                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| **Product**  | AI Project Management SaaS (fictional demo / portfolio)                                                 |
| **Goal**     | Demonstrate senior full-stack engineering: auth, RBAC, API design, AI boundaries, Docker, tests, and CI |
| **Audience** | Hiring managers and technical reviewers evaluating architecture and delivery discipline                 |
| **Data**     | Planned fictional seed only (e.g. Acme Technologies in Epic 11); no proprietary client artifacts        |

**Reviewer path today:** clone → copy env → install → `docker compose up -d --build` → hit health endpoints. Demo credentials and full walkthrough screenshots land in Epic 11.

---

## Project status

| Area                                         | Status                                                         |
| -------------------------------------------- | -------------------------------------------------------------- |
| Product / UX / Architecture planning         | Complete (private planning artifacts; not published)           |
| Story 1.1 — Monorepo & shared tooling        | Complete                                                       |
| Story 1.2 — Docker Compose baseline          | Complete (postgres, redis, backend, frontend services)         |
| Story 1.3 — Express API skeleton & health    | Complete (`/health`, `/api/v1/health`, envelopes)              |
| Story 1.4 — Next.js app shell & API rewrite  | Complete (branded shell; local `next dev` + rewrite)           |
| Story 1.5 — Env template & bootstrap README  | Complete (this doc + `.env.example`)                           |
| Frontend Compose image                       | Still a placeholder HTTP stub (Next multi-stage cutover later) |
| CI / tests / seed data                       | Planned (Epic 11 polish)                                       |

---

## Prerequisites

- **Node.js** `>=20.11` (see root `package.json` `engines`)
- **Docker** + Docker Compose v2
- Git

This repo does **not** use npm/pnpm workspaces. Install dependencies in three places (root + each app).

---

## Quick start

### 1. Clone and copy environment

```bash
git clone <repo-url>
cd ai-project-management-saas
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` locally as needed. **Never commit `.env`** — only `.env.example` (placeholders) is tracked.

Compose currently **inlines** backend `DATABASE_URL` / `REDIS_URL` / `CORS_ORIGIN` in `docker-compose.yml` and does **not** load the root `.env` via `env_file`. Apps also do **not** auto-load root `.env` yet. Keep the copy step anyway: it gives you a local template for non-Compose runs and future wiring.

Compose DB credentials (also reflected in `.env.example`): user `apm`, password `apm`, database `apm`.

### 2. Install dependencies (triple install)

```bash
npm install
npm install --prefix frontend
npm install --prefix backend
```

### 3. Start the stack

```bash
docker compose up -d --build
```

| Service    | Role                                      | Port |
| ---------- | ----------------------------------------- | ---- |
| `frontend` | Placeholder HTTP (Next cutover deferred)  | 3000 |
| `backend`  | Express API (`/api/v1`, health)           | 4000 |
| `postgres` | PostgreSQL 16                             | 5432 |
| `redis`    | Redis 7                                   | 6379 |

Compose currently **inlines** `DATABASE_URL`, `REDIS_URL`, and `CORS_ORIGIN` for the backend service (no `env_file` yet). `.env.example` remains the contract for local/non-Compose runs and upcoming auth/AI vars.

### 4. Verify health

With the stack up:

- http://localhost:4000/health
- http://localhost:4000/api/v1/health

If a service fails to become ready, check `docker compose logs` for that service.

### Local frontend (optional)

For the branded Next.js shell with `/api/v1` rewrites (server-only `API_URL`, default `http://localhost:4000`):

- The backend must be reachable at `API_URL` or rewrites to `/api/v1` will fail.
- Compose `frontend` already binds `:3000` — stop it (`docker compose stop frontend`) or use another port before `next dev`.
- Set `API_URL` in the shell or in `frontend/.env.local` (Next does **not** read the repo-root `.env`).

```bash
npm run dev --prefix frontend
```

UI: http://localhost:3000

### Stop / reset

```bash
docker compose down
```

To wipe local Postgres data (Compose volume under `docker-data/`):

```bash
docker compose down
rm -rf ./docker-data/postgres
```

PowerShell:

```powershell
docker compose down
Remove-Item -Recurse -Force .\docker-data\postgres
```

---

## Key features (planned)

- **Authentication** — registration, mock email verification, login/logout, JWT access + refresh-cookie sessions, password reset/change
- **Multi-tenant organizations** — org CRUD, invites, member roles
- **Projects & members** — create/manage projects, membership, soft-delete cascade
- **Tasks, labels & search** — CRUD, assignment, status changes, project-scoped labels, filter/pagination
- **Kanban board** — column workflow with optimistic drag-and-drop; mobile-friendly fallback
- **Collaboration** — comments, notifications, org-scoped activity feed
- **Dashboard & analytics** — metrics and charts for org/project health
- **AI assistance** — generate descriptions/subtasks, suggest priority, project summary, project-scoped assistant (human Accept required)
- **Super Admin** — minimal system oversight UI/API
- **Delivery** — OpenAPI/Swagger, Docker Compose, GitHub Actions CI, automated tests, seed data

---

## Architecture & stack

**Paradigm:** layered modular monolith — Next.js UI → Express `/api/v1` → Services → Repositories/Prisma → PostgreSQL; Redis and AI as side dependencies.

| Layer    | Technology                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| Frontend | Next.js (App Router), React 19, TypeScript (strict), Tailwind CSS, shadcn/ui                                   |
| Backend  | Node.js 20+, Express, TypeScript (strict), Prisma, PostgreSQL, Redis, Zod, Pino                                |
| AI       | OpenAI via backend-only provider abstraction (later epic; mock provider for CI)                                |
| Tooling  | ESLint + Prettier at repo root; separate `package.json` per app; **no npm/pnpm workspaces** in v1              |
| DevOps   | Docker Compose, GitHub Actions (planned), Jest/Vitest, Playwright (planned)                                    |

```text
Browser → Next.js (:3000) ──rewrite──► Express /api/v1 (:4000)
                                         ├── PostgreSQL
                                         ├── Redis
                                         └── OpenAI (backend only; later)
```

---

## Repository structure

```text
ai-project-management-saas/
├── frontend/                 # Next.js app shell (own package.json + Dockerfile stub)
├── backend/                  # Express API (own package.json + multi-stage Dockerfile)
├── docs/                     # Public documentation (populated later)
├── scripts/                  # Helper scripts
├── tests/                    # Cross-cutting / E2E test home (populated later)
├── package.json              # Root convenience scripts (no workspaces)
├── tsconfig.base.json        # Shared strict TypeScript base
├── eslint.config.mjs         # Shared ESLint flat config
├── prettier.config.mjs       # Shared Prettier config
├── docker-compose.yml        # postgres, redis, backend, frontend
├── .env.example              # Env contract (placeholders only)
├── .gitignore
└── README.md                 # You are here
```

### Frontend layout

```text
frontend/
├── src/app/                  # App Router routes + authenticated shell stubs
├── src/features/             # Feature modules (grow with later epics)
├── src/components/ui/        # UI primitives (shadcn)
├── src/components/shell/     # Sidebar, topbar, org switcher
├── src/lib/api/              # API client → relative /api/v1
└── next.config.ts            # Server-only API_URL rewrite
```

### Backend layout

```text
backend/
├── prisma/                   # schema, migrations, seed (seed later)
└── src/
    ├── app.ts
    ├── server.ts
    ├── config/env.ts         # Validates DATABASE_URL, REDIS_URL, CORS_ORIGIN, PORT, NODE_ENV
    ├── routes/v1/
    ├── controllers/
    ├── services/
    ├── repositories/
    ├── middleware/
    └── lib/                  # prisma, redis, logger, envelopes
```

Root shared tooling (`tsconfig.base.json`, `eslint.config.mjs`, Prettier) is in place. Prisma lives only under `backend/prisma/`.

---

## Environment variables

See [`.env.example`](.env.example) for the full list. Highlights:

| Variable                         | Purpose                                              |
| -------------------------------- | ---------------------------------------------------- |
| `DATABASE_URL` / `REDIS_URL`     | Postgres + Redis                                     |
| `CORS_ORIGIN`                    | Browser origin allowed by Express                    |
| `API_URL`                        | Next rewrite target (server-only; not `NEXT_PUBLIC_*`) |
| `JWT_*` / token TTLs / `COOKIE_SECURE` | Auth sessions (Epic 2; documented early)      |
| `OPENAI_API_KEY` / `OPENAI_MODEL`| AI provider (Epic 9; documented early)               |
| `PORT` / `NODE_ENV`              | Runtime                                              |

Backend `env.ts` currently validates foundation vars only; JWT/OpenAI/cookie vars are documented for upcoming wiring.

---

## AI capabilities (planned)

All AI calls are **backend-only**, project-authorized, and rate-limited. Suggestions require explicit human Accept before persistence where applicable.

| Capability                | Intent                                                       |
| ------------------------- | ------------------------------------------------------------ |
| Generate task description | Draft description for review                                 |
| Generate subtasks         | Suggest child tasks; persist only on Accept                  |
| Suggest priority          | Recommend task priority                                      |
| Project summary           | Display-only health/summary narrative                        |
| Project AI Assistant      | Project-scoped chat; ephemeral client session (not org-wide) |

**Boundaries:** no OpenAI keys in the frontend; no cross-org/project context leakage; controlled errors without provider stack traces; mock AI provider in CI.

---

## Security & RBAC (planned)

| Concern     | Approach                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Passwords   | bcrypt (cost 12)                                                                                                             |
| Sessions    | Short-lived access JWT + hashed refresh token in PostgreSQL; httpOnly Secure SameSite cookie via Next rewrite proxy          |
| Roles       | `SUPER_ADMIN`, `ORG_ADMIN`, `PROJECT_MANAGER`, `TEAM_MEMBER`                                                                 |
| Tenancy     | ACTIVE org membership required; project access via org admin **or** project membership; `ownerId` is not an authz substitute |
| Super Admin | Limited to `/api/v1/admin/*` — does not bypass project APIs                                                                  |
| Hardening   | Helmet, CORS, Redis-backed rate limits, Zod validation, no secrets in Git                                                    |

---

## Development roadmap

| Epic   | Focus                                                                                          | Status        |
| ------ | ---------------------------------------------------------------------------------------------- | ------------- |
| **1**  | Platform foundation & app shell (tooling, Compose, API skeleton, Next shell, README bootstrap) | Complete      |
| **2**  | Authentication & secure sessions                                                               | Planned       |
| **3**  | Organizations & RBAC                                                                           | Planned       |
| **4**  | Projects & members                                                                             | Planned       |
| **5**  | Tasks, labels & search                                                                         | Planned       |
| **6**  | Kanban board                                                                                   | Planned       |
| **7**  | Collaboration & awareness                                                                      | Planned       |
| **8**  | Dashboard & analytics                                                                          | Planned       |
| **9**  | AI assistance                                                                                  | Planned       |
| **10** | Super Admin oversight                                                                          | Planned       |
| **11** | Portfolio delivery & quality (seed, OpenAPI, CI, tests, README polish)                         | Planned       |

**Next:** Epic 2 — Authentication & secure sessions.

---

## Documentation

| Path           | Purpose                               |
| -------------- | ------------------------------------- |
| `.env.example` | Env contract (placeholders only)      |
| `docs/`        | Public documentation (populated later)|
| This README    | Portfolio entry point & bootstrap     |

Private planning materials (PRD, UX, architecture, epics) are **not** published in this public tree.

---

## License

To be decided when the public GitHub repository is published.
