/**
 * Spatial and temporal clustering logic.
 *
 * Groups nearby reports into incidents using configurable radius
 * and time-window parameters. Uses PostGIS ST_DWithin for distance
 * checks and ST_ClusterDBSCAN for batch re-clustering.
 */

import { query, withTransaction } from "./db";
import { findNearbyReports, assignToIncident } from "../services/reports";
import type { ClusteringConfig, Report } from "../types";

// ---------------------------------------------------------------------------
// Default config (overridable via environment)
// ---------------------------------------------------------------------------

export function loadClusteringConfig(): ClusteringConfig {
  return {
    radiusMeters: parseInt(process.env.CLUSTER_RADIUS_METERS ?? "500", 10),
    timeWindowHours: parseInt(process.env.CLUSTER_TIME_WINDOW_HOURS ?? "72", 10),
    minReportsToCluster: parseInt(process.env.CLUSTER_MIN_REPORTS ?? "2", 10),
  };
}

// ---------------------------------------------------------------------------
// Find candidate reports for clustering
// ---------------------------------------------------------------------------

/**
 * Returns unclustered reports that fall within the given radius and
 * time window of the provided coordinates.
 */
export async function findClusterCandidates(
  latitude: number,
  longitude: number,
  config: ClusteringConfig,
): Promise<Report[]> {
  return findNearbyReports(
    latitude,
    longitude,
    config.radiusMeters,
    config.timeWindowHours,
  );
}

// ---------------------------------------------------------------------------
// Batch re-clustering using PostGIS ST_ClusterDBSCAN
// ---------------------------------------------------------------------------

interface ClusterAssignment {
  reportId: string;
  clusterId: number;
}

/**
 * Run DBSCAN clustering over all unclustered reports from the last
 * N hours. Returns cluster assignments (report ID to cluster number).
 *
 * This is useful as a periodic job to catch reports that arrived in
 * an order where pairwise nearest-neighbor clustering missed a group.
 */
export async function runDbscanClustering(
  config: ClusteringConfig,
): Promise<ClusterAssignment[]> {
  const sql = `
    SELECT
      id AS report_id,
      ST_ClusterDBSCAN(
        location::geometry,
        eps := $1 / 111320.0,
        minpoints := $2
      ) OVER () AS cluster_id
    FROM reports
    WHERE incident_id IS NULL
      AND created_at >= NOW() - INTERVAL '1 hour' * $3
    ORDER BY cluster_id NULLS LAST
  `;

  // eps is in degrees; rough conversion: 1 degree latitude ~ 111320 meters
  const result = await query<{ report_id: string; cluster_id: number | null }>(
    sql,
    [config.radiusMeters, config.minReportsToCluster, config.timeWindowHours],
  );

  return result.rows
    .filter((row) => row.cluster_id !== null)
    .map((row) => ({
      reportId: row.report_id,
      clusterId: row.cluster_id as number,
    }));
}

// ---------------------------------------------------------------------------
// Compute centroid for a set of report IDs
// ---------------------------------------------------------------------------

interface CentroidResult {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export async function computeCentroid(
  reportIds: string[],
): Promise<CentroidResult | null> {
  if (reportIds.length === 0) return null;

  const placeholders = reportIds.map((_, i) => `$${i + 1}`).join(",");

  const sql = `
    SELECT
      ST_Y(ST_Centroid(ST_Collect(location::geometry))) AS latitude,
      ST_X(ST_Centroid(ST_Collect(location::geometry))) AS longitude,
      GREATEST(
        50,
        CEIL(
          ST_MaxDistance(
            ST_Centroid(ST_Collect(location::geometry)),
            ST_Collect(location::geometry)
          ) * 111320
        )
      )::int AS radius_meters
    FROM reports
    WHERE id IN (${placeholders})
  `;

  const result = await query<{
    latitude: number;
    longitude: number;
    radius_meters: number;
  }>(sql, reportIds);

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    latitude: row.latitude,
    longitude: row.longitude,
    radiusMeters: row.radius_meters,
  };
}
