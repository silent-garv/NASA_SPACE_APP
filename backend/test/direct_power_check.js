const fetch = require('node-fetch');

async function callPower(lat, lon, date){
  const params = new URLSearchParams({
    start: date,
    end: date,
    latitude: String(lat),
    longitude: String(lon),
    community: 'AG',
    parameters: 'T2M,PRECTOT,ALLSKY_SFC_SW_DWN,WS2M,RH2M,HI',
    format: 'JSON'
  });
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?${params.toString()}`;
  console.log('POWER URL:', url);
  try{
    const res = await fetch(url, {timeout: 15000});
    console.log('POWER status', res.status, res.statusText);
    const text = await res.text();
    console.log('POWER body preview:\n', text.slice(0,1000));
  }catch(e){ console.error('POWER error', e && e.message); }
}

async function callOpenMeteo(lat, lon, date){
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,relativehumidity_2m_max',
    timezone: 'UTC',
    start_date: date,
    end_date: date
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  console.log('Open-Meteo URL:', url);
  try{
    const res = await fetch(url, {timeout: 15000});
    console.log('Open-Meteo status', res.status, res.statusText);
    const text = await res.text();
    console.log('Open-Meteo body preview:\n', text.slice(0,1000));
  }catch(e){ console.error('Open-Meteo error', e && e.message); }
}

async function run(){
  const lat = '28.6139', lon = '77.2090', date = '2025-09-30';
  await callPower(lat, lon, date);
  await callOpenMeteo(lat, lon, date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8));
}

run();
