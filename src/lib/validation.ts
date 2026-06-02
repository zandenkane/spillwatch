/**
 * Input validation utilities.
 *
 * Keeps validation logic out of route handlers so it can be
 * unit-tested independently and reused across API routes.
 */

import {
  ReportCategory,
  Severity,
  type CreateReportInput,
  type ReportFilter,
  type GeoBoundingBox,
} from "../types";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ValidationError extends Error {
  public readonly fields: Record<string, string>;

  constructor(fields: Record<string, string>) {
    const summary = Object.entries(fields)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    super(`Validation failed: ${summary}`);
    this.name = "ValidationError";
    this.fields = fields;
  }
}

// ---------------------------------------------------------------------------
// Primitive checks
// ---------------------------------------------------------------------------

function isValidLatitude(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

function isValidLongitude(lng: number): boolean {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

function isEnumValue<T extends Record<string, string>>(
  enumObj: T,
  val: unknown,
): val is T[keyof T] {
  return typeof val === "string" && Object.values(enumObj).includes(val as T[keyof T]);
}

// ---------------------------------------------------------------------------
// Report validation
// ---------------------------------------------------------------------------

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_PHOTOS = 10;

export function validateCreateReport(body: unknown): CreateReportInput {
  if (!body || typeof body !== "object") {
    throw new ValidationError({ body: "request body must be a JSON object" });
  }

  const raw = body as Record<string, unknown>;
  const errors: Record<string, string> = {};

  // category
  if (!isEnumValue(ReportCategory, raw.category)) {
    errors.category = `must be one of: ${Object.values(ReportCategory).join(", ")}`;
  }

  // severity
  if (!isEnumValue(Severity, raw.severity)) {
    errors.severity = `must be one of: ${Object.values(Severity).join(", ")}`;
  }

  // title
  if (!isNonEmptyString(raw.title)) {
    errors.title = "required, non-empty string";
  } else if ((raw.title as string).length > MAX_TITLE_LENGTH) {
    errors.title = `must be ${MAX_TITLE_LENGTH} characters or fewer`;
  }

  // description
  if (!isNonEmptyString(raw.description)) {
    errors.description = "required, non-empty string";
  } else if ((raw.description as string).length > MAX_DESCRIPTION_LENGTH) {
    errors.description = `must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`;
  }

  // latitude / longitude
  if (typeof raw.latitude !== "number" || !isValidLatitude(raw.latitude)) {
    errors.latitude = "must be a number between -90 and 90";
  }
  if (typeof raw.longitude !== "number" || !isValidLongitude(raw.longitude)) {
    errors.longitude = "must be a number between -180 and 180";
  }

  // optional: address
  if (raw.address !== undefined && typeof raw.address !== "string") {
    errors.address = "must be a string if provided";
  }

  // optional: photoUrls
  if (raw.photoUrls !== undefined) {
    if (!Array.isArray(raw.photoUrls)) {
      errors.photoUrls = "must be an array of URL strings";
    } else if (raw.photoUrls.length > MAX_PHOTOS) {
      errors.photoUrls = `at most ${MAX_PHOTOS} photos allowed`;
    } else {
      for (let i = 0; i < raw.photoUrls.length; i++) {
        if (typeof raw.photoUrls[i] !== "string") {
          errors.photoUrls = `item at index ${i} is not a string`;
          break;
        }
      }
    }
  }

  // optional: reporterContact
  if (raw.reporterContact !== undefined && typeof raw.reporterContact !== "string") {
    errors.reporterContact = "must be a string if provided";
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }

  return {
    category: raw.category as ReportCategory,
    severity: raw.severity as Severity,
    title: (raw.title as string).trim(),
    description: (raw.description as string).trim(),
    latitude: raw.latitude as number,
    longitude: raw.longitude as number,
    address: raw.address as string | undefined,
    photoUrls: (raw.photoUrls as string[] | undefined) ?? [],
    reporterContact: raw.reporterContact as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// Filter validation (query-string parsing)
// ---------------------------------------------------------------------------

export function parseReportFilter(params: URLSearchParams): ReportFilter {
  const filter: ReportFilter = {};

  const cat = params.get("category");
  if (cat) {
    if (!isEnumValue(ReportCategory, cat)) {
      throw new ValidationError({ category: "invalid category value" });
    }
    filter.category = cat as ReportCategory;
  }

  const sev = params.get("severity");
  if (sev) {
    if (!isEnumValue(Severity, sev)) {
      throw new ValidationError({ severity: "invalid severity value" });
    }
    filter.severity = sev as Severity;
  }

  const since = params.get("since");
  if (since) {
    const d = new Date(since);
    if (isNaN(d.getTime())) {
      throw new ValidationError({ since: "invalid ISO date" });
    }
    filter.since = d;
  }

  const until = params.get("until");
  if (until) {
    const d = new Date(until);
    if (isNaN(d.getTime())) {
      throw new ValidationError({ until: "invalid ISO date" });
    }
    filter.until = d;
  }

  // bounding box: sw_lat,sw_lng,ne_lat,ne_lng
  const bbox = params.get("bounds");
  if (bbox) {
    const parts = bbox.split(",").map(Number);
    if (
      parts.length !== 4 ||
      parts.some((p) => !Number.isFinite(p)) ||
      !isValidLatitude(parts[0]) ||
      !isValidLongitude(parts[1]) ||
      !isValidLatitude(parts[2]) ||
      !isValidLongitude(parts[3])
    ) {
      throw new ValidationError({ bounds: "must be sw_lat,sw_lng,ne_lat,ne_lng" });
    }
    filter.bounds = {
      sw: { latitude: parts[0], longitude: parts[1] },
      ne: { latitude: parts[2], longitude: parts[3] },
    } satisfies GeoBoundingBox;
  }

  const limit = params.get("limit");
  if (limit) {
    const n = parseInt(limit, 10);
    if (isNaN(n) || n < 1 || n > 500) {
      throw new ValidationError({ limit: "must be 1-500" });
    }
    filter.limit = n;
  }

  const offset = params.get("offset");
  if (offset) {
    const n = parseInt(offset, 10);
    if (isNaN(n) || n < 0) {
      throw new ValidationError({ offset: "must be >= 0" });
    }
    filter.offset = n;
  }

  return filter;
}
