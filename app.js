/* Manhole Inspector PWA */
window.App = (() => {
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

  // ----- Service worker install prompt handling -----
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById('installBtn');
    if (btn) btn.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    const btn = document.getElementById('installBtn');
    if (btn) btn.hidden = true;
    deferredPrompt = null;
  });
  window.addEventListener('DOMContentLoaded', () => {
    const ib = document.getElementById('installBtn');
    if (ib) ib.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        ib.hidden = true;
      }
    });
  });

  // ----- Simple IndexedDB wrapper -----
  const DB_NAME = 'manhole_db';
  const DB_VERSION = 1;
  const STORE = 'inspections';
  let db;

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idb() { return db || (db = await idbOpen()); }
  async function put(data) {
    const d = await idb();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function getAll() {
    const d = await idb();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  async function getOne(id) {
    const d = await idb();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
  async function del(id) {
    const d = await idb();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ----- Utilities -----
  const uuid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const todayISO = () => new Date().toISOString().slice(0,10);
  const timeHM = () => { const d=new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
  const toNumber = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

  async function geolocateOnce() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  // ----- Sketch (Pencil) -----
  function sketch(canvas) {
    const ctx = canvas.getContext('2d');
    let drawing = false, last = null;
    const DPR = window.devicePixelRatio || 1;
    function resize() {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.floor(width * DPR);
      canvas.height = Math.floor(height * DPR);
      ctx.scale(DPR, DPR);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#9CA3AF';
      ctx.fillStyle = '#0e1624';
      ctx.fillRect(0,0,canvas.width,canvas.height);
    }
    resize(); window.addEventListener('resize', resize);

    function pos(e) {
      if (e.touches && e.touches[0]) {
        const rect = canvas.getBoundingClientRect();
        return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
      } else {
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      }
    }
    function start(e){ drawing = true; last = pos(e); }
    function move(e){
      if (!drawing) return;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    }
    function end(){ drawing = false; last = null; }
    canvas.addEventListener('touchstart', start, {passive:true});
    canvas.addEventListener('touchmove', move, {passive:true});
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);

    return {
      toDataURL: () => canvas.toDataURL('image/png'),
      clear: () => { ctx.fillStyle = '#0e1624'; ctx.fillRect(0,0,canvas.width,canvas.height); }
    };
  }

  // ----- Templates -----
  const blankInspection = async () => ({
    id: uuid(),
    createdAt: new Date().toISOString(),
    date: todayISO(),
    time: timeHM(),
    inspector: "",
    siteCode: "",
    manholeId: "",
    location: await geolocateOnce(),
    accessCoverSize: "",
    accessType: "None",
    depthChamberInvert_m: null,
    connections: [], // { positionDeg, depthInvert_m, pipeDiameter_mm, notes }
    features: { penstock:false, flapValve:false, hawkeye:false, other:"" },
    systemType: "",
    observations: "",
    photos: { cover:null, label:null, inside:null },
    sketchDataUrl: null
  });

  // ----- Views -----
  const view = document.getElementById('view');
  document.getElementById('newBtn').addEventListener('click', async () => showForm(await blankInspection()));
  document.getElementById('listBtn').addEventListener('click', showList);

  function showList() {
    view.innerHTML = `<section class="card">
      <h2>My Inspections</h2>
      <div id="list"></div>
    </section>`;
    refreshList();
  }

  async function refreshList() {
    const items = (await getAll()).sort((a,b)=> (b.createdAt||'').localeCompare(a.createdAt||''));
    const list = document.getElementById('list');
    if (!items.length) {
      list.innerHTML = `<p class="small">No inspections yet. Tap <b>New Inspection</b> to begin.</p>`;
      return;
    }
    const rows = items.map(i => `
      <div class="card">
        <div class="kv"><span><b>${i.siteCode || '—'}</b> • ${i.manholeId || 'No ID'}</span><span class="badge">${(i.date||'').replaceAll('-','/')} ${i.time||''}</span></div>
        <div class="small">Inspector: ${i.inspector || '—'} • Location: ${i.location ? (i.location.lat.toFixed(6)+', '+i.location.lon.toFixed(6)+' ±'+Math.round(i.location.acc)+'m') : '—'}</div>
        <div class="list-actions">
          <button data-id="${i.id}" class="viewBtn">Open</button>
          <button data-id="${i.id}" class="reportBtn">Report</button>
          <button data-id="${i.id}" class="danger delBtn">Delete</button>
        </div>
      </div>
    `).join('');
    list.innerHTML = rows;
    Array.from(list.querySelectorAll('.viewBtn')).forEach(b => b.addEventListener('click', async e => showForm(await getOne(e.currentTarget.dataset.id))));
    Array.from(list.querySelectorAll('.reportBtn')).forEach(b => b.addEventListener('click', async e => showReport(await getOne(e.currentTarget.dataset.id))));
    Array.from(list.querySelectorAll('.delBtn')).forEach(b => b.addEventListener('click', async e => { await del(e.currentTarget.dataset.id); refreshList(); }));
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function showForm(data) {
    const existing = !!data?.id;
    if (!data) data = await blankInspection();
    const esc = s => (s||'').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

    const html = `
      <form class="card grid" id="inspectionForm" autocomplete="off">
        <div class="grid cols-2">
          <div>
            <label>Date</label>
            <input type="date" id="date" value="${data.date||todayISO()}">
          </div>
          <div>
            <label>Time</label>
            <input type="time" id="time" value="${data.time||timeHM()}">
          </div>
        </div>

        <div class="grid cols-2">
          <div>
            <label>Inspector</label>
            <input type="text" id="inspector" placeholder="Your name" value="${esc(data.inspector)||''}">
          </div>
          <div>
            <label>Site Code / Job</label>
            <input type="text" id="siteCode" placeholder="e.g. SW-023" value="${esc(data.siteCode)||''}">
          </div>
        </div>

        <div class="grid cols-2">
          <div>
            <label>Manhole ID</label>
            <input type="text" id="manholeId" placeholder="e.g. MH-12" value="${esc(data.manholeId)||''}">
          </div>
          <div>
            <label>System Type</label>
            <input type="text" id="systemType" placeholder="e.g. road drainage" value="${esc(data.systemType)||''}">
          </div>
        </div>

        <fieldset>
          <legend>Location</legend>
          <div class="grid cols-3">
            <div><label>Latitude</label><input type="text" id="lat" value="${data.location?.lat ?? ''}" placeholder="auto"></div>
            <div><label>Longitude</label><input type="text" id="lon" value="${data.location?.lon ?? ''}" placeholder="auto"></div>
            <div><label>Accuracy (m)</label><input type="text" id="acc" value="${data.location?.acc ?? ''}" placeholder="auto"></div>
          </div>
          <div class="row">
            <button type="button" id="locateBtn">Use Current Location</button>
            <span class="small">High accuracy may take a few seconds outdoors.</span>
          </div>
        </fieldset>

        <fieldset>
          <legend>Access</legend>
          <div class="grid cols-3">
            <div>
              <label>Access Cover Size</label>
              <input type="text" id="accessCoverSize" placeholder="e.g. 600x600" value="${esc(data.accessCoverSize)||''}">
            </div>
            <div>
              <label>Access Type</label>
              <select id="accessType">
                <option ${data.accessType==='None'?'selected':''}>None</option>
                <option ${data.accessType==='Ladder'?'selected':''}>Ladder</option>
                <option ${data.accessType==='Step-irons'?'selected':''}>Step-irons</option>
              </select>
            </div>
            <div>
              <label>Depth to Chamber Invert (m)</label>
              <input type="number" step="0.01" id="depthChamberInvert_m" value="${data.depthChamberInvert_m ?? ''}">
            </div>
          </div>
        </fieldset>

        <fieldset id="pipesFieldset">
          <legend>Pipe Connections</legend>
          <div id="pipesContainer"></div>
          <div class="row">
            <button type="button" id="addPipeBtn">Add Pipe</button>
            <span class="small">Angles are optional; use approximate degrees from North if noted.</span>
          </div>
        </fieldset>

        <fieldset>
          <legend>Features within Chamber</legend>
          <div class="row">
            <label><input type="checkbox" id="feat_penstock" ${data.features?.penstock?'checked':''}> Penstock</label>
            <label><input type="checkbox" id="feat_flapValve" ${data.features?.flapValve?'checked':''}> Flap-valve</label>
            <label><input type="checkbox" id="feat_hawkeye" ${data.features?.hawkeye?'checked':''}> Hawk-eye detection unit</label>
          </div>
          <label>Other</label>
          <input type="text" id="feat_other" placeholder="e.g. flow meter" value="${esc(data.features?.other)||''}">
        </fieldset>

        <fieldset>
          <legend>Photos</legend>
          <div class="grid cols-3">
            <div>
              <label>Access Cover</label>
              <div class="media-thumb" id="thumb_cover">${data.photos?.cover ? `<img src="${data.photos.cover}" alt="Cover">` : 'No photo'}</div>
              <input type="file" accept="image/*" capture="environment" id="photo_cover">
            </div>
            <div>
              <label>Labels / Surroundings</label>
              <div class="media-thumb" id="thumb_label">${data.photos?.label ? `<img src="${data.photos.label}" alt="Label">` : 'No photo'}</div>
              <input type="file" accept="image/*" capture="environment" id="photo_label">
            </div>
            <div>
              <label>Inside Chamber</label>
              <div class="media-thumb" id="thumb_inside">${data.photos?.inside ? `<img src="${data.photos.inside}" alt="Inside">` : 'No photo'}</div>
              <input type="file" accept="image/*" capture="environment" id="photo_inside">
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Plan Sketch</legend>
          <canvas id="sketch"></canvas>
          <div class="row">
            <button type="button" id="clearSketchBtn">Clear Sketch</button>
          </div>
        </fieldset>

        <label>Observations</label>
        <textarea id="observations" placeholder="Notes, hazards, system if known"></textarea>

        <div class="row" style="justify-content: flex-end; gap: 8px;">
          ${existing ? '<button type="button" id="reportBtn">Report</button>' : ''}
          <button type="submit" class="primary">Save</button>
        </div>
      </form>
    `;
    view.innerHTML = html;

    // Initialize values
    document.getElementById('inspector').value = data.inspector || '';
    document.getElementById('siteCode').value = data.siteCode || '';
    document.getElementById('manholeId').value = data.manholeId || '';
    document.getElementById('systemType').value = data.systemType || '';
    document.getElementById('observations').value = data.observations || '';

    // Location
    document.getElementById('locateBtn').addEventListener('click', async () => {
      const loc = await geolocateOnce();
      if (loc) {
        document.getElementById('lat').value = loc.lat;
        document.getElementById('lon').value = loc.lon;
        document.getElementById('acc').value = Math.round(loc.acc);
      } else {
        alert('Location unavailable.');
      }
    });

    // Pipes UI
    const pipes = data.connections || [];
    const container = document.getElementById('pipesContainer');
    const renderPipes = () => {
      container.innerHTML = pipes.map((p, idx) => `
        <div class="card">
          <div class="grid cols-3">
            <div><label>Position (° from North)</label><input type="number" step="1" data-idx="${idx}" data-key="positionDeg" value="${p.positionDeg ?? ''}"></div>
            <div><label>Depth to Invert (m)</label><input type="number" step="0.01" data-idx="${idx}" data-key="depthInvert_m" value="${p.depthInvert_m ?? ''}"></div>
            <div><label>Pipe Diameter (mm)</label><input type="number" step="1" data-idx="${idx}" data-key="pipeDiameter_mm" value="${p.pipeDiameter_mm ?? ''}"></div>
          </div>
          <label>Notes</label>
          <input type="text" data-idx="${idx}" data-key="notes" value="${p.notes || ''}">
          <div class="row" style="justify-content:flex-end">
            <button type="button" class="danger" data-del="${idx}">Remove</button>
          </div>
        </div>
      `).join('');
      Array.from(container.querySelectorAll('input[data-key]')).forEach(inp => {
        inp.addEventListener('input', (e) => {
          const i = Number(e.target.dataset.idx);
          const k = e.target.dataset.key;
          const v = e.target.type === 'number' ? parseFloat(e.target.value) : e.target.value;
          pipes[i][k] = isNaN(v) ? null : v;
          if (e.target.type !== 'number') pipes[i][k] = e.target.value;
        });
      });
      Array.from(container.querySelectorAll('button[data-del]')).forEach(btn => {
        btn.addEventListener('click', (e) => {
          const i = Number(e.currentTarget.dataset.del);
          pipes.splice(i,1);
          renderPipes();
        });
      });
    };
    document.getElementById('addPipeBtn').addEventListener('click', () => { pipes.push({positionDeg:null, depthInvert_m:null, pipeDiameter_mm:null, notes:""}); renderPipes(); });
    renderPipes();

    // Photos
    ['cover','label','inside'].forEach(kind => {
      const input = document.getElementById('photo_'+kind);
      const thumb = document.getElementById('thumb_'+kind);
      input.addEventListener('change', async () => {
        const f = input.files && input.files[0];
        if (f) {
          const dataUrl = await fileToDataURL(f);
          data.photos = data.photos || {};
          data.photos[kind] = dataUrl;
          thumb.innerHTML = `<img src="${dataUrl}" alt="${kind}">`;
        }
      });
    });

    // Sketch
    const sk = sketch(document.getElementById('sketch'));
    if (data.sketchDataUrl) {
      const img = new Image();
      img.onload = () => {
        const cnv = document.getElementById('sketch');
        const ctx = cnv.getContext('2d');
        ctx.drawImage(img, 0, 0, cnv.width, cnv.height);
      };
      img.src = data.sketchDataUrl;
    }
    document.getElementById('clearSketchBtn').addEventListener('click', () => sk.clear());

    // Report button
    const reportBtn = document.getElementById('reportBtn');
    if (reportBtn) reportBtn.addEventListener('click', () => showReport(collect()));

    // Submit
    document.getElementById('inspectionForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const rec = collect();
      await put(rec);
      alert('Saved.');
      showList();
    });

    function collect() {
      function toNumber(v){ const n=parseFloat(v); return isNaN(n)?null:n; }
      return {
        ...data,
        date: document.getElementById('date').value,
        time: document.getElementById('time').value,
        inspector: document.getElementById('inspector').value.trim(),
        siteCode: document.getElementById('siteCode').value.trim(),
        manholeId: document.getElementById('manholeId').value.trim(),
        systemType: document.getElementById('systemType').value.trim(),
        location: {
          lat: toNumber(document.getElementById('lat').value),
          lon: toNumber(document.getElementById('lon').value),
          acc: toNumber(document.getElementById('acc').value),
        },
        accessCoverSize: document.getElementById('accessCoverSize').value.trim(),
        accessType: document.getElementById('accessType').value,
        depthChamberInvert_m: toNumber(document.getElementById('depthChamberInvert_m').value),
        connections: pipes,
        features: {
          penstock: document.getElementById('feat_penstock').checked,
          flapValve: document.getElementById('feat_flapValve').checked,
          hawkeye: document.getElementById('feat_hawkeye').checked,
          other: document.getElementById('feat_other').value.trim()
        },
        photos: data.photos || { cover:null, label:null, inside:null },
        sketchDataUrl: sk.toDataURL(),
        observations: document.getElementById('observations').value.trim()
      };
    }
  }

  function showReport(rec) {
    const loc = rec.location ? `${rec.location.lat?.toFixed?.(6) ?? '—'}, ${rec.location.lon?.toFixed?.(6) ?? '—'} (±${rec.location.acc ?? '—'} m)` : '—';
    const feat = [
      rec.features?.penstock ? 'Penstock' : null,
      rec.features?.flapValve ? 'Flap-valve' : null,
      rec.features?.hawkeye ? 'Hawk-eye' : null,
      rec.features?.other ? rec.features.other : null
    ].filter(Boolean).join(', ') || 'None';

    view.innerHTML = `
      <section class="card">
        <h2>Inspection Report</h2>
        <div class="grid cols-2">
          <div class="kv"><span>Date</span><b>${rec.date||'—'} ${rec.time||''}</b></div>
          <div class="kv"><span>Inspector</span><b>${rec.inspector||'—'}</b></div>
          <div class="kv"><span>Site/Job</span><b>${rec.siteCode||'—'}</b></div>
          <div class="kv"><span>Manhole ID</span><b>${rec.manholeId||'—'}</b></div>
          <div class="kv"><span>System</span><b>${rec.systemType||'—'}</b></div>
          <div class="kv"><span>Location</span><b>${loc}</b></div>
          <div class="kv"><span>Access Cover Size</span><b>${rec.accessCoverSize||'—'}</b></div>
          <div class="kv"><span>Access Type</span><b>${rec.accessType||'—'}</b></div>
          <div class="kv"><span>Depth to Chamber Invert (m)</span><b>${rec.depthChamberInvert_m ?? '—'}</b></div>
          <div class="kv"><span>Features</span><b>${feat}</b></div>
        </div>

        <h3>Pipe Connections</h3>
        ${rec.connections?.length ? `
          <table>
            <thead><tr><th>Position (°)</th><th>Depth to Invert (m)</th><th>Diameter (mm)</th><th>Notes</th></tr></thead>
            <tbody>
              ${rec.connections.map(p => `<tr>
                  <td>${p.positionDeg ?? '—'}</td>
                  <td>${p.depthInvert_m ?? '—'}</td>
                  <td>${p.pipeDiameter_mm ?? '—'}</td>
                  <td>${p.notes || '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        ` : '<p class="small">No pipe connections recorded.</p>'}

        <h3>Photos</h3>
        <div class="grid cols-3">
          <div>${rec.photos?.cover ? `<img class="media-thumb" src="${rec.photos.cover}" alt="Cover">` : '<div class="media-thumb">No photo</div>'}</div>
          <div>${rec.photos?.label ? `<img class="media-thumb" src="${rec.photos.label}" alt="Label">` : '<div class="media-thumb">No photo</div>'}</div>
          <div>${rec.photos?.inside ? `<img class="media-thumb" src="${rec.photos.inside}" alt="Inside">` : '<div class="media-thumb">No photo</div>'}</div>
        </div>

        <h3>Plan Sketch</h3>
        ${rec.sketchDataUrl ? `<img class="media-thumb" src="${rec.sketchDataUrl}" alt="Sketch">` : '<div class="media-thumb">No sketch</div>'}

        <h3>Observations</h3>
        <p>${(rec.observations || '—').replace(/</g,'&lt;')}</p>

        <div class="row" style="justify-content:flex-end; gap:8px; margin-top:12px;">
          <button id="printBtn">Print / PDF</button>
          <button id="backBtn">Back</button>
        </div>
      </section>
    `;

    document.getElementById('printBtn').addEventListener('click', () => window.print());
    document.getElementById('backBtn').addEventListener('click', showList);
  }

  // Register SW
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js');
    });
  }

  return { showList, showForm, showReport };
})();
