# 🛡️ Sentinel DRF — Deterministic Replay Fabric

A production-grade **Deterministic Replay Fabric** system that records every request as an execution log and replays failures deterministically, guaranteeing **recoverability**, **traceability**, and **consistency**.

![Sentinel DRF Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

---

## 📖 Table of Contents
1. [Executive Summary](#-executive-summary)
2. [Why Sentinel DRF?](#-why-sentinel-drf)
3. [Architecture Overview](#-architecture-overview)
4. [Services & Components](#-services--components)
5. [Tech Stack](#-tech-stack)
6. [User Interface Design](#-user-interface-design)
7. [System Workflows](#-system-workflows)
8. [Getting Started](#-getting-started)
9. [API Documentation](#-api-documentation)

---

## 🚀 Executive Summary

**Sentinel DRF** is designed to replace traditional, blind retry mechanisms in distributed systems. Instead of simply retrying failed operations without context, Sentinel DRF records every step of an execution pipeline (e.g., File Upload → Metadata Save) persistently. If a step fails, the system enqueues the execution flow. When a replay is triggered, the engine **deterministically re-executes only the failed steps**, preserving the state of the successful ones.

---

## 💡 Why Sentinel DRF?

- **Deterministic Replay over Blind Retries**: Save resources, prevent duplicate side-effects, and maintain strict consistency.
- **Idempotent Architecture**: Guaranteed safety during replays, preventing accidental duplicates in databases or storage.
- **Production-Grade Infrastructure**: Containerized with Docker, highly available storage (MinIO & Postgres), fast state management (Redis), and an efficient proxy layer (Traefik).
- **Handcrafted UI**: Built with an intentional, premium "White/Slate" light theme emphasizing readability, data density, and tactile feedback.

---

## 🏗️ Architecture Overview

The system strictly decouples concerns into independent microservices, coordinated by a central Replay Engine.

```text
Client Application 
       │
       ▼
[ Traefik (Reverse Proxy) ]
       │
       ├─► [ Frontend (React + Vite SPA) ]
       │
       └─► [ Replay Engine (Node + Fastify) ]
                   │
                   ├─► Store Execution State  ──► [ Redis (AOF) ]
                   │
                   ├─► Step 1: Upload File    ──► [ File Service ] ──► [ MinIO (S3) ]
                   │
                   └─► Step 2: Store Metadata ──► [ Metadata Service ] ──► [ PostgreSQL ]
```

### Core Pipeline Concept

1. **Execute**: A user submits a new flow containing metadata and a file payload.
2. **Log**: The Replay Engine creates a Flow ID and logs the initial `running` state to Redis.
3. **Step 1 (File Service)**: The file is uploaded to MinIO. The outcome (Success/Fail) is logged.
4. **Step 2 (Metadata Service)**: The metadata (and file reference) is saved to PostgreSQL. The outcome is logged.
5. **Handle Failure**: If *any* step fails, the pipeline aborts, logs the failure, and drops the Flow ID into a Replay Queue.
6. **Replay**: Upon replay, the engine skips successful steps and deterministically retries the failed ones using the original context payload.

---

## 🧩 Services & Components

The stack is composed of 7 independent Docker containers.

| Service | Port | Description |
|---------|------|-------------|
| **Traefik** | `80`, `8080` | Edge Router providing reverse proxy, load balancing, and API path stripping. Dashboard available at `:8080`. |
| **Frontend** | — | Single Page Application served via Nginx behind Traefik. |
| **Replay Engine** | `3001` | The orchestrator. Exposes the primary API, triggers microservices, writes state to Redis, and processes replays. |
| **Metadata Service**| `3002` | CRUD service for PostgreSQL, utilizing Zod for runtime type safety. Strict idempotent upserts on Flow IDs. |
| **File Service** | `3003` | Wrapper service for MinIO. Handles multipart file uploads and lifecycle management. |
| **PostgreSQL** | `5432` | Relational database (v15) for business metadata storage. |
| **Redis** | `6379` | Fast key-value store (v7.2) with AOF enabled for durable execution log storage and queue management. |
| **MinIO** | `9000`, `9001`| High-performance S3 compatible object storage. Console at `:9001`. |

---

## 🔹 Tech Stack

| Layer | Technologies used | Versions |
|-------|-------------------|----------|
| **Frontend** | React, Vite, Zustand, Vanilla CSS | 18.3, 5.x, 4.x |
| **Backend** | Fastify, TypeScript, Zod, Axios | 4.x, 5.x, 3.x |
| **Databases** | PostgreSQL, Redis (AOF mode) | 15.x, 7.2 |
| **Storage** | MinIO | 2024-01-11 |
| **DevOps** | Docker, Docker Compose, Traefik | 24.x, 2.24+, 2.11 |
| **Environment** | Node.js | 20 LTS |

---

## 🎨 User Interface Design

The frontend recently underwent a **v3.0 Redesign**, moving to a **Handcrafted Light Theme**.

- **White & Slate Palette**: Pure white backgrounds (`#ffffff`) over ultra-light slate canvases (`#f8fafc`). Accents utilize Deep Navy (`#0f172a`).
- **Tactile Inputs**: Custom inputs with focus states, and a drag-and-drop file upload zone that provides visual feedback upon interaction.
- **Natural Depth**: Realized via soft CSS box-shadows simulating physical elevation (no artificial glows/neon).
- **Zustand State**: Snappy, client-side interactions and polling for real-time log updates without heavy UI blocking.
- **Full Multipart Support**: Users can seamlessly interact with their file explorer (via click or drag/drop) to upload authentic payloads.

---

## ⚙️ Getting Started

### Prerequisites
- **Docker** (v24.0.0+)
- **Docker Compose** (v2.24+)

### 1. Launch the Stack
You can start the entire 7-service stack using the provided shell script:

```bash
chmod +x scripts/run.sh
./scripts/run.sh
```
*Note: This will install dependencies, compile TypeScript, build minimal Docker images (multi-stage), and orchestrate them behind Traefik.*

### 2. Access the Applications

| Interface | URL | Credentials (if applicable) |
|-----------|-----|-----------------------------|
| **Web UI** | `http://localhost` | — |
| **Traefik Dashboard**| `http://localhost:8080` | — |
| **MinIO Console** | `http://localhost:9001` | `minioadmin` / `minioadmin` |

### 3. Graceful Shutdown
To tear down the stack and remove containers (data remains persistent in named volumes):
```bash
chmod +x scripts/stop.sh
./scripts/stop.sh
```

*(Optional: To destroy data volumes entirely, run `docker-compose down -v`)*

---

## 📡 API Documentation

All client-facing requests route through Traefik at `http://localhost/api/*`, which proxies them to the Replay Engine (`http://localhost:3001`).

### Flows & Execution

#### `POST /api/flows/execute`
Start a new sequence. Requires `multipart/form-data`.
- **Fields**: 
  - `title` (string, required)
  - `description` (string, optional)
  - `file` (File buffer, required)
- **Returns**: `FlowLog` object (Status 201).

#### `GET /api/flows`
Retrieve all execution logs from the Redis store.
- **Returns**: `FlowLog[]` array, sorted by newest first.

#### `GET /api/flows/:flowId`
Retrieve a single execution log.
- **Returns**: `FlowLog` object.

### Replay Mechanisms

#### `POST /api/flows/:flowId/replay`
Manually trigger a replay for a specific failed flow.
- **Returns**: Updated `FlowLog` object detailing which steps were skipped and which were re-executed.

#### `GET /api/replay/queue`
View the size of the pending replay queue.
- **Returns**: `{ "queueSize": number }`

#### `POST /api/replay/process`
Trigger the backend system to process the entire pending replay queue sequentially.
- **Returns**: `{ "processed": number, "results": FlowLog[] }`

---

## 👨‍💻 Development & Contribution

### Repository Structure
- `backend/replay-engine/` — Orchestration logic, Fastify server.
- `backend/metadata-service/` — PostgreSQL interface, TS schema.
- `backend/file-service/` — MinIO interface.
- `frontend/` — React SPA, Vite configs, CSS design system.
- `docker-compose.yml` — Unified orchestration.

*Sentinel DRF — Designed with intent, built for resilience.*
