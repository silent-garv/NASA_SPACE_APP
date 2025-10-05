import React, {useState, useEffect, useRef} from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

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
  const d = String(date).split('-').join('');
  const params = new URLSearchParams({start:d,end:d,latitude:String(lat),longitude:String(lon),community:'AG',parameters:'T2M,PRECTOT,WS2M,RH2M,HI',format:'JSON'});
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?${params.toString()}`;
  try{ const res = await fetch(url); if (!res.ok) return null; return await res.json(); }catch(e){return null}
}

async function fetchOpenMeteo(lat, lon, date){
  const params = new URLSearchParams({latitude:String(lat),longitude:String(lon),daily:'temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max',timezone:'UTC',start_date:date,end_date:date});
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
        const backendRel = `/api/forecast?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&date=${encodeURIComponent(String(date).split('-').join(''))}`;
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
              rawOpenMeteo: bj.rawOpenMeteo || null,
              rawHistory: bj.rawHistory || null
            });
            setLoading(false);
            return;
          }
        } else {
          // Vite dev server sometimes serves index.html for unknown routes (/api/*).
          // Try calling backend directly on port 4000.
          const backendAbs = `http://localhost:4000/api/forecast?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&date=${encodeURIComponent(String(date).split('-').join(''))}`;
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
                  rawOpenMeteo: bj.rawOpenMeteo || null,
                  rawHistory: bj.rawHistory || null
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

  const power = await fetchPower(lat, lon, String(date).split('-').join(''));
    if (power && power.properties && power.properties.parameter){
  const p = power.properties.parameter; const key = String(date).split('-').join('');
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
    comfortable: {emoji:'🙂', message:'Comfortable conditions'},
    no_data: {emoji:'ℹ️', message:'No data available for this date/location'}
  };

  // chart state — a small 7-day chart fetched from Open-Meteo (client-side)
  const [chartData, setChartData] = useState(null);
  const [activeTab, setActiveTab] = useState('forecast');

  // unique feature: compute a Comfort Score (0-100) from metrics
  function computeComfortScore(metrics){
    if (!metrics) return null;
    // helper to coerce and reject sentinel/invalid numbers
    const sanitize = (v, key) => {
      if (v === null || v === undefined) return null;
      const n = Number(v);
      if (!isFinite(n)) return null;
      if (n <= -900) return null; // common sentinel
      if (key === 'humidity' && (n < 0 || n > 100)) return null;
      if ((key === 'windKmh' || key === 'precipMM') && n < 0) return null;
      return n;
    };

    const tempC = sanitize(metrics.tempC, 'tempC');
    const humidity = sanitize(metrics.humidity, 'humidity');
    const precipMM = sanitize(metrics.precipMM, 'precipMM');
    const windKmh = sanitize(metrics.windKmh, 'windKmh');

    // If all key metrics are missing, return null (no score)
    if (tempC == null && humidity == null && precipMM == null && windKmh == null) return null;

    // Base score 100, subtract penalties for temp, humidity, precip, wind
    let score = 100;
    const idealTemp = 22; // °C
    if (tempC != null){
      const tpen = Math.min(40, Math.abs(tempC - idealTemp) * 2); // 2 points per deg C
      score -= tpen;
    }
    if (humidity != null){
      // ideal humidity 40-60
      const h = humidity;
      const hpen = h < 40 ? (40 - h) * 0.5 : h > 60 ? (h - 60) * 0.5 : 0;
      score -= hpen;
    }
    if (precipMM != null && precipMM > 0){ score -= Math.min(30, precipMM * 2); }
    if (windKmh != null && windKmh > 0){ score -= Math.min(20, windKmh * 0.5); }
    score = Math.max(0, Math.min(100, Math.round(score)));
    return score;
  }

  function comfortRecommendation(score){
    if (score == null) return '';
    if (score >= 80) return 'Great — comfortable conditions for most activities.';
    if (score >= 60) return 'Fair — some care recommended (light clothing, water).';
    if (score >= 40) return 'Poor — consider rescheduling outdoor activities.';
    return 'Unsafe/uncomfortable — take strong precautions.';
  }

  async function fetch7Day(lat, lon){
    try{
      const today = new Date();
      const start = new Date(today);
      start.setDate(today.getDate() - 3);
      const end = new Date(today);
      end.setDate(today.getDate() + 3);
      const s = start.toISOString().slice(0,10);
      const e = end.toISOString().slice(0,10);
      const params = new URLSearchParams({latitude:String(lat), longitude:String(lon), daily:'temperature_2m_max,temperature_2m_min,precipitation_sum', timezone:'UTC', start_date:s, end_date:e});
      const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const json = await res.json();
      if (!json.daily) return;
      const labels = json.daily.time || [];
      const temps = (json.daily.temperature_2m_max || []).map((v,i)=> (v + (json.daily.temperature_2m_min ? json.daily.temperature_2m_min[i] : v))/2 );
      setChartData({labels, datasets:[{label:'Avg temp (°C)', data: temps, borderColor:'#2b9cf8', backgroundColor:'rgba(43,156,248,0.15)'}]});
    }catch(e){ console.warn('chart fetch failed', e && e.message); }
  }

  useEffect(()=>{ fetch7Day(lat, lon); }, [lat, lon]);

  return (
    <div className='container'>
      <div className='navbar' role='navigation' aria-label='Main'>
        <div className='nav-title'>ComfortCast</div>
        <div className='nav-links' role='tablist' aria-label='Sections'>
          <button role='tab' aria-pressed={activeTab==='forecast'} onClick={()=>setActiveTab('forecast')} className={activeTab==='forecast'?'active':''}>Forecast</button>
          <button role='tab' aria-pressed={activeTab==='info'} onClick={()=>setActiveTab('info')} className={activeTab==='info'?'active':''}>Info</button>
        </div>
      </div>

      {activeTab === 'info' ? (
        <div className='card'>
          <h2>About this demo</h2>
          <p className='muted'>This prototype uses NASA POWER and Open-Meteo to compute a simple comfort classification and a numeric Comfort Score. If the requested date lacks NASA POWER daily data (or is in the future), we predict values from the previous 7 days of NASA POWER data.</p>
          <ul>
            <li><strong>Search</strong> — find a place by name and autofill lat/lon.</li>
            <li><strong>Forecast</strong> — fetches NASA POWER (historical) and Open-Meteo (forecast) for chosen date.</li>
            <li><strong>7-day chart</strong> — visual quicklook of average temperature around the selected date.</li>
            <li><strong>Comfort Score</strong> — unique numeric score (0-100) combining temperature, humidity, wind and precipitation to help decisions.</li>
            <li><strong>Raw data</strong> — inspect underlying API responses for debugging and transparency.</li>
          </ul>
          <h3>How to use</h3>
          <ol>
            <li>Search for a place or enter latitude/longitude.</li>
            <li>Pick a date and click <em>Check Comfort</em>.</li>
            <li>If available, metrics and chart will appear; if not, a clear 'No data' explanation is shown.</li>
          </ol>
        </div>
      ) : (
        <div className='card'>
          <h1 className='title'>Will it be comfortable?</h1>
          <p className='muted'>Uses NASA POWER (historical) and Open-Meteo (forecast). Shows simple comfort categories.</p>
          <div style={{marginTop:10,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div className='muted'>Location: <strong>{selectedPlace ? selectedPlace.display_name : (lat+", "+lon)}</strong></div>
            <div className='muted'>Date: <strong>{date}</strong></div>
          </div>

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
                  <button onClick={check} disabled={loading} className={!loading? 'btn-primary':''} style={{marginRight:8}} aria-live='polite'>
                    {loading ? <span className='spinner' aria-hidden='true'></span> : 'Check Comfort'}
                  </button>
                  <button onClick={()=>{ if (navigator.geolocation) navigator.geolocation.getCurrentPosition(p=>{ setLat(p.coords.latitude.toFixed(6)); setLon(p.coords.longitude.toFixed(6)); }) }} className='btn-outline'>Use my location</button>
                </div>
              </div>
            </div>
          </div>

          {result && (
            <div style={{marginTop:18}}>
              <div className='card' style={{padding:14}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <div>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <div className='badge' aria-hidden='true'>{categoryMap[(result.noData ? 'no_data' : result.categories[0])].emoji}</div>
                      <div style={{fontSize:18,marginBottom:6}}><strong>{categoryMap[(result.noData ? 'no_data' : result.categories[0])].message}</strong></div>
                    </div>
                    <div className='muted'>Source: {result.source}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    {/* Comfort Score */}
                    <div style={{fontSize:14,color:'#6b7280'}}>Comfort Score</div>
                    <div style={{fontSize:20,fontWeight:700}}>{computeComfortScore(result.metrics) ?? 'N/A'}</div>
                    <div className='muted' style={{fontSize:12}}>{comfortRecommendation(computeComfortScore(result.metrics))}</div>
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
                      <div className='metric'><div className='muted'>Temp (°C)</div><div style={{fontSize:18}}>{(result.metrics.tempC==null)?'N/A':Number(result.metrics.tempC).toFixed(1)}</div></div>
                      <div className='metric'><div className='muted'>Humidity (%)</div><div style={{fontSize:18}}>{(result.metrics.humidity==null)?'N/A':Number(result.metrics.humidity).toFixed(0)}</div></div>
                      <div className='metric'><div className='muted'>Precip (mm)</div><div style={{fontSize:18}}>{(result.metrics.precipMM==null)?'N/A':Number(result.metrics.precipMM).toFixed(1)}</div></div>
                      <div className='metric'><div className='muted'>Wind (km/h)</div><div style={{fontSize:18}}>{(result.metrics.windKmh==null)?'N/A':Number(result.metrics.windKmh).toFixed(1)}</div></div>
                  </div>
                )}
                {result && result.source === 'nasa-power-predicted' && (
                  <div style={{marginTop:10,padding:10,background:'#eef6ff',borderRadius:8}}>
                    <strong>Predicted from NASA POWER history.</strong>
                    <div className='muted' style={{marginTop:4}}>Values are averages computed from up to the previous 7 days of NASA POWER daily data.</div>
                    {result.rawHistory && (
                      <details style={{marginTop:6}}>
                        <summary>Show raw NASA POWER history (7-day window)</summary>
                        <pre style={{maxHeight:220,overflow:'auto'}}>{JSON.stringify(result.rawHistory,null,2)}</pre>
                      </details>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {chartData && (
            <div className='chart-card'>
              <div className='chart-legend'><div><strong>7-day temperature</strong></div><div className='muted'>Avg daily</div></div>
              <Line data={chartData} options={{responsive:true, plugins:{legend:{display:false}}}} />
            </div>
          )}

          {error && (<div style={{marginTop:12,color:'crimson'}}><strong>Error: </strong>{error}</div>)}
        </div>
      )}

      <div className='footer'>Built with NASA POWER & Open-Meteo — demo</div>
    </div>
  )
}

