import React, {useState, useEffect, useRef} from 'react'
import ReactDOM from 'react-dom'
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
  // PWA install banner state
  const [installEvt, setInstallEvt] = useState(null);
  const [showInstall, setShowInstall] = useState(true); // always show on refresh
  const searchRef = useRef(null);
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
  // live-location follow state/refs
  const [following, setFollowing] = useState(false);
  const watchIdRef = useRef(null);
  // Quick-access city suggestions for the sidebar
  const otherCities = [
    { country: 'India', name: 'New Delhi', lat: '28.6139', lon: '77.2090' },
    { country: 'Japan', name: 'Tokyo', lat: '35.6762', lon: '139.6503' },
    { country: 'Brazil', name: 'Brasília', lat: '-15.7939', lon: '-47.8828' },
    { country: 'Germany', name: 'Berlin', lat: '52.5200', lon: '13.4050' },
    { country: 'UAE', name: 'Dubai', lat: '25.276987', lon: '55.296249' },
  ];

  // Units: metric (°C, km/h) or imperial (°F, mph)
  const [unit, setUnit] = useState('metric');
  const toF = (c)=> c==null? null : (c*9/5+32);
  const toMph = (kmh)=> kmh==null? null : (kmh/1.609344);

  // Favorites stored in localStorage
  const [favs, setFavs] = useState([]);
  useEffect(()=>{
    // PWA install prompt capture
    function alreadyInstalled(){
      return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    }
    const dismissed = localStorage.getItem('comfortcast:pwaDismissed') === '1';
    function onBIP(e){
      e.preventDefault();
      setInstallEvt(e);
      setShowInstall(true);
    }
    window.addEventListener('beforeinstallprompt', onBIP);
    const onInstalled = ()=>{ setShowInstall(false); setInstallEvt(null); };
    window.addEventListener('appinstalled', onInstalled);
    // Always show banner on refresh unless installed or dismissed
    if (!alreadyInstalled() && !dismissed){
      setShowInstall(true);
    } else {
      setShowInstall(false);
    }
    return ()=>{
      window.removeEventListener('beforeinstallprompt', onBIP);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function triggerInstall(){
    if (!installEvt){ setShowInstall(false); return; }
    try{
      installEvt.prompt();
      const choice = await installEvt.userChoice;
      if (choice && choice.outcome !== 'accepted'){
        // keep banner hidden for this session
        setShowInstall(false);
      }
      setInstallEvt(null);
    }catch(_){ setShowInstall(false); setInstallEvt(null); }
  }

  function dismissInstall(){
    setShowInstall(false);
    try{ localStorage.setItem('comfortcast:pwaDismissed','1'); }catch(_){ }
  }
  useEffect(()=>{
    try{
      const s = localStorage.getItem('comfortcast:favs');
      if (s){ setFavs(JSON.parse(s)); }
      // Load from URL params if present
      const sp = new URLSearchParams(location.search);
      const qLat = sp.get('lat'); const qLon = sp.get('lon'); const qDate = sp.get('date'); const qName = sp.get('q'); const qUnit = sp.get('unit');
      if (qLat && qLon){ setLat(qLat); setLon(qLon); }
      if (qDate){
        // support both YYYYMMDD and YYYY-MM-DD
        const d = qDate.length===8? `${qDate.slice(0,4)}-${qDate.slice(4,6)}-${qDate.slice(6,8)}` : qDate;
        setDate(d);
      }
      if (qName){ setQuery(qName); setSelectedPlace({display_name:qName, lat:qLat, lon:qLon}); }
      if (qUnit && (qUnit==='metric' || qUnit==='imperial')) setUnit(qUnit);
    }catch(e){ /* ignore */ }
  }, []);

  // On first load, try to center on current device location (no watch)
  useEffect(()=>{
    if (navigator.geolocation){
      navigator.geolocation.getCurrentPosition(
        p=>{ setLat(p.coords.latitude.toFixed(6)); setLon(p.coords.longitude.toFixed(6)); },
        ()=>{/* ignore denial */},
        { enableHighAccuracy: true, timeout: 5000 }
      );
    }
  }, []);

  // Keep URL in sync with selections
  useEffect(()=>{
    const sp = new URLSearchParams(location.search);
    sp.set('lat', String(lat)); sp.set('lon', String(lon)); sp.set('date', String(date)); sp.set('unit', unit);
    if (query) sp.set('q', query); else sp.delete('q');
    const url = `${location.pathname}?${sp.toString()}`;
    history.replaceState(null, '', url);
  }, [lat, lon, date, unit, query]);

  function addFavorite(){
    const name = selectedPlace?.display_name || query || `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`;
    const item = { id: `${lat},${lon}`, name, lat, lon };
    const next = [item, ...favs.filter(f=>f.id!==item.id)].slice(0,12);
    setFavs(next);
    try{ localStorage.setItem('comfortcast:favs', JSON.stringify(next)); }catch(e){}
  }
  function removeFavorite(id){
    const next = favs.filter(f=>f.id!==id);
    setFavs(next);
    try{ localStorage.setItem('comfortcast:favs', JSON.stringify(next)); }catch(e){}
  }

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
  // Leaflet map refs
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const lottieRef = useRef(null);

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

  // initialize map once when map-root is present
  useEffect(()=>{
    if (mapRef.current) return;
    const L = window.L;
    if (!L) return;
    const root = document.getElementById('map-root');
    if (!root) return;
    try{
      const map = L.map(root, { zoomControl: true, attributionControl: true }).setView([Number(lat), Number(lon)], 6);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19}).addTo(map);
      mapRef.current = map;
      // create marker with an empty div container
      function createMarker(){
        const div = document.createElement('div');
        div.className = 'lottie-marker';
        div.style.width = '70px'; div.style.height = '70px';
        const icon = L.divIcon({ className: '', html: div.outerHTML, iconSize: [70,70] });
        const marker = L.marker([Number(lat), Number(lon)], { icon, draggable: true }).addTo(map);
        markerRef.current = marker;
        // when marker dragged, update app coords
        marker.on('dragend', (e)=>{
          const ll = e.target.getLatLng();
          setLat(ll.lat.toFixed(6));
          setLon(ll.lng.toFixed(6));
          // user interacted manually; stop following
          setFollowing(false);
        });
      }
      createMarker();
      // clicking on map sets coords
      map.on('click', (e)=>{
        setLat(e.latlng.lat.toFixed(6));
        setLon(e.latlng.lng.toFixed(6));
        // user interacted manually; stop following
        setFollowing(false);
      });
      // ensure map resizes properly when container layout changes
      setTimeout(()=>{ map.invalidateSize(); }, 300);
      // attach lottie when available
      const tryAttach = ()=>{
        const node = root.querySelector('.lottie-marker');
        if (!node) return;
        if (window.lottie && !lottieRef.current){
          lottieRef.current = window.lottie.loadAnimation({container: node, renderer:'svg', loop:true, autoplay:true, path:''});
        }
      };
      setTimeout(tryAttach, 300);
      window.requestAnimationFrame(tryAttach);
    }catch(e){ console.warn('Leaflet init failed', e); }
  }, [lat, lon]);

  // update marker position and lottie animation when lat/lon/result change
  useEffect(()=>{
    const map = mapRef.current; const marker = markerRef.current;
    if (!map || !marker) return;
    try{
      marker.setLatLng([Number(lat), Number(lon)]);
      map.panTo([Number(lat), Number(lon)]);
      // update lottie animation depending on categories
      if (lottieRef.current){
        // choose a small local fallback or remote lottie JSON depending on condition
        const condition = (result && result.categories && result.categories[0]) || 'comfortable';
        const urlMap = {
          very_hot: 'https://assets7.lottiefiles.com/packages/lf20_j1adxtyb.json',
          very_cold: 'https://assets7.lottiefiles.com/packages/lf20_sxq4r1kz.json',
          very_wet: 'https://assets7.lottiefiles.com/packages/lf20_5ngs2ksb.json',
          very_windy: 'https://assets7.lottiefiles.com/packages/lf20_2fdy7kuh.json',
          very_uncomfortable: 'https://assets7.lottiefiles.com/packages/lf20_4kx2q32n.json',
          comfortable: 'https://assets7.lottiefiles.com/packages/lf20_u4yrau.json',
        };
        const path = urlMap[condition] || urlMap.comfortable;
        try{ lottieRef.current.destroy(); }catch(e){}
        lottieRef.current = window.lottie.loadAnimation({container: document.querySelector('.lottie-marker'), renderer:'svg', loop:true, autoplay:true, path});
      }
    }catch(e){ console.warn('Leaflet update failed', e); }
  }, [lat, lon, result]);

  // Start/stop geolocation watch for live following
  useEffect(()=>{
    if (!following){
      if (watchIdRef.current && navigator.geolocation){
        try{ navigator.geolocation.clearWatch(watchIdRef.current); }catch(_){}
      }
      watchIdRef.current = null;
      return;
    }
    if (!navigator.geolocation){
      setFollowing(false);
      return;
    }
    const wid = navigator.geolocation.watchPosition(
      p=>{
        const la = p.coords.latitude.toFixed(6);
        const lo = p.coords.longitude.toFixed(6);
        setLat(la); setLon(lo);
      },
      ()=>{ /* on error, stop following */ setFollowing(false); },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
    watchIdRef.current = wid;
    return ()=>{
      if (watchIdRef.current && navigator.geolocation){
        try{ navigator.geolocation.clearWatch(watchIdRef.current); }catch(_){}
      }
      watchIdRef.current = null;
    };
  }, [following]);

  // Small PWA install button for consistent UI

  return (
    <div className='container' style={{position:'relative'}}>
      <div className='navbar glass' role='navigation' aria-label='Main'>
        <div className='nav-title'>ComfortCast</div>
        <div className='searchbar'>
          <input ref={searchRef} placeholder='Search City or Place' value={query} onChange={e=>{ setQuery(e.target.value); setSelectedPlace(null);} } />
          {places && places.length>0 && searchRef.current && (
            <SuggestionDropdown anchorRef={searchRef} places={places.slice(0,5)} onPick={pickPlace} />
          )}
        </div>
        <div className='nav-links' role='tablist' aria-label='Sections'>
          {/* Unit toggle */}
          <div className='unit-toggle' role='group' aria-label='Units'>
            <button className={unit==='metric'?'active':''} onClick={()=>setUnit('metric')}>°C</button>
            <button className={unit==='imperial'?'active':''} onClick={()=>setUnit('imperial')}>°F</button>
          </div>
          {installEvt && !showInstall && (
            <button className='btn-outline' onClick={triggerInstall} title='Install this app'>Install App</button>
          )}
          <button role='tab' aria-pressed={activeTab==='forecast'} onClick={()=>setActiveTab('forecast')} className={activeTab==='forecast'?'active':''}>Forecast</button>
          <button role='tab' aria-pressed={activeTab==='info'} onClick={()=>setActiveTab('info')} className={activeTab==='info'?'active':''}>Info</button>
        </div>
      </div>

      {activeTab === 'info' ? (
        <div className='card glass'>
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
        <div className='dashboard'>
          {/* Left: Main Weather Card */}
          <div>
            <div className='card glass weather-card'>
              <h1 className='title'>Will it be comfortable?</h1>
              <p className='muted'>Uses NASA POWER (historical) and Open-Meteo (forecast). Shows simple comfort categories.</p>
              <div style={{marginTop:10,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div className='muted'>Location: <strong>{selectedPlace ? selectedPlace.display_name : (lat+", "+lon)}</strong></div>
                <div className='muted'>Date: <strong>{date}</strong></div>
              </div>

              {/* Compact toolbar: latitude / longitude / date / actions */}
              <div className='toolbar' style={{marginTop:12}} role='toolbar' aria-label='Location controls'>
                <label className='toolbar-item'>
                  <span className='sr-only'>Latitude</span>
                  <input aria-label='Latitude' value={lat} onChange={e=>setLat(e.target.value)} placeholder='Lat' />
                </label>
                <label className='toolbar-item'>
                  <span className='sr-only'>Longitude</span>
                  <input aria-label='Longitude' value={lon} onChange={e=>setLon(e.target.value)} placeholder='Lon' />
                </label>
                <label className='toolbar-item'>
                  <span className='sr-only'>Date</span>
                  <input aria-label='Date' type='date' value={date} onChange={e=>setDate(e.target.value)} />
                </label>
                <div style={{marginLeft:'auto', display:'flex', gap:8, alignItems:'center'}}>
                  <button onClick={check} disabled={loading} className={!loading? 'btn-primary':''} aria-live='polite'>
                    {loading ? <span className='spinner' aria-hidden='true'></span> : 'Check Comfort'}
                  </button>
                  <button onClick={()=>{ if (navigator.geolocation) navigator.geolocation.getCurrentPosition(p=>{ setLat(p.coords.latitude.toFixed(6)); setLon(p.coords.longitude.toFixed(6)); }) }} className='btn-outline'>Use my location</button>
                  <button onClick={()=> setFollowing(f=>!f)} className={following? 'btn-primary' : 'btn-outline'} aria-pressed={following} title='Follow live device location'>
                    {following ? 'Following…' : 'Follow me'}
                  </button>
                  <button onClick={addFavorite} className='btn-outline'>Save to Favorites</button>
                </div>
              </div>

              {result && (
                <div style={{marginTop:18}}>
                  <div className='card glass' style={{padding:14}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                      <div>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                          <div className='badge' aria-hidden='true'>{categoryMap[(result.noData ? 'no_data' : result.categories[0])].emoji}</div>
                          <div style={{fontSize:18,marginBottom:6}}><strong>{categoryMap[(result.noData ? 'no_data' : result.categories[0])].message}</strong></div>
                        </div>
                        <div className='muted'>Source: {result.source}</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:14,color:'#6b7280'}}>Comfort Score</div>
                        <div style={{fontSize:20,fontWeight:700}}>{computeComfortScore(result.metrics) ?? 'N/A'}</div>
                        <div className='muted' style={{fontSize:12}}>{comfortRecommendation(computeComfortScore(result.metrics))}</div>
                      </div>
                    </div>

                    <div style={{marginTop:12}}>
                      <div id='map-root' style={{height:220,borderRadius:12,overflow:'hidden'}}></div>
                    </div>

                    {result.noData ? (
                      <div style={{padding:12,background:'rgba(255,246,230,0.8)',borderRadius:8}}>
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
                          <div className='metric'><div className='muted'>Temp ({unit==='metric'?'°C':'°F'})</div><div style={{fontSize:18}}>{(()=>{ const t = result.metrics.tempC; const v = unit==='metric'? t : toF(t); return t==null? 'N/A' : Number(v).toFixed(1); })()}</div></div>
                          <div className='metric'><div className='muted'>Humidity (%)</div><div style={{fontSize:18}}>{(result.metrics.humidity==null)?'N/A':Number(result.metrics.humidity).toFixed(0)}</div></div>
                          <div className='metric'><div className='muted'>Precip (mm)</div><div style={{fontSize:18}}>{(result.metrics.precipMM==null)?'N/A':Number(result.metrics.precipMM).toFixed(1)}</div></div>
                          <div className='metric'><div className='muted'>Wind ({unit==='metric'?'km/h':'mph'})</div><div style={{fontSize:18}}>{(()=>{ const w = result.metrics.windKmh; const v = unit==='metric'? w : toMph(w); return w==null? 'N/A' : Number(v).toFixed(1); })()}</div></div>
                      </div>
                    )}
                    {result && result.source === 'nasa-power-predicted' && (
                      <div style={{marginTop:10,padding:10,background:'rgba(238,246,255,0.85)',borderRadius:8}}>
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
                  <div className='chart-canvas'>
                    <Line data={chartData} options={{responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}}} />
                  </div>
                </div>
              )}

              {error && (<div style={{marginTop:12,color:'crimson'}}><strong>Error: </strong>{error}</div>)}
            </div>
          </div>

          {/* Right: Sidebar with other cities (mobile collapsible) */}
          <aside>
            <details className='mobile-accordion card glass sidebar' open>
              <summary>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                  <div><strong>Other Cities</strong></div>
                  <div className='muted' style={{fontSize:12}}>Quick select</div>
                </div>
              </summary>
              {/* Favorites */}
              {favs.length>0 && (
                <div style={{marginBottom:10}}>
                  <div style={{marginBottom:6}}><strong>Favorites</strong></div>
                  <div className='city-list'>
                    {favs.map(f=> (
                      <div key={f.id} className='city-item' onClick={()=>{ setLat(f.lat); setLon(f.lon); setQuery(f.name); setSelectedPlace({display_name:f.name, lat:f.lat, lon:f.lon}); }}>
                        <div>
                          <div style={{fontWeight:600}}>{f.name}</div>
                          <div className='muted' style={{fontSize:12}}>{Number(f.lat).toFixed(2)}, {Number(f.lon).toFixed(2)}</div>
                        </div>
                        <button className='btn-outline' onClick={(e)=>{ e.stopPropagation(); removeFavorite(f.id); }}>Remove</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className='city-list'>
                {otherCities.map(c => (
                  <div key={c.name} className='city-item' onClick={()=>{ setLat(c.lat); setLon(c.lon); setQuery(`${c.name}, ${c.country}`); setSelectedPlace({display_name:`${c.name}, ${c.country}`, lat:c.lat, lon:c.lon}); }}>
                    <div>
                      <div style={{fontWeight:600}}>{c.name}</div>
                      <div className='muted' style={{fontSize:12}}>{c.country}</div>
                    </div>
                    <div style={{fontSize:18}}>🌤️</div>
                  </div>
                ))}
              </div>
              <div style={{marginTop:10,textAlign:'right',display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className='btn-outline' onClick={()=>{ if (selectedPlace) { check(); } else { check(); } }}>Refresh</button>
                {showInstall && (
                  <button
                    className='btn-outline'
                    style={{fontWeight:'bold',fontSize:'15px',padding:'6px 14px'}}
                    onClick={triggerInstall}
                    title='Install this app'
                  >
                    ⬇ Download App
                  </button>
                )}
              </div>
            </details>
          </aside>
        </div>
      )}

      <div className='footer'>Built with NASA POWER & Open-Meteo — demo</div>
    </div>
  )
}

function SuggestionDropdown({anchorRef, places, onPick}){
  const [rect, setRect] = useState(null);
  useEffect(()=>{
    function update(){
      const el = anchorRef.current;
      if (!el) return setRect(null);
      const r = el.getBoundingClientRect();
      setRect(r);
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return ()=>{ window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); }
  }, [anchorRef]);

  if (!rect) return null;

  // Ensure dropdown fits within viewport on mobile
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const maxWidth = Math.min(rect.width, vw - 16); // 8px margins on both sides
  const left = Math.max(8, Math.min(rect.left, vw - maxWidth - 8));
  const top = rect.bottom + 8;
  const maxHeight = Math.max(160, Math.min(340, vh - top - 12));
  const style = {
    position: 'fixed',
    left,
    top,
    width: maxWidth,
    zIndex: 9999,
    maxHeight,
    overflow: 'auto'
  };

  const node = (
    <div className='place-list portal' style={style}>
      {places.map(p=> (
        <div key={p.place_id} className='place-item' onClick={()=>onPick(p)}>
          <div style={{fontSize:14}}>{p.display_name}</div>
          <div style={{fontSize:12,color:'#666'}}>lat: {p.lat}, lon: {p.lon}</div>
        </div>
      ))}
    </div>
  );

  return ReactDOM.createPortal(node, document.body);
}

