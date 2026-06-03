/**
 * Single-incident API routes.
 *
 * GET    /api/incidents/[id]  - fetch incident details with timeline
 * PATCH  /api/incidents/[id]  - update incident (status, agency assignment)
 * DELETE /api/incidents/[id]  - remove an incident and unlink its reports
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getIncidentById,
  getIncidentTimeline,
  forwardToAgency,
  updateIncidentStatus,
  deleteIncident,
} from "../../../../services/incidents";
import { ReportStatus } from "../../../../types";
import type {
  ApiResponse,
  Incident,
  IncidentTimelineEntry,
} from "../../../../types";

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

interface IncidentDetail {
  incident: Incident;
  timeline: IncidentTimelineEntry[];
}

// ---------------------------------------------------------------------------
// GET /api/incidents/[id]
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse<ApiResponse<IncidentDetail>>> {
  try {
    const incident = await getIncidentById(params.id);

    if (!incident) {
      return NextResponse.json(
        { ok: false, error: `Incident ${params.id} not found` },
        { status: 404 },
      );
    }

    const timeline = await getIncidentTimeline(params.id);
    return NextResponse.json({
      ok: true,
      data: { incident, timeline },
    });
  } catch (err) {
    console.error("[api/incidents/[id]] GET error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/incidents/[id]
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse<ApiResponse<Incident>>> {
  try {
    const body = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }

    const raw = body as Record<string, unknown>;

    // Forward to agency
    if (raw.agencyId && typeof raw.agencyId === "string") {
      const foiaTrackingNumber =
        typeof raw.foiaTrackingNumber === "string"
          ? raw.foiaTrackingNumber
          : undefined;

      const incident = await forwardToAgency(
        params.id,
        raw.agencyId,
        foiaTrackingNumber,
      );

      if (!incident) {
        return NextResponse.json(
          { ok: false, error: `Incident ${params.id} not found` },
          { status: 404 },
        );
      }

      return NextResponse.json({ ok: true, data: incident });
    }

    // Status update
    if (raw.status && typeof raw.status === "string") {
      const validStatuses = Object.values(ReportStatus);
      if (!validStatuses.includes(raw.status as ReportStatus)) {
        return NextResponse.json(
          {
            ok: false,
            error: `status must be one of: ${validStatuses.join(", ")}`,
          },
          { status: 400 },
        );
      }

      const incident = await updateIncidentStatus(
        params.id,
        raw.status as ReportStatus,
      );

      if (!incident) {
        return NextResponse.json(
          { ok: false, error: `Incident ${params.id} not found` },
          { status: 404 },
        );
      }

      return NextResponse.json({ ok: true, data: incident });
    }

    return NextResponse.json(
      { ok: false, error: "Request must include status or agencyId" },
      { status: 400 },
    );
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON in request body" },
        { status: 400 },
      );
    }

    console.error("[api/incidents/[id]] PATCH error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/incidents/[id]
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse<ApiResponse<{ deleted: boolean }>>> {
  try {
    const deleted = await deleteIncident(params.id);

    if (!deleted) {
      return NextResponse.json(
        { ok: false, error: `Incident ${params.id} not found` },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, data: { deleted: true } });
  } catch (err) {
    console.error("[api/incidents/[id]] DELETE error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
