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
    initialPorts: parsePorts(process.env.SERVER_PORTS, [9090, 9091])
};

const app = express();
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error('Not allowed by CORS'));
    }
}));

const servers = [];
const serverProcesses = [];

function portToPathSegment(port) {
    const basePort = config.serverPortStart;
    const pathIndex = port - basePort + 1;
    return `ffa${pathIndex}`;
}

const getPlayerCount = async (port) => {
    try {
        const response = await axios.get(`http://127.0.0.1:${port}/playercount`);
        if (response.status === 200) {
            return Number(response.data.player_count || 0);
        }
        return 0;
    } catch (error) {
        return 0;
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

        servers.push({ port, playerCount: 0 });
        serverProcesses.push(serverProcess);
        console.log(`Started server on port ${port}`);
        resolve();
    });
};

const ensureServersConfigured = () => {
    if (servers.length > 0) return;

    const uniquePorts = [...new Set(config.initialPorts)].slice(0, config.maxServerCount);
    uniquePorts.forEach((port) => {
        servers.push({ port, playerCount: 0 });
    });
};

app.get('/get-server', async (req, res) => {
    if (servers.length === 0) {
        return res.status(503).json({ error: 'No game servers configured' });
    }

    const serverPlayerCounts = await Promise.all(
        servers.map(async (server) => ({
            server,
            playerCount: await getPlayerCount(server.port)
        }))
    );

    let selectedServer = serverPlayerCounts[0] || null;

    for (const candidate of serverPlayerCounts) {
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
        server_address: `${config.serverAddress}/${portToPathSegment(selectedServer.server.port)}`
    });
});

app.listen(config.defaultPort, async () => {
    console.log(`Directory server listening on port ${config.defaultPort}`);

    if (config.autoSpawnServers) {
        try {
            const portsToSpawn = [];
            for (let i = 0; i < config.maxServerCount; i++) {
                portsToSpawn.push(config.serverPortStart + i);
            }

            await Promise.all(portsToSpawn.map((port) => startServer(port)));
            console.log(`Auto-started ${portsToSpawn.length} game servers.`);
            return;
        } catch (error) {
            console.error('Error auto-starting servers:', error);
            process.exit(1);
        }
    }

    ensureServersConfigured();
    console.log(`Using preconfigured server ports: ${servers.map((s) => s.port).join(', ')}`);
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
