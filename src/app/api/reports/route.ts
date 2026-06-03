/**
 * API routes for environmental incident reports.
 *
 * POST /api/reports  (submit a new report)
 * GET  /api/reports  (list/filter reports with spatial queries)
 */

import { NextRequest, NextResponse } from "next/server";
import { createReport, listReports } from "../../../services/reports";
import { clusterReport } from "../../../services/incidents";
import { validateCreateReport, parseReportFilter, ValidationError } from "../../../lib/validation";
import type { ApiResponse, Report, PaginatedResult } from "../../../types";

// ---------------------------------------------------------------------------
// POST /api/reports
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiResponse<Report>>> {
  try {
    const body = await request.json();
    const input = validateCreateReport(body);
    const report = await createReport(input);

    // Fire-and-forget: attempt to cluster the report with nearby ones.
    // We do not block the response on clustering because it can involve
    // multiple queries. If clustering fails, the report still exists.
    clusterReport(report).catch((err) => {
      console.error("[api/reports] clustering failed for report", report.id, err);
    });

    return NextResponse.json({ ok: true, data: report }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json(
        { ok: false, error: err.message, details: err.fields },
        { status: 400 },
      );
    }

    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON in request body" },
        { status: 400 },
      );
    }

    console.error("[api/reports] POST error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/reports
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
): Promise<NextResponse<ApiResponse<PaginatedResult<Report>>>> {
  try {
    const { searchParams } = new URL(request.url);
    const filter = parseReportFilter(searchParams);
    const result = await listReports(filter);

    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json(
        { ok: false, error: err.message, details: err.fields },
        { status: 400 },
      );
    }

    console.error("[api/reports] GET error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
