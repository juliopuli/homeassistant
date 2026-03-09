/* ═══════════════════════════════════════════════════════════════
   Dashboard HA · app.js
   OAuth 2.0 · Home Assistant REST API + WebSocket · Glow Effects
   ═══════════════════════════════════════════════════════════════
   ⚠️  NO HAY NINGÚN TOKEN EN ESTE ARCHIVO.
       La autenticación se realiza vía OAuth 2.0 y el token
       se almacena únicamente en sessionStorage del navegador.
   ═══════════════════════════════════════════════════════════════ */

const HA_URL = 'https://julhomecala.priona.com';

/* ──────────────────────────────────────────────
   ENTITY DEFINITIONS
   x, y → porcentaje sobre la imagen del plano (0-100%)
   ────────────────────────────────────────────── */
const ENTITIES = [
  {
    id: 'light.piesalon',
    name: 'Lámpara pie Salón',
    type: 'light',
    x: 7.5,      // % desde la izquierda — Cuadro 142 (Col 1)
    y: 37.5,     // % desde arriba — Cuadro 142 (Row 7)
    defaultColor: '#fbbf24',
  },
  {
    id: 'light.luzcomedor',
    name: 'Luz Comedor',
    type: 'light',
    x: 12.5,      // % desde la izquierda — Cuadro 243 (Col 3)
    y: 62.5,      // % desde arriba — Cuadro 243 (Row 13)
    defaultColor: '#fbbf24',
    showIcon: true,
  },
  {
    id: 'light.luzsalon',
    name: 'Luz Salón',
    type: 'light',
    x: 12.5,      // % desde la izquierda — Cuadro 163 (Col 3)
    y: 42.5,      // % desde arriba — Cuadro 163 (Row 9)
    defaultColor: '#fbbf24',
    showIcon: true,
  },
  // ── Añade aquí más dispositivos ──
  // { id: 'switch.enchufe_salon', name: 'Enchufe Salón',  type: 'switch', x:15, y:62, defaultColor:'#60a5fa' },
  // { id: 'light.dormitorio',     name: 'Luz Dormitorio', type: 'light',  x:75, y:60, defaultColor:'#a78bfa' },
];

/* ──────────────────────────────────────────────
   OAUTH 2.0 — Token management
   ────────────────────────────────────────────── */

function getClientId() {
  const url = new URL(window.location.href);
  return url.origin + url.pathname.replace(/\/[^\/]*$/, '/');
}

function getRedirectUri() {
  return getClientId() + 'dashboard.html';
}

function getAccessToken() { return sessionStorage.getItem('ha_access_token'); }
function getRefreshToken() { return sessionStorage.getItem('ha_refresh_token'); }

function saveTokens(accessToken, refreshToken, expiresIn) {
  sessionStorage.setItem('ha_access_token', accessToken);
  if (refreshToken) sessionStorage.setItem('ha_refresh_token', refreshToken);
  // Schedule token refresh 60 seconds before expiry
  if (expiresIn) {
    const msUntilRefresh = (expiresIn - 60) * 1000;
    if (msUntilRefresh > 0) setTimeout(refreshAccessToken, msUntilRefresh);
  }
}

function clearSession() {
  sessionStorage.removeItem('ha_access_token');
  sessionStorage.removeItem('ha_refresh_token');
  sessionStorage.removeItem('ha_oauth_state');
}

/** Exchange authorization code → access token + refresh token */
async function exchangeCode(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
  });

  const res = await fetch(`${HA_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${err}`);
  }

  return res.json();
}

