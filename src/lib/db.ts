/**
 * Database connection pool and query helpers.
 *
 * Uses the `pg` driver directly (no ORM) so PostGIS functions are
 * first-class citizens. Connection params come from environment
 * variables with sane local-dev defaults.
 */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  maxConnections: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
}

function loadConfig(): DbConfig {
  return {
    host: process.env.PGHOST ?? "localhost",
    port: parseInt(process.env.PGPORT ?? "5432", 10),
    database: process.env.PGDATABASE ?? "spillwatch",
    user: process.env.PGUSER ?? "spillwatch",
    password: process.env.PGPASSWORD ?? "spillwatch",
    maxConnections: parseInt(process.env.PG_MAX_CONNECTIONS ?? "20", 10),
    idleTimeoutMs: parseInt(process.env.PG_IDLE_TIMEOUT_MS ?? "30000", 10),
    connectionTimeoutMs: parseInt(process.env.PG_CONN_TIMEOUT_MS ?? "5000", 10),
  };
}

// ---------------------------------------------------------------------------
// Pool singleton
// ---------------------------------------------------------------------------

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const cfg = loadConfig();
    pool = new Pool({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      max: cfg.maxConnections,
      idleTimeoutMillis: cfg.idleTimeoutMs,
      connectionTimeoutMillis: cfg.connectionTimeoutMs,
    });

    pool.on("error", (err) => {
      console.error("[db] unexpected pool error:", err.message);
    });
  }
  return pool;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Run a parameterized query against the pool.
 * Always use parameterized queries to avoid SQL injection.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const result = await getPool().query<T>(text, params);
    const durationMs = Date.now() - start;
    if (durationMs > 500) {
      console.warn(`[db] slow query (${durationMs}ms): ${text.slice(0, 120)}`);
    }
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    console.error(`[db] query error after ${durationMs}ms:`, (err as Error).message);
    throw err;
  }
}

/**
 * Grab a client from the pool for multi-statement transactions.
 *
 * Usage:
 *   const client = await getClient();
 *   try {
 *     await client.query("BEGIN");
 *     // ... work ...
 *     await client.query("COMMIT");
 *   } catch (e) {
 *     await client.query("ROLLBACK");
 *     throw e;
 *   } finally {
 *     client.release();
 *   }
 */
export async function getClient(): Promise<PoolClient> {
  return getPool().connect();
}

/**
 * Convenience wrapper that handles BEGIN/COMMIT/ROLLBACK and client release.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gracefully shut down the pool (for clean server exit).
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
