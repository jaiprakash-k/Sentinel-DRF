import Fastify from 'fastify';
import cors from '@fastify/cors';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { z } from 'zod';

// ── Config ──────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3001', 10);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const METADATA_SERVICE_URL = process.env.METADATA_SERVICE_URL || 'http://localhost:3002';
const FILE_SERVICE_URL = process.env.FILE_SERVICE_URL || 'http://localhost:3003';
const MAX_REPLAY_ATTEMPTS = 3;

// ── Redis Client ────────────────────────────────────────────
const redis = new Redis(REDIS_URL);

// ── Zod Schemas ─────────────────────────────────────────────
const ExecuteFlowSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(''),
});

// ── Types ───────────────────────────────────────────────────
interface StepResult {
  stepName: string;
  status: 'success' | 'failed';
  result?: any;
  error?: string;
  timestamp: string;
}

interface FlowLog {
  flowId: string;
  status: 'running' | 'completed' | 'failed' | 'replaying';
  steps: StepResult[];
  replayCount: number;
  createdAt: string;
  updatedAt: string;
}

// ── Helpers ─────────────────────────────────────────────────
async function saveFlowLog(flowId: string, log: FlowLog): Promise<void> {
  await redis.set(`flow:${flowId}`, JSON.stringify(log));
}

async function getFlowLog(flowId: string): Promise<FlowLog | null> {
  const raw = await redis.get(`flow:${flowId}`);
  return raw ? JSON.parse(raw) : null;
}

async function addToReplayQueue(flowId: string): Promise<void> {
  await redis.lpush('replay_queue', flowId);
}

// ── Step Executors ──────────────────────────────────────────
async function executeUploadStep(flowId: string, fileBuffer: Buffer, fileName: string): Promise<StepResult> {
  const stepName = 'file_upload';
  try {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', fileBuffer, fileName);

    const res = await axios.post(`${FILE_SERVICE_URL}/upload`, form, {
      headers: form.getHeaders(),
      timeout: 10000,
    });

    return {
      stepName,
      status: 'success',
      result: res.data,
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      stepName,
      status: 'failed',
      error: err.message || 'Upload failed',
      timestamp: new Date().toISOString(),
    };
  }
}

async function executeMetadataStep(
  flowId: string,
  title: string,
  description: string,
  filePath: string
): Promise<StepResult> {
  const stepName = 'metadata_store';
  try {
    const res = await axios.post(`${METADATA_SERVICE_URL}/metadata`, {
      flowId,
      title,
      description,
      filePath,
    }, { timeout: 10000 });

    return {
      stepName,
      status: 'success',
      result: res.data,
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      stepName,
      status: 'failed',
      error: err.message || 'Metadata store failed',
      timestamp: new Date().toISOString(),
    };
  }
}

