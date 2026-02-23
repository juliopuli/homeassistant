import CONFIG from './config.js';

class HomeAssistantDashboard {
    constructor() {
        this.socket = null;
        this.msgId = 1;
        this.entities = {};
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

                // Update active state in UI
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
            security: 'Seguridad y Presencia'
        };
        document.getElementById('view-title').innerText = titles[viewId] || 'Homa Dashboard';
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
            this.subscribe();
        } else if (data.type === 'auth_invalid') {
            const success = await this.refreshTokens();
            if (success) this.connect();
            else { localStorage.clear(); location.reload(); }
        } else if (data.type === 'event' && data.event.variables) {
            this.updateBulk(data.event.variables);
        } else if (data.type === 'event' && data.event.a) {
            this.updateIncremental(data.event.a);
        }
    }

    send(msg) {
        if (msg.type !== 'auth') msg.id = this.msgId++;
        this.socket.send(JSON.stringify(msg));
    }

    subscribe() {
        this.send({
            type: "subscribe_entities",
            entity_ids: [
                "sensor.victron_battery_soc", "sensor.victron_battery_voltage", "sensor.victron_solar_power",
                "climate.aire_lg", "sensor.wallbox_pulsar_max_sn_899342_potencia_de_carga",
                "lock.wallbox_pulsar_max_sn_899342_cerradura", "alarm_control_panel.alarmo",
                "person.julio_pulido", "person.azahar_pedroche"
            ]
        });
    }

    updateBulk(variables) { Object.keys(variables).forEach(id => { this.entities[id] = variables[id]; this.renderEntity(id, variables[id]); }); }
    updateIncremental(changes) { Object.keys(changes).forEach(id => { if (!this.entities[id]) this.entities[id] = {}; Object.assign(this.entities[id], changes[id]); this.renderEntity(id, this.entities[id]); }); }

    renderEntity(id, data) {
        const state = data.s;
        switch (id) {
            case 'sensor.victron_battery_soc': document.getElementById('bat-soc').innerText = state; break;
            case 'sensor.victron_battery_voltage': if (document.getElementById('bat-volts')) document.getElementById('bat-volts').innerText = state; break;
            case 'sensor.victron_solar_power': document.getElementById('solar-power').innerText = state; break;
            case 'climate.aire_lg':
                document.getElementById('current-temp').innerText = (data.a && data.a.current_temperature) || '--';
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
            case 'person.julio_pulido': document.getElementById('person-julio').innerText = state === 'home' ? 'En Casa' : state; break;
            case 'person.azahar_pedroche': document.getElementById('person-azahar').innerText = state === 'home' ? 'En Casa' : state; break;
        }
    }
}

new HomeAssistantDashboard();
