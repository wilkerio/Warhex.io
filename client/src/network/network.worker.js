import { BuildingTypes, MessageTypes } from "./constants.js";


// Helper function to read a fixed-length string 
function readString (dataView, offset, length) {
    let str = '';
    for (let i = 0; i < length; i++) {
        const charCode = dataView.getUint8(offset + i);
        if (charCode === 0) break; // Stop at null terminator
        str += String.fromCharCode(charCode);
    }
    return { str, offset: offset + length };
}

// Helper function to read a color (Hex string)
function readColor (dataView, offset) {
    const r = dataView.getUint8(offset);        // Red
    const g = dataView.getUint8(offset + 1);    // Green
    const b = dataView.getUint8(offset + 2);    // Blue
    offset += 3;                                // Move the offset forward by 3 bytes

    // Check if all RGB values are 0, indicating transparency
    if (r === 0 && g === 0 && b === 0) {
        return { color: null, offset };
    }

    // Convert RGB to hex format
    const hexColor = `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;

    return { color: hexColor, offset };
}

let socket = null;

self.onmessage = (event) => {
    const { type, data } = event.data;
    switch (type) {
        case 'connect':
            connect(data);
            break;
        case 'disconnect':
            disconnect();
            break;
        case 'sendMessage':
            sendMessage(data);
            break;
        default:
            console.warn('Unknown worker command:', type);
    }
}

function connect (address) {
    if (socket && socket.readyState !== WebSocket.CLOSED) {
        console.warn('Socket is already open or in the process of connecting.');
        return;
    }

    socket = new WebSocket(address);
    socket.binaryType = "arraybuffer"; // Set binary type to ArrayBuffer

    socket.onopen = () => {
        self.postMessage({ type: 'connected', data: { address } });

        // Start the heartbeat mechanism
        socket.onopen = () => {
            self.postMessage({ type: 'connected', data: { address } });

            // Start the heartbeat mechanism
            setInterval(() => {
                if (socket.readyState === WebSocket.OPEN) {
                    const heartbeatMessage = new Uint8Array([MessageTypes.HEARTBEAT]); 
                    socket.send(heartbeatMessage);
                }
            }, 30000);
        };

    };

    socket.onclose = (event) => {
        console.log(event)
        self.postMessage({ type: 'disconnected', data: {} });
    };

    socket.onmessage = (event) => {
        const buffer = event.data;
        const message = decodeMessage(buffer);
        self.postMessage({ type: 'message', data: message });
    };

    socket.onerror = (event) => {
        const errorMessage = event.message || "Unknown error occurred"; // Extract the error message
        self.postMessage({ type: 'error', data: errorMessage });
    };
}

function disconnect () {
    if (!socket) {
        console.warn('No socket connection to disconnect.');
        return;
    }

    socket.close();
    socket = null;
    console.log('Socket disconnected by worker');
    self.postMessage({ type: 'disconnect', data: null })
}

function sendMessage (message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(message);
    } else {
        console.warn('Socket is not open. Unable to send message.');
        self.postMessage({ type: 'error', data: 'Socket is not open.' });
    }
}

function decodeMessage (buffer) {

    const dataView = new DataView(buffer);
    const messageType = dataView.getUint8(0);
    const payload = buffer.slice(1); // Rest is the payload

    // Calculate the size of the entire message buffer
    const bytes = buffer.byteLength;

    return {
        type: messageType,
        payload: decodePayload(messageType, payload),
        bytes: bytes
    };
}

function decodePayload (messageType, payload) {

    // Define a mapping of message types to their decoding functions
    const decoderMap = {
        [MessageTypes.PLAYER_JOINED]: decodePlayerJoined,
        [MessageTypes.PLAYER_LEFT]: decodePlayerLeft,
        [MessageTypes.KILLED]: decodeKilled,
        [MessageTypes.KICK_NOTIFICATION]: decodeKickNotification,
        [MessageTypes.BASE_HEALTH_UPDATE]: decodeBaseHealthUpdate,
        [MessageTypes.BUILDING_PLACED]: decodeBuildingPlaced,
        [MessageTypes.BUILDINGS_REMOVED]: decodeBuildingsRemoved,
        [MessageTypes.BUILDINGS_UPGRADED]: decodeBuildingsUpgraded,
        [MessageTypes.BARRACKS_ACTIVATION_UPDATE]: decodeBarracksActivationUpdate,
        [MessageTypes.GAME_STATE]: decodeInitialGameState,
        [MessageTypes.INITIAL_PLAYER_DATA]: decodeInitialPlayerData,
        [MessageTypes.RESOURCE_UPDATE]: decodeResourceUpdate,
        [MessageTypes.SPAWN_UNIT]: decodeSpawnUnit,
        [MessageTypes.UNITS_POSITION_UPDATE]: decodeUnitsPositionUpdate,
        [MessageTypes.UNITS_ROTATION_UPDATE]: decodeUnitsRotationUpdate,
        [MessageTypes.REMOVE_UNIT]: decodeRemoveUnit,
        [MessageTypes.SPAWN_BULLET]: decodeSpawnBullet,
        [MessageTypes.UNIT_SPAWN_BULLET]: decodeSpawnUnitBullet,
        [MessageTypes.REMOVE_BULLET]: decodeRemoveBullet,
        [MessageTypes.BULLET_POSITION_UPDATE]: decodeBulletPositionUpdate,
        [MessageTypes.LEADERBOARD_UPDATE]: decodeLeaderboardUpdate,
        [MessageTypes.REMOVE_SPAWN_PROTECTION]: decodeRemoveSpawnProtection,
        [MessageTypes.CHAT_MESSAGE]: decodeChatMessage,
        [MessageTypes.BUILDING_PLACEMENT_FAILED]: decodeBuildingPlacementFailed,
        [MessageTypes.INITIAL_BULLET_STATES]: decodeInitialBulletStates,
        [MessageTypes.TURRET_ROTATION_UPDATE]: decodeTurretRotationUpdate,
        [MessageTypes.NEUTRAL_BASE_CAPTURED]: decodeNeutralBaseCaptured,
        [MessageTypes.UNIT_HEALTH_UPDATE]: decodeUnitHealthUpdate,
        [MessageTypes.SKIN_DATA]: decodeSkinData,
        [MessageTypes.SERVER_VERSION]: decodeServerVersion,
        [MessageTypes.REBOOT_ALERT]: decodeRebootAlert,
        [MessageTypes.X1_CHALLENGE_RECEIVED]: decodeX1ChallengeReceived,
        [MessageTypes.X1_CHALLENGE_RESULT]: decodeX1ChallengeResult,
        [MessageTypes.X1_DUEL_ARENA_UPDATE]: decodeX1DuelArenaUpdate,
        [MessageTypes.WILD_PORTALS_UPDATE]: decodeWildPortalsUpdate,
        [MessageTypes.ERROR]: decodeError,
    };

    // Retrieve the decoder function or default to returning the payload as-is
    const decoder = decoderMap[messageType];
    return decoder ? decoder(payload) : payload;
}

function decodeBuildingPlacementFailed (payload) {
    const dataView = new DataView(payload);
    const buildingType = dataView.getUint8(0);
    const reason = dataView.byteLength > 1 ? dataView.getUint8(1) : 0;
    const cooldownSeconds = dataView.byteLength > 3 ? dataView.getUint16(2) : 0;
    return { buildingType, reason, cooldownSeconds }
}

function decodeInitialBulletStates (payload) {
    const dataView = new DataView(payload);
    const bulletStates = [];
    let offset = 0;

    while (offset < dataView.byteLength) {
        // Read the owner type identifier (0 for NeutralBase, 1 for Player)
        const isPlayer = dataView.getUint8(offset++);

        // Read Owner ID based on the type
        const ownerID = dataView.getUint8(offset++);

        // Read Bullet ID
        const bulletID = dataView.getUint8(offset++);

        // Read Bullet Position X
        const positionX = dataView.getFloat32(offset, false); // false for big-endian
        offset += 4; // Move offset by 4 bytes

        // Read Bullet Position Y
        const positionY = dataView.getFloat32(offset, false); // false for big-endian
        offset += 4; // Move offset by 4 bytes

        bulletStates.push({
            isPlayer,      // 0 for NeutralBase, 1 for Player
            ownerID,
            bulletID,
            position: {
                x: positionX,
                y: positionY
            }
        });
    }

    return bulletStates;
}

function decodeNeutralBaseCaptured (payload) {
    const dataView = new DataView(payload);

    const neutralID = dataView.getUint8(0);

    // If payload size is 1, it indicates the base is not captured
    if (dataView.byteLength === 1) {
        return { neutralID, playerID: null, buildings: [] };
    }

    // Read playerID from the payload (now we know it will always exist if size > 1)
    const playerID = dataView.getUint8(1);

    // Initialize an array to hold buildings
    const buildings = [];

    // Start reading building data from the byte offset after playerID
    let offset = 2; // Start after neutralID and playerID
    while (offset < dataView.byteLength) {
        // Check if there is enough data to read a building
        if (offset + 11 > dataView.byteLength) {
            break; // Not enough data to read the building (1 ID + 1 Type + 1 Variant + 4 X + 4 Y)
        }

        const buildingID = dataView.getUint8(offset);
        const buildingType = dataView.getUint8(offset + 1);
        const buildingVariant = dataView.getUint8(offset + 2);
        const positionX = dataView.getFloat32(offset + 3);
        const positionY = dataView.getFloat32(offset + 7);

        // Add building information to the array
        buildings.push({ id: buildingID, type: buildingType, variant: buildingVariant, position: { x: positionX, y: positionY } });

        // Move offset to the next building 
        offset += 11;
    }

    return { neutralID, playerID, buildings };
}

function decodeUnitHealthUpdate (payload) {
    const dataView = new DataView(payload);
    const playerID = dataView.getUint8(0);
    const unitID = dataView.getUint8(1);
    const health = dataView.getUint16(2);
    return { playerID, unitID, health };
}

function decodeTurretRotationUpdate (payload) {
    const dataView = new DataView(payload);
    const isPlayer = dataView.getUint8(0);
    const ownerID = dataView.getUint8(1);
    const turretID = dataView.getUint8(2);
    const rotation = dataView.getFloat32(3);
    return { isPlayer, ownerID, turretID, rotation }
}

function decodeSkinData (payload) {
    const dataView = new DataView(payload);
    let offset = 0;

    // Decode Default Skins
    const defaultSkinsCount = dataView.getUint8(offset++);

    const defaultSkins = [];
    for (let i = 0; i < defaultSkinsCount; i++) {
        const id = dataView.getUint8(offset++); // 1 byte for the ID
        const nameResult = readString(dataView, offset, 12);   // 12 bytes for the name
        offset = nameResult.offset;
        defaultSkins.push({ id, name: nameResult.str });
    }

    // Decode Veteran Skins
    const veteranSkinsCount = dataView.getUint8(offset++);

    const veteranSkins = [];
    for (let i = 0; i < veteranSkinsCount; i++) {
        const id = dataView.getUint8(offset++); // 1 byte for the ID
        const nameResult = readString(dataView, offset, 12);   // 12 bytes for the name
        offset = nameResult.offset;
        const requiredLevel = dataView.getUint8(offset++);  // 1 byte for required level
        veteranSkins.push({ id, name: nameResult.str, requiredLevel });
    }

    // Decode Premium Skins
    const premiumSkinsCount = dataView.getUint8(offset++);

    const premiumSkins = [];
    for (let i = 0; i < premiumSkinsCount; i++) {
        const id = dataView.getUint8(offset++); // 1 byte for the ID
        const nameResult = readString(dataView, offset, 12);   // 12 bytes for the name
        offset = nameResult.offset;
        const cost = dataView.getUint16(offset); // 2 bytes for the cost
        offset += 2;
        premiumSkins.push({ id, name: nameResult.str, cost });
    }

    // Return the decoded skin data
    return {
        skinData: {
            default: defaultSkins,
            veteran: veteranSkins,
            premium: premiumSkins
        }
    };
}


function decodeServerVersion (payload) {
    const dataView = new DataView(payload);
    const version = dataView.getUint8(0);
    return { version }
}

function decodeRebootAlert (payload) {
    const dataView = new DataView(payload);
    const minutesLeft = dataView.getUint8(0);
    return { minutesLeft }
}

function decodeError (payload) {
    const dataView = new DataView(payload);
    if (dataView.byteLength === 0) {
        return {};
    }

    const code = dataView.getUint8(0);
    const decoded = { code };

    // Relocate cooldown error includes remaining time in seconds (uint16).
    if (code === 1 && dataView.byteLength >= 3) {
        decoded.remainingSeconds = dataView.getUint16(1, false);
    }

    return decoded;
}

function decodeX1ChallengeReceived (payload) {
    const dataView = new DataView(payload);
    let offset = 0;
    const challengerID = dataView.getUint8(offset++);
    const nameResult = readString(dataView, offset, 12);
    return {
        challengerID,
        challengerName: nameResult.str
    };
}

function decodeX1ChallengeResult (payload) {
    const dataView = new DataView(payload);
    let offset = 0;
    const status = dataView.getUint8(offset++);
    const playerID = dataView.getUint8(offset++);
    const nameResult = readString(dataView, offset, 12);
    offset = nameResult.offset;

    let arena = null;
    let prepSeconds = 0;
    if (dataView.byteLength >= offset + 16) {
        arena = {
            minX: dataView.getFloat32(offset, false),
            minY: dataView.getFloat32(offset + 4, false),
            maxX: dataView.getFloat32(offset + 8, false),
            maxY: dataView.getFloat32(offset + 12, false)
        };
        offset += 16;
    }

    if (dataView.byteLength >= offset + 1) {
        prepSeconds = dataView.getUint8(offset);
    }

    return {
        status,
        playerID,
        playerName: nameResult.str,
        arena,
        prepSeconds
    };
}

function decodeX1DuelArenaUpdate (payload) {
    const dataView = new DataView(payload);
    const playerAID = dataView.getUint8(0);
    const playerBID = dataView.getUint8(1);
    return {
        playerAID,
        playerBID,
        arena: {
            minX: dataView.getFloat32(2, false),
            minY: dataView.getFloat32(6, false),
            maxX: dataView.getFloat32(10, false),
            maxY: dataView.getFloat32(14, false)
        }
    };
}

function decodeChatMessage (payload) {
    const dataView = new DataView(payload);
    const playerID = dataView.getUint8(0);
    const maxMessageLength = 64; // Maximum expected length
    const offset = 1;

    // Calculate the length of the message
    let actualMessageLength = 0;
    for (let i = 0; i < maxMessageLength; i++) {
        if (offset + i >= payload.byteLength) {
            break; // Avoid reading past the end of the buffer
        }
        const byte = dataView.getUint8(offset + i);
        if (byte === 0) {
            actualMessageLength = i; // Null byte encountered, set actual length
            break;
        }
        actualMessageLength = i + 1; // Update to the last non-null byte read
    }

    // If no null byte was found, use the length up to maxMessageLength or available data
    if (actualMessageLength === 0) {
        actualMessageLength = Math.min(maxMessageLength, payload.byteLength - offset);
    }

    // Create Uint8Array with actual length
    const messageBytes = new Uint8Array(actualMessageLength);
    for (let i = 0; i < actualMessageLength; i++) {
        messageBytes[i] = dataView.getUint8(offset + i);
    }

    // Decode the message
    const message = new TextDecoder().decode(messageBytes);

    return { playerID, message };
}

function decodePlayerJoined (payload) {
    const dataView = new DataView(payload);
    let offset = 0;

    const playerID = dataView.getUint8(offset++);
    const baseColorResult = readColor(dataView, offset); // 3 bytes for hex color code
    offset = baseColorResult.offset;
    let color = baseColorResult.color;

    const skinID = dataView.getUint8(offset++);

    // Extract X and Y positions using DataView
    const position = {
        x: dataView.getInt16(offset),
        y: dataView.getInt16(offset + 2)
    }

    offset += 4; // Move offset to next position

    const maxNameLength = 12; // Maximum expected length
    let actualNameLength = 0;
    // Determine the actual length of the name
    for (let i = 0; i < maxNameLength; i++) {
        const byte = dataView.getUint8(offset + i);
        if (byte === 0) {
            actualNameLength = i; // Null byte encountered, set actual length
            break;
        }
    }

    // If no null byte was found, set actual length to maxNameLength
    if (actualNameLength === 0) {
        actualNameLength = maxNameLength;
    }

    // Create Uint8Array with actual length
    const nameBytes = new Uint8Array(actualNameLength);

    // Read bytes from the DataView
    for (let i = 0; i < actualNameLength; i++) {
        nameBytes[i] = dataView.getUint8(offset + i);
    }

    const name = new TextDecoder().decode(nameBytes);

    return { playerID, color, skinID, position, name }
}

function decodePlayerLeft (payload) {
    const dataView = new DataView(payload);
    const playerID = dataView.getUint8(0);
    return { playerID };
}


function decodeKilled (payload) {
    const dataView = new DataView(payload);
    const killerID = dataView.getUint8(0);
    const score = dataView.getUint32(1);
    const xp = dataView.getUint32(5);
    const kills = dataView.getUint32(9);
    const playtime = dataView.getUint32(13);

    return { killerID, score, xp, kills, playtime };
}

function decodeKickNotification (payload) {
    const dataView = new DataView(payload);
    const reason = dataView.getUint8(0) === 0 ? "Timeout" : "Scripting";
    const score = dataView.getUint32(1);
    const xp = dataView.getUint32(5);
    const kills = dataView.getUint32(9);
    const playtime = dataView.getUint32(13);

    return { reason, score, xp, kills, playtime };
}

function decodeBaseHealthUpdate (payload) {
    const dateView = new DataView(payload);
    const isPlayer = dateView.getUint8(0);
    const ownerID = dateView.getUint8(1);
    const health = dateView.getUint16(2);
    return { isPlayer, ownerID, health };
}

function decodeBuildingPlaced (payload) {
    const dataView = new DataView(payload);
    const isPlayer = dataView.getUint8(0); // 1 = Player, 0 = Neutral
    const ownerID = dataView.getUint8(1);
    const buildingID = dataView.getUint8(2);
    const buildingType = dataView.getUint8(3);

    let offset = 4; // Start reading position data after building type
    const position = {
        x: dataView.getFloat32(offset),
        y: dataView.getFloat32(offset + 4)
    };

    // Check for UnitSpawning activation if building is a barrack
    let unitSpawningActive = null;
    if (buildingType === BuildingTypes.BARRACKS) {
        offset += 8; // Move past position data
        unitSpawningActive = dataView.getUint8(offset) === 1; // 1 for active, 0 for inactive
    }

    return { isPlayer, ownerID, buildingID, buildingType, position, unitSpawningActive };
}


function decodeBuildingsRemoved (payload) {
    const dataView = new DataView(payload);
    const isPlayer = dataView.getUint8(0); // 0 = Player, 1 = Neutral
    const ownerID = dataView.getUint8(1);

    // Read building IDs starting from byte 2 until the end of the payload
    const buildingIDs = [];
    for (let i = 2; i < dataView.byteLength; i++) {
        buildingIDs.push(dataView.getUint8(i));
    }

    return { isPlayer, ownerID, buildingIDs };
}

function decodeBuildingsUpgraded (payload) {
    const dataView = new DataView(payload);
    const isPlayer = dataView.getUint8(0); // 0 = Player, 1 = Neutral
    const ownerID = dataView.getUint8(1);
    const buildingVariant = dataView.getUint8(2);

    // Read building IDs starting from byte 3 until the end of the payload
    const buildingIDs = [];
    for (let i = 3; i < dataView.byteLength; i++) {
        buildingIDs.push(dataView.getUint8(i));
    }

    return { isPlayer, ownerID, buildingVariant, buildingIDs };
}

function decodeBarracksActivationUpdate (payload) {
    const dataView = new DataView(payload);
    const isPlayer = dataView.getUint8(0);
    const ownerID = dataView.getUint8(1);
    const buildingID = dataView.getUint8(2);
    const isActivated = dataView.getUint8(3) === 1;
    return { isPlayer, ownerID, buildingID, isActivated };
}

function decodeInitialGameState (payload) {
    const dataView = new DataView(payload);
    let offset = 0;

    const decodePlayer = () => {
        const id = dataView.getUint8(offset++);
        const hasSpawnProtection = dataView.getUint8(offset++);
        const health = dataView.getUint16(offset);
        offset += 2;
        const baseColorResult = readColor(dataView, offset); // 3 bytes for hex color code
        offset = baseColorResult.offset;
        let color = baseColorResult.color;

        const skinID = dataView.getUint8(offset++);

        const position = { x: dataView.getInt16(offset), y: dataView.getInt16(offset + 2) };
        offset += 4;
        const name = decodeName(12);
        const buildings = decodeBuildings();
        const units = decodeUnits();
        return { id, color, skinID, position, name, health, buildings, units, hasSpawnProtection };
    };

    const decodeName = (maxLength) => {
        let actualLength = 0;
        for (let i = 0; i < maxLength; i++) {
            const byte = dataView.getUint8(offset + i);
            if (byte === 0) {
                actualLength = i;
                break;
            }
        }

        // If no null byte was found, set actual length to maxNameLength
        if (actualLength === 0) {
            actualLength = maxLength;
        }

        const stringBytes = new Uint8Array(actualLength);
        for (let i = 0; i < actualLength; i++) {
            stringBytes[i] = dataView.getUint8(offset + i);
        }
        offset += maxLength;
        return new TextDecoder().decode(stringBytes);
    };

    const decodeBuildings = () => {
        const numBuildings = dataView.getUint8(offset++);
        const buildings = [];

        for (let i = 0; i < numBuildings; i++) {
            const buildingId = dataView.getUint8(offset++);
            const buildingType = dataView.getUint8(offset++);
            const buildingVariant = dataView.getUint8(offset++);

            const buildingX = dataView.getFloat32(offset);
            const buildingY = dataView.getFloat32(offset + 4);
            offset += 8;

            // Check if building is a barrack and read UnitSpawning status if applicable
            let unitSpawningActive = null;
            if (buildingType === BuildingTypes.BARRACKS) {
                unitSpawningActive = dataView.getUint8(offset++) === 1; // 1 for active, 0 for inactive
            }

            buildings.push({
                id: buildingId,
                type: buildingType,
                variant: buildingVariant,
                position: { x: buildingX, y: buildingY },
                unitSpawningActive // Add to building data if it's a barrack
            });
        }

        return buildings;
    };

    const decodeUnits = () => {
        const numUnits = dataView.getUint8(offset++);
        const units = [];
        for (let i = 0; i < numUnits; i++) {
            const unitId = dataView.getUint8(offset++);
            const unitType = dataView.getUint8(offset++);
            const unitVariant = dataView.getUint8(offset++);
            const unitX = dataView.getFloat32(offset);
            const unitY = dataView.getFloat32(offset + 4);
            offset += 8;
            units.push({ id: unitId, type: unitType, variant: unitVariant, position: { x: unitX, y: unitY } });
        }
        return units;
    };

    const decodeNeutralBase = () => {
        const id = dataView.getInt8(offset++);
        let ownerID = dataView.getInt8(offset++);
        ownerID = ownerID === 255 ? null : ownerID;
        const position = { x: dataView.getInt16(offset), y: dataView.getInt16(offset + 2) };
        offset += 4;
        const health = dataView.getUint16(offset);
        offset += 2;
        const buildings = decodeBuildings();
        return { id, ownerID, health, position, buildings };
    };

    const decodeBush = () => {
        const position = { x: dataView.getInt16(offset), y: dataView.getInt16(offset + 2) };
        offset += 4;
        return position;
    };

    const decodeRock = () => {
        const position = { x: dataView.getInt16(offset), y: dataView.getInt16(offset + 2) };
        offset += 4;

        const size = dataView.getUint8(offset);
        offset += 1;

        const rotation = dataView.getFloat32(offset);
        offset += 4;

        return { position, size, rotation };
    };

    const decodeWildPortals = () => {
        if (offset >= dataView.byteLength) return [];
        const numPortals = dataView.getUint8(offset++);
        const wildPortals = [];
        for (let i = 0; i < numPortals; i++) {
            const id = dataView.getUint8(offset++);
            const x = dataView.getFloat32(offset);
            const y = dataView.getFloat32(offset + 4);
            offset += 8;
            wildPortals.push({ id, position: { x, y } });
        }
        return wildPortals;
    };

    const numPlayers = dataView.getUint8(offset++);
    const players = [];
    for (let i = 0; i < numPlayers; i++) {
        players.push(decodePlayer());
    }

    const numNeutralBases = dataView.getUint8(offset++);
    const neutralBases = [];
    for (let i = 0; i < numNeutralBases; i++) {
        neutralBases.push(decodeNeutralBase());
    }

    const numBushes = dataView.getUint8(offset++);
    const bushes = [];
    for (let i = 0; i < numBushes; i++) {
        bushes.push(decodeBush());
    }

    const numRocks = dataView.getUint8(offset++);
    const rocks = [];
    for (let i = 0; i < numRocks; i++) {
        rocks.push(decodeRock());
    }

    const wildPortals = decodeWildPortals();

    return { players, neutralBases, bushes, rocks, wildPortals };
}

function decodeWildPortalsUpdate (payload) {
    const dataView = new DataView(payload);
    let offset = 0;
    const numPortals = dataView.getUint8(offset++);
    const wildPortals = [];
    for (let i = 0; i < numPortals; i++) {
        const id = dataView.getUint8(offset++);
        const x = dataView.getFloat32(offset);
        const y = dataView.getFloat32(offset + 4);
        offset += 8;
        wildPortals.push({ id, position: { x, y } });
    }
    return { wildPortals };
}

function decodeResourceUpdate (payload) {
    const dataView = new DataView(payload)
    const power = dataView.getUint16(0);
    const generatingPower = dataView.getUint16(2);
    return { power, generatingPower }
}

function decodeSpawnUnit (payload) {
    // Barrack ID (255) when commander spawns -> reflects that it doesnt spawn in a barrack
    const invalidBarrackID = 255;

    const dataView = new DataView(payload)
    const isPlayer = dataView.getUint8(0);
    const ownerID = dataView.getUint8(1);
    let barracksID = dataView.getUint8(2);
    barracksID = barracksID === invalidBarrackID ? -1 : barracksID;
    const unitID = dataView.getUint8(3);
    const unitType = dataView.getUint8(4);
    const unitVariant = dataView.getUint8(5);

    // Read the float32 X and Y positions
    const x = dataView.getFloat32(6);
    const y = dataView.getFloat32(10);

    const targetPosition = { x, y };

    return { isPlayer, ownerID, barracksID, unitID, unitType, unitVariant, targetPosition };
}

function decodeUnitsPositionUpdate (payload) {
    const dataView = new DataView(payload);
    const playerID = dataView.getUint8(0); // First byte is the player ID
    const units = [];

    // Start reading after the player ID
    let offset = 1;

    while (offset < payload.byteLength) {
        const unitID = dataView.getUint8(offset);
        const unitX = dataView.getFloat32(offset + 1);
        const unitY = dataView.getFloat32(offset + 5);

        units.push({
            id: unitID,
            targetPosition: { x: unitX, y: unitY },
        });

        // Move to the next unit's data (1 byte for ID + 4 bytes for X + 4 bytes for Y = 9 bytes)
        offset += 9;
    }

    return {
        playerID,
        units,
    };
}


function decodeUnitsRotationUpdate (payload) {
    const dataView = new DataView(payload);
    const playerID = dataView.getUint8(0);

    // Initialize an array to hold the units' data
    const units = [];

    // Start reading from the second byte
    let offset = 1; // Skip the playerID

    while (offset < payload.byteLength) {
        const unitID = dataView.getUint8(offset); // Read unit ID
        offset += 1;

        // Read the rotation value
        const rotation = dataView.getFloat32(offset);
        offset += 4;

        // Store the unit's data
        units.push({
            id: unitID,
            rotation: rotation,
        });
    }

    return {
        playerID,
        units,
    };
}

function decodeRemoveUnit (payload) {
    const dataView = new DataView(payload);
    const playerID = dataView.getUint8(0);
    const unitID = dataView.getUint8(1);

    return { playerID, unitID }
}

function decodeSpawnBullet (payload) {
    const dataView = new DataView(payload);
    const isPlayer = dataView.getUint8(0);
    const ownerID = dataView.getUint8(1);
    const objectID = dataView.getUint8(2);
    const bulletID = dataView.getUint8(3);
    const positionX = dataView.getFloat32(4);
    const positionY = dataView.getFloat32(8);

    return { isPlayer, ownerID, objectID, bulletID, position: { x: positionX, y: positionY } };
}

function decodeSpawnUnitBullet (payload) {
    const dataView = new DataView(payload);
    const playerID = dataView.getUint8(0);
    const objectID = dataView.getUint8(1);
    const bulletID = dataView.getUint8(2);
    const positionX = dataView.getFloat32(3);
    const positionY = dataView.getFloat32(7);

    return { playerID, objectID, bulletID, position: { x: positionX, y: positionY } };
}


function decodeRemoveBullet (payload) {
    const dataView = new DataView(payload);
    const isPlayer = dataView.getUint8(0);
    const ownerID = dataView.getUint8(1);
    const bulletID = dataView.getUint8(2);

    return { isPlayer, ownerID, bulletID };
}

function decodeBulletPositionUpdate (payload) {
    const dataView = new DataView(payload);
    const isPlayer = dataView.getUint8(0);
    const ownerID = dataView.getUint8(1);
    const bulletID = dataView.getUint8(2);
    const targetPositionX = dataView.getFloat32(3);
    const targetPositionY = dataView.getFloat32(7);

    return { isPlayer, ownerID, bulletID, targetPosition: { x: targetPositionX, y: targetPositionY } };
}

function decodeLeaderboardUpdate (payload) {
    const dataView = new DataView(payload);
    let offset = 0;

    // Decode the number of changes
    const changesCount = dataView.getUint8(offset);
    offset += 1;

    const changes = [];

    for (let i = 0; i < changesCount; i++) {
        // Decode Player ID
        const playerId = dataView.getUint8(offset);
        offset += 1;

        // Decode LeaderboardScore
        const unitCode = dataView.getUint8(offset);
        const unit = String.fromCharCode(unitCode);
        offset += 1;

        let score;

        if (unit === 'M') {
            // Decode 2 bytes for IntegerPart (9 bits) and FractionalPart (7 bits)
            const packedScore = dataView.getUint16(offset);
            offset += 2;

            const integerPart = (packedScore >> 7) & 0x1FF; // Extract 9 bits for integer part
            const fractionalPart = packedScore & 0x7F; // Extract 7 bits for fractional part (0-99)
            score = {
                fullValue: null,
                integerPart,
                fractionalPart,
                unit
            };
        } else if (unit === 'k') {
            // Decode 2 bytes for IntegerPart (10 bits) and FractionalPart (6 bits)
            const packedScore = dataView.getUint16(offset);
            offset += 2;

            const integerPart = (packedScore >> 6) & 0x3FF; // Extract 10 bits for integer part
            const fractionalPart = packedScore & 0x3F; // Extract 6 bits for fractional part (0-63)

            score = {
                fullValue: null,
                integerPart,
                fractionalPart,
                unit
            };
        } else {
            // Decode 16-bit integer (2 bytes) for smaller values
            const fullValue = dataView.getUint16(offset);
            offset += 2;

            score = {
                fullValue,
                integerPart: null,
                fractionalPart: null,
                unit: ''
            };
        }

        changes.push({
            playerId,
            score
        });
    }

    return { changes };
}

function decodeRemoveSpawnProtection (payload) {
    const dataView = new DataView(payload);
    const playerID = dataView.getUint8(0);
    return { playerID }
}

function decodeInitialPlayerData (payload) {
    const dataView = new DataView(payload);
    let offset = 0;

    const playerID = dataView.getUint8(offset++);

    const baseColorResult = readColor(dataView, offset); // 3 bytes for hex color code
    offset = baseColorResult.offset;
    let color = baseColorResult.color;

    const skinID = dataView.getUint8(offset++);

    // Extract X and Y positions using DataView
    const position = {
        x: dataView.getInt16(offset),
        y: dataView.getInt16(offset + 2)
    }

    offset += 4; // Move offset to next position

    const maxNameLength = 12; // Maximum expected length
    let actualNameLength = 0;
    // Determine the actual length of the name
    for (let i = 0; i < maxNameLength; i++) {
        const byte = dataView.getUint8(offset + i);
        if (byte === 0) {
            actualNameLength = i; // Null byte encountered, set actual length
            break;
        }
    }

    // If no null byte was found, set actual length to maxNameLength
    if (actualNameLength === 0) {
        actualNameLength = maxNameLength;
    }

    // Create Uint8Array with actual length
    const nameBytes = new Uint8Array(actualNameLength);

    // Read bytes from the DataView
    for (let i = 0; i < actualNameLength; i++) {
        nameBytes[i] = dataView.getUint8(offset + i);
    }

    const name = new TextDecoder().decode(nameBytes);

    return { playerID, color, skinID, position, name }
}