/** Refresh the access token using the refresh token */
async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) { redirectToLogin(); return; }

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: getClientId(),
    });

    const res = await fetch(`${HA_URL}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) throw new Error('Refresh failed');

    const data = await res.json();
    saveTokens(data.access_token, data.refresh_token, data.expires_in);
    console.log('[OAuth] Token refreshed successfully');
  } catch (e) {
    console.error('[OAuth] Token refresh error:', e);
    clearSession();
    redirectToLogin();
  }
}

function redirectToLogin() {
  window.location.href = 'index.html';
}

/* ──────────────────────────────────────────────
   OAUTH 2.0 — Handle redirect callback
   ────────────────────────────────────────────── */
async function handleOAuth() {
  const overlay = document.getElementById('oauth-overlay');
  const msg = document.getElementById('oauth-msg');

  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');

  // ── Case 1: Already authenticated ──
  if (getAccessToken()) {
    overlay.classList.add('hidden');
    document.getElementById('dashboard-root').style.display = '';
    return true;
  }

  // ── Case 2: OAuth error ──
  if (error) {
    showOAuthError(overlay, `Error de autenticación: ${error}`);
    return false;
  }

  // ── Case 3: OAuth callback with code ──
  if (code) {
    msg.textContent = 'Autenticando…';

    // Verify CSRF state
    const savedState = sessionStorage.getItem('ha_oauth_state');
    if (savedState && state && savedState !== state) {
      showOAuthError(overlay, 'Error de seguridad: el estado no coincide. Intenta de nuevo.');
      return false;
    }

    try {
      const data = await exchangeCode(code);
      saveTokens(data.access_token, data.refresh_token, data.expires_in);

      // Clean the URL (remove ?code=... from address bar)
      window.history.replaceState({}, document.title, window.location.pathname);

      overlay.classList.add('hidden');
      document.getElementById('dashboard-root').style.display = '';
      return true;
    } catch (e) {
      console.error('[OAuth]', e);
      showOAuthError(overlay, 'No se pudo obtener el token. ¿Está HA alcanzable desde el navegador?');
      return false;
    }
  }

  // ── Case 4: No token, no code → go to login ──
  redirectToLogin();
  return false;
}

function showOAuthError(overlay, message) {
  overlay.innerHTML = `
    <div class="oauth-error">
      <h3>⚠️ Error de autenticación</h3>
      <p>${message}</p>
      <a href="index.html" class="btn-retry">← Volver al inicio</a>
    </div>`;
}

/* ──────────────────────────────────────────────
   UTILS — Color helpers
   ────────────────────────────────────────────── */
function hsToHex(h, s) {
  const hN = h / 360, sN = s / 100, vN = 1, i = Math.floor(hN * 6), f = hN * 6 - i;
  const p = vN * (1 - sN), q = vN * (1 - f * sN), t = vN * (1 - (1 - f) * sN);
  let r, g, b;
  switch (i % 6) { case 0: r = vN; g = t; b = p; break; case 1: r = q; g = vN; b = p; break; case 2: r = p; g = vN; b = t; break; case 3: r = p; g = q; b = vN; break; case 4: r = t; g = p; b = vN; break; case 5: r = vN; g = p; b = q; break; }
  return '#' + [r, g, b].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? `${parseInt(r[1], 16)},${parseInt(r[2], 16)},${parseInt(r[3], 16)}` : '251,191,36';
}

function kelvinToHex(k) {
  const t = k / 100; let r, g, b;
  r = t <= 66 ? 255 : Math.min(255, Math.round(329.698727446 * Math.pow(t - 60, -0.1332047592)));
  g = t <= 66 ? (t <= 2 ? 0 : Math.min(255, Math.round(99.4708025861 * Math.log(t) - 161.1195681661))) : Math.min(255, Math.round(288.1221695283 * Math.pow(t - 60, -0.0755148492)));
  b = t >= 66 ? 255 : (t <= 19 ? 0 : Math.min(255, Math.round(138.5177312231 * Math.log(t - 10) - 305.0447927307)));
  return '#' + [r, g, b].map(x => Math.max(0, x).toString(16).padStart(2, '0')).join('');
}

function getEntityColor(def, state, attrs) {
  if (!state || state !== 'on') return def.defaultColor;
  if (attrs.rgb_color) return '#' + attrs.rgb_color.map(x => x.toString(16).padStart(2, '0')).join('');
  if (attrs.hs_color) return hsToHex(attrs.hs_color[0], attrs.hs_color[1]);
  if (attrs.color_temp_kelvin) return kelvinToHex(attrs.color_temp_kelvin);
  return def.defaultColor;
}

/* ──────────────────────────────────────────────
   TOAST
   ────────────────────────────────────────────── */
function showToast(msg, icon = '💡') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

/* ──────────────────────────────────────────────
   CONNECTION STATUS
   ────────────────────────────────────────────── */
function setConnStatus(status) {
  const badge = document.getElementById('conn-badge');
  const text = document.getElementById('conn-text');
  badge.classList.remove('offline', 'reconnecting');
  if (status === 'online') { text.textContent = 'Conectado'; }
  else if (status === 'offline') { badge.classList.add('offline'); text.textContent = 'Desconectado'; }
  else { badge.classList.add('reconnecting'); text.textContent = 'Reconectando…'; }
}

/* ──────────────────────────────────────────────
   STATE
   ────────────────────────────────────────────── */
let entityStates = {};
let ws = null;
let wsReconnTimer = null;
let wsMsgId = 1;

/* ──────────────────────────────────────────────
   REST API
   ────────────────────────────────────────────── */
async function haFetch(path, options = {}) {
  const token = getAccessToken();
  if (!token) { redirectToLogin(); return null; }
  options.headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
  const res = await fetch(`${HA_URL}${path}`, options);
  if (res.status === 401) {
    // Try to refresh once
    await refreshAccessToken();
    return haFetch(path, options);
  }
  return res;
}

async function fetchEntityState(entityId) {
  try {
    const res = await haFetch(`/api/states/${entityId}`);
    if (!res || !res.ok) return null;
    return res.json();
  } catch (e) { console.warn(`fetchEntityState(${entityId}):`, e); return null; }
}

async function fetchAllStates() {
  const results = await Promise.all(ENTITIES.map(e => fetchEntityState(e.id)));
  results.forEach((data, i) => {
    if (data) entityStates[ENTITIES[i].id] = { state: data.state, attributes: data.attributes };
  });
  renderAll();
}

async function toggleEntity(def) {
  const current = entityStates[def.id];
  const isOn = current && current.state === 'on';
  const service = isOn ? 'turn_off' : 'turn_on';
  try {
    const res = await haFetch(`/api/services/${def.type}/${service}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_id: def.id }),
    });
    if (!res || !res.ok) throw new Error(res?.status);
    const newState = isOn ? 'off' : 'on';
    showToast(`${def.name} → ${newState === 'on' ? 'Encendida 🔆' : 'Apagada'}`, def.type === 'light' ? '💡' : '🔌');
    entityStates[def.id] = { state: newState, attributes: current ? current.attributes : {} };
    renderAll();
  } catch (e) { showToast('Error al cambiar el estado', '⚠️'); }
}

