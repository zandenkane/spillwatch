-- SpillWatch initial schema
-- Requires PostgreSQL 14+ with PostGIS extension

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Agencies: government bodies that should respond to incidents
-- (created first because incidents references agencies)
-- ---------------------------------------------------------------------------

CREATE TABLE agencies (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    tier            TEXT NOT NULL CHECK (tier IN ('local', 'state', 'federal')),
    jurisdiction    TEXT NOT NULL,
    contact_email   TEXT,
    contact_phone   TEXT,
    website_url     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agencies_tier ON agencies (tier);

-- ---------------------------------------------------------------------------
-- Incidents: auto-clustered groups of nearby, temporally close reports
-- (created before reports because reports references incidents)
-- ---------------------------------------------------------------------------

CREATE TABLE incidents (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title                 TEXT NOT NULL,
    category              TEXT NOT NULL CHECK (category IN ('air', 'water', 'soil', 'noise', 'waste')),
    severity              TEXT NOT NULL CHECK (severity IN ('low', 'moderate', 'high', 'critical')),
    status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'verified', 'forwarded', 'acknowledged', 'investigating', 'resolved', 'ignored')),
    centroid              GEOGRAPHY(Point, 4326) NOT NULL,
    radius_meters         INTEGER NOT NULL DEFAULT 50,
    report_count          INTEGER NOT NULL DEFAULT 0,
    first_reported_at     TIMESTAMPTZ NOT NULL,
    last_reported_at      TIMESTAMPTZ NOT NULL,
    agency_id             UUID REFERENCES agencies(id) ON DELETE SET NULL,
    foia_tracking_number  TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_incidents_centroid ON incidents USING GIST (centroid);
CREATE INDEX idx_incidents_status ON incidents (status);
CREATE INDEX idx_incidents_agency ON incidents (agency_id) WHERE agency_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Reports: individual observations from community members
-- ---------------------------------------------------------------------------

CREATE TABLE reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category        TEXT NOT NULL CHECK (category IN ('air', 'water', 'soil', 'noise', 'waste')),
    severity        TEXT NOT NULL CHECK (severity IN ('low', 'moderate', 'high', 'critical')),
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'verified', 'forwarded', 'acknowledged', 'investigating', 'resolved', 'ignored')),
    title           TEXT NOT NULL CHECK (char_length(title) <= 200),
    description     TEXT NOT NULL CHECK (char_length(description) <= 5000),
    location        GEOGRAPHY(Point, 4326) NOT NULL,
    address         TEXT,
    photo_urls      TEXT[] NOT NULL DEFAULT '{}',
    reporter_hash   TEXT NOT NULL,
    incident_id     UUID REFERENCES incidents(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spatial index for bounding-box and radius queries
CREATE INDEX idx_reports_location ON reports USING GIST (location);
-- Filter by category + time
CREATE INDEX idx_reports_category_created ON reports (category, created_at DESC);
-- Unclustered reports lookup (used by the clustering service)
CREATE INDEX idx_reports_unclustered ON reports (created_at DESC) WHERE incident_id IS NULL;

-- ---------------------------------------------------------------------------
-- Incident timeline: public audit trail for each incident
-- ---------------------------------------------------------------------------

CREATE TABLE incident_timeline (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id     UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    entry_type      TEXT NOT NULL CHECK (entry_type IN ('report_added', 'forwarded', 'agency_response', 'status_change', 'note')),
    content         TEXT NOT NULL,
    actor_label     TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_timeline_incident ON incident_timeline (incident_id, created_at ASC);
