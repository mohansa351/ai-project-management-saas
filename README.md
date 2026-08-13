# AI Project Management SaaS

**Status:** Planning complete · **Development not started**

A portfolio-grade, multi-tenant project management platform for software teams. The product is designed as a realistic SaaS—organizations, projects, tasks, Kanban, collaboration, analytics, and secure AI assistance—not a toy todo app.

This repository currently holds the **public project skeleton** only. Application code, shared tooling, Docker services, and CI are **planned and not implemented yet**.

---

## Project overview

| | |
| --- | --- |
| **Product** | AI Project Management SaaS (fictional demo / portfolio) |
| **Goal** | Demonstrate senior full-stack engineering: auth, RBAC, API design, AI boundaries, Docker, tests, and CI |
| **Audience** | Hiring managers and technical reviewers evaluating architecture and delivery discipline |
| **Data** | Fictional seed data only (e.g. Acme Technologies); no proprietary client artifacts |

**Intended reviewer experience (when implemented):** clone → `docker compose up` → sign in with demo credentials → walk org → project → task → Kanban → AI → dashboard.

---

## Project status

| Area | Status |
| --- | --- |
| Product / UX / Architecture planning | Complete (private planning artifacts; not published) |
| Public repository scaffold | In progress (this commit-era setup) |
| Story 1.1 — Monorepo & shared tooling | Ready for development (not started) |
| Application source (`frontend/`, `backend/`) | Not started |
| Docker Compose services | Planned — placeholder file only |
| CI / tests / seed data | Planned |

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

## Architecture & stack (planned)

**Paradigm:** layered modular monolith — Next.js UI → Express `/api/v1` → Services → Repositories/Prisma → PostgreSQL; Redis and AI as side dependencies.

| Layer | Planned technology |
| --- | --- |
| Frontend | Next.js 15+, React 19+, TypeScript (strict), Tailwind CSS, TanStack Query, Zustand, React Hook Form, Zod, Recharts |
| Backend | Node.js 20+, Express, TypeScript (strict), Prisma, PostgreSQL, Redis, JWT, bcrypt, Zod, OpenAPI/Swagger, Pino |
| AI | OpenAI via backend-only provider abstraction (mock provider for CI) |
| Tooling | ESLint + Prettier at repo root; separate `package.json` per app; **no npm/pnpm workspaces** in v1 |
| DevOps | Docker Compose, GitHub Actions, Jest, Supertest, Playwright (smoke) |

```text
Browser → Next.js (:3000) ──rewrite──► Express /api/v1 (:4000)
                                         ├── PostgreSQL
                                         ├── Redis
                                         └── OpenAI (backend only)
```

---

## Planned repository structure

```text
ai-project-management-saas/
├── frontend/                 # Next.js App Router (own package.json) — empty placeholder
├── backend/                  # Express API + prisma/ (own package.json) — empty placeholder
├── docs/                     # Public documentation (populated later)
├── scripts/                  # Helper scripts (populated later)
├── tests/                    # Cross-cutting / E2E test home (populated later)
├── docker-compose.yml        # Placeholder — services not defined yet
├── .gitignore
└── README.md                 # You are here
```

### Planned frontend layout (not created yet)

```text
frontend/
├── src/app/                  # App Router routes
├── src/features/             # Feature modules
├── src/components/ui/        # UI primitives (e.g. shadcn)
├── src/lib/api/              # API client → /api/v1
└── src/stores/               # Zustand UI/session state
```

### Planned backend layout (not created yet)

```text
backend/
├── prisma/                   # schema, migrations, seed
└── src/
    ├── app.ts
    ├── routes/v1/
    ├── controllers/
    ├── services/
    ├── repositories/
    ├── middleware/
    ├── validators/
    └── lib/                  # prisma, redis, logger, email, ai
```

Root shared tooling (`tsconfig.base.json`, `eslint.config.mjs`, Prettier) will arrive with **Story 1.1**. Prisma lives only under `backend/prisma/`.

---

## AI capabilities (planned)

All AI calls are **backend-only**, project-authorized, and rate-limited. Suggestions require explicit human Accept before persistence where applicable.

| Capability | Intent |
| --- | --- |
| Generate task description | Draft description for review |
| Generate subtasks | Suggest child tasks; persist only on Accept |
| Suggest priority | Recommend task priority |
| Project summary | Display-only health/summary narrative |
| Project AI Assistant | Project-scoped chat; ephemeral client session (not org-wide) |

**Boundaries:** no OpenAI keys in the frontend; no cross-org/project context leakage; controlled errors without provider stack traces; mock AI provider in CI.

---

## Security & RBAC (planned)

| Concern | Approach |
| --- | --- |
| Passwords | bcrypt (cost 12) |
| Sessions | Short-lived access JWT + hashed refresh token in PostgreSQL; httpOnly Secure SameSite cookie via Next rewrite proxy |
| Roles | `SUPER_ADMIN`, `ORG_ADMIN`, `PROJECT_MANAGER`, `TEAM_MEMBER` |
| Tenancy | ACTIVE org membership required; project access via org admin **or** project membership; `ownerId` is not an authz substitute |
| Super Admin | Limited to `/api/v1/admin/*` — does not bypass project APIs |
| Hardening | Helmet, CORS, Redis-backed rate limits, Zod validation, no secrets in Git |

---

## Docker setup

**Status: planned / not implemented.**

`docker-compose.yml` is a **placeholder**. Intended services:

| Service | Role | Planned port |
| --- | --- | --- |
| `frontend` | Next.js UI | 3000 |
| `backend` | Express API | 4000 |
| `postgres` | Primary database | 5432 |
| `redis` | Rate limits, unread counts, optional cache | 6379 |

```bash
# Not ready yet — Story 1.2 will define services
# docker compose up
```

Environment templates (`.env.example`), health checks, and bootstrap docs will land in later Epic 1 stories.

---

## Development roadmap

| Epic | Focus | Status |
| --- | --- | --- |
| **1** | Platform foundation & app shell (tooling, Compose, API skeleton, Next shell, README bootstrap) | Ready to start after GitHub repo is live |
| **2** | Authentication & secure sessions | Planned |
| **3** | Organizations & RBAC | Planned |
| **4** | Projects & members | Planned |
| **5** | Tasks, labels & search | Planned |
| **6** | Kanban board | Planned |
| **7** | Collaboration & awareness | Planned |
| **8** | Dashboard & analytics | Planned |
| **9** | AI assistance | Planned |
| **10** | Super Admin oversight | Planned |
| **11** | Portfolio delivery & quality (seed, OpenAPI, CI, tests, README polish) | Planned |

**Next implementation story (after repo is on GitHub):** Story 1.1 — Monorepo & shared tooling scaffold.

---

## Documentation

| Path | Purpose |
| --- | --- |
| `docs/` | Public documentation directory (empty for now) |
| This README | Portfolio entry point |

Private planning materials (PRD, UX, architecture, epics) are **not** published in this public tree.

---

## License

To be decided when the public GitHub repository is published.

---

*Planning complete. Implementation begins after the GitHub repository is created and this scaffold is confirmed.*
