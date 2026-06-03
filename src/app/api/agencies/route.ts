/**
 * API routes for government agencies and accountability scorecards.
 *
 * GET  /api/agencies              (list agencies)
 * POST /api/agencies              (register a new agency)
 * GET  /api/agencies?scorecard=1  (get accountability dashboard data)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createAgency,
  listAgencies,
  getAgencyScorecard,
  getAllScorecards,
  type CreateAgencyInput,
} from "../../../services/agencies";
import { AgencyTier } from "../../../types";
import type { ApiResponse, Agency, AgencyScorecard, PaginatedResult } from "../../../types";

// ---------------------------------------------------------------------------
// GET /api/agencies
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
): Promise<NextResponse<ApiResponse<PaginatedResult<Agency> | AgencyScorecard[]>>> {
  try {
    const { searchParams } = new URL(request.url);

    // Scorecard mode
    if (searchParams.get("scorecard") === "1") {
      const agencyId = searchParams.get("agencyId");

      // Default period: last 365 days
      const periodEnd = new Date();
      const periodStart = new Date();
      periodStart.setFullYear(periodStart.getFullYear() - 1);

      const startParam = searchParams.get("periodStart");
      const endParam = searchParams.get("periodEnd");

      if (startParam) {
        const d = new Date(startParam);
        if (!isNaN(d.getTime())) periodStart.setTime(d.getTime());
      }
      if (endParam) {
        const d = new Date(endParam);
        if (!isNaN(d.getTime())) periodEnd.setTime(d.getTime());
      }

      if (agencyId) {
        const scorecard = await getAgencyScorecard(
          agencyId,
          periodStart,
          periodEnd,
        );
        if (!scorecard) {
          return NextResponse.json(
            { ok: false, error: `Agency ${agencyId} not found` },
            { status: 404 },
          );
        }
        return NextResponse.json({ ok: true, data: [scorecard] });
      }

      const scorecards = await getAllScorecards(periodStart, periodEnd);
      return NextResponse.json({ ok: true, data: scorecards });
    }

    // Normal list mode
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);
    const offset = parseInt(searchParams.get("offset") ?? "0", 10);

    if (isNaN(limit) || limit < 1 || limit > 500) {
      return NextResponse.json(
        { ok: false, error: "limit must be 1-500" },
        { status: 400 },
      );
    }

    const result = await listAgencies(limit, offset);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    console.error("[api/agencies] GET error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/agencies
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiResponse<Agency>>> {
  try {
    const body = await request.json();
    const errors: Record<string, string> = {};

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }

    const raw = body as Record<string, unknown>;

    if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
      errors.name = "required, non-empty string";
    }

    const validTiers = Object.values(AgencyTier);
    if (!validTiers.includes(raw.tier as AgencyTier)) {
      errors.tier = `must be one of: ${validTiers.join(", ")}`;
    }

    if (typeof raw.jurisdiction !== "string" || raw.jurisdiction.trim().length === 0) {
      errors.jurisdiction = "required, non-empty string";
    }

    if (raw.contactEmail !== undefined && typeof raw.contactEmail !== "string") {
      errors.contactEmail = "must be a string if provided";
    }

    if (raw.contactPhone !== undefined && typeof raw.contactPhone !== "string") {
      errors.contactPhone = "must be a string if provided";
    }

    if (raw.websiteUrl !== undefined && typeof raw.websiteUrl !== "string") {
      errors.websiteUrl = "must be a string if provided";
    }

    if (Object.keys(errors).length > 0) {
      return NextResponse.json(
        { ok: false, error: "Validation failed", details: errors },
        { status: 400 },
      );
    }

    const input: CreateAgencyInput = {
      name: (raw.name as string).trim(),
      tier: raw.tier as AgencyTier,
      jurisdiction: (raw.jurisdiction as string).trim(),
      contactEmail: raw.contactEmail as string | undefined,
      contactPhone: raw.contactPhone as string | undefined,
      websiteUrl: raw.websiteUrl as string | undefined,
    };

    const agency = await createAgency(input);
    return NextResponse.json({ ok: true, data: agency }, { status: 201 });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON in request body" },
        { status: 400 },
      );
    }

    console.error("[api/agencies] POST error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
