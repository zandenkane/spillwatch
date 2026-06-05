# SpillWatch

![CI](https://github.com/zandenkane/spillwatch/actions/workflows/ci.yml/badge.svg)

someone is dumping mystery liquid into the creek behind your house. you call the state. they say they will look into it. they do not look into it. the creek smells like batteries now.

spillwatch lets communities report environmental incidents with GPS coordinates, upload photo evidence, and track whether the responsible government agency actually does anything about it. spoiler: it scores them on response time so you can see exactly how much they do not care.

## What It Does

SpillWatch is a self-hostable Next.js app for tracking environmental incidents. Community members submit geo-tagged reports. The system clusters nearby reports into incidents automatically. Then it tracks whether any government agency actually does anything about it. Spoiler: the scorecard makes it very clear when they don't.

Here is what is actually in the code right now:

- **Report submission** with GPS coordinates, photos, category tags (air, water, soil, noise, waste), and severity levels
- **Automatic spatial clustering** so multiple witnesses corroborate the same event without manual grouping. Configurable radius and time window. Periodic DBSCAN pass catches what pairwise matching misses.
- **Public accountability timelines** on every incident. Who reported it. When it got forwarded. Whether the agency responded. Whether they fixed it. Or whether they just ignored it like they usually do.
- **Agency scorecards.** Median response time. Resolution rate. Ignored rate. Per agency. Over any time period you want. The numbers do not lie.
- **Evidence export.** JSON packets with every report, GPS coordinate, timestamp, the full timeline, and the agency scorecard. Feed it into a PDF renderer, attach it to a FOIA request, hand it to a journalist.
- **Presigned S3 uploads** for photos so large files never touch the app server
- **Summary statistics** across reports, incidents, and agencies

## Stack

- Next.js 14 with App Router (TypeScript)
- PostgreSQL 16 with PostGIS for spatial queries
- Any S3-compatible object storage for photos
- Vitest for tests

## Get It Running

You need Node.js 20+, PostgreSQL 16 with PostGIS, and an S3-compatible store (MinIO works fine locally).

```bash
git clone https://github.com/zandenkane/spillwatch.git
cd spillwatch
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

Then open `http://localhost:3000`.

Check `.env.example` for the full list of environment variables. The important ones:

- `DATABASE_URL` for your Postgres connection
- `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` for photo storage
- `CLUSTER_RADIUS_METERS` (default 500), `CLUSTER_TIME_WINDOW_HOURS` (default 72), `CLUSTER_MIN_REPORTS` (default 2) for clustering behavior

## Tests

```bash
npm test
```

99 tests. Validation, service layer, S3 helpers, clustering config, enum coverage. All run without a database.

## License

MIT
