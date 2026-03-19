/* ══════════════════════════════════════════════
   Dashboard HA · 3D Zenital LED Edition (app_v5.js)
   ══════════════════════════════════════════════ */

const HA_URL = 'https://julhomecala.priona.com';

const ZONES = [
    { id: 'zone-saloncomedor', entity_ids: ['light.luzcomedor', 'light.luzsalon', 'light.piesalon'], name: 'Salón-Comedor' },
    { id: 'zone-salita', entity_ids: ['light.pasillo2'], name: 'Salita' },
    { id: 'zone-cocina', entity_ids: ['light.cocina'], name: 'Cocina' },
    { id: 'zone-lavadero', entity_ids: ['light.lavadero'], name: 'Lavadero' },
    { id: 'zone-bano1', entity_ids: ['light.bano_1', 'light.bano1'], name: 'Baño 1' },
    { id: 'zone-pasillo', entity_ids: ['light.pasillo1', 'light.foco1', 'light.extended_color_light_1', 'light.foco3'], name: 'Pasillo' },
    { id: 'zone-nenes', entity_ids: ['light.luznenes', 'light.habitacion_ninos'], name: 'Habitación Nenes' },
    { id: 'zone-banosuite', entity_ids: ['light.bano_suite', 'light.banosuite'], name: 'Baño Suite' },
    { id: 'zone-dormitorio', entity_ids: ['light.luz_dormitorio', 'light.dormitorio'], name: 'Dormitorio Principal' }
];

// Precision Grid Mapping (64x64)
const ENTITY_LED_CELLS = {
    'light.piesalon': [6404, 6148, 5892, 5636, 5638, 5640, 5642, 5644],
    'light.luzsalon': [5644, 5646, 5648, 5650, 5652, 5654, 5656, 5658, 6176, 6432, 6688, 8720, 8976, 9232],
    'light.luzcomedor': [8710, 8966, 9222, 9478, 9734, 9990, 10246, 10502, 10758, 10760, 10762, 10764, 10766, 10768, 10770, 10772, 10774, 10776, 10778, 10780, 10782, 10784, 10786, 10530, 10274],
    'light.pasillo1': [3742, 3743, 3744, 3745, 3746, 3747, 3748, 3749, 3750, 3751, 3752, 3753, 3754, 3755, 3756, 3757, 3885, 4013, 4141, 4269, 4270, 4271, 4272, 4273, 4274, 4275, 4276, 4277, 4278, 4279],
    'light.pasillo2': [],
    'light.foco1': [3742, 3743, 3744, 3745, 3746, 3747, 3748, 3749, 3750, 3751, 3752, 3753, 3754, 3755, 3756, 3757, 3885, 4013, 4141, 4269, 4270, 4271, 4272, 4273, 4274, 4275, 4276, 4277, 4278, 4279],
    'light.extended_color_light_1': [3742, 3743, 3744, 3745, 3746, 3747, 3748, 3749, 3750, 3751, 3752, 3753, 3754, 3755, 3756, 3757, 3885, 4013, 4141, 4269, 4270, 4271, 4272, 4273, 4274, 4275, 4276, 4277, 4278, 4279],
    'light.foco3': [3742, 3743, 3744, 3745, 3746, 3747, 3748, 3749, 3750, 3751, 3752, 3753, 3754, 3755, 3756, 3757, 3885, 4013, 4141, 4269, 4270, 4271, 4272, 4273, 4274, 4275, 4276, 4277, 4278, 4279]
};

const ALARM_ENTITIES = [
    'alarm_control_panel.alarmaaqara',
    'alarm_control_panel.alarmo',
    'alarm_control_panel.master',
    'alarm_control_panel.nenes'
];

let entityStates = {};
let ws = null;
let wsMsgId = 1;

/* ──────────────────────────────────────────────
   OAUTH 2.0 — Token management
   ────────────────────────────────────────────── */
function getClientId() {
    const url = new URL(window.location.href);
    return url.origin + url.pathname.replace(/\/[^\/]*$/, '/');
}
function getRedirectUri() { return getClientId() + 'dashboard.html'; }
function getAccessToken() { return sessionStorage.getItem('ha_access_token'); }
function getRefreshToken() { return sessionStorage.getItem('ha_refresh_token'); }

function saveTokens(accessToken, refreshToken, expiresIn) {
    sessionStorage.setItem('ha_access_token', accessToken);
    if (refreshToken) sessionStorage.setItem('ha_refresh_token', refreshToken);
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

function redirectToLogin() { window.location.href = 'index.html'; }

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
        console.log('[OAuth] Token refreshed');
    } catch (e) {
        console.error('[OAuth] Refresh error:', e);
        clearSession();
        redirectToLogin();
    }
}

