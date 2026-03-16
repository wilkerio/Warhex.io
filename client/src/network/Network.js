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
        this._initWorker();
    }

    _initWorker() {
        // Prefer the bundled worker in production builds, but keep the native path for local dev.
        if (typeof __webpack_require__ === 'function') {
            const BundledWorker = require('./network.worker.js');
            this.worker = new BundledWorker();
        } else {
            this.worker = new Worker('src/network/network.worker.js', { type: 'module' });
        }

        this.worker.onmessage = (event) => {
            const { type, data } = event.data;
            switch (type) {
                case 'connected':
                    this.onConnect(data);
                    break;
                case 'disconnected':
                    this.onDisconnect(data);
                    this.retryConnect();
                    break;
                case 'message':
                    this.onMessage(data);
                    break;
                case 'error':
                    this.onError(data);
                    if (!data || data.kind !== 'send') {
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

    buildDirectGameAddress() {
        return `${window.location.host}/ffa1`;
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
        const pathMatch = trimmed.match(/(\/ffa\d+)$/i);
        const pathSuffix = pathMatch ? pathMatch[1] : '/ffa1';

        if (window.location.protocol !== 'https:') {
            return trimmed;
        }

        const ipHostPattern = /^(?:wss?:\/\/|https?:\/\/)?(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/|$)/i;
        if (ipHostPattern.test(trimmed)) {
            return `${window.location.host}${pathSuffix}`;
        }

        return trimmed;
    }

    async resolveProductionAddress() {
        const forcedWs = (window.__WARHEX_WS_URL__ || '').trim();
        if (forcedWs) {
            return forcedWs;
        }

        if (this.loadBalancerAddress) {
            try {
                const response = await fetch(`${this.loadBalancerAddress}/get-server`, { method: 'GET' });
                if (response.ok) {
                    const data = await response.json();
                    if (data && typeof data.server_address === 'string' && data.server_address.trim()) {
                        return this.normalizeResolvedServerAddress(data.server_address);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch server from load balancer:', error);
            }
        }

        const fallback = (window.__WARHEX_GAME_WS_HOST__ || '').trim();
        if (fallback) {
            return this.normalizeResolvedServerAddress(fallback);
        }

        return this.normalizeResolvedServerAddress(this.buildDirectGameAddress());
    }

    async connect() {
        if (this.isDev) {
            this.serverAddress = '127.0.0.1:9090';
            this.worker.postMessage({ type: 'connect', data: `ws://${this.serverAddress}` });
            return;
        }

        const address = await this.resolveProductionAddress();
        const wsUrl = this.toWebSocketUrl(address);

        if (!wsUrl) {
            this.onError('No server address available.');
            this.retryConnect();
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