/* ──────────────────────────────────────────────
   WEBSOCKET
   ────────────────────────────────────────────── */
function connectWebSocket() {
  const token = getAccessToken();
  if (!token) return;

  const wsUrl = HA_URL.replace(/^http/, 'ws') + '/api/websocket';
  ws = new WebSocket(wsUrl);

  ws.onopen = () => console.log('[HA WS] Connected');

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'auth_required') {
      ws.send(JSON.stringify({ type: 'auth', access_token: getAccessToken() }));
    }
    if (msg.type === 'auth_ok') {
      setConnStatus('online');
      ws.send(JSON.stringify({ id: wsMsgId++, type: 'subscribe_events', event_type: 'state_changed' }));
    }
    if (msg.type === 'auth_invalid') {
      setConnStatus('offline');
      // Try refresh on WS auth failure
      refreshAccessToken().then(() => {
        setTimeout(connectWebSocket, 1000);
      });
    }
    if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
      const data = msg.event.data;
      if (ENTITIES.find(e => e.id === data.entity_id) && data.new_state) {
        const prev = entityStates[data.entity_id]?.state;
        entityStates[data.entity_id] = { state: data.new_state.state, attributes: data.new_state.attributes || {} };
        if (prev !== data.new_state.state) {
          const def = ENTITIES.find(e => e.id === data.entity_id);
          showToast(`${def.name} → ${data.new_state.state === 'on' ? 'Encendida 🔆' : 'Apagada'}`, def.type === 'light' ? '💡' : '🔌');
        }
        renderAll();
      }
    }
  };

  ws.onerror = () => setConnStatus('reconnecting');
  ws.onclose = () => {
    setConnStatus('reconnecting');
    if (wsReconnTimer) clearTimeout(wsReconnTimer);
    wsReconnTimer = setTimeout(connectWebSocket, 5000);
  };
}

