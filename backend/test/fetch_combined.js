const fetch = require('node-fetch');
const { classifyWeather } = require('../lib/weather');

async function callPower(lat, lon, date){
  const params = new URLSearchParams({
    start: date,
    end: date,
    latitude: String(lat),
    longitude: String(lon),
    community: 'AG',
    parameters: 'T2M,PRECTOT,WS2M,RH2M,HI',
    format: 'JSON'
  });
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?${params.toString()}`;
  try{
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  }catch(e){
    return null;
  }
}

async function callOpenMeteo(lat, lon, date){
  // date: YYYYMMDD -> YYYY-MM-DD
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
  const res = await fetch(url);
  if (!res.ok) throw new Error('Open-Meteo error '+res.status);
  return res.json();
}

async function run(){
  const lat = 28.6139, lon = 77.2090, date = '20251006';
  console.log('Querying NASA POWER for', date);
  const power = await callPower(lat, lon, date);
  // inspect POWER parameters
  const values = (power && power.properties && power.properties.parameter) || {};
  const dayKey = date;
  const tempC = values.T2M ? Number(values.T2M[dayKey]) : null;
  const precipMM = values.PRECTOT ? Number(values.PRECTOT[dayKey]) : null;
  const windMs = values.WS2M ? Number(values.WS2M[dayKey]) : null;
  const windKmh = windMs != null ? windMs * 3.6 : null;
  const humidity = values.RH2M ? Number(values.RH2M[dayKey]) : null;
  const heatIndexC = values.HI ? Number(values.HI[dayKey]) : null;

  if (tempC == null && precipMM == null && windKmh == null && humidity == null){
    console.log('POWER returned no data for that date — falling back to Open-Meteo (forecast)');
  let om;
  try{ om = await callOpenMeteo(lat, lon, date); }catch(e){ om = null; }
  // map Open-Meteo daily fields
  const daily = (om && om.daily) || {};
    const omTempMax = daily.temperature_2m_max ? daily.temperature_2m_max[0] : null;
    const omTempMin = daily.temperature_2m_min ? daily.temperature_2m_min[0] : null;
    const omPrecip = daily.precipitation_sum ? daily.precipitation_sum[0] : null;
    const omWind = daily.windspeed_10m_max ? daily.windspeed_10m_max[0] : null; // km/h
    const omRh = daily.relativehumidity_2m_max ? daily.relativehumidity_2m_max[0] : null;
    const temp = omTempMax != null ? omTempMax : (omTempMin != null ? omTempMin : null);
    const metrics = {tempC: temp, humidity: omRh, precipMM: omPrecip, windKmh: omWind, heatIndexC: null};
  const categories = classifyWeather(metrics);
  console.log({source:'open-meteo', date, lat, lon, metrics, categories});
  if (!om) console.log('Open-Meteo returned no data');
  } else {
    const metrics = {tempC, humidity, precipMM, windKmh, heatIndexC};
    const categories = classifyWeather(metrics);
    console.log({source:'power', date, lat, lon, metrics, categories});
  }
}

run().catch(e=>{console.error(e); process.exit(1)});
