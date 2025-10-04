NASA Space Apps - Weather Comfort Prototype

Quick start (backend)

1. Open PowerShell and start backend:

   cd backend
   npm install
   node index.js

2. Open `frontend/index.html` in your browser and use the UI to query the backend (or call the backend endpoint directly).

Notes: The backend uses NASA POWER API (https://power.larc.nasa.gov/) and returns categorized labels like `very_hot`, `very_wet`, etc. See `backend/lib/weather.js` for classification thresholds.

Sample API response (example run for New Delhi, 2025-10-06)

```
{
   "source": "open-meteo",
   "date": "20251006",
   "lat": 28.6139,
   "lon": 77.209,
   "metrics": {
      "tempC": null,
      "humidity": null,
      "precipMM": null,
      "windKmh": null,
      "heatIndexC": null
   },
   "categories": [ "comfortable" ]
}
```

Note: In this example NASA POWER returned no daily data for the requested date (422), so the prototype falls back to Open-Meteo (forecast). The frontend shows the data source for transparency — be sure to highlight "Powered by NASA POWER" in your demo slides when POWER data is used.

