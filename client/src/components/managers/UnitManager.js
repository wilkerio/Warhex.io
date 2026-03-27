import Soldier from "../../entities/units/Soldier.js";
import Tank from "../../entities/units/Tank.js";
import SiegeTank from "../../entities/units/SiegeTank.js";
import Commander from "../../entities/units/Commander.js";
import TriCommander from "../../entities/units/TriCommander.js";
import { BuildingTypes, BuildingVariantTypes, UnitTypes, UnitVariantTypes } from "../../network/constants.js";

// Define a namespace/module for buildings
export const Units = {
    Soldier: Soldier,
    Tank: Tank,
    SiegeTank: SiegeTank,
    Commander: Commander,
    TriCommander: TriCommander
};

const unitsArray = Object.values(Units);


export default class UnitManager {
    constructor (core) {
        this.core = core;
        this.selectedUnits = [];
        this.lastCommanderHotkeyBuyAt = 0;
        this.pendingCommanderAutoSelectUntil = 0;
        this.lastSelectionControlsHintAt = 0;
        this.selectionControlsHintCooldownMs = 10000;

        this.lastTargetPosition = { x: Infinity, y: Infinity };
        this.lastMoveCommandAt = 0;
        this.minMoveCommandIntervalMs = 80;
        this.minMoveDistanceSq = 64; // 8px

        this.commanderAssistEnabled = false;
        this.commanderAssistTickIntervalMs = 90;
        this.commanderAssistPredictMs = 320;
        this.commanderAssistClusterRadius = 175;
        this.commanderAssistOvershootDistance = 85;
        this.commanderAssistVelocitySmoothing = 0.45;
        this.commanderAssistMinMoveIntervalMs = 120;
        this.commanderAssistMinTargetDistanceSq = 45 * 45;
        this.commanderAssistBuyCooldownMs = 900;
        this.commanderAssistLastTickAt = 0;
        this.commanderAssistLastMoveAt = 0;
        this.commanderAssistLastBuyAt = 0;
        this.commanderAssistLastTarget = { x: Infinity, y: Infinity };
        this.commanderAssistEnemyTrack = new Map();

        // Register mouse handlers
        this.core.inputManager.registerMouseDownHandler((mousePosition, button) => this.handleMouseDown(mousePosition, button));
        this.core.inputManager.registerMouseUpHandler((mousePosition, button) => this.handleMouseUp(mousePosition, button));
        this.core.inputManager.registerRightClickHandler((mousePosition) => this.handleRightClick(mousePosition));

        // Register event for when the selection circle is removed
        this.core.inputManager.registerSelectionCircleOnRemoveHandler((selectionCircle) => {
            this.selectUnits(selectionCircle);
            if(this.hasSelectedUnits()){
                this.core.buildingManager.deselectBuildings();
                this.core.uiManager.hideUpgrades();
            }
        });
    }

    static getUnitClassByType (type) {
        return unitsArray[type];
    }

    toggleCommanderAssistMode () {
        this.commanderAssistEnabled = !this.commanderAssistEnabled;
        this.commanderAssistLastTickAt = 0;
        this.pendingCommanderAutoSelectUntil = 0;

        if (!this.commanderAssistEnabled) {
            this.commanderAssistEnemyTrack.clear();
        }

        this.core?.uiManager?.notifySystemInfo?.(
            this.commanderAssistEnabled
                ? "Commander Assist ON (*): auto-select/buy + enemy cluster prediction."
                : "Commander Assist OFF (*)."
        );
    }

    getClientCommanderUnit () {
        const units = this.core?.gameManager?.player?.units;
        if (!Array.isArray(units)) return null;

        return units.find(unit =>
            unit && (unit.type === UnitTypes.COMMANDER || unit.type === UnitTypes.TRI_COMMANDER)
        ) || null;
    }

    normalizePlayerId (value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    }

    getAssistOpponentIds () {
        const gameManager = this.core?.gameManager;
        const opponentIds = new Set();

        const duelOpponentId = this.normalizePlayerId(gameManager?.duelOpponentID);
        if (duelOpponentId !== null) {
            opponentIds.add(duelOpponentId);
        }

        const localPlayerId = this.normalizePlayerId(
            gameManager?.getCurrentPlayerId?.() ?? gameManager?.player?.id
        );
        if (localPlayerId === null) {
            return opponentIds;
        }

        const globalDuelArenas = Array.isArray(gameManager?.globalDuelArenas) ? gameManager.globalDuelArenas : [];
        globalDuelArenas.forEach((arena) => {
            const playerAID = this.normalizePlayerId(arena?.playerAID);
            const playerBID = this.normalizePlayerId(arena?.playerBID);
            if (playerAID === null || playerBID === null) return;

            if (playerAID === localPlayerId) {
                opponentIds.add(playerBID);
            } else if (playerBID === localPlayerId) {
                opponentIds.add(playerAID);
            }
        });

        return opponentIds;
    }

