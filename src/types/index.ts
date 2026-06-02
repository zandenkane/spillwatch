/**
 * Core type definitions for SpillWatch.
 *
 * These types flow through the entire app: database rows map onto them,
 * API routes accept/return them, and the frontend renders them.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum ReportCategory {
  AIR = "air",
  WATER = "water",
  SOIL = "soil",
  NOISE = "noise",
  WASTE = "waste",
}

export enum Severity {
  LOW = "low",
  MODERATE = "moderate",
  HIGH = "high",
  CRITICAL = "critical",
}

export enum ReportStatus {
  PENDING = "pending",
  VERIFIED = "verified",
  FORWARDED = "forwarded",
  ACKNOWLEDGED = "acknowledged",
  INVESTIGATING = "investigating",
  RESOLVED = "resolved",
  IGNORED = "ignored",
}

export enum AgencyTier {
  LOCAL = "local",
  STATE = "state",
  FEDERAL = "federal",
}

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface GeoBoundingBox {
  sw: GeoPoint; // southwest corner
  ne: GeoPoint; // northeast corner
}

// ---------------------------------------------------------------------------
// Report: a single observation submitted by a community member
// ---------------------------------------------------------------------------

export interface Report {
  id: string;
  category: ReportCategory;
  severity: Severity;
  status: ReportStatus;
  title: string;
  description: string;
  location: GeoPoint;
  address: string | null;
  photoUrls: string[];
  reporterHash: string; // sha256 of contact info, never the raw value
  incidentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReportInput {
  category: ReportCategory;
  severity: Severity;
  title: string;
  description: string;
  latitude: number;
  longitude: number;
  address?: string;
  photoUrls?: string[];
  reporterContact?: string; // hashed before storage
}

export interface ReportFilter {
  category?: ReportCategory;
  severity?: Severity;
  status?: ReportStatus;
  bounds?: GeoBoundingBox;
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Incident: auto-clustered group of nearby, temporally close reports
// ---------------------------------------------------------------------------

export interface Incident {
  id: string;
  title: string;
  category: ReportCategory;
  severity: Severity;
  status: ReportStatus;
  centroid: GeoPoint;
  radiusMeters: number;
  reportCount: number;
  firstReportedAt: Date;
  lastReportedAt: Date;
  agencyId: string | null;
  foiaTrackingNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IncidentTimelineEntry {
  id: string;
  incidentId: string;
  entryType: "report_added" | "forwarded" | "agency_response" | "status_change" | "note";
  content: string;
  actorLabel: string; // "community member", agency name, "system"
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Agency: a government body that should respond to incidents
// ---------------------------------------------------------------------------

export interface Agency {
  id: string;
  name: string;
  tier: AgencyTier;
  jurisdiction: string;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  createdAt: Date;
}

export interface AgencyScorecard {
  agencyId: string;
  agencyName: string;
  totalForwarded: number;
  totalAcknowledged: number;
  totalResolved: number;
  totalIgnored: number;
  medianResponseHours: number | null;
  resolutionRate: number; // 0-1
  ignoredRate: number; // 0-1
  periodStart: Date;
  periodEnd: Date;
}

// ---------------------------------------------------------------------------
// Clustering config
// ---------------------------------------------------------------------------

export interface ClusteringConfig {
  radiusMeters: number; // max distance between reports in a cluster
  timeWindowHours: number; // max time gap for auto-clustering
  minReportsToCluster: number; // minimum corroborating reports
}

// ---------------------------------------------------------------------------
// Evidence packet (JSON export payload)
// ---------------------------------------------------------------------------

export interface EvidencePacket {
  incidentId: string;
  generatedAt: Date;
  reports: Report[];
  incident: Incident;
  timeline: IncidentTimelineEntry[];
  agencyScorecard: AgencyScorecard | null;
}

// ---------------------------------------------------------------------------
// API response wrappers
// ---------------------------------------------------------------------------

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: string;
  details?: Record<string, string>;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
