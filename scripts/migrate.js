#!/usr/bin/env node

/**
 * Database migration runner.
 *
 * Reads SQL files from the migrations/ directory in alphabetical order
 * and applies any that haven't been run yet. Tracks applied migrations
 * in a _migrations table so each file runs exactly once.
 *
 * Usage:
 *   node scripts/migrate.js          # apply pending migrations
 *   node scripts/migrate.js --status # show which migrations have run
 */

const { readdir, readFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { Pool } = require("pg");

const MIGRATIONS_DIR = resolve(__dirname, "..", "migrations");

function createPool() {
  return new Pool({
    host: process.env.PGHOST ?? "localhost",
    port: parseInt(process.env.PGPORT ?? "5432", 10),
    database: process.env.PGDATABASE ?? "spillwatch",
    user: process.env.PGUSER ?? "spillwatch",
    password: process.env.PGPASSWORD ?? "spillwatch",
  });
}

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(pool) {
  const result = await pool.query(
    `SELECT name FROM _migrations ORDER BY name`
  );
  return new Set(result.rows.map((r) => r.name));
}

async function getMigrationFiles() {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function applyMigration(pool, fileName) {
  const filePath = join(MIGRATIONS_DIR, fileName);
  const sql = await readFile(filePath, "utf-8");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      `INSERT INTO _migrations (name) VALUES ($1)`,
      [fileName]
    );
    await client.query("COMMIT");
    console.log(`  applied: ${fileName}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw new Error(`Migration ${fileName} failed: ${err.message}`);
  } finally {
    client.release();
  }
}

async function main() {
  const showStatus = process.argv.includes("--status");
  const pool = createPool();

  try {
    await ensureMigrationsTable(pool);

    const applied = await getAppliedMigrations(pool);
    const files = await getMigrationFiles();

    if (showStatus) {
      console.log("Migration status:");
      for (const f of files) {
        const marker = applied.has(f) ? "[applied]" : "[pending]";
        console.log(`  ${marker} ${f}`);
      }
      return;
    }

    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log("All migrations already applied.");
      return;
    }

    console.log(`Applying ${pending.length} pending migration(s)...`);
    for (const fileName of pending) {
      await applyMigration(pool, fileName);
    }
    console.log("Done.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration error:", err.message);
  process.exit(1);
});
