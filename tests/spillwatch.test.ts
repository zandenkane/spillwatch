/**
 * Tests for SpillWatch: validation, report service, incident clustering,
 * agency scorecard logic, S3 helpers, and clustering configuration.
 *
 * Uses Vitest. The validation module is tested directly (pure functions,
 * no database). Service-layer tests mock the db query helper so they
 * run without a live Postgres connection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Validation (pure, no mocks needed) ------------------------------------

import {
  validateCreateReport,
  parseReportFilter,
  ValidationError,
} from "../src/lib/validation";
import { ReportCategory, Severity, ReportStatus, AgencyTier } from "../src/types";

// ---- S3 helpers (pure, no mocks needed) ------------------------------------

import { buildPhotoKey } from "../src/lib/s3";

// ---- Helpers ---------------------------------------------------------------

function validReportBody(): Record<string, unknown> {
  return {
    category: "water",
    severity: "high",
    title: "Oil sheen on creek",
    description: "Visible rainbow sheen on Deer Creek near the bridge.",
    latitude: 40.4406,
    longitude: -79.9959,
  };
}

// ---------------------------------------------------------------------------
// validateCreateReport
// ---------------------------------------------------------------------------

describe("validateCreateReport", () => {
  it("accepts a minimal valid body", () => {
    const result = validateCreateReport(validReportBody());
    expect(result.category).toBe(ReportCategory.WATER);
    expect(result.severity).toBe(Severity.HIGH);
    expect(result.title).toBe("Oil sheen on creek");
    expect(result.latitude).toBe(40.4406);
    expect(result.longitude).toBe(-79.9959);
    expect(result.photoUrls).toEqual([]);
  });

  it("accepts all optional fields", () => {
    const body = {
      ...validReportBody(),
      address: "123 River Rd",
      photoUrls: ["https://example.com/a.jpg"],
      reporterContact: "tip@example.com",
    };
    const result = validateCreateReport(body);
    expect(result.address).toBe("123 River Rd");
    expect(result.photoUrls).toEqual(["https://example.com/a.jpg"]);
    expect(result.reporterContact).toBe("tip@example.com");
  });

  it("trims title and description whitespace", () => {
    const body = {
      ...validReportBody(),
      title: "  padded title  ",
      description: "  padded description  ",
    };
    const result = validateCreateReport(body);
    expect(result.title).toBe("padded title");
    expect(result.description).toBe("padded description");
  });

  it("rejects null body", () => {
    expect(() => validateCreateReport(null)).toThrow(ValidationError);
  });

  it("rejects non-object body", () => {
    expect(() => validateCreateReport("not an object")).toThrow(ValidationError);
  });

  it("rejects undefined body", () => {
    expect(() => validateCreateReport(undefined)).toThrow(ValidationError);
  });

  it("rejects numeric body", () => {
    expect(() => validateCreateReport(42)).toThrow(ValidationError);
  });

  it("rejects array body", () => {
    expect(() => validateCreateReport([1, 2, 3])).toThrow(ValidationError);
  });

  // Category validation
  it("rejects unknown category", () => {
    const body = { ...validReportBody(), category: "radiation" };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.category).toBeDefined();
    }
  });

  it("rejects missing category", () => {
    const body = validReportBody();
    delete body.category;
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.category).toBeDefined();
    }
  });

  it("accepts every valid category", () => {
    for (const cat of Object.values(ReportCategory)) {
      const body = { ...validReportBody(), category: cat };
      const result = validateCreateReport(body);
      expect(result.category).toBe(cat);
    }
  });

  // Severity validation
  it("rejects unknown severity", () => {
    const body = { ...validReportBody(), severity: "extreme" };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.severity).toBeDefined();
    }
  });

  it("rejects missing severity", () => {
    const body = validReportBody();
    delete body.severity;
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.severity).toBeDefined();
    }
  });

  it("accepts every valid severity", () => {
    for (const sev of Object.values(Severity)) {
      const body = { ...validReportBody(), severity: sev };
      const result = validateCreateReport(body);
      expect(result.severity).toBe(sev);
    }
  });

  // Title validation
  it("rejects empty title", () => {
    const body = { ...validReportBody(), title: "" };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.title).toBeDefined();
    }
  });

  it("rejects whitespace-only title", () => {
    const body = { ...validReportBody(), title: "   " };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.title).toBeDefined();
    }
  });

  it("rejects title over 200 characters", () => {
    const body = { ...validReportBody(), title: "x".repeat(201) };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.title).toBeDefined();
    }
  });

  it("accepts title at exactly 200 characters", () => {
    const body = { ...validReportBody(), title: "x".repeat(200) };
    const result = validateCreateReport(body);
    expect(result.title.length).toBe(200);
  });

  // Description validation
  it("rejects empty description", () => {
    const body = { ...validReportBody(), description: "" };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.description).toBeDefined();
    }
  });

  it("rejects description over 5000 characters", () => {
    const body = { ...validReportBody(), description: "d".repeat(5001) };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.description).toBeDefined();
    }
  });

  it("accepts description at exactly 5000 characters", () => {
    const body = { ...validReportBody(), description: "d".repeat(5000) };
    const result = validateCreateReport(body);
    expect(result.description.length).toBe(5000);
  });

  // Latitude / longitude validation
  it("rejects latitude outside -90..90", () => {
    const body = { ...validReportBody(), latitude: 91 };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.latitude).toBeDefined();
    }
  });

  it("rejects latitude below -90", () => {
    const body = { ...validReportBody(), latitude: -91 };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.latitude).toBeDefined();
    }
  });

  it("rejects non-numeric latitude", () => {
    const body = { ...validReportBody(), latitude: "forty" };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.latitude).toBeDefined();
    }
  });

  it("rejects longitude outside -180..180", () => {
    const body = { ...validReportBody(), longitude: 181 };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.longitude).toBeDefined();
    }
  });

  it("rejects longitude below -180", () => {
    const body = { ...validReportBody(), longitude: -181 };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.longitude).toBeDefined();
    }
  });

  it("rejects NaN latitude", () => {
    const body = { ...validReportBody(), latitude: NaN };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.latitude).toBeDefined();
    }
  });

  it("rejects Infinity longitude", () => {
    const body = { ...validReportBody(), longitude: Infinity };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.longitude).toBeDefined();
    }
  });

  it("accepts boundary coordinates (poles and antimeridian)", () => {
    const body = { ...validReportBody(), latitude: -90, longitude: 180 };
    const result = validateCreateReport(body);
    expect(result.latitude).toBe(-90);
    expect(result.longitude).toBe(180);
  });

  it("accepts zero coordinates (Gulf of Guinea)", () => {
    const body = { ...validReportBody(), latitude: 0, longitude: 0 };
    const result = validateCreateReport(body);
    expect(result.latitude).toBe(0);
    expect(result.longitude).toBe(0);
  });

  // photoUrls validation
  it("rejects non-array photoUrls", () => {
    const body = { ...validReportBody(), photoUrls: "not-an-array" };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.photoUrls).toBeDefined();
    }
  });

  it("rejects more than 10 photos", () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}.jpg`);
    const body = { ...validReportBody(), photoUrls: urls };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.photoUrls).toBeDefined();
    }
  });

  it("rejects non-string items in photoUrls", () => {
    const body = { ...validReportBody(), photoUrls: [123] };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.photoUrls).toBeDefined();
    }
  });

  it("accepts exactly 10 photos", () => {
    const urls = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}.jpg`);
    const body = { ...validReportBody(), photoUrls: urls };
    const result = validateCreateReport(body);
    expect(result.photoUrls).toHaveLength(10);
  });

  it("accepts empty photoUrls array", () => {
    const body = { ...validReportBody(), photoUrls: [] };
    const result = validateCreateReport(body);
    expect(result.photoUrls).toEqual([]);
  });

  // reporterContact validation
  it("rejects non-string reporterContact", () => {
    const body = { ...validReportBody(), reporterContact: 42 };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.reporterContact).toBeDefined();
    }
  });

  // address validation
  it("rejects non-string address", () => {
    const body = { ...validReportBody(), address: 42 };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fields.address).toBeDefined();
    }
  });

  // Multiple errors at once
  it("collects multiple field errors in one throw", () => {
    const body = {
      category: "invalid",
      severity: "invalid",
      title: "",
      description: "",
      latitude: "bad",
      longitude: "bad",
    };
    try {
      validateCreateReport(body);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const fields = (err as ValidationError).fields;
      expect(Object.keys(fields).length).toBeGreaterThanOrEqual(4);
      expect(fields.category).toBeDefined();
      expect(fields.severity).toBeDefined();
      expect(fields.title).toBeDefined();
      expect(fields.description).toBeDefined();
    }
  });

  it("preserves original address string without trimming", () => {
    const body = { ...validReportBody(), address: "  123 Main St  " };
    const result = validateCreateReport(body);
    expect(result.address).toBe("  123 Main St  ");
  });
});

// ---------------------------------------------------------------------------
// ValidationError
// ---------------------------------------------------------------------------

describe("ValidationError", () => {
  it("stores fields and produces a message", () => {
    const err = new ValidationError({ name: "required" });
    expect(err.name).toBe("ValidationError");
    expect(err.fields).toEqual({ name: "required" });
    expect(err.message).toContain("name");
    expect(err.message).toContain("required");
  });

  it("includes all field names in the message", () => {
    const err = new ValidationError({ a: "bad", b: "worse" });
    expect(err.message).toContain("a");
    expect(err.message).toContain("b");
  });

  it("extends Error", () => {
    const err = new ValidationError({ field: "bad" });
    expect(err).toBeInstanceOf(Error);
  });

  it("has the correct name property", () => {
    const err = new ValidationError({ field: "bad" });
    expect(err.name).toBe("ValidationError");
  });
});

// ---------------------------------------------------------------------------
// parseReportFilter
// ---------------------------------------------------------------------------

describe("parseReportFilter", () => {
  it("returns empty filter for no params", () => {
    const params = new URLSearchParams();
    const filter = parseReportFilter(params);
    expect(filter).toEqual({});
  });

  it("parses valid category", () => {
    const params = new URLSearchParams({ category: "soil" });
    const filter = parseReportFilter(params);
    expect(filter.category).toBe(ReportCategory.SOIL);
  });

  it("rejects invalid category", () => {
    const params = new URLSearchParams({ category: "lava" });
    expect(() => parseReportFilter(params)).toThrow(ValidationError);
  });

  it("parses valid severity", () => {
    const params = new URLSearchParams({ severity: "critical" });
    const filter = parseReportFilter(params);
    expect(filter.severity).toBe(Severity.CRITICAL);
  });

  it("rejects invalid severity", () => {
    const params = new URLSearchParams({ severity: "extreme" });
    expect(() => parseReportFilter(params)).toThrow(ValidationError);
  });

  it("parses since as ISO date", () => {
    const params = new URLSearchParams({ since: "2025-01-15T00:00:00Z" });
    const filter = parseReportFilter(params);
    expect(filter.since).toBeInstanceOf(Date);
    expect(filter.since!.toISOString()).toBe("2025-01-15T00:00:00.000Z");
  });

  it("rejects invalid since date", () => {
    const params = new URLSearchParams({ since: "not-a-date" });
    expect(() => parseReportFilter(params)).toThrow(ValidationError);
  });

  it("parses until as ISO date", () => {
    const params = new URLSearchParams({ until: "2025-12-31T23:59:59Z" });
    const filter = parseReportFilter(params);
    expect(filter.until).toBeInstanceOf(Date);
  });

  it("rejects invalid until date", () => {
    const params = new URLSearchParams({ until: "yesterday" });
    expect(() => parseReportFilter(params)).toThrow(ValidationError);
  });

  it("parses valid bounding box", () => {
    const params = new URLSearchParams({ bounds: "40.0,-80.0,41.0,-79.0" });
    const filter = parseReportFilter(params);
    expect(filter.bounds).toBeDefined();
    expect(filter.bounds!.sw.latitude).toBe(40.0);
    expect(filter.bounds!.sw.longitude).toBe(-80.0);
    expect(filter.bounds!.ne.latitude).toBe(41.0);
    expect(filter.bounds!.ne.longitude).toBe(-79.0);
  });

  it("rejects bounding box with too few coordinates", () => {
    const params = new URLSearchParams({ bounds: "40.0,-80.0" });
    expect(() => parseReportFilter(params)).toThrow(ValidationError);
  });

  it("rejects bounding box with out-of-range latitude", () => {
    const params = new URLSearchParams({ bounds: "91.0,-80.0,41.0,-79.0" });
    expect(() => parseReportFilter(params)).toThrow(ValidationError);
  });

  it("rejects bounding box with non-numeric values", () => {
    const params = new URLSearchParams({ bounds: "a,b,c,d" });
    expect(() => parseReportFilter(params)).toThrow(ValidationError);
  });

  it("rejects bounding box with out-of-range longitude", () => {
    const params = new URLSearchParams({ bounds: "40.0,-181.0,41.0,-79.0" });
    expect(() => parseReportFilter(params)).toThrow(ValidationError);
  });

  it("parses limit within 1-500", () => {
    const params = new URLSearchParams({ limit: "100" });
    const filter = parseReportFilter(params);
    expect(filter.limit).toBe(100);
  });

  it("accepts limit of 1", () => {
    const params = new URLSearchParams({ limit: "1" });
    const filter = parseReportFilter(params);
    expect(filter.limit).toBe(1);
  });

  it("accepts limit of 500", () => {
    const params = new URLSearchParams({ limit: "500" });
    const filter = parseReportFilter(params);
    expect(filter.limit).toBe(500);
  });

  it("rejects limit of 0", () => {
    const params = new URLSearchParams({ limit: "0" });
    expect(() => parseReportFilter(params)).toThrow(ValidationError);
  });

  it("rejects limit over 500", () => {
    const params = new URLSearchParams({ limit: "501" });
    expect(() => parseReportFilter(params)).toThrow(ValidationError);
  });

  it("rejects non-numeric limit", () => {
    const params = new URLSearchParams({ limit: "abc" });
    expect(() => parseReportFilter(params)).toThrow(ValidationError);
  });

  it("rejects negative limit", () => {
    const params = new URLSearchParams({ limit: "-5" });
    expect(() => parseReportFilter(params)).toThrow(ValidationError);
  });

  it("parses valid offset", () => {
    const params = new URLSearchParams({ offset: "25" });
    const filter = parseReportFilter(params);
    expect(filter.offset).toBe(25);
  });

  it("accepts offset of 0", () => {
    const params = new URLSearchParams({ offset: "0" });
    const filter = parseReportFilter(params);
    expect(filter.offset).toBe(0);
  });

  it("rejects negative offset", () => {
    const params = new URLSearchParams({ offset: "-1" });
    expect(() => parseReportFilter(params)).toThrow(ValidationError);
  });

  it("parses multiple filters together", () => {
    const params = new URLSearchParams({
      category: "air",
      severity: "low",
      limit: "20",
      offset: "10",
    });
    const filter = parseReportFilter(params);
    expect(filter.category).toBe(ReportCategory.AIR);
    expect(filter.severity).toBe(Severity.LOW);
    expect(filter.limit).toBe(20);
    expect(filter.offset).toBe(10);
  });

  it("parses all report categories in filter", () => {
    for (const cat of Object.values(ReportCategory)) {
      const params = new URLSearchParams({ category: cat });
      const filter = parseReportFilter(params);
      expect(filter.category).toBe(cat);
    }
  });

  it("ignores unknown query parameters", () => {
    const params = new URLSearchParams({ foo: "bar", category: "water" });
    const filter = parseReportFilter(params);
    expect(filter.category).toBe(ReportCategory.WATER);
    expect((filter as Record<string, unknown>).foo).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// S3 key building
// ---------------------------------------------------------------------------

describe("buildPhotoKey", () => {
  it("builds a key with reports prefix", () => {
    const key = buildPhotoKey("abc-123", "photo.jpg");
    expect(key).toBe("reports/abc-123/photo.jpg");
  });

  it("sanitizes special characters in filename", () => {
    const key = buildPhotoKey("abc-123", "photo with spaces!@#.jpg");
    expect(key).not.toContain(" ");
    expect(key).not.toContain("!");
    expect(key).not.toContain("@");
    expect(key).not.toContain("#");
    expect(key).toContain("reports/abc-123/");
  });

  it("preserves safe characters in filename", () => {
    const key = buildPhotoKey("abc-123", "my-photo_2024.05.jpg");
    expect(key).toBe("reports/abc-123/my-photo_2024.05.jpg");
  });

  it("prevents path traversal in filename", () => {
    const key = buildPhotoKey("abc-123", "../../etc/passwd");
    expect(key).not.toContain("..");
    expect(key.startsWith("reports/abc-123/")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Clustering config
// ---------------------------------------------------------------------------

// ---- Clustering config (pure, no mocks needed) ----------------------------

import { loadClusteringConfig } from "../src/lib/clustering";

describe("loadClusteringConfig", () => {

  it("returns default values when env vars are not set", () => {
    const config = loadClusteringConfig();
    expect(config.radiusMeters).toBe(500);
    expect(config.timeWindowHours).toBe(72);
    expect(config.minReportsToCluster).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Service layer tests (db module mocked)
// ---------------------------------------------------------------------------

vi.mock("../src/lib/db", () => ({
  query: vi.fn(),
  getPool: vi.fn(),
  getClient: vi.fn(),
  withTransaction: vi.fn(),
  closePool: vi.fn(),
}));

import { query } from "../src/lib/db";
import { createReport, getReportById, deleteReport, countByCategory } from "../src/services/reports";
import { getIncidentById, clusterReport } from "../src/services/incidents";
import { getAgencyById, getAgencyScorecard, createAgency, listAgencies } from "../src/services/agencies";

const mockQuery = vi.mocked(query);

// ---------------------------------------------------------------------------
// Report service
// ---------------------------------------------------------------------------

describe("createReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a mapped Report object from the inserted row", async () => {
    const now = new Date("2025-06-01T12:00:00Z");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          category: "water",
          severity: "high",
          status: "pending",
          title: "Oil sheen on creek",
          description: "Visible rainbow sheen.",
          latitude: 40.4406,
          longitude: -79.9959,
          address: null,
          photo_urls: [],
          reporter_hash: "anonymous",
          incident_id: null,
          created_at: now,
          updated_at: now,
        },
      ],
      rowCount: 1,
      command: "INSERT",
      oid: 0,
      fields: [],
    } as any);

    const report = await createReport({
      category: ReportCategory.WATER,
      severity: Severity.HIGH,
      title: "Oil sheen on creek",
      description: "Visible rainbow sheen.",
      latitude: 40.4406,
      longitude: -79.9959,
    });

    expect(report.id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(report.category).toBe("water");
    expect(report.severity).toBe("high");
    expect(report.status).toBe("pending");
    expect(report.location.latitude).toBe(40.4406);
    expect(report.location.longitude).toBe(-79.9959);
    expect(report.reporterHash).toBe("anonymous");
    expect(report.photoUrls).toEqual([]);
    expect(report.incidentId).toBeNull();
  });

  it("throws when insert returns no rows", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: "INSERT",
      oid: 0,
      fields: [],
    } as any);

    await expect(
      createReport({
        category: ReportCategory.AIR,
        severity: Severity.LOW,
        title: "Smoke from factory",
        description: "Black smoke billowing from the north stack.",
        latitude: 41.0,
        longitude: -80.0,
      }),
    ).rejects.toThrow("Failed to insert report");
  });

  it("passes photo URLs through to the query", async () => {
    const now = new Date("2025-06-01T12:00:00Z");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "test-id",
          category: "soil",
          severity: "moderate",
          status: "pending",
          title: "Contaminated soil",
          description: "Dark discolored soil.",
          latitude: 40.0,
          longitude: -80.0,
          address: "123 Main St",
          photo_urls: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
          reporter_hash: "abc123",
          incident_id: null,
          created_at: now,
          updated_at: now,
        },
      ],
      rowCount: 1,
      command: "INSERT",
      oid: 0,
      fields: [],
    } as any);

    const report = await createReport({
      category: ReportCategory.SOIL,
      severity: Severity.MODERATE,
      title: "Contaminated soil",
      description: "Dark discolored soil.",
      latitude: 40.0,
      longitude: -80.0,
      address: "123 Main St",
      photoUrls: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
      reporterContact: "someone@example.com",
    });

    expect(report.photoUrls).toHaveLength(2);
    expect(report.address).toBe("123 Main St");
  });
});

describe("getReportById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no row found", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: "SELECT",
      oid: 0,
      fields: [],
    } as any);

    const report = await getReportById("nonexistent-id");
    expect(report).toBeNull();
  });

  it("returns a Report when row exists", async () => {
    const now = new Date("2025-06-01T12:00:00Z");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "found-id",
          category: "noise",
          severity: "low",
          status: "verified",
          title: "Loud machinery",
          description: "Construction noise after hours.",
          latitude: 40.5,
          longitude: -79.8,
          address: null,
          photo_urls: [],
          reporter_hash: "hash123",
          incident_id: "incident-1",
          created_at: now,
          updated_at: now,
        },
      ],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    } as any);

    const report = await getReportById("found-id");
    expect(report).not.toBeNull();
    expect(report!.id).toBe("found-id");
    expect(report!.category).toBe("noise");
    expect(report!.incidentId).toBe("incident-1");
  });
});

describe("deleteReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when a row is deleted", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 1,
      command: "DELETE",
      oid: 0,
      fields: [],
    } as any);

    const result = await deleteReport("existing-id");
    expect(result).toBe(true);
  });

  it("returns false when no row found to delete", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: "DELETE",
      oid: 0,
      fields: [],
    } as any);

    const result = await deleteReport("nonexistent-id");
    expect(result).toBe(false);
  });
});

describe("countByCategory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns category counts as a record", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { category: "water", count: 15 },
        { category: "air", count: 8 },
        { category: "soil", count: 3 },
      ],
      rowCount: 3,
      command: "SELECT",
      oid: 0,
      fields: [],
    } as any);

    const result = await countByCategory();
    expect(result.water).toBe(15);
    expect(result.air).toBe(8);
    expect(result.soil).toBe(3);
  });

  it("returns empty record when no reports exist", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: "SELECT",
      oid: 0,
      fields: [],
    } as any);

    const result = await countByCategory();
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Incident service
// ---------------------------------------------------------------------------

describe("getIncidentById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when incident does not exist", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: "SELECT",
      oid: 0,
      fields: [],
    } as any);

    const incident = await getIncidentById("nonexistent-id");
    expect(incident).toBeNull();
  });

  it("maps row to Incident with correct field names", async () => {
    const now = new Date("2025-06-01T12:00:00Z");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "inc-001",
          title: "Water incident - 3 reports",
          category: "water",
          severity: "high",
          status: "pending",
          centroid_lat: 40.44,
          centroid_lng: -79.99,
          radius_meters: 200,
          report_count: 3,
          first_reported_at: now,
          last_reported_at: now,
          agency_id: null,
          foia_tracking_number: null,
          created_at: now,
          updated_at: now,
        },
      ],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    } as any);

    const incident = await getIncidentById("inc-001");
    expect(incident).not.toBeNull();
    expect(incident!.centroid.latitude).toBe(40.44);
    expect(incident!.centroid.longitude).toBe(-79.99);
    expect(incident!.radiusMeters).toBe(200);
    expect(incident!.reportCount).toBe(3);
    expect(incident!.agencyId).toBeNull();
    expect(incident!.foiaTrackingNumber).toBeNull();
  });

  it("maps row with agency and FOIA number", async () => {
    const now = new Date("2025-06-01T12:00:00Z");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "inc-002",
          title: "Air incident - 5 reports",
          category: "air",
          severity: "critical",
          status: "forwarded",
          centroid_lat: 41.0,
          centroid_lng: -80.0,
          radius_meters: 350,
          report_count: 5,
          first_reported_at: now,
          last_reported_at: now,
          agency_id: "agency-abc",
          foia_tracking_number: "FOIA-2025-0042",
          created_at: now,
          updated_at: now,
        },
      ],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    } as any);

    const incident = await getIncidentById("inc-002");
    expect(incident).not.toBeNull();
    expect(incident!.agencyId).toBe("agency-abc");
    expect(incident!.foiaTrackingNumber).toBe("FOIA-2025-0042");
    expect(incident!.status).toBe("forwarded");
    expect(incident!.severity).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// Agency service
// ---------------------------------------------------------------------------

describe("getAgencyById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when agency does not exist", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: "SELECT",
      oid: 0,
      fields: [],
    } as any);

    const agency = await getAgencyById("nonexistent-id");
    expect(agency).toBeNull();
  });

  it("maps row to Agency with correct camelCase fields", async () => {
    const now = new Date("2025-06-01T12:00:00Z");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "agency-001",
          name: "State DEP",
          tier: "state",
          jurisdiction: "Pennsylvania",
          contact_email: "tip@dep.gov",
          contact_phone: "555-0100",
          website_url: "https://dep.gov",
          created_at: now,
        },
      ],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    } as any);

    const agency = await getAgencyById("agency-001");
    expect(agency).not.toBeNull();
    expect(agency!.name).toBe("State DEP");
    expect(agency!.tier).toBe("state");
    expect(agency!.contactEmail).toBe("tip@dep.gov");
    expect(agency!.contactPhone).toBe("555-0100");
    expect(agency!.websiteUrl).toBe("https://dep.gov");
  });

  it("handles null optional fields", async () => {
    const now = new Date("2025-06-01T12:00:00Z");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "agency-002",
          name: "Local Board",
          tier: "local",
          jurisdiction: "County",
          contact_email: null,
          contact_phone: null,
          website_url: null,
          created_at: now,
        },
      ],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    } as any);

    const agency = await getAgencyById("agency-002");
    expect(agency).not.toBeNull();
    expect(agency!.contactEmail).toBeNull();
    expect(agency!.contactPhone).toBeNull();
    expect(agency!.websiteUrl).toBeNull();
  });
});

describe("createAgency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the created agency", async () => {
    const now = new Date("2025-06-01T12:00:00Z");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "new-agency",
          name: "Federal EPA",
          tier: "federal",
          jurisdiction: "United States",
          contact_email: "info@epa.gov",
          contact_phone: null,
          website_url: "https://epa.gov",
          created_at: now,
        },
      ],
      rowCount: 1,
      command: "INSERT",
      oid: 0,
      fields: [],
    } as any);

    const agency = await createAgency({
      name: "Federal EPA",
      tier: AgencyTier.FEDERAL,
      jurisdiction: "United States",
      contactEmail: "info@epa.gov",
      websiteUrl: "https://epa.gov",
    });

    expect(agency.name).toBe("Federal EPA");
    expect(agency.tier).toBe("federal");
    expect(agency.jurisdiction).toBe("United States");
  });
});

describe("listAgencies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns paginated results", async () => {
    const now = new Date("2025-06-01T12:00:00Z");

    // count query
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: 2 }],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    } as any);

    // data query
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "a1",
          name: "Agency Alpha",
          tier: "state",
          jurisdiction: "State A",
          contact_email: null,
          contact_phone: null,
          website_url: null,
          created_at: now,
        },
        {
          id: "a2",
          name: "Agency Beta",
          tier: "local",
          jurisdiction: "City B",
          contact_email: null,
          contact_phone: null,
          website_url: null,
          created_at: now,
        },
      ],
      rowCount: 2,
      command: "SELECT",
      oid: 0,
      fields: [],
    } as any);

    const result = await listAgencies(10, 0);
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].name).toBe("Agency Alpha");
    expect(result.items[1].name).toBe("Agency Beta");
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(0);
  });
});

describe("getAgencyScorecard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when agency does not exist", async () => {
    // getAgencyById query returns empty
    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
      command: "SELECT",
      oid: 0,
      fields: [],
    } as any);

    const scorecard = await getAgencyScorecard(
      "nonexistent-agency",
      new Date("2025-01-01"),
      new Date("2025-12-31"),
    );
    expect(scorecard).toBeNull();
  });

  it("computes resolution and ignored rates correctly", async () => {
    const now = new Date("2025-06-01T12:00:00Z");

    // First call: getAgencyById SELECT
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "agency-002",
          name: "County EPA",
          tier: "local",
          jurisdiction: "Allegheny County",
          contact_email: null,
          contact_phone: null,
          website_url: null,
          created_at: now,
        },
      ],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    } as any);

    // Second call: the scorecard aggregate query
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          agency_id: "agency-002",
          agency_name: "County EPA",
          total_forwarded: 10,
          total_acknowledged: 7,
          total_resolved: 4,
          total_ignored: 2,
          median_response_hours: 48.5,
        },
      ],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    } as any);

    const scorecard = await getAgencyScorecard(
      "agency-002",
      new Date("2025-01-01"),
      new Date("2025-12-31"),
    );

    expect(scorecard).not.toBeNull();
    expect(scorecard!.agencyName).toBe("County EPA");
    expect(scorecard!.totalForwarded).toBe(10);
    expect(scorecard!.totalResolved).toBe(4);
    expect(scorecard!.totalIgnored).toBe(2);
    expect(scorecard!.medianResponseHours).toBe(48.5);
    // resolutionRate = 4 / 10 = 0.4
    expect(scorecard!.resolutionRate).toBeCloseTo(0.4);
    // ignoredRate = 2 / 10 = 0.2
    expect(scorecard!.ignoredRate).toBeCloseTo(0.2);
  });

  it("stores the period dates on the scorecard", async () => {
    const now = new Date("2025-06-01T12:00:00Z");
    const periodStart = new Date("2025-01-01");
    const periodEnd = new Date("2025-12-31");

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "agency-003",
          name: "Test Agency",
          tier: "federal",
          jurisdiction: "National",
          contact_email: null,
          contact_phone: null,
          website_url: null,
          created_at: now,
        },
      ],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    } as any);

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          agency_id: "agency-003",
          agency_name: "Test Agency",
          total_forwarded: 5,
          total_acknowledged: 3,
          total_resolved: 2,
          total_ignored: 1,
          median_response_hours: 24.0,
        },
      ],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    } as any);

    const scorecard = await getAgencyScorecard(
      "agency-003",
      periodStart,
      periodEnd,
    );

    expect(scorecard).not.toBeNull();
    expect(scorecard!.periodStart).toBe(periodStart);
    expect(scorecard!.periodEnd).toBe(periodEnd);
  });
});

// ---------------------------------------------------------------------------
// Type enum coverage
// ---------------------------------------------------------------------------

describe("enum values match schema constraints", () => {
  it("ReportCategory has exactly the 5 values from the DB schema", () => {
    const values = Object.values(ReportCategory);
    expect(values).toEqual(
      expect.arrayContaining(["air", "water", "soil", "noise", "waste"]),
    );
    expect(values).toHaveLength(5);
  });

  it("Severity has exactly 4 levels", () => {
    const values = Object.values(Severity);
    expect(values).toEqual(
      expect.arrayContaining(["low", "moderate", "high", "critical"]),
    );
    expect(values).toHaveLength(4);
  });

  it("ReportStatus has exactly 7 statuses", () => {
    const values = Object.values(ReportStatus);
    expect(values).toEqual(
      expect.arrayContaining([
        "pending",
        "verified",
        "forwarded",
        "acknowledged",
        "investigating",
        "resolved",
        "ignored",
      ]),
    );
    expect(values).toHaveLength(7);
  });

  it("AgencyTier has exactly 3 tiers", () => {
    const values = Object.values(AgencyTier);
    expect(values).toEqual(
      expect.arrayContaining(["local", "state", "federal"]),
    );
    expect(values).toHaveLength(3);
  });
});
