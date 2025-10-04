const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PATH = require('path');
const { classifyWeather } = require('./lib/weather');
const PORT = process.env.PORT || 4000;

// Serve static frontend (if present)
const frontPath = PATH.join(__dirname, '..', 'frontend');
app.use(express.static(frontPath));

// Simple wrapper to call NASA POWER API (monthly/daily/hourly) - using the 'daily' endpoint
async function callNasaPower(lat, lon, date){
  // NASA POWER API v2 endpoint for point data
  // We'll request single-day daily data for temperature, precipitation, humidity, windspeed
  const params = new URLSearchParams({
    start: date,
    end: date,
    latitude: String(lat),
    longitude: String(lon),
    community: 'AG',
    // keep a minimal set of widely-supported parameters
    parameters: 'T2M,PRECTOT,WS2M,RH2M',
    format: 'JSON'
  });

  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?${params.toString()}`;
  try{
    const res = await fetch(url);
    if (!res.ok) {
      // don't throw — caller can decide to fallback
      console.warn('POWER returned', res.status);
      return null;
    }
    const json = await res.json();
    return json;
  }catch(e){
    console.warn('POWER fetch error', e && e.message);
    return null;
  }
}

async function callOpenMeteo(lat, lon, date){
  // date: YYYYMMDD -> YYYY-MM-DD
  const d = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    // use a conservative set of daily variables to avoid API parsing issues
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max',
    timezone: 'UTC',
    start_date: d,
    end_date: d
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  try{
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  }catch(e){
    console.warn('Open-Meteo fetch error', e && e.message);
    return null;
  }
}

app.get('/api/forecast', async (req, res) =>{
  try{
    const {lat, lon, date} = req.query;
    if (!lat || !lon || !date) return res.status(400).json({error:'Missing lat, lon, or date (YYYYMMDD)'});

    // Allow common date formats: YYYYMMDD or YYYY-MM-DD
    const normalizedDate = date.replace(/-/g, '');

    let data = await callNasaPower(lat, lon, normalizedDate);
    let om = null;
    let metrics = {tempC: null, humidity: null, precipMM: null, windKmh: null, heatIndexC: null};
    let source = null;

    if (data && data.properties && data.properties.parameter){
      // POWER returned usable data
      const values = data.properties.parameter;
      const dayKey = normalizedDate;
      // POWER sometimes uses slightly different parameter names (e.g. PRECTOTCORR).
      const getParam = (obj, key) => {
        if (!obj) return null;
        if (obj[key] !== undefined) return obj[key];
        const alt = key + 'CORR';
        if (obj[alt] !== undefined) return obj[alt];
        return null;
      };

      const maybe = (p) => {
        const v = getParam(values, p);
        if (v == null) return null;
        // Some POWER responses are objects keyed by date strings, others may be arrays
        if (typeof v === 'object') return v[dayKey] !== undefined ? Number(v[dayKey]) : null;
        return Number(v);
      };

      metrics.tempC = maybe('T2M');
      metrics.precipMM = maybe('PRECTOT');
      const windMs = maybe('WS2M');
      metrics.windKmh = windMs != null ? windMs * 3.6 : null;
      metrics.humidity = maybe('RH2M');
      // heat index may not be provided; leave null if absent
      metrics.heatIndexC = maybe('HI');
      source = 'nasa-power';
    } else {
      // attempt fallback to Open-Meteo
      om = await callOpenMeteo(lat, lon, normalizedDate);
      if (om && om.daily){
        const d = om.daily;
        const tempMax = d.temperature_2m_max ? d.temperature_2m_max[0] : null;
        const tempMin = d.temperature_2m_min ? d.temperature_2m_min[0] : null;
        const precip = d.precipitation_sum ? d.precipitation_sum[0] : null;
        const wind = d.windspeed_10m_max ? d.windspeed_10m_max[0] : null; // km/h
        const rh = d.relativehumidity_2m_max ? d.relativehumidity_2m_max[0] : null;
        metrics.tempC = tempMax != null ? tempMax : tempMin;
        metrics.precipMM = precip;
        metrics.windKmh = wind;
        metrics.humidity = rh;
        metrics.heatIndexC = null;
        source = 'open-meteo';
      }
    }

    // If neither source provided metrics, mark as no-data
    const noData = metrics.tempC == null && metrics.humidity == null && metrics.precipMM == null && metrics.windKmh == null && metrics.heatIndexC == null;
    if (noData && !source) source = 'none';

    const categories = classifyWeather(metrics);

    res.json({
      source,
      date: normalizedDate,
      lat, lon,
      metrics,
      categories,
      noData,
      rawPower: data,
      rawOpenMeteo: om
    });
  }catch(e){
    console.error(e);
    res.status(500).json({error: String(e)});
  }
});

app.listen(PORT, ()=> {
  console.log(`Server running on port ${PORT}`);
  try{ require('fs').writeFileSync(__dirname + '/.server_started','ok'); }catch(e){}
});
