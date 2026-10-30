'use strict';
/* ══════════════════════════════════════════════════════════════════════
   DRIVER SAFETY MONITOR — App V2
   ══════════════════════════════════════════════════════════════════════ */

// ─── Outils DOM ────────────────────────────────────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sget = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const sset = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

function toast(msg, type = 'default', ms = 3000) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  el.style.background = type === 'error' ? '#7f1d1d' : type === 'success' ? '#065f46' : '#0a1428';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.style.display = 'none'; }, ms);
}

// ─── Mode "app conducteur" (application mobile): seulement l'espace client ───
const APP_CLIENT = (() => {
  try {
    if (new URLSearchParams(location.search).get('app') === 'client') sessionStorage.setItem('app_client', '1');
    return sessionStorage.getItem('app_client') === '1';
  } catch { return false; }
})();
if (APP_CLIENT) document.documentElement.classList.add('app-client');

// ─── Pont avec l'application mobile (caméra du téléphone gérée par l'app) ───
const HAS_APP = () => !!(window.AppBridge && window.AppBridge.postMessage);
function nativeCam(action) {
  if (!HAS_APP()) return;
  try { window.AppBridge.postMessage(JSON.stringify({ a: action, token: (typeof AUTH !== 'undefined' && AUTH.token) || '' })); } catch {}
}
const CAM_LABELS = { EyesOpen: 'Yeux ouverts', EyesClosed: 'Yeux fermés', Asleep: 'ENDORMI', NoFace: 'Visage non détecté' };
window.onNativeCam = (d) => {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  if (d.running !== undefined) {
    const b = document.getElementById('camBadge');
    if (b) { b.textContent = d.running ? 'En surveillance' : 'Arrêtée'; b.className = 'tag-pill ' + (d.running ? 'green' : 'gray'); }
    const s = document.getElementById('camStart'), p = document.getElementById('camStop');
    if (s) s.style.display = d.running ? 'none' : ''; if (p) p.style.display = d.running ? '' : 'none';
  }
  if (d.error) {
    set('camInfo', d.error);
    if (window.__lastCamErr !== d.error) { window.__lastCamErr = d.error; toast(d.error, 'error', 5000); }
    return;
  }
  window.__lastCamErr = '';
  if (d.state) {
    set('camState', CAM_LABELS[d.state] || d.state); set('camSecs', `${(d.eyes_closed_s || 0).toFixed(1)} s`);
    set('camInfo', `${Math.round(d.infer_ms || 0)} ms`);
    const e = document.getElementById('camState'); if (e) e.dataset.s = d.state;
  }
};

// ─── AUTH & SESSION ────────────────────────────────────────────────────
const AUTH = {
  token: sget('auth_token', ''),
  user: null,

  async init() {
    if (!this.token) return false;
    try {
      const res = await api('/api/auth/me');
      if (res && res.ok && res.user) { this.user = res.user; return true; }
    } catch { this.clear(); }
    return false;
  },

  set(token, user) { this.token = token; this.user = user; sset('auth_token', token); },
  clear() { nativeCam('stop'); this.token = ''; this.user = null; try { localStorage.removeItem('auth_token'); } catch {} },

  async login(username, password) {
    const res = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    if (res && res.ok) { this.set(res.token, res.user); return res; }
    throw new Error(res.error || 'Identifiant ou mot de passe incorrect');
  },

  async logout() {
    if (this.token) { try { await api('/api/auth/logout', { method: 'POST' }); } catch {} }
    this.clear();
    showAuthScreen();
    toast('Déconnexion effectuée');
  }
};

// ─── Mode Démo automatique (Netlify & hôtes statiques sans backend Python) ──
function getMockApiResponse(path, opts = {}) {
  const p = path.split('?')[0];
  if (p === '/api/auth/login') {
    const body = (typeof opts.body === 'string') ? JSON.parse(opts.body) : (opts.body || {});
    const user = (body.username || 'client1').trim();
    const isSuper = user.toLowerCase().includes('police') || user.toLowerCase().includes('super');
    return {
      ok: true,
      token: 'demo-tok-' + Date.now(),
      user: {
        id: isSuper ? 1 : 2,
        username: user,
        role: isSuper ? 'supervisor' : 'client',
        driver_id: isSuper ? null : 1,
        vehicle_code: isSuper ? null : 'TUN-101',
        plate: isSuper ? null : '195-TN-5521',
        name: isSuper ? 'Poste Central Police' : 'Ahmed Ben Ali'
      }
    };
  }
  if (p === '/api/auth/me') {
    return { ok: true, user: AUTH.user || { id: 2, username: 'client1', role: 'client', driver_id: 1, vehicle_code: 'TUN-101', plate: '195-TN-5521', name: 'Ahmed Ben Ali' } };
  }
  if (p === '/api/plans') {
    return [
      { id: 'basic', name: 'Basique', price: 19, features: ['1 voiture', 'Détection de somnolence en direct', 'Alerte sonore et vibration'] },
      { id: 'standard', name: 'Standard', price: 39, popular: true, features: ['Tout le Basique', "Appel de la police (simulé)", 'Suivi du trajet en direct'] },
      { id: 'premium', name: 'Premium', price: 69, features: ['Tout le Standard', 'Historique complet des images', 'Assistance prioritaire (démo)'] }
    ];
  }
  if (p === '/api/client/subscription') {
    return { plan_id: 'standard', status: 'active', brand: 'Visa', last4: '4242' };
  }
  if (p === '/api/vehicles') {
    return [
      { id: 1, code: 'TUN-101', plate: '195-TN-5521', driver_name: 'Ahmed Ben Ali', driver_phone: '+216 98 123 456', car_model: 'Peugeot 208', status: 'online' },
      { id: 2, code: 'CAR-02', plate: '184-TN-2024', driver_name: 'Moncef Trabelsi', driver_phone: '+216 22 456 789', car_model: 'Renault Clio', status: 'online' },
      { id: 3, code: 'CAR-03', plate: '210-TN-8802', driver_name: 'Sami Khelifi', driver_phone: '+216 55 789 012', car_model: 'Volkswagen Golf', status: 'online' },
      { id: 4, code: 'CAR-04', plate: '222-TN-3310', driver_name: 'Fatma Dridi', driver_phone: '+216 99 333 444', car_model: 'Toyota Yaris', status: 'offline' }
    ];
  }
  if (p === '/api/drivers') {
    return [
      { id: 1, name: 'Ahmed Ben Ali', phone: '+216 98 123 456', vehicle_code: 'TUN-101', username: 'client1' },
      { id: 2, name: 'Moncef Trabelsi', phone: '+216 22 456 789', vehicle_code: 'CAR-02', username: 'client2' },
      { id: 3, name: 'Sami Khelifi', phone: '+216 55 789 012', vehicle_code: 'CAR-03', username: 'client3' },
      { id: 4, name: 'Fatma Dridi', phone: '+216 99 333 444', vehicle_code: 'CAR-04', username: 'client4' }
    ];
  }
  if (p === '/api/stats') {
    return { total_alerts: 14, active_vehicles: 3, total_vehicles: 4, safe_score: 94, recent_events: 5 };
  }
  if (p === '/api/settings') {
    return {
      closed_eyes_sec: 5.0, countdown_sec: 10, emergency_number: '+216 00 000 000',
      emergency_msg: 'Simulation: conducteur endormi, position transmise à la Protection civile.',
      mqtt_host: 'localhost', mqtt_port: 1883
    };
  }
  if (p === '/api/route') {
    return fetch('/static/route.json').then(r => r.json()).catch(() => fetch('/route.json').then(r => r.json())).catch(() => [
      [35.8256, 10.5908], [35.8300, 10.6050], [35.8265, 10.6340], [35.8190, 10.6180]
    ]);
  }
  if (p === '/api/history' || p === '/api/detections') {
    return [
      { id: 1, vehicle_code: 'TUN-101', timestamp: Date.now() - 360000, ear: 0.18, closed_sec: 5.2, image_url: '/static/captures/1729606132_TUN-101.jpg' },
      { id: 2, vehicle_code: 'CAR-02', timestamp: Date.now() - 1200000, ear: 0.15, closed_sec: 5.4, image_url: '/static/captures/1729606132_CAR-02.jpg' }
    ];
  }
  if (p === '/api/alerts') {
    return [
      { id: 1, vehicle_id: 'TUN-101', plate: '195-TN-5521', level: 4, title: 'Somnolence détectée (>5s)', timestamp: Date.now() - 450000, acked: true },
      { id: 2, vehicle_id: 'CAR-02', plate: '184-TN-2024', level: 2, title: 'Inattention', timestamp: Date.now() - 1800000, acked: true }
    ];
  }
  return { ok: true };
}

async function api(path, opts = {}) {
  const o = { headers: {}, ...opts };
  if (AUTH.token) o.headers['Authorization'] = `Bearer ${AUTH.token}`;
  if (o.body && typeof o.body !== 'string') {
    o.body = JSON.stringify(o.body);
    o.headers['Content-Type'] = 'application/json';
  }
  try {
    const r = await fetch(path, o);
    if (!r.ok) {
      if (r.status === 404 || r.status === 405) {
        return getMockApiResponse(path, opts);
      }
      if (r.status === 401 && !path.includes('/api/auth/')) {
        AUTH.clear(); showAuthScreen(); throw new Error('Session expirée');
      }
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error || r.statusText);
    }
    return await r.json();
  } catch (err) {
    if (err && err.message === 'Session expirée') throw err;
    return getMockApiResponse(path, opts);
  }
}

// ─── I18N ──────────────────────────────────────────────────────────────
const I18N = {
  fr: {
    dashboard: 'Tableau de bord', map: 'Carte en direct', vehicles: 'Flotte de véhicules',
    drivers: 'Clients', clients: 'Clients', history: 'Historique Détections',
    alerts: 'Alertes & Appels', settings: 'Réglages',
    client_dashboard: 'Tableau de bord', client_camera: 'Caméra', client_plan: 'Mon offre', client_profile: 'Mon profil', client_trip: 'Mon trajet', client_alerts: 'Mes alarmes',
    client_detections: 'Mes détections',
    logout: 'Déconnexion', totalAlerts: 'Total des alertes', today: "aujourd'hui",
    cars: 'Véhicules', offline: 'hors ligne', online: 'en ligne', driversCount: 'Clients',
    lastAlert: 'Dernière alerte', none: 'Aucune', liveMap: 'Surveillance en direct',
    alertsPerDay: 'Alertes des 7 derniers jours', plate: 'Matricule', driver: 'Conducteur',
    time: 'Heure', position: 'Position', stopAlarm: "Arrêter l'alarme", awake: 'Je suis réveillé',
    seeMap: 'Voir sur la carte', endCall: 'Raccrocher', soundNeed: 'Son désactivé',
    enableSound: 'ACTIVER LE SON', add: 'Ajouter', edit: 'Modifier', del: 'Supprimer',
    save: 'Enregistrer', cancel: 'Annuler', export: 'Exporter Excel', brand: 'Marque',
    model: 'Modèle', color: 'Couleur', status: 'Statut', alertsCount: 'Alertes',
    name: 'Nom complet', phone: 'Téléphone', license: 'CIN / Permis', code: 'Code voiture',
    all: 'Tous', from: 'Du', to: 'Au', download: 'Télécharger', confirmDel: 'Supprimer ?',
    noData: 'Aucune donnée', follow: 'Suivre', fitRoute: 'Vue globale',
    eyesClosedS: 'Durée yeux fermés', speed: 'Vitesse', state: 'État', duration: 'Durée',
    Safe: 'OK', EyesOpen: 'Yeux ouverts', EyesClosed: 'Yeux fermés',
    Asleep: 'ENDORMI', NoFace: 'Visage non détecté', NoDetection: '—',
    helpTitle: 'Aide & Présentation',
    helpText: 'Plateforme de surveillance de somnolence. Les conducteurs (Clients) suivent leur état et alertes. Le Superviseur (Police) reçoit les appels d\'urgence. Tout (appels, GPS, CIN) est SIMULÉ.',
    close: 'Fermer',
  }
};
let LANG = 'fr';
const t = (k, vars) => {
  let s = (I18N[LANG]?.[k]) || k;
  if (vars) for (const v in vars) s = s.replace('{' + v + '}', vars[v]);
  return s;
};
const fmtDate = (ts) => ts ? new Date(ts).toLocaleString('fr-FR') : '—';
const fmtTime = (ts) => ts ? new Date(ts).toLocaleTimeString('fr-FR') : '—';
const initial = (s) => (String(s || '?').trim()[0] || '?').toUpperCase();

// ─── État global ───────────────────────────────────────────────────────
const S = {
  vehicles: [], drivers: [], states: {}, online: {}, alerts: [], reports: {},
  stats: null, settings: {}, route: null, wsOk: false, soundOn: false, unread: 0,
};
const COLORS = ['#10b981','#3b82f6','#f59e0b','#a855f7','#ec4899','#14b8a6','#ef4444'];
const colorOf = (code) => { const i = S.vehicles.map(v => v.code).sort().indexOf(code); return COLORS[(i < 0 ? 0 : i) % COLORS.length]; };
const vehOf = (code) => S.vehicles.find(v => v.code === code);
const plateOf = (code) => vehOf(code)?.plate || code;
const driverOf = (code) => vehOf(code)?.driver_name || '—';
const isOnline = (code) => !!S.online[code];

// ─── Navigation ────────────────────────────────────────────────────────
let PAGE = '';

