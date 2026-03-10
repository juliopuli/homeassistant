/* ══════════════════════════════════════════════
   Dashboard HA · 3D Zone Edition (app_v4.js)
   ══════════════════════════════════════════════ */

const HA_URL = 'https://julhomecala.priona.com';

const ZONES = [
    { id: 'zone-comedor', entity_id: 'light.luzcomedor', name: 'Comedor', points: '5,68 45,68 45,98 5,98' },
    { id: 'zone-salon', entity_id: 'light.luzsalon', name: 'Salón', points: '5,38 45,38 45,68 5,68' },
    // Additional zones can be added here
];

const ALARM_ENTITIES = [
    'alarm_control_panel.alarmaaqara',
    'alarm_control_panel.alarmo',
    'alarm_control_panel.master',
    'alarm_control_panel.nenes'
];

let entityStates = {};
let ws = null;
let wsReconnTimer = null;
let wsMsgId = 1;

/* ──────────────────────────────────────────────
   TOAST
   ────────────────────────────────────────────── */
function showToast(msg, icon = '💡') {
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span>${icon}</span> <span>${msg}</span>`;
    container.appendChild(t);
    setTimeout(() => t.remove(), 3200);
}

/* ──────────────────────────────────────────────
   OAUTH — Reuse existing tokens
   ────────────────────────────────────────────── */
function getAccessToken() { return sessionStorage.getItem('ha_access_token'); }

async function refreshAccessToken() {
    const refreshToken = sessionStorage.getItem('ha_refresh_token');
    if (!refreshToken) { window.location.href = 'index.html'; return; }
    try {
        const res = await fetch(`${HA_URL}/auth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '/'),
            }).toString()
        });
        const data = await res.json();
        sessionStorage.setItem('ha_access_token', data.access_token);
        if (data.refresh_token) sessionStorage.setItem('ha_refresh_token', data.refresh_token);
    } catch (e) {
        console.error('Token refresh error:', e);
        window.location.href = 'index.html';
    }
}

/* ──────────────────────────────────────────────
   HA COMMUNICATION
   ────────────────────────────────────────────── */
async function callService(domain, service, serviceData) {
    try {
        const res = await fetch(`${HA_URL}/api/services/${domain}/${service}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAccessToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(serviceData),
        });
        if (res.status === 401) { await refreshAccessToken(); return callService(domain, service, serviceData); }
        return res.json();
    } catch (e) {
        console.error('Service call error:', e);
        showToast('Error al enviar el comando', '⚠️');
        return null;
    }
}

function connectWebSocket() {
    const token = getAccessToken();
    if (!token) return;

    const wsUrl = HA_URL.replace(/^http/, 'ws') + '/api/websocket';
    ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'auth_required') {
            ws.send(JSON.stringify({ type: 'auth', access_token: getAccessToken() }));
        }
        if (msg.type === 'auth_ok') {
            document.getElementById('conn-text').textContent = 'Conectado';
            ws.send(JSON.stringify({ id: wsMsgId++, type: 'subscribe_events', event_type: 'state_changed' }));
            fetchAllStates();
        }
        if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
            const data = msg.event.data;
            const entityId = data.entity_id;
            if (data.new_state) {
                entityStates[entityId] = { state: data.new_state.state, attributes: data.new_state.attributes || {} };
                renderAll();
            }
        }
    };

    ws.onclose = () => {
        document.getElementById('conn-text').textContent = 'Reconectando...';
        if (wsReconnTimer) clearTimeout(wsReconnTimer);
        wsReconnTimer = setTimeout(connectWebSocket, 5000);
    };
}

async function fetchAllStates() {
    try {
        const res = await fetch(`${HA_URL}/api/states`, {
            headers: { 'Authorization': `Bearer ${getAccessToken()}` }
        });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        data.forEach(s => entityStates[s.entity_id] = { state: s.state, attributes: s.attributes });
        renderAll();
    } catch (e) { console.error('fetchAllStates error:', e); }
}

/* ──────────────────────────────────────────────
   RENDER LOGIC
   ────────────────────────────────────────────── */
function initZones() {
    const container = document.getElementById('zone-illuminator');
    const imgUrl = 'floorplan_3d.png';

    ZONES.forEach(z => {
        const layer = document.createElement('div');
        layer.id = `layer-${z.id}`;
        layer.className = 'zone-layer';
        layer.style.cssText = `
        background-image: url(${imgUrl});
        background-size: 100% 100%;
        clip-path: polygon(${z.points});
    `;
        container.appendChild(layer);

        const poly = document.getElementById(z.id);
        if (poly) {
            poly.onclick = () => {
                const isOn = entityStates[z.entity_id]?.state === 'on';
                const service = isOn ? 'turn_off' : 'turn_on';
                callService('light', service, { entity_id: z.entity_id });
                showToast(`${z.name} → ${isOn ? 'Apagado' : 'Encendido 🔆'}`, '💡');
            };
        }
    });
}

function renderAll() {
    ZONES.forEach(z => {
        const isOn = entityStates[z.entity_id]?.state === 'on';
        const layer = document.getElementById(`layer-${z.id}`);
        if (layer) {
            layer.classList.toggle('active', isOn);
        }
    });
    updateAlarmStatus();
}

function updateAlarmStatus() {
    const container = document.getElementById('fp-container');
    if (!container) return;
    const isTriggered = ALARM_ENTITIES.some(id => entityStates[id]?.state === 'triggered');
    const isArmed = ALARM_ENTITIES.some(id => entityStates[id]?.state?.startsWith('armed_'));
    container.classList.toggle('alarm-active', isTriggered);
    container.classList.toggle('alarm-armed', isArmed && !isTriggered);
}

// Start
if (getAccessToken()) {
    initZones();
    connectWebSocket();
} else {
    window.location.href = 'index.html';
}
