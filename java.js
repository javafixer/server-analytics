// --- Utilities (no localStorage persistence) ---
function loadHistory(){ return []; }
function saveHistory(h){ /* no-op: history kept in-memory only */ }
async function loadServers() {
    // Fetch JSON
    const response = await fetch('servers.json');
    const servers = await response.json();

    const serverList = document.getElementById('serverList');
    serverList.innerHTML = ''; // clear any existing content

    servers.forEach(server => {
        const card = document.createElement('div');
        card.className = 'server-card';
        card.dataset.addr = server.address;

        card.innerHTML = `
            <h2>${server.name}</h2>
            <div class="players">Loading...</div>
            <div class="status">Checking...</div>
        `;

        serverList.appendChild(card);
    });

    // Once generated, fetch statuses and make clickable
    updateServerList();
    makeServerCardsClickable();
}

document.addEventListener('DOMContentLoaded', loadServers);

// --- DOM references ---
const serverInput = document.getElementById('serverInput');
const checkBtn = document.getElementById('checkBtn');
// const startBtn = document.getElementById('startBtn');
const serverName = document.getElementById('serverName');
const serverAddr = document.getElementById('serverAddr');
const lastChecked = document.getElementById('lastChecked');
const playersNow = document.getElementById('playersNow');
const playerSample = document.getElementById('playerSample');
const versionEl = document.getElementById('version');
const softwareEl = document.getElementById('software');
const pingEl = document.getElementById('ping');
const motdEl = document.getElementById('motd');
const addPointBtn = document.getElementById('addPoint');
const clearHistoryBtn = document.getElementById('clearHistory');
const exportCsvBtn = document.getElementById('exportCsv');
const importCsvBtn = document.getElementById('importCsv');
const fileInput = document.getElementById('fileInput');
const historyList = document.getElementById('historyList');
const intervalInput = document.getElementById('intervalInput');
const sampleIntervalDisplay = document.getElementById('sampleIntervalDisplay');
const demoBtn = document.getElementById('demoBtn');

// --- Chart setup ---
const ctx = document.getElementById('growthChart').getContext('2d');
const chartData = { labels: [], datasets: [{ label: 'Players', data: [], fill:false, tension:0.25, borderWidth:2 }] };
const chart = new Chart(ctx, {
  type: 'line', data: chartData, options: {
    responsive:true, maintainAspectRatio:false, scales:{x:{display:true}, y:{beginAtZero:true}}, interaction:{mode:'index',intersect:false}, plugins:{legend:{display:false}}
  }
});

// --- State ---
let history = loadHistory();
let autoTimer = null;
let lastStatus = null;

function renderHistory(){
  if(!history.length){
    historyList.innerHTML='No history yet.';
    chart.data.labels=[]; chart.data.datasets[0].data=[]; chart.update();
    return;
  }
  chart.data.labels = history.map(h=>new Date(h.t).toLocaleString());
  chart.data.datasets[0].data = history.map(h=>h.players);
  chart.update();

  historyList.innerHTML = '';
  history.slice().reverse().forEach(h=>{
    const r = document.createElement('div'); r.className='row';
    r.innerHTML = `<div><strong>${h.players}</strong> players</div><div class="muted">${new Date(h.t).toLocaleString()}</div>`;
    historyList.appendChild(r);
  });
}

function addHistoryPoint(players, meta){
  const point = { t: Date.now(), players: Number(players)||0, meta: meta||{} };
  history.push(point); saveHistory(history); renderHistory();
}

