import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Pool } from 'pg';
import { z } from 'zod';

// ── Config ──────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3002', 10);
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://sentinel:sentinel_pass@localhost:5432/sentinel_db';

// ── PostgreSQL Pool ─────────────────────────────────────────
const pool = new Pool({ connectionString: DATABASE_URL });

// ── Zod Schemas ─────────────────────────────────────────────
const CreateMetadataSchema = z.object({
  flowId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().default(''),
  filePath: z.string().optional().default(''),
});

const UpdateMetadataSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  filePath: z.string().optional(),
});

// ── Fastify App ─────────────────────────────────────────────
const app = Fastify({ logger: true });

app.register(cors, { origin: true });

// Health check
app.get('/health', async () => ({ status: 'ok', service: 'metadata-service' }));

// Create metadata (idempotent — upsert by flowId)
app.post('/metadata', async (request, reply) => {
  try {
    const data = CreateMetadataSchema.parse(request.body);

    // Idempotent: check if entry already exists for this flowId
    const existing = await pool.query('SELECT id FROM metadata WHERE flow_id = $1', [data.flowId]);

    if (existing.rows.length > 0) {
      // Update existing
      const result = await pool.query(
        `UPDATE metadata SET title = $1, description = $2, file_path = $3, updated_at = NOW()
         WHERE flow_id = $4 RETURNING *`,
        [data.title, data.description, data.filePath, data.flowId]
      );
      return reply.send(result.rows[0]);
    }

    // Insert new
    const result = await pool.query(
      `INSERT INTO metadata (flow_id, title, description, file_path)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [data.flowId, data.title, data.description, data.filePath]
    );

    return reply.status(201).send(result.rows[0]);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: 'Validation error', details: err.errors });
    }
    app.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// Get all metadata
app.get('/metadata', async (request, reply) => {
  const result = await pool.query('SELECT * FROM metadata ORDER BY created_at DESC');
  return reply.send(result.rows);
});

// Get metadata by ID
app.get('/metadata/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const result = await pool.query('SELECT * FROM metadata WHERE id = $1', [id]);

  if (result.rows.length === 0) {
    return reply.status(404).send({ error: 'Metadata not found' });
  }

  return reply.send(result.rows[0]);
});

// Get metadata by flow ID
app.get('/metadata/flow/:flowId', async (request, reply) => {
  const { flowId } = request.params as { flowId: string };
  const result = await pool.query('SELECT * FROM metadata WHERE flow_id = $1', [flowId]);

  if (result.rows.length === 0) {
    return reply.status(404).send({ error: 'Metadata not found for flow' });
  }

  return reply.send(result.rows[0]);
});

// Update metadata by ID
app.put('/metadata/:id', async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const data = UpdateMetadataSchema.parse(request.body);

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.title !== undefined) {
      fields.push(`title = $${idx++}`);
      values.push(data.title);
    }
    if (data.description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(data.description);
    }
    if (data.filePath !== undefined) {
      fields.push(`file_path = $${idx++}`);
      values.push(data.filePath);
    }

    if (fields.length === 0) {
      return reply.status(400).send({ error: 'No fields to update' });
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE metadata SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Metadata not found' });
    }

    return reply.send(result.rows[0]);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: 'Validation error', details: err.errors });
    }
    return reply.status(500).send({ error: err.message });
  }
});

// Delete metadata by ID
app.delete('/metadata/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const result = await pool.query('DELETE FROM metadata WHERE id = $1 RETURNING *', [id]);

  if (result.rows.length === 0) {
    return reply.status(404).send({ error: 'Metadata not found' });
  }

  return reply.send({ deleted: true, record: result.rows[0] });
});

// ── Start Server ────────────────────────────────────────────
const start = async () => {
  try {
    // Test DB connection
    await pool.query('SELECT 1');
    console.log('✅ PostgreSQL connected');

    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`🗄️  Metadata Service running on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
