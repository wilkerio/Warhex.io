const CRAZYGAMES_HOST_PATTERN = /(^|\.)crazygames\.com$/i;
const CRAZYGAMES_SDK_URL = "https://sdk.crazygames.com/crazygames-sdk-v3.js";

function parseHostname(urlLike) {
    const raw = String(urlLike || "").trim();
    if (!raw) return "";
    try {
        return new URL(raw).hostname.toLowerCase();
    } catch (error) {
        return "";
    }
}

function isCrazyGamesHost(hostname) {
    return CRAZYGAMES_HOST_PATTERN.test(String(hostname || "").toLowerCase());
}

function detectCrazyGamesEnvironment() {
    const params = new URLSearchParams(window.location?.search || "");
    const forcedByQuery = params.get("platform") === "crazygames" || params.get("cg") === "1";
    const locationHost = parseHostname(window.location?.href) || String(window.location?.hostname || "").toLowerCase();
    const referrerHost = parseHostname(document.referrer);
    const embedded = window.self !== window.top;

    const onCrazyGamesHost = isCrazyGamesHost(locationHost);
    const fromCrazyGamesReferrer = isCrazyGamesHost(referrerHost);
    return forcedByQuery || onCrazyGamesHost || (embedded && fromCrazyGamesReferrer);
}

export default class CrazyGamesBridge {
    constructor() {
        this._isCrazyGamesEnvironment = detectCrazyGamesEnvironment() || Boolean(window.__WARHEX_CRAZYGAMES_ENV__);
        this._initialized = false;
        this._gameplayActive = false;
    }

    isCrazyGamesEnvironment() {
        return this._isCrazyGamesEnvironment;
    }

    shouldDisableExternalAds() {
        return this._isCrazyGamesEnvironment;
    }

    shouldDisableExternalAuth() {
        return this._isCrazyGamesEnvironment;
    }

    async init() {
        if (!this._isCrazyGamesEnvironment || this._initialized) return this._initialized;

        const sdk = await this.ensureSDKLoaded();
        if (!sdk?.init) return false;

        try {
            await sdk.init();
            this._initialized = true;
            console.log("CrazyGames SDK initialized.");
        } catch (error) {
            console.error("CrazyGames SDK init failed:", error);
            this._initialized = false;
        }

        return this._initialized;
    }

    async ensureSDKLoaded() {
        if (window.CrazyGames?.SDK) return window.CrazyGames.SDK;

        await new Promise((resolve, reject) => {
            const existing = document.querySelector('script[data-warhex-crazygames-sdk="1"]');
            if (existing) {
                existing.addEventListener("load", resolve, { once: true });
                existing.addEventListener("error", reject, { once: true });
                return;
            }

            const script = document.createElement("script");
            script.src = CRAZYGAMES_SDK_URL;
            script.async = true;
            script.defer = true;
            script.dataset.warhexCrazygamesSdk = "1";
            script.onload = () => resolve();
            script.onerror = (event) => reject(event);
            document.head.appendChild(script);
        });

        return window.CrazyGames?.SDK || null;
    }

    gameplayStart() {
        if (!this._initialized || this._gameplayActive) return;
        try {
            window.CrazyGames?.SDK?.game?.gameplayStart?.();
            this._gameplayActive = true;
        } catch (error) {
            console.error("CrazyGames gameplayStart failed:", error);
        }
    }

    gameplayStop() {
        if (!this._initialized || !this._gameplayActive) return;
        try {
            window.CrazyGames?.SDK?.game?.gameplayStop?.();
            this._gameplayActive = false;
        } catch (error) {
            console.error("CrazyGames gameplayStop failed:", error);
        }
    }
}