    getEnemySoldiersForAssist () {
        const gameManager = this.core?.gameManager;
        const players = Array.isArray(gameManager?.players) ? gameManager.players : [];
        const localPlayerId = this.normalizePlayerId(
            gameManager?.getCurrentPlayerId?.() ?? gameManager?.player?.id
        );

        const playersById = new Map();
        players.forEach((player) => {
            const playerId = this.normalizePlayerId(player?.id);
            if (player && playerId !== null) {
                playersById.set(playerId, player);
            }
        });

        const assistOpponentIds = this.getAssistOpponentIds();
        let sourcePlayers = players;
        if (assistOpponentIds.size > 0) {
            sourcePlayers = Array.from(assistOpponentIds)
                .map((id) => playersById.get(id))
                .filter(Boolean);

            // During an active X1, never fall back to all enemies if opponent
            // mapping exists but the specific player entity is temporarily unavailable.
            if (sourcePlayers.length === 0) {
                return [];
            }
        }
        const enemySoldiers = [];

        sourcePlayers.forEach((player) => {
            if (!player) return;
            const playerId = this.normalizePlayerId(player.id);
            if ((localPlayerId !== null && playerId === localPlayerId) || player.isClient) return;

            const groups = [player.units, player.spawningUnits];
            groups.forEach((group) => {
                if (!Array.isArray(group)) return;
                group.forEach((unit) => {
                    if (!unit || unit.type !== UnitTypes.SOLDIER || unit.isFadingOut || !unit.position) return;
                    enemySoldiers.push({
                        key: `${playerId}:${unit.id}`,
                        unit
                    });
                });
            });
        });

        return enemySoldiers;
    }

    predictEnemySoldierPosition (trackedEnemy, nowMs) {
        const { key, unit } = trackedEnemy;
        const currentX = Number(unit?.position?.x || 0);
        const currentY = Number(unit?.position?.y || 0);
        const previous = this.commanderAssistEnemyTrack.get(key);

        if (!previous) {
            this.commanderAssistEnemyTrack.set(key, {
                x: currentX,
                y: currentY,
                vx: 0,
                vy: 0,
                t: nowMs
            });
            return { x: currentX, y: currentY };
        }

        const dt = Math.max(1, nowMs - previous.t);
        const instantVx = (currentX - previous.x) / dt;
        const instantVy = (currentY - previous.y) / dt;
        const smoothing = this.commanderAssistVelocitySmoothing;
        const vx = previous.vx * (1 - smoothing) + instantVx * smoothing;
        const vy = previous.vy * (1 - smoothing) + instantVy * smoothing;

        this.commanderAssistEnemyTrack.set(key, {
            x: currentX,
            y: currentY,
            vx,
            vy,
            t: nowMs
        });

        return {
            x: currentX + vx * this.commanderAssistPredictMs,
            y: currentY + vy * this.commanderAssistPredictMs
        };
    }

    findLargestEnemyCluster (predictedPoints, commanderPosition) {
        if (!Array.isArray(predictedPoints) || predictedPoints.length === 0) return null;

        const radiusSq = this.commanderAssistClusterRadius * this.commanderAssistClusterRadius;
        let bestCluster = null;

        for (let i = 0; i < predictedPoints.length; i++) {
            const anchor = predictedPoints[i];
            const members = [];

            for (let j = 0; j < predictedPoints.length; j++) {
                const candidate = predictedPoints[j];
                const dx = anchor.x - candidate.x;
                const dy = anchor.y - candidate.y;
                if (dx * dx + dy * dy <= radiusSq) {
                    members.push(candidate);
                }
            }

            if (!members.length) continue;

            const center = members.reduce((acc, point) => {
                acc.x += point.x;
                acc.y += point.y;
                return acc;
            }, { x: 0, y: 0 });

            center.x /= members.length;
            center.y /= members.length;

            const distanceToCommanderSq = (() => {
                if (!commanderPosition) return Infinity;
                const dx = center.x - commanderPosition.x;
                const dy = center.y - commanderPosition.y;
                return dx * dx + dy * dy;
            })();

            if (
                !bestCluster
                || members.length > bestCluster.count
                || (members.length === bestCluster.count && distanceToCommanderSq < bestCluster.distanceToCommanderSq)
            ) {
                bestCluster = {
                    x: center.x,
                    y: center.y,
                    count: members.length,
                    distanceToCommanderSq
                };
            }
        }

        return bestCluster;
    }