function getPagesForRole() {
  if (AUTH.user?.role === 'client') {
    return [
      { id: 'client_dashboard', icon: 'fa-gauge-high', group: 'Surveillance' },
      { id: 'client_camera', icon: 'fa-video', group: 'Surveillance' },
      { id: 'client_trip', icon: 'fa-map-location-dot', group: 'Surveillance' },
      { id: 'client_alerts', icon: 'fa-bell', group: 'Surveillance' },
      { id: 'client_detections', icon: 'fa-eye', group: 'Surveillance' },
      { id: 'client_profile', icon: 'fa-id-card', group: 'Mon Compte' },
      { id: 'client_plan', icon: 'fa-crown', group: 'Mon Compte' },
    ];
  }
  return [
    { id: 'dashboard', icon: 'fa-table-cells-large', group: 'Centre de contrôle' },
    { id: 'map', icon: 'fa-map-location-dot', group: 'Centre de contrôle' },
    { id: 'clients', icon: 'fa-users', group: 'Gestion' },
    { id: 'vehicles', icon: 'fa-car', group: 'Gestion' },
    { id: 'history', icon: 'fa-eye', group: 'Surveillance' },
    { id: 'alerts', icon: 'fa-bell', group: 'Surveillance' },
    { id: 'settings', icon: 'fa-gear', group: 'Système' },
  ];
}

function renderNav() {
  const pages = getPagesForRole();
  let html = '', group = '';
  for (const p of pages) {
    if (p.group !== group) { group = p.group; html += `<div class="nav-group">${esc(group)}</div>`; }
    html += `<a class="nav-item ${p.id === PAGE ? 'active' : ''}" href="#${p.id}"><i class="fa-solid ${p.icon}"></i><span>${esc(t(p.id))}</span></a>`;
  }
  $('#nav').innerHTML = html;
  const pg = pages.find(p => p.id === PAGE);
  $('#pageTitle').textContent = pg ? t(pg.id) : '';
}

function route() {
  if (!AUTH.user) { showAuthScreen(); return; }
  const pages = getPagesForRole();
  const defaultPage = AUTH.user.role === 'client' ? 'client_dashboard' : 'dashboard';
  const id = (location.hash || `#${defaultPage}`).slice(1).split('?')[0];
  PAGE = pages.some(p => p.id === id) ? id : defaultPage;
  document.body.classList.remove('menu-open');
  if (PAGE !== 'client_camera') stopCamera();
  destroyMap();
  renderNav();
  updateHeaderAndSidebar();
  const view = $('#view');
  view.innerHTML = '';
  const router = {
    client_camera: pageClientCamera, client_dashboard: pageClientDashboard, client_plan: pageClientPlan, client_trip: pageClientTrip, client_alerts: pageClientAlerts,
    client_detections: pageClientDetections, client_profile: pageClientProfile,
    dashboard: pageDashboard, map: pageMap, clients: pageClients,
    vehicles: pageVehicles, history: pageHistory, alerts: pageAlerts,
    settings: pageSettings,
  };
  if (router[PAGE]) router[PAGE](view);
  else view.innerHTML = `<div class="card"><p>Page non trouvée.</p></div>`;
}

function updateHeaderAndSidebar() {
  const u = AUTH.user;
  if (!u) return;
  const isSuper = u.role === 'supervisor';
  $('#rolePill').textContent = isSuper ? 'SUPERVISEUR' : 'ESPACE CONDUCTEUR';
  $('#rolePill').className = `role-pill ${isSuper ? 'police' : ''}`;
  $('#userAvatar').textContent = initial(u.full_name || u.username);
  $('#userName').textContent = u.full_name || u.username;
  $('#userRoleDetail').textContent = isSuper ? 'Police & Secours' : (u.plate ? `Véhicule: ${u.plate}` : 'Conducteur');
  const clBanner = $('#clientLiveBanner');
  if (clBanner) {
    if (!isSuper && u.vehicle_code) { clBanner.style.display = 'flex'; updateClientLiveBanner(); }
    else clBanner.style.display = 'none';
  }
  // Mode nuit par défaut (client et police), sauf si l'utilisateur a choisi un autre thème avec le bouton
  applyTheme(preferredTheme());
}

function updateClientLiveBanner() {
  const u = AUTH.user;
  if (!u || u.role !== 'client') return;
  const vid = u.vehicle_code, st = S.states[vid] || {}, on = isOnline(vid);
  const set = (id, val) => { const e = $(`#${id}`); if (e) e.textContent = val; };
  set('clCarCode', vid); set('clPlate', u.plate || '—');
  const dot = $('#clOnlineDot'); if (dot) dot.className = `status-dot-sm ${on ? 'on' : ''}`;
  set('clOnlineText', on ? 'En ligne' : 'Hors ligne');
  set('clState', t(st.state) || (st.state || 'Safe'));
  set('clSpeed', Math.round(st.speed || 0));
}

// ─── Auth Screen ───────────────────────────────────────────────────────
function showAuthScreen() {
  $('#authScreen').style.display = 'flex';
  $('#app').style.display = 'none';
  destroyMap();
}
function hideAuthScreen() {
  $('#authScreen').style.display = 'none';
  $('#app').style.display = 'flex';
}

function setupPasswordToggle(inputId, btnId) {
  const btn = $(`#${btnId}`), inp = $(`#${inputId}`);
  if (!btn || !inp) return;
  btn.addEventListener('click', () => {
    const isPass = inp.type === 'password';
    inp.type = isPass ? 'text' : 'password';
    btn.innerHTML = isPass ? '<i class="fa-regular fa-eye-slash"></i>' : '<i class="fa-regular fa-eye"></i>';
  });
}

function setupAuthTabs() {
  const tabClient = $('#tabClientBtn'), tabSuper = $('#tabSuperBtn');
  const panClient = $('#panelClient'), panSuper = $('#panelSuper');

  tabClient.addEventListener('click', () => {
    tabClient.classList.add('active'); tabSuper.classList.remove('active');
    panClient.classList.add('active'); panSuper.classList.remove('active');
  });
  tabSuper.addEventListener('click', () => {
    tabSuper.classList.add('active'); tabClient.classList.remove('active');
    panSuper.classList.add('active'); panClient.classList.remove('active');
  });

  if (APP_CLIENT) tabClient.click();
  setupPasswordToggle('clientPass', 'toggleClientPass');
  setupPasswordToggle('superPass', 'toggleSuperPass');

  $('#btnFillDemoClient').addEventListener('click', () => { $('#clientUser').value = 'client1'; $('#clientPass').value = 'client123'; });
  $('#btnFillDemoSuper').addEventListener('click', () => { $('#superUser').value = 'police'; $('#superPass').value = 'police123'; });

  const setLoginError = (id, msg) => { const e = $(`#${id}`); if (e) { e.textContent = msg; e.classList.toggle('show', !!msg); } };

  $('#formLoginClient').addEventListener('submit', async (e) => {
    e.preventDefault();
    setLoginError('clientLoginError', '');
    const btn = $('#btnSubmitClient');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner spin"></i> Connexion…';
    try {
      await AUTH.login($('#clientUser').value, $('#clientPass').value);
      if ($('#clientRemember').checked) sset('remembered_user', $('#clientUser').value);
      toast(`Bienvenue ${AUTH.user.full_name || AUTH.user.username}`, 'success');
      applyTheme(preferredTheme());
      await onAuthSuccess();
    } catch (err) {
      setLoginError('clientLoginError', err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Se connecter';
    }
  });

  $('#formLoginSuper').addEventListener('submit', async (e) => {
    e.preventDefault();
    setLoginError('superLoginError', '');
    const btn = $('#btnSubmitSuper');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner spin"></i> Connexion…';
    try {
      await AUTH.login($('#superUser').value, $('#superPass').value);
      toast('Salle de contrôle Police connectée', 'success');
      applyTheme(preferredTheme());
      await onAuthSuccess();
    } catch (err) {
      setLoginError('superLoginError', err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-shield-halved"></i> Connexion Salle de Contrôle';
    }
  });

  $('#btnOpenRegister').addEventListener('click', () => openRegisterModal());

  // Pré-remplir si rememberd
  const rem = sget('remembered_user', '');
  if (rem) { $('#clientUser').value = rem; $('#clientRemember').checked = true; }
}

async function onAuthSuccess() {
  if (APP_CLIENT && AUTH.user?.role !== 'client') {
    AUTH.clear(); showAuthScreen();
    toast("Cette application est réservée aux conducteurs. Utilise le site web pour l'espace police.", 'error', 5000);
    return;
  }
  hideAuthScreen();
  await loadInitialData();
  connectWS();
  location.hash = AUTH.user.role === 'client' ? '#client_dashboard' : '#dashboard';
  route();
  if (APP_CLIENT && AUTH.user.role === 'client') nativeCam('start');
}

// ─── OFFRES & PAIEMENT SIMULÉ ──────────────────────────────────────────
let PLANS_CACHE = null;
async function getPlans() { if (!PLANS_CACHE) PLANS_CACHE = await api('/api/plans'); return PLANS_CACHE; }

function planCardsHtml(plans, selected, current) {
  return `<div class="pl-grid">${plans.map(p => `
    <button type="button" class="pl-card ${p.id === selected ? 'sel' : ''}" data-plan="${esc(p.id)}">
      ${p.popular ? '<span class="pl-tag">Le plus choisi</span>' : ''}${current === p.id ? '<span class="pl-tag cur">Offre actuelle</span>' : ''}
      <h4>${esc(p.name)}</h4>
      <div class="pl-price"><b>${p.price}</b> TND<small> / mois</small></div>
      <ul>${p.features.map(f => `<li><i class="fa-solid fa-check"></i>${esc(f)}</li>`).join('')}</ul>
    </button>`).join('')}</div>`;
}

function payFormHtml(plan) {
  return `<div class="pay-sum"><span>${esc(plan.name)} · 30 jours</span><b>${plan.price} TND</b></div>
    <div class="auth-notice"><i class="fa-solid fa-flask"></i><span><b>Paiement simulé :</b> aucune somme n'est débitée. Utilise un numéro de test, par exemple 4242 4242 4242 4242. Seuls les 4 derniers chiffres sont conservés.</span></div>
    <div class="field"><label for="pay_name">Nom sur la carte</label><input id="pay_name" type="text" autocomplete="off" placeholder="Sami Trabelsi"></div>
    <div class="field"><label for="pay_num">Numéro de carte</label><input id="pay_num" type="text" inputmode="numeric" autocomplete="off" placeholder="4242 4242 4242 4242"></div>
    <div class="pay-row"><div class="field"><label for="pay_exp">Expiration</label><input id="pay_exp" type="text" inputmode="numeric" autocomplete="off" placeholder="MM/AA"></div>
    <div class="field"><label for="pay_cvc">CVC</label><input id="pay_cvc" type="text" inputmode="numeric" autocomplete="off" placeholder="123"></div></div>
    <div class="field-error" id="payErr"></div>
    <button type="button" class="btn wide" id="btnPay"><i class="fa-solid fa-lock"></i> Payer ${plan.price} TND</button>`;
}

function wirePayForm(root, plan, onPaid) {
  const num = $('#pay_num', root), exp = $('#pay_exp', root), cvc = $('#pay_cvc', root), err = $('#payErr', root), btn = $('#btnPay', root);
  num.addEventListener('input', () => { num.value = num.value.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim(); });
  exp.addEventListener('input', () => { const d = exp.value.replace(/\D/g, '').slice(0, 4); exp.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d; });
  cvc.addEventListener('input', () => { cvc.value = cvc.value.replace(/\D/g, '').slice(0, 4); });
  const label = `<i class="fa-solid fa-lock"></i> Payer ${plan.price} TND`;
  btn.addEventListener('click', async () => {
    const digits = num.value.replace(/\D/g, ''), m = +exp.value.slice(0, 2);
    let msg = '';
    if (!$('#pay_name', root).value.trim()) msg = 'Le nom sur la carte est obligatoire.';
    else if (digits.length < 13) msg = 'Numéro de carte invalide (13 à 19 chiffres).';
    else if (!/^\d\d\/\d\d$/.test(exp.value) || m < 1 || m > 12) msg = "Date d'expiration invalide (MM/AA).";
    else if (cvc.value.length < 3) msg = 'Code CVC invalide (3 ou 4 chiffres).';
    err.textContent = msg; err.classList.toggle('show', !!msg);
    if (msg) return;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner spin"></i> Paiement en cours…';
    await new Promise(r => setTimeout(r, 1800));
    try { await onPaid(digits.slice(-4)); }
    catch (e) { err.textContent = e.message; err.classList.add('show'); btn.disabled = false; btn.innerHTML = label; }
  });
}

// ─── INSCRIPTION EN 4 ÉTAPES: informations → offre → paiement simulé → reçu ───
async function openRegisterModal() {
  const plans = await getPlans().catch(() => []);
  const st = { step: 1, data: {}, plan: (plans.find(p => p.popular) || plans[0] || {}).id, res: null };
  const labels = ['Informations', 'Offre', 'Paiement', 'Confirmation'];
  const head = (n) => `<div class="modal-head"><i class="fa-solid fa-cart-shopping" style="color:var(--brand)"></i> Souscription au service<span class="sim-badge" style="margin-inline-start:auto">Paiement simulé</span></div>
    <div class="rg-steps">${labels.map((l, i) => `<div class="${i + 1 < n ? 'done' : i + 1 === n ? 'active' : ''}"><i>${i + 1 < n ? '✓' : i + 1}</i><span>${l}</span></div>`).join('')}</div>`;
  const fld = (id, label, ph, type = 'text', extra = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" placeholder="${ph}" value="${esc(st.data[id] || '')}" ${extra}><div class="field-error" id="e_${id}"></div></div>`;
  const rules = {
    rf_name: (v) => v.trim().length < 2 ? 'Nom obligatoire (2 caractères minimum).' : '',
    rf_cin: (v) => /^\d{8}$/.test(v) ? '' : 'Le CIN doit comporter exactement 8 chiffres.',
    rf_phone: (v) => /^\+?[\d\s]{8,16}$/.test(v.trim()) ? '' : 'Téléphone invalide (ex: +216 20 123 456).',
    rf_email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'Adresse email invalide.',
    rf_pass: (v) => v.length < 4 ? 'Au moins 4 caractères.' : '',
    rf_plate: (v) => v.trim() ? '' : 'Le matricule est obligatoire.',
  };
  const showErr = (id, msg) => { const e = $('#e_' + id), i = $('#' + id); if (e) { e.textContent = msg; e.classList.toggle('show', !!msg); } if (i) i.classList.toggle('error', !!msg); };

  const step1 = () => {
    openModal(`${head(1)}<div class="modal-body"><div class="rg-grid">
      <div style="grid-column:1/-1">${fld('rf_name', 'Nom complet *', 'Sami Trabelsi')}</div>
      ${fld('rf_cin', 'CIN (8 chiffres) *', '08765432', 'text', 'maxlength="8" inputmode="numeric"')}
      ${fld('rf_phone', 'Téléphone *', '+216 20 123 456', 'tel')}
      <div style="grid-column:1/-1">${fld('rf_email', 'Email *', 'sami@exemple.tn', 'email')}</div>
      ${fld('rf_pass', 'Mot de passe *', '4 caractères minimum', 'password')}
      ${fld('rf_plate', 'Matricule voiture *', '185 TUN 9920')}
      ${fld('rf_brand', 'Marque et modèle', 'Peugeot 208')}${fld('rf_color', 'Couleur', 'Blanche')}
      ${fld('rf_em_name', "Contact d'urgence (nom)", 'Houda Trabelsi')}${fld('rf_em_phone', "Contact d'urgence (tél)", '+216 22 987 654', 'tel')}
    </div></div><div class="modal-foot"><button class="btn gray" data-close>Annuler</button><button class="btn" id="rgNext">Suivant <i class="fa-solid fa-arrow-right"></i></button></div>`, true);
    $('#rf_cin').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); });
    Object.keys(rules).forEach(id => $('#' + id).addEventListener('input', (e) => { const v = e.target.value; if (v) showErr(id, rules[id](v)); else showErr(id, ''); }));
    $('#rgNext').addEventListener('click', () => {
      let bad = false;
      Object.keys(rules).forEach(id => { const m = rules[id]($('#' + id).value); showErr(id, m); if (m) bad = true; });
      $$('.rg-grid input').forEach(i => { st.data[i.id] = i.value; });
      if (bad) { toast('Corrige les champs en rouge.', 'error'); return; }
      st.step = 2; render();
    });
  };

  const step2 = () => {
    openModal(`${head(2)}<div class="modal-body"><p class="dsh-muted" style="margin-bottom:14px">Choisis l'offre qui te convient. Tu pourras la changer plus tard dans « Mon offre ».</p>${planCardsHtml(plans, st.plan)}</div>
      <div class="modal-foot"><button class="btn gray" id="rgBack"><i class="fa-solid fa-arrow-left"></i> Retour</button><button class="btn" id="rgNext">Continuer vers le paiement <i class="fa-solid fa-arrow-right"></i></button></div>`, true);
    $$('.pl-card').forEach(c => c.addEventListener('click', () => { st.plan = c.dataset.plan; $$('.pl-card').forEach(x => x.classList.toggle('sel', x === c)); }));
    $('#rgBack').addEventListener('click', () => { st.step = 1; render(); });
    $('#rgNext').addEventListener('click', () => { st.step = 3; render(); });
  };

  const step3 = () => {
    const plan = plans.find(p => p.id === st.plan);
    openModal(`${head(3)}<div class="modal-body" id="payBox">${payFormHtml(plan)}</div>
      <div class="modal-foot"><button class="btn gray" id="rgBack"><i class="fa-solid fa-arrow-left"></i> Retour</button></div>`);
    $('#rgBack').addEventListener('click', () => { st.step = 2; render(); });
    wirePayForm($('#payBox'), plan, async (last4) => {
      const d = st.data;
      const body = {
        full_name: d.rf_name.trim(), cin: d.rf_cin.trim(), phone: d.rf_phone.trim(), email: d.rf_email.trim(),
        password: d.rf_pass.trim(), plate: d.rf_plate.trim().toUpperCase(), brand: (d.rf_brand || '').trim(),
        color: (d.rf_color || '').trim() || 'Blanche', emergency_name: (d.rf_em_name || '').trim(),
        emergency_phone: (d.rf_em_phone || '').trim(), plan: st.plan, card_last4: last4,
      };
      try { st.res = await api('/api/auth/register', { method: 'POST', body }); }
      catch (e) { toast(e.message, 'error', 5000); st.step = 1; render(); throw e; }
      AUTH.set(st.res.token, st.res.user);
      st.step = 4; render();
    });
  };

  const step4 = () => {
    const r = st.res, s = r.subscription || {};
    openModal(`${head(4)}<div class="modal-body" style="text-align:center">
      <h3 style="font-size:20px;margin-bottom:4px"><i class="fa-solid fa-circle-check" style="color:var(--brand)"></i> Paiement simulé accepté</h3>
      <p class="dsh-muted" style="margin-bottom:16px">Bienvenue, ${esc(r.user.full_name)}. Ton véhicule ${esc(r.plate)} est enregistré.</p>
      <div class="rc-box"><div><small>Offre</small><b>${esc(s.plan_name || '—')}</b></div><div><small>Montant</small><b>${s.amount != null ? s.amount + ' TND' : '—'}</b></div><div><small>Reçu</small><b>${esc(s.receipt || '—')}</b></div><div><small>Valable jusqu'au</small><b>${s.expires_at ? new Date(s.expires_at).toLocaleDateString('fr-FR') : '—'}</b></div></div>
      <div class="vehicle-code-box"><div class="code-label"><i class="fa-solid fa-car"></i> Ton code voiture</div><div class="code-val">${esc(r.vehicle_code)}</div></div>
      <div class="auth-notice" style="text-align:start"><i class="fa-solid fa-mobile-screen"></i><span><b>Étape suivante :</b> installe l'application sur ton téléphone, connecte-toi avec ton email <b>${esc(r.user.username || r.user.email || '')}</b> et ton mot de passe. La caméra du téléphone surveillera alors tes yeux et déclenchera l'alerte.</span></div>
      </div>
      <div class="modal-foot" style="justify-content:center"><button class="btn" id="rgEnter"><i class="fa-solid fa-arrow-right"></i> Accéder à mon espace</button></div>`, true);
    $('#rgEnter').addEventListener('click', async () => { closeModal(); applyTheme(preferredTheme()); await onAuthSuccess(); });
  };

  const render = () => [null, step1, step2, step3, step4][st.step]();
  render();
}

