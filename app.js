

class HomaOS {
    constructor() {
        this.socket = null;
        this.msgId = 200;

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

                // IMPORTANT: Set active class first so switchView knows what to render
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                this.switchView(view);
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
    // Visual Debugging (Toasts)
    // ==========================================
    showToast(msg, isError = false) {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.position = 'fixed';
            container.style.bottom = '20px';
            container.style.left = '50%';
            container.style.transform = 'translateX(-50%)';
            container.style.zIndex = '9999';
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '10px';
            container.style.pointerEvents = 'none'; // Don't block clicks
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.textContent = msg;
        toast.style.background = isError ? 'rgba(239, 68, 68, 0.9)' : 'rgba(20, 20, 20, 0.9)';
        toast.style.color = '#fff';
        toast.style.padding = '12px 24px';
        toast.style.borderRadius = '8px';
        toast.style.border = isError ? '1px solid #fca5a5' : '1px solid var(--accent-blue)';
        toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
        toast.style.fontSize = '14px';
        toast.style.transition = 'opacity 0.3s ease';

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
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
        const clientId = window.location.origin === "null" ? "https://homa.local" : window.location.origin + window.location.pathname;

        // Home Assistant OAuth requires a valid HTTP/HTTPS redirect URI or a special OOB URI.
        // If we are on file:// (origin is "null"), we must use a trick or fallback to a hosted page.
        // Since OOB might require manual copy-paste of the code which isn't implemented in this UI,
        // we'll try to forge a fake HTTPS redirect URI and tell the user they must host it if this fails,
        // OR simply rely on the fact that for "file://", we actually need a properly registered redirect.
        // Actually, for local file, we can just pass the HA url itself as redirect URI to see if it bounces back,
        // but it won't bounce back to file://.

        // The best approach for a local file app in HA is to use the App's own domain if available, 
        // but since this is completely local:
        let redirectUri = window.location.href;
        if (window.location.protocol === 'file:') {
            // HA strict OAuth: Cannot redirect to file://
            // We tell the user via an alert that they need a local server.
            alert("Error: Home Assistant no permite autenticación OAuth desde un archivo local (file://). Debes abrir este archivo a través de un servidor web local (ej. Live Server de VSCode, o localhost), o alojarlo en un dominio.");
            return;
        }

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
        // Intercept HA Errors sent back to us
        if (data.type === 'result' && !data.success && data.error) {
            this.showToast(`Error HA: ${data.error.message}`, true);
            console.error("HA Comm Error:", data);
        }

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
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(msg));
        } else {
            console.error('Cannot send payload, WebSocket not in OPEN state.');
        }
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
        if (domain === 'light' && oldState !== newState) {
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

            // Phase 1 Focus: ABSOLUTELY ONLY lights. No chaotic switches.
            if (domain !== 'light') return;

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

            let name = (stateObj.a && stateObj.a.friendly_name) || (regEntry ? regEntry.original_name : '') || entityId;
            let roomName = areaId !== 'unassigned' && areaDict[areaId] ? areaDict[areaId] : null;

            // Intelligent Fallback: Guess room from entity name
            if (!roomName) {
                const textToParse = name.toLowerCase();
                const genericWords = ['luz', 'luces', 'light', 'foco', 'lampara', 'lámpara', 'techo', 'pared', 'tira', 'led', 'principal', 'secundaria'];
                const words = textToParse.split(/[\s_]+/);

                const roomWords = words.filter(w => !genericWords.includes(w) && w.length > 2);

                if (roomWords.length > 0) {
                    const guess = roomWords[0];
                    if (guess.includes('salon') || guess.includes('salón')) roomName = 'Salón';
                    else if (guess.includes('comed')) roomName = 'Comedor';
                    else if (guess.includes('coci')) roomName = 'Cocina';
                    else if (guess.includes('dorm') || guess.includes('hab')) roomName = 'Dormitorios';
                    else if (guess.includes('bañ') || guess.includes('aseo')) roomName = 'Baños';
                    else if (guess.includes('pasil') || guess.includes('entrad') || guess.includes('hall')) roomName = 'Pasillo y Entrada';
                    else if (guess.includes('terra') || guess.includes('patio') || guess.includes('jard') || guess.includes('balc')) roomName = 'Exterior';
                    else if (guess.includes('gara')) roomName = 'Garaje';
                    else if (guess.includes('estud') || guess.includes('despa')) roomName = 'Estudio';
                    else roomName = guess.charAt(0).toUpperCase() + guess.slice(1);
                } else {
                    roomName = 'Otras Luces';
                }
            }

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
        console.log("Phase 1 Intelligent Room Mapping complete:", this.rooms);
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

        // Sort rooms: Otras Luces last
        const sortedRoomNames = Object.keys(this.rooms).sort((a, b) => {
            if (a.includes('Otras Luces')) return 1;
            if (b.includes('Otras Luces')) return -1;
            return a.localeCompare(b);
        });

        sortedRoomNames.forEach(roomName => {
            // Sort lights alphabetically within the room
            const lights = this.rooms[roomName].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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

    getIconForLight(name) {
        if (!name) return 'lightbulb';
        const textToParse = name.toLowerCase();
        if (textToParse.includes('techo') || textToParse.includes('lámpara de techo')) return 'lamp-ceiling';
        if (textToParse.includes('mesita') || textToParse.includes('escritorio') || textToParse.includes('noche') || textToParse.includes('mesa')) return 'lamp-desk';
        if (textToParse.includes('pie') || textToParse.includes('suelo')) return 'lamp-floor';
        if (textToParse.includes('pared') || textToParse.includes('aplique')) return 'lamp-wall';
        if (textToParse.includes('tira') || textToParse.includes('led')) return 'minus'; // Alternatively, 'pipette' or 'lightbulb' if 'minus' is too generic, but lucide doesn't have a perfect "strip" icon. We will use 'wand-2' or 'sparkles' for leds
        if (textToParse.includes('espejo') || textToParse.includes('baño')) return 'sparkles';
        if (textToParse.includes('foco')) return 'flashlight';
        if (textToParse.includes('exterior') || textToParse.includes('jardín') || textToParse.includes('patio')) return 'sun-dim';

        return 'lightbulb';
    }

    buildToggleCard(entity) {
        const tpl = document.getElementById('tpl-card-light');
        const clone = tpl.content.cloneNode(true);
        const card = clone.querySelector('.entity-card');

        card.id = `card-${entity.id.replace(/\./g, '-')}`;
        if (entity.state === 'on') card.classList.add('state-on');

        const nameNode = clone.querySelector('.entity-name');
        const stateNode = clone.querySelector('.entity-state');
        const iconWrapper = clone.querySelector('.entity-icon');

        nameNode.textContent = entity.name;
        stateNode.textContent = entity.state === 'on' ? 'Encendido' : 'Apagado';

        // Dynamically inject the appropriate icon
        const iconName = this.getIconForLight(entity.name);
        if (iconWrapper) {
            iconWrapper.innerHTML = `<i data-lucide="${iconName}"></i>`;
            // Call lucide on this specific element if possible, or trigger global re-check
            setTimeout(() => {
                if (window.lucide) {
                    window.lucide.createIcons({
                        root: iconWrapper
                    });
                }
            }, 0);
        }

        const checkbox = clone.querySelector('input');
        checkbox.checked = entity.state === 'on';

        // Use the robust DOM references we just saved BEFORE attaching event
        checkbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            console.log(`Toggling ${entity.id} to ${isChecked}`);

            // Visual optimistic UI update
            card.classList.toggle('state-on', isChecked);
            stateNode.textContent = isChecked ? 'Encendido' : 'Apagado';

            // Fire robust service call
            this.toggleService(entity.domain, entity.id, isChecked);
        });

        return clone;
    }

    updateCardUI(entityId) {
        const stateObj = this.states[entityId];
        if (!stateObj) return;

        const card = document.getElementById(`card-${entityId.replace(/\./g, '-')}`);
        if (!card) return;

        const domain = entityId.split('.')[0];
        const state = stateObj.s;

        if (domain === 'light') {
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
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            this.showToast("Error: No hay conexión con Home Assistant", true);
            console.error("No socket connected to send toggle command.");
            return;
        }

        const msg = {
            type: "call_service",
            domain: domain,
            service: targetState ? "turn_on" : "turn_off",
            service_data: {
                entity_id: entityId
            }
        };

        this.showToast(`➜ Enviando: ${msg.service} a ${entityId}`);
        console.log("Sending service call:", msg);
        this.send(msg); // Use central send() to ensure IDs increment correctly
    }
}

window.homaOS = new HomaOS();
