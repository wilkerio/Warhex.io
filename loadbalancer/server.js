const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { spawn } = require('child_process');

const parseNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const parseCsv = (value) => (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeOrigin = (value) => {
    if (!value || typeof value !== 'string') return null;
    try {
        return new URL(value).origin.toLowerCase();
    } catch (error) {
        return null;
    }
};

const getHostnameFromOrigin = (value) => {
    if (!value || typeof value !== 'string') return null;
    try {
        return new URL(value).hostname.toLowerCase();
    } catch (error) {
        return null;
    }
};

const parsePorts = (value, fallback) => {
    const parsed = parseCsv(value)
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0);
    return parsed.length > 0 ? parsed : fallback;
};

const config = {
    defaultPort: parseNumber(process.env.DIRECTORY_PORT, 3002),
    serverPortStart: parseNumber(process.env.SERVER_PORT_START, 9090),
    maxServerCount: parseNumber(process.env.MAX_SERVER_COUNT, 2),
    maxPlayerCount: parseNumber(process.env.MAX_PLAYER_COUNT, 24),
    serverAddress: (process.env.SERVER_ADDRESS || '127.0.0.1:9090').trim(),
    serverCwd: (process.env.SERVER_CWD || '').trim(),
    autoSpawnServers: String(process.env.AUTO_SPAWN_SERVERS || 'false').toLowerCase() === 'true',
    allowedOrigins: parseCsv(process.env.CORS_ALLOWED_ORIGINS),
    initialPorts: parsePorts(process.env.SERVER_PORTS, [9090, 9091]),
    ffaPorts: parsePorts(process.env.FFA_SERVER_PORTS, []),
    overdrivePorts: parsePorts(process.env.OVERDRIVE_SERVER_PORTS, [])
};

const defaultAllowedOrigins = [
    'https://warhex.io',
    'https://www.warhex.io',
    'https://api.warhex.io',
    'http://warhex.io',
    'http://www.warhex.io',
    'http://api.warhex.io',
    'http://127.0.0.1:3000',
    'http://localhost:3000'
];

const allowedOrigins = new Set(
    [...defaultAllowedOrigins, ...config.allowedOrigins]
        .map(normalizeOrigin)
        .filter(Boolean)
);

const isAllowedOrigin = (origin) => {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) return false;
    if (allowedOrigins.has(normalizedOrigin)) return true;

    const hostname = getHostnameFromOrigin(normalizedOrigin);
    return hostname === 'warhex.io' || hostname === 'www.warhex.io' || hostname === 'api.warhex.io';
};

const app = express();
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || isAllowedOrigin(origin)) {
            callback(null, true);
            return;
        }
        callback(null, false);
    }
}));

const GAME_MODES = {
    FFA: 'ffa',
    OVERDRIVE: 'overdrive'
};

const serversByMode = {
    [GAME_MODES.FFA]: [],
    [GAME_MODES.OVERDRIVE]: []
};
const serverProcesses = [];

function normalizeGameMode(value) {
    return String(value || '').trim().toLowerCase() === GAME_MODES.FFA
        ? GAME_MODES.FFA
        : GAME_MODES.OVERDRIVE;
}

function uniquePorts(ports) {
    return [...new Set((ports || []).filter((port) => Number.isInteger(port) && port > 0))];
}

function resolveModePortPools() {
    const explicitFfaPorts = uniquePorts(config.ffaPorts);
    const explicitOverdrivePorts = uniquePorts(config.overdrivePorts);
    if (explicitFfaPorts.length > 0 || explicitOverdrivePorts.length > 0) {
        const ffaPorts = explicitFfaPorts;
        const overdrivePorts = explicitOverdrivePorts.filter((port) => !ffaPorts.includes(port));
        return {
            [GAME_MODES.FFA]: ffaPorts,
            [GAME_MODES.OVERDRIVE]: overdrivePorts
        };
    }

    const fallbackPorts = uniquePorts(config.initialPorts).slice(0, config.maxServerCount);
    if (fallbackPorts.length <= 1) {
        return {
            [GAME_MODES.FFA]: fallbackPorts.slice(0, 1),
            [GAME_MODES.OVERDRIVE]: fallbackPorts.slice(1)
        };
    }

    const splitIndex = Math.ceil(fallbackPorts.length / 2);
    return {
        [GAME_MODES.FFA]: fallbackPorts.slice(0, splitIndex),
        [GAME_MODES.OVERDRIVE]: fallbackPorts.slice(splitIndex)
    };
}

const modePortPools = resolveModePortPools();

function portToPathSegment(mode, port) {
    const normalizedMode = normalizeGameMode(mode);
    const portList = modePortPools[normalizedMode] || [];
    const pathIndex = portList.indexOf(port);
    if (pathIndex < 0) {
        return `${normalizedMode}1`;
    }
    return `${normalizedMode}${pathIndex + 1}`;
}

