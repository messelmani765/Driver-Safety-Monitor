'use strict';
/* ══════════════════════════════════════════════════════════════════════
   Driver Safety Monitor — Éditeur de trajet (client) + routes (superviseur)
   Chargé APRÈS app.js. Remplace seulement 2 pages: pageClientTrip et pageMap.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  // La carte sombre CartoDB demande maintenant une clé API: on utilise OpenStreetMap
  // (le mode sombre est obtenu avec un filtre CSS dans theme.css).
  if (window.L && L.tileLayer && !L.__tilePatched) {
    const origTile = L.tileLayer;
    L.tileLayer = function (url, opts) {
      if (typeof url === 'string' && url.indexOf('cartocdn') !== -1) url = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
      return origTile.call(L, url, opts);
    };
    L.__tilePatched = true;
  }
  const ED = { wps: [], points: [], dist: 0, markers: [], line: null, snapOn: true, seq: 0, timer: null };
  const DEFAULT_CENTER = [35.8256, 10.5908];

  const rad = (d) => d * Math.PI / 180;
  function hav(a, b) {
    const R = 6371000, dLa = rad(b[0] - a[0]), dLo = rad(b[1] - a[1]);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  // Lignes droites avec un point tous les ~25 m (secours sans Internet)
  function straight(wps) {
    const pts = []; let total = 0;
    for (let i = 0; i < wps.length - 1; i++) {
      const a = wps[i], b = wps[i + 1], d = hav(a, b); total += d;
      const n = Math.max(1, Math.floor(d / 25));
      for (let k = 0; k < n; k++) { const f = k / n; pts.push([+(a[0] + (b[0] - a[0]) * f).toFixed(6), +(a[1] + (b[1] - a[1]) * f).toFixed(6)]); }
    }
    pts.push([+wps[wps.length - 1][0].toFixed(6), +wps[wps.length - 1][1].toFixed(6)]);
    return { points: pts, distance_km: +(total / 1000).toFixed(2) };
  }

  const pinIcon = (label, kind) => L.divIcon({
    className: '', iconSize: [34, 42], iconAnchor: [17, 40], popupAnchor: [0, -36],
    html: `<div class="ed-pin ${kind}"><span>${label}</span></div>`,
  });

  // ─── Page CLIENT: Mon trajet (suivi + éditeur) ───────────────────────
  window.pageClientTrip = async function (view) {
    const u = AUTH.user;
    let saved = null;
    try { saved = await api('/api/client/route'); S.route = saved; } catch { /* trajet par défaut */ }
    const hasCustom = !!(saved && saved.updated_at);
    ED.wps = hasCustom ? (saved.waypoints || []).map(p => [p[0], p[1]]) : [];
    ED.points = hasCustom ? (saved.points || []) : [];
    ED.dist = hasCustom ? (saved.distance_km || 0) : 0;

    view.innerHTML = `
      <div class="trip-tabs">
        <button class="trip-tab" data-tab="draw"><i class="fa-solid fa-pen-ruler"></i> Dessiner mon trajet</button>
        <button class="trip-tab" data-tab="live"><i class="fa-solid fa-satellite-dish"></i> Suivi en direct</button>
      </div>
      <div id="tripBody"></div>`;
    const tabs = $$('.trip-tab', view);
    const show = (tab) => {
      tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      destroyMap();
      if (tab === 'live') renderLive(); else renderDraw(hasCustom);
    };
    tabs.forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
    show(hasCustom ? 'live' : 'draw');

    function renderLive() {
      $('#tripBody').innerHTML = `
        <div class="card">
          <div class="card-head">
            <div class="ico-sm"><i class="fa-solid fa-map-location-dot"></i></div>
            Trajet en direct — ${esc(u.plate || u.vehicle_code)}
            <div class="right">
              <button class="btn sm on" id="btnClFollow"><i class="fa-solid fa-crosshairs"></i> Suivre</button>
              <button class="btn sm gray" id="btnClFit"><i class="fa-solid fa-route"></i> Vue globale</button>
            </div>
          </div>
          <div id="map" class="map tall"></div>
          ${hasCustom ? '' : '<div class="warn-bar">Tu n\'as pas encore dessiné ton trajet. Clique sur « Dessiner mon trajet ».</div>'}
        </div>`;
      MAP.follow = true;
      initMap('map', u.vehicle_code);
      focusCar(u.vehicle_code);
      $('#btnClFollow').addEventListener('click', (e) => {
        MAP.follow = !MAP.follow;
        e.currentTarget.className = 'btn sm ' + (MAP.follow ? 'on' : 'gray');
        if (MAP.follow) focusCar(u.vehicle_code);
      });
      $('#btnClFit').addEventListener('click', () => { if (MAP.routeLayer) MAP.map.fitBounds(MAP.routeLayer.getBounds(), { padding: [30, 30] }); });
    }

    function renderDraw(already) {
      $('#tripBody').innerHTML = `
        <div class="card">
          <div class="card-head">
            <div class="ico-sm"><i class="fa-solid fa-pen-ruler"></i></div>
            Dessiner mon trajet
            <div class="right">
              <button class="btn sm gray" id="edUndo"><i class="fa-solid fa-rotate-left"></i> Annuler le dernier</button>
              <button class="btn sm gray" id="edClear"><i class="fa-solid fa-trash"></i> Tout effacer</button>
              <button class="btn sm on" id="edSave"><i class="fa-solid fa-floppy-disk"></i> Enregistrer</button>
            </div>
          </div>
          <div class="ed-bar">
            <div class="ed-search">
              <i class="fa-solid fa-magnifying-glass"></i>
              <input id="edSearch" type="text" placeholder="Chercher un lieu (ex: Sousse Corniche)">
              <button class="btn sm gray" id="edGo">Aller</button>
            </div>
            <label class="ed-toggle"><input type="checkbox" id="edSnap" checked> Suivre les routes</label>
            <div class="ed-stats">
              <span><i class="fa-solid fa-road"></i> <b id="edDist">0</b> km</span>
              <span><i class="fa-solid fa-location-dot"></i> <b id="edPts">0</b> point</span>
              <span><i class="fa-solid fa-clock"></i> <b id="edEta">—</b></span>
            </div>
          </div>
          <div id="map" class="map tall ed-map"></div>
          <div class="ed-help">
            <b>Comment faire :</b> 1) Clique sur la carte pour poser le <b>départ (A)</b>. 2) Continue à cliquer pour tracer le chemin.
            3) Le dernier point est l'<b>arrivée (B)</b>. 4) Tu peux <b>déplacer</b> un point avec la souris, ou clic droit pour le supprimer. 5) Clique sur <b>Enregistrer</b>.
          </div>
        </div>`;
      const m = L.map('map', { zoomControl: true });
      MAP.map = m; // destroyMap() le nettoiera
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(m);
      m.setView(DEFAULT_CENTER, 14);
      setTimeout(() => m.invalidateSize(), 150);
      ED.markers = []; ED.line = null; ED.snapOn = true;
      redrawMarkers(m);
      drawLine(m);
      if (ED.wps.length > 1 && ED.line) m.fitBounds(ED.line.getBounds(), { padding: [40, 40] });
      refreshStats();

      m.on('click', (e) => { ED.wps.push([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]); changed(m); });
      $('#edUndo').addEventListener('click', () => { ED.wps.pop(); changed(m); });
      $('#edClear').addEventListener('click', () => { ED.wps = []; changed(m); });
      $('#edSnap').addEventListener('change', (e) => { ED.snapOn = e.target.checked; changed(m); });
      $('#edGo').addEventListener('click', () => search(m));
      $('#edSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(m); });
      $('#edSave').addEventListener('click', save);
    }
  };

  function changed(m) {
    redrawMarkers(m);
    refreshStats();
    clearTimeout(ED.timer);
    if (ED.wps.length < 2) { ED.points = []; ED.dist = 0; drawLine(m); refreshStats(); return; }
    ED.timer = setTimeout(() => recompute(m), 350);
  }

  async function recompute(m) {
    const seq = ++ED.seq;
    let res = null;
    if (ED.snapOn) {
      try { res = await api('/api/route/snap', { method: 'POST', body: { waypoints: ED.wps } }); } catch { res = null; }
    }
    if (seq !== ED.seq || MAP.map !== m) return;
    if (!res || !res.points) res = straight(ED.wps);
    ED.points = res.points; ED.dist = res.distance_km || 0;
    drawLine(m); refreshStats();
    if (ED.snapOn && res.osrm === false) toast('Pas d\'Internet pour suivre les routes: lignes droites utilisées', 'default', 3500);
  }

  function redrawMarkers(m) {
    ED.markers.forEach(mk => m.removeLayer(mk)); ED.markers = [];
    const n = ED.wps.length;
    ED.wps.forEach((p, i) => {
      const kind = i === 0 ? 'start' : (i === n - 1 && n > 1 ? 'end' : 'mid');
      const label = kind === 'start' ? 'A' : kind === 'end' ? 'B' : String(i);
      const mk = L.marker(p, { icon: pinIcon(label, kind), draggable: true }).addTo(m);
      mk.on('dragend', () => { const ll = mk.getLatLng(); ED.wps[i] = [+ll.lat.toFixed(6), +ll.lng.toFixed(6)]; changed(m); });
      mk.on('contextmenu', () => { ED.wps.splice(i, 1); changed(m); });
      mk.bindTooltip(kind === 'start' ? 'Départ' : kind === 'end' ? 'Arrivée' : `Étape ${i}`, { direction: 'top', offset: [0, -34] });
      ED.markers.push(mk);
    });
  }

  function drawLine(m) {
    if (ED.line) { m.removeLayer(ED.line); ED.line = null; }
    if (ED.points.length > 1) ED.line = L.polyline(ED.points, { color: '#10b981', weight: 6, opacity: .9 }).addTo(m);
    else if (ED.wps.length > 1) ED.line = L.polyline(ED.wps, { color: '#10b981', weight: 4, opacity: .6, dashArray: '6 8' }).addTo(m);
  }

  function refreshStats() {
    const set = (id, v) => { const e = $(`#${id}`); if (e) e.textContent = v; };
    set('edDist', (ED.dist || 0).toFixed(1));
    set('edPts', ED.wps.length);
    const min = ED.dist ? Math.max(1, Math.round(ED.dist / 50 * 60)) : 0;
    set('edEta', min ? `~${min} min` : '—');
  }

  async function search(m) {
    const q = ($('#edSearch').value || '').trim();
    if (!q) return;
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q), { headers: { 'Accept': 'application/json' } });
      const d = await r.json();
      if (!d.length) { toast('Lieu introuvable', 'error'); return; }
      m.setView([+d[0].lat, +d[0].lon], 15);
    } catch { toast('Recherche impossible (Internet ?)', 'error'); }
  }

  async function save() {
    if (ED.wps.length < 2) { toast('Pose au moins 2 points (départ et arrivée)', 'error'); return; }
    const btn = $('#edSave');
    btn.disabled = true;
    try {
      if (!ED.points.length) { const r = straight(ED.wps); ED.points = r.points; ED.dist = r.distance_km; }
      const res = await api('/api/client/route', { method: 'POST', body: { waypoints: ED.wps, points: ED.points, distance_km: ED.dist } });
      S.route = res.route;
      toast('✅ Trajet enregistré. Ta voiture va rouler sur ce chemin.', 'success', 4500);
      route(); // recharge la page: onglet « Suivi en direct »
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; }
  }

  // ─── Pages SUPERVISEUR: carte avec le trajet dessiné de chaque client ────
  function wrapSupervisorPage(name) {
    const orig = window[name];
    window[name] = function (view) {
      const keep = S.route; S.route = null; // pas de trajet par défaut (triangle gris)
      try { orig(view); } finally { S.route = keep; }
      drawFleetRoutes();
    };
  }
  wrapSupervisorPage('pageMap');
  wrapSupervisorPage('pageDashboard');

  async function drawFleetRoutes() {
    const m = MAP.map;
    if (!m) return;
    const layers = [];
    for (const v of S.vehicles) {
      try {
        const r = await fetch(`/api/vehicles/${encodeURIComponent(v.code)}/route`).then(x => x.json());
        if (MAP.map !== m) return;
        if (r.updated_at && r.points && r.points.length > 1) { // seulement les trajets dessinés
          const col = colorOf(v.code);
          layers.push(L.polyline(r.points, { color: col, weight: 5, opacity: .7 }).addTo(m));
          L.circleMarker(r.points[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#10b981', fillOpacity: 1 }).addTo(m).bindTooltip('Départ ' + plateOf(v.code));
          L.circleMarker(r.points[r.points.length - 1], { radius: 6, color: '#fff', weight: 2, fillColor: '#ef4444', fillOpacity: 1 }).addTo(m).bindTooltip('Arrivée ' + plateOf(v.code));
        }
      } catch { /* ignore */ }
    }
    if (layers.length && MAP.map === m) m.fitBounds(L.featureGroup(layers).getBounds(), { padding: [50, 50] });
  }
})();