async function haFetch(path, options = {}) {
    const token = getAccessToken();
    if (!token) { redirectToLogin(); return null; }
    options.headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
    const res = await fetch(`${HA_URL}${path}`, options);
    if (res.status === 401) {
        await refreshAccessToken();
        return haFetch(path, options);
    }
    return res;
}

async function fetchAllStates() {
    try {
        const res = await haFetch('/api/states');
        if (!res || !res.ok) return;
        const data = await res.json();
        data.forEach(s => entityStates[s.entity_id] = { state: s.state, attributes: s.attributes });
        renderAll();
    } catch (e) { console.error('fetchAllStates error:', e); }
}

async function callService(domain, service, serviceData) {
    try {
        const res = await haFetch(`/api/services/${domain}/${service}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(serviceData),
        });
        if (!res.ok) console.error(`Service call failed: ${res.status}`);
    } catch (e) { console.error('Service call error:', e); }
}

/* ──────────────────────────────────────────────
   WEBSOCKET
   ────────────────────────────────────────────── */
function connectWebSocket() {
    const wsUrl = HA_URL.replace(/^http/, 'ws') + '/api/websocket';
    ws = new WebSocket(wsUrl);
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        console.log('[HA WS]', msg.type);
        if (msg.type === 'auth_required') {
            console.log('[HA WS] Auth required');
            ws.send(JSON.stringify({ type: 'auth', access_token: getAccessToken() }));
        }
        if (msg.type === 'auth_ok') {
            console.log('[HA WS] Auth OK');
            document.getElementById('conn-status').textContent = 'Conectado';
            ws.send(JSON.stringify({ id: wsMsgId++, type: 'subscribe_events', event_type: 'state_changed' }));
            fetchAllStates();
        }
        if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
            const data = msg.event.data;
            if (data.new_state) {
                entityStates[data.entity_id] = { state: data.new_state.state, attributes: data.new_state.attributes };
                renderAll();
            }
        }
    };
}

/* ──────────────────────────────────────────────
   POSITIONING GRID (64x64)
   ────────────────────────────────────────────── */
let selectedIds = [];

function updateSelectionUI() {
    const list = document.getElementById('selection-list');
    const panel = document.getElementById('grid-selection-panel');
    if (!list || !panel) return;

    if (selectedIds.length === 0) {
        list.textContent = 'Haga clic en la cuadrícula...';
    } else {
        list.textContent = selectedIds.join(', ');
    }
}

function setupGrid() {
    const btn = document.getElementById('btn-grid');
    const fpContainer = document.getElementById('fp-container');
    const panel = document.getElementById('grid-selection-panel');
    if (!btn || !fpContainer) return;

    const grid = document.createElement('div');
    grid.id = 'fp-grid';
    grid.className = 'grid-overlay';
    fpContainer.appendChild(grid);

    // Grid 128x128 (16384 cells)
    for (let i = 0; i < 16384; i++) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';

        const row = Math.floor(i / 128);
        const col = i % 128;
        const x = (col * (100 / 128) + (100 / 256)).toFixed(3);
        const y = (row * (100 / 128) + (100 / 256)).toFixed(3);

        cell.title = `ID: ${i}\nx: ${x}%, y: ${y}%`;
        cell.addEventListener('click', () => {
            const cid = i;
            if (selectedIds.includes(cid)) {
                selectedIds = selectedIds.filter(id => id !== cid);
                cell.classList.remove('selected');
            } else {
                selectedIds.push(cid);
                selectedIds.sort((a,b) => a-b);
                cell.classList.add('selected');
            }
            updateSelectionUI();
            console.log(`LED ID: ${cid} (x: ${x}%, y: ${y}%)`);
        });
        grid.appendChild(cell);
    }

    btn.addEventListener('click', () => {
        const active = grid.classList.toggle('active');
        btn.classList.toggle('active', active);
        if (panel) panel.classList.toggle('active', active);
    });

    // Selection Actions
    document.getElementById('btn-clear-selection')?.addEventListener('click', () => {
        selectedIds = [];
        grid.querySelectorAll('.grid-cell.selected').forEach(c => c.classList.remove('selected'));
        updateSelectionUI();
    });

    document.getElementById('btn-copy-selection')?.addEventListener('click', () => {
        if (selectedIds.length === 0) return;
        const text = selectedIds.join(', ');
        navigator.clipboard.writeText(text).then(() => {
            if (typeof showToast === 'function') showToast('IDs copiados al portapapeles', '📋');
        });
    });
}

/* ──────────────────────────────────────────────
   INIT
   ────────────────────────────────────────────── */
async function init() {
    setupGrid();
    initDynamicLayers();
    // Use the API from the main app or a simple fetch
    // For this context, we assume we just need to render the layers
    renderAll();
}

/* ──────────────────────────────────────────────
   UI LOGIC & RENDERING
   ────────────────────────────────────────────── */
function initDynamicLayers() {
    const ledContainer = document.getElementById('led-layers');
    const hitZones = document.querySelectorAll('.room-hitbox');

    hitZones.forEach(hitbox => {
        const id = hitbox.id;
        const points = hitbox.getAttribute('points');
        const zone = ZONES.find(z => z.id === id);

        // Create the Room LED layer for fallback (if no specific cells are defined)
        const ledPoly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        ledPoly.id = `led-${id}`;
        ledPoly.setAttribute('class', 'led-polygon');
        ledPoly.setAttribute('points', points);
        ledContainer.appendChild(ledPoly);

        // Interaction
        hitbox.onclick = (e) => {
            console.log('[UI Click] Zone:', id);
            if (!zone) return;
            const isAnyOn = zone.entity_ids.some(eid => entityStates[eid]?.state === 'on');
            const service = isAnyOn ? 'turn_off' : 'turn_on';
            zone.entity_ids.forEach(eid => {
                const domain = eid.split('.')[0];
                callService(domain, service, { entity_id: eid });
            });
            showToast(`${zone.name} → ${isAnyOn ? 'Apagando' : 'Encendiendo ✨'}`);
        };
    });

    // Create Cells Overlay for precision entities
    const cellGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    cellGroup.id = 'precision-cells';
    ledContainer.appendChild(cellGroup);

    Object.keys(ENTITY_LED_CELLS).forEach(eid => {
        const cells = ENTITY_LED_CELLS[eid];
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.id = `led-cells-${eid}`;
        g.classList.add('led-polygon'); // Re-use LED styles

        // Group cells into continuous segments based on adjacency
        const segments = [];
        let currentSegment = [];

        for (let i = 0; i < cells.length; i++) {
            const current = cells[i];
            const previous = cells[i - 1];

            if (previous !== undefined) {
                const r1 = Math.floor(current / 128), c1 = current % 128;
                const r2 = Math.floor(previous / 128), c2 = previous % 128;
                // Since points are often spaced by 2 (migrated from 64x64), we allow distance up to 2
                const isAdjacent = Math.abs(r1 - r2) <= 2 && Math.abs(c1 - c2) <= 2;

                if (!isAdjacent) {
                    segments.push(currentSegment);
                    currentSegment = [];
                }
            }
            currentSegment.push(current);
        }
        if (currentSegment.length > 0) segments.push(currentSegment);

        // Render each contiguous segment as a polyline with "Mid-Edge" logic
        segments.forEach(seg => {
            if (seg.length === 0) return;

            const segmentPoints = [];

            for (let i = 0; i < seg.length; i++) {
                const cid = seg[i];
                
                const r = Math.floor(cid / 128), c = cid % 128;
                const px = c * (100 / 128) + (100 / 256);
                const py = r * (100 / 128) + (100 / 256);
                
                segmentPoints.push(`${px},${py}`);
            }

            if (segmentPoints.length > 0) {
                const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
                polyline.setAttribute('points', segmentPoints.join(' '));
                polyline.setAttribute('fill', 'none');
                g.appendChild(polyline);
            }
        });

        cellGroup.appendChild(g);
    });
}

function renderAll() {
    // Room LED polygons (fallback)
    ZONES.forEach(z => {
        const isAnyOn = z.entity_ids.some(eid => entityStates[eid]?.state === 'on');
        const ledPoly = document.getElementById(`led-${z.id}`);
        if (ledPoly) {
            // Hide polygon if at least one entity in room has precise cells defined
            const hasPreciseCells = z.entity_ids.some(eid => ENTITY_LED_CELLS[eid]);
            ledPoly.classList.toggle('active', isAnyOn && !hasPreciseCells);
        }
    });

    // Precise Cell LEDS
    Object.keys(ENTITY_LED_CELLS).forEach(eid => {
        const isOn = entityStates[eid]?.state === 'on';
        const ledG = document.getElementById(`led-cells-${eid}`);
        if (ledG) {
            ledG.classList.toggle('active', isOn);
            // Apply color if available
            const attrs = entityStates[eid]?.attributes;
            if (attrs?.rgb_color) {
                const [r, g, b] = attrs.rgb_color;
                ledG.style.setProperty('--led-glow-color', `rgba(${r}, ${g}, ${b}, 0.8)`);
            } else {
                ledG.style.removeProperty('--led-glow-color');
            }
        }
    });

    updateAlarmStatus();
}

function updateAlarmStatus() {
    const container = document.getElementById('fp-container');
    const isTriggered = ALARM_ENTITIES.some(id => entityStates[id]?.state === 'triggered');
    const isArmed = ALARM_ENTITIES.some(id => entityStates[id]?.state?.startsWith('armed_'));
    container.classList.toggle('alarm-active', isTriggered);
    container.classList.toggle('alarm-armed', isArmed && !isTriggered);
}

function showToast(msg) {
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

// Kickstart
if (getAccessToken()) {
    init();
    connectWebSocket();
} else {
    window.location.href = 'index.html';
}
