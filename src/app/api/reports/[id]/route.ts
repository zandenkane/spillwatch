/**
 * Single-report API routes.
 *
 * GET    /api/reports/[id]  - fetch a single report by ID
 * PATCH  /api/reports/[id]  - update report status
 * DELETE /api/reports/[id]  - remove a report
 */

import { NextRequest, NextResponse } from "next/server";
import { getReportById, updateReportStatus, deleteReport } from "../../../../services/reports";
import { ReportStatus } from "../../../../types";
import type { ApiResponse, Report } from "../../../../types";

// ---------------------------------------------------------------------------
// GET /api/reports/[id]
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse<ApiResponse<Report>>> {
  try {
    const report = await getReportById(params.id);

    if (!report) {
      return NextResponse.json(
        { ok: false, error: `Report ${params.id} not found` },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, data: report });
  } catch (err) {
    console.error("[api/reports/[id]] GET error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/reports/[id]
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse<ApiResponse<Report>>> {
  try {
    const body = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }

    const { status } = body as { status?: string };

    const validStatuses = Object.values(ReportStatus);
    if (!status || !validStatuses.includes(status as ReportStatus)) {
      return NextResponse.json(
        {
          ok: false,
          error: `status must be one of: ${validStatuses.join(", ")}`,
        },
        { status: 400 },
      );
    }

    const updated = await updateReportStatus(params.id, status as ReportStatus);

    if (!updated) {
      return NextResponse.json(
        { ok: false, error: `Report ${params.id} not found` },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON in request body" },
        { status: 400 },
      );
    }

    console.error("[api/reports/[id]] PATCH error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/reports/[id]
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse<ApiResponse<{ deleted: boolean }>>> {
  try {
    const deleted = await deleteReport(params.id);

    if (!deleted) {
      return NextResponse.json(
        { ok: false, error: `Report ${params.id} not found` },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, data: { deleted: true } });
  } catch (err) {
    console.error("[api/reports/[id]] DELETE error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
