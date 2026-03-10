/* ══════════════════════════════════════════════
   Dashboard HA · 3D Zenital LED Edition (app_v5.js)
   ══════════════════════════════════════════════ */

const HA_URL = 'https://julhomecala.priona.com';

const ZONES = [
    { id: 'zone-saloncomedor', entity_ids: ['light.luzcomedor', 'light.luzsalon', 'light.piesalon'], name: 'Salón-Comedor' },
    { id: 'zone-salita', entity_ids: ['light.foco1', 'light.extended_color_light_1', 'light.foco3'], name: 'Salita' },
    { id: 'zone-cocina', entity_ids: ['light.cocina'], name: 'Cocina' },
    { id: 'zone-lavadero', entity_ids: ['light.lavadero'], name: 'Lavadero' },
    { id: 'zone-bano1', entity_ids: ['light.bano_1'], name: 'Baño 1' },
    { id: 'zone-pasillo', entity_ids: ['light.pasillo1', 'light.pasillo2'], name: 'Pasillo' },
    { id: 'zone-nenes', entity_ids: ['light.luznenes'], name: 'Habitación Nenes' },
    { id: 'zone-banosuite', entity_ids: ['light.bano_suite'], name: 'Baño Suite' },
    { id: 'zone-dormitorio', entity_ids: ['light.luz_dormitorio'], name: 'Dormitorio Principal' }
];

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
   OAUTH & AUTH
   ────────────────────────────────────────────── */
function getAccessToken() { return sessionStorage.getItem('ha_access_token'); }

async function fetchAllStates() {
    try {
        const res = await fetch(`${HA_URL}/api/states`, {
            headers: { 'Authorization': `Bearer ${getAccessToken()}` }
        });
        const data = await res.json();
        data.forEach(s => entityStates[s.entity_id] = { state: s.state, attributes: s.attributes });
        renderAll();
    } catch (e) { console.error('fetchAllStates error:', e); }
}

async function callService(domain, service, serviceData) {
    try {
        await fetch(`${HA_URL}/api/services/${domain}/${service}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAccessToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(serviceData),
        });
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
        if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: getAccessToken() }));
        if (msg.type === 'auth_ok') {
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
   UI LOGIC & RENDERING
   ────────────────────────────────────────────── */
function initDynamicLayers() {
    const ledContainer = document.getElementById('led-layers');
    const hitZones = document.querySelectorAll('.room-hitbox');

    hitZones.forEach(hitbox => {
        const id = hitbox.id;
        const points = hitbox.getAttribute('points');
        const zone = ZONES.find(z => z.id === id);

        // Create the LED layer for this room
        const ledPoly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        ledPoly.id = `led-${id}`;
        ledPoly.setAttribute('class', 'led-polygon');
        ledPoly.setAttribute('points', points);
        ledContainer.appendChild(ledPoly);

        // Interaction
        hitbox.onclick = () => {
            if (!zone) return;
            // Toggle logic: if any entity in the zone is ON, turn all OFF. Otherwise turn all ON.
            const isAnyOn = zone.entity_ids.some(eid => entityStates[eid]?.state === 'on');
            const service = isAnyOn ? 'turn_off' : 'turn_on';
            zone.entity_ids.forEach(eid => callService('light', service, { entity_id: eid }));
            showToast(`${zone.name} → ${isAnyOn ? 'Apagando' : 'Encendiendo ✨'}`);
        };
    });
}

function renderAll() {
    ZONES.forEach(z => {
        const isAnyOn = z.entity_ids.some(eid => entityStates[eid]?.state === 'on');
        const ledPoly = document.getElementById(`led-${z.id}`);
        if (ledPoly) {
            ledPoly.classList.toggle('active', isAnyOn);

            // Bonus: if the light has a color, apply it to the LED glow
            const firstOnEntity = z.entity_ids.find(eid => entityStates[eid]?.state === 'on');
            const attrs = entityStates[firstOnEntity]?.attributes;
            if (attrs?.rgb_color) {
                const [r, g, b] = attrs.rgb_color;
                ledPoly.style.setProperty('--led-glow-color', `rgba(${r}, ${g}, ${b}, 0.8)`);
            } else {
                ledPoly.style.removeProperty('--led-glow-color');
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
    initDynamicLayers();
    connectWebSocket();
} else {
    window.location.href = 'index.html';
}
