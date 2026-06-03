/**
 * Health check endpoint.
 *
 * GET /api/health
 *
 * Returns 200 if the app is running and can reach the database.
 * Used by Docker health checks and load balancers.
 */

import { NextResponse } from "next/server";
import { query } from "../../../lib/db";

interface HealthStatus {
  status: "ok" | "degraded";
  timestamp: string;
  database: "connected" | "unreachable";
}

export async function GET(): Promise<NextResponse<HealthStatus>> {
  let dbStatus: "connected" | "unreachable" = "unreachable";

  try {
    await query("SELECT 1");
    dbStatus = "connected";
  } catch {
    // Database unreachable; report degraded but don't crash
  }

  const status: HealthStatus = {
    status: dbStatus === "connected" ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    database: dbStatus,
  };

  const httpStatus = dbStatus === "connected" ? 200 : 503;
  return NextResponse.json(status, { status: httpStatus });
}
