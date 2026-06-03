/**
 * Summary statistics API route.
 *
 * GET /api/stats  (aggregate counts across reports, incidents, and agencies)
 *
 * Returns total counts plus breakdowns by category, severity, and status.
 * Useful for dashboards and quick overviews.
 */

import { NextResponse } from "next/server";
import { countByCategory, countBySeverity, countByStatus } from "../../../services/reports";
import { query } from "../../../lib/db";
import type { ApiResponse } from "../../../types";

interface StatsResponse {
  reports: {
    total: number;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
    byStatus: Record<string, number>;
  };
  incidents: {
    total: number;
    open: number;
    resolved: number;
  };
  agencies: {
    total: number;
  };
}

export async function GET(): Promise<NextResponse<ApiResponse<StatsResponse>>> {
  try {
    const [
      byCategory,
      bySeverity,
      byStatus,
      reportTotal,
      incidentCounts,
      agencyTotal,
    ] = await Promise.all([
      countByCategory(),
      countBySeverity(),
      countByStatus(),
      query<{ total: number }>("SELECT COUNT(*)::int AS total FROM reports"),
      query<{ total: number; open: number; resolved: number }>(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'ignored'))::int AS open,
          COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved
        FROM incidents
      `),
      query<{ total: number }>("SELECT COUNT(*)::int AS total FROM agencies"),
    ]);

    const stats: StatsResponse = {
      reports: {
        total: reportTotal.rows[0]?.total ?? 0,
        byCategory,
        bySeverity,
        byStatus,
      },
      incidents: {
        total: incidentCounts.rows[0]?.total ?? 0,
        open: incidentCounts.rows[0]?.open ?? 0,
        resolved: incidentCounts.rows[0]?.resolved ?? 0,
      },
      agencies: {
        total: agencyTotal.rows[0]?.total ?? 0,
      },
    };

    return NextResponse.json({ ok: true, data: stats });
  } catch (err) {
    console.error("[api/stats] GET error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
