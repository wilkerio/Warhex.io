// import Worker from './network.worker.js'; // Note: Uncomment when using Webpack to bundle the worker (also see _initWorker())

export default class Network {
    constructor(loadBalancerAddress, core) {
        this.core = core;
        this.loadBalancerAddress = this.normalizeBaseUrl(loadBalancerAddress);
        this.isDev = this.isLocalDomain();
        this.serverAddress = null;

        this.eventListeners = {
            open: [],
            message: [],
            close: [],
            error: [],
        };

        this.worker = null;
        this.retryDelay = 3000;
        this.retryTimer = null;
        this.hasConnectedOnce = false;
        this.initialConnectFailures = 0;
        this.maxInitialConnectRetries = 4;
        this.initialFailureTerminal = false;
        this._initWorker();
    }

    _initWorker() {
        // Prefer the bundled worker in production builds.
        if (typeof __webpack_require__ === 'function') {
            try {
                const BundledWorker = require('./network.worker.js');
                this.worker = new BundledWorker();
            } catch (error) {
                console.warn('Bundled worker initialization failed, trying URL fallbacks.', error);
            }
        }

        if (!this.worker) {
            const workerCandidates = this.isDev
                ? [
                    { url: 'src/network/network.worker.js', options: { type: 'module' } },
                    { url: 'dist/index.worker.js' },
                    { url: '/dist/index.worker.js' },
                    { url: 'index.worker.js' }
                ]
                : [
                    { url: 'dist/index.worker.js' },
                    { url: '/dist/index.worker.js' },
                    { url: 'index.worker.js' },
                    { url: 'src/network/network.worker.js', options: { type: 'module' } }
                ];

            for (const candidate of workerCandidates) {
                try {
                    this.worker = new Worker(candidate.url, candidate.options);
                    break;
                } catch (error) {}
            }
        }

        if (!this.worker) {
            throw new Error('Unable to initialize network worker from bundled or fallback paths.');
        }

        this.worker.onmessage = (event) => {
            const { type, data } = event.data;
            switch (type) {
                case 'connected':
                    this.onConnect(data);
                    break;
                case 'disconnected':
                    this.onDisconnect(data);
                    if (this.handleConnectionFailure({ kind: 'disconnected', message: 'Connection closed before game sync.' })) {
                        this.retryConnect();
                    }
                    break;
                case 'message':
                    this.onMessage(data);
                    break;
                case 'error':
                    this.onError(data);
                    if (this.handleConnectionFailure(data)) {
                        this.retryConnect();
                    }
                    break;
                default:
                    console.warn('Unknown message type:', type);
            }
        };
    }

    normalizeBaseUrl(url) {
        if (!url || typeof url !== 'string') return '';
        return url.trim().replace(/\/+$/, '');
    }

    normalizeGameMode(mode) {
        return String(mode || '').trim().toLowerCase() === 'ffa' ? 'ffa' : 'overdrive';
    }

    getSelectedGameMode() {
        const modeCandidates = [
            localStorage.getItem('menuSelectedMode'),
            document.getElementById('selected-mode')?.value,
            document.getElementById('play-button')?.dataset?.menuMode,
            window.__WARHEX_TOP_MENU_MODE__
        ];

        for (const candidate of modeCandidates) {
            if (candidate == null || String(candidate).trim() === '') {
                continue;
            }
            const normalized = this.normalizeGameMode(candidate);
            if (normalized === 'ffa' || normalized === 'overdrive') {
                return normalized;
            }
        }

        return 'overdrive';
    }

    getDefaultPathForMode(mode = this.getSelectedGameMode()) {
        return `/${this.normalizeGameMode(mode)}1`;
    }

    createConnectionError(kind, message, extra = {}) {
        return {
            kind,
            message,
            ...extra
        };
    }

    buildDirectGameAddress() {
        return `${window.location.host}${this.getDefaultPathForMode()}`;
    }

    toWebSocketUrl(address) {
        if (!address || typeof address !== 'string') {
            return null;
        }

        const trimmed = address.trim();

        if (/^wss?:\/\//i.test(trimmed)) {
            return trimmed;
        }

        if (/^https?:\/\//i.test(trimmed)) {
            return trimmed.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
        }

        const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
        if (trimmed.startsWith('//')) {
            return `${scheme}:${trimmed}`;
        }

        return `${scheme}://${trimmed}`;
    }

    normalizeResolvedServerAddress(address) {
        if (!address || typeof address !== 'string') {
            return address;
        }

        const trimmed = address.trim();
        const pathMatch = trimmed.match(/(\/(?:ffa|overdrive)\d+)$/i);
        const pathSuffix = pathMatch ? pathMatch[1] : this.getDefaultPathForMode();

        if (window.location.protocol !== 'https:') {
            return trimmed;
        }

        const ipHostPattern = /^(?:wss?:\/\/|https?:\/\/)?(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/|$)/i;
        if (ipHostPattern.test(trimmed)) {
            return `${window.location.host}${pathSuffix}`;
        }

        return trimmed;
    }

    async requestServerAddressFromLoadBalancer() {
        if (!this.loadBalancerAddress) {
            return null;
        }

        const requestUrl = new URL(`${this.loadBalancerAddress}/get-server`);
        const mode = this.getSelectedGameMode();
        requestUrl.searchParams.set('mode', mode);

        try {
            const response = await fetch(requestUrl.toString(), { method: 'GET' });
            if (!response.ok) {
                let errorMessage = `No ${mode} server is available right now.`;
                try {
                    const data = await response.json();
                    if (typeof data?.error === 'string' && data.error.trim()) {
                        errorMessage = data.error.trim();
                    }
                } catch (error) {}

                throw this.createConnectionError('server_unavailable', errorMessage, {
                    retryable: false,
                    status: response.status,
                    mode
                });
            }

            const data = await response.json();
            if (data && typeof data.server_address === 'string' && data.server_address.trim()) {
                return this.normalizeResolvedServerAddress(data.server_address);
            }
        } catch (error) {
            if (error && typeof error === 'object' && error.kind) {
                throw error;
            }
            if (this.isDev) {
                return null;
            }
            console.error('Failed to fetch server from load balancer:', error);
        }

        return null;
    }

