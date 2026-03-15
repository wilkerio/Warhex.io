import Core from "./components/Core.js";
import CrazyGamesBridge from "./integrations/CrazyGamesBridge.js";

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

async function bootstrap() {
    const platformBridge = new CrazyGamesBridge();
    window.__WARHEX_PLATFORM__ = platformBridge;
    window.__WARHEX_CRAZYGAMES_ENV__ = platformBridge.isCrazyGamesEnvironment();

    await platformBridge.init();
    new Core(getLoadBalancerAddress(), 6, platformBridge);
}

bootstrap().catch((error) => {
    console.error("Failed to bootstrap game:", error);
});