// ── Core Engine ─────────────────────────────────────────────
async function executeFlow(
  flowId: string,
  title: string,
  description: string,
  fileBuffer: Buffer,
  fileName: string
): Promise<FlowLog> {
  const log: FlowLog = {
    flowId,
    status: 'running',
    steps: [],
    replayCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveFlowLog(flowId, log);

  // Step 1: Upload file
  const uploadResult = await executeUploadStep(flowId, fileBuffer, fileName);
  log.steps.push(uploadResult);
  log.updatedAt = new Date().toISOString();
  await saveFlowLog(flowId, log);

  if (uploadResult.status === 'failed') {
    log.status = 'failed';
    await saveFlowLog(flowId, log);
    await addToReplayQueue(flowId);
    return log;
  }

  // Step 2: Store metadata
  const filePath = uploadResult.result?.filePath || '';
  const metadataResult = await executeMetadataStep(flowId, title, description, filePath);
  log.steps.push(metadataResult);
  log.updatedAt = new Date().toISOString();

  if (metadataResult.status === 'failed') {
    log.status = 'failed';
    await saveFlowLog(flowId, log);
    await addToReplayQueue(flowId);
    return log;
  }

  log.status = 'completed';
  await saveFlowLog(flowId, log);
  return log;
}

// ── Replay Logic ────────────────────────────────────────────
async function replayFlow(flowId: string): Promise<FlowLog | null> {
  const log = await getFlowLog(flowId);
  if (!log) return null;

  if (log.replayCount >= MAX_REPLAY_ATTEMPTS) {
    log.status = 'failed';
    log.updatedAt = new Date().toISOString();
    await saveFlowLog(flowId, log);
    return log;
  }

  log.status = 'replaying';
  log.replayCount += 1;
  log.updatedAt = new Date().toISOString();

  // Re-execute only failed steps
  const newSteps: StepResult[] = [];

  for (const step of log.steps) {
    if (step.status === 'success') {
      newSteps.push(step); // Keep successful steps as-is (deterministic)
      continue;
    }

    // Re-execute based on step name
    if (step.stepName === 'metadata_store') {
      const uploadStep = log.steps.find(s => s.stepName === 'file_upload' && s.status === 'success');
      const filePath = uploadStep?.result?.filePath || '';
      // We need the original metadata — stored in the log context
      const metaStep = await executeMetadataStep(
        flowId,
        'Replayed', // title from context
        'Replay attempt',
        filePath
      );
      newSteps.push(metaStep);

      if (metaStep.status === 'failed') {
        log.steps = newSteps;
        log.status = 'failed';
        await saveFlowLog(flowId, log);
        await addToReplayQueue(flowId);
        return log;
      }
    } else {
      // For file upload failures, we can't replay without the original file
      newSteps.push({
        ...step,
        error: `${step.error} (replay skipped — original data not available)`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  log.steps = newSteps;
  const allSuccess = newSteps.every(s => s.status === 'success');
  log.status = allSuccess ? 'completed' : 'failed';
  log.updatedAt = new Date().toISOString();
  await saveFlowLog(flowId, log);

  if (!allSuccess) {
    await addToReplayQueue(flowId);
  }

  return log;
}

// ── Fastify Server ──────────────────────────────────────────
const app = Fastify({ logger: true });

app.register(cors, { origin: true });

// Health check
app.get('/health', async () => ({ status: 'ok', service: 'replay-engine' }));

// Execute a new flow (file upload + metadata)
app.post('/flows/execute', async (request, reply) => {
  try {
    const { title, description } = ExecuteFlowSchema.parse(request.body);
    const flowId = uuidv4();

    // For simplicity, generate a dummy file buffer when no file is attached
    // In production, this would come from the multipart request
    const fileBuffer = Buffer.from(`sentinel-file-${flowId}`);
    const fileName = `file-${flowId}.dat`;

    const log = await executeFlow(flowId, title, description || '', fileBuffer, fileName);

    return reply.status(201).send(log);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: 'Validation error', details: err.errors });
    }
    return reply.status(500).send({ error: err.message });
  }
});

// Get flow log
app.get('/flows/:flowId', async (request, reply) => {
  const { flowId } = request.params as { flowId: string };
  const log = await getFlowLog(flowId);
  if (!log) {
    return reply.status(404).send({ error: 'Flow not found' });
  }
  return reply.send(log);
});

// List all flows
app.get('/flows', async (request, reply) => {
  const keys = await redis.keys('flow:*');
  const flows: FlowLog[] = [];

  for (const key of keys) {
    const raw = await redis.get(key);
    if (raw) {
      flows.push(JSON.parse(raw));
    }
  }

  // Sort by creation date, newest first
  flows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return reply.send(flows);
});

// Trigger replay for a specific flow
app.post('/flows/:flowId/replay', async (request, reply) => {
  const { flowId } = request.params as { flowId: string };
  const result = await replayFlow(flowId);

  if (!result) {
    return reply.status(404).send({ error: 'Flow not found' });
  }

  return reply.send(result);
});

// Process replay queue (manual trigger)
app.post('/replay/process', async (request, reply) => {
  const results: FlowLog[] = [];
  let flowId = await redis.rpop('replay_queue');

  while (flowId) {
    const result = await replayFlow(flowId);
    if (result) results.push(result);
    flowId = await redis.rpop('replay_queue');
  }

  return reply.send({ processed: results.length, results });
});

// Get replay queue size
app.get('/replay/queue', async (request, reply) => {
  const size = await redis.llen('replay_queue');
  return reply.send({ queueSize: size });
});

// ── Start Server ────────────────────────────────────────────
const start = async () => {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`🚀 Replay Engine running on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