// ─── CLIENT: Mon offre ─────────────────────────────────────────────────
async function pageClientPlan(view) {
  view.innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-spinner spin"></i><p>Chargement de ton offre…</p></div></div>';
  const [plans, sub] = await Promise.all([getPlans().catch(() => []), api('/api/client/subscription').catch(() => ({}))]);
  if (PAGE !== 'client_plan') return;
  const has = sub && sub.plan_id;
  const left = has ? Math.max(0, Math.ceil((sub.expires_at - Date.now()) / 86400000)) : 0;
  view.innerHTML = `
    <div class="card" style="margin-bottom:18px"><div class="card-head"><div class="ico-sm"><i class="fa-solid fa-crown"></i></div>Mon offre</div>
      ${has ? `<div class="rc-box" style="margin:18px"><div><small>Offre active</small><b>${esc(sub.plan_name)}</b></div><div><small>Montant</small><b>${sub.amount} TND / mois</b></div>
        <div><small>Valable jusqu'au</small><b>${esc(new Date(sub.expires_at).toLocaleDateString('fr-FR'))} (${left} j)</b></div><div><small>Reçu</small><b>${esc(sub.receipt)}</b></div>
        <div><small>Carte</small><b>•••• ${esc(sub.card_last4 || '----')}</b></div></div>`
      : '<div class="empty"><i class="fa-solid fa-crown"></i><p>Aucune offre active. Choisis une offre ci-dessous.</p></div>'}
    </div>
    <h3 style="margin:0 0 12px">${has ? "Changer d'offre" : 'Choisir une offre'}</h3>${planCardsHtml(plans, null, sub && sub.plan_id)}`;
  $$('.pl-card', view).forEach(c => c.addEventListener('click', () => {
    const plan = plans.find(p => p.id === c.dataset.plan); if (!plan) return;
    openModal(`<div class="modal-head"><i class="fa-solid fa-credit-card" style="color:var(--brand)"></i> Paiement — ${esc(plan.name)}<span class="sim-badge" style="margin-inline-start:auto">Paiement simulé</span></div>
      <div class="modal-body" id="payBox">${payFormHtml(plan)}</div><div class="modal-foot"><button class="btn gray" data-close>Annuler</button></div>`);
    wirePayForm($('#payBox'), plan, async (last4) => {
      await api('/api/client/subscription', { method: 'POST', body: { plan: plan.id, card_last4: last4 } });
      closeModal(); toast(`Offre ${plan.name} activée (paiement simulé)`, 'success'); pageClientPlan(view);
    });
  }));
}

// ─── CARTE (Leaflet) ───────────────────────────────────────────────────
const MAP = { map: null, markers: {}, segs: {}, last: {}, hidden: new Set(), follow: false, focus: null, routeLayer: null };
const CAR_SVG = (c) => `<svg viewBox="0 0 40 40" class="car-ico"><rect x="11" y="3" width="18" height="34" rx="8" fill="${c}" stroke="#fff" stroke-width="2"/><rect x="14" y="10" width="12" height="7" rx="2" fill="#0f172a" opacity=".85"/><rect x="14" y="23" width="12" height="6" rx="2" fill="#0f172a" opacity=".6"/><circle cx="15" cy="5.5" r="1.6" fill="#fde047"/><circle cx="25" cy="5.5" r="1.6" fill="#fde047"/></svg>`;

function destroyMap() {
  if (MAP.map) { try { MAP.map.remove(); } catch {} }
  MAP.map = null; MAP.markers = {}; MAP.segs = {}; MAP.last = {}; MAP.routeLayer = null;
}

function flagIcon(cls, icon) {
  return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [8, 28], html: `<div style="font-size:26px;color:${cls};filter:drop-shadow(0 2px 2px rgba(0,0,0,.5))"><i class="fa-solid ${icon}"></i></div>` });
}

