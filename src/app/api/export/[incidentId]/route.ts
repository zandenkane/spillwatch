/**
 * Evidence export API route.
 *
 * GET /api/export/[incidentId]  - generate a JSON evidence packet for an incident
 *
 * Returns all data needed to produce a formal complaint:
 * reports, timeline, incident metadata, and agency scorecard.
 * A separate client-side or server-side renderer can consume this payload
 * to produce PDFs or other formatted output.
 */

import { NextRequest, NextResponse } from "next/server";
import { getIncidentById, getIncidentTimeline } from "../../../../services/incidents";
import { getAgencyScorecard } from "../../../../services/agencies";
import { query } from "../../../../lib/db";
import type {
  ApiResponse,
  EvidencePacket,
  Report,
} from "../../../../types";

// ---------------------------------------------------------------------------
// Row mapping (same shape as reports service, duplicated here to avoid
// coupling the export route to internal service types)
// ---------------------------------------------------------------------------

interface ReportRow {
  id: string;
  category: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  latitude: number;
  longitude: number;
  address: string | null;
  photo_urls: string[];
  reporter_hash: string;
  incident_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToReport(row: ReportRow): Report {
  return {
    id: row.id,
    category: row.category as Report["category"],
    severity: row.severity as Report["severity"],
    status: row.status as Report["status"],
    title: row.title,
    description: row.description,
    location: { latitude: row.latitude, longitude: row.longitude },
    address: row.address,
    photoUrls: row.photo_urls ?? [],
    reporterHash: row.reporter_hash,
    incidentId: row.incident_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// GET /api/export/[incidentId]
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: { incidentId: string } },
): Promise<NextResponse<ApiResponse<EvidencePacket>>> {
  try {
    const incident = await getIncidentById(params.incidentId);

    if (!incident) {
      return NextResponse.json(
        { ok: false, error: `Incident ${params.incidentId} not found` },
        { status: 404 },
      );
    }

    // Fetch all reports attached to this incident
    const reportsSql = `
      SELECT
        id, category, severity, status, title, description,
        ST_Y(location::geometry) AS latitude,
        ST_X(location::geometry) AS longitude,
        address, photo_urls, reporter_hash, incident_id,
        created_at, updated_at
      FROM reports
      WHERE incident_id = $1
      ORDER BY created_at ASC
    `;
    const reportsResult = await query<ReportRow>(reportsSql, [params.incidentId]);
    const reports = reportsResult.rows.map(rowToReport);

    // Fetch the full timeline
    const timeline = await getIncidentTimeline(params.incidentId);

    // Fetch agency scorecard if an agency is assigned
    let agencyScorecard = null;
    if (incident.agencyId) {
      const periodEnd = new Date();
      const periodStart = new Date();
      periodStart.setFullYear(periodStart.getFullYear() - 1);
      agencyScorecard = await getAgencyScorecard(
        incident.agencyId,
        periodStart,
        periodEnd,
      );
    }

    const packet: EvidencePacket = {
      incidentId: incident.id,
      generatedAt: new Date(),
      reports,
      incident,
      timeline,
      agencyScorecard,
    };

    return NextResponse.json({ ok: true, data: packet });
  } catch (err) {
    console.error("[api/export/[incidentId]] GET error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
