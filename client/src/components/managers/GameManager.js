import { QueueType } from "../Renderer.js";
import { BuildingLimits, BuildingTypes } from "../../network/constants.js";

class GameManager {
    constructor (core) {
        this.core = core;
        this.previousTime = 0; // Initialize previousTime
        this.player = null; // ?Ref to local player
        this.capturedNeutrals = []; // ?Ref to local players captured neutral bases
        this.players = []; // Array to store player instances
        this.neutrals = [];
        this.bushes = [];
        this.rocks = [];
        this.wildPortals = [];
        this.rallyPoints = [];
        this.hasCommander = false;
        this.activeBarracks = {
            current: 0,
            max: 4
        }
        this.resources = {
            power: {
                current: 6000,
                max: 6000,
                generationRate: 0
            },
            protectionTime: {
                current: 2, // This will store elapsed time in minutes
                max: 2 // minutes
            },
        }

        this.unitUpgrades = []; // Holds the variants for each unit
        this.buildingLimits = [];
        // Populate the building limits array
        for (const [buildingType, limit] of Object.entries(BuildingLimits)) {
            const typeNumber = BuildingTypes[buildingType]; // Get the numeric identifier from BuildingTypes
            this.buildingLimits.push({ type: typeNumber, limit: limit, current: 0 });
        }

        this.stats = {
            time: null,
        }

        this.metrics = {
            fps: "?",
            latency: "?",
            bandwidthReceived: "?",
        }

        this.duelArena = null;
        this.duelOpponentID = null;
        this.globalDuelArenas = [];
        this.portalCooldownEndsAt = 0;
    }

    updateDynamicMapSize () {
        if (!this.core.renderer) return;
        const positions = [];
        if (this.player?.position) {
            positions.push(this.player.position);
        }
        for (const player of this.players) {
            if (player?.position) {
                positions.push(player.position);
            }
        }

        if (positions.length > 0) {
            this.core.renderer.setMapPlayerPositions(positions);
        } else {
            this.core.renderer.setMapPlayerCount(1);
        }
        // Camera uses half-world coordinates internally.
        this.core.camera.mapHalfSize = this.core.renderer.getMapSize() / 4;
    }

    // Function to reset the game to start values
    reset () {
        // !Unit ugprades will be reset when a armory is placed
        // Reset building limits to start values (reset current count to 0)
        this.buildingLimits.forEach(limit => {
            limit.current = 0;
            this.core.toolbar.updateBuildingLimit(limit.type, 0);
        });

        // Clear players and reset local player reference
        this.players = [];
        this.neutrals = [];
        this.bushes = [];
        this.rocks = [];
        this.wildPortals = [];
        this.player = null;
        this.capturedNeutrals = [];
        this.rallyPoints = [];
        this.hasCommander = false;
        this.activeBarracks = {
            current: 0,
            max: 4
        }

        this.duelArena = null;
        this.duelOpponentID = null;
        this.globalDuelArenas = [];
        this.portalCooldownEndsAt = 0;

        this.updateDynamicMapSize();
        this.core.miniMap.update();
    }

    setCommander(bool){
        this.hasCommander = bool;
        this.core.buildingManager.showCoreUpgradePanel(); // Re-Render
    }

    // Function to increase the current building limit
    increaseBuildingLimit (type) {
        const buildingLimit = this.buildingLimits.find(building => building.type === type);
        if (!buildingLimit) {
            return false;
        }

        if (buildingLimit.current < buildingLimit.limit) {
            buildingLimit.current++;
            this.core.toolbar.updateBuildingLimit(type, buildingLimit.current)
            return true;
        } else {
            return false;
        }
    }

    // Function to decrease the current building limit
    decreaseBuildingLimit (type) {
        const buildingLimit = this.buildingLimits.find(building => building.type === type);
        if (buildingLimit.current > 0) {
            buildingLimit.current--;
            this.core.toolbar.updateBuildingLimit(type, buildingLimit.current)
        }
    }

    increaseActiveBarracks (amount = 1) {
        if (this.activeBarracks.current + amount > this.activeBarracks.max) return false;
        this.activeBarracks.current += amount;
        this.core.uiManager.updateBarrackActivationTab();
        return true;
    }

    decreaseActiveBarracks (amount = 1) {
        if (this.activeBarracks.current - amount < 0) return false;
        this.activeBarracks.current -= amount;
        this.core.uiManager.updateBarrackActivationTab();
        return true;
    }

    addRallyPoint (point, barrack){
        const angleToTarget = barrack.angleToTarget

        // Calculate an offset distance to move the line start away from the barracks in the target direction
        const offsetDistance = -100; // Adjust the distance based on how far you want the line to start from the barracks
        const startX = barrack.position.x + offsetDistance * Math.cos(this.angleToTarget);
        const startY = barrack.position.y + offsetDistance * Math.sin(this.angleToTarget);


        const rallyPoint = {
            startPos:{x: startX, y: startY},
            endPos: point,
            barrack: barrack
        }

        this.rallyPoints.push(point, barrack);
    }

    startProtectionTimer () {
        // Clear any existing timer
        if (this.protectionTimer) {
            clearInterval(this.protectionTimer);
        }

        // Reset the timer
        this.resources.protectionTime.current = this.resources.protectionTime.max;

        // Start a new timer that updates every second
        this.protectionTimer = setInterval(() => {
            if (this.resources.protectionTime.current > 0) {
                this.resources.protectionTime.current--;

                this.core.uiManager.updateResources();
            } else {
                // Protection time has reached 0, clear the timer
                clearInterval(this.protectionTimer);
                this.protectionTimer = null; // Reset the timer reference
            }
        }, 60000); // Update every minute
    }