function initMap(elId, singleCode = null) {
  destroyMap();
  const dark = document.documentElement.dataset.theme === 'dark';
  const tileUrl = dark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const m = L.map(elId, { zoomControl: true }).setView([35.8256, 10.5908], 14);
  L.tileLayer(tileUrl, { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(m);
  MAP.map = m;

  if (S.route?.points?.length > 1) {
    const pts = S.route.points;
    MAP.routeLayer = L.polyline(pts, { color: '#94a3b8', weight: 6, opacity: .8 }).addTo(m);
    L.polyline(pts, { color: '#e2e8f0', weight: 2, opacity: .7, dashArray: '4 10' }).addTo(m);
    L.marker(pts[0], { icon: flagIcon('#10b981', 'fa-flag'), zIndexOffset: -100 }).addTo(m).bindTooltip('Départ');
    L.marker(pts[pts.length-1], { icon: flagIcon('#0f172a', 'fa-flag-checkered'), zIndexOffset: -100 }).addTo(m).bindTooltip('Arrivée');
    m.fitBounds(MAP.routeLayer.getBounds(), { padding: [30, 30] });
  }

  if (singleCode) { if (S.states[singleCode]) updateCar(S.states[singleCode], true); }
  else for (const code in S.states) updateCar(S.states[code], true);

  setTimeout(() => m.invalidateSize(), 150);
}

function updateCar(st, silent) {
  const m = MAP.map;
  if (!m || st.lat == null || st.lon == null) return;
  const code = st.vehicle_id;
  if (MAP.hidden.has(code)) {
    if (MAP.markers[code]) { m.removeLayer(MAP.markers[code]); delete MAP.markers[code]; }
    return;
  }
  const pos = [st.lat, st.lon], color = colorOf(code);
  let mk = MAP.markers[code];
  if (!mk) {
    const icon = L.divIcon({ className: 'car-marker', iconSize: [36, 36], iconAnchor: [18, 18], html: `<div class="car-wrap">${CAR_SVG(color)}</div>` });
    mk = L.marker(pos, { icon, zIndexOffset: 500 }).addTo(m);
    mk.bindTooltip(plateOf(code), { permanent: true, direction: 'top', offset: [0, -14] });
    MAP.markers[code] = mk;
  } else { mk.setLatLng(pos); }

  const el = mk.getElement();
  if (el) {
    const ico = el.querySelector('.car-ico');
    if (ico) ico.style.transform = `rotate(${st.heading || 0}deg)`;
    const wrap = el.querySelector('.car-wrap');
    if (wrap) wrap.classList.toggle('alert', st.state === 'Asleep');
  }
  mk.bindPopup(`<b>${esc(plateOf(code))}</b><br>${esc(driverOf(code))}<br><span style="color:${st.state==='Asleep'?'#ef4444':'#10b981'}">${esc(t(st.state)||st.state)}</span> · ${Math.round(st.speed ?? 0)} km/h`);

  const prev = MAP.last[code];
  if (prev && m.distance(prev, pos) < 300) {
    const bad = st.state === 'Asleep' || st.state === 'EyesClosed';
    const seg = L.polyline([prev, pos], { color: bad ? '#ef4444' : color, weight: 4, opacity: .9 }).addTo(m);
    (MAP.segs[code] = MAP.segs[code] || []).push(seg);
    if (MAP.segs[code].length > 200) m.removeLayer(MAP.segs[code].shift());
  } else if (prev) { (MAP.segs[code] || []).forEach(s => m.removeLayer(s)); MAP.segs[code] = []; }
  MAP.last[code] = pos;

  if (MAP.follow && !silent) {
    const target = MAP.focus || Object.keys(S.states)[0];
    if (target === code) m.panTo(pos, { animate: true, duration: 0.5 });
  }
}

function focusCar(code) {
  MAP.focus = code;
  const st = S.states[code];
  if (MAP.map && st?.lat != null) MAP.map.setView([st.lat, st.lon], Math.max(MAP.map.getZoom(), 16), { animate: true });
  MAP.markers[code]?.openPopup();
}

// ─── MODALES ───────────────────────────────────────────────────────────
function openModal(html, wide = false) {
  const m = $('#modal');
  m.className = 'modal' + (wide ? ' wide' : '');
  m.innerHTML = html;
  $('#modalOverlay').classList.add('show');
  $$('[data-close]', m).forEach(b => b.addEventListener('click', closeModal));
}
function closeModal() { $('#modalOverlay').classList.remove('show'); $('#modal').innerHTML = ''; }
$('#modalOverlay').addEventListener('click', (e) => { if (e.target.id === 'modalOverlay') closeModal(); });

// ══════════════════════════════════════════════════════════════════════
// PAGES CLIENT
// ══════════════════════════════════════════════════════════════════════

// ─── CLIENT: Tableau de bord ────────────────────────────────────────────
const ALERT_BADGE = { 'Annulé par moi': 'green', 'Police appelée': 'red', 'Police a répondu': 'blue', 'Unité envoyée': 'blue', 'Clôturé': 'gray', 'En attente': 'amber' };

function dashVigilance(st) {
  const thr = parseFloat(S.settings?.eyes_closed_s) || 5;
  return Math.max(0, Math.min(100, Math.round(100 - ((st.eyes_closed_s || 0) / thr) * 100)));
}

function updateClientDash() {
  if (PAGE !== 'client_dashboard' || !AUTH.user) return;
  const vid = AUTH.user.vehicle_code, st = S.states[vid] || {}, on = isOnline(vid);
  const set = (id, v) => { const e = $('#' + id); if (e) e.textContent = v; };
  set('dOnline', on ? 'En ligne' : 'Hors ligne');
  set('dEyes', st.state ? (st.state === 'EyesClosed' || st.state === 'Asleep' ? 'Yeux fermés' : st.state === 'NoFace' ? 'Visage non détecté' : 'Yeux ouverts') : 'En attente de données');
  set('dSpeed', `${Math.round(st.speed || 0)} km/h`);
  set('dUpdated', st.ts ? fmtTime(st.ts) : '—');
  const dot = $('#dDot'); if (dot) dot.className = `dsh-dot ${on ? 'on' : ''}`;
  const v = dashVigilance(st);
  set('dVigNum', `${v}%`);
  const g = $('#dVigFill'); if (g) { g.style.width = v + '%'; g.dataset.lvl = v >= 70 ? 'ok' : v >= 40 ? 'warn' : 'bad'; }
  const p = st.route_progress;
  const km = S.route?.distance_km;
  set('dTripPct', p != null ? `${Math.round(p)} %` : '—');
  set('dTripLeft', p == null ? 'En attente de la voiture' : km ? `${(km * (1 - p / 100)).toFixed(1)} km restants` : 'Trajet en cours');
  const bar = $('#dTripBar'); if (bar) bar.style.width = (p != null ? Math.round(p) : 0) + '%';
}

async function pageClientDashboard(view) {
  const u = AUTH.user;
  view.innerHTML = `<div class="grid stats">${'<div class="card stat"><div class="skel" style="width:100%;height:60px"></div></div>'.repeat(4)}</div>`;
  const [alerts, dets] = await Promise.all([
    api('/api/client/alerts?limit=500').catch(() => []),
    api('/api/client/detections').catch(() => []),
  ]);
  if (PAGE !== 'client_dashboard') return;
  const week = Date.now() - 7 * 86400000;
  // Seules les alertes critiques (conducteur endormi, niveau 4) comptent pour le score
  const critical = alerts.filter(a => (a.level || 4) >= 4);
  const alertsWeek = critical.filter(a => a.ts > week).length;
  const score = Math.max(0, 100 - alertsWeek * 10);
  const lvl = score >= 70 ? 'ok' : score >= 40 ? 'warn' : 'bad';
  const km = S.route?.distance_km ? S.route.distance_km.toFixed(1) : '—';
  const last = critical[0] || alerts[0];
  const kpi = (cls, ico, label, val) => `<div class="card stat"><div class="ico ${cls}"><i class="fa-solid ${ico}"></i></div><div><small>${label}</small><b>${val}</b></div></div>`;

  view.innerHTML = `
    <div class="card dsh-banner">
      <span class="dsh-dot" id="dDot"></span>
      <div class="dsh-banner-main"><small>Voiture ${esc(u.plate || u.vehicle_code || '—')}</small><b id="dOnline">Hors ligne</b></div>
      <div class="dsh-banner-item"><small>État</small><b id="dEyes">—</b></div>
      <div class="dsh-banner-item"><small>Vitesse</small><b id="dSpeed">—</b></div>
      <div class="dsh-banner-item"><small>Dernière mise à jour</small><b id="dUpdated">—</b></div>
    </div>
    <div class="grid dsh-two">
      <div class="card"><div class="card-head"><div class="ico-sm"><i class="fa-solid fa-shield-heart"></i></div>Score de sécurité</div>
        <div class="dsh-score">
          <div class="dsh-ring" data-lvl="${lvl}"><svg viewBox="0 0 120 120"><circle class="t" cx="60" cy="60" r="52"/><circle class="f" cx="60" cy="60" r="52" stroke-dasharray="${(score * 3.267).toFixed(0)} 327" ${score === 0 ? 'style="display:none"' : ''}/></svg><div><b>${score}</b><small>/ 100</small></div></div>
          <p>${alertsWeek === 0 ? 'Aucune alerte cette semaine. Bonne conduite !' : `${alertsWeek} alerte${alertsWeek > 1 ? 's' : ''} critique${alertsWeek > 1 ? 's' : ''} cette semaine.`}</p>
        </div></div>
      <div class="card"><div class="card-head"><div class="ico-sm"><i class="fa-solid fa-eye"></i></div>Vigilance en direct</div>
        <div class="dsh-vig"><div class="dsh-vig-top"><span>Niveau de vigilance</span><b id="dVigNum">100%</b></div>
          <div class="dsh-bar"><i id="dVigFill" data-lvl="ok" style="width:100%"></i></div>
          <div class="dsh-vig-top" style="margin-top:22px"><span>Progression du trajet</span><b id="dTripPct">—</b></div>
          <div class="dsh-bar"><i id="dTripBar" data-lvl="info" style="width:0"></i></div>
          <small id="dTripLeft" class="dsh-muted">—</small></div></div>
    </div>
    <div class="grid stats">
      ${kpi('red', 'fa-bell', 'Alertes critiques (7 j)', alertsWeek)}
      ${kpi('blue', 'fa-camera', 'Images détectées', dets.length)}
      ${kpi('', 'fa-route', 'Distance du trajet', km === '—' ? '—' : km + ' km')}
      ${kpi('amber', 'fa-clock', 'Dernière alerte', last ? `<span class="dsh-small">${esc(new Date(last.ts).toLocaleDateString('fr-FR'))}<br>${esc(fmtTime(last.ts))}</span>` : 'Aucune')}
    </div>
    <div class="grid dsh-two">
      <div class="card"><div class="card-head"><div class="ico-sm blue"><i class="fa-solid fa-images"></i></div>Dernières images détectées<div class="right"><a class="btn sm gray" href="#client_detections">Tout voir</a></div></div>
        ${dets.length ? `<div class="dsh-gal">${dets.slice(0, 6).map(d => `<button class="dsh-thumb" data-d="${d.id}">${d.image_url ? `<img src="${d.image_url}" alt="" loading="lazy">` : '<i class="fa-regular fa-image"></i>'}<span>${d.eyes_closed_s ? d.eyes_closed_s.toFixed(1) + ' s' : '—'}</span></button>`).join('')}</div>`
          : '<div class="empty"><i class="fa-solid fa-camera"></i><p>Aucune image détectée pour le moment.</p></div>'}</div>
      <div class="card"><div class="card-head"><div class="ico-sm red"><i class="fa-solid fa-bell"></i></div>Dernières alertes<div class="right"><a class="btn sm gray" href="#client_alerts">Tout voir</a></div></div>
        ${alerts.length ? `<ul class="dsh-tl">${alerts.slice(0, 6).map(a => `<li><span class="dsh-tl-dot ${ALERT_BADGE[a.status_label] || 'gray'}"></span><div><b>${esc(a.title || 'Somnolence')}</b><small>${esc(fmtDate(a.ts))}</small></div><span class="tag-pill ${ALERT_BADGE[a.status_label] || 'gray'}">${esc(a.status_label || 'En attente')}</span></li>`).join('')}</ul>`
          : '<div class="empty"><i class="fa-solid fa-circle-check"></i><p>Aucune alerte. Tout va bien.</p></div>'}</div>
    </div>`;

  $$('.dsh-thumb', view).forEach(b => b.addEventListener('click', () => {
    const d = dets.find(x => x.id == b.dataset.d); if (!d) return;
    openModal(`<div class="modal-head"><i class="fa-solid fa-eye" style="color:var(--brand)"></i> Détection du ${esc(fmtDate(d.ts))}</div>
      <div class="modal-body">${d.image_url ? `<img src="${d.image_url}" class="big-img" alt="">` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><small style="color:var(--muted)">Yeux fermés</small><br><b>${d.eyes_closed_s ? d.eyes_closed_s.toFixed(1) + ' s' : '—'}</b></div>
      <div><small style="color:var(--muted)">Statut</small><br><b>${esc(d.status_label || d.status || '—')}</b></div></div></div>
      <div class="modal-foot"><button class="btn gray" data-close>Fermer</button></div>`);
  }));
  updateClientDash();
}

// ─── CLIENT: Caméra du téléphone (détection par le serveur) ────────────
const CAM = { stream: null, running: false, timer: null, wake: null };
const CAM_STATES = { EyesOpen: 'Yeux ouverts', EyesClosed: 'Yeux fermés', Asleep: 'ENDORMI', NoFace: 'Visage non détecté' };

function stopCamera() {
  CAM.running = false; clearTimeout(CAM.timer);
  if (CAM.stream) { CAM.stream.getTracks().forEach(t => t.stop()); CAM.stream = null; }
  try { CAM.wake && CAM.wake.release(); } catch {}
  CAM.wake = null;
}

function pageClientCameraNative(view) {
  view.innerHTML = `
    <div class="card"><div class="card-head"><div class="ico-sm"><i class="fa-solid fa-video"></i></div>Caméra du téléphone
      <div class="right"><span class="tag-pill gray" id="camBadge">Arrêtée</span></div></div>
      <div class="cam-wrap">
        <div class="cam-stats">
          <div><small>État</small><b id="camState">—</b></div>
          <div><small>Yeux fermés</small><b id="camSecs">0.0 s</b></div>
          <div><small>Analyse</small><b id="camInfo">—</b></div>
        </div>
        <div class="cam-btns">
          <button class="btn" id="camStart"><i class="fa-solid fa-play"></i> Démarrer la surveillance</button>
          <button class="btn gray" id="camStop" style="display:none"><i class="fa-solid fa-stop"></i> Arrêter</button>
        </div>
        <p class="dsh-muted" style="text-align:center;margin-top:12px">La caméra avant du téléphone surveille tes yeux (petit aperçu en bas à gauche). Garde l'application ouverte et l'écran allumé. L'alerte, la sirène et l'appel de la police se déclenchent ici.</p>
      </div></div>`;
  $('#camStart').addEventListener('click', () => nativeCam('start'));
  $('#camStop').addEventListener('click', () => nativeCam('stop'));
  nativeCam('status');
}

function pageClientCamera(view) {
  if (HAS_APP()) return pageClientCameraNative(view);
  if (APP_CLIENT) {
    view.innerHTML = `<div class="card"><div class="empty"><i class="fa-solid fa-mobile-screen"></i>
      <p><b>Mets à jour l'application.</b><br>Cette version de l'app n'a pas encore la caméra intégrée. Sur le PC : <b>cd C:\\dev\\drowsiness_app</b> puis <b>flutter run</b> (téléphone branché en USB).</p></div></div>`;
    return;
  }
  const ok = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  view.innerHTML = `
    <div class="card"><div class="card-head"><div class="ico-sm"><i class="fa-solid fa-video"></i></div>Caméra du téléphone
      <div class="right"><span class="tag-pill gray" id="camBadge">Arrêtée</span></div></div>
      <div class="cam-wrap">
        ${ok ? '' : `<div class="auth-notice" style="margin:0 0 14px"><i class="fa-solid fa-triangle-exclamation"></i><span><b>La caméra est bloquée par le navigateur</b> car l'adresse n'est pas en HTTPS. Sur Chrome (Android) : ouvre <b>chrome://flags/#unsafely-treat-insecure-origin-as-secure</b>, active-le, ajoute <b>${esc(location.origin)}</b>, puis relance Chrome. Cette page ne marche pas dans l'app tant que le site n'est pas en HTTPS.</span></div>`}
        <div class="cam-box"><video id="camVideo" playsinline muted autoplay></video><canvas id="camOv"></canvas></div>
        <div class="cam-stats">
          <div><small>État</small><b id="camState">—</b></div>
          <div><small>Yeux fermés</small><b id="camSecs">0.0 s</b></div>
          <div><small>Analyse</small><b id="camInfo">—</b></div>
        </div>
        <div class="cam-btns">
          <button class="btn" id="camStart" ${ok ? '' : 'disabled'}><i class="fa-solid fa-play"></i> Démarrer la surveillance</button>
          <button class="btn gray" id="camStop" style="display:none"><i class="fa-solid fa-stop"></i> Arrêter</button>
        </div>
        <p class="dsh-muted" style="text-align:center;margin-top:12px">Place le téléphone face au visage, avec une bonne lumière. Garde cette page ouverte : l'alerte, la sirène et l'appel de la police fonctionnent comme avec la caméra du PC.</p>
      </div></div>`;
  const set = (id, v) => { const e = $('#' + id); if (e) e.textContent = v; };
  const badge = (txt, cls) => { const b = $('#camBadge'); if (b) { b.textContent = txt; b.className = 'tag-pill ' + cls; } };
  $('#camStart').addEventListener('click', async () => {
    const video = $('#camVideo'), ov = $('#camOv'), work = document.createElement('canvas');
    try {
      CAM.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    } catch (e) { toast('Caméra refusée ou indisponible : ' + e.message, 'error', 5000); return; }
    video.srcObject = CAM.stream; await video.play().catch(() => {});
    try { CAM.wake = await navigator.wakeLock.request('screen'); } catch {}
    CAM.running = true; badge('En surveillance', 'green');
    $('#camStart').style.display = 'none'; $('#camStop').style.display = '';
    const loop = async () => {
      if (!CAM.running) return;
      const t0 = Date.now();
      try {
        const w = 480, h = Math.round(w * (video.videoHeight || 480) / (video.videoWidth || 640));
        work.width = w; work.height = h; work.getContext('2d').drawImage(video, 0, 0, w, h);
        const blob = await new Promise(r => work.toBlob(r, 'image/jpeg', 0.6));
        const r = await fetch('/api/client/frame', { method: 'POST', headers: { Authorization: `Bearer ${AUTH.token}`, 'Content-Type': 'image/jpeg' }, body: blob });
        const d = await r.json().catch(() => ({}));
        if (r.status === 401) { stopCamera(); AUTH.clear(); showAuthScreen(); return; }
        if (!r.ok) throw new Error(d.error || r.statusText);
        badge('En surveillance', 'green');
        set('camState', CAM_STATES[d.state] || d.state); set('camSecs', `${(d.eyes_closed_s || 0).toFixed(1)} s`);
        set('camInfo', `${Math.round(d.infer_ms)} ms · ${Date.now() - t0} ms`);
        const stEl = $('#camState'); if (stEl) stEl.dataset.s = d.state;
        // boîtes sur les yeux (le conteneur est inversé comme un miroir: les coordonnées restent justes)
        const cw = video.clientWidth, ch = video.clientHeight; ov.width = cw; ov.height = ch;
        const g = ov.getContext('2d'); g.clearRect(0, 0, cw, ch); g.lineWidth = 2; g.font = '12px sans-serif';
        (d.boxes || []).forEach(([lab, conf, x1, y1, x2, y2]) => {
          g.strokeStyle = lab === 'closed' ? '#ef4444' : '#10b981';
          g.strokeRect(x1 * cw / d.w, y1 * ch / d.h, (x2 - x1) * cw / d.w, (y2 - y1) * ch / d.h);
        });
      } catch (e) { badge('Erreur', 'red'); set('camInfo', e.message); }
      if (CAM.running) CAM.timer = setTimeout(loop, Math.max(60, 350 - (Date.now() - t0)));
    };
    loop();
  });
  $('#camStop').addEventListener('click', () => {
    stopCamera(); badge('Arrêtée', 'gray');
    $('#camStart').style.display = ''; $('#camStop').style.display = 'none';
    const ov = $('#camOv'); if (ov) ov.getContext('2d').clearRect(0, 0, ov.width, ov.height);
  });
}

// ─── CLIENT: Mon trajet ────────────────────────────────────────────────
async function pageClientTrip(view) {
  const u = AUTH.user;
  view.innerHTML = `
    <div class="card" style="margin-bottom:18px">
      <div class="card-head">
        <div class="ico-sm"><i class="fa-solid fa-map-location-dot"></i></div>
        Trajet en direct — ${esc(u.plate || u.vehicle_code)}
        <div class="right">
          <button class="btn sm on" id="btnClFollow"><i class="fa-solid fa-crosshairs"></i> Suivre</button>
          <button class="btn sm gray" id="btnClFit"><i class="fa-solid fa-route"></i> Vue globale</button>
          <button class="btn sm red" id="btnSimulateMyAlert"><i class="fa-solid fa-play"></i> Tester alerte</button>
        </div>
      </div>
      <div id="map" class="map tall"></div>
    </div>
  `;
  MAP.follow = true;
  initMap('map', u.vehicle_code);
  focusCar(u.vehicle_code);

  $('#btnClFollow').addEventListener('click', (e) => {
    MAP.follow = !MAP.follow;
    e.currentTarget.className = 'btn sm ' + (MAP.follow ? 'on' : 'gray');
    if (MAP.follow) focusCar(u.vehicle_code);
  });
  $('#btnClFit').addEventListener('click', () => { if (MAP.routeLayer) MAP.map.fitBounds(MAP.routeLayer.getBounds(), { padding: [30, 30] }); });
  $('#btnSimulateMyAlert').addEventListener('click', async () => {
    try { await api(`/api/simulate/asleep?vehicle=${encodeURIComponent(u.vehicle_code)}`, { method: 'POST' }); toast('Simulation d\'alerte envoyée'); }
    catch (err) { toast(err.message, 'error'); }
  });
}

// ─── CLIENT: Mes alarmes ───────────────────────────────────────────────
async function pageClientAlerts(view) {
  view.innerHTML = `<div class="card"><div class="empty"><i class="fa-solid fa-spinner spin"></i><p>Chargement de vos alarmes…</p></div></div>`;
  const alerts = await api('/api/client/alerts').catch(() => []);
  const badgeClass = { 'Annulé par moi':'green','Police appelée':'red','Police a répondu':'blue','Unité envoyée':'blue','Clôturé':'gray','En attente':'amber' };

  view.innerHTML = `
    <div class="toolbar">
      <h3 style="margin:0;display:flex;align-items:center;gap:8px"><div class="ico-sm red"><i class="fa-solid fa-bell"></i></div>Historique de mes alarmes</h3>
      <span class="grow"></span>
      <button class="btn sm gray" id="btnReloadAlerts"><i class="fa-solid fa-rotate-right"></i> Actualiser</button>
    </div>
    <div class="card table-wrap">
      ${alerts.length === 0 ? `
        <div class="empty">
          <i class="fa-solid fa-bell-slash"></i>
          <p>Aucune alarme enregistrée. Bonne conduite !</p>
        </div>` : `
      <table>
        <thead><tr><th>Date &amp; Heure</th><th>Incident</th><th>Statut</th><th>Yeux fermés</th><th>Photo</th></tr></thead>
        <tbody>
          ${alerts.map(a => `
            <tr>
              <td><b>${esc(fmtDate(a.ts))}</b></td>
              <td><span style="color:var(--red);font-weight:700"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(a.title || 'Somnolence')}</span></td>
              <td><span class="tag-pill ${badgeClass[a.status_label] || 'gray'}">${esc(a.status_label || 'En attente')}</span></td>
              <td><b>${a.eyes_closed_s ? `${a.eyes_closed_s.toFixed(1)} s` : '—'}</b></td>
              <td>${a.image_url ? `<button class="btn sm gray" data-img="${esc(a.image_url)}"><i class="fa-solid fa-image"></i> Voir</button>` : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`}
    </div>
  `;
  $('#btnReloadAlerts').addEventListener('click', () => pageClientAlerts(view));
  $$('[data-img]', view).forEach(b => b.addEventListener('click', () => {
    openModal(`<div class="modal-head"><i class="fa-solid fa-image" style="color:var(--brand)"></i> Capture lors de l'alerte</div>
      <div class="modal-body" style="text-align:center"><img src="${b.dataset.img}" style="max-width:100%;border-radius:12px" alt=""></div>
      <div class="modal-foot"><button class="btn gray" data-close>Fermer</button></div>`);
  }));
}

// ─── Suppression des détections (images) ───────────────────────────────
async function deleteDetections(base, opts) {
  // base: '/api/client/detections' ou '/api/detections' ; opts: {id} ou {scope}
  const url = opts.id ? `${base}/${opts.id}` : `${base}?scope=${encodeURIComponent(opts.scope || 'all')}`;
  return api(url, { method: 'DELETE' });
}
function confirmDelete(message, onYes) {
  openModal(`<div class="modal-head"><i class="fa-solid fa-trash" style="color:var(--red)"></i> Confirmer la suppression</div>
    <div class="modal-body"><p style="line-height:1.6">${message}</p></div>
    <div class="modal-foot"><button class="btn gray" data-close>Annuler</button>
    <button class="btn red" id="btnConfirmDel"><i class="fa-solid fa-trash"></i> Supprimer</button></div>`);
  $('#btnConfirmDel').addEventListener('click', async () => {
    const b = $('#btnConfirmDel'); b.disabled = true;
    try { await onYes(); closeModal(); } catch (e) { closeModal(); toast(e.message, 'error'); }
  });
}
function detDeleteBar(withDemo = true) {
  return `<button class="btn sm gray" data-del-scope="missing" title="Supprime les cartes dont l'image est introuvable"><i class="fa-solid fa-broom"></i> Nettoyer les cartes vides</button>
    ${withDemo ? `<button class="btn sm gray" data-del-scope="demo" title="Supprime les images de test (caricatures)"><i class="fa-solid fa-wand-magic-sparkles"></i> Supprimer les images de test</button>` : ''}
    <button class="btn sm red" data-del-scope="all"><i class="fa-solid fa-trash"></i> Tout supprimer</button>`;
}
function detTrashBtn(id) {
  return `<button class="det-del" data-del-id="${id}" title="Supprimer cette image" aria-label="Supprimer cette image"><i class="fa-solid fa-trash"></i></button>`;
}
function wireDetDelete(view, base, reload) {
  $$('[data-del-id]', view).forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    confirmDelete('Supprimer cette image ? Cette action est définitive.', async () => {
      await deleteDetections(base, { id: b.dataset.delId });
      toast('Image supprimée', 'success'); reload();
    });
  }));
  const labels = {
    all: 'Supprimer <b>toutes</b> les détections et leurs images ? Cette action est définitive.',
    missing: 'Supprimer les cartes dont l\'image est introuvable ?',
    demo: 'Supprimer les images de test (caricatures de démonstration) ?',
  };
  $$('[data-del-scope]', view).forEach(b => b.addEventListener('click', () => {
    const sc = b.dataset.delScope;
    confirmDelete(labels[sc], async () => {
      const r = await deleteDetections(base, { scope: sc });
      toast(`${r.deleted || 0} élément(s) supprimé(s)`, 'success'); reload();
    });
  }));
}

