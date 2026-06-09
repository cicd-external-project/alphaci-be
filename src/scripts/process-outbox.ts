/**
 * process-outbox.ts
 *
 * Standalone script — not a NestJS application.
 * Run by the Render Cron Job every minute.
 *
 * Reads up to 100 pending rows from platform.outbox_events, publishes each to Kafka,
 * then marks them processed.
 * Uses SELECT FOR UPDATE SKIP LOCKED — safe under concurrent cron runs.
 *
 * Required env vars:
 *   SUPABASE_DB_URL        — direct Postgres connection string (port 5432, not pooler)
 *   KAFKA_BROKERS          — comma-separated broker list, e.g. broker1:9092,broker2:9092
 *   KAFKA_SSL              — 'true' to enable TLS (required for Confluent / Upstash)
 *   KAFKA_SASL_USERNAME    — SASL plain username (optional — omit if no SASL)
 *   KAFKA_SASL_PASSWORD    — SASL plain password (optional)
 */

import { Pool } from 'pg';
import { Kafka, logLevel } from 'kafkajs';

const BATCH_SIZE = 100;

interface OutboxRow {
  id: string;
  topic: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: unknown;
}

async function run(): Promise<void> {
  const dbUrl = process.env['SUPABASE_DB_URL'];
  if (!dbUrl) {
    console.error('[outbox] SUPABASE_DB_URL is not set. Exiting.');
    process.exitCode = 1;
    return;
  }

  const brokers = (process.env['KAFKA_BROKERS'] ?? '')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);

  if (brokers.length === 0) {
    console.error('[outbox] KAFKA_BROKERS is not set. Exiting.');
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({
    connectionString: dbUrl,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  const kafka = new Kafka({
    clientId: 'flowci-outbox-processor',
    brokers,
    logLevel: logLevel.ERROR,
    ssl: process.env['KAFKA_SSL'] === 'true',
    sasl:
      process.env['KAFKA_SASL_USERNAME']
        ? {
            mechanism: 'plain',
            username: process.env['KAFKA_SASL_USERNAME'] ?? '',
            password: process.env['KAFKA_SASL_PASSWORD'] ?? '',
          }
        : undefined,
  });

  const producer = kafka.producer({
    idempotent: true,
  });

  await producer.connect();
  const client = await pool.connect();

  try {
    const { rows } = await client.query<OutboxRow>(
      `
      SELECT id, topic, aggregate_type, aggregate_id, payload
      FROM platform.outbox_events
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
      `,
      [BATCH_SIZE],
    );

    if (rows.length === 0) {
      console.log('[outbox] No pending events.');
      return;
    }

    console.log(`[outbox] Processing ${rows.length} event(s).`);

    for (const row of rows) {
      await producer.send({
        topic: row.topic,
        messages: [
          {
            key: row.aggregate_id,
            value: JSON.stringify({
              aggregateType: row.aggregate_type,
              aggregateId: row.aggregate_id,
              payload: row.payload,
            }),
          },
        ],
      });

      await client.query(
        `UPDATE platform.outbox_events
         SET status = 'published', published_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [row.id],
      );
    }

    console.log(`[outbox] Done — ${rows.length} event(s) forwarded to Kafka.`);
  } catch (error) {
    console.error('[outbox] Fatal error:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await producer.disconnect();
    await pool.end();
  }
}

void run();
