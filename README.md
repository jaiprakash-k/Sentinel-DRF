# 🛡️ Sentinel DRF — Deterministic Replay Fabric

A production-grade **Deterministic Replay Fabric** system that records every request as an execution log and replays failures deterministically, guaranteeing **recoverability**, **traceability**, and **consistency**.

---

## 🏗️ Architecture

```
Client → Traefik (Reverse Proxy)
            ├── Frontend (React + Vite)
            ├── Replay Engine (Fastify)
            │     ├── File Service (Fastify → MinIO)
            │     ├── Metadata Service (Fastify → PostgreSQL)
            │     └── Redis (Execution Logs + Replay Queue)
```

### Core Concept

Unlike traditional retry-based systems, Sentinel DRF uses a **replay-based approach**:

1. **Execute** flows as ordered steps (file upload → metadata store)
2. **Log** each step's result to Redis
3. On **failure**, queue the flow for deterministic replay
4. **Replay** re-executes only failed steps, preserving successful ones
5. **Idempotency** ensures replays produce consistent results

---

## 🧩 Services

| Service | Port | Description |
|---------|------|-------------|
| **Traefik** | 80, 8080 | Reverse proxy + dashboard |
| **Frontend** | — | React UI (via Traefik) |
| **Replay Engine** | 3001 | Core flow execution & replay |
| **Metadata Service** | 3002 | PostgreSQL CRUD for metadata |
| **File Service** | 3003 | MinIO file upload/download |
| **PostgreSQL** | 5432 | Metadata storage |
| **Redis** | 6379 | Execution logs & replay queue |
| **MinIO** | 9000, 9001 | S3-compatible object storage |

---

## 🚀 Quick Start

### Prerequisites
- Docker 24.x+
- Docker Compose 2.24+

### Run

```bash
chmod +x scripts/run.sh
./scripts/run.sh
```

### Access

| URL | Service |
|-----|---------|
| http://localhost | Frontend UI |
| http://localhost:8080 | Traefik Dashboard |
| http://localhost:9001 | MinIO Console |

### Stop

```bash
./scripts/stop.sh
```

---

## 📡 API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/flows/execute` | Execute a new flow |
| `GET` | `/api/flows` | List all flow logs |
| `GET` | `/api/flows/:flowId` | Get single flow log |
| `POST` | `/api/flows/:flowId/replay` | Replay a failed flow |
| `GET` | `/api/replay/queue` | Get replay queue size |
| `POST` | `/api/replay/process` | Process all queued replays |

---

## 🔹 Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React + Vite + Zustand | 18.3 / 5.x / 4.x |
| Backend | Fastify + TypeScript + Zod | 4.x / 5.x / 3.x |
| Database | PostgreSQL | 15 |
| Cache/Queue | Redis (AOF) | 7.2 |
| Object Storage | MinIO | 2024-01-11 |
| Proxy | Traefik | 2.11 |
| Runtime | Node.js | 20 LTS |
| Containers | Docker + Docker Compose | 24.x / 2.24+ |

---

## 📄 License

MIT