    buildCommanderAssistTarget (commanderPosition, clusterCenter) {
        const vx = clusterCenter.x - commanderPosition.x;
        const vy = clusterCenter.y - commanderPosition.y;
        const length = Math.hypot(vx, vy) || 1;

        return {
            x: clusterCenter.x + (vx / length) * this.commanderAssistOvershootDistance,
            y: clusterCenter.y + (vy / length) * this.commanderAssistOvershootDistance
        };
    }

    buyCommanderForAssist () {
        if (this.core?.gameManager?.hasCommander) return false;
        this.core?.buildingManager?.deselectBuildings?.();
        this.core?.uiManager?.hideUpgrades?.();
        this.core?.networkManager?.sendBuyCommander?.();
        return true;
    }

    updateCommanderAssist (deltaTime = 0) {
        if (!this.commanderAssistEnabled) return;

        const nowMs = Date.now();
        if (nowMs - this.commanderAssistLastTickAt < this.commanderAssistTickIntervalMs) return;
        this.commanderAssistLastTickAt = nowMs;

        if (this.core?.uiManager?.isGameplayInputBlocked?.()) return;
        if (!this.core?.gameManager?.player) return;

        let commander = this.getClientCommanderUnit();
        if (!commander) {
            if (nowMs - this.commanderAssistLastBuyAt >= this.commanderAssistBuyCooldownMs) {
                this.commanderAssistLastBuyAt = nowMs;
                this.buyCommanderForAssist();
            }
            return;
        }

        const trackedEnemies = this.getEnemySoldiersForAssist();
        if (!trackedEnemies.length) {
            this.commanderAssistEnemyTrack.clear();
            return;
        }

        const activeEnemyKeys = new Set(trackedEnemies.map(enemy => enemy.key));
        for (const key of this.commanderAssistEnemyTrack.keys()) {
            if (!activeEnemyKeys.has(key)) {
                this.commanderAssistEnemyTrack.delete(key);
            }
        }

        const predictedPoints = trackedEnemies.map((enemy) => this.predictEnemySoldierPosition(enemy, nowMs));
        const cluster = this.findLargestEnemyCluster(predictedPoints, commander.position);
        if (!cluster) return;

        const target = this.buildCommanderAssistTarget(commander.position, cluster);
        const dx = target.x - this.commanderAssistLastTarget.x;
        const dy = target.y - this.commanderAssistLastTarget.y;
        const movedEnough = (dx * dx + dy * dy) >= this.commanderAssistMinTargetDistanceSq;
        const intervalPassed = (nowMs - this.commanderAssistLastMoveAt) >= this.commanderAssistMinMoveIntervalMs;
        if (!movedEnough && !intervalPassed) return;

        this.core?.networkManager?.moveUnits?.([commander], target);
        if (typeof commander.setCannonTargetPoint === "function") {
            commander.setCannonTargetPoint({ x: cluster.x, y: cluster.y });
        }

        this.commanderAssistLastMoveAt = nowMs;
        this.commanderAssistLastTarget = target;
    }

    hasSelectedUnits () {
        this.refreshSelectionHud();
        return this.selectedUnits.length > 0;
    }

    showSelectionControlsHint () {
        if (!this.selectedUnits.length) return;

        const now = Date.now();
        if (now - this.lastSelectionControlsHintAt < this.selectionControlsHintCooldownMs) return;
        this.lastSelectionControlsHintAt = now;

        this.core?.uiManager?.addChatMessage?.(
            "System",
            "Tropa selecionada: botao direito move, botao esquerdo desseleciona.",
            "#9fd7ff"
        );
    }