// ─── CLIENT: Mes détections ────────────────────────────────────────────
async function pageClientDetections(view) {
  view.innerHTML = `<div class="card"><div class="empty"><i class="fa-solid fa-spinner spin"></i><p>Chargement de vos détections…</p></div></div>`;
  const dets = await api('/api/client/detections').catch(() => []);
  view.innerHTML = `
    <div class="toolbar">
      <h3 style="margin:0;display:flex;align-items:center;gap:8px"><div class="ico-sm"><i class="fa-solid fa-eye"></i></div>Mes Détections Caméra (${dets.length})</h3>
      <span class="grow"></span>
      ${dets.length ? detDeleteBar() : ''}
      <button class="btn sm gray" id="btnReloadDets"><i class="fa-solid fa-rotate-right"></i> Actualiser</button>
    </div>
    <div class="grid det-grid">
      ${dets.length === 0 ? `
        <div class="card" style="grid-column:1/-1">
          <div class="empty"><i class="fa-solid fa-camera-slash"></i><p>Aucune capture webcam. Lancez detector_eyes.py pour envoyer des captures.</p></div>
        </div>` : dets.map(d => `
        <div class="card det" data-det-id="${d.id}">
          <div class="img-box">
            ${detTrashBtn(d.id)}
            ${d.image_url ? `<img src="${d.image_url}" alt="" loading="lazy">` : `<div class="no-img"><i class="fa-regular fa-image"></i></div>`}
            <span class="badge ${d.eyes_closed_s >= 4.5 ? 'red' : 'green'}">${d.eyes_closed_s ? `${d.eyes_closed_s.toFixed(1)}s fermés` : 'Alerte'}</span>
          </div>
          <div class="info">
            <b>${esc(fmtDate(d.ts))}</b>
            <div style="font-size:12px;color:var(--muted);margin-top:3px">GPS: ${d.lat ? `${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}` : '—'}</div>
          </div>
        </div>`).join('')}
    </div>
  `;
  $('#btnReloadDets').addEventListener('click', () => pageClientDetections(view));
  wireDetDelete(view, '/api/client/detections', () => pageClientDetections(view));
  $$('.det[data-det-id]', view).forEach(el => el.addEventListener('click', () => {
    const d = dets.find(x => x.id == el.dataset.detId);
    if (!d) return;
    openModal(`<div class="modal-head"><i class="fa-solid fa-eye" style="color:var(--brand)"></i> Détection du ${esc(fmtDate(d.ts))}</div>
      <div class="modal-body">
        ${d.image_url ? `<img src="${d.image_url}" class="big-img" alt="">` : '<div class="empty"><i class="fa-regular fa-image"></i><p>Aucune image</p></div>'}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px">
          <div><small style="color:var(--muted);display:block">Durée yeux fermés</small><b>${d.eyes_closed_s ? `${d.eyes_closed_s.toFixed(1)} s` : '—'}</b></div>
          <div><small style="color:var(--muted);display:block">Position GPS</small><b>${d.lat ? `${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}` : '—'}</b></div>
        </div>
      </div>
      <div class="modal-foot"><button class="btn gray" data-close>Fermer</button></div>`);
  }));
}

