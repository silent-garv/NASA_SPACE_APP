const fetch = require('node-fetch');

async function callPowerNorm(lat, lon, yyyymmdd){
  const params = new URLSearchParams({
    start: yyyymmdd,
    end: yyyymmdd,
    latitude: String(lat),
    longitude: String(lon),
    community: 'AG',
    parameters: 'T2M,PRECTOT,WS2M,RH2M',
    format: 'JSON'
  });
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?${params.toString()}`;
  console.log('POWER URL:', url);
  try{
    const res = await fetch(url, {timeout:15000});
    console.log('POWER status', res.status);
    const json = await res.json();
    console.log('POWER JSON keys:', Object.keys(json));
    console.log('properties keys:', json.properties ? Object.keys(json.properties) : null);
    if (json.properties && json.properties.parameter){
      console.log('parameter keys:', Object.keys(json.properties.parameter));
      const key = yyyymmdd;
      console.log('sample values:', JSON.stringify(Object.fromEntries(Object.entries(json.properties.parameter).map(([k,v])=>[k, v ? v[key] : null])), null, 2));
    } else {
      console.log('no parameter in POWER response');
      console.log(JSON.stringify(json).slice(0,800));
    }
  }catch(e){ console.error('POWER error', e && e.message); }
}

async function callOpenMeteoNorm(lat, lon, yyyymmdd){
  const d = `${yyyymmdd.slice(0,4)}-${yyyymmdd.slice(4,6)}-${yyyymmdd.slice(6,8)}`;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max',
    timezone:'UTC',
    start_date: d,
    end_date: d
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  console.log('Open-Meteo URL:', url);
  try{
    const res = await fetch(url, {timeout:15000});
    console.log('Open-Meteo status', res.status);
    const json = await res.json();
    console.log('Open-Meteo keys:', Object.keys(json));
    if (json.daily) console.log('daily keys:', Object.keys(json.daily));
    console.log(JSON.stringify(json).slice(0,800));
  }catch(e){ console.error('Open-Meteo error', e && e.message); }
}

async function run(){
  const lat = '28.6139', lon = '77.2090', date = '20230901';
  await callPowerNorm(lat, lon, date);
  await callOpenMeteoNorm(lat, lon, date);
}

run();
