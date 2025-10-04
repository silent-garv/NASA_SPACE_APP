const fetch = require('node-fetch');

async function run(){
  const dates = ['2025-10-04','2025-10-03','2025-09-30'];
  for (const d of dates){
    const url = `http://localhost:4000/api/forecast?lat=28.6139&lon=77.2090&date=${d}`;
    console.log('\n===', url);
    try{
      const r = await fetch(url, {timeout: 10000});
      console.log('status', r.status, 'ctype', r.headers.get('content-type'));
      const j = await r.json();
      console.log(JSON.stringify(j, null, 2));
    }catch(e){
      console.error('ERR', e && e.message);
    }
  }
}

run();
