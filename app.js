import CONFIG from './config.js';

class HomaOS {
    constructor() {
        this.socket = null;
        this.msgId = 1;

        // Data Stores
        this.states = {};
        this.areas = [];
        this.entityReg = [];
        this.deviceReg = [];

        // Phase 1: Robust Room & Light Mapping
        this.rooms = {};
        this.activeLightsCount = 0;

        // Auth
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
        document.querySelectorAll('.view-section').forEach(view => view.classList.remove('active'));
        const targetView = document.getElementById(`view-${viewId}`);
        if (targetView) targetView.classList.add('active');

        const titles = {
            home: 'Vista General',
            rooms: 'Habitaciones (Luces)'
        };
        document.getElementById('view-title').innerText = titles[viewId] || 'HOMA - Habitaciones';

        this.renderCurrentView();
    }

    // ==========================================
    // Autenticación (OAuth Real)
    // ==========================================
    checkAuthCode() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        if (code) {
            window.history.replaceState({}, document.title, window.location.pathname);
            this.exchangeCode(code);
        }

        document.getElementById('btn-logout').addEventListener('click', () => {
            localStorage.clear();
            location.reload();
        });
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

    // ==========================================
    // Conexión y Descubrimiento WebSockets
    // ==========================================
    getWsUrl() {
        const url = new URL(this.haUrl);
        return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/api/websocket`;
    }

    connect() {
        const wsUrl = this.getWsUrl();
        this.socket = new WebSocket(wsUrl);
        this.socket.onopen = () => console.log('WS Connected');
        this.socket.onerror = (err) => this.setStatus('error', 'Error de conexión');
        this.socket.onclose = () => {
            this.setStatus('error', 'Desconectado');
            setTimeout(() => this.connect(), 5000);
        };

        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };
    }

    setStatus(state, text) {
        const dot = document.getElementById('connection-dot');
        const txt = document.getElementById('connection-text');
        if (!dot || !txt) return;

        dot.className = 'dot';
        if (state === 'ok') dot.classList.add('connected');
        if (state === 'error') dot.classList.add('error');
        if (state === 'connecting') dot.classList.add('connecting');
        txt.innerText = text;
    }

    async handleMessage(data) {
        if (data.type === 'auth_required') {
            this.send({ type: 'auth', access_token: this.accessToken });
        } else if (data.type === 'auth_ok') {
            this.setStatus('ok', 'Conectado a HOMA');
            this.fetchCoreRegistries();
        } else if (data.type === 'auth_invalid') {
            const success = await this.refreshTokens();
            if (success) this.connect();
            else { localStorage.clear(); location.reload(); }
        } else if (data.id === 100) {
            if (data.success) {
                this.areas = data.result;
            }
            this.send({ type: "config/device_registry/list", id: 101 });
        } else if (data.id === 101) {
            if (data.success) {
                this.deviceReg = data.result;
            }
            this.send({ type: "config/entity_registry/list", id: 102 });
        } else if (data.id === 102) {
            if (data.success) {
                this.entityReg = data.result;
            }
            this.send({ type: "get_states", id: 103 });
        } else if (data.id === 103 && data.success) {
            this.handleInitialStates(data.result);
            this.send({ type: "subscribe_events", event_type: "state_changed", id: 104 });
        } else if (data.type === 'event' && data.event && data.event.event_type === 'state_changed') {
            this.handleStateChange(data.event.data.new_state);
        }
    }

    send(msg) {
        if (msg.type !== 'auth') {
            if (msg.id === undefined) {
                msg.id = this.msgId++;
            }
        }
        this.socket.send(JSON.stringify(msg));
    }

    fetchCoreRegistries() {
        this.send({ type: "config/area_registry/list", id: 100 });
    }

    // ==========================================
    // Phase 1: Robust Room & Light Mapping
    // ==========================================
    handleInitialStates(statesArray) {
        this.states = {};
        statesArray.forEach(stateObj => {
            this.states[stateObj.entity_id] = {
                s: stateObj.state,
                a: stateObj.attributes || {}
            };
        });

        this.buildRooms();
        this.renderCurrentView();
    }

    handleStateChange(newStateObj) {
        if (!newStateObj) return;
        const entityId = newStateObj.entity_id;
        const oldState = this.states[entityId] ? this.states[entityId].s : null;
        const newState = newStateObj.state;

        this.states[entityId] = {
            s: newStateObj.state,
            a: newStateObj.attributes || {}
        };

        this.updateCardUI(entityId);

        const domain = entityId.split('.')[0];
        if ((domain === 'light' || domain === 'switch') && oldState !== newState) {
            // Update active count
            if (newState === 'on' && oldState !== 'on') this.activeLightsCount++;
            else if (newState !== 'on' && oldState === 'on') this.activeLightsCount = Math.max(0, this.activeLightsCount - 1);

            const activeView = document.querySelector('.nav-item.active');
            const viewId = activeView ? activeView.getAttribute('data-view') : '';
            if (viewId === 'home') {
                this.renderHome();
            }
        }
    }

    buildRooms() {
        this.rooms = {};
        this.activeLightsCount = 0;

        // Create Area Dict for fast lookup
        const areaDict = {};
        this.areas.forEach(a => { areaDict[a.area_id] = a.name; });

        // Device -> Area mapping
        const deviceToArea = {};
        this.deviceReg.forEach(d => {
            if (d.area_id) deviceToArea[d.id] = d.area_id;
        });

        // Parse entities
        Object.keys(this.states).forEach(entityId => {
            const domain = entityId.split('.')[0];

            // Phase 1 Focus: Only lights and switches
            if (domain !== 'light' && domain !== 'switch') return;

            const stateObj = this.states[entityId];
            const regEntry = this.entityReg.find(e => e.entity_id === entityId);

            // Skip disabled/hidden entities
            if (regEntry && (regEntry.disabled_by || regEntry.hidden_by)) return;

            let areaId = 'unassigned';

            // 1. Try Area from Entity
            if (regEntry && regEntry.area_id) {
                areaId = regEntry.area_id;
            }
            // 2. Try Area from Device
            else if (regEntry && regEntry.device_id && deviceToArea[regEntry.device_id]) {
                areaId = deviceToArea[regEntry.device_id];
            }

            const roomName = areaId !== 'unassigned' && areaDict[areaId] ? areaDict[areaId] : 'Generales (Sin Habitación)';
            let name = (stateObj.a && stateObj.a.friendly_name) || (regEntry ? regEntry.original_name : '') || entityId;

            if (!this.rooms[roomName]) {
                this.rooms[roomName] = [];
            }

            this.rooms[roomName].push({
                id: entityId,
                domain: domain,
                name: name,
                state: stateObj.s
            });

            if (stateObj.s === 'on') {
                this.activeLightsCount++;
            }
        });
        console.log("Phase 1 Room Mapping complete:", this.rooms);
    }

    // ==========================================
    // Rendering
    // ==========================================
    renderCurrentView() {
        const activeNav = document.querySelector('.nav-item.active');
        if (!activeNav) return;
        const viewId = activeNav.getAttribute('data-view');

        if (viewId === 'home') this.renderHome();
        else if (viewId === 'rooms') this.renderRooms();

        lucide.createIcons();
    }

    renderHome() {
        const container = document.getElementById('home-summaries');
        if (!container) return;
        container.innerHTML = '';

        const div = document.createElement('div');
        div.className = 'widget';
        div.style.flexDirection = 'column';
        div.style.alignItems = 'flex-start';
        div.style.padding = '1.5rem';

        const color = this.activeLightsCount > 0 ? 'var(--accent-yellow)' : 'var(--text-secondary)';
        div.innerHTML = `
            <i data-lucide="lightbulb" style="color: ${color}; width: 32px; height: 32px; margin-bottom: 1rem;"></i>
            <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary);">${this.activeLightsCount}</div>
            <div style="font-size: 0.9rem; color: var(--text-secondary);">Luces Encendidas</div>
        `;

        container.appendChild(div);
    }

    renderRooms() {
        const container = document.getElementById('rooms-container');
        if (!container) return;
        container.innerHTML = '';

        // Sort rooms: Generales last
        const sortedRoomNames = Object.keys(this.rooms).sort((a, b) => {
            if (a.includes('Sin Habitación')) return 1;
            if (b.includes('Sin Habitación')) return -1;
            return a.localeCompare(b);
        });

        sortedRoomNames.forEach(roomName => {
            const lights = this.rooms[roomName];
            if (lights.length === 0) return;

            const roomCard = document.createElement('div');
            roomCard.className = 'room-card';
            roomCard.innerHTML = `
                <div class="room-header">
                    <i data-lucide="home"></i>
                    <h3>${roomName}</h3>
                </div>
                <div class="room-entities"></div>
            `;

            const entitiesContainer = roomCard.querySelector('.room-entities');

            lights.forEach(entity => {
                const card = this.buildToggleCard(entity);
                entitiesContainer.appendChild(card);
            });

            container.appendChild(roomCard);
        });
    }

    buildToggleCard(entity) {
        const tpl = document.getElementById('tpl-card-light');
        const clone = tpl.content.cloneNode(true);
        const card = clone.querySelector('.entity-card');

        card.id = `card-${entity.id.replace(/\./g, '-')}`;
        if (entity.state === 'on') card.classList.add('state-on');

        clone.querySelector('.entity-name').textContent = entity.name;
        clone.querySelector('.entity-state').textContent = entity.state === 'on' ? 'Encendido' : 'Apagado';

        const checkbox = clone.querySelector('input');
        checkbox.checked = entity.state === 'on';
        checkbox.addEventListener('change', (e) => this.toggleService(entity.domain, entity.id, e.target.checked));

        return clone;
    }

    updateCardUI(entityId) {
        const stateObj = this.states[entityId];
        if (!stateObj) return;

        const card = document.getElementById(`card-${entityId.replace(/\./g, '-')}`);
        if (!card) return;

        const domain = entityId.split('.')[0];
        const state = stateObj.s;

        if (domain === 'light' || domain === 'switch') {
            const checkbox = card.querySelector('input[type="checkbox"]');
            const stateText = card.querySelector('.entity-state');
            if (checkbox) checkbox.checked = (state === 'on');
            if (stateText) stateText.textContent = state === 'on' ? 'Encendido' : 'Apagado';

            if (state === 'on') card.classList.add('state-on');
            else card.classList.remove('state-on');
        }
    }

    // ==========================================
    // Services Action
    // ==========================================
    toggleService(domain, entityId, targetState) {
        this.send({
            type: "call_service",
            domain: domain,
            service: targetState ? "turn_on" : "turn_off",
            target: { entity_id: entityId }
        });
    }
}

window.homaOS = new HomaOS();
