const fetch = require('node-fetch');
const { classifyWeather } = require('../lib/weather');

async function run(){
  const lat = 28.6139, lon = 77.2090, date = '20251006';
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
  const res = await fetch(url);
  const data = await res.json();
  const values = (data && data.properties && data.properties.parameter) || {};
  const dayKey = date;
  const tempC = values.T2M ? Number(values.T2M[dayKey]) : null;
  const precipMM = values.PRECTOT ? Number(values.PRECTOT[dayKey]) : null;
  const windMs = values.WS2M ? Number(values.WS2M[dayKey]) : null;
  const windKmh = windMs != null ? windMs * 3.6 : null;
  const humidity = values.RH2M ? Number(values.RH2M[dayKey]) : null;
  const heatIndexC = values.HI ? Number(values.HI[dayKey]) : null;
  const categories = classifyWeather({tempC, humidity, precipMM, windKmh, heatIndexC});
  console.log({date, lat, lon, metrics:{tempC, humidity, precipMM, windKmh, heatIndexC}, categories});
}

run().catch(e=>{console.error(e); process.exit(1)});
