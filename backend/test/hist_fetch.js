const fetch = require('node-fetch');

async function run(){
  const d = '2023-09-01';
  const url = `http://localhost:4000/api/forecast?lat=28.6139&lon=77.2090&date=${d}`;
  console.log('Requesting', url);
  try{
    const r = await fetch(url, {timeout: 10000});
    console.log('status', r.status, r.headers.get('content-type'));
    const j = await r.json();
    console.log(JSON.stringify(j, null, 2));
  }catch(e){ console.error('ERR', e && e.message); }
}

run();
