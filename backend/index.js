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

// Helpers for date handling (YYYYMMDD)
function yyyymmddToDate(s){
  const y = Number(s.slice(0,4));
  const m = Number(s.slice(4,6)) - 1;
  const d = Number(s.slice(6,8));
  return new Date(Date.UTC(y,m,d));
}
function dateToYyyymmdd(d){
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  const da = String(d.getUTCDate()).padStart(2,'0');
  return `${y}${m}${da}`;
}
function shiftDays(yyyymmdd, delta){
  const dt = yyyymmddToDate(yyyymmdd);
  dt.setUTCDate(dt.getUTCDate()+delta);
  return dateToYyyymmdd(dt);
}

// Fetch a range from NASA POWER and predict next-day metrics using simple averages
async function callNasaPowerRange(lat, lon, startYmd, endYmd){
  const params = new URLSearchParams({
    start: startYmd,
    end: endYmd,
    latitude: String(lat),
    longitude: String(lon),
    community: 'AG',
    parameters: 'T2M,PRECTOT,WS2M,RH2M',
    format: 'JSON'
  });
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?${params.toString()}`;
  try{
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  }catch(e){
    console.warn('POWER range fetch error', e && e.message);
    return null;
  }
}

async function predictFromHistory(lat, lon, targetYmd){
  // We will average up to the last 7 available days ending the day before the target (or yesterday if target is in the future)
  const todayYmd = dateToYyyymmdd(new Date());
  const maxEnd = shiftDays(todayYmd, -1);
  const end = (targetYmd > todayYmd) ? maxEnd : shiftDays(targetYmd, -1);
  const start = shiftDays(end, -6);
  const hist = await callNasaPowerRange(lat, lon, start, end);
  if (!hist || !hist.properties || !hist.properties.parameter) return null;
  const p = hist.properties.parameter;
  const fill = hist.header ? hist.header.fill_value : undefined;
  const keys = Object.keys(p.T2M || {}).sort();
  if (!keys.length) return null;

  function seriesAvg(obj, convert){
    if (!obj) return null;
    let sum = 0, n = 0;
    for (const k of keys){
      let v = obj[k];
      if (v == null) continue;
      v = Number(v);
      if (!isFinite(v)) continue;
      if (fill !== undefined && v === fill) continue;
      if (convert) v = convert(v);
      sum += v; n++;
    }
    if (n === 0) return null;
    return sum / n;
  }

  const tempC = seriesAvg(p.T2M);
  const precipMM = seriesAvg(p.PRECTOT);
  const windKmh = seriesAvg(p.WS2M, (v)=> v*3.6);
  const humidity = seriesAvg(p.RH2M);

  const metrics = { tempC, precipMM, windKmh, humidity, heatIndexC: null };
  const allNull = metrics.tempC==null && metrics.precipMM==null && metrics.windKmh==null && metrics.humidity==null;
  if (allNull) return null;
  return { metrics, source: 'nasa-power-predicted', rawHistory: hist };
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
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,relativehumidity_2m_max',
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

    // If POWER returned an object but it's just filled with the provider fill_value (e.g. -999),
    // treat it as no-data and allow the fallback to Open-Meteo.
    const dayKey = normalizedDate;
    if (data && data.header && data.properties && data.properties.parameter){
      const fillValue = data.header.fill_value;
      if (fillValue !== undefined && fillValue !== null){
        // check whether every parameter for the requested day equals the fill value or is missing
        const allFill = Object.values(data.properties.parameter).every(v => {
          if (v == null) return true;
          if (typeof v === 'object') return (v[dayKey] === undefined) || (v[dayKey] === fillValue);
          return Number(v) === fillValue;
        });
        if (allFill){
          // ignore POWER data and fall back
          data = null;
        }
      }
    }

    if (data && data.properties && data.properties.parameter){
      // POWER returned usable data
      const values = data.properties.parameter;
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

      // sanitize sentinel and invalid values (POWER sometimes returns -999 or other sentinels)
      const sanitize = (n, key) => {
        if (n === null || n === undefined) return null;
        if (typeof n !== 'number') n = Number(n);
        if (!isFinite(n)) return null;
        // Known sentinel values from some sources: -999, -9999 etc. Treat very large negative numbers as missing.
        if (n <= -900) return null;
        // humidity must be 0-100
        if (key === 'humidity' && (n < 0 || n > 100)) return null;
        // wind can't be negative
        if (key === 'windKmh' && n < 0) return null;
        // precip shouldn't be negative (except sentinel)
        if (key === 'precipMM' && n < 0) return null;
        return n;
      };

      metrics.tempC = sanitize(metrics.tempC, 'tempC');
      metrics.precipMM = sanitize(metrics.precipMM, 'precipMM');
      metrics.windKmh = sanitize(metrics.windKmh, 'windKmh');
      metrics.humidity = sanitize(metrics.humidity, 'humidity');
      metrics.heatIndexC = sanitize(metrics.heatIndexC, 'heatIndexC');
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

      // sanitize fallback metrics as well
      const sanitize = (n, key) => {
        if (n === null || n === undefined) return null;
        if (typeof n !== 'number') n = Number(n);
        if (!isFinite(n)) return null;
        if (n <= -900) return null;
        if (key === 'humidity' && (n < 0 || n > 100)) return null;
        if (key === 'windKmh' && n < 0) return null;
        if (key === 'precipMM' && n < 0) return null;
        return n;
      };

      metrics.tempC = sanitize(metrics.tempC, 'tempC');
      metrics.precipMM = sanitize(metrics.precipMM, 'precipMM');
      metrics.windKmh = sanitize(metrics.windKmh, 'windKmh');
      metrics.humidity = sanitize(metrics.humidity, 'humidity');
      metrics.heatIndexC = sanitize(metrics.heatIndexC, 'heatIndexC');
    }

    // If neither source provided metrics, try predicting from NASA POWER history
    let noData = metrics.tempC == null && metrics.humidity == null && metrics.precipMM == null && metrics.windKmh == null && metrics.heatIndexC == null;
    let rawHistory = null;
    if (noData){
      const pred = await predictFromHistory(lat, lon, normalizedDate);
      if (pred && pred.metrics){
        metrics = pred.metrics;
        source = pred.source;
        rawHistory = pred.rawHistory;
        noData = false; // we now have predicted metrics
      } else if (!source) {
        source = 'none';
      }
    }

    let categories = classifyWeather(metrics);
    // If there is no data, override categories to a special marker so the UI can handle it explicitly
    if (noData) {
      categories = ['no_data'];
    }

    res.json({
      source,
      date: normalizedDate,
      lat, lon,
      metrics,
      categories,
      noData,
      rawPower: data,
      rawOpenMeteo: om,
      rawHistory
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
