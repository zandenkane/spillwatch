# contributing to spillwatch

This is a Next.js app with TypeScript.

Setup:
- Copy .env.example to .env.local
- You need a PostGIS database running
- `npm install` then `npm run dev`

Tests: `npm test`

If you want to add a new API route, put it under src/app/api/. Follow the existing pattern for validation and error handling.
