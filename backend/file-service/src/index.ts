import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import * as Minio from 'minio';
import { v4 as uuidv4 } from 'uuid';

// ── Config ──────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3003', 10);
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost';
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'sentinel-files';

// ── MinIO Client ────────────────────────────────────────────
const minioClient = new Minio.Client({
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: false,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY,
});

// ── Ensure Bucket Exists ────────────────────────────────────
async function ensureBucket(): Promise<void> {
  const exists = await minioClient.bucketExists(MINIO_BUCKET);
  if (!exists) {
    await minioClient.makeBucket(MINIO_BUCKET, 'us-east-1');
    console.log(`✅ Created bucket: ${MINIO_BUCKET}`);
  }
}

// ── Fastify App ─────────────────────────────────────────────
const app = Fastify({ logger: true });

app.register(cors, { origin: true });
app.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
});

// Health check
app.get('/health', async () => ({ status: 'ok', service: 'file-service' }));

// Upload file
app.post('/upload', async (request, reply) => {
  try {
    const data = await request.file();

    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const fileId = uuidv4();
    const ext = data.filename.split('.').pop() || 'dat';
    const objectName = `${fileId}.${ext}`;

    // Stream file to MinIO
    await minioClient.putObject(MINIO_BUCKET, objectName, data.file, {
      'Content-Type': data.mimetype,
      'X-Original-Name': data.filename,
    });

    const filePath = `${MINIO_BUCKET}/${objectName}`;

    return reply.status(201).send({
      fileId,
      fileName: data.filename,
      filePath,
      objectName,
      bucket: MINIO_BUCKET,
      size: data.file.bytesRead,
    });
  } catch (err: any) {
    app.log.error(err);
    return reply.status(500).send({ error: err.message });
  }
});

// Download file
app.get('/files/:objectName', async (request, reply) => {
  try {
    const { objectName } = request.params as { objectName: string };

    const stat = await minioClient.statObject(MINIO_BUCKET, objectName);
    const stream = await minioClient.getObject(MINIO_BUCKET, objectName);

    reply.header('Content-Type', stat.metaData['content-type'] || 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${objectName}"`);

    return reply.send(stream);
  } catch (err: any) {
    if (err.code === 'NoSuchKey' || err.code === 'NotFound') {
      return reply.status(404).send({ error: 'File not found' });
    }
    return reply.status(500).send({ error: err.message });
  }
});

// List files
app.get('/files', async (request, reply) => {
  try {
    const objects: any[] = [];
    const stream = minioClient.listObjects(MINIO_BUCKET, '', true);

    return new Promise((resolve, reject) => {
      stream.on('data', (obj) => {
        objects.push({
          name: obj.name,
          size: obj.size,
          lastModified: obj.lastModified,
        });
      });
      stream.on('end', () => {
        reply.send(objects);
        resolve(undefined);
      });
      stream.on('error', (err) => {
        reply.status(500).send({ error: err.message });
        resolve(undefined);
      });
    });
  } catch (err: any) {
    return reply.status(500).send({ error: err.message });
  }
});

// Delete file
app.delete('/files/:objectName', async (request, reply) => {
  try {
    const { objectName } = request.params as { objectName: string };
    await minioClient.removeObject(MINIO_BUCKET, objectName);
    return reply.send({ deleted: true, objectName });
  } catch (err: any) {
    return reply.status(500).send({ error: err.message });
  }
});

// ── Start Server ────────────────────────────────────────────
const start = async () => {
  try {
    await ensureBucket();
    console.log('✅ MinIO connected');

    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`📁 File Service running on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