// ─── CLIENT: Mon profil ────────────────────────────────────────────────
async function pageClientProfile(view) {
  const u = await api('/api/client/profile').catch(() => AUTH.user);
  view.innerHTML = `
    <div class="card" style="max-width:760px;margin:0 auto">
      <div class="card-head"><div class="ico-sm"><i class="fa-solid fa-id-card"></i></div>Mon Profil Conducteur &amp; Véhicule</div>
      <div style="padding:20px">
        <form id="profileForm" onsubmit="return false;" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="field"><label>Nom complet</label><input id="pf_name" type="text" value="${esc(u.full_name || '')}" required></div>
          <div class="field"><label>CIN (fictif)</label><input id="pf_cin" type="text" value="${esc(u.cin || '')}" required></div>
          <div class="field"><label>Téléphone</label><input id="pf_phone" type="tel" value="${esc(u.phone || '')}"></div>
          <div class="field"><label>Email</label><input id="pf_email" type="email" value="${esc(u.email || '')}"></div>
          <div class="field"><label>Code Véhicule</label><input type="text" value="${esc(u.vehicle_code || '')}" disabled style="font-weight:800;font-family:monospace"></div>
          <div class="field"><label>Matricule</label><input id="pf_plate" type="text" value="${esc(u.plate || '')}"></div>
          <div class="field"><label>Marque</label><input id="pf_brand" type="text" value="${esc(u.brand || '')}"></div>
          <div class="field"><label>Modèle</label><input id="pf_model" type="text" value="${esc(u.model || '')}"></div>
          <div class="field"><label>Nom contact d'urgence</label><input id="pf_em_name" type="text" value="${esc(u.emergency_name || '')}"></div>
          <div class="field"><label>Tél contact d'urgence</label><input id="pf_em_phone" type="tel" value="${esc(u.emergency_phone || '')}"></div>
          <div style="grid-column:1/-1;display:flex;justify-content:flex-end;margin-top:6px">
            <button class="btn" id="btnSaveProfile"><i class="fa-solid fa-floppy-disk"></i> Enregistrer</button>
          </div>
        </form>
      </div>
    </div>
  `;
  $('#btnSaveProfile').addEventListener('click', async () => {
    const data = { full_name:$('#pf_name').value.trim(), cin:$('#pf_cin').value.trim(), phone:$('#pf_phone').value.trim(), email:$('#pf_email').value.trim(), plate:$('#pf_plate').value.trim(), brand:$('#pf_brand').value.trim(), model:$('#pf_model').value.trim(), emergency_name:$('#pf_em_name').value.trim(), emergency_phone:$('#pf_em_phone').value.trim() };
    try { const up = await api('/api/client/profile', { method: 'PUT', body: data }); AUTH.user = up; updateHeaderAndSidebar(); toast('Profil mis à jour', 'success'); }
    catch (err) { toast(err.message, 'error'); }
  });
}

// ══════════════════════════════════════════════════════════════════════
// PAGES SUPERVISEUR
// ══════════════════════════════════════════════════════════════════════
function statCard(id, icon, title, big, extra, cls = '') {
  return `<div class="card stat"><div class="ico ${cls}"><i class="fa-solid ${icon}"></i></div><div><small>${esc(title)}</small><b id="${id}">${big}</b>${extra||''}</div></div>`;
}

function updateDashboardLive() {
  if (PAGE !== 'dashboard' || !S.stats) return;
  const c = { total: S.vehicles.length, on: S.vehicles.filter(v => isOnline(v.code)).length };
  const st = S.stats;
  const set = (id, html) => { const e = $('#' + id); if (e) e.innerHTML = html; };
  set('stAlerts', String(st.total_alerts));
  set('stAlertsToday', `<div style="margin-top:4px"><span class="tag gray">${st.alerts_today} aujourd'hui</span></div>`);
  set('stCars', String(c.total));
  set('stCarsTag', `<div style="margin-top:4px"><span class="tag green">${c.on} en ligne</span></div>`);
  set('stDrivers', String(st.drivers_total || st.clients_total || S.vehicles.length));
  const la = st.last_alert;
  set('stLast', la ? esc(fmtTime(la.ts)) : '—');
  set('stLastTag', la ? `<div style="margin-top:4px"><span class="tag gray">${esc(la.plate || la.vehicle_code)}</span></div>` : '');
  renderDriverList();
}

function renderDriverList() {
  const box = $('#driverList'); if (!box) return;
  const rows = S.vehicles.map(v => {
    const st = S.states[v.code];
    const cls = st?.state === 'Asleep' ? 'alert' : isOnline(v.code) ? 'on' : '';
    return `<div class="list-row" data-code="${esc(v.code)}">
      <div class="avatar">${esc(initial(v.driver_name))}</div>
      <div><b>${esc(v.driver_name || '—')}</b><small><span class="plate">${esc(v.plate)}</span> · ${esc(st ? (t(st.state) || st.state) : '—')}</small></div>
      <span class="status-dot ${cls}"></span></div>`;
  }).join('');
  box.innerHTML = rows || `<div class="empty"><i class="fa-solid fa-car"></i><p>Aucun client enregistré</p></div>`;
  $$('.list-row', box).forEach(r => r.addEventListener('click', () => { MAP.focus = r.dataset.code; location.hash = '#map'; }));
  const cnt = $('#driverCount'); if (cnt) cnt.textContent = S.vehicles.length;
}

