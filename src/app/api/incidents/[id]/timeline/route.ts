/**
 * Incident timeline API routes.
 *
 * GET  /api/incidents/[id]/timeline  - fetch the full public timeline
 * POST /api/incidents/[id]/timeline  - add a timeline entry (agency response, note)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getIncidentById,
  getIncidentTimeline,
  addTimelineEntry,
} from "../../../../../services/incidents";
import type { ApiResponse, IncidentTimelineEntry } from "../../../../../types";

// ---------------------------------------------------------------------------
// GET /api/incidents/[id]/timeline
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse<ApiResponse<IncidentTimelineEntry[]>>> {
  try {
    const incident = await getIncidentById(params.id);

    if (!incident) {
      return NextResponse.json(
        { ok: false, error: `Incident ${params.id} not found` },
        { status: 404 },
      );
    }

    const timeline = await getIncidentTimeline(params.id);
    return NextResponse.json({ ok: true, data: timeline });
  } catch (err) {
    console.error("[api/incidents/[id]/timeline] GET error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/incidents/[id]/timeline
// ---------------------------------------------------------------------------

const VALID_ENTRY_TYPES = [
  "agency_response",
  "status_change",
  "note",
] as const;

type WritableEntryType = (typeof VALID_ENTRY_TYPES)[number];

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse<ApiResponse<IncidentTimelineEntry>>> {
  try {
    const body = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }

    const raw = body as Record<string, unknown>;
    const errors: Record<string, string> = {};

    if (
      typeof raw.entryType !== "string" ||
      !VALID_ENTRY_TYPES.includes(raw.entryType as WritableEntryType)
    ) {
      errors.entryType = `must be one of: ${VALID_ENTRY_TYPES.join(", ")}`;
    }

    if (typeof raw.content !== "string" || raw.content.trim().length === 0) {
      errors.content = "required, non-empty string";
    }

    if (typeof raw.actorLabel !== "string" || raw.actorLabel.trim().length === 0) {
      errors.actorLabel = "required, non-empty string";
    }

    if (Object.keys(errors).length > 0) {
      return NextResponse.json(
        { ok: false, error: "Validation failed", details: errors },
        { status: 400 },
      );
    }

    // Verify the incident exists
    const incident = await getIncidentById(params.id);
    if (!incident) {
      return NextResponse.json(
        { ok: false, error: `Incident ${params.id} not found` },
        { status: 404 },
      );
    }

    const entry = await addTimelineEntry(
      params.id,
      raw.entryType as IncidentTimelineEntry["entryType"],
      (raw.content as string).trim(),
      (raw.actorLabel as string).trim(),
    );

    return NextResponse.json({ ok: true, data: entry }, { status: 201 });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON in request body" },
        { status: 400 },
      );
    }

    console.error("[api/incidents/[id]/timeline] POST error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
