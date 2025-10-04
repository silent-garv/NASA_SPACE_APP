import React, {useState, useEffect, useRef} from 'react'

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

async function fetchPower(lat, lon, date){
  const d = date.replace(/-/g,'');
  const params = new URLSearchParams({start:d,end:d,latitude:String(lat),longitude:String(lon),community:'AG',parameters:'T2M,PRECTOT,WS2M,RH2M,HI',format:'JSON'});
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?${params.toString()}`;
  try{ const res = await fetch(url); if (!res.ok) return null; return await res.json(); }catch(e){return null}
}

async function fetchOpenMeteo(lat, lon, date){
  const params = new URLSearchParams({latitude:String(lat),longitude:String(lon),daily:'temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,relativehumidity_2m_max',timezone:'UTC',start_date:date,end_date:date});
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  try{ const res = await fetch(url); if (!res.ok) return null; return await res.json(); }catch(e){return null}
}

export default function App(){
  const [lat,setLat] = useState('28.6139');
  const [lon,setLon] = useState('77.2090');
  const [date,setDate] = useState(new Date().toISOString().slice(0,10));
  const [loading,setLoading] = useState(false);
  const [result,setResult] = useState(null);
  const [error,setError] = useState(null);
  const [query,setQuery] = useState('');
  const [places,setPlaces] = useState([]);
  const [selectedPlace,setSelectedPlace] = useState(null);
  const debounceRef = useRef(null);

  useEffect(()=>{
    if (!query || query.length < 3){ setPlaces([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async ()=>{
      try{
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`;
        const res = await fetch(url, {headers: {'User-Agent':'NASA-Space-Apps-Demo'}});
        if (!res.ok) return;
        const json = await res.json();
        setPlaces(json);
      }catch(e){
        // ignore
      }
    }, 400);
    return ()=>{ if (debounceRef.current) clearTimeout(debounceRef.current); }
  }, [query]);

  function pickPlace(p){
    setSelectedPlace(p);
    setLat(p.lat);
    setLon(p.lon);
    setQuery(p.display_name);
    setPlaces([]);
  }

  async function check(){
    setLoading(true); setResult(null); setError(null);
    // Prefer backend when available to centralize API calls and CORS handling
    try{
      const backendRel = `/api/forecast?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&date=${encodeURIComponent(date.replace(/-/g,''))}`;
      let bres = await fetch(backendRel, { cache: 'no-store' });
      if (bres && bres.ok){
        const ctype = (bres.headers.get('content-type') || '').toLowerCase();
        if (ctype.includes('application/json')){
          const bj = await bres.json();
          if (bj && bj.metrics){
            setResult({
              source: bj.source || 'backend',
              metrics: bj.metrics,
              categories: bj.categories || classifyWeather(bj.metrics),
              noData: bj.noData || false,
              rawPower: bj.rawPower || null,
              rawOpenMeteo: bj.rawOpenMeteo || null
            });
            setLoading(false);
            return;
          }
        } else {
          // Vite dev server sometimes serves index.html for unknown routes (/api/*).
          // Try calling backend directly on port 4000.
          const backendAbs = `http://localhost:4000/api/forecast?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&date=${encodeURIComponent(date.replace(/-/g,''))}`;
          try{
            bres = await fetch(backendAbs, { cache: 'no-store' });
            if (bres && bres.ok){
              const bj = await bres.json();
              if (bj && bj.metrics){
                setResult({
                  source: bj.source || 'backend',
                  metrics: bj.metrics,
                  categories: bj.categories || classifyWeather(bj.metrics),
                  noData: bj.noData || false,
                  rawPower: bj.rawPower || null,
                  rawOpenMeteo: bj.rawOpenMeteo || null
                });
                setLoading(false);
                return;
              }
            }
          }catch(e){
            setError('Backend absolute fetch failed: ' + (e && e.message));
          }
        }
      }
    }catch(e){
      // fallback to client-side APIs below
      setError('Backend fetch failed: ' + (e && e.message));
    }

    const power = await fetchPower(lat, lon, date.replace(/-/g,''));
    if (power && power.properties && power.properties.parameter){
      const p = power.properties.parameter; const key = date.replace(/-/g,'');
      const tempC = p.T2M ? Number(p.T2M[key]) : null;
      const precipMM = p.PRECTOT ? Number(p.PRECTOT[key]) : null;
      const windMs = p.WS2M ? Number(p.WS2M[key]) : null; const windKmh = windMs != null ? windMs*3.6 : null;
      const humidity = p.RH2M ? Number(p.RH2M[key]) : null; const heatIndexC = p.HI ? Number(p.HI[key]) : null;
      const metrics = {tempC, humidity, precipMM, windKmh, heatIndexC};
      setResult({source:'NASA POWER', metrics, categories: classifyWeather(metrics)});
      setLoading(false); return;
    }
    const om = await fetchOpenMeteo(lat, lon, date);
    if (om && om.daily){
      const d = om.daily; const tempMax = d.temperature_2m_max ? d.temperature_2m_max[0] : null; const tempMin = d.temperature_2m_min ? d.temperature_2m_min[0] : null;
      const precip = d.precipitation_sum ? d.precipitation_sum[0] : null; const wind = d.windspeed_10m_max ? d.windspeed_10m_max[0] : null; const rh = d.relativehumidity_2m_max ? d.relativehumidity_2m_max[0] : null;
      const temp = tempMax != null ? tempMax : tempMin; const metrics = {tempC:temp, humidity:rh, precipMM:precip, windKmh:wind, heatIndexC:null};
      setResult({source:'Open-Meteo', metrics, categories: classifyWeather(metrics)});
      setLoading(false); return;
    }
    setResult({source:'none', metrics:{}, categories:['comfortable']}); setLoading(false);
  }

  const categoryMap = {
    very_hot: {emoji:'🔥', message:'Very hot — stay hydrated'},
    very_cold: {emoji:'❄️', message:'Very cold — dress warmly'},
    very_wet: {emoji:'🌧️', message:'Very wet — bring an umbrella'},
    very_windy: {emoji:'💨', message:'Very windy — secure loose items'},
    very_uncomfortable: {emoji:'🥵', message:'Uncomfortable — watch heat index'},
    comfortable: {emoji:'🙂', message:'Comfortable conditions'}
  };

  return (
    <div className='container'>
      <div className='card'>
        <h1 className='title'>Will it be comfortable?</h1>
        <p className='muted'>Uses NASA POWER (historical) and Open-Meteo (forecast). Shows simple comfort categories.</p>

        <div className='controls' style={{marginTop:12}}>
          <div style={{flex:1}}>
            <input placeholder='Search place (e.g., New Delhi)' value={query} onChange={e=>{ setQuery(e.target.value); setSelectedPlace(null); }} style={{width:'100%'}} />
            {places && places.length>0 && (
              <div className='place-list'>
                {places.map(p=> (
                  <div key={p.place_id} className='place-item' onClick={()=>pickPlace(p)}>
                    <div style={{fontSize:14}}>{p.display_name}</div>
                    <div style={{fontSize:12,color:'#666'}}>lat: {p.lat}, lon: {p.lon}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{minWidth:320}}>
            <div className='row'>
              <label style={{flex:1}}>Latitude <input value={lat} onChange={e=>setLat(e.target.value)} /></label>
              <label style={{flex:1}}>Longitude <input value={lon} onChange={e=>setLon(e.target.value)} /></label>
            </div>
            <div className='row' style={{marginTop:8,justifyContent:'space-between',alignItems:'center'}}>
              <label>Date <input type='date' value={date} onChange={e=>setDate(e.target.value)} /></label>
              <div>
                <button onClick={check} disabled={loading} style={{marginRight:8}}>{loading? 'Checking...':'Check Comfort'}</button>
                <button onClick={()=>{ if (navigator.geolocation) navigator.geolocation.getCurrentPosition(p=>{ setLat(p.coords.latitude.toFixed(6)); setLon(p.coords.longitude.toFixed(6)); }) }}>Use my location</button>
              </div>
            </div>
          </div>
        </div>

        {result && (
          <div style={{marginTop:18}}>
            <div className='card' style={{padding:14}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div>
                  <div style={{fontSize:18,marginBottom:6}}><strong>{categoryMap[result.categories[0]].emoji} {categoryMap[result.categories[0]].message}</strong></div>
                  <div className='muted'>Source: {result.source}</div>
                </div>
              </div>

                    {result.noData ? (
                      <div style={{padding:12,background:'#fff6e6',borderRadius:8}}>
                        <strong>No data available for this date/location.</strong>
                        <div className='muted' style={{marginTop:6}}>The backend couldn't find daily values from NASA POWER or Open-Meteo for this query. Try another date (historical) or location.</div>
                        {result.rawPower && (
                          <details style={{marginTop:8}}>
                            <summary>Show raw NASA POWER response</summary>
                            <pre style={{maxHeight:200,overflow:'auto'}}>{JSON.stringify(result.rawPower,null,2)}</pre>
                          </details>
                        )}
                        {result.rawOpenMeteo && (
                          <details style={{marginTop:8}}>
                            <summary>Show raw Open-Meteo response</summary>
                            <pre style={{maxHeight:200,overflow:'auto'}}>{JSON.stringify(result.rawOpenMeteo,null,2)}</pre>
                          </details>
                        )}
                      </div>
                    ) : (
                      <div className='metrics'>
                        <div className='metric'><div className='muted'>Temp (°C)</div><div style={{fontSize:18}}>{result.metrics.tempC ?? 'N/A'}</div></div>
                        <div className='metric'><div className='muted'>Humidity (%)</div><div style={{fontSize:18}}>{result.metrics.humidity ?? 'N/A'}</div></div>
                        <div className='metric'><div className='muted'>Precip (mm)</div><div style={{fontSize:18}}>{result.metrics.precipMM ?? 'N/A'}</div></div>
                        <div className='metric'><div className='muted'>Wind (km/h)</div><div style={{fontSize:18}}>{result.metrics.windKmh ?? 'N/A'}</div></div>
                      </div>
                    )}
            </div>
          </div>
        )}
              {error && (<div style={{marginTop:12,color:'crimson'}}><strong>Error: </strong>{error}</div>)}
      </div>
    </div>
  )
}

