# Changelog

All notable changes to SpillWatch are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Core TypeScript type definitions: Report, Incident, Agency, AgencyScorecard,
  ClusteringConfig, EvidencePacket, and API response wrapper types.
- PostgreSQL/PostGIS database schema with tables for reports, incidents,
  incident_timeline, and agencies. Includes spatial indexes (GIST) on
  geography columns for efficient radius and bounding-box queries.
- Database connection pool (`src/lib/db.ts`) using the `pg` driver with
  configurable pool size, idle timeout, and connection timeout. Includes a
  `withTransaction` helper for multi-statement operations.
- Input validation module (`src/lib/validation.ts`) with structured error
  reporting. Validates report creation payloads (category, severity, title
  length, description length, lat/lng range, photo count) and query-string
  filters (bounding box, date range, pagination).
- Report service with create, get-by-id, list with spatial/temporal filters,
  status updates, delete, incident assignment, nearby-report lookup via
  `ST_DWithin`, and aggregate counts by category, severity, and status.
- Incident service with automatic spatial and temporal clustering. New reports
  are checked against open incidents within a configurable radius and time
  window; if enough corroborating reports exist, a new incident is formed
  automatically. Centroids are recalculated as reports accumulate.
- Incident status updates via dedicated service function with automatic
  timeline entries.
- Incident deletion that unlinks associated reports so they become
  available for re-clustering.
- Incident timeline tracking: each incident maintains a public audit trail
  of report additions, agency forwarding events, agency responses, status
  changes, and freeform notes.
- Agency forwarding workflow: incidents can be forwarded to a government
  agency with an optional FOIA tracking number, recorded on the timeline.
- Agency service with full CRUD (create, read, update, delete) operations
  and accountability scorecard computation. Per-agency metrics include total
  forwarded, acknowledged, resolved, and ignored counts; median response
  time in hours; resolution rate; and ignored rate. Scorecards can be queried
  for a single agency or all agencies with incidents in a given period.
- Summary statistics endpoint (`GET /api/stats`) returning aggregate counts
  across reports, incidents, and agencies with breakdowns by category,
  severity, and status.
- Next.js App Router API routes:
  - `POST /api/reports` to submit geo-tagged reports with async clustering.
  - `GET /api/reports` to list and filter reports by category, severity,
    status, date range, and geographic bounding box.
  - `GET /api/reports/[id]` to fetch a single report.
  - `PATCH /api/reports/[id]` to update report status.
  - `DELETE /api/reports/[id]` to remove a report.
  - `GET /api/incidents` to list incidents with pagination and status filter.
  - `GET /api/incidents?id=<uuid>` to retrieve a single incident with its
    full timeline.
  - `POST /api/incidents` to forward an incident to an agency.
  - `GET /api/incidents/[id]` to fetch incident details with timeline.
  - `PATCH /api/incidents/[id]` to update status or assign agency.
  - `DELETE /api/incidents/[id]` to remove an incident.
  - `GET /api/incidents/[id]/timeline` to fetch the timeline.
  - `POST /api/incidents/[id]/timeline` to add timeline entries.
  - `GET /api/agencies` to list registered agencies.
  - `GET /api/agencies?scorecard=1` to retrieve accountability scorecards.
  - `POST /api/agencies` to register a new agency.
  - `GET /api/agencies/[id]` to fetch a single agency.
  - `PATCH /api/agencies/[id]` to update agency details.
  - `DELETE /api/agencies/[id]` to remove an agency.
  - `GET /api/agencies/[id]/metrics` to get per-agency scorecard.
  - `GET /api/stats` for summary statistics.
  - `POST /api/upload` for presigned S3 upload URLs.
  - `GET /api/export/[incidentId]` for JSON evidence packets.
  - `GET /api/health` for health checks.
- Initial database migration (`migrations/001_initial_schema.sql`).

## [0.1.0] - 2026-05-28

### Added
- Initial project scaffolding and repository structure.
- README with project description, tech stack overview, quick start
  instructions, and API usage examples.
