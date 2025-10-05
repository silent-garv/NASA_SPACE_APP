NASA Space Apps - Weather Comfort Prototype
## NASA Space Apps — Weather Comfort Prototype

This repository contains a small prototype that queries weather data (NASA POWER + Open-Meteo) and returns a small set of metrics and human-friendly categories (e.g. `very_hot`, `very_wet`, `comfortable`). The project has a Vite-based frontend and a Node backend; the backend is provided as a local Express server (for dev) and also as a Vercel serverless function (`api/forecast.js`) for deployment.

Contents
- `frontend/` — Vite + React UI (builds to `dist`)
- `backend/` — original Express backend for local development (exports the app)
- `api/forecast.js` — Vercel-compatible serverless function implementing the backend API
- `vercel.json` — Vercel build and route configuration
- `package.json` (root) — top-level manifest with build script used by Vercel

Key behaviors
- Query order: try NASA POWER daily point endpoint → if data missing/fill-value → fallback to Open-Meteo → if still missing, predict from recent NASA POWER history.
- Response includes: `source`, `date`, `lat`, `lon`, `metrics`, `categories`, and raw provider data when available.

Quick links
- Backend code (local express): `backend/index.js`
- Classification rules: `backend/lib/weather.js`
- Serverless API for Vercel: `api/forecast.js`

Requirements
- Node.js 18.x or later (Vercel uses Node 18+; repository declares `engines.node: 18.x`)
- npm

Local development

1) Frontend (local preview)

Install and build the frontend (from repo root or inside `frontend`):

```powershell
cd frontend
npm install
npm run dev      # for development (vite)
# or build for production preview
npm run build
npm run preview
```

2) Backend (local Express server — optional)

The `backend` folder contains an Express server intended for local development and tests. You can run it directly. The server will try port 4000 by default and fall back to 5000 if 4000 is occupied.

```powershell
cd backend
npm install
npm run start    # runs `node index.js` — uses PORT env or default 4000 then fallback 5000

# Run on a specific port for this shell only (e.g. 5000):
$env:PORT=5000; npm run start
```

If you see `EADDRINUSE` when starting, another process is using that port. To free it:

```powershell
# find listening processes on port 4000
netstat -ano | Select-String ":4000\s+LISTENING"
# kill the PID from the previous command
taskkill /PID <PID> /F
```

Tip: If your repository is inside OneDrive you may occasionally see file/lock issues when installing node modules; try pausing OneDrive sync or moving the repo outside OneDrive if installation fails.

API (serverless and local)

The API endpoint is `/api/forecast`.

Query parameters (GET) or JSON body (POST):
- `lat` — latitude (decimal)
- `lon` — longitude (decimal)
- `date` — YYYYMMDD or YYYY-MM-DD

Example request (GET):

```powershell
curl "http://localhost:4000/api/forecast?lat=28.6139&lon=77.209&date=2025-10-06"
```

Sample response (abridged):

```json
{
  "source": "open-meteo",
  "date": "20251006",
  "lat": 28.6139,
  "lon": 77.209,
  "metrics": { "tempC": null, "humidity": null, "precipMM": null, "windKmh": null, "heatIndexC": null },
  "categories": ["comfortable"]
}
```

Vercel deployment

This repo is set up for deployment to Vercel as a monorepo:
- `frontend` is built with the `@vercel/static-build` preset (Vite build → `dist`).
- `api/*.js` files are deployed as serverless functions via the `@vercel/node` builder.

Steps to deploy:

1. Push your repo to GitHub (or another supported git provider).
2. In Vercel, import the repository and select the `main` branch.
3. Vercel will use `vercel.json` to build the frontend and deploy the `api/` functions. No further config is required.

Local testing vs Vercel
- Vercel runs the serverless function in a serverless environment and does not use the `backend/index.js` Express server. The `api/forecast.js` implementation is self-contained, so Vercel will host `/api/forecast` as a function automatically.

Troubleshooting
- npm install failures on Windows (EPERM) may be caused by editors/antivirus/OneDrive file locks. Try closing VS Code, pausing OneDrive, or running PowerShell as Administrator.
- If `npm run start` in `backend` exits due to port conflicts, either kill the process on that port or run with a different `PORT` value as shown above.

Notes and next steps
- `api/forecast.js` currently duplicates some logic from `backend/index.js` so the Vercel function is self-contained. If you prefer a single source of truth, we can refactor common functions into a shared module and import it from both places.
- If you want automatic testing or a CI pipeline for Vercel preview deployments, I can add a small GitHub Actions workflow.

License
- MIT

Contact
- For questions or to request changes, open an issue or contact the project maintainer.