/* ──────────────────────────────────────────────
   RENDER — Floor plan hotspots
   ────────────────────────────────────────────── */
function renderFloorplanEntities() {
  const container = document.getElementById('fp-entities');
  container.innerHTML = '';
  ENTITIES.forEach(def => {
    const es = entityStates[def.id] || { state: 'unavailable', attributes: {} };
    const isOn = es.state === 'on';
    const color = getEntityColor(def, es.state, es.attributes);
    const rgb = hexToRgb(color);

    const hotspot = document.createElement('div');
    hotspot.className = `entity-hotspot${isOn ? ' on' : ''}`;
    hotspot.style.cssText = `left:${def.x}%;top:${def.y}%;--light-color:${color};--light-rgb:${rgb};`;
    hotspot.title = `${def.name} · ${es.state}`;

    const glowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    glowSvg.setAttribute('class', 'glow-rings');
    glowSvg.setAttribute('viewBox', '0 0 120 120');
    glowSvg.innerHTML = isOn ? buildGlowRingsSVG(color, rgb) : '';
    hotspot.appendChild(glowSvg);

    const iconDiv = document.createElement('div');
    iconDiv.className = `entity-icon${def.showIcon ? ' show-icon' : ''}`;
    iconDiv.innerHTML = getEntitySVGIcon(def.type, isOn);
    hotspot.appendChild(iconDiv);

    const label = document.createElement('span');
    label.className = 'entity-label';
    label.textContent = def.name.replace('Lámpara ', '').replace('Luz ', '');
    hotspot.appendChild(label);

    hotspot.addEventListener('click', () => toggleEntity(def));
    container.appendChild(hotspot);
  });
}

function buildGlowRingsSVG(color, rgb) {
  return `
    <defs>
      <filter id="gf" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <circle cx="60" cy="60" r="28" fill="rgba(${rgb},.08)" stroke="${color}" stroke-width="1.5" stroke-opacity=".35"/>
    <circle cx="60" cy="60" fill="none" stroke="${color}" stroke-width="2" filter="url(#gf)">
      <animate attributeName="r" from="22" to="56" dur="2s" repeatCount="indefinite" begin="0s"/>
      <animate attributeName="stroke-opacity" from=".65" to="0" dur="2s" repeatCount="indefinite" begin="0s"/>
    </circle>
    <circle cx="60" cy="60" fill="none" stroke="${color}" stroke-width="1.5">
      <animate attributeName="r" from="22" to="50" dur="2s" repeatCount="indefinite" begin=".6s"/>
      <animate attributeName="stroke-opacity" from=".45" to="0" dur="2s" repeatCount="indefinite" begin=".6s"/>
    </circle>
    <circle cx="60" cy="60" fill="none" stroke="${color}" stroke-width="1">
      <animate attributeName="r" from="22" to="44" dur="2s" repeatCount="indefinite" begin="1.2s"/>
      <animate attributeName="stroke-opacity" from=".3" to="0" dur="2s" repeatCount="indefinite" begin="1.2s"/>
    </circle>`;
}

function getEntitySVGIcon(type, isOn) {
  const icons = {
    light: `<svg viewBox="0 0 24 24" fill="none" class="arch-symbol"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.2"/><path d="M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" stroke="currentColor" stroke-width="1.2"/></svg>`,
    switch: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="${isOn ? 16 : 8}" cy="12" r="3" fill="currentColor"/></svg>`,
    camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
    alarm: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/></svg>`,
  };
  return icons[type] || icons.light;
}