function getRequestedOrigin(req) {
    const candidates = [
        req.get('origin'),
        req.get('referer'),
        `${req.protocol}://${req.get('host')}`
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            const url = new URL(candidate);
            return url;
        } catch (error) {
            // Ignore malformed candidates and keep trying.
        }
    }

    return null;
}

function getPublicServerAddress(req, pathSegment) {
    const requestedOrigin = getRequestedOrigin(req);
    if (requestedOrigin) {
        const hostname = requestedOrigin.hostname.toLowerCase();
        if (hostname === 'warhex.io' || hostname === 'www.warhex.io' || hostname === 'api.warhex.io') {
            return `warhex.io/${pathSegment}`;
        }
    }

    return `${config.serverAddress}/${pathSegment}`;
}

const getPlayerCount = async (port) => {
    try {
        const response = await axios.get(`http://127.0.0.1:${port}/playercount`);
        if (response.status === 200) {
            return Number(response.data.player_count || 0);
        }
        return null;
    } catch (error) {
        return null;
    }
};

const startServer = (port) => {
    return new Promise((resolve, reject) => {
        if (!config.serverCwd) {
            reject(new Error('SERVER_CWD is required when AUTO_SPAWN_SERVERS=true'));
            return;
        }

        const serverProcess = spawn('go', ['run', 'main.go'], {
            cwd: config.serverCwd,
            env: { ...process.env, PORT: String(port) },
        });

        serverProcess.stdout.on('data', (data) => {
            console.log(`${port}| ${data}`);
        });

        serverProcess.stderr.on('data', (data) => {
            console.error(`${port}| ${data}`);
        });

        serverProcess.on('exit', (code) => {
            console.log(`Server on port ${port} exited with code ${code}`);
        });

        serverProcesses.push(serverProcess);
        console.log(`Started server on port ${port}`);
        resolve();
    });
};

const ensureServersConfigured = () => {
    const hasConfiguredServers = Object.values(serversByMode).some((pool) => pool.length > 0);
    if (hasConfiguredServers) return;

    Object.entries(modePortPools).forEach(([mode, ports]) => {
        ports.forEach((port) => {
            serversByMode[mode].push({ port, playerCount: 0, mode });
        });
    });
};

app.get('/get-server', async (req, res) => {
    const requestedMode = normalizeGameMode(req.query.mode);
    const modeServers = serversByMode[requestedMode] || [];

    if (modeServers.length === 0) {
        return res.status(503).json({ error: 'No game servers configured' });
    }

    const serverPlayerCounts = await Promise.all(
        modeServers.map(async (server) => ({
            server,
            playerCount: await getPlayerCount(server.port)
        }))
    );
    const availableServers = serverPlayerCounts.filter((entry) => Number.isFinite(entry.playerCount));

    if (availableServers.length === 0) {
        return res.status(503).json({ error: `No reachable ${requestedMode} servers` });
    }

    let selectedServer = availableServers[0] || null;

    for (const candidate of availableServers) {
        if (!selectedServer) {
            selectedServer = candidate;
            continue;
        }

        const selectedIsFull = selectedServer.playerCount >= config.maxPlayerCount;
        const candidateHasRoom = candidate.playerCount < config.maxPlayerCount;

        if (selectedIsFull && candidateHasRoom) {
            selectedServer = candidate;
            continue;
        }

        if (candidateHasRoom && candidate.playerCount < selectedServer.playerCount) {
            selectedServer = candidate;
        }
    }

    if (!selectedServer || selectedServer.playerCount >= config.maxPlayerCount) {
        return res.status(404).json({ error: 'No available servers' });
    }

    return res.json({
        mode: requestedMode,
        server_address: getPublicServerAddress(req, portToPathSegment(requestedMode, selectedServer.server.port))
    });
});

app.listen(config.defaultPort, async () => {
    console.log(`Directory server listening on port ${config.defaultPort}`);
    ensureServersConfigured();

    if (config.autoSpawnServers) {
        try {
            const portsToSpawn = uniquePorts([
                ...modePortPools[GAME_MODES.FFA],
                ...modePortPools[GAME_MODES.OVERDRIVE]
            ]);

            await Promise.all(portsToSpawn.map((port) => startServer(port)));
            console.log(`Auto-started ${portsToSpawn.length} game servers.`);
            return;
        } catch (error) {
            console.error('Error auto-starting servers:', error);
            process.exit(1);
        }
    }

    console.log(`Using preconfigured FFA ports: ${modePortPools[GAME_MODES.FFA].join(', ') || 'none'}`);
    console.log(`Using preconfigured Overdrive ports: ${modePortPools[GAME_MODES.OVERDRIVE].join(', ') || 'none'}`);
});

process.on('exit', () => {
    serverProcesses.forEach((proc) => proc.kill());
});

process.on('SIGINT', () => {
    process.exit();
});

process.on('SIGTERM', () => {
    process.exit();
});
