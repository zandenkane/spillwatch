/**
 * Photo upload API route.
 *
 * POST /api/upload  - get a presigned URL for direct-to-S3 upload
 *
 * The client sends a request with the report ID and filename, receives
 * a presigned PUT URL, then uploads directly to S3. This keeps large
 * binary payloads off the app server.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildPhotoKey, getPresignedUploadUrl } from "../../../lib/s3";
import type { ApiResponse } from "../../../types";

// ---------------------------------------------------------------------------
// Allowed content types
// ---------------------------------------------------------------------------

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const MAX_FILENAME_LENGTH = 255;

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

interface UploadResponse {
  uploadUrl: string;
  objectKey: string;
}

// ---------------------------------------------------------------------------
// POST /api/upload
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiResponse<UploadResponse>>> {
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

    if (typeof raw.reportId !== "string" || raw.reportId.trim().length === 0) {
      errors.reportId = "required, non-empty string";
    }

    if (typeof raw.filename !== "string" || raw.filename.trim().length === 0) {
      errors.filename = "required, non-empty string";
    } else if ((raw.filename as string).length > MAX_FILENAME_LENGTH) {
      errors.filename = `must be ${MAX_FILENAME_LENGTH} characters or fewer`;
    }

    if (typeof raw.contentType !== "string") {
      errors.contentType = "required string";
    } else if (!ALLOWED_CONTENT_TYPES.has(raw.contentType)) {
      errors.contentType = `must be one of: ${Array.from(ALLOWED_CONTENT_TYPES).join(", ")}`;
    }

    if (Object.keys(errors).length > 0) {
      return NextResponse.json(
        { ok: false, error: "Validation failed", details: errors },
        { status: 400 },
      );
    }

    const reportId = (raw.reportId as string).trim();
    const filename = (raw.filename as string).trim();
    const contentType = raw.contentType as string;

    const objectKey = buildPhotoKey(reportId, filename);
    const uploadUrl = await getPresignedUploadUrl(objectKey, contentType);

    return NextResponse.json({
      ok: true,
      data: { uploadUrl, objectKey },
    });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON in request body" },
        { status: 400 },
      );
    }

    console.error("[api/upload] POST error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