/* ──────────────────────────────────────────────
   RENDER — Side panel
   ────────────────────────────────────────────── */
function renderSidePanel() {
  const list = document.getElementById('entities-list');
  list.innerHTML = '';
  ENTITIES.forEach(def => {
    const es = entityStates[def.id] || { state: 'unavailable', attributes: {} };
    const isOn = es.state === 'on';
    const color = getEntityColor(def, es.state, es.attributes);
    const rgb = hexToRgb(color);

    const card = document.createElement('div');
    card.className = `entity-card${isOn ? ' on' : ''}`;
    card.style.cssText = `--card-color:${color};--card-rgb:${rgb};`;
    card.innerHTML = `
      <div class="entity-card-icon">${getEntitySVGIcon(def.type, isOn)}</div>
      <div class="entity-card-info">
        <div class="entity-card-name">${def.name}</div>
        <div class="entity-card-state">${formatState(es)}</div>
      </div>
      <button class="entity-toggle" aria-label="Toggle ${def.name}"></button>`;
    card.addEventListener('click', () => toggleEntity(def));
    list.appendChild(card);
  });
}

function formatState(es) {
  if (es.state === 'on') {
    const parts = [];
    if (es.attributes.brightness !== undefined) parts.push(`${Math.round(es.attributes.brightness / 255 * 100)}% brillo`);
    if (es.attributes.color_temp_kelvin) parts.push(`${es.attributes.color_temp_kelvin}K`);
    return parts.length ? parts.join(' · ') : 'Encendida';
  }
  if (es.state === 'off') return 'Apagada';
  if (es.state === 'unavailable') return 'No disponible';
  return es.state;
}

function renderAll() {
  renderFloorplanEntities();
  renderSidePanel();
}

/* ──────────────────────────────────────────────
   LOGOUT
   ────────────────────────────────────────────── */
function setupLogout() {
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    const token = getAccessToken();
    if (token) {
      // Revoke token at HA
      try {
        await fetch(`${HA_URL}/auth/token`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } catch (e) { /* ignore */ }
    }
    clearSession();
    redirectToLogin();
  });
}

/* ──────────────────────────────────────────────
   GRID OVERLAY
   ────────────────────────────────────────────── */
function setupGrid() {
  const btn = document.getElementById('btn-grid');
  const fpContainer = document.getElementById('fp-container');
  if (!btn || !fpContainer) return;

  const grid = document.createElement('div');
  grid.id = 'fp-grid';
  grid.className = 'grid-overlay';
  fpContainer.appendChild(grid);

  for (let i = 0; i < 1600; i++) {
    const cell = document.createElement('div');
    cell.className = 'grid-cell';

    // Calcula el centro de cada celda de 2.5% x 2.5%
    const row = Math.floor(i / 40);
    const col = i % 40;
    const x = parseFloat(((col * 2.5) + 1.25).toFixed(2));
    const y = parseFloat(((row * 2.5) + 1.25).toFixed(2));

    cell.title = `Cuadro ${i + 1}\\nx: ${x}%, y: ${y}%`;
    cell.addEventListener('click', () => {
      showToast(`Cuadro ${i + 1} → x: ${x}, y: ${y}`, '📍');
      console.log(`Cuadro ${i + 1}: x=${x}, y=${y}`);
    });
    grid.appendChild(cell);
  }

  btn.addEventListener('click', () => {
    grid.classList.toggle('active');
  });
}

/* ──────────────────────────────────────────────
   INIT
   ────────────────────────────────────────────── */
async function init() {
  const authed = await handleOAuth();
  if (!authed) return;

  setupLogout();
  setupGrid();

  const img = document.getElementById('fp-img');
  const start = () => fetchAllStates().then(() => connectWebSocket());

  if (img.complete) { start(); }
  else { img.addEventListener('load', start); }

  window.addEventListener('resize', renderAll);
}

document.addEventListener('DOMContentLoaded', init);
