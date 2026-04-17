# 🛡️ Sentinel DRF — Deterministic Replay Fabric

> A production-grade distributed systems engine that records every execution step, detects failures precisely, and replays only what failed — preserving all prior successful state.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-20_LTS-brightgreen.svg)
![Docker](https://img.shields.io/badge/docker-24.x-blue.svg)

---

## 📖 Table of Contents

1. [Executive Summary](#-executive-summary)
2. [The Problem It Solves](#-the-problem-it-solves)
3. [Core Concepts](#-core-concepts)
4. [Architecture Overview](#-architecture-overview)
5. [Services & Components](#-services--components)
6. [Tech Stack](#-tech-stack)
7. [Execution Pipeline](#-execution-pipeline)
8. [Replay Engine — Deep Dive](#-replay-engine--deep-dive)
9. [Data Flow & State Management](#-data-flow--state-management)
10. [Idempotency & Consistency Guarantees](#-idempotency--consistency-guarantees)
11. [User Interface Design](#-user-interface-design)
12. [API Reference](#-api-reference)
13. [Getting Started](#-getting-started)
14. [Configuration](#-configuration)
15. [Project Structure](#-project-structure)

---

## 🚀 Executive Summary

**Sentinel DRF (Deterministic Replay Fabric)** is a distributed workflow orchestration system designed to eliminate the most painful failure mode in microservice architectures: the **partial failure** — where a multi-step workflow succeeds halfway and leaves the system in an ambiguous, inconsistent state.

Traditional retry logic is blind. When a pipeline fails at Step 3 of 5, a blind retry re-executes all five steps, risking duplicate writes, duplicate charges, or inconsistent state. Sentinel DRF solves this by treating every execution as an **append-only log of discrete, versioned steps**. On failure, it re-executes only the failed step(s), using the exact same input payload, in the exact same order — deterministically.

The result is a system where:
- **No step is ever executed twice** if it already succeeded.
- **Every failure is recoverable** without manual intervention.
- **Every execution is auditable** — you can inspect the full log of any flow at any time.
- **Production incidents become replay events**, not rollbacks or manual data fixes.

---

## 💡 The Problem It Solves

### The Partial Failure Problem

Consider a common two-step workflow: upload a file, then save its metadata to a database.

```
Step 1: Upload file to object storage   → SUCCESS ✅
Step 2: Save metadata to PostgreSQL     → FAILURE ❌ (DB timeout)
```

**What does a traditional system do?**

- **Option A — Blind retry**: Re-run the whole flow. Step 1 uploads a duplicate file. Your storage is now inconsistent.
- **Option B — Rollback**: Delete the successfully uploaded file. You lose the work, and the rollback itself can fail.
- **Option C — Ignore**: The pipeline aborts and an engineer manually cleans up at 2am.

**What Sentinel DRF does:**

It logs the result of Step 1 immediately after it completes. When Step 2 fails, the flow is added to a **Replay Queue**. On replay, the engine reads the log, sees that Step 1 already succeeded, skips it entirely, and only re-executes Step 2 with the original payload. No duplicate file. No data loss. Full consistency restored.

### Why "Deterministic"?

The word "deterministic" is deliberate. For a replay to be safe, two properties must hold:

1. **Same input, same effect**: Every step is idempotent — running it twice with the same payload produces the same result as running it once.
2. **Known execution order**: Steps always execute in a fixed, declared sequence. There is no non-determinism in which step runs when.

Together, these guarantees mean that a replay is not a "best effort retry" — it is a **mathematically safe re-execution** that will always converge to a consistent final state.

---

## 🧠 Core Concepts

### Flow

A **Flow** is a single end-to-end execution instance. It is identified by a unique `flowId` (UUID) and carries a structured payload containing the user's input data (title, description, file reference). A flow moves through a defined lifecycle:

```
PENDING → RUNNING → COMPLETED
                 └→ FAILED → [Replay Queue] → RUNNING → COMPLETED
```

### Execution Log

Every state transition within a flow is recorded as an immutable entry in Redis. This log contains:
- The `flowId` and the step name (`file_upload`, `metadata_save`)
- The step's input payload (the exact data it was called with)
- The step's output or error
- A `status` field: `success`, `failed`, or `skipped`
- A timestamp

This log is the source of truth for replay decisions.

### Step

A **Step** is a single atomic unit of work within a flow. Steps are defined in sequence inside the Replay Engine. Each step:
- Has a unique name within its flow
- Receives the flow's original payload as input
- Returns a result that may be passed to subsequent steps
- Writes its outcome to the execution log before the next step begins

### Replay

A **Replay** is a re-execution of a flow, driven by its execution log. The replay engine iterates through the declared steps in order. For each step, it consults the log:
- If the step is logged as `success` → **skip it**, use the previously recorded output
- If the step is logged as `failed` or is missing → **execute it**

### Replay Queue

When any step in a flow fails, the `flowId` is pushed to a Redis list acting as a FIFO queue. Replays can be triggered either manually via the API or batch-processed automatically.

---

## 🏗️ Architecture Overview

Sentinel DRF is composed of **7 independent Docker containers** coordinated behind a Traefik edge proxy. Concerns are strictly separated: the frontend never talks directly to storage, and the Replay Engine is the sole orchestrator of business logic.

```
┌─────────────────────────────────────────────────────────────────┐
│                          Client (Browser)                       │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP :80
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│              Traefik Edge Proxy  (:80 / :8080 dashboard)        │
│          Path-based routing · Strip /api prefix · LB            │
└──────────────┬──────────────────────────────┬───────────────────┘
               │ /                            │ /api/*
               ▼                              ▼
┌──────────────────────┐       ┌──────────────────────────────────┐
│   Frontend SPA       │       │     Replay Engine  (:3001)       │
│   React + Vite       │       │     Fastify + TypeScript         │
│   Served via Nginx   │       │     Core orchestration logic     │
└──────────────────────┘       └─────────────┬────────────────────┘
                                             │
               ┌─────────────────────────────┼──────────────────────┐
               │                             │                      │
               ▼                             ▼                      ▼
┌──────────────────────┐   ┌─────────────────────────┐   ┌──────────────────────┐
│   Redis  (:6379)     │   │   File Service (:3003)  │   │ Metadata Svc (:3002) │
│   AOF persistence    │   │   Fastify + TypeScript  │   │ Fastify + TypeScript │
│   Execution logs     │   │   MinIO wrapper         │   │ PostgreSQL wrapper   │
│   Replay queue       │   └────────────┬────────────┘   └────────────┬─────────┘
└──────────────────────┘                │                             │
                                        ▼                             ▼
                             ┌───────────────────────┐   ┌──────────────────────┐
                             │   MinIO  (:9000/9001) │   │  PostgreSQL (:5432)  │
                             │   S3-compatible store │   │  Relational metadata │
                             │   File objects        │   │  Flow records        │
                             └───────────────────────┘   └──────────────────────┘
```

### Key Design Decisions

**Why Traefik as the edge proxy?**
Traefik provides automatic service discovery via Docker labels, a built-in dashboard, and zero-config path stripping. It ensures the frontend and API share a single origin (`localhost:80`), eliminating CORS complexity entirely.

**Why Redis for execution logs instead of PostgreSQL?**
Redis with AOF (Append-Only File) persistence gives sub-millisecond reads and writes for the hot path — step status checks during replay. A flow replay must read every prior step's status before deciding whether to re-execute, so this path is extremely latency-sensitive. PostgreSQL holds the business data; Redis holds the orchestration state.

**Why separate File Service and Metadata Service?**
Each microservice owns exactly one storage backend. This separation means the File Service can be swapped for a different object store (e.g. AWS S3) without touching the Metadata Service, and vice versa. It also means each service can be scaled independently.

---

## 🧩 Services & Components

### Traefik (Port 80 / 8080)

The entry point for all traffic. Configured via Docker labels on each service container. Responsibilities:
- Routes `/` to the Frontend container
- Routes `/api/*` to the Replay Engine, stripping the `/api` prefix before forwarding
- Provides a web dashboard at `:8080` for live routing inspection
- Handles load balancing if services are scaled horizontally

### Frontend SPA (served via Nginx behind Traefik)

A single-page application built with React 18 and Vite. It communicates exclusively with the Replay Engine API via `fetch`. State is managed locally with Zustand. Features:
- Flow submission form with drag-and-drop file upload
- Real-time polling of execution logs
- Flow list view with status indicators (running, completed, failed)
- Per-flow detail view showing step-level log entries
- Manual replay trigger button per failed flow

### Replay Engine (Port 3001)

The central orchestrator. This is where all business logic lives. It:
- Accepts `multipart/form-data` submissions and creates a new `flowId`
- Writes the initial flow state to Redis
- Sequentially invokes the File Service and Metadata Service
- After each step, writes the result (success/fail + payload) to the Redis log
- On failure, pushes the `flowId` to the replay queue
- On replay, reads the log and deterministically skips or re-executes each step
- Exposes the full REST API consumed by the frontend

### Metadata Service (Port 3002)

A thin CRUD layer over PostgreSQL. Uses Zod for runtime schema validation on all inputs. All write operations use **upsert semantics** keyed on `flowId`, making every call safe to retry. This is the idempotency guarantee at the storage layer — even if the Replay Engine sends the same metadata twice (e.g. due to an edge case), the database state remains consistent.

### File Service (Port 3003)

A wrapper around the MinIO SDK. Handles multipart file streaming from the Replay Engine to MinIO object storage. Returns a structured response containing the bucket name, object key, and file size. Also provides lifecycle management endpoints for deleting objects associated with a flow.

### PostgreSQL (Port 5432)

Stores durable business metadata: the human-readable title, description, and a reference to the stored file (bucket + object key). Runs PostgreSQL 15 with a named Docker volume for data persistence across container restarts.

### Redis (Port 6379)

Stores ephemeral-but-durable orchestration state: execution logs (as Redis Hashes or JSON strings keyed by `flowId:stepName`) and the replay queue (as a Redis List). AOF persistence is enabled, meaning every write is fsynced to disk — Redis can be restarted without losing any execution log data.

### MinIO (Port 9000 / 9001)

S3-compatible object storage for binary file data. The console is available at `:9001`. Files are stored in a dedicated bucket created on first run. Each stored object is keyed by `flowId/originalFilename` to guarantee uniqueness and traceability.

---

## 🔹 Tech Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Frontend framework | React | 18.3 | Component-based UI |
| Frontend build tool | Vite | 5.x | Fast HMR, optimised builds |
| Frontend state | Zustand | 4.x | Lightweight client state |
| Backend framework | Fastify | 4.x | High-performance HTTP server |
| Backend language | TypeScript | 5.x | Type safety across services |
| Schema validation | Zod | 3.x | Runtime type checking |
| HTTP client | Axios | 1.x | Inter-service calls |
| Primary database | PostgreSQL | 15 | Relational metadata storage |
| State / queue store | Redis (AOF) | 7.2 | Execution logs, replay queue |
| Object storage | MinIO | 2024-01-11 | Binary file storage (S3-compatible) |
| Container runtime | Docker | 24.x | Service isolation |
| Orchestration | Docker Compose | 2.24+ | Multi-container lifecycle |
| Edge proxy | Traefik | 2.11 | Routing, path stripping, LB |
| Runtime | Node.js | 20 LTS | JavaScript runtime for all backend services |

---

## ⚙️ Execution Pipeline

This is the complete lifecycle of a single flow from submission to completion or failure.

### Happy Path (no failures)

```
1. Client sends POST /api/flows/execute
   └─ multipart/form-data: { title, description, file }

2. Replay Engine receives request
   ├─ Generates flowId (UUID v4)
   ├─ Writes Redis key: flow:{flowId} = { status: "running", steps: {} }
   └─ Begins step execution

3. Step 1 — File Upload
   ├─ Replay Engine calls File Service: POST /internal/upload
   ├─ File Service streams file to MinIO bucket
   ├─ File Service returns: { bucket, objectKey, size }
   └─ Replay Engine writes: flow:{flowId}:step:file_upload = { status: "success", result: {...} }

4. Step 2 — Metadata Save
   ├─ Replay Engine calls Metadata Service: POST /internal/metadata
   ├─ Metadata Service upserts record in PostgreSQL (keyed on flowId)
   ├─ Metadata Service returns: { id, flowId, title, objectKey }
   └─ Replay Engine writes: flow:{flowId}:step:metadata_save = { status: "success", result: {...} }

5. Replay Engine marks flow complete
   └─ Writes: flow:{flowId}:status = "completed"

6. Returns 201 with complete FlowLog to client
```

### Failure Path (Step 2 fails)

```
1–3. (Same as above — Step 1 succeeds, its result is logged)

4. Step 2 — Metadata Save FAILS
   ├─ Metadata Service returns 500 (e.g. DB connection timeout)
   ├─ Replay Engine writes: flow:{flowId}:step:metadata_save = { status: "failed", error: "..." }
   ├─ Replay Engine marks flow: flow:{flowId}:status = "failed"
   └─ Replay Engine pushes flowId to Redis List: replay_queue

5. Returns 500 with partial FlowLog to client (step 1 shows success, step 2 shows failure)
```

### Replay Path

```
1. Replay triggered via POST /api/flows/{flowId}/replay
   (or batch: POST /api/replay/process)

2. Replay Engine loads execution log from Redis for this flowId

3. Step 1 — File Upload (evaluation)
   ├─ Engine reads: flow:{flowId}:step:file_upload → status: "success"
   └─ SKIP — uses previously logged result as if step just ran

4. Step 2 — Metadata Save (re-execution)
   ├─ Engine reads: flow:{flowId}:step:metadata_save → status: "failed"
   ├─ EXECUTE — calls Metadata Service with original payload
   ├─ Metadata Service upserts into PostgreSQL (idempotent — flowId key ensures no duplicate row)
   └─ Replay Engine writes updated log entry: status: "success"

5. Replay Engine marks flow complete
   └─ Writes: flow:{flowId}:status = "completed"

6. Returns updated FlowLog — step 1 shows "skipped", step 2 shows "success"
```

---

## 🔄 Replay Engine — Deep Dive

The Replay Engine is the most critical component. Here is how its internal logic works in detail.

### Step Registry

Steps are declared as an ordered array inside the engine. Each step definition contains:
- `name`: a unique string identifier (used as the Redis log key)
- `execute(payload, context)`: an async function that performs the work and returns a result

```typescript
const steps: Step[] = [
  {
    name: 'file_upload',
    execute: async (payload) => {
      const result = await fileServiceClient.upload(payload.file);
      return result; // { bucket, objectKey, size }
    }
  },
  {
    name: 'metadata_save',
    execute: async (payload, context) => {
      const result = await metadataServiceClient.save({
        flowId: payload.flowId,
        title: payload.title,
        description: payload.description,
        objectKey: context.file_upload.objectKey // result from prior step
      });
      return result;
    }
  }
];
```

### Execution Loop

Both first-run execution and replay go through the same loop. The only difference is what the `getStepStatus()` function returns.

```typescript
async function runFlow(flowId: string, payload: FlowPayload, isReplay: boolean) {
  const context: Record<string, unknown> = {};

  for (const step of steps) {
    const logged = await redis.getStepLog(flowId, step.name);

    if (isReplay && logged?.status === 'success') {
      // Step already succeeded — skip it, restore its result into context
      context[step.name] = logged.result;
      await redis.markStep(flowId, step.name, 'skipped', logged.result);
      continue;
    }

    try {
      const result = await step.execute(payload, context);
      context[step.name] = result;
      await redis.markStep(flowId, step.name, 'success', result);
    } catch (err) {
      await redis.markStep(flowId, step.name, 'failed', null, err.message);
      await redis.markFlow(flowId, 'failed');
      await redis.enqueueReplay(flowId);
      throw err;
    }
  }

  await redis.markFlow(flowId, 'completed');
}
```

This loop is the heart of the system. Notice that the replay path is not a separate code branch — it is the same loop, with the `isReplay` flag changing how the step-status check is evaluated. This keeps the logic unified and easy to reason about.

---

## 💾 Data Flow & State Management

### Redis Data Model

All execution state is stored in Redis under a consistent key schema:

| Key pattern | Type | Contents |
|---|---|---|
| `flow:{flowId}` | Hash | `status`, `createdAt`, `updatedAt`, `payload` (JSON) |
| `flow:{flowId}:step:{stepName}` | Hash | `status`, `result` (JSON), `error`, `executedAt` |
| `replay_queue` | List | FIFO list of `flowId` strings awaiting replay |

### PostgreSQL Schema

The Metadata Service owns one table:

```sql
CREATE TABLE flow_metadata (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id     UUID UNIQUE NOT NULL,   -- idempotency key
  title       VARCHAR(255) NOT NULL,
  description TEXT,
  bucket      VARCHAR(255) NOT NULL,
  object_key  VARCHAR(500) NOT NULL,
  file_size   BIGINT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

The `UNIQUE` constraint on `flow_id` combined with `INSERT ... ON CONFLICT DO UPDATE` (upsert) is what makes the metadata step safe to replay — a second execution with the same `flow_id` will update the row rather than creating a duplicate.

### MinIO Object Naming

Files are stored using a deterministic key:

```
{flowId}/{originalFilename}
```

This means:
- Every file is uniquely addressable by its flow
- Re-uploading the same flow's file overwrites the same object key (idempotent)
- Files can be looked up or deleted given only the `flowId`

---

## 🔒 Idempotency & Consistency Guarantees

Sentinel DRF provides three layers of idempotency protection:

**Layer 1 — Engine layer (Redis log check)**
Before executing any step during a replay, the engine reads the execution log. A step logged as `success` is never re-executed. This is the primary guard.

**Layer 2 — Storage layer (PostgreSQL upsert)**
Even if Layer 1 fails (e.g. a Redis log entry is corrupted), the Metadata Service uses `ON CONFLICT DO UPDATE` keyed on `flowId`. A duplicate metadata write updates the existing row rather than inserting a new one.

**Layer 3 — Object storage layer (deterministic key)**
MinIO uses `flowId/filename` as the object key. A duplicate file upload from the File Service overwrites the same object. No orphaned duplicate objects accumulate in storage.

The combination of these three layers means that replaying a flow any number of times always converges to exactly one file in MinIO and exactly one metadata row in PostgreSQL.

---

## 🎨 User Interface Design

The frontend uses a **v3.0 Handcrafted Light Theme** — a deliberate design language built around readability and data density.

### Design Tokens

| Token | Value | Usage |
|---|---|---|
| Background primary | `#ffffff` | Card and panel backgrounds |
| Background canvas | `#f8fafc` | Page-level background |
| Accent | `#0f172a` | Headings, primary text |
| Border | `#e2e8f0` | Dividers, input outlines |
| Success | `#16a34a` | Step success indicators |
| Failure | `#dc2626` | Step failure indicators |
| Skipped | `#9ca3af` | Replayed-and-skipped steps |

### Key UI Components

**Flow Submission Form**
A clean form with a drag-and-drop zone. Accepts any file type. On drag-over, the zone highlights with a dashed border and a visual cue. Zustand tracks upload progress and submission state.

**Flow Log Table**
A real-time polling table (1s interval) showing all flows sorted by newest first. Each row shows `flowId` (truncated), title, current status (badge), step count, and a replay button for failed flows.

**Step Detail View**
Clicking any flow opens a side panel showing each step as a timeline row: step name, status badge (`success` / `failed` / `skipped`), execution timestamp, and the raw result/error payload in a collapsed code block.

**Replay Queue Indicator**
A persistent counter in the header showing the current number of flows in the replay queue. Updates in real time.

---

## 📡 API Reference

All endpoints are accessed through Traefik at `http://localhost/api/*`, which proxies to the Replay Engine on port 3001.

---

### Flows

#### `POST /api/flows/execute`

Submit a new flow for execution.

**Content-Type:** `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` | Yes | Human-readable label for this flow |
| `description` | `string` | No | Optional description |
| `file` | `File` | Yes | Binary file payload to upload |

**Response `201 Created`:**
```json
{
  "flowId": "a1b2c3d4-...",
  "status": "completed",
  "steps": {
    "file_upload": {
      "status": "success",
      "result": { "bucket": "sentinel", "objectKey": "a1b2c3d4-/report.pdf", "size": 204800 },
      "executedAt": "2024-08-15T10:23:01.456Z"
    },
    "metadata_save": {
      "status": "success",
      "result": { "id": "uuid", "flowId": "a1b2c3d4-...", "title": "Q3 Report" },
      "executedAt": "2024-08-15T10:23:01.789Z"
    }
  },
  "createdAt": "2024-08-15T10:23:01.100Z"
}
```

**Response `500 Internal Server Error`** (partial failure):
Same shape as above, but `status` is `"failed"` and the failing step has `"status": "failed"` with an `"error"` field.

---

#### `GET /api/flows`

Retrieve all execution logs, sorted newest-first.

**Response `200 OK`:** Array of `FlowLog` objects (same shape as above).

---

#### `GET /api/flows/:flowId`

Retrieve a single flow's execution log by ID.

**Response `200 OK`:** Single `FlowLog` object.

**Response `404 Not Found`:** `{ "error": "Flow not found" }`

---

### Replay

#### `POST /api/flows/:flowId/replay`

Manually trigger a replay for a specific flow. Safe to call on flows that are not failed — the engine will skip all steps that are already logged as successful.

**Response `200 OK`:** Updated `FlowLog` object. Skipped steps will have `"status": "skipped"`.

---

#### `GET /api/replay/queue`

Inspect the number of flows currently waiting in the replay queue.

**Response `200 OK`:**
```json
{ "queueSize": 3 }
```

---

#### `POST /api/replay/process`

Trigger batch processing of the entire replay queue. Flows are processed sequentially (FIFO). Safe to call repeatedly — already-empty queues return `{ "processed": 0 }`.

**Response `200 OK`:**
```json
{
  "processed": 3,
  "results": [ /* array of updated FlowLog objects */ ]
}
```

---

## ⚡ Getting Started

### Prerequisites

| Tool | Minimum version |
|---|---|
| Docker | 24.0.0 |
| Docker Compose | 2.24.0 |

No other dependencies are required on the host machine. Node.js, TypeScript compilation, and all service dependencies are handled inside the Docker build process using multi-stage builds.

---

### Step 1 — Clone the repository

```bash
git clone https://github.com/your-username/sentinel-drf.git
cd sentinel-drf
```

### Step 2 — Launch the full stack

```bash
chmod +x scripts/run.sh
./scripts/run.sh
```

This script performs the following steps automatically:
1. Installs `npm` dependencies for all three backend services and the frontend
2. Compiles TypeScript for all backend services
3. Builds minimal Docker images using multi-stage builds (final images contain only compiled JS + production node_modules)
4. Starts all 7 containers via Docker Compose
5. Waits for all health checks to pass before returning

Total startup time on a warm machine: approximately 20–40 seconds.

### Step 3 — Access the services

| Interface | URL | Notes |
|---|---|---|
| Web UI | `http://localhost` | Main application |
| Traefik Dashboard | `http://localhost:8080` | Live routing and health status |
| MinIO Console | `http://localhost:9001` | Credentials: `minioadmin` / `minioadmin` |

### Step 4 — Verify all containers are running

```bash
docker compose ps
```

All 7 services should show `running (healthy)` status: `traefik`, `frontend`, `replay-engine`, `metadata-service`, `file-service`, `postgres`, `redis`, `minio`.

### Step 5 — Graceful shutdown

To stop all containers while preserving data volumes:
```bash
chmod +x scripts/stop.sh
./scripts/stop.sh
```

To stop and **destroy all data** (volumes included):
```bash
docker compose down -v
```

> ⚠️ `docker compose down -v` is irreversible — it deletes the PostgreSQL database, all Redis logs, and all MinIO stored files.

---

## 🔧 Configuration

Service configuration is managed through environment variables in `docker-compose.yml`. Key variables:

| Variable | Service | Default | Description |
|---|---|---|---|
| `REDIS_URL` | replay-engine | `redis://redis:6379` | Redis connection string |
| `FILE_SERVICE_URL` | replay-engine | `http://file-service:3003` | Internal File Service URL |
| `METADATA_SERVICE_URL` | replay-engine | `http://metadata-service:3002` | Internal Metadata Service URL |
| `DATABASE_URL` | metadata-service | `postgresql://...` | PostgreSQL connection string |
| `MINIO_ENDPOINT` | file-service | `minio` | MinIO hostname (Docker internal) |
| `MINIO_PORT` | file-service | `9000` | MinIO port |
| `MINIO_ACCESS_KEY` | file-service | `minioadmin` | MinIO access key |
| `MINIO_SECRET_KEY` | file-service | `minioadmin` | MinIO secret key |
| `MINIO_BUCKET` | file-service | `sentinel` | Default bucket name |

---

## 📁 Project Structure

```
sentinel-drf/
│
├── docker-compose.yml              # Unified 7-service orchestration
├── scripts/
│   ├── run.sh                      # Full build + launch script
│   └── stop.sh                     # Graceful shutdown script
│
├── backend/
│   ├── replay-engine/              # Core orchestrator (Fastify + TypeScript)
│   │   ├── src/
│   │   │   ├── routes/             # HTTP route handlers
│   │   │   ├── steps/              # Step definitions (file_upload, metadata_save)
│   │   │   ├── engine/             # Core replay loop logic
│   │   │   ├── redis/              # Redis client + log helpers
│   │   │   └── server.ts           # Fastify server entry point
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── metadata-service/           # PostgreSQL interface (Fastify + TypeScript)
│   │   ├── src/
│   │   │   ├── routes/             # CRUD endpoints
│   │   │   ├── db/                 # PostgreSQL client + schema
│   │   │   ├── schemas/            # Zod validation schemas
│   │   │   └── server.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── file-service/               # MinIO interface (Fastify + TypeScript)
│       ├── src/
│       │   ├── routes/             # Upload + lifecycle endpoints
│       │   ├── minio/              # MinIO SDK client wrapper
│       │   └── server.ts
│       ├── Dockerfile
│       └── package.json
│
└── frontend/                       # React SPA (Vite)
    ├── src/
    │   ├── components/             # FlowForm, FlowTable, StepDetail, etc.
    │   ├── store/                  # Zustand state slices
    │   ├── api/                    # Typed fetch wrappers
    │   └── main.tsx
    ├── nginx.conf                  # Nginx config for SPA serving
    ├── Dockerfile
    └── package.json
```

---

*Sentinel DRF — Designed with intent, built for resilience.*

*Failures are not exceptional events. They are expected events. The question is whether your system is built to recover from them deterministically.*