    async resolveProductionAddress() {
        const forcedWs = (window.__WARHEX_WS_URL__ || '').trim();
        if (forcedWs) {
            return forcedWs;
        }

        const loadBalancedAddress = await this.requestServerAddressFromLoadBalancer();
        if (loadBalancedAddress) {
            return loadBalancedAddress;
        }

        const fallback = (window.__WARHEX_GAME_WS_HOST__ || '').trim();
        if (fallback) {
            return this.normalizeResolvedServerAddress(fallback);
        }

        return this.normalizeResolvedServerAddress(this.buildDirectGameAddress());
    }

    handleConnectionFailure(data = {}) {
        if (data?.kind === 'send') {
            return false;
        }
        if (data?.retryable === false) {
            this.initialFailureTerminal = true;
            return false;
        }
        if (this.initialFailureTerminal) {
            return false;
        }
        if (this.hasConnectedOnce) {
            return true;
        }

        this.initialConnectFailures += 1;
        if (this.initialConnectFailures >= this.maxInitialConnectRetries) {
            this.initialFailureTerminal = true;
            this.onError(this.createConnectionError(
                'server_unavailable',
                data?.message || 'No server is available for the selected mode right now.',
                {
                    retryable: false,
                    attempts: this.initialConnectFailures,
                    mode: this.getSelectedGameMode()
                }
            ));
            return false;
        }

        return true;
    }

    async connect() {
        let address = null;
        try {
            if (this.isDev) {
                const forcedWs = (window.__WARHEX_WS_URL__ || '').trim();
                if (forcedWs) {
                    address = forcedWs;
                } else {
                    const loadBalancedAddress = await this.requestServerAddressFromLoadBalancer();
                    if (loadBalancedAddress) {
                        address = loadBalancedAddress;
                    } else {
                        const localHost = (window.location.hostname || '127.0.0.1').trim();
                        const selectedMode = this.getSelectedGameMode();
                        const configuredLocalPorts = window.__WARHEX_DEV_WS_PORTS__;
                        const modeLocalPort = configuredLocalPorts && typeof configuredLocalPorts === 'object'
                            ? configuredLocalPorts[selectedMode]
                            : null;
                        const localPort = String(
                            modeLocalPort
                            || window.__WARHEX_DEV_WS_PORT__
                            || (selectedMode === 'ffa' ? '9090' : '9091')
                        ).trim();
                        const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
                        address = `${scheme}://${localHost}:${localPort}`;
                    }
                }
            } else {
                address = await this.resolveProductionAddress();
            }
        } catch (error) {
            const connectionError = error && typeof error === 'object' && error.kind
                ? error
                : this.createConnectionError('connection_resolution_failed', 'Could not resolve a server address.', { retryable: true });
            this.onError(connectionError);
            if (this.handleConnectionFailure(connectionError)) {
                this.retryConnect();
            }
            return;
        }

        const wsUrl = this.toWebSocketUrl(address);

        if (!wsUrl) {
            const connectionError = this.createConnectionError('connection_resolution_failed', 'No server address available.', { retryable: true });
            this.onError(connectionError);
            if (this.handleConnectionFailure(connectionError)) {
                this.retryConnect();
            }
            return;
        }

        this.serverAddress = wsUrl;
        this.worker.postMessage({ type: 'connect', data: wsUrl });
    }

    async retryConnect() {
        if (this.retryTimer) {
            return;
        }
        console.log(`Reconnecting in ${this.retryDelay / 1000} seconds...`);
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.connect();
        }, this.retryDelay);
    }

    onConnect(data) {
        this.hasConnectedOnce = true;
        this.initialConnectFailures = 0;
        this.initialFailureTerminal = false;
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
        console.log('Connected to server:', data);
        this.triggerEvent('open', data);
    }

    onDisconnect(data) {
        console.warn('Disconnected from server:', data);
        this.triggerEvent('close', data);
    }

    onMessage(data) {
        this.triggerEvent('message', data);
    }

    onError(data) {
        console.error('Worker error:', data);
        this.triggerEvent('error', data);
    }

    sendMessage(message) {
        this.worker.postMessage({ type: 'sendMessage', data: message.encodeMessage() });
    }

    triggerEvent(type, data) {
        this.eventListeners[type]?.forEach((callback) => callback(data));
    }

    addEventListener(type, callback) {
        if (this.eventListeners[type]) {
            this.eventListeners[type].push(callback);
        } else {
            console.warn('Unknown event type:', type);
        }
    }

    isLocalDomain() {
        const localDomains = ['localhost', '127.0.0.1'];
        const hostname = window.location.hostname;
        return localDomains.includes(hostname);
    }

    static async pingServer(serverAddress) {
        try {
            const startTime = performance.now();
            const response = await fetch(`${serverAddress}/ping`, { method: 'HEAD' });
            if (!response.ok) {
                throw new Error(`Server returned status: ${response.status}`);
            }
            const endTime = performance.now();
            return endTime - startTime;
        } catch (error) {
            console.error(`Failed to ping server ${serverAddress}:`, error);
            return Infinity;
        }
    }

    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
