/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow loading photos from the S3-compatible object storage
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "9000",
        pathname: "/spillwatch/**",
      },
    ],
  },

  // Server-only env vars validated at build time
  serverRuntimeConfig: {
    databaseUrl: process.env.DATABASE_URL,
    s3Endpoint: process.env.S3_ENDPOINT,
    s3AccessKey: process.env.S3_ACCESS_KEY,
    s3SecretKey: process.env.S3_SECRET_KEY,
  },

  // Vars exposed to the browser (prefix with NEXT_PUBLIC_ in .env)
  publicRuntimeConfig: {
    clusterRadiusMeters: parseInt(process.env.CLUSTER_RADIUS_METERS ?? "500", 10),
    clusterTimeWindowHours: parseInt(process.env.CLUSTER_TIME_WINDOW_HOURS ?? "72", 10),
  },
};

module.exports = nextConfig;
