// Vercel serverless function implementing the original backend /api/forecast logic
const { URLSearchParams } = require('url');

// classifyWeather (copied from backend/lib/weather.js)
function classifyWeather({tempC, humidity, precipMM, windKmh, heatIndexC}){
  const categories = [];
  if (tempC != null && tempC >= 35) categories.push('very_hot');
  if (tempC != null && tempC <= 5) categories.push('very_cold');
  if ((precipMM || 0) >= 5) categories.push('very_wet');
  if ((windKmh || 0) >= 20) categories.push('very_windy');
  if ((heatIndexC || tempC) != null && ((heatIndexC || tempC) >= 32 || (humidity || 0) >= 80)) categories.push('very_uncomfortable');
  if (categories.length === 0) categories.push('comfortable');
  return categories;
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

async function callNasaPower(lat, lon, date){
  const params = new URLSearchParams({
    start: date,
    end: date,
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
    console.warn('POWER fetch error', e && e.message);
    return null;
  }
}

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

async function callOpenMeteo(lat, lon, date){
  const d = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
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

module.exports = async function handler(req, res){
  try{
    const { lat, lon, date } = req.method === 'GET' ? req.query : req.body;
    if (!lat || !lon || !date) return res.status(400).json({error:'Missing lat, lon, or date (YYYYMMDD)'});
    const normalizedDate = String(date).replace(/-/g, '');

    let data = await callNasaPower(lat, lon, normalizedDate);
    let om = null;
    let metrics = {tempC: null, humidity: null, precipMM: null, windKmh: null, heatIndexC: null};
    let source = null;

    const dayKey = normalizedDate;
    if (data && data.header && data.properties && data.properties.parameter){
      const fillValue = data.header.fill_value;
      if (fillValue !== undefined && fillValue !== null){
        const allFill = Object.values(data.properties.parameter).every(v => {
          if (v == null) return true;
          if (typeof v === 'object') return (v[dayKey] === undefined) || (v[dayKey] === fillValue);
          return Number(v) === fillValue;
        });
        if (allFill) data = null;
      }
    }

    if (data && data.properties && data.properties.parameter){
      const values = data.properties.parameter;
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
        if (typeof v === 'object') return v[dayKey] !== undefined ? Number(v[dayKey]) : null;
        return Number(v);
      };

      metrics.tempC = maybe('T2M');
      metrics.precipMM = maybe('PRECTOT');
      const windMs = maybe('WS2M');
      metrics.windKmh = windMs != null ? windMs * 3.6 : null;
      metrics.humidity = maybe('RH2M');
      metrics.heatIndexC = maybe('HI');

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
      source = 'nasa-power';
    } else {
      om = await callOpenMeteo(lat, lon, normalizedDate);
      if (om && om.daily){
        const d = om.daily;
        const tempMax = d.temperature_2m_max ? d.temperature_2m_max[0] : null;
        const tempMin = d.temperature_2m_min ? d.temperature_2m_min[0] : null;
        const precip = d.precipitation_sum ? d.precipitation_sum[0] : null;
        const wind = d.windspeed_10m_max ? d.windspeed_10m_max[0] : null;
        const rh = d.relativehumidity_2m_max ? d.relativehumidity_2m_max[0] : null;
        metrics.tempC = tempMax != null ? tempMax : tempMin;
        metrics.precipMM = precip;
        metrics.windKmh = wind;
        metrics.humidity = rh;
        metrics.heatIndexC = null;
        source = 'open-meteo';
      }

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

    let noData = metrics.tempC == null && metrics.humidity == null && metrics.precipMM == null && metrics.windKmh == null && metrics.heatIndexC == null;
    let rawHistory = null;
    if (noData){
      const pred = await predictFromHistory(lat, lon, normalizedDate);
      if (pred && pred.metrics){
        metrics = pred.metrics;
        source = pred.source;
        rawHistory = pred.rawHistory;
        noData = false;
      } else if (!source) {
        source = 'none';
      }
    }

    let categories = classifyWeather(metrics);
    if (noData) categories = ['no_data'];

    res.setHeader('Content-Type','application/json');
    res.status(200).send(JSON.stringify({
      source,
      date: normalizedDate,
      lat, lon,
      metrics,
      categories,
      noData,
      rawPower: data,
      rawOpenMeteo: om,
      rawHistory
    }));
  }catch(e){
    console.error(e);
    res.status(500).json({error: String(e)});
  }
};