    startGameLoop () {
        const gameLoop = (currentTime) => {
            const deltaTime = (currentTime - this.previousTime); // Convert to seconds
            this.previousTime = currentTime;

            this.update(deltaTime);
            this.core.renderer.render(deltaTime);

            window.requestAnimationFrame(gameLoop);
        }

        window.requestAnimationFrame(gameLoop);
    }


    update (deltaTime) {
        this.core.inputManager.handleKeys(deltaTime);
        this.core.camera.update(deltaTime);

        if (this.player) {
            this.player.update(deltaTime);
        }

        this.players.forEach(player => player.update(deltaTime));
        this.neutrals.forEach(neutral => neutral.update(deltaTime));
    }

    setClientPlayer (player) {
        player.setAsClientPlayer();
        this.player = player;
        this.core.renderer.addToQueue(this.player, QueueType.PLAYER);
        this.updateDynamicMapSize();
        this.core.miniMap.update();
    }

    setNeutralCaptured (player, neutral) {
        const oldOwner = this.getPlayerById(neutral.ownerID);

        // Remove buildings from neutral base from building limit
        if (oldOwner && oldOwner.isClient) {
            neutral.buildings.forEach(building => {
                this.decreaseBuildingLimit(building.type);
                if(building.type === BuildingTypes.BARRACKS && building.activated){
                    this.decreaseActiveBarracks(1);
                }
            });
        }

        // Remove the neutral from the old owner's captured list if it exists
        if (oldOwner && oldOwner.capturedNeutralIds) {
            const index = oldOwner.capturedNeutralIds.indexOf(neutral.id);
            if (index !== -1) {
                oldOwner.capturedNeutralIds.splice(index, 1);
            }
        }

        // Set new owner and update the player's captured neutrals list
        neutral.setOwner(player);
        player.addCapturedNeutral(neutral);

        // If the player is the client, update the client-specific data
        if (player.isClient) {
            neutral.setAsClientPlayer();
            this.capturedNeutrals.push(neutral);
        }

        // Update the minimap to reflect the change in ownership
        this.core.miniMap.update();
    }

    addNeutral (neutral) {
        this.neutrals.push(neutral);
        this.core.renderer.addToQueue(neutral, QueueType.PLAYER);
        this.core.miniMap.update();
    }

    addBush (bush) {
        this.bushes.push(bush);
        this.core.renderer.addToQueue(bush, QueueType.OVERLAY);
        this.core.miniMap.update();
    }

    addRock (rock) {
        this.rocks.push(rock);
        this.core.renderer.addToQueue(rock, QueueType.STATIC);
        this.core.miniMap.update();
    }

    setWildPortals (portals) {
        this.wildPortals.forEach(portal => {
            this.core.renderer.removeFromQueue(portal, QueueType.OVERLAY);
        });
        this.wildPortals = [];

        portals.forEach(portal => {
            this.wildPortals.push(portal);
            this.core.renderer.addToQueue(portal, QueueType.OVERLAY);
        });
    }

    addPlayer (player) {
        this.players.push(player);
        this.core.renderer.addToQueue(player, QueueType.PLAYER);
        this.updateDynamicMapSize();
        this.core.miniMap.update();
    }

    removePlayer (playerId) {
        // Remove player from players array
        const playerToRemove = this.getPlayerById(playerId);

        // Check if player exists
        if (!playerToRemove) {
            console.log(`Player with ID ${playerId} not found.`);
            return;
        }

        playerToRemove.capturedNeutralIds.forEach(id => {
            const neutral = this.core.gameManager.getNeutralById(id);
            neutral.reset();
        });

        let playerIndex = this.players.indexOf(playerToRemove);
        if (playerIndex !== -1) {
            this.players.splice(playerIndex, 1);
        }

        // Remove player from render queue
        this.core.renderer.removeFromQueue(playerToRemove, QueueType.PLAYER);

        this.metrics.players = this.players.length;
        this.updateDynamicMapSize();
        this.core.miniMap.update();
    }

    getPlayerById (id) {
        if (this.player && this.player.id === id) {
            // This client
            return this.player;
        }
        else {
            // Other client
            return this.players.find(player => player.id == id);
        }
    }

    getNeutralById (id) {
        return this.neutrals.find(neutral => neutral.id == id);
    }

    getCurrentPlayerId () {
        return this.player ? this.player.id : 0;
    }

    subtractResources (costs) {
        this.resources.power.current -= costs;
        this.core.uiManager.updateResources();

    }

    applyUnitUpgrade (unitType, unitVariant) {
        this.unitUpgrades[unitType] = unitVariant;
    }

    setDuelArena(arena, opponentID = null) {
        this.duelArena = arena || null;
        this.duelOpponentID = opponentID ?? null;
    }

    clearDuelArena() {
        this.duelArena = null;
        this.duelOpponentID = null;
    }

    upsertGlobalDuelArena(playerAID, playerBID, arena) {
        if (!arena) return;
        const a = Math.min(playerAID, playerBID);
        const b = Math.max(playerAID, playerBID);
        const existingIndex = this.globalDuelArenas.findIndex(item => item.playerAID === a && item.playerBID === b);
        const next = { playerAID: a, playerBID: b, ...arena };
        if (existingIndex >= 0) {
            this.globalDuelArenas[existingIndex] = next;
            return;
        }
        this.globalDuelArenas.push(next);
    }

    removeGlobalDuelArenasByPlayer(playerID) {
        this.globalDuelArenas = this.globalDuelArenas.filter(item => item.playerAID !== playerID && item.playerBID !== playerID);
    }
}

export default GameManager;
