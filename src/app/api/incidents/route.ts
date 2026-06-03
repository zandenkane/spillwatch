/**
 * API routes for incidents (auto-clustered report groups).
 *
 * GET  /api/incidents            (list all incidents)
 * GET  /api/incidents?id=<uuid>  (get single incident with timeline)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getIncidentById,
  listIncidents,
  getIncidentTimeline,
  forwardToAgency,
} from "../../../services/incidents";
import { listReports } from "../../../services/reports";
import type {
  ApiResponse,
  Incident,
  IncidentTimelineEntry,
  PaginatedResult,
  ReportStatus,
} from "../../../types";

// ---------------------------------------------------------------------------
// Types for the detail response
// ---------------------------------------------------------------------------

interface IncidentDetail {
  incident: Incident;
  timeline: IncidentTimelineEntry[];
}

// ---------------------------------------------------------------------------
// GET /api/incidents
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
): Promise<NextResponse<ApiResponse<IncidentDetail | PaginatedResult<Incident>>>> {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    // Single incident detail view
    if (id) {
      const incident = await getIncidentById(id);
      if (!incident) {
        return NextResponse.json(
          { ok: false, error: `Incident ${id} not found` },
          { status: 404 },
        );
      }

      const timeline = await getIncidentTimeline(id);
      const detail: IncidentDetail = { incident, timeline };

      return NextResponse.json({ ok: true, data: detail });
    }

    // List view
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);
    const offset = parseInt(searchParams.get("offset") ?? "0", 10);
    const status = searchParams.get("status") as ReportStatus | null;

    if (isNaN(limit) || limit < 1 || limit > 500) {
      return NextResponse.json(
        { ok: false, error: "limit must be 1-500" },
        { status: 400 },
      );
    }

    if (isNaN(offset) || offset < 0) {
      return NextResponse.json(
        { ok: false, error: "offset must be >= 0" },
        { status: 400 },
      );
    }

    const result = await listIncidents(limit, offset, status ?? undefined);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    console.error("[api/incidents] GET error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/incidents (forward to agency)
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiResponse<Incident>>> {
  try {
    const body = await request.json();
    const { incidentId, agencyId, foiaTrackingNumber } = body as {
      incidentId?: string;
      agencyId?: string;
      foiaTrackingNumber?: string;
    };

    if (!incidentId || typeof incidentId !== "string") {
      return NextResponse.json(
        { ok: false, error: "incidentId is required" },
        { status: 400 },
      );
    }

    if (!agencyId || typeof agencyId !== "string") {
      return NextResponse.json(
        { ok: false, error: "agencyId is required" },
        { status: 400 },
      );
    }

    const incident = await forwardToAgency(
      incidentId,
      agencyId,
      foiaTrackingNumber,
    );

    if (!incident) {
      return NextResponse.json(
        { ok: false, error: `Incident ${incidentId} not found` },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, data: incident });
  } catch (err) {
    console.error("[api/incidents] POST error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
