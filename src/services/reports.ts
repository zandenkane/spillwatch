/**
 * Report service: CRUD operations for environmental incident reports.
 *
 * All spatial work uses PostGIS via raw SQL. Reports store their location
 * as a geography(Point, 4326) column so distance calculations use real
 * meters on the earth's surface, not projected coordinates.
 */

import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { query, withTransaction } from "../lib/db";
import type {
  Report,
  CreateReportInput,
  ReportFilter,
  ReportStatus,
  PaginatedResult,
} from "../types";

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface ReportRow {
  id: string;
  category: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  latitude: number;
  longitude: number;
  address: string | null;
  photo_urls: string[];
  reporter_hash: string;
  incident_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToReport(row: ReportRow): Report {
  return {
    id: row.id,
    category: row.category as Report["category"],
    severity: row.severity as Report["severity"],
    status: row.status as Report["status"],
    title: row.title,
    description: row.description,
    location: { latitude: row.latitude, longitude: row.longitude },
    address: row.address,
    photoUrls: row.photo_urls ?? [],
    reporterHash: row.reporter_hash,
    incidentId: row.incident_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function hashContact(contact: string | undefined): string {
  if (!contact) return "anonymous";
  return createHash("sha256").update(contact.toLowerCase().trim()).digest("hex");
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createReport(input: CreateReportInput): Promise<Report> {
  const id = randomUUID();
  const reporterHash = hashContact(input.reporterContact);
  const photoUrls = input.photoUrls ?? [];

  const sql = `
    INSERT INTO reports (
      id, category, severity, status, title, description,
      location, address, photo_urls, reporter_hash,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, 'pending', $4, $5,
      ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography,
      $8, $9, $10,
      NOW(), NOW()
    )
    RETURNING
      id, category, severity, status, title, description,
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude,
      address, photo_urls, reporter_hash, incident_id,
      created_at, updated_at
  `;

  const params = [
    id,
    input.category,
    input.severity,
    input.title,
    input.description,
    input.latitude,
    input.longitude,
    input.address ?? null,
    photoUrls,
    reporterHash,
  ];

  const result = await query<ReportRow>(sql, params);
  if (result.rows.length === 0) {
    throw new Error("Failed to insert report");
  }

  console.log(`[reports] created report ${id} at (${input.latitude}, ${input.longitude})`);
  return rowToReport(result.rows[0]);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getReportById(id: string): Promise<Report | null> {
  const sql = `
    SELECT
      id, category, severity, status, title, description,
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude,
      address, photo_urls, reporter_hash, incident_id,
      created_at, updated_at
    FROM reports
    WHERE id = $1
  `;

  const result = await query<ReportRow>(sql, [id]);
  if (result.rows.length === 0) return null;
  return rowToReport(result.rows[0]);
}

export async function listReports(
  filter: ReportFilter,
): Promise<PaginatedResult<Report>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filter.category) {
    conditions.push(`category = $${paramIdx++}`);
    params.push(filter.category);
  }

  if (filter.severity) {
    conditions.push(`severity = $${paramIdx++}`);
    params.push(filter.severity);
  }

  if (filter.status) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(filter.status);
  }

  if (filter.since) {
    conditions.push(`created_at >= $${paramIdx++}`);
    params.push(filter.since);
  }

  if (filter.until) {
    conditions.push(`created_at <= $${paramIdx++}`);
    params.push(filter.until);
  }

  if (filter.bounds) {
    // ST_MakeEnvelope(xmin, ymin, xmax, ymax, srid)
    // xmin = sw.longitude, ymin = sw.latitude, xmax = ne.longitude, ymax = ne.latitude
    conditions.push(
      `ST_Intersects(
        location::geometry,
        ST_MakeEnvelope($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, 4326)
      )`,
    );
    params.push(
      filter.bounds.sw.longitude,
      filter.bounds.sw.latitude,
      filter.bounds.ne.longitude,
      filter.bounds.ne.latitude,
    );
    paramIdx += 4;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;

  // count query
  const countSql = `SELECT COUNT(*)::int AS total FROM reports ${whereClause}`;
  const countResult = await query<{ total: number }>(countSql, params);
  const total = countResult.rows[0]?.total ?? 0;

  // data query
  const dataSql = `
    SELECT
      id, category, severity, status, title, description,
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude,
      address, photo_urls, reporter_hash, incident_id,
      created_at, updated_at
    FROM reports
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;
  params.push(limit, offset);

  const dataResult = await query<ReportRow>(dataSql, params);

  return {
    items: dataResult.rows.map(rowToReport),
    total,
    limit,
    offset,
  };
}

// ---------------------------------------------------------------------------
// Update status
// ---------------------------------------------------------------------------

export async function updateReportStatus(
  id: string,
  status: ReportStatus,
): Promise<Report | null> {
  const sql = `
    UPDATE reports
    SET status = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING
      id, category, severity, status, title, description,
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude,
      address, photo_urls, reporter_hash, incident_id,
      created_at, updated_at
  `;

  const result = await query<ReportRow>(sql, [id, status]);
  if (result.rows.length === 0) return null;

  console.log(`[reports] updated report ${id} status to ${status}`);
  return rowToReport(result.rows[0]);
}

// ---------------------------------------------------------------------------
// Assign report to an incident
// ---------------------------------------------------------------------------

export async function assignToIncident(
  reportId: string,
  incidentId: string,
): Promise<void> {
  const sql = `
    UPDATE reports
    SET incident_id = $2, updated_at = NOW()
    WHERE id = $1
  `;
  await query(sql, [reportId, incidentId]);
  console.log(`[reports] assigned report ${reportId} to incident ${incidentId}`);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteReport(id: string): Promise<boolean> {
  const sql = `DELETE FROM reports WHERE id = $1`;
  const result = await query(sql, [id]);
  const deleted = (result.rowCount ?? 0) > 0;
  if (deleted) {
    console.log(`[reports] deleted report ${id}`);
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// Count reports grouped by category
// ---------------------------------------------------------------------------

export async function countByCategory(): Promise<Record<string, number>> {
  const sql = `
    SELECT category, COUNT(*)::int AS count
    FROM reports
    GROUP BY category
    ORDER BY count DESC
  `;
  const result = await query<{ category: string; count: number }>(sql);
  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    counts[row.category] = row.count;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Count reports grouped by severity
// ---------------------------------------------------------------------------

export async function countBySeverity(): Promise<Record<string, number>> {
  const sql = `
    SELECT severity, COUNT(*)::int AS count
    FROM reports
    GROUP BY severity
    ORDER BY count DESC
  `;
  const result = await query<{ severity: string; count: number }>(sql);
  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    counts[row.severity] = row.count;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Count reports grouped by status
// ---------------------------------------------------------------------------

export async function countByStatus(): Promise<Record<string, number>> {
  const sql = `
    SELECT status, COUNT(*)::int AS count
    FROM reports
    GROUP BY status
    ORDER BY count DESC
  `;
  const result = await query<{ status: string; count: number }>(sql);
  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    counts[row.status] = row.count;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Find nearby reports (used by the clustering service)
// ---------------------------------------------------------------------------

export async function findNearbyReports(
  latitude: number,
  longitude: number,
  radiusMeters: number,
  sinceHoursAgo: number,
): Promise<Report[]> {
  const sql = `
    SELECT
      id, category, severity, status, title, description,
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude,
      address, photo_urls, reporter_hash, incident_id,
      created_at, updated_at
    FROM reports
    WHERE
      incident_id IS NULL
      AND ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
        $3
      )
      AND created_at >= NOW() - INTERVAL '1 hour' * $4
    ORDER BY created_at DESC
  `;

  const result = await query<ReportRow>(sql, [
    latitude,
    longitude,
    radiusMeters,
    sinceHoursAgo,
  ]);
  return result.rows.map(rowToReport);
}