    getSingleSelectedUnitHudInfo (unit) {
        if (!unit) return null;

        switch (unit.type) {
            case UnitTypes.COMMANDER:
            case UnitTypes.TRI_COMMANDER: {
                const isTriCommander = unit.type === UnitTypes.TRI_COMMANDER;
                return {
                    name: unit?.details?.name || (isTriCommander ? "Anti-Tank Commander" : "Commander"),
                    description: unit?.details?.description || "Powerful unit, you can only have 1"
                };
            }
            case UnitTypes.TANK: {
                const variant = unit.variant;
                if (
                    variant === UnitVariantTypes.TANK.CANNON ||
                    variant === UnitVariantTypes.TANK.BOOSTER_ENGINE_CANNON
                ) {
                    return {
                        name: "Cannon Tank",
                        description: "Ranged tank variant with cannon fire."
                    };
                }
                return {
                    name: "Tank",
                    description: "Armored frontline unit."
                };
            }
            case UnitTypes.SIEGE_TANK: {
                const variant = unit.variant;
                if (
                    variant === UnitVariantTypes.SIEGE_TANK.CANNON ||
                    variant === UnitVariantTypes.SIEGE_TANK.BOOSTER_ENGINE_CANNON
                ) {
                    return {
                        name: "Cannon Siege Tank",
                        description: "Long-range siege unit with heavy cannon shots."
                    };
                }
                return {
                    name: "Siege Tank",
                    description: "Heavy siege unit with high durability."
                };
            }
            default:
                return null;
        }
    }

    refreshSelectionHud () {
        const player = this.core?.gameManager?.player;
        const activeUnits = Array.isArray(player?.units) ? player.units : [];
        const spawningUnits = Array.isArray(player?.spawningUnits) ? player.spawningUnits : [];

        if (!activeUnits.length && !spawningUnits.length) {
            this.selectedUnits = [];
            this.core?.uiManager?.updateSoldierSelectionCounter?.(0, 0);
            return;
        }

        // Keep selection list synced with currently active player units.
        const activeSet = new Set(activeUnits);
        this.selectedUnits = this.selectedUnits.filter(unit => activeSet.has(unit));

        const singleSelectedUnit = this.selectedUnits.length === 1 ? this.selectedUnits[0] : null;
        const singleSelectedUnitHudInfo = this.getSingleSelectedUnitHudInfo(singleSelectedUnit);
        if (singleSelectedUnitHudInfo) {
            const bulletRange = Number(singleSelectedUnit?.bulletDetails?.range || 0);
            const rangeLabel = bulletRange > 0 ? `Range ${Math.round(bulletRange)}` : "Selected";

            this.core?.uiManager?.updateSoldierSelectionCounter?.(0, 1, {
                labelText: singleSelectedUnitHudInfo.name,
                valueText: rangeLabel,
                descriptionText: singleSelectedUnitHudInfo.description
            });
            return;
        }

        const selectedSoldiers = this.selectedUnits.reduce((count, unit) =>
            count + (unit?.type === UnitTypes.SOLDIER ? 1 : 0), 0);
        if (selectedSoldiers <= 0) {
            this.core?.uiManager?.updateSoldierSelectionCounter?.(0, 0);
            return;
        }

        const allUnits = [...activeUnits, ...spawningUnits];
        const spawnedSoldiers = activeUnits.reduce(
            (count, unit) => count + (unit?.type === UnitTypes.SOLDIER ? 1 : 0),
            0
        );

        const getUnitPopulation = (unitType) => {
            switch (unitType) {
                case UnitTypes.SOLDIER:
                    return 2;
                case UnitTypes.TANK:
                    return 15;
                case UnitTypes.SIEGE_TANK:
                    return 40;
                default:
                    return 0;
            }
        };

        const nonSoldierUsedPopulation = allUnits.reduce((total, unit) => {
            if (!unit || unit.type === UnitTypes.SOLDIER) return total;
            return total + getUnitPopulation(unit.type);
        }, 0);

        let totalPopulationCapacity = 8; // PLAYER_INITIAL_POPULATION
        const capturedNeutrals = Array.isArray(this.core?.gameManager?.capturedNeutrals)
            ? this.core.gameManager.capturedNeutrals
            : [];
        totalPopulationCapacity += capturedNeutrals.length * 32; // NEUTRAL_BASE_POPULATION

        const countHouseCapacity = (buildings = []) => buildings.reduce((cap, building) => {
            if (!building || building.type !== BuildingTypes.HOUSE) return cap;
            if (building.variant === BuildingVariantTypes.HOUSE.LARGE_HOUSE) return cap + 6;
            return cap + 3;
        }, 0);

        totalPopulationCapacity += countHouseCapacity(player?.buildings || []);
        for (const neutral of capturedNeutrals) {
            totalPopulationCapacity += countHouseCapacity(neutral?.buildings || []);
        }

        // Legacy HUD behavior: soldier counter displays population slots, not unit count.
        // One soldier consumes 2 population (e.g., one soldier appears as 2/179).
        const availableForSoldiers = Math.max(0, totalPopulationCapacity - nonSoldierUsedPopulation);
        const usedSoldierPopulation = spawnedSoldiers * 2;
        const totalSoldierPopulation = Math.max(usedSoldierPopulation, availableForSoldiers);

        this.core?.uiManager?.updateSoldierSelectionCounter?.(usedSoldierPopulation, totalSoldierPopulation);
    }

