/**
 * Agency service: manages government agency records and computes
 * accountability scorecards.
 *
 * The scorecard logic runs aggregate queries over the incidents table
 * to produce per-agency response metrics: median response time,
 * resolution rate, and ignored-report percentage.
 */

import { randomUUID } from "node:crypto";
import { query } from "../lib/db";
import type {
  Agency,
  AgencyScorecard,
  AgencyTier,
  PaginatedResult,
} from "../types";

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface AgencyRow {
  id: string;
  name: string;
  tier: string;
  jurisdiction: string;
  contact_email: string | null;
  contact_phone: string | null;
  website_url: string | null;
  created_at: Date;
}

function rowToAgency(row: AgencyRow): Agency {
  return {
    id: row.id,
    name: row.name,
    tier: row.tier as AgencyTier,
    jurisdiction: row.jurisdiction,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    websiteUrl: row.website_url,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface CreateAgencyInput {
  name: string;
  tier: AgencyTier;
  jurisdiction: string;
  contactEmail?: string;
  contactPhone?: string;
  websiteUrl?: string;
}

export async function createAgency(input: CreateAgencyInput): Promise<Agency> {
  const id = randomUUID();

  const sql = `
    INSERT INTO agencies (id, name, tier, jurisdiction, contact_email, contact_phone, website_url, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    RETURNING id, name, tier, jurisdiction, contact_email, contact_phone, website_url, created_at
  `;

  const result = await query<AgencyRow>(sql, [
    id,
    input.name,
    input.tier,
    input.jurisdiction,
    input.contactEmail ?? null,
    input.contactPhone ?? null,
    input.websiteUrl ?? null,
  ]);

  console.log(`[agencies] created agency ${id}: ${input.name}`);
  return rowToAgency(result.rows[0]);
}

export async function getAgencyById(id: string): Promise<Agency | null> {
  const sql = `
    SELECT id, name, tier, jurisdiction, contact_email, contact_phone, website_url, created_at
    FROM agencies
    WHERE id = $1
  `;
  const result = await query<AgencyRow>(sql, [id]);
  if (result.rows.length === 0) return null;
  return rowToAgency(result.rows[0]);
}

export async function listAgencies(
  limit = 50,
  offset = 0,
): Promise<PaginatedResult<Agency>> {
  const countResult = await query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM agencies`,
  );
  const total = countResult.rows[0]?.total ?? 0;

  const sql = `
    SELECT id, name, tier, jurisdiction, contact_email, contact_phone, website_url, created_at
    FROM agencies
    ORDER BY name ASC
    LIMIT $1 OFFSET $2
  `;
  const result = await query<AgencyRow>(sql, [limit, offset]);

  return {
    items: result.rows.map(rowToAgency),
    total,
    limit,
    offset,
  };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export interface UpdateAgencyInput {
  name?: string;
  tier?: AgencyTier;
  jurisdiction?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  websiteUrl?: string | null;
}

export async function updateAgency(
  id: string,
  input: UpdateAgencyInput,
): Promise<Agency | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    fields.push(`name = $${idx++}`);
    params.push(input.name);
  }
  if (input.tier !== undefined) {
    fields.push(`tier = $${idx++}`);
    params.push(input.tier);
  }
  if (input.jurisdiction !== undefined) {
    fields.push(`jurisdiction = $${idx++}`);
    params.push(input.jurisdiction);
  }
  if (input.contactEmail !== undefined) {
    fields.push(`contact_email = $${idx++}`);
    params.push(input.contactEmail);
  }
  if (input.contactPhone !== undefined) {
    fields.push(`contact_phone = $${idx++}`);
    params.push(input.contactPhone);
  }
  if (input.websiteUrl !== undefined) {
    fields.push(`website_url = $${idx++}`);
    params.push(input.websiteUrl);
  }

  if (fields.length === 0) return getAgencyById(id);

  params.push(id);
  const sql = `
    UPDATE agencies
    SET ${fields.join(", ")}
    WHERE id = $${idx}
    RETURNING id, name, tier, jurisdiction, contact_email, contact_phone, website_url, created_at
  `;

  const result = await query<AgencyRow>(sql, params);
  if (result.rows.length === 0) return null;

  console.log(`[agencies] updated agency ${id}`);
  return rowToAgency(result.rows[0]);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteAgency(id: string): Promise<boolean> {
  const sql = `DELETE FROM agencies WHERE id = $1`;
  const result = await query(sql, [id]);
  const deleted = (result.rowCount ?? 0) > 0;
  if (deleted) {
    console.log(`[agencies] deleted agency ${id}`);
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// Accountability scorecard
// ---------------------------------------------------------------------------

interface ScorecardRow {
  agency_id: string;
  agency_name: string;
  total_forwarded: number;
  total_acknowledged: number;
  total_resolved: number;
  total_ignored: number;
  median_response_hours: number | null;
}

/**
 * Compute accountability metrics for one agency over a time window.
 *
 * Metrics:
 *   - total_forwarded: incidents sent to this agency
 *   - total_acknowledged: incidents where agency changed status from "forwarded"
 *   - total_resolved: incidents that reached "resolved"
 *   - total_ignored: incidents that sat in "forwarded" for > 30 days with no response
 *   - median_response_hours: median time from forwarded to first agency action
 *   - resolution_rate: total_resolved / total_forwarded
 *   - ignored_rate: total_ignored / total_forwarded
 */
export async function getAgencyScorecard(
  agencyId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<AgencyScorecard | null> {
  const agency = await getAgencyById(agencyId);
  if (!agency) return null;

  const sql = `
    WITH agency_incidents AS (
      SELECT
        i.id,
        i.status,
        i.updated_at,
        -- Find when the incident was forwarded to this agency
        (
          SELECT MIN(t.created_at)
          FROM incident_timeline t
          WHERE t.incident_id = i.id AND t.entry_type = 'forwarded'
        ) AS forwarded_at,
        -- Find first agency response (status change after forwarding)
        (
          SELECT MIN(t.created_at)
          FROM incident_timeline t
          WHERE t.incident_id = i.id
            AND t.entry_type = 'agency_response'
        ) AS first_response_at
      FROM incidents i
      WHERE i.agency_id = $1
        AND i.created_at >= $2
        AND i.created_at <= $3
    ),
    stats AS (
      SELECT
        COUNT(*) AS total_forwarded,
        COUNT(*) FILTER (WHERE first_response_at IS NOT NULL) AS total_acknowledged,
        COUNT(*) FILTER (WHERE status = 'resolved') AS total_resolved,
        COUNT(*) FILTER (
          WHERE first_response_at IS NULL
            AND forwarded_at IS NOT NULL
            AND forwarded_at < NOW() - INTERVAL '30 days'
        ) AS total_ignored
      FROM agency_incidents
    ),
    response_times AS (
      SELECT
        EXTRACT(EPOCH FROM (first_response_at - forwarded_at)) / 3600.0 AS hours
      FROM agency_incidents
      WHERE first_response_at IS NOT NULL AND forwarded_at IS NOT NULL
    ),
    median AS (
      SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hours) AS median_hours
      FROM response_times
    )
    SELECT
      $1::text AS agency_id,
      $4::text AS agency_name,
      COALESCE(s.total_forwarded, 0)::int AS total_forwarded,
      COALESCE(s.total_acknowledged, 0)::int AS total_acknowledged,
      COALESCE(s.total_resolved, 0)::int AS total_resolved,
      COALESCE(s.total_ignored, 0)::int AS total_ignored,
      m.median_hours AS median_response_hours
    FROM stats s
    CROSS JOIN median m
  `;

  const result = await query<ScorecardRow>(sql, [
    agencyId,
    periodStart,
    periodEnd,
    agency.name,
  ]);

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const totalForwarded = row.total_forwarded || 1; // avoid division by zero

  return {
    agencyId: row.agency_id,
    agencyName: row.agency_name,
    totalForwarded: row.total_forwarded,
    totalAcknowledged: row.total_acknowledged,
    totalResolved: row.total_resolved,
    totalIgnored: row.total_ignored,
    medianResponseHours: row.median_response_hours,
    resolutionRate: row.total_resolved / totalForwarded,
    ignoredRate: row.total_ignored / totalForwarded,
    periodStart,
    periodEnd,
  };
}

/**
 * Compute scorecards for all agencies with at least one forwarded incident.
 * Used on the public accountability dashboard.
 */
export async function getAllScorecards(
  periodStart: Date,
  periodEnd: Date,
): Promise<AgencyScorecard[]> {
  // Get all agencies that have at least one incident in the period
  const agencyIdsSql = `
    SELECT DISTINCT agency_id
    FROM incidents
    WHERE agency_id IS NOT NULL
      AND created_at >= $1
      AND created_at <= $2
  `;
  const agencyResult = await query<{ agency_id: string }>(agencyIdsSql, [
    periodStart,
    periodEnd,
  ]);

  const scorecards: AgencyScorecard[] = [];

  // Run scorecard queries in parallel for each agency
  const promises = agencyResult.rows.map((row) =>
    getAgencyScorecard(row.agency_id, periodStart, periodEnd),
  );
  const results = await Promise.all(promises);

  for (const scorecard of results) {
    if (scorecard) scorecards.push(scorecard);
  }

  // Sort by resolution rate ascending (worst performers first for accountability)
  scorecards.sort((a, b) => a.resolutionRate - b.resolutionRate);

  return scorecards;
}
