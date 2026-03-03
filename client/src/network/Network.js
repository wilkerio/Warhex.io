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
        this._initWorker();
    }

    _initWorker() {
        // this.worker = new Worker({ type: 'module' }); // Webpack, bundled
        this.worker = new Worker('src/network/network.worker.js', { type: 'module' }); // Local dev, unbundled

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
                    this.retryConnect();
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
                        return data.server_address.trim();
                    }
                }
            } catch (error) {
                console.error('Failed to fetch server from load balancer:', error);
            }
        }

        const fallback = (window.__WARHEX_GAME_WS_HOST__ || '').trim();
        if (fallback) {
            return fallback;
        }

        return window.location.hostname;
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
        console.log(`Reconnecting in ${this.retryDelay / 1000} seconds...`);
        await this.delay(this.retryDelay);
        this.connect();
    }

    onConnect(data) {
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
