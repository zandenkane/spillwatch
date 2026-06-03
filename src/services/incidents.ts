/**
 * Incident service: manages auto-clustered incident groups and their
 * public timelines.
 *
 * When a new report comes in, the clustering logic checks whether it
 * falls within range of existing unresolved incidents or other unclustered
 * reports. If enough corroborating reports exist, a new incident is
 * created (or the report is attached to an existing one).
 */

import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../lib/db";
import { findNearbyReports, assignToIncident } from "./reports";
import type {
  Incident,
  IncidentTimelineEntry,
  ClusteringConfig,
  ReportCategory,
  ReportStatus,
  Report,
  PaginatedResult,
} from "../types";

// ---------------------------------------------------------------------------
// Default clustering settings
// ---------------------------------------------------------------------------

const DEFAULT_CLUSTERING: ClusteringConfig = {
  radiusMeters: 500,
  timeWindowHours: 72,
  minReportsToCluster: 2,
};

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface IncidentRow {
  id: string;
  title: string;
  category: string;
  severity: string;
  status: string;
  centroid_lat: number;
  centroid_lng: number;
  radius_meters: number;
  report_count: number;
  first_reported_at: Date;
  last_reported_at: Date;
  agency_id: string | null;
  foia_tracking_number: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    title: row.title,
    category: row.category as ReportCategory,
    severity: row.severity as Incident["severity"],
    status: row.status as ReportStatus,
    centroid: { latitude: row.centroid_lat, longitude: row.centroid_lng },
    radiusMeters: row.radius_meters,
    reportCount: row.report_count,
    firstReportedAt: row.first_reported_at,
    lastReportedAt: row.last_reported_at,
    agencyId: row.agency_id,
    foiaTrackingNumber: row.foia_tracking_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface TimelineRow {
  id: string;
  incident_id: string;
  entry_type: string;
  content: string;
  actor_label: string;
  created_at: Date;
}

function rowToTimelineEntry(row: TimelineRow): IncidentTimelineEntry {
  return {
    id: row.id,
    incidentId: row.incident_id,
    entryType: row.entry_type as IncidentTimelineEntry["entryType"],
    content: row.content,
    actorLabel: row.actor_label,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Clustering: try to attach a new report to an incident
// ---------------------------------------------------------------------------

/**
 * After a report is created, call this to see if it should be grouped
 * into an existing incident or if a new incident should be formed.
 *
 * Returns the incident ID if clustering occurred, or null if the report
 * stays standalone for now.
 */
export async function clusterReport(
  report: Report,
  config: ClusteringConfig = DEFAULT_CLUSTERING,
): Promise<string | null> {
  // 1. Check if this report is near an existing *open* incident
  const existingIncident = await findNearestOpenIncident(
    report.location.latitude,
    report.location.longitude,
    config.radiusMeters,
    report.category,
  );

  if (existingIncident) {
    await addReportToIncident(existingIncident.id, report);
    return existingIncident.id;
  }

  // 2. Check if there are enough nearby unclustered reports to form
  //    a new incident
  const nearbyReports = await findNearbyReports(
    report.location.latitude,
    report.location.longitude,
    config.radiusMeters,
    config.timeWindowHours,
  );

  // Include the current report in the count
  const candidates = nearbyReports.filter((r) => r.id !== report.id);
  const sameCategoryCount = candidates.filter(
    (r) => r.category === report.category,
  ).length;

  // Need at least minReportsToCluster *other* reports (the original
  // report itself is the +1)
  if (sameCategoryCount + 1 >= config.minReportsToCluster) {
    const reportsToCluster = [
      report,
      ...candidates.filter((r) => r.category === report.category),
    ];
    const incidentId = await createIncidentFromReports(reportsToCluster);
    return incidentId;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Find nearest open incident within radius
// ---------------------------------------------------------------------------

async function findNearestOpenIncident(
  latitude: number,
  longitude: number,
  radiusMeters: number,
  category: ReportCategory,
): Promise<Incident | null> {
  const sql = `
    SELECT
      id, title, category, severity, status,
      ST_Y(centroid::geometry) AS centroid_lat,
      ST_X(centroid::geometry) AS centroid_lng,
      radius_meters, report_count,
      first_reported_at, last_reported_at,
      agency_id, foia_tracking_number,
      created_at, updated_at
    FROM incidents
    WHERE
      category = $3
      AND status NOT IN ('resolved', 'ignored')
      AND ST_DWithin(
        centroid,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
        $4
      )
    ORDER BY ST_Distance(
      centroid,
      ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
    ) ASC
    LIMIT 1
  `;

  const result = await query<IncidentRow>(sql, [
    latitude,
    longitude,
    category,
    radiusMeters,
  ]);

  if (result.rows.length === 0) return null;
  return rowToIncident(result.rows[0]);
}

// ---------------------------------------------------------------------------
// Add a report to an existing incident
// ---------------------------------------------------------------------------

async function addReportToIncident(
  incidentId: string,
  report: Report,
): Promise<void> {
  await withTransaction(async (client) => {
    // Link the report
    await client.query(
      `UPDATE reports SET incident_id = $2, updated_at = NOW() WHERE id = $1`,
      [report.id, incidentId],
    );

    // Update incident stats: bump count, recalculate centroid, extend time range
    await client.query(
      `
      UPDATE incidents SET
        report_count = report_count + 1,
        last_reported_at = GREATEST(last_reported_at, $2),
        severity = CASE
          WHEN $3 = 'critical' THEN 'critical'
          WHEN $3 = 'high' AND severity NOT IN ('critical') THEN 'high'
          WHEN $3 = 'moderate' AND severity NOT IN ('critical','high') THEN 'moderate'
          ELSE severity
        END,
        centroid = (
          SELECT ST_SetSRID(
            ST_Centroid(ST_Collect(location::geometry)),
            4326
          )::geography
          FROM reports WHERE incident_id = $1
        ),
        updated_at = NOW()
      WHERE id = $1
      `,
      [incidentId, report.createdAt, report.severity],
    );

    // Timeline entry
    await client.query(
      `
      INSERT INTO incident_timeline (id, incident_id, entry_type, content, actor_label, created_at)
      VALUES ($1, $2, 'report_added', $3, 'community member', NOW())
      `,
      [
        randomUUID(),
        incidentId,
        `New corroborating report added (${report.category}, ${report.severity} severity)`,
      ],
    );
  });

  console.log(
    `[incidents] attached report ${report.id} to incident ${incidentId}`,
  );
}

// ---------------------------------------------------------------------------
// Create a new incident from a set of reports
// ---------------------------------------------------------------------------

async function createIncidentFromReports(
  reports: Report[],
): Promise<string> {
  const incidentId = randomUUID();

  // Determine highest severity among the reports
  const severityOrder = ["low", "moderate", "high", "critical"];
  const maxSeverity = reports.reduce((acc, r) => {
    const idx = severityOrder.indexOf(r.severity);
    const accIdx = severityOrder.indexOf(acc);
    return idx > accIdx ? r.severity : acc;
  }, reports[0].severity);

  const category = reports[0].category;
  const title = `${category.charAt(0).toUpperCase() + category.slice(1)} incident - ${reports.length} reports`;

  const dates = reports.map((r) => r.createdAt.getTime());
  const firstReported = new Date(Math.min(...dates));
  const lastReported = new Date(Math.max(...dates));

  await withTransaction(async (client) => {
    // Calculate centroid from report locations
    const reportIds = reports.map((r) => r.id);
    const placeholders = reportIds.map((_, i) => `$${i + 1}`).join(",");

    const centroidResult = await client.query(
      `
      SELECT
        ST_Y(ST_Centroid(ST_Collect(location::geometry))) AS lat,
        ST_X(ST_Centroid(ST_Collect(location::geometry))) AS lng,
        ST_MaxDistance(
          ST_Centroid(ST_Collect(location::geometry)),
          ST_Collect(location::geometry)
        ) * 111320 AS radius_m
      FROM reports
      WHERE id IN (${placeholders})
      `,
      reportIds,
    );

    const centroidLat = centroidResult.rows[0].lat;
    const centroidLng = centroidResult.rows[0].lng;
    // Minimum radius of 50m to give some buffer
    const radiusM = Math.max(50, Math.ceil(centroidResult.rows[0].radius_m ?? 50));

    // Insert incident
    await client.query(
      `
      INSERT INTO incidents (
        id, title, category, severity, status,
        centroid, radius_meters, report_count,
        first_reported_at, last_reported_at,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 'pending',
        ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography,
        $7, $8, $9, $10,
        NOW(), NOW()
      )
      `,
      [
        incidentId,
        title,
        category,
        maxSeverity,
        centroidLat,
        centroidLng,
        radiusM,
        reports.length,
        firstReported,
        lastReported,
      ],
    );

    // Link all reports to the incident
    await client.query(
      `UPDATE reports SET incident_id = $1, updated_at = NOW() WHERE id = ANY($2)`,
      [incidentId, reportIds],
    );

    // Initial timeline entry
    await client.query(
      `
      INSERT INTO incident_timeline (id, incident_id, entry_type, content, actor_label, created_at)
      VALUES ($1, $2, 'status_change', $3, 'system', NOW())
      `,
      [
        randomUUID(),
        incidentId,
        `Incident auto-created from ${reports.length} corroborating reports within ${radiusM}m`,
      ],
    );
  });

  console.log(
    `[incidents] created incident ${incidentId} from ${reports.length} reports`,
  );
  return incidentId;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getIncidentById(id: string): Promise<Incident | null> {
  const sql = `
    SELECT
      id, title, category, severity, status,
      ST_Y(centroid::geometry) AS centroid_lat,
      ST_X(centroid::geometry) AS centroid_lng,
      radius_meters, report_count,
      first_reported_at, last_reported_at,
      agency_id, foia_tracking_number,
      created_at, updated_at
    FROM incidents
    WHERE id = $1
  `;

  const result = await query<IncidentRow>(sql, [id]);
  if (result.rows.length === 0) return null;
  return rowToIncident(result.rows[0]);
}

export async function listIncidents(
  limit = 50,
  offset = 0,
  status?: ReportStatus,
): Promise<PaginatedResult<Incident>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (status) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM incidents ${whereClause}`,
    params,
  );
  const total = countResult.rows[0]?.total ?? 0;

  const dataSql = `
    SELECT
      id, title, category, severity, status,
      ST_Y(centroid::geometry) AS centroid_lat,
      ST_X(centroid::geometry) AS centroid_lng,
      radius_meters, report_count,
      first_reported_at, last_reported_at,
      agency_id, foia_tracking_number,
      created_at, updated_at
    FROM incidents
    ${whereClause}
    ORDER BY last_reported_at DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;
  params.push(limit, offset);

  const dataResult = await query<IncidentRow>(dataSql, params);

  return {
    items: dataResult.rows.map(rowToIncident),
    total,
    limit,
    offset,
  };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export async function getIncidentTimeline(
  incidentId: string,
): Promise<IncidentTimelineEntry[]> {
  const sql = `
    SELECT id, incident_id, entry_type, content, actor_label, created_at
    FROM incident_timeline
    WHERE incident_id = $1
    ORDER BY created_at ASC
  `;

  const result = await query<TimelineRow>(sql, [incidentId]);
  return result.rows.map(rowToTimelineEntry);
}

export async function addTimelineEntry(
  incidentId: string,
  entryType: IncidentTimelineEntry["entryType"],
  content: string,
  actorLabel: string,
): Promise<IncidentTimelineEntry> {
  const id = randomUUID();
  const sql = `
    INSERT INTO incident_timeline (id, incident_id, entry_type, content, actor_label, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING id, incident_id, entry_type, content, actor_label, created_at
  `;

  const result = await query<TimelineRow>(sql, [
    id,
    incidentId,
    entryType,
    content,
    actorLabel,
  ]);

  return rowToTimelineEntry(result.rows[0]);
}

// ---------------------------------------------------------------------------
// Update status
// ---------------------------------------------------------------------------

export async function updateIncidentStatus(
  incidentId: string,
  status: ReportStatus,
  actorLabel = "system",
): Promise<Incident | null> {
  const sql = `
    UPDATE incidents
    SET status = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING
      id, title, category, severity, status,
      ST_Y(centroid::geometry) AS centroid_lat,
      ST_X(centroid::geometry) AS centroid_lng,
      radius_meters, report_count,
      first_reported_at, last_reported_at,
      agency_id, foia_tracking_number,
      created_at, updated_at
  `;

  const result = await query<IncidentRow>(sql, [incidentId, status]);
  if (result.rows.length === 0) return null;

  await addTimelineEntry(
    incidentId,
    "status_change",
    `Status changed to "${status}"`,
    actorLabel,
  );

  console.log(`[incidents] updated incident ${incidentId} status to ${status}`);
  return rowToIncident(result.rows[0]);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteIncident(id: string): Promise<boolean> {
  // Unlink reports first so they become unclustered again
  await query(
    `UPDATE reports SET incident_id = NULL, updated_at = NOW() WHERE incident_id = $1`,
    [id],
  );
  const sql = `DELETE FROM incidents WHERE id = $1`;
  const result = await query(sql, [id]);
  const deleted = (result.rowCount ?? 0) > 0;
  if (deleted) {
    console.log(`[incidents] deleted incident ${id}`);
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// Forward to agency
// ---------------------------------------------------------------------------

export async function forwardToAgency(
  incidentId: string,
  agencyId: string,
  foiaTrackingNumber?: string,
): Promise<Incident | null> {
  const sql = `
    UPDATE incidents
    SET
      agency_id = $2,
      foia_tracking_number = $3,
      status = 'forwarded',
      updated_at = NOW()
    WHERE id = $1
    RETURNING
      id, title, category, severity, status,
      ST_Y(centroid::geometry) AS centroid_lat,
      ST_X(centroid::geometry) AS centroid_lng,
      radius_meters, report_count,
      first_reported_at, last_reported_at,
      agency_id, foia_tracking_number,
      created_at, updated_at
  `;

  const result = await query<IncidentRow>(sql, [
    incidentId,
    agencyId,
    foiaTrackingNumber ?? null,
  ]);

  if (result.rows.length === 0) return null;

  // Add timeline entry
  await addTimelineEntry(
    incidentId,
    "forwarded",
    `Incident forwarded to agency${foiaTrackingNumber ? ` (FOIA tracking: ${foiaTrackingNumber})` : ""}`,
    "system",
  );

  console.log(`[incidents] forwarded incident ${incidentId} to agency ${agencyId}`);
  return rowToIncident(result.rows[0]);
}
