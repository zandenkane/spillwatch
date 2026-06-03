/**
 * Agency metrics API route.
 *
 * GET /api/agencies/[id]/metrics  - fetch accountability scorecard for one agency
 *
 * Query params:
 *   periodStart  - ISO date (default: 1 year ago)
 *   periodEnd    - ISO date (default: now)
 */

import { NextRequest, NextResponse } from "next/server";
import { getAgencyScorecard } from "../../../../../services/agencies";
import type { ApiResponse, AgencyScorecard } from "../../../../../types";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse<ApiResponse<AgencyScorecard>>> {
  try {
    const { searchParams } = new URL(request.url);

    // Default period: last 365 days
    const periodEnd = new Date();
    const periodStart = new Date();
    periodStart.setFullYear(periodStart.getFullYear() - 1);

    const startParam = searchParams.get("periodStart");
    const endParam = searchParams.get("periodEnd");

    if (startParam) {
      const d = new Date(startParam);
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { ok: false, error: "periodStart must be a valid ISO date" },
          { status: 400 },
        );
      }
      periodStart.setTime(d.getTime());
    }

    if (endParam) {
      const d = new Date(endParam);
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { ok: false, error: "periodEnd must be a valid ISO date" },
          { status: 400 },
        );
      }
      periodEnd.setTime(d.getTime());
    }

    const scorecard = await getAgencyScorecard(
      params.id,
      periodStart,
      periodEnd,
    );

    if (!scorecard) {
      return NextResponse.json(
        { ok: false, error: `Agency ${params.id} not found` },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, data: scorecard });
  } catch (err) {
    console.error("[api/agencies/[id]/metrics] GET error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
