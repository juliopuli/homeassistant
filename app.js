import CONFIG from './config.js';

class HomeAssistantDashboard {
    constructor() {
        this.socket = null;
        this.msgId = 1;
        this.entities = {};
        this.areas = [];
        this.haUrl = localStorage.getItem('ha_url') || CONFIG.HA_URL;
        this.accessToken = localStorage.getItem('ha_access_token');
        this.refreshToken = localStorage.getItem('ha_refresh_token');

        this.init();
    }

    init() {
        this.setupNavigation();
        this.checkAuthCode();
        if (!this.accessToken) {
            this.showLogin();
        } else {
            this.connect();
        }

        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.startAuthFlow();
        });
    }

    setupNavigation() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const view = item.getAttribute('data-view');
                this.switchView(view);

                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
            });
        });
    }

    switchView(viewId) {
        document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
        const targetView = document.getElementById(`view-${viewId}`);
        if (targetView) targetView.classList.add('active');

        const titles = {
            overview: 'Resumen General',
            energy: 'Estado de Energía',
            climate: 'Climatización',
            security: 'Seguridad y Presencia',
            lights: 'Iluminación por Habitaciones'
        };
        document.getElementById('view-title').innerText = titles[viewId] || 'Homa Dashboard';

        if (viewId === 'lights') {
            this.renderLights();
        }
    }

    checkAuthCode() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        if (code) {
            window.history.replaceState({}, document.title, window.location.pathname);
            this.exchangeCode(code);
        }
    }

    showLogin() {
        document.getElementById('login-overlay').classList.add('active');
    }

    startAuthFlow() {
        const url = document.getElementById('ha-url').value;
        if (!url) return;
        localStorage.setItem('ha_url', url);
        this.haUrl = url;
        const clientId = window.location.origin + window.location.pathname;
        const redirectUri = window.location.origin + window.location.pathname;
        const authUrl = `${url}/auth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
        window.location.href = authUrl;
    }

    async exchangeCode(code) {
        const url = this.haUrl;
        const clientId = window.location.origin + window.location.pathname;
        try {
            const response = await fetch(`${url}/auth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ grant_type: 'authorization_code', code: code, client_id: clientId })
            });
            const data = await response.json();
            if (data.access_token) {
                this.saveTokens(data);
                this.connect();
                document.getElementById('login-overlay').classList.remove('active');
            }
        } catch (err) {
            console.error('Error exchanging code:', err);
        }
    }

    saveTokens(data) {
        this.accessToken = data.access_token;
        this.refreshToken = data.refresh_token;
        localStorage.setItem('ha_access_token', this.accessToken);
        localStorage.setItem('ha_refresh_token', this.refreshToken);
    }

    async refreshTokens() {
        const clientId = window.location.origin + window.location.pathname;
        try {
            const response = await fetch(`${this.haUrl}/auth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.refreshToken, client_id: clientId })
            });
            const data = await response.json();
            if (data.access_token) {
                this.saveTokens(data);
                return true;
            }
        } catch (err) {
            console.error('Error refreshing token:', err);
        }
        return false;
    }

    getWsUrl() {
        const url = new URL(this.haUrl);
        return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/api/websocket`;
    }

    connect() {
        const wsUrl = this.getWsUrl();
        this.socket = new WebSocket(wsUrl);
        this.socket.onopen = () => console.log('WS Connected');
        this.socket.onmessage = (event) => this.handleMessage(JSON.parse(event.data));
        this.socket.onerror = (err) => console.error('WS Error:', err);
        this.socket.onclose = () => setTimeout(() => this.connect(), 5000);
    }

    async handleMessage(data) {
        if (data.type === 'auth_required') {
            this.send({ type: 'auth', access_token: this.accessToken });
        } else if (data.type === 'auth_ok') {
            document.getElementById('connection-status').innerHTML = '<i data-lucide="check-circle" style="width:14px"></i> Conectado';
            lucide.createIcons();
            this.fetchInitialData();
        } else if (data.type === 'auth_invalid') {
            const success = await this.refreshTokens();
            if (success) this.connect();
            else { localStorage.clear(); location.reload(); }
        } else if (data.type === 'event' && data.event.variables) {
            this.updateBulk(data.event.variables);
        } else if (data.type === 'event' && data.event.a) {
            this.updateIncremental(data.event.a);
        } else if (data.id === 100 && data.success) { // Area Registry
            this.areas = data.result;
            this.fetchEntitiesRegistry();
        } else if (data.id === 101 && data.success) { // Entity Registry
            this.entityRegistry = data.result;
            this.subscribe();
        }
    }

    send(msg) {
        if (msg.type !== 'auth') msg.id = this.msgId++;
        this.socket.send(JSON.stringify(msg));
    }

    fetchInitialData() {
        this.send({ type: "config/area_registry/list", id: 100 });
    }

    fetchEntitiesRegistry() {
        this.send({ type: "config/entity_registry/list", id: 101 });
    }

    subscribe() {
        this.send({
            type: "subscribe_entities"
        });
    }

    updateBulk(variables) {
        Object.keys(variables).forEach(id => {
            this.entities[id] = variables[id];
            this.renderEntity(id, variables[id]);
        });
        if (document.getElementById('view-lights').classList.contains('active')) {
            this.renderLights();
        }
    }

    updateIncremental(changes) {
        Object.keys(changes).forEach(id => {
            if (!this.entities[id]) this.entities[id] = {};
            Object.assign(this.entities[id], changes[id]);
            this.renderEntity(id, this.entities[id]);
        });
        if (document.getElementById('view-lights').classList.contains('active')) {
            this.renderLights();
        }
    }

    renderLights() {
        const container = document.getElementById('lights-container');
        if (!container) return;

        // Group entities by area
        const lightsByArea = {};

        Object.keys(this.entities).forEach(entityId => {
            if (entityId.startsWith('light.')) {
                const regEntry = this.entityRegistry?.find(e => e.entity_id === entityId);
                const areaId = regEntry?.area_id || 'Otros';
                const area = this.areas.find(a => a.area_id === areaId);
                const areaName = area ? area.name : areaId;

                if (!lightsByArea[areaName]) lightsByArea[areaName] = [];
                lightsByArea[areaName].push({
                    id: entityId,
                    name: (this.entities[entityId].a && this.entities[entityId].a.friendly_name) || entityId,
                    state: this.entities[entityId].s
                });
            }
        });

        if (Object.keys(lightsByArea).length === 0) return;

        container.innerHTML = '';
        Object.keys(lightsByArea).sort().forEach(areaName => {
            const roomCard = document.createElement('div');
            roomCard.className = 'room-card';
            roomCard.innerHTML = `
                <div class="room-header"><i data-lucide="home"></i> ${areaName}</div>
                <div class="lights-list">
                    ${lightsByArea[areaName].map(light => `
                        <div class="light-item">
                            <div class="light-info">
                                <span class="light-name">${light.name}</span>
                            </div>
                            <label class="switch">
                                <input type="checkbox" ${light.state === 'on' ? 'checked' : ''} 
                                    onchange="window.dashboard.toggleLight('${light.id}', this.checked)">
                                <span class="slider"></span>
                            </label>
                        </div>
                    `).join('')}
                </div>
            `;
            container.appendChild(roomCard);
        });
        lucide.createIcons();
    }

    toggleLight(entityId, state) {
        this.send({
            type: "call_service",
            domain: "light",
            service: state ? "turn_on" : "turn_off",
            target: { entity_id: entityId }
        });
    }

    renderEntity(id, data) {
        const state = data.s;
        switch (id) {
            case 'sensor.victron_battery_soc': if (document.getElementById('bat-soc')) document.getElementById('bat-soc').innerText = state; break;
            case 'sensor.victron_battery_voltage': if (document.getElementById('bat-volts')) document.getElementById('bat-volts').innerText = state; break;
            case 'sensor.victron_solar_power': if (document.getElementById('solar-power')) document.getElementById('solar-power').innerText = state; break;
            case 'climate.aire_lg':
                if (document.getElementById('current-temp')) document.getElementById('current-temp').innerText = (data.a && data.a.current_temperature) || '--';
                if (document.getElementById('target-temp')) document.getElementById('target-temp').innerText = (data.a && data.a.temperature) || '--';
                break;
            case 'sensor.wallbox_pulsar_max_sn_899342_potencia_de_carga': if (document.getElementById('charge-power')) document.getElementById('charge-power').innerText = (parseFloat(state) / 1000).toFixed(1); break;
            case 'alarm_control_panel.alarmo':
                const alState = document.getElementById('alarmo-state');
                if (alState) {
                    alState.innerText = state.toUpperCase();
                    document.getElementById('alarmo-card').style.borderColor = state === 'disarmed' ? 'rgba(74, 222, 128, 0.3)' : 'rgba(239, 68, 68, 0.5)';
                }
                break;
            case 'person.julio_pulido': if (document.getElementById('person-julio')) document.getElementById('person-julio').innerText = state === 'home' ? 'En Casa' : state; break;
            case 'person.azahar_pedroche': if (document.getElementById('person-azahar')) document.getElementById('person-azahar').innerText = state === 'home' ? 'En Casa' : state; break;
        }
    }
}

window.dashboard = new HomeAssistantDashboard();
