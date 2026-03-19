import Core from "./components/Core.js";
import CrazyGamesBridge from "./integrations/CrazyGamesBridge.js";
import { consumeOAuthCallbackSession } from "./network/supabaseClient.js";

const USER_SCRIPT_FILENAME_PATTERN = /\.user\.js(?:$|\?)/i;

function isIPv4Address(hostname) {
    return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname);
}

function getLoadBalancerAddress() {
    const localHosts = new Set(["localhost", "127.0.0.1"]);
    const hostname = window.location.hostname;

    if (localHosts.has(hostname)) {
        return "http://localhost:3002";
    }

    const explicit = (window.__WARHEX_LOAD_BALANCER_URL__ || "").trim();
    if (explicit) {
        return explicit.replace(/\/+$/, "");
    }

    const configured = (window.WARHEX_CONFIG?.loadBalancerUrl || "").trim();
    if (configured) {
        return configured.replace(/\/+$/, "");
    }

    if (isIPv4Address(hostname)) {
        return `${window.location.protocol}//${window.location.host}`;
    }

    return `${window.location.protocol}//api.${hostname}`;
}

function setupUserscriptRuntimeSignals() {
    if (typeof window === "undefined") return;

    if (!Array.isArray(window.__WARHEX_USERSCRIPT_SOURCES__)) {
        window.__WARHEX_USERSCRIPT_SOURCES__ = [];
    }

    const addUserscriptSource = (rawSource) => {
        if (!Array.isArray(window.__WARHEX_USERSCRIPT_SOURCES__)) return;
        let source = String(rawSource || "").trim();
        if (!source) return;
        if (source.length > 220) {
            source = source.slice(0, 220);
        }
        if (window.__WARHEX_USERSCRIPT_SOURCES__.includes(source)) return;
        window.__WARHEX_USERSCRIPT_SOURCES__.push(source);
        if (window.__WARHEX_USERSCRIPT_SOURCES__.length > 12) {
            window.__WARHEX_USERSCRIPT_SOURCES__.shift();
        }
    };

    const looksLikeUserscript = (value) => {
        const text = String(value || "");
        const lower = text.toLowerCase();
        return (
            USER_SCRIPT_FILENAME_PATTERN.test(text) ||
            lower.includes(".user.js") ||
            lower.includes("tampermonkey") ||
            lower.includes("violentmonkey") ||
            lower.includes("greasemonkey")
        );
    };

    window.addEventListener("error", (event) => {
        const source = String(event?.filename || "");
        if (looksLikeUserscript(source)) {
            addUserscriptSource(source);
        }
    }, true);

    window.addEventListener("unhandledrejection", (event) => {
        const reason = event?.reason;
        const text = typeof reason === "string"
            ? reason
            : (reason?.stack || reason?.message || String(reason || ""));
        if (looksLikeUserscript(text)) {
            addUserscriptSource(text);
        }
    }, true);
}

async function bootstrap() {
    try {
        const oauthResult = await consumeOAuthCallbackSession();
        if (oauthResult?.error) {
            console.error("OAuth bootstrap callback failed:", oauthResult.error);
        }
    } catch (oauthError) {
        console.error("OAuth bootstrap processing error:", oauthError);
    }

    const platformBridge = new CrazyGamesBridge();
    window.__WARHEX_PLATFORM__ = platformBridge;
    window.__WARHEX_CRAZYGAMES_ENV__ = platformBridge.isCrazyGamesEnvironment();

    await platformBridge.init();
    new Core(getLoadBalancerAddress(), 6, platformBridge);
}

setupUserscriptRuntimeSignals();

bootstrap().catch((error) => {
    console.error("Failed to bootstrap game:", error);
});
