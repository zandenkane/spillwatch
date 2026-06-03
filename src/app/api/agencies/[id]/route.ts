/**
 * Single-agency API routes.
 *
 * GET    /api/agencies/[id]  - fetch a single agency by ID
 * PATCH  /api/agencies/[id]  - update agency details
 * DELETE /api/agencies/[id]  - remove an agency
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getAgencyById,
  updateAgency,
  deleteAgency,
  type UpdateAgencyInput,
} from "../../../../services/agencies";
import { AgencyTier } from "../../../../types";
import type { ApiResponse, Agency } from "../../../../types";

// ---------------------------------------------------------------------------
// GET /api/agencies/[id]
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse<ApiResponse<Agency>>> {
  try {
    const agency = await getAgencyById(params.id);

    if (!agency) {
      return NextResponse.json(
        { ok: false, error: `Agency ${params.id} not found` },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, data: agency });
  } catch (err) {
    console.error("[api/agencies/[id]] GET error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/agencies/[id]
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse<ApiResponse<Agency>>> {
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

    if (raw.name !== undefined && (typeof raw.name !== "string" || raw.name.trim().length === 0)) {
      errors.name = "must be a non-empty string";
    }

    const validTiers = Object.values(AgencyTier);
    if (raw.tier !== undefined && !validTiers.includes(raw.tier as AgencyTier)) {
      errors.tier = `must be one of: ${validTiers.join(", ")}`;
    }

    if (raw.jurisdiction !== undefined && (typeof raw.jurisdiction !== "string" || raw.jurisdiction.trim().length === 0)) {
      errors.jurisdiction = "must be a non-empty string";
    }

    if (raw.contactEmail !== undefined && raw.contactEmail !== null && typeof raw.contactEmail !== "string") {
      errors.contactEmail = "must be a string or null";
    }

    if (raw.contactPhone !== undefined && raw.contactPhone !== null && typeof raw.contactPhone !== "string") {
      errors.contactPhone = "must be a string or null";
    }

    if (raw.websiteUrl !== undefined && raw.websiteUrl !== null && typeof raw.websiteUrl !== "string") {
      errors.websiteUrl = "must be a string or null";
    }

    if (Object.keys(errors).length > 0) {
      return NextResponse.json(
        { ok: false, error: "Validation failed", details: errors },
        { status: 400 },
      );
    }

    const input: UpdateAgencyInput = {};
    if (raw.name !== undefined) input.name = (raw.name as string).trim();
    if (raw.tier !== undefined) input.tier = raw.tier as AgencyTier;
    if (raw.jurisdiction !== undefined) input.jurisdiction = (raw.jurisdiction as string).trim();
    if (raw.contactEmail !== undefined) input.contactEmail = raw.contactEmail as string | null;
    if (raw.contactPhone !== undefined) input.contactPhone = raw.contactPhone as string | null;
    if (raw.websiteUrl !== undefined) input.websiteUrl = raw.websiteUrl as string | null;

    const agency = await updateAgency(params.id, input);

    if (!agency) {
      return NextResponse.json(
        { ok: false, error: `Agency ${params.id} not found` },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, data: agency });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON in request body" },
        { status: 400 },
      );
    }

    console.error("[api/agencies/[id]] PATCH error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/agencies/[id]
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse<ApiResponse<{ deleted: boolean }>>> {
  try {
    const deleted = await deleteAgency(params.id);

    if (!deleted) {
      return NextResponse.json(
        { ok: false, error: `Agency ${params.id} not found` },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, data: { deleted: true } });
  } catch (err) {
    console.error("[api/agencies/[id]] DELETE error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
