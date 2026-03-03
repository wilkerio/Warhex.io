import Core from "./components/Core.js";

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

    return `${window.location.protocol}//api.${hostname}`;
}

new Core(getLoadBalancerAddress(), 6);
