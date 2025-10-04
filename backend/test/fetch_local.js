const fetch = require('node-fetch');

async function run(){
  try{
    const url = 'http://localhost:4000/api/forecast?lat=28.6139&lon=77.2090&date=2025-10-04';
    console.log('Requesting', url);
    const res = await fetch(url, {timeout: 10000});
    console.log('Status', res.status);
    const json = await res.json();
    console.log(JSON.stringify(json, null, 2));
  }catch(e){
    console.error('Error', e && e.message);
    process.exitCode = 2;
  }
}

run();
