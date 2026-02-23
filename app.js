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

        // Categorized Entities
        this.categories = {
            lights: [],
            climate: [],
            energy: [],
            security: [],
            media: [],
            sensors: [],
            others: []
        };

        // Rooms map: area_id -> { name, entities: [] }
        this.rooms = {};

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
            rooms: 'Habitaciones',
            climate: 'Climatización',
            energy: 'Energía',
            media: 'Multimedia',
            security: 'Seguridad'
        };
        document.getElementById('view-title').innerText = titles[viewId] || 'HOMA OS';

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
                this.areas.forEach(a => { this.rooms[a.area_id] = { name: a.name, entities: [], activeCount: 0 }; });
            }
            this.send({ type: "config/device_registry/list", id: 101 });
        } else if (data.id === 101) {
            if (data.success) this.deviceReg = data.result;
            this.send({ type: "config/entity_registry/list", id: 102 });
        } else if (data.id === 102) {
            if (data.success) this.entityReg = data.result;
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
    // State Updates & Classification
    // ==========================================
    handleInitialStates(statesArray) {
        this.states = {};
        statesArray.forEach(stateObj => {
            this.states[stateObj.entity_id] = {
                s: stateObj.state,
                a: stateObj.attributes || {}
            };
        });

        this.classifyEntities();
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
        if (domain === 'light' && oldState !== newState) {
            const regEntry = this.entityReg.find(e => e.entity_id === entityId);
            const areaId = regEntry ? regEntry.area_id : 'unassigned';

            if (this.rooms[areaId]) {
                if (newState === 'on' && oldState !== 'on') this.rooms[areaId].activeCount++;
                else if (newState !== 'on' && oldState === 'on') this.rooms[areaId].activeCount = Math.max(0, this.rooms[areaId].activeCount - 1);
            }

            const activeView = document.querySelector('.nav-item.active');
            const viewId = activeView ? activeView.getAttribute('data-view') : '';
            if (viewId === 'home' || viewId === 'rooms') {
                this.renderCurrentView();
            }
        }
    }

    // El Motor Inteligente: Agrupa entidades sin hacer hardcoding
    classifyEntities() {
        // Reset categories
        for (let key in this.categories) this.categories[key] = [];
        this.rooms = {};
        this.areas.forEach(a => { this.rooms[a.area_id] = { name: a.name, entities: [], activeCount: 0 }; });

        const self = this;

        Object.keys(this.states).forEach(entityId => {
            const domain = entityId.split('.')[0];
            const regEntry = this.entityReg.find(e => e.entity_id === entityId);

            if (regEntry && (regEntry.disabled_by || regEntry.hidden_by)) return; // Skip hidden/disabled

            const getAttr = () => self.states[entityId].a || {};
            const deviceClass = getAttr().device_class || (regEntry ? regEntry.original_device_class : '') || '';
            const areaId = (regEntry ? regEntry.area_id : '') || 'unassigned';

            // Build Unified Entity Object
            const entity = {
                id: entityId,
                domain: domain,
                get state() { return self.states[entityId] ? self.states[entityId].s : ''; },
                get attributes() { return self.states[entityId] ? self.states[entityId].a || {} : {}; },
                get name() { return this.attributes.friendly_name || (regEntry ? regEntry.original_name : '') || entityId; },
                areaId: areaId,
                deviceClass: deviceClass
            };

            // 1. Assign to Area/Room
            if (entity.areaId !== 'unassigned' && this.rooms[entity.areaId]) {
                this.rooms[entity.areaId].entities.push(entity);
                if (domain === 'light' && entity.state === 'on') {
                    this.rooms[entity.areaId].activeCount++;
                }
            }

            // 2. Assign to Category (Intelligent logic)
            if (domain === 'light' || domain === 'switch') {
                this.categories.lights.push(entity);
            }
            else if (domain === 'climate' || (domain === 'sensor' && ['temperature', 'humidity'].includes(deviceClass))) {
                this.categories.climate.push(entity);
            }
            else if (domain === 'sensor' && ['power', 'energy', 'battery', 'current', 'voltage'].includes(deviceClass)) {
                this.categories.energy.push(entity);
            }
            else if (domain === 'alarm_control_panel' || domain === 'lock' ||
                (domain === 'binary_sensor' && ['motion', 'door', 'window', 'presence'].includes(deviceClass))) {
                this.categories.security.push(entity);
            }
            else if (domain === 'media_player') {
                this.categories.media.push(entity);
            }
            else {
                this.categories.others.push(entity);
            }
        });

        console.log("OS Categorization Complete", this.categories, this.rooms);
    }

    // ==========================================
    // Dynamic Rendering System
    // ==========================================
    renderCurrentView() {
        const activeNav = document.querySelector('.nav-item.active');
        if (!activeNav) return;
        const viewId = activeNav.getAttribute('data-view');

        if (viewId === 'home') this.renderHome();
        else if (viewId === 'rooms') this.renderRooms();
        else if (viewId === 'energy') this.renderCategory('energy', 'energy-container');
        else if (viewId === 'climate') this.renderCategory('climate', 'climate-container');
        else if (viewId === 'security') this.renderCategory('security', 'security-container');
        else if (viewId === 'media') this.renderCategory('media', 'media-container');

        lucide.createIcons();
    }

    // 1. HOME VIEW (Resumen Inteligente)
    renderHome() {
        const container = document.getElementById('home-summaries');
        if (!container) return;

        container.innerHTML = '';

        // Luces Activas
        const activeLights = this.categories.lights.filter(l => l.domain === 'light' && l.state === 'on');
        container.appendChild(this.createSummaryCard(
            'Luces Encendidas',
            activeLights.length.toString(),
            'lightbulb',
            activeLights.length > 0 ? 'var(--accent-yellow)' : 'var(--text-secondary)'
        ));

        // Clima Activo
        const activeClimate = this.categories.climate.filter(c => c.domain === 'climate' && c.state !== 'off');
        container.appendChild(this.createSummaryCard(
            'Climatización',
            activeClimate.length > 0 ? 'Activo' : 'Apagado',
            'thermometer',
            activeClimate.length > 0 ? 'var(--accent-blue)' : 'var(--text-secondary)'
        ));

        // Batería Victron (if exists)
        const batSensor = this.categories.energy.find(e => e.id.includes('victron_battery_soc'));
        if (batSensor) {
            container.appendChild(this.createSummaryCard(
                'Batería Casa',
                `${batSensor.state}%`,
                'battery-charging',
                parseFloat(batSensor.state) > 20 ? 'var(--accent-green)' : 'var(--accent-red)'
            ));
        }

        // Alarma
        const alarm = this.categories.security.find(e => e.domain === 'alarm_control_panel');
        if (alarm) {
            container.appendChild(this.createSummaryCard(
                'Seguridad',
                alarm.state === 'disarmed' ? 'Desarmada' : 'ARMADA',
                'shield',
                alarm.state === 'disarmed' ? 'var(--accent-green)' : 'var(--accent-red)'
            ));
        }
    }

    createSummaryCard(title, value, icon, color) {
        const div = document.createElement('div');
        div.className = 'widget';
        div.style.flexDirection = 'column';
        div.style.alignItems = 'flex-start';
        div.style.padding = '1.5rem';
        div.innerHTML = `
            <i data-lucide="${icon}" style="color: ${color}; width: 32px; height: 32px; margin-bottom: 1rem;"></i>
            <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary);">${value}</div>
            <div style="font-size: 0.9rem; color: var(--text-secondary);">${title}</div>
        `;
        return div;
    }

    // 2. ROOMS VIEW
    renderRooms() {
        const container = document.getElementById('rooms-container');
        if (!container) return;
        container.innerHTML = '';

        Object.values(this.rooms).forEach(room => {
            if (room.entities.length === 0) return;

            // Only pick a subset of useful entities for the room card (lights, climate) to avoid clutter
            const displayEntities = room.entities.filter(e =>
                ['light', 'switch', 'climate', 'media_player'].includes(e.domain)
            );

            if (displayEntities.length === 0) return;

            const roomCard = document.createElement('div');
            roomCard.className = 'room-card';
            roomCard.innerHTML = `
                <div class="room-header">
                    <i data-lucide="home"></i>
                    <h3>${room.name}</h3>
                    <span style="margin-left:auto; font-size:0.8rem; color:var(--text-secondary)">
                        ${room.activeCount} encendido
                    </span>
                </div>
                <div class="room-entities"></div>
            `;

            const entitiesContainer = roomCard.querySelector('.room-entities');
            displayEntities.forEach(e => {
                const card = this.createEntityCard(e);
                entitiesContainer.appendChild(card);
            });

            container.appendChild(roomCard);
        });
    }

    // Generic Category Renderer
    renderCategory(categoryName, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        const entities = this.categories[categoryName];
        if (entities.length === 0) {
            container.innerHTML = `<div class="loading-state">No hay entidades disponibles de este tipo.</div>`;
            return;
        }

        entities.forEach(e => {
            container.appendChild(this.createEntityCard(e));
        });
    }

    // ==========================================
    // Component Builders
    // ==========================================
    createEntityCard(entity) {
        if (entity.domain === 'light' || entity.domain === 'switch') return this.buildToggleCard(entity);
        if (entity.domain === 'media_player') return this.buildMediaCard(entity);
        return this.buildSensorCard(entity); // fallback
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

    buildSensorCard(entity) {
        const tpl = document.getElementById('tpl-card-sensor');
        const clone = tpl.content.cloneNode(true);
        const card = clone.querySelector('.entity-card');

        card.id = `card-${entity.id.replace(/\./g, '-')}`;

        let icon = 'activity';
        if (entity.deviceClass === 'temperature') icon = 'thermometer';
        else if (entity.deviceClass === 'power') icon = 'zap';
        else if (entity.deviceClass === 'battery') icon = 'battery';
        else if (entity.domain === 'alarm_control_panel') icon = 'shield';

        clone.querySelector('.entity-icon i').setAttribute('data-lucide', icon);
        clone.querySelector('.entity-name').textContent = entity.name;

        const valSpan = clone.querySelector('.entity-value span');
        valSpan.textContent = isNaN(entity.state) ? entity.state : parseFloat(entity.state).toFixed(1);

        const unit = clone.querySelector('small');
        unit.textContent = entity.attributes.unit_of_measurement || '';

        // Add colors for alarm states
        if (entity.domain === 'alarm_control_panel') {
            if (entity.state !== 'disarmed') {
                card.style.borderColor = 'rgba(239, 68, 68, 0.5)';
                card.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.2)';
            } else {
                card.style.borderColor = 'rgba(74, 222, 128, 0.5)';
            }
        }

        return clone;
    }

    buildMediaCard(entity) {
        const tpl = document.getElementById('tpl-card-media');
        const clone = tpl.content.cloneNode(true);
        const card = clone.querySelector('.entity-card');

        card.id = `card-${entity.id.replace(/\./g, '-')}`;
        clone.querySelector('.entity-name').textContent = entity.name;

        if (entity.state === 'playing' || entity.state === 'paused') {
            const title = entity.attributes.media_title || entity.state;
            const artist = entity.attributes.media_artist || '';
            clone.querySelector('.media-title').textContent = `${title} ${artist ? '- ' + artist : ''}`;

            if (entity.attributes.entity_picture) {
                const bg = clone.querySelector('.media-artwork');
                bg.style.display = 'block';
                bg.style.backgroundImage = `url(${this.haUrl}${entity.attributes.entity_picture})`;
            }
        }

        const playBtn = clone.querySelector('.media-play-pause');
        playBtn.addEventListener('click', () => {
            this.send({ type: "call_service", domain: "media_player", service: "media_play_pause", target: { entity_id: entity.id } });
        });

        return clone;
    }

    // In-place UI Update to avoid full re-render on every state change
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
        else if (domain === 'sensor' || domain === 'climate' || domain === 'alarm_control_panel') {
            const valSpan = card.querySelector('.entity-value span');
            if (valSpan) valSpan.textContent = isNaN(state) ? state : parseFloat(state).toFixed(1);
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
