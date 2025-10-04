const fetch = require('node-fetch');

async function run(){
  const url = 'http://localhost:4000/api/forecast?lat=28.6139&lon=77.2090&date=20251006';
  const res = await fetch(url);
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}

run().catch(e=>{console.error(e); process.exit(1)});
