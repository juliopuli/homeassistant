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

// Precision Grid Mapping (64x64)
const ENTITY_LED_CELLS = {
    'light.piesalon': [1602, 1538, 1474, 1410, 1411, 1412, 1413, 1414],
    'light.luzsalon': [1414, 1415, 1416, 1417, 1418, 1419, 1420, 1421, 1552, 1616, 1680, 2192, 2256, 2320],
    'light.luzcomedor': [2178, 2242, 2306, 2370, 2434, 2498, 2562, 2626, 2690, 2691, 2692, 2693, 2694, 2695, 2696, 2697, 2698, 2699, 2700, 2701, 2702, 2703, 2704, 2640, 2576],
    'light.pasillo1': [898, 899, 900, 904, 905, 906, 907, 911, 912, 913, 914, 915, 916, 917, 918, 919, 962, 983, 1026, 1047, 1048, 1049, 1050, 1051, 1055, 1056, 1057, 1058, 1059, 1060, 1063, 1090, 1127, 1154, 1191, 1218, 1255, 1282, 1319, 1346, 1347, 1348, 1349, 1350, 1351, 1352, 1353, 1354, 1355, 1356, 1357, 1360, 1361, 1362, 1363, 1364, 1365, 1366, 1367, 1368, 1369, 1370, 1371, 1372, 1373, 1374, 1375, 1379, 1380, 1383],
    'light.pasillo2': [898, 899, 900, 904, 905, 906, 907, 911, 912, 913, 914, 915, 916, 917, 918, 919, 962, 983, 1026, 1047, 1048, 1049, 1050, 1051, 1055, 1056, 1057, 1058, 1059, 1060, 1063, 1090, 1127, 1154, 1191, 1218, 1255, 1282, 1319, 1346, 1347, 1348, 1349, 1350, 1351, 1352, 1353, 1354, 1355, 1356, 1357, 1360, 1361, 1362, 1363, 1364, 1365, 1366, 1367, 1368, 1369, 1370, 1371, 1372, 1373, 1374, 1375, 1379, 1380, 1383]
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
            zone.entity_ids.forEach(eid => callService('light', service, { entity_id: eid }));
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
                const r1 = Math.floor(current / 64), c1 = current % 64;
                const r2 = Math.floor(previous / 64), c2 = previous % 64;
                // Manhattan distance of 1 means they are immediate neighbors (up, down, left, right)
                const isAdjacent = Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1;

                if (!isAdjacent) {
                    segments.push(currentSegment);
                    currentSegment = [];
                }
            }
            currentSegment.push(current);
        }
        if (currentSegment.length > 0) segments.push(currentSegment);

        // Render each contiguous segment as a polyline
        segments.forEach(seg => {
            if (seg.length === 0) return;
            const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
            const points = seg.map(cid => {
                const x = (cid % 64) * (100 / 64) + (100 / 128); // Cell center X
                const y = Math.floor(cid / 64) * (100 / 64) + (100 / 128); // Cell center Y
                return `${x},${y}`;
            }).join(' ');

            polyline.setAttribute('points', points);
            polyline.setAttribute('fill', 'none');
            // If only one cell, make it a dot-like stroke
            if (seg.length === 1) {
                polyline.setAttribute('stroke-linecap', 'round');
            }
            g.appendChild(polyline);
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
    initDynamicLayers();
    connectWebSocket();
} else {
    window.location.href = 'index.html';
}