// CSV helpers
function exportCSV(){
  if(!history.length){ alert('No history to export'); return }
  const rows = [['timestamp','players','meta']];
  history.forEach(h=>rows.push([new Date(h.t).toISOString(), h.players, JSON.stringify(h.meta||{})]));
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='mc_history.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function importCSVFile(file){
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result; const lines = text.split(/\r?\n/).filter(Boolean);
    const newHist = [];
    for(let i=1;i<lines.length;i++){
      const cols = lines[i].split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map(s=>s.replace(/^\"|\"$/g,''));
      if(cols.length<2) continue;
      try{ newHist.push({ t: Date.parse(cols[0])||Date.now(), players: Number(cols[1])||0, meta: cols[2]?JSON.parse(cols[2]):{} }); }
      catch(e){ newHist.push({ t: Date.parse(cols[0])||Date.now(), players: Number(cols[1])||0, meta: {} }); }
    }
    history = history.concat(newHist); saveHistory(history); renderHistory();
  };
  reader.readAsText(file);
}

// --- Server fetch (public API) ---
async function fetchStatus(addr){
  const host = addr.trim();
  if(!host) return null;
  try{
    const url = `https://api.mcsrvstat.us/2/${encodeURIComponent(host)}`;
    const res = await fetch(url);
    if(!res.ok) throw new Error('status ' + res.status);
    const data = await res.json();
    const players = data.players && typeof data.players.online !== 'undefined' ? data.players.online : (data.players||[]).length || 0;
    const maxplayers = data.players && typeof data.players.max !== 'undefined' ? data.players.max : (data.players?data.players.length:0);
    return {
      name: data.hostname || host,
      addr: host,
      players: players,
      maxplayers: maxplayers || null,
      version: data.version || data.software || '—',
      motd: (data.motd && (data.motd.clean||data.motd.raw||data.motd.html)) || '—',
      ping: data.debug && data.debug.ping ? data.debug.ping : null,
      raw: data
    };
  }catch(err){
    console.warn('Fetch status failed, returning null', err);
    return null;
  }
}

function demoStatus(host){
  const base = Math.round(20 + 80*Math.abs(Math.sin(Date.now()/60000)) + (Math.random()*12 -6));
  return Promise.resolve({ name: host, addr:host, players: Math.max(0, base), maxplayers:200, version:'1.20.4', motd:'Demo server', ping: Math.floor(30+Math.random()*60), raw:{demo:true} });
}

// --- Query parsing: support URL like "?domain.com:25565" or regular ?server=... ---
function parseHostFromQuery(){
  const qs = location.search || '';
  if(!qs) return null;
  // If query looks like ?domain.com:25565 (no '='), use everything after '?'
  const raw = qs.slice(1);
  if(!raw) return null;
  if(raw.includes('=')){
    const params = new URLSearchParams(raw);
    return (params.get('server') || params.get('host') || params.get('s') || null);
  }
  // otherwise treat the raw value as host
  return decodeURIComponent(raw);
}

async function checkNow(){
  // prefer explicit input; if empty, try URL query like ?domain.com:25565 or ?server=...
  let host = serverInput.value.trim();
  if(!host){ host = parseHostFromQuery(); }
  if(!host){ alert('Enter a server address or put it in the URL like ?example.com:25565'); return }

  serverInput.value = host; // reflect back
  serverName.textContent = host;
  serverAddr.textContent = host;
  lastChecked.textContent = 'Checking...';

  let status = await fetchStatus(host);
  if(!status){ status = await demoStatus(host); }
  lastStatus = status;

  playersNow.textContent = (status.players!=null)? `${status.players}/${status.maxplayers||'?'} ` : '—';
  playerSample.textContent = `Stored points: ${history.length}`;
  versionEl.textContent = status.version || '—';
  softwareEl.textContent = status.raw.software || '—';
  pingEl.textContent = (status.ping!=null) ? `${status.ping} ms` : '—';
  motdEl.textContent = status.motd ? String(status.motd).slice(0,120) : '—';
  lastChecked.textContent = 'Last checked: ' + new Date().toLocaleString();
}

// Auto-track
function startAuto(){
  if(autoTimer){ clearInterval(autoTimer); autoTimer=null; startBtn.textContent='Start Auto-Track'; startBtn.classList.remove('danger'); return }
  const interval = Math.max(5, Number(intervalInput.value) || 60);
  sampleIntervalDisplay.textContent = interval;
  startBtn.textContent='Stop Auto-Track'; startBtn.classList.add('danger');
  autoTimer = setInterval(async ()=>{
    await checkNow();
    if(lastStatus){ addHistoryPoint(lastStatus.players, {addr: lastStatus.addr, version: lastStatus.version}); }
  }, interval*1000);
}

// Wire buttons
checkBtn.addEventListener('click', ()=>checkNow());
addPointBtn.addEventListener('click', ()=>{ if(lastStatus) addHistoryPoint(lastStatus.players, {addr:lastStatus.addr}); else alert('No status available. Click Check Now first.') });
clearHistoryBtn.addEventListener('click', ()=>{ if(confirm('Clear in-memory history?')){ history=[]; saveHistory(history); renderHistory(); } });
exportCsvBtn.addEventListener('click', exportCSV);
importCsvBtn.addEventListener('click', ()=>fileInput.click());
fileInput.addEventListener('change', ()=>{ if(fileInput.files.length) importCSVFile(fileInput.files[0]); fileInput.value=''; });
startBtn.addEventListener('click', startAuto);
demoBtn.addEventListener('click', async ()=>{ await demoStatus(serverInput.value||'demo.server'); // quick fill
  history = [];
  const now = Date.now();
  for(let i=24;i>=0;i--){ history.push({ t: now - i*3600*1000, players: Math.max(0, Math.round(30 + 40*Math.sin(i/3) + (Math.random()*12-6))), meta:{demo:true} }); }
  saveHistory(history); renderHistory();
  await checkNow();
});

// init
renderHistory();
// If URL contains a host like ?domain.com:25565 or ?server=..., prefill and auto-check
(function initFromUrl(){
  const host = parseHostFromQuery();
  if(host){ serverInput.value = host; }
  // quick initial check only if we have a host (to avoid unwanted alerts)
  if(serverInput.value && serverInput.value.trim()) setTimeout(()=>checkNow(), 50);
})();
// sorting
function filterByTime(data, filterType) {
    const now = new Date();

    return data.filter(point => {
        const t = new Date(point.t);

        switch(filterType) {
            case 'today':
                return t.getFullYear() === now.getFullYear() &&
                       t.getMonth() === now.getMonth() &&
                       t.getDate() === now.getDate();
            case 'hour':
                return t.getFullYear() === now.getFullYear() &&
                       t.getMonth() === now.getMonth() &&
                       t.getDate() === now.getDate() &&
                       t.getHours() === now.getHours();
            case 'year':
                return t.getFullYear() === now.getFullYear();
            default:
                return true; // all time
        }
    });
}

async function fetchAndUpdate() {
    try {
        const res = await fetch('mc_history.json', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to fetch JSON');
        const data = await res.json();

        const serverIP = document.getElementById('serverInput').value.trim().toLowerCase();
        let filtered = data.filter(d => d.meta.addr && d.meta.addr.toLowerCase() === serverIP);

        // Apply time filter
        const timeFilter = document.getElementById('timeFilter').value;
        filtered = filterByTime(filtered, timeFilter);

        // Update chart
        chartData.labels = filtered.map(d => new Date(d.t).toLocaleTimeString());
        chartData.datasets[0].data = filtered.map(d => d.players);
        chart.update();

        // Update latest server info
        if (filtered.length > 0) {
            const latest = filtered[filtered.length - 1];
            document.getElementById('serverAddr').textContent = latest.meta.addr || '—';
            document.getElementById('playersNow').textContent = latest.players || '—';
            document.getElementById('serverName').textContent = latest.meta.addr || '—';
            document.getElementById('lastChecked').textContent = 'Last checked: ' + new Date(latest.t).toLocaleTimeString();
        } else {
          // document.getElementById('serverAddr').textContent = '—';
          //  document.getElementById('playersNow').textContent = '—';
         //   document.getElementById('serverName').textContent = '—';
           // document.getElementById('lastChecked').textContent = 'No data';
        }

    } catch (err) {
        console.error('Error fetching mc_history.json:', err);
    }
}

// Fetch every second
setInterval(fetchAndUpdate, 1000);