let CHART = null;
function pageDashboard(view) {
  const st = S.stats || { total_alerts: 0, alerts_today: 0, drivers_total: 0, last_alert: null, by_day: [] };
  view.innerHTML = `
    <div class="grid stats">
      ${statCard('stAlerts', 'fa-bell', 'Total des alertes', st.total_alerts, '<div id="stAlertsToday"></div>', 'red')}
      ${statCard('stCars', 'fa-car', 'Véhicules', S.vehicles.length, '<div id="stCarsTag"></div>')}
      ${statCard('stDrivers', 'fa-users', 'Clients enregistrés', st.drivers_total || S.vehicles.length, '', 'blue')}
      ${statCard('stLast', 'fa-clock', 'Dernière alerte', '—', '<div id="stLastTag"></div>', 'amber')}
    </div>
    <div class="grid two">
      <div class="card">
        <div class="card-head"><div class="ico-sm"><i class="fa-solid fa-map-location-dot"></i></div>Surveillance cartographique
          <div class="right"><a class="btn sm gray" href="#map"><i class="fa-solid fa-expand"></i> Plein écran</a></div>
        </div>
        <div id="map" class="map"></div>
      </div>
      <div class="card">
        <div class="card-head"><div class="ico-sm"><i class="fa-solid fa-users"></i></div>Flotte en circulation<span class="count" id="driverCount">0</span></div>
        <div id="driverList"></div>
      </div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="card-head"><div class="ico-sm"><i class="fa-solid fa-chart-column"></i></div>Alertes des 7 derniers jours</div>
      <div class="chart-box"><canvas id="chart"></canvas></div>
    </div>
  `;
  initMap('map');
  updateDashboardLive();
  if (CHART) { CHART.destroy(); CHART = null; }
  const dark = document.documentElement.dataset.theme === 'dark';
  CHART = new Chart($('#chart'), {
    type: 'bar',
    data: {
      labels: (st.by_day || []).map(d => d.day),
      datasets: [{ data: (st.by_day || []).map(d => d.count), backgroundColor: 'rgba(16,185,129,.8)', borderRadius: 8, borderSkipped: false }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.y} alerte(s)` } } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0, color: dark ? '#7a9ab8' : '#64748b' }, grid: { color: dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)' } }, x: { ticks: { color: dark ? '#7a9ab8' : '#64748b' }, grid: { display: false } } }
    }
  });
}

function pageMap(view) {
  view.innerHTML = `<div class="card">
    <div class="card-head"><div class="ico-sm"><i class="fa-solid fa-map-location-dot"></i></div>Carte globale de surveillance
      <div class="right">
        <button class="btn sm ${MAP.follow ? 'on' : 'gray'}" id="btnFollow"><i class="fa-solid fa-crosshairs"></i> ${esc(t('follow'))}</button>
        <button class="btn sm gray" id="btnFit"><i class="fa-solid fa-route"></i> ${esc(t('fitRoute'))}</button>
      </div>
    </div>
    <div id="map" class="map tall"></div>
    <div class="legend" id="legend"></div>
  </div>`;
  initMap('map');
  const lg = $('#legend');
  lg.innerHTML = S.vehicles.map(v => `<span class="chip ${MAP.focus === v.code ? 'sel' : ''} ${MAP.hidden.has(v.code) ? 'off' : ''}" data-code="${esc(v.code)}">
    <i style="background:${colorOf(v.code)}"></i><span>${esc(v.plate)}</span><span class="tag-pill ${isOnline(v.code) ? 'green' : 'gray'}" style="padding:1px 6px;font-size:10px">${isOnline(v.code) ? 'ON' : 'OFF'}</span>
  </span>`).join('');
  $$('.chip', lg).forEach(c => c.addEventListener('click', () => focusCar(c.dataset.code)));
  $('#btnFollow').addEventListener('click', (e) => { MAP.follow = !MAP.follow; e.currentTarget.className = 'btn sm ' + (MAP.follow ? 'on' : 'gray'); if (MAP.follow) focusCar(MAP.focus || Object.keys(S.states)[0]); });
  $('#btnFit').addEventListener('click', () => { if (MAP.routeLayer) MAP.map.fitBounds(MAP.routeLayer.getBounds(), { padding: [30, 30] }); });
}

async function pageClients(view) {
  view.innerHTML = `<div class="card"><div class="empty"><i class="fa-solid fa-spinner spin"></i><p>Chargement des clients…</p></div></div>`;
  const drivers = await api('/api/drivers').catch(() => []);
  view.innerHTML = `
    <div class="toolbar">
      <h3 style="margin:0;display:flex;align-items:center;gap:8px"><div class="ico-sm blue"><i class="fa-solid fa-users"></i></div>Répertoire des Clients (${drivers.length})</h3>
      <span class="grow"></span>
      <input type="text" id="searchClients" placeholder="Rechercher…" style="width:200px">
      <a class="btn blue" href="/api/export/vehicles.xlsx"><i class="fa-solid fa-file-excel"></i> Exporter</a>
    </div>
    <div class="card table-wrap">
      <table id="clientsTable">
        <thead><tr><th>Client / Conducteur</th><th>CIN</th><th>Téléphone</th><th>Véhicule</th><th>Statut</th><th>Contact urgence</th><th>Actions</th></tr></thead>
        <tbody>
          ${drivers.length === 0 ? `<tr><td colspan="7"><div class="empty"><i class="fa-solid fa-users-slash"></i><p>Aucun client enregistré</p></div></td></tr>` :
          drivers.map(d => {
            const on = isOnline(d.vehicle_code);
            return `<tr data-name="${esc((d.full_name+d.email+d.plate+d.cin).toLowerCase())}">
              <td><b>${esc(d.full_name)}</b><br><small style="color:var(--muted)">${esc(d.email || d.username || '—')}</small></td>
              <td><span class="plate">${esc(d.cin || d.license_no || '—')}</span></td>
              <td>${esc(d.phone || '—')}</td>
              <td><b>${esc(d.plate || '—')}</b> <small style="color:var(--muted)">(${esc(d.vehicle_code || '—')})</small></td>
              <td><span class="tag-pill ${on ? 'green' : 'gray'}">${on ? 'EN LIGNE' : 'HORS LIGNE'}</span></td>
              <td>${esc(d.emergency_name || '—')}<br><small style="color:var(--muted)">${esc(d.emergency_phone || '')}</small></td>
              <td><button class="btn sm blue" data-view-client="${d.id}"><i class="fa-solid fa-eye"></i> Fiche</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
  $('#searchClients').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    $$('#clientsTable tbody tr').forEach(tr => {
      tr.style.display = (tr.dataset.name || '').includes(q) ? '' : 'none';
    });
  });
  $$('[data-view-client]', view).forEach(b => b.addEventListener('click', () => {
    const d = drivers.find(x => x.id == b.dataset.viewClient); if (!d) return;
    openModal(`
      <div class="modal-head"><div class="avatar" style="display:inline-grid;margin-right:10px">${esc(initial(d.full_name))}</div>Fiche : ${esc(d.full_name)}</div>
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 20px">
          <div><small style="color:var(--muted)">Nom complet</small><div><b>${esc(d.full_name)}</b></div></div>
          <div><small style="color:var(--muted)">CIN fictif</small><div><b>${esc(d.cin || d.license_no || '—')}</b></div></div>
          <div><small style="color:var(--muted)">Téléphone</small><div><b>${esc(d.phone || '—')}</b></div></div>
          <div><small style="color:var(--muted)">Email</small><div><b>${esc(d.email || '—')}</b></div></div>
          <div><small style="color:var(--muted)">Véhicule</small><div><b>${esc(d.plate || '—')} (${esc(d.vehicle_code || '—')})</b></div></div>
          <div><small style="color:var(--muted)">Modèle</small><div>${esc(d.brand || '')} ${esc(d.model || '')}</div></div>
          <div><small style="color:var(--muted)">Contact d'urgence</small><div><b>${esc(d.emergency_name || '—')}</b></div></div>
          <div><small style="color:var(--muted)">Tél d'urgence</small><div><b>${esc(d.emergency_phone || '—')}</b></div></div>
        </div>
        <div style="text-align:center;margin-top:16px">
          <button class="btn sm gray" id="btnFocusClientCar" data-code="${esc(d.vehicle_code)}"><i class="fa-solid fa-map-location-dot"></i> Localiser sur la carte</button>
        </div>
      </div>
      <div class="modal-foot"><button class="btn gray" data-close>Fermer</button></div>`);
    $('#btnFocusClientCar')?.addEventListener('click', (e) => { closeModal(); focusCar(e.currentTarget.dataset.code); location.hash = '#map'; });
  }));
}

async function pageVehicles(view) {
  await reloadVehicles().catch(() => {});
  view.innerHTML = `
    <div class="toolbar">
      <h3 style="margin:0;display:flex;align-items:center;gap:8px"><div class="ico-sm"><i class="fa-solid fa-car"></i></div>Gestion de la flotte (${S.vehicles.length})</h3>
      <span class="grow"></span>
      <a class="btn blue" href="/api/export/vehicles.xlsx"><i class="fa-solid fa-file-excel"></i> Exporter</a>
    </div>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>Matricule</th><th>Code</th><th>Marque / Modèle</th><th>Conducteur</th><th>Statut</th><th>Alertes</th></tr></thead>
        <tbody>
          ${S.vehicles.map(v => `
            <tr>
              <td><span class="plate">${esc(v.plate)}</span></td>
              <td><b style="font-family:monospace">${esc(v.code)}</b></td>
              <td>${esc(v.brand || '—')} ${esc(v.model || '')}</td>
              <td>${esc(v.driver_name || '—')}</td>
              <td><span class="tag-pill ${isOnline(v.code) ? 'green' : 'gray'}">${isOnline(v.code) ? 'EN LIGNE' : 'HORS LIGNE'}</span></td>
              <td><b>${v.alerts_count || 0}</b></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function pageHistory(view) {
  view.innerHTML = `<div class="card"><div class="empty"><i class="fa-solid fa-spinner spin"></i><p>Chargement…</p></div></div>`;
  const dets = await api('/api/detections').catch(() => []);
  view.innerHTML = `
    <div class="toolbar">
      <h3 style="margin:0;display:flex;align-items:center;gap:8px"><div class="ico-sm"><i class="fa-solid fa-eye"></i></div>Captures et Détections (${dets.length})</h3>
      <span class="grow"></span>
      ${dets.length ? detDeleteBar() : ''}
      <a class="btn blue" href="/api/export/detections.xlsx"><i class="fa-solid fa-file-excel"></i> Exporter</a>
    </div>
    <div class="grid det-grid">
      ${dets.length === 0 ? `<div class="card" style="grid-column:1/-1"><div class="empty"><i class="fa-solid fa-camera-slash"></i><p>Aucune détection enregistrée</p></div></div>` :
      dets.map(d => `
        <div class="card det">
          <div class="img-box">
            ${detTrashBtn(d.id)}
            ${d.image_url ? `<img src="${d.image_url}" alt="" loading="lazy">` : `<div class="no-img"><i class="fa-regular fa-image"></i></div>`}
            <span class="badge ${d.eyes_closed_s >= 4.5 ? 'red' : 'green'}">${d.eyes_closed_s ? `${d.eyes_closed_s.toFixed(1)}s` : 'Alerte'}</span>
          </div>
          <div class="info">
            <b>${esc(d.plate || d.vehicle_code)}</b> · <small>${esc(d.driver_name || '—')}</small>
            <div style="font-size:12px;color:var(--muted);margin-top:3px">${esc(fmtDate(d.ts))}</div>
          </div>
        </div>`).join('')}
    </div>
  `;
  wireDetDelete(view, '/api/detections', () => pageHistory(view));
}

async function pageAlerts(view) {
  view.innerHTML = `<div class="card"><div class="empty"><i class="fa-solid fa-spinner spin"></i><p>Chargement…</p></div></div>`;
  const alerts = await api('/api/alerts').catch(() => []);
  const badgeClass = { 'Annulé par moi':'green','Police appelée':'red','Police a répondu':'blue','Unité envoyée':'blue','Clôturé':'gray','En attente':'amber' };
  view.innerHTML = `
    <div class="toolbar">
      <h3 style="margin:0;display:flex;align-items:center;gap:8px"><div class="ico-sm red"><i class="fa-solid fa-bell"></i></div>Alertes &amp; Appels Urgence (${alerts.length})</h3>
      <span class="grow"></span>
      <button class="btn sm gray" id="btnReloadSupAlerts"><i class="fa-solid fa-rotate-right"></i> Actualiser</button>
    </div>
    <div class="card table-wrap">
      ${alerts.length === 0 ? `<div class="empty"><i class="fa-solid fa-bell-slash"></i><p>Aucune alerte en cours</p></div>` : `
      <table>
        <thead><tr><th>Date</th><th>Voiture</th><th>Conducteur &amp; CIN</th><th>Statut</th><th>Actions Police</th></tr></thead>
        <tbody>
          ${alerts.map(a => `
            <tr>
              <td><b>${esc(fmtDate(a.ts))}</b></td>
              <td><span class="plate">${esc(a.plate || a.vehicle_code)}</span></td>
              <td><b>${esc(a.driver_name || '—')}</b><br><small style="color:var(--muted)">CIN: ${esc(a.driver_cin || '—')} · ${esc(a.driver_phone || '—')}</small></td>
              <td><span class="tag-pill ${badgeClass[a.status_label] || 'gray'}">${esc(a.status_label || 'En attente')}</span></td>
              <td>
                <div style="display:flex;gap:6px">
                  <button class="btn sm green" data-action="respond" data-id="${a.id}"><i class="fa-solid fa-phone"></i> Répondre</button>
                  <button class="btn sm blue" data-action="dispatch" data-id="${a.id}"><i class="fa-solid fa-truck-medical"></i> Unité</button>
                  <button class="btn sm gray" data-action="close" data-id="${a.id}"><i class="fa-solid fa-check"></i> Clôturer</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`}
    </div>
  `;
  $('#btnReloadSupAlerts').addEventListener('click', () => pageAlerts(view));
  $$('[data-action]', view).forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api(`/api/alerts/${btn.dataset.id}/action`, { method: 'POST', body: { action: btn.dataset.action } });
      toast('Statut mis à jour', 'success'); pageAlerts(view);
    } catch (err) { toast(err.message, 'error'); }
  }));
}

async function pageSettings(view) {
  const s = await api('/api/settings').catch(() => S.settings);
  view.innerHTML = `
    <div class="card" style="max-width:680px;margin:0 auto">
      <div class="card-head"><div class="ico-sm"><i class="fa-solid fa-gear"></i></div>Paramètres Généraux du Système</div>
      <form id="settingsForm" onsubmit="return false;">
        <div class="setting-row">
          <div><b>Délai avant alerte Somnolence</b><br><small style="color:var(--muted)">Durée (s) avant que la fermeture des yeux déclenche l'alerte</small></div>
          <input id="set_eyes" type="number" step="0.5" min="1" max="60" value="${esc(s.eyes_closed_s || 5)}" style="width:100px;text-align:center">
        </div>
        <div class="setting-row">
          <div><b>Délai avant appel de police automatique</b><br><small style="color:var(--muted)">Compte à rebours (s) affiché au conducteur</small></div>
          <input id="set_ack" type="number" step="1" min="3" max="60" value="${esc(s.ack_timeout_s || 10)}" style="width:100px;text-align:center">
        </div>
        <div class="setting-row">
          <div><b>Numéro d'urgence (SIMULÉ)</b><br><small style="color:var(--muted)">Affiché lors de l'appel simulé</small></div>
          <input id="set_num" type="text" value="${esc(s.emergency_number || '+216 00 000 000')}" style="width:200px">
        </div>
        <div class="setting-row" style="border-bottom:0;justify-content:flex-end">
          <button class="btn" id="btnSaveSettings"><i class="fa-solid fa-floppy-disk"></i> Enregistrer</button>
        </div>
      </form>
    </div>
  `;
  $('#btnSaveSettings').addEventListener('click', async () => {
    try {
      await api('/api/settings', { method: 'PUT', body: { eyes_closed_s: parseFloat($('#set_eyes').value), ack_timeout_s: parseFloat($('#set_ack').value), emergency_number: $('#set_num').value.trim() } });
      toast('Réglages enregistrés', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ══════════════════════════════════════════════════════════════════════
// DISPATCH POLICE (appel entrant enrichi)
// ══════════════════════════════════════════════════════════════════════
let CURRENT_DISPATCH = null;

async function reverseGeocode(lat, lon) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`, { headers: { 'Accept-Language': 'fr' } });
    const data = await r.json();
    return data.display_name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }
}

function showPoliceDispatch(a) {
  CURRENT_DISPATCH = a;
  const overlay = $('#policeDispatchOverlay');
  if (!overlay) return;
  overlay.dataset.alertId = a.alert_id || a.id || '';
  overlay.dataset.detectionId = a.detection_id || '';

  $('#dispatchDriverName').textContent = a.driver || a.driver_name || 'Conducteur inconnu';
  $('#dispatchPlate').textContent = a.plate || a.vehicle_id || '—';
  $('#dispatchCode').textContent = a.vehicle_id || a.vehicle_code || '—';
  $('#dispatchCin').textContent = a.cin || a.driver_cin || '—';
  $('#dispatchPhone').textContent = a.phone || a.driver_phone || '—';
  $('#dispatchEmergency').textContent = `${a.emergency_name || 'Famille'} (${a.emergency_phone || '—'})`;
  $('#dispatchSpeed').textContent = `${Math.round(a.speed || 45)} km/h`;
  const gpsText = (a.lat && a.lon) ? `${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}` : 'En cours…';
  $('#dispatchGps').textContent = gpsText;
  $('#dispatchEyes').textContent = a.eyes_closed_s ? `${a.eyes_closed_s.toFixed(1)} s` : '5.0 s (Critique)';

  const img = $('#dispatchImg');
  if (a.image_url) { img.src = a.image_url; img.style.display = 'block'; }
  else img.style.display = 'none';

  overlay.classList.add('show');

  // Géocodage inverse
  if (a.lat && a.lon) {
    const addrEl = $('#dispatchAddr');
    reverseGeocode(a.lat, a.lon).then(addr => { if (addrEl) addrEl.textContent = addr; });
  }

  // Rapport vocal (speechSynthesis)
  const msg = `Alerte urgence. Conducteur : ${a.driver_name || 'inconnu'}. Matricule : ${a.plate || a.vehicle_id || 'inconnu'}. Position G.P.S. : ${gpsText}. Vitesse : ${Math.round(a.speed || 45)} kilomètres heure. Yeux fermés : ${a.eyes_closed_s ? a.eyes_closed_s.toFixed(1) : 5} secondes. Intervention requise.`;
  speakDispatch(msg);
}

function speakDispatch(msg) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(msg);
  utt.lang = 'fr-FR'; utt.rate = 0.95; utt.pitch = 1;
  const speechWrap = $('#dispatchSpeechWrap'), transcript = $('#dispatchTranscript'), relisten = $('#btnDispatchRelisten');
  if (speechWrap) speechWrap.style.display = 'block';
  if (transcript) transcript.textContent = msg;
  utt.onend = () => {
    if (speechWrap) speechWrap.style.display = 'none';
    if (relisten) relisten.style.display = 'inline-flex';
  };
  speechSynthesis.speak(utt);
}

function closePoliceDispatch() {
  const overlay = $('#policeDispatchOverlay');
  if (overlay) overlay.classList.remove('show');
  speechSynthesis.cancel?.();
  CURRENT_DISPATCH = null;
}

function setupPoliceDispatchControls() {
  $('#btnDispatchClose').addEventListener('click', closePoliceDispatch);
  $('#btnDispatchRelisten').addEventListener('click', () => { if (CURRENT_DISPATCH) speakDispatch(`Alerte conducteur ${CURRENT_DISPATCH.driver_name}. Position : ${CURRENT_DISPATCH.lat?.toFixed(4)||'—'}, ${CURRENT_DISPATCH.lon?.toFixed(4)||'—'}.`); });

  $('#btnDispatchRespond').addEventListener('click', async () => {
    const aid = $('#policeDispatchOverlay').dataset.alertId;
    if (aid) await api(`/api/alerts/${aid}/action`, { method: 'POST', body: { action: 'respond' } }).catch(() => {});
    closePoliceDispatch();
    toast('📞 Vous avez répondu à l\'appel. Conducteur informé.', 'success');
  });
  $('#btnDispatchSendUnit').addEventListener('click', async () => {
    const aid = $('#policeDispatchOverlay').dataset.alertId;
    if (aid) await api(`/api/alerts/${aid}/action`, { method: 'POST', body: { action: 'dispatch' } }).catch(() => {});
    closePoliceDispatch();
    toast('🚔 Unité dépêchée sur les coordonnées GPS.', 'success');
  });
  $('#btnDispatchCloseAlert').addEventListener('click', async () => {
    const aid = $('#policeDispatchOverlay').dataset.alertId;
    if (aid) await api(`/api/alerts/${aid}/action`, { method: 'POST', body: { action: 'close' } }).catch(() => {});
    closePoliceDispatch();
    toast('Incident clôturé.', 'success');
  });
}

// ══════════════════════════════════════════════════════════════════════
// ALERTE CONDUCTEUR & APPEL SIMULÉ
// ══════════════════════════════════════════════════════════════════════
const AL = { active: false, alert: null, timer: null, left: 10 };

function showClientAlert(a) {
  AL.active = true; AL.alert = a;
  AL.left = Math.round(a.ack_timeout_s || 10);

  $('#alTitle').textContent = 'CONDUCTEUR ENDORMI';
  $('#alSub').textContent = `Yeux fermés : ${a.eyes_closed_s ? a.eyes_closed_s.toFixed(1) : 5} secondes détectées`;
  $('#alPlate').textContent = a.plate || a.vehicle_id || '—';
  $('#alDriver').textContent = a.driver || 'Moi';
  $('#alTime').textContent = fmtTime(a.ts);
  $('#alPos').textContent = a.lat ? `${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}` : '';

  const img = $('#alImg');
  if (a.image_url) { img.src = a.image_url; img.style.display = 'block'; }
  else img.style.display = 'none';

  $('#alertOverlay').classList.add('show');
  startSiren();
  clearInterval(AL.timer);
  updateCountdown();
  AL.timer = setInterval(() => {
    AL.left -= 1;
    updateCountdown();
    if (AL.left <= 0) { clearInterval(AL.timer); closeClientAlert(); startSimulatedCall(a); }
  }, 1000);
}

function updateCountdown() {
  const num = $('#alCountNum'), cnt = $('#alCount');
  if (num) num.textContent = Math.max(0, AL.left);
  if (cnt) cnt.textContent = `Appel de la police (simulé) dans ${Math.max(0, AL.left)} s…`;
  // Conic gradient progress
  const pct = (AL.left / 10) * 100;
  const cd = $('#alCountdown');
  if (cd) cd.style.setProperty('--pct', `${pct}%`);
  // Rebuild conic
  if (cd) {
    const color = AL.left > 5 ? '#ef4444' : AL.left > 2 ? '#f59e0b' : '#dc2626';
    cd.style.background = `conic-gradient(${color} ${pct}%, rgba(255,255,255,.15) 0%)`;
  }
}

function closeClientAlert() {
  AL.active = false;
  clearInterval(AL.timer);
  $('#alertOverlay').classList.remove('show');
  stopSiren();
}

function startSimulatedCall(a) {
  const callOverlay = $('#callOverlay');
  callOverlay.classList.add('show');
  const wave = $('#callWave'); if (wave) wave.style.display = 'flex';
  $('#callSay').textContent = `Conducteur : ${a.driver_name || 'inconnu'}. Voiture : ${a.plate || a.vehicle_id}. Position GPS : ${a.lat ? a.lat.toFixed(4) : '?'}, ${a.lon ? a.lon.toFixed(4) : '?'}.`;

  // Speech
  if (window.speechSynthesis) {
    speechSynthesis.cancel();
    const msg = `Appel d'urgence. Conducteur ${a.driver_name || 'inconnu'}. Matricule ${a.plate || 'inconnu'}. Votre dossier est transmis aux secours.`;
    const utt = new SpeechSynthesisUtterance(msg); utt.lang = 'fr-FR'; utt.rate = 0.9;
    utt.onend = () => { if (wave) wave.style.display = 'none'; };
    speechSynthesis.speak(utt);
  }

  let s = 0;
  const timerEl = $('#callTimer');
  const callTimer = setInterval(() => {
    s += 1;
    timerEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);

  $('#callEnd').onclick = () => {
    clearInterval(callTimer);
    callOverlay.classList.remove('show');
    speechSynthesis.cancel?.();
    toast('Appel terminé');
  };
}

// ─── Audio / Sirène ───────────────────────────────────────────────────
// La sirène se débloque toute seule au premier toucher de l'écran (connexion, clic...).
// Fichier audio /static/audio/siren.wav + secours par oscillateur + vibration du téléphone.
let AUDIO_CTX = null, SIREN_OSC = null, SIREN_INTERVAL = null, SIREN_EL = null, SIREN_VIB = null;

function ensureAudio() {
  try {
    if (!AUDIO_CTX) AUDIO_CTX = new (window.AudioContext || window.webkitAudioContext)();
    if (AUDIO_CTX.state === 'suspended') AUDIO_CTX.resume();
  } catch {}
  S.soundOn = true;
  const bar = $('#soundBar'); if (bar) bar.style.display = 'none';
}

function unlockAudio() { ensureAudio(); primeSirenEl(); toast('Son activé', 'success'); }

function primeSirenEl() {
  if (SIREN_EL) return;
  try {
    SIREN_EL = new Audio('/static/audio/siren.wav');
    SIREN_EL.loop = true; SIREN_EL.preload = 'auto'; SIREN_EL.volume = 0;
    const p = SIREN_EL.play();
    const restore = () => { try { SIREN_EL.volume = 1; } catch {} };
    if (p && p.then) p.then(() => { SIREN_EL.pause(); SIREN_EL.currentTime = 0; restore(); }).catch(restore);
    else restore();
  } catch { SIREN_EL = null; }
}

['pointerdown', 'touchstart', 'keydown', 'click'].forEach(ev =>
  window.addEventListener(ev, () => { if (!S.soundOn) { ensureAudio(); primeSirenEl(); } }, { passive: true, capture: true }));

function startBeepSiren() {
  if (!AUDIO_CTX) return;
  let up = true;
  const play = () => {
    if (!AUDIO_CTX) return;
    const osc = AUDIO_CTX.createOscillator();
    const gain = AUDIO_CTX.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(up ? 600 : 900, AUDIO_CTX.currentTime);
    osc.frequency.linearRampToValueAtTime(up ? 900 : 600, AUDIO_CTX.currentTime + 0.35);
    gain.gain.setValueAtTime(0.5, AUDIO_CTX.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, AUDIO_CTX.currentTime + 0.4);
    osc.connect(gain); gain.connect(AUDIO_CTX.destination);
    osc.start(); osc.stop(AUDIO_CTX.currentTime + 0.4);
    SIREN_OSC = osc; up = !up;
  };
  play();
  SIREN_INTERVAL = setInterval(play, 420);
}

function startSiren() {
  stopSiren();
  try { ensureAudio(); } catch {}
  // Vibration (téléphone): motif répété tant que l'alerte est affichée
  const vib = () => { try { navigator.vibrate && navigator.vibrate([500, 150, 500, 150, 500]); } catch {} };
  vib(); SIREN_VIB = setInterval(vib, 2500);
  // Sirène: fichier audio d'abord, oscillateur en secours
  try {
    if (!SIREN_EL) { SIREN_EL = new Audio('/static/audio/siren.wav'); SIREN_EL.loop = true; }
    SIREN_EL.volume = 1; SIREN_EL.currentTime = 0;
    const p = SIREN_EL.play();
    if (p && p.catch) p.catch(() => startBeepSiren());
  } catch { startBeepSiren(); }
}

function stopSiren() {
  clearInterval(SIREN_INTERVAL); SIREN_INTERVAL = null;
  clearInterval(SIREN_VIB); SIREN_VIB = null;
  try { navigator.vibrate && navigator.vibrate(0); } catch {}
  if (SIREN_OSC) { try { SIREN_OSC.stop(); } catch {} SIREN_OSC = null; }
  if (SIREN_EL) { try { SIREN_EL.pause(); SIREN_EL.currentTime = 0; } catch {} }
}

// ─── WEBSOCKET ────────────────────────────────────────────────────────
let WS = null;
let WS_TIMER = null;
function connectWS() {
  if (!AUTH.token) return;
  clearTimeout(WS_TIMER);
  if (WS) { try { WS.onopen = WS.onclose = WS.onerror = WS.onmessage = null; WS.close(); } catch {} }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(AUTH.token)}`);
  WS = ws;
  ws.onopen = () => { S.wsOk = true; setConnStatus(true); };
  ws.onclose = () => {
    if (WS !== ws) return; // ancienne connexion fermée volontairement: on ne reconnecte pas
    S.wsOk = false; setConnStatus(false);
    if (AUTH.token) WS_TIMER = setTimeout(connectWS, 3000);
  };
  ws.onerror = () => {
    S.wsOk = false;
    // Si on est sur Netlify ou hébergement statique sans WebSocket serveur, activer la démo animée
    startDemoSimulation();
  };
  ws.onmessage = (e) => { try { handleWsMessage(JSON.parse(e.data)); } catch {} };
}

let DEMO_SIM_INTERVAL = null;
function startDemoSimulation() {
  if (DEMO_SIM_INTERVAL) return;
  setConnStatus(true);
  let step = 0;
  DEMO_SIM_INTERVAL = setInterval(() => {
    if (!AUTH.token) return;
    step = (step + 1) % 60;
    const lat = 35.8256 + Math.sin(step / 5) * 0.006;
    const lon = 10.5908 + Math.cos(step / 5) * 0.008;
    handleWsMessage({
      type: 'state',
      vehicle_id: 'TUN-101',
      speed: 72 + Math.floor(Math.sin(step) * 6),
      lat: lat,
      lon: lon,
      angle: (step * 18) % 360,
      ear: 0.32,
      state: 'EyesOpen',
      closed_s: 0.0,
      vigilance_score: 96
    });
  }, 2000);
}

function setConnStatus(ok) {
  const el = $('#conn'); if (!el) return;
  el.className = `conn ${ok ? 'ok' : 'err'}`;
  el.textContent = ok ? 'Connecté' : 'Déconnecté';
}

function handleWsMessage(m) {
  const isClient = AUTH.user?.role === 'client';
  const myCode = AUTH.user?.vehicle_code;

  switch (m.type) {
    case 'snapshot':
      (m.states || []).forEach(s => { S.states[s.vehicle_id] = s; });
      S.online = m.online || {};
      if (MAP.map) {
        if (isClient && myCode && S.states[myCode]) updateCar(S.states[myCode], true);
        else for (const c in S.states) updateCar(S.states[c], true);
      }
      updateClientLiveBanner(); updateDashboardLive(); updateClientDash();
      break;
    case 'state':
      S.states[m.vehicle_id] = m; S.online[m.vehicle_id] = true;
      if (MAP.map) updateCar(m, false);
      updateClientLiveBanner(); updateDashboardLive(); updateClientDash();
      break;
    case 'status':
      S.online[m.vehicle_id] = m.online;
      updateClientLiveBanner(); updateDashboardLive(); updateClientDash();
      break;
    case 'alert':
      // Police: silence tant que le conducteur n'a pas dépassé le délai (10 s). L'appel arrive par 'escalation'.
      if (!isClient && m.level >= 4) {
        if (PAGE === 'alerts' && $('#view')) pageAlerts($('#view'));
        break;
      }
      S.unread += 1;
      $('#bellDot').style.display = 'block';
      if (m.level >= 4) {
        if (isClient && (m.vehicle_id === myCode || m.vehicle_code === myCode)) showClientAlert(m);
        else if (!isClient) showPoliceDispatch(m);
      } else { toast(`${m.plate || m.vehicle_id}: ${m.title}`); }
      if (PAGE === 'client_alerts' && $('#view')) pageClientAlerts($('#view'));
      if (PAGE === 'alerts' && $('#view')) pageAlerts($('#view'));
      break;
    case 'detection_update':
      if (AL.active && AL.alert?.detection_id === m.detection_id) {
        const img = $('#alImg'); if (img && m.image_url) { img.src = m.image_url; img.style.display = 'block'; }
      }
      if ($('#policeDispatchOverlay').classList.contains('show')) {
        const img = $('#dispatchImg'); if (img && m.image_url) { img.src = m.image_url; img.style.display = 'block'; }
      }
      if (PAGE === 'client_detections' && $('#view')) pageClientDetections($('#view'));
      if (PAGE === 'history' && $('#view')) pageHistory($('#view'));
      break;
    case 'detections_deleted':
      if (PAGE === 'client_detections' && $('#view')) pageClientDetections($('#view'));
      if (PAGE === 'history' && $('#view')) pageHistory($('#view'));
      break;
    case 'escalation':
      if (isClient && (m.vehicle_id === myCode || m.vehicle_code === myCode)) {
        if (AL.active) { closeClientAlert(); startSimulatedCall(m); }
      } else if (!isClient) showPoliceDispatch(m);
      break;
    case 'ack':
    case 'alert_status':
      if (AL.active && AL.alert && (AL.alert.alert_id === m.alert_id || AL.alert.detection_id === m.detection_id)) closeClientAlert();
      if (PAGE === 'client_alerts' && $('#view')) pageClientAlerts($('#view'));
      if (PAGE === 'alerts' && $('#view')) pageAlerts($('#view'));
      break;
    default: break;
  }
}

// ─── Données ──────────────────────────────────────────────────────────
async function reloadVehicles() { S.vehicles = await api('/api/vehicles').catch(() => []); }
async function reloadDrivers() { S.drivers = await api('/api/drivers').catch(() => []); }
async function loadStats() { try { S.stats = await api('/api/stats'); updateDashboardLive(); } catch {} }

async function loadInitialData() {
  await Promise.all([
    reloadVehicles(), reloadDrivers(), loadStats(),
    api('/api/settings').then(s => { S.settings = s; }).catch(() => {}),
    api('/api/route').then(r => { S.route = r; }).catch(() => {}),
  ]);
}

// ─── Thème ────────────────────────────────────────────────────────────
// Mode nuit par défaut; le choix fait avec le bouton soleil/lune est mémorisé (clé theme_choice)
function preferredTheme() {
  const c = sget('theme_choice', '');
  return c === 'light' || c === 'dark' ? c : 'dark';
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  sset('theme', theme);
  const btn = $('#themeBtn');
  if (btn) btn.innerHTML = theme === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
}

// ══════════════════════════════════════════════════════════════════════
// INITIALISATION
// ══════════════════════════════════════════════════════════════════════
async function init() {
  // Thème
  applyTheme(preferredTheme());

  // Contrôles globaux
  $('#logoutBtn').addEventListener('click', () => AUTH.logout());
  $('#soundBtn').addEventListener('click', unlockAudio);
  $('#burger').addEventListener('click', () => document.body.classList.toggle('menu-open'));
  const openHelp = () => openModal(`
    <div class="modal-head"><i class="fa-solid fa-circle-question" style="color:var(--brand)"></i> ${esc(t('helpTitle'))}</div>
    <div class="modal-body"><p style="line-height:1.7">${esc(t('helpText'))}</p>
    <hr style="border:0;border-top:1px solid var(--border);margin:16px 0">
    <p style="font-size:13px;color:var(--muted)">Comptes de démo: <b>client1 / client123</b> (espace client) | <b>police / police123</b> (superviseur)</p>
    </div>
    <div class="modal-foot"><button class="btn gray" data-close>${esc(t('close'))}</button></div>`);
  $('#helpBtn').addEventListener('click', openHelp);
  $('#helpBtn2')?.addEventListener('click', openHelp);

  $('#themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    sset('theme_choice', next);
    if (AUTH.user && ['dashboard', 'map', 'client_trip'].includes(PAGE)) route();
  });

  $('#alAwake').addEventListener('click', async () => {
    if (AL.alert?.alert_id) await api(`/api/client/alerts/${AL.alert.alert_id}/awake`, { method: 'POST' }).catch(() => {});
    closeClientAlert();
    toast('✅ Vous êtes réveillé ! Alerte et appel annulés.', 'success');
  });
  $('#alStop').addEventListener('click', closeClientAlert);
  $('#alMap').addEventListener('click', () => { closeClientAlert(); location.hash = AUTH.user?.role === 'client' ? '#client_trip' : '#map'; });

  setupAuthTabs();
  setupPoliceDispatchControls();
  window.addEventListener('hashchange', route);

  // Session existante
  let hasUser = await AUTH.init();
  if (hasUser && APP_CLIENT && AUTH.user?.role !== 'client') { AUTH.clear(); hasUser = false; }
  if (hasUser) {
    hideAuthScreen();
    await loadInitialData();
    connectWS();
    route();
    if (APP_CLIENT && AUTH.user?.role === 'client') nativeCam('start');
  } else {
    showAuthScreen();
  }

  // Stats refresh toutes les 30s
  setInterval(() => { if (AUTH.user) loadStats(); }, 30000);
}

// Correction padStart manquant (edge cases)
if (!String.prototype.padStart) {
  String.prototype.padStart = function(l, c) { let s = this; while (s.length < l) s = c + s; return s; };
}

init();