    clearSelection () {
        this.selectedUnits.forEach(unit => {
            unit.isSelected = false;
        });
        this.selectedUnits = [];
        this.refreshSelectionHud();
    }

    handleMouseDown (mousePosition, button) {
        if (button !== 0) return; // If not left click return
        if (this.core.uiManager.isDraggingChat) return;
        if (this.core.uiManager.menuOpen) return;

        if (this.hasSelectedUnits()) {
            this.clearSelection();
            return;
        }
    }

    handleRightClick (mousePosition) {
        if (!this.hasSelectedUnits()) return;
        if (this.core.uiManager.isDraggingChat) return;
        if (this.core.uiManager.menuOpen) return;

        this.sendMoveCommand(mousePosition);
    }

    sendMoveCommand (mousePosition) {
        const targetPosition = { ...mousePosition };
        this.updateSelectedUnitsCannonTarget(targetPosition);

        const now = Date.now();
        const dx = targetPosition.x - this.lastTargetPosition.x;
        const dy = targetPosition.y - this.lastTargetPosition.y;
        const movedEnough = (dx * dx + dy * dy) > this.minMoveDistanceSq;
        const intervalPassed = (now - this.lastMoveCommandAt) >= this.minMoveCommandIntervalMs;

        if (!movedEnough && !intervalPassed) {
            return;
        }

        this.core.networkManager.moveUnits(this.selectedUnits, targetPosition);
        this.lastTargetPosition = targetPosition;
        this.lastMoveCommandAt = now;
    }

    updateSelectedUnitsCannonTarget (targetPosition) {
        this.selectedUnits.forEach((unit) => {
            if (typeof unit.setCannonTargetPoint === "function") {
                unit.setCannonTargetPoint(targetPosition);
            }
        });
    }

    handleMouseUp (mousePosition, button) {
        if (button !== 2) return;
        // Fallback: some browsers/input flows may skip canvas contextmenu,
        // but still fire mouseup with right button.
        this.handleRightClick(mousePosition);
    }

    selectAllUnits(){
        this.core.gameManager.player.units.forEach(unit => { 
            if (!this.selectedUnits.includes(unit)) {
                this.selectedUnits.push(unit);
                unit.isSelected = true;
            }
        });
        this.refreshSelectionHud();
        this.showSelectionControlsHint();
    }

    selectUnitsByTypes(unitTypes = [], options = {}) {
        const { clearFirst = true } = options;
        const player = this.core?.gameManager?.player;
        if (!player?.units || !Array.isArray(unitTypes) || unitTypes.length === 0) return;

        const typeSet = new Set(unitTypes);
        if (clearFirst && !this.core.inputManager.shiftPressed) {
            this.clearSelection();
        }

        player.units.forEach(unit => {
            if (!unit || !typeSet.has(unit.type)) return;
            if (!this.selectedUnits.includes(unit)) {
                this.selectedUnits.push(unit);
            }
            unit.isSelected = true;
        });
        this.refreshSelectionHud();
        this.showSelectionControlsHint();
    }

    selectArmyCombatUnits () {
        this.selectUnitsByTypes([
            UnitTypes.SOLDIER,
            UnitTypes.TANK,
            UnitTypes.SIEGE_TANK
        ]);
    }

    selectOnlySoldiers () {
        this.selectUnitsByTypes([UnitTypes.SOLDIER]);
    }

    selectOnlyTanks () {
        this.selectUnitsByTypes([UnitTypes.TANK]);
    }

    selectOnlySiege () {
        this.selectUnitsByTypes([UnitTypes.SIEGE_TANK]);
    }

