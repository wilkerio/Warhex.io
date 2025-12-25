const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { spawn } = require('child_process');

// Configuration
const config = {
    defaultPort: 3002,
    serverPortStart: 8080,
    maxServerCount: 2,
    maxPlayerCount: 24, // Max players per server
    serverStartCmd: '/root/server/server', // Command to start the server
    serverAddress: "fra1.blobl.io", 
};

const app = express();
app.use(cors({
    origin: ["https://blobl.io"], // Frontend URL
}));

let servers = [];
let serverProcesses = [];

// Function to convert port to path segment
function portToPathSegment(port) {
    const basePort = config.serverPortStart;
    const pathIndex = port - basePort + 1; 
    return `ffa${pathIndex}`;
}

// Function to fetch player count from the game server
const getPlayerCount = async (port) => {
    try {
        const response = await axios.get(`http://127.0.0.1:${port}/playercount`);
        if (response.status === 200) {
            return response.data.player_count; 
        }
        console.error(`Error fetching player count: ${response.status}`);
        return 0; // Return 0 if error occurs
    } catch (error) {
        console.error(`Failed to fetch player count from port ${port}:`, error);
        return 0; // Return 0 in case of error
    }
};

// Function to start a new game server and log its output
const startServer = (port) => {
    return new Promise((resolve, reject) => {
        const serverProcess = spawn(config.serverStartCmd, [], {
            env: { ...process.env, PORT: port },
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

app.get('/get-server', async (req, res) => {
    //!INFO: Balancing between 2 servers

    // Fetch player counts for all servers
    const serverPlayerCounts = await Promise.all(
        servers.map(async server => ({
            server,
            playerCount: await getPlayerCount(server.port)
        }))
    );

    // Destructure the first two servers
    const [firstServer, secondServer] = serverPlayerCounts;

    // Determine which server to route the player to
    let selectedServer = null;

    if (firstServer.playerCount < config.maxPlayerCount && secondServer.playerCount === 0) {
        // Route to the first server if it's not full and the second server is empty
        selectedServer = firstServer;
    } else {
        // Balance players between the two servers once the second server starts being used
        if (firstServer.playerCount <= secondServer.playerCount && firstServer.playerCount < config.maxPlayerCount) {
            selectedServer = firstServer;
        } else if (secondServer.playerCount < config.maxPlayerCount) {
            selectedServer = secondServer;
        }
    }

    // Return the selected server or a 404 error if no servers are available
    if (selectedServer) {
        return res.json({
            server_address: `${config.serverAddress}/${portToPathSegment(selectedServer.server.port)}`
        });
    } else {
        return res.status(404).json({ error: 'No available servers' });
    }
});

// Start the directory server
app.listen(config.defaultPort, async () => {
    console.log(`Directory server listening on port ${config.defaultPort}`);

    // Start two game servers initially
    try {
        await Promise.all([
            startServer(config.serverPortStart),
            startServer(config.serverPortStart + 1),
        ]);
        console.log(`Started two game servers on ports ${config.serverPortStart} and ${config.serverPortStart + 1}`);
    } catch (error) {
        console.error('Error starting the servers:', error);
        process.exit(1);
    }
});

// Clean up server processes on exit
process.on('exit', () => {
    console.log('Cleaning up server processes...');
    serverProcesses.forEach(proc => proc.kill());
});

// Handle termination signals to clean up before exiting
process.on('SIGINT', () => {
    process.exit();
});

process.on('SIGTERM', () => {
    process.exit();
});