    selectCommanderUnit (options = {}) {
        const { suppressHint = false } = options;
        const player = this.core?.gameManager?.player;
        if (!player?.units) return false;

        const commander = player.units.find(unit =>
            unit && (unit.type === UnitTypes.COMMANDER || unit.type === UnitTypes.TRI_COMMANDER)
        );

        if (!commander) return false;

        if (!this.core.inputManager.shiftPressed) {
            this.clearSelection();
        }
        if (!this.selectedUnits.includes(commander)) {
            this.selectedUnits.push(commander);
        }
        commander.isSelected = true;
        this.refreshSelectionHud();
        if (!suppressHint) {
            this.showSelectionControlsHint();
        }
        return true;
    }

    selectCommanderOrBuy () {
        if (this.selectCommanderUnit()) {
            this.pendingCommanderAutoSelectUntil = 0;
            return;
        }

        // Buy commander if none exists yet (same behavior as core upgrade action).
        if (this.core?.gameManager?.hasCommander) return;

        const now = Date.now();
        if (now - this.lastCommanderHotkeyBuyAt < 350) return;
        this.lastCommanderHotkeyBuyAt = now;
        this.pendingCommanderAutoSelectUntil = now + 6000;

        // Commander hotkey buy should not leave core/building upgrade panel open,
        // otherwise users can accidentally trigger conflicting upgrade hotkeys.
        this.core?.buildingManager?.deselectBuildings?.();
        this.core?.uiManager?.hideUpgrades?.();
        this.core?.networkManager?.sendBuyCommander?.();
    }

    onClientCommanderSpawned (commanderUnit) {
        const now = Date.now();
        if (now > this.pendingCommanderAutoSelectUntil) {
            this.pendingCommanderAutoSelectUntil = 0;
            return;
        }
        if (!commanderUnit) return;
        if (commanderUnit.type !== UnitTypes.COMMANDER && commanderUnit.type !== UnitTypes.TRI_COMMANDER) return;
        this.pendingCommanderAutoSelectUntil = 0;
        this.selectCommanderUnit({ suppressHint: true });
    }

    selectCommanderWithTypes (types = []) {
        this.selectUnitsByTypes([
            UnitTypes.COMMANDER,
            UnitTypes.TRI_COMMANDER,
            ...(Array.isArray(types) ? types : [])
        ]);
    }

    selectCommanderAndSoldiers () {
        this.selectCommanderWithTypes([UnitTypes.SOLDIER]);
    }

    selectCommanderAndTanks () {
        this.selectCommanderWithTypes([UnitTypes.TANK]);
    }

    selectCommanderAndSiege () {
        this.selectCommanderWithTypes([UnitTypes.SIEGE_TANK]);
    }

    selectCommanderAndSoldiersTanks () {
        this.selectCommanderWithTypes([UnitTypes.SOLDIER, UnitTypes.TANK]);
    }

    selectCommanderAndSoldiersSiege () {
        this.selectCommanderWithTypes([UnitTypes.SOLDIER, UnitTypes.SIEGE_TANK]);
    }

    selectCommanderAndTanksSiege () {
        this.selectCommanderWithTypes([UnitTypes.TANK, UnitTypes.SIEGE_TANK]);
    }

    selectCommanderAndArmy () {
        this.selectCommanderWithTypes([UnitTypes.SOLDIER, UnitTypes.TANK, UnitTypes.SIEGE_TANK]);
    }

    selectUnits (selectionCircle) {
        if (!this.core.inputManager.shiftPressed) {
            this.clearSelection();
        }

        const rc = selectionCircle; // selection rectangle
        const r_left = rc.position.x + this.core.camera.x;
        const r_top = rc.position.y + this.core.camera.y;
        const r_right = r_left + rc.width;
        const r_bottom = r_top + rc.height;
        
        const minX = Math.min(r_left, r_right);
        const maxX = Math.max(r_left, r_right);
        const minY = Math.min(r_top, r_bottom);
        const maxY = Math.max(r_top, r_bottom);

        this.core.gameManager.player.units.forEach(unit => {
            if (unit.position.x > minX && unit.position.x < maxX && unit.position.y > minY && unit.position.y < maxY) {
                if (!this.selectedUnits.includes(unit)) {
                    this.selectedUnits.push(unit);
                    unit.isSelected = true;
                }
            }
        });
        this.refreshSelectionHud();
        this.showSelectionControlsHint();
    }
}
