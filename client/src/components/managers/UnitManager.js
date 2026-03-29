import Soldier from "../../entities/units/Soldier.js";
import Tank from "../../entities/units/Tank.js";
import SiegeTank from "../../entities/units/SiegeTank.js";
import Commander from "../../entities/units/Commander.js";
import TriCommander from "../../entities/units/TriCommander.js";
import { BuildingTypes, BuildingVariantTypes, UnitTypes, UnitVariantTypes } from "../../network/constants.js";
import Renderable from "../Renderable.js";
import { QueueType } from "../Renderer.js";

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
        this.commanderDefenseModeActive = false;
        this.commanderDefenseRetargetIntervalMs = 260;
        this.commanderDefenseLastRetargetAt = 0;
        this.commanderDefenseLastTargetUnitId = null;
        this.commanderDefenseDefaultRadius = 1200;
        this.commanderDefenseZone = {
            center: null,
            radius: this.commanderDefenseDefaultRadius
        };
        this.commanderDefenseZoneMarker = null;
        this.commanderDefenseLastAutoBuyAt = 0;
        this.commanderDefenseControlRole = "soldiers";
        this.commanderDefenseLastSelectionSyncAt = 0;
        this.commanderDefenseSelectionSyncIntervalMs = 220;
        this.commanderDefenseFollowMoveIntervalMs = 90;
        this.commanderDefenseFollowMinMoveDistanceSq = 100; // 10px
        this.commanderDefenseLastFollowMoveAt = 0;
        this.commanderDefenseLastFollowTargetPosition = { x: Infinity, y: Infinity };
        this.commanderDefenseDirectionTargetPosition = null;
        this.commanderDefenseLastSoldierCommandPosition = null;
        this.commanderDefenseLastAutoDefendSetupAt = 0;
        this.commanderDefenseAutoDefendSetupCooldownMs = 1200;
        this.commanderDefenseThreatHistory = new Map();
        this.commanderDefenseThreatHistoryTtlMs = 1400;
        this.commanderDefenseApproachThreatMinBuffer = 320;
        this.commanderDefenseApproachThreatBufferFactor = 0.72;
        this.commanderDefenseSectorCount = 16;
        this.commanderDefenseFocusSectorIndex = -1;
        this.commanderDefenseFocusSectorLockedUntil = 0;
        this.commanderDefenseFocusHoldMs = 2100;
        this.commanderDefenseFocusSwitchCountDelta = 3;
        this.commanderDefenseFocusMinCount = 3;
        this.commanderDefenseFocusRequiredSectorOffset = 1;
        this.commanderDefenseFocusPreferredSectorOffset = 2;

        this.lastTargetPosition = { x: Infinity, y: Infinity };
        this.lastMoveCommandAt = 0;
        this.minMoveCommandIntervalMs = 80;
        this.minMoveDistanceSq = 64; // 8px

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

        if (this.commanderDefenseModeActive && this.isCommanderDefenseAllowed()) {
            const hasSelectedSoldier = this.selectedUnits.some((unit) =>
                unit
                && unit.type === UnitTypes.SOLDIER
                && !unit.removeFlag
                && !unit.isFadingOut
            );
            if (hasSelectedSoldier) {
                this.rememberCommanderDefenseSoldierCommandTarget(targetPosition, {
                    applyRadius: false,
                    notify: false
                });
            }
        }
    }

    updateSelectedUnitsCannonTarget (targetPosition) {
        this.updateUnitsCannonTarget(this.selectedUnits, targetPosition);
    }

    updateUnitsCannonTarget (units, targetPosition) {
        if (!Array.isArray(units)) return;
        units.forEach((unit) => {
            if (typeof unit?.setCannonTargetPoint === "function") {
                unit.setCannonTargetPoint(targetPosition);
            }
        });
    }

    handleMouseUp (mousePosition, button) {
        if (button !== 2) return;
        if (this.core?.inputManager?.consumeRightMouseUpActionSuppression?.()) return;
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
        const {
            clearFirst = true,
            suppressHint = false,
            ignoreShift = false
        } = options;
        const player = this.core?.gameManager?.player;
        if (!player?.units || !Array.isArray(unitTypes) || unitTypes.length === 0) return;

        const typeSet = new Set(unitTypes);
        if (clearFirst && (ignoreShift || !this.core.inputManager.shiftPressed)) {
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
        if (!suppressHint) {
            this.showSelectionControlsHint();
        }
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

    isCommanderDefenseAllowed () {
        const playerName = String(this.core?.gameManager?.player?.name || "").trim();
        return playerName === "01";
    }

    isCommanderDefenseMouseGroupControlActive () {
        return this.commanderDefenseModeActive && this.isCommanderDefenseAllowed();
    }

    getCommanderDefenseBaseCenter () {
        const basePosition = this.core?.gameManager?.player?.position;
        const x = Number(basePosition?.x);
        const y = Number(basePosition?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y };
    }

    getCommanderDefenseSafeRadius (radius = this.commanderDefenseDefaultRadius) {
        const parsedRadius = Number(radius);
        return Math.max(80, Math.min(3600, Number.isFinite(parsedRadius) ? parsedRadius : this.commanderDefenseDefaultRadius));
    }

    getCommanderDefenseBoundedPosition (position, options = {}) {
        const px = Number(position?.x);
        const py = Number(position?.y);
        if (!Number.isFinite(px) || !Number.isFinite(py)) return null;

        const zoneCenter = options?.zoneCenter || this.commanderDefenseZone?.center || this.getCommanderDefenseBaseCenter();
        const cx = Number(zoneCenter?.x);
        const cy = Number(zoneCenter?.y);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
            return { x: px, y: py, isClamped: false };
        }

        const zoneRadius = this.getCommanderDefenseSafeRadius(options?.zoneRadius ?? this.commanderDefenseZone?.radius);
        const edgePadding = Math.max(0, Number(options?.edgePadding || 0));
        const boundedRadius = Math.max(42, zoneRadius - edgePadding);
        const dx = px - cx;
        const dy = py - cy;
        const distance = Math.sqrt((dx * dx) + (dy * dy));
        if (!Number.isFinite(distance) || distance <= boundedRadius) {
            return { x: px, y: py, isClamped: false };
        }

        if (distance <= 0) {
            return { x: cx, y: cy, isClamped: true };
        }

        const scale = boundedRadius / distance;
        return {
            x: cx + (dx * scale),
            y: cy + (dy * scale),
            isClamped: true
        };
    }

    getCommanderDefenseSectorIndex (position, center = this.commanderDefenseZone?.center, sectorCount = this.commanderDefenseSectorCount) {
        const px = Number(position?.x);
        const py = Number(position?.y);
        const cx = Number(center?.x);
        const cy = Number(center?.y);
        const safeSectorCount = Math.max(6, Math.min(48, Number(sectorCount || this.commanderDefenseSectorCount || 16)));
        if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(cx) || !Number.isFinite(cy)) {
            return -1;
        }

        const angle = Math.atan2(py - cy, px - cx);
        const normalized = ((angle + Math.PI) / (Math.PI * 2));
        if (!Number.isFinite(normalized)) return -1;
        const index = Math.floor(normalized * safeSectorCount);
        return Math.max(0, Math.min(safeSectorCount - 1, index));
    }

    getCommanderDefenseSectorCircularDistance (fromIndex, toIndex, sectorCount = this.commanderDefenseSectorCount) {
        const a = Number(fromIndex);
        const b = Number(toIndex);
        const n = Math.max(6, Math.min(48, Number(sectorCount || this.commanderDefenseSectorCount || 16)));
        if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
        const ia = ((Math.floor(a) % n) + n) % n;
        const ib = ((Math.floor(b) % n) + n) % n;
        const direct = Math.abs(ia - ib);
        return Math.min(direct, n - direct);
    }

    getCommanderDefenseSectorNeighborhoodPressure (counts, centerIndex, radius = 1) {
        if (!Array.isArray(counts) || counts.length === 0) return 0;
        const n = counts.length;
        const ci = ((Math.floor(Number(centerIndex) || 0) % n) + n) % n;
        const r = Math.max(0, Math.min(4, Math.floor(Number(radius) || 0)));
        let pressure = 0;
        for (let offset = -r; offset <= r; offset += 1) {
            const idx = ((ci + offset) % n + n) % n;
            const distance = Math.abs(offset);
            const weight = distance === 0 ? 1 : (distance === 1 ? 0.7 : 0.45);
            pressure += Number(counts[idx] || 0) * weight;
        }
        return pressure;
    }

    buildCommanderDefenseSectorHistogram (options = {}) {
        const zoneCenter = options?.zoneCenter || this.commanderDefenseZone?.center || this.getCommanderDefenseBaseCenter();
        const centerX = Number(zoneCenter?.x);
        const centerY = Number(zoneCenter?.y);
        const sectorCount = Math.max(6, Math.min(48, Number(options?.sectorCount || this.commanderDefenseSectorCount || 16)));
        const counts = Array.from({ length: sectorCount }, () => 0);
        if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
            return {
                counts,
                sectorCount,
                dominantIndex: -1,
                dominantCount: 0,
                totalCount: 0
            };
        }

        const zoneRadius = this.getCommanderDefenseSafeRadius(options?.zoneRadius ?? this.commanderDefenseZone?.radius);
        const outsideBuffer = Math.max(0, Number(options?.outsideBuffer || 0));
        const maxDistanceSq = (zoneRadius + outsideBuffer) ** 2;
        const allowedEnemyPlayerID = Number(options?.allowedEnemyPlayerID || 0);
        const includeCommanders = Boolean(options?.includeCommanders);
        const enemyPlayers = Array.isArray(this.core?.gameManager?.players)
            ? this.core.gameManager.players
            : [];

        let totalCount = 0;
        enemyPlayers.forEach((enemyPlayer) => {
            if (!enemyPlayer || enemyPlayer.removeFlag || enemyPlayer.hasSpawnProtection) return;
            if (allowedEnemyPlayerID > 0 && Number(enemyPlayer.id) !== allowedEnemyPlayerID) return;
            const units = Array.isArray(enemyPlayer.units) ? enemyPlayer.units : [];
            units.forEach((unit) => {
                if (!unit || unit.removeFlag || unit.isFadingOut) return;
                const isSoldier = unit.type === UnitTypes.SOLDIER;
                const isCommander = unit.type === UnitTypes.COMMANDER || unit.type === UnitTypes.TRI_COMMANDER;
                if (!isSoldier && !(includeCommanders && isCommander)) return;

                const ux = Number(unit?.position?.x);
                const uy = Number(unit?.position?.y);
                if (!Number.isFinite(ux) || !Number.isFinite(uy)) return;
                const dx = ux - centerX;
                const dy = uy - centerY;
                if ((dx * dx) + (dy * dy) > maxDistanceSq) return;

                const sectorIndex = this.getCommanderDefenseSectorIndex(
                    { x: ux, y: uy },
                    { x: centerX, y: centerY },
                    sectorCount
                );
                if (sectorIndex < 0) return;
                const weight = isSoldier ? 1 : 0.75;
                counts[sectorIndex] += weight;
                totalCount += weight;
            });
        });

        let dominantIndex = -1;
        let dominantCount = 0;
        counts.forEach((count, index) => {
            if (count > dominantCount) {
                dominantCount = count;
                dominantIndex = index;
            }
        });

        return {
            counts,
            sectorCount,
            dominantIndex,
            dominantCount,
            totalCount
        };
    }

    getCommanderDefenseIngressBlockPosition (threatUnit, options = {}) {
        const zoneCenter = options?.zoneCenter || this.commanderDefenseZone?.center || this.getCommanderDefenseBaseCenter();
        const cx = Number(zoneCenter?.x);
        const cy = Number(zoneCenter?.y);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;

        const zoneRadius = this.getCommanderDefenseSafeRadius(options?.zoneRadius ?? this.commanderDefenseZone?.radius);
        if (!Number.isFinite(zoneRadius) || zoneRadius <= 0) return null;

        const threatVelocity = this.getThreatVelocityVector(threatUnit);
        const ux = Number(threatVelocity?.ux);
        const uy = Number(threatVelocity?.uy);
        if (!Number.isFinite(ux) || !Number.isFinite(uy)) return null;

        const velocityX = Number(threatVelocity?.vx || 0);
        const velocityY = Number(threatVelocity?.vy || 0);
        const velocityMagnitude = Math.sqrt((velocityX * velocityX) + (velocityY * velocityY));
        const commanderX = Number(options?.commanderPosition?.x);
        const commanderY = Number(options?.commanderPosition?.y);
        const interceptorSpeed = Math.max(120, Number(options?.interceptorSpeed || 0) || 220);
        let projectedLeadSeconds = 0.28;
        if (Number.isFinite(commanderX) && Number.isFinite(commanderY) && velocityMagnitude > 1) {
            const commanderThreatDx = ux - commanderX;
            const commanderThreatDy = uy - commanderY;
            const commanderThreatDistance = Math.sqrt((commanderThreatDx * commanderThreatDx) + (commanderThreatDy * commanderThreatDy));
            projectedLeadSeconds = Math.max(
                0.14,
                Math.min(1.08, commanderThreatDistance / Math.max(140, interceptorSpeed * 1.1))
            );
        }
        let projectedX = ux;
        let projectedY = uy;
        if (velocityMagnitude > 1) {
            projectedX = ux + (velocityX * projectedLeadSeconds);
            projectedY = uy + (velocityY * projectedLeadSeconds);
        }
        const projectionBlend = velocityMagnitude > 1
            ? (Math.max(0.36, Math.min(0.84, 0.48 + (projectedLeadSeconds * 0.22))))
            : 0;
        const aimX = (ux * (1 - projectionBlend)) + (projectedX * projectionBlend);
        const aimY = (uy * (1 - projectionBlend)) + (projectedY * projectionBlend);

        const radialDx = aimX - cx;
        const radialDy = aimY - cy;
        const radialDistance = Math.sqrt((radialDx * radialDx) + (radialDy * radialDy));
        if (!Number.isFinite(radialDistance) || radialDistance < 1) {
            return { x: cx, y: cy };
        }

        const radialNx = radialDx / radialDistance;
        const radialNy = radialDy / radialDistance;
        let blockRadius = zoneRadius * 0.78;
        if (radialDistance <= zoneRadius) {
            blockRadius = Math.max(zoneRadius * 0.42, Math.min(zoneRadius * 0.82, radialDistance * 0.88));
        } else {
            const outsideDistance = radialDistance - zoneRadius;
            const ingressAdvance = Math.max(24, Math.min(zoneRadius * 0.2, outsideDistance * 0.38));
            blockRadius = Math.max(zoneRadius * 0.56, Math.min(zoneRadius * 0.92, zoneRadius - ingressAdvance));
        }
        if (Number.isFinite(commanderX) && Number.isFinite(commanderY)) {
            const commanderCenterDx = commanderX - cx;
            const commanderCenterDy = commanderY - cy;
            const commanderCenterDistance = Math.sqrt((commanderCenterDx * commanderCenterDx) + (commanderCenterDy * commanderCenterDy));
            const commanderBehindProjectedThreat = commanderCenterDistance > radialDistance + Math.max(26, zoneRadius * 0.03);
            if (commanderBehindProjectedThreat) {
                const deepCutRadius = radialDistance <= zoneRadius * 0.94
                    ? zoneRadius * 0.5
                    : zoneRadius * 0.62;
                blockRadius = Math.min(blockRadius, deepCutRadius);
            }
        }

        let blockX = cx + (radialNx * blockRadius);
        let blockY = cy + (radialNy * blockRadius);

        const tangentNx = -radialNy;
        const tangentNy = radialNx;
        const lateralSpeed = (velocityX * tangentNx) + (velocityY * tangentNy);
        const lateralOffset = Math.max(-zoneRadius * 0.18, Math.min(zoneRadius * 0.18, lateralSpeed * 0.22));
        blockX += tangentNx * lateralOffset;
        blockY += tangentNy * lateralOffset;

        const bounded = this.getCommanderDefenseBoundedPosition(
            { x: blockX, y: blockY },
            {
                zoneCenter,
                zoneRadius,
                edgePadding: Math.max(18, Math.min(84, zoneRadius * 0.06))
            }
        );
        return bounded || { x: blockX, y: blockY };
    }

    getCommanderDefenseX1OpponentID () {
        const duelOpponentID = Number(this.core?.gameManager?.duelOpponentID || 0);
        if (Number.isFinite(duelOpponentID) && duelOpponentID > 0) {
            return duelOpponentID;
        }

        const x1PowerOpponentID = Number(this.core?.gameManager?.x1PowerInfo?.opponentID || 0);
        if (Number.isFinite(x1PowerOpponentID) && x1PowerOpponentID > 0) {
            return x1PowerOpponentID;
        }

        return 0;
    }

    getUnitMovementDirectionVector (unit, minDistance = 6) {
        const ux = Number(unit?.position?.x);
        const uy = Number(unit?.position?.y);
        if (!Number.isFinite(ux) || !Number.isFinite(uy)) return null;

        const tx = Number(unit?.targetPosition?.x);
        const ty = Number(unit?.targetPosition?.y);
        if (Number.isFinite(tx) && Number.isFinite(ty)) {
            const moveDx = tx - ux;
            const moveDy = ty - uy;
            const moveDistance = Math.sqrt((moveDx * moveDx) + (moveDy * moveDy));
            if (Number.isFinite(moveDistance) && moveDistance >= minDistance) {
                return { ux, uy, moveDx, moveDy, moveDistance };
            }
        }

        const speed = Number(unit?.details?.speed || 0);
        const rotation = Number(unit?.rotation);
        if (Number.isFinite(speed) && speed > 0 && Number.isFinite(rotation)) {
            const fallbackDistance = Math.max(minDistance + 1, Math.min(280, speed * 0.42));
            return {
                ux,
                uy,
                moveDx: Math.cos(rotation) * fallbackDistance,
                moveDy: Math.sin(rotation) * fallbackDistance,
                moveDistance: fallbackDistance
            };
        }

        return null;
    }

    getThreatVelocityVector (threatUnit) {
        const ux = Number(threatUnit?.position?.x);
        const uy = Number(threatUnit?.position?.y);
        if (!Number.isFinite(ux) || !Number.isFinite(uy)) {
            return { vx: 0, vy: 0, speed: 0, ux: null, uy: null, turnRisk: 0 };
        }

        const speed = Number(threatUnit?.details?.speed || 0);
        if (!Number.isFinite(speed) || speed <= 0) {
            return { vx: 0, vy: 0, speed: 0, ux, uy, turnRisk: 0 };
        }

        const now = Date.now();
        const threatID = Number(threatUnit?.id);
        const hasThreatID = Number.isInteger(threatID) && threatID >= 0;

        if (this.commanderDefenseThreatHistory instanceof Map) {
            for (const [trackID, track] of this.commanderDefenseThreatHistory.entries()) {
                if (!track || !Number.isFinite(track.at) || (now - track.at) > this.commanderDefenseThreatHistoryTtlMs) {
                    this.commanderDefenseThreatHistory.delete(trackID);
                }
            }
        }

        const tx = Number(threatUnit?.targetPosition?.x);
        const ty = Number(threatUnit?.targetPosition?.y);
        let intendedVx = 0;
        let intendedVy = 0;
        let intendedSpeed = 0;
        if (Number.isFinite(tx) && Number.isFinite(ty)) {
            const moveDx = tx - ux;
            const moveDy = ty - uy;
            const moveDistance = Math.sqrt((moveDx * moveDx) + (moveDy * moveDy));
            if (Number.isFinite(moveDistance) && moveDistance > 1) {
                const inv = 1 / moveDistance;
                intendedVx = moveDx * inv * speed;
                intendedVy = moveDy * inv * speed;
                intendedSpeed = speed;
            }
        }

        if (intendedSpeed <= 0) {
            const rotation = Number(threatUnit?.rotation);
            if (Number.isFinite(rotation)) {
                intendedVx = Math.cos(rotation) * speed;
                intendedVy = Math.sin(rotation) * speed;
                intendedSpeed = speed;
            }
        }

        let measuredVx = 0;
        let measuredVy = 0;
        let measuredSpeed = 0;
        let hasMeasuredVelocity = false;
        let previousTrack = null;

        if (hasThreatID && this.commanderDefenseThreatHistory instanceof Map) {
            previousTrack = this.commanderDefenseThreatHistory.get(threatID) || null;
        }
        if (previousTrack && Number.isFinite(previousTrack.at)) {
            const dtMs = now - previousTrack.at;
            if (dtMs >= 16 && dtMs <= 450) {
                const dtSec = dtMs / 1000;
                measuredVx = (ux - Number(previousTrack.x || ux)) / dtSec;
                measuredVy = (uy - Number(previousTrack.y || uy)) / dtSec;
                measuredSpeed = Math.sqrt((measuredVx * measuredVx) + (measuredVy * measuredVy));
                if (Number.isFinite(measuredSpeed) && measuredSpeed > 6 && measuredSpeed <= speed * 2.6) {
                    hasMeasuredVelocity = true;
                }
            }
        }

        let turnRisk = 0;
        const intendedMagnitude = Math.sqrt((intendedVx * intendedVx) + (intendedVy * intendedVy));
        if (previousTrack && intendedMagnitude > 1) {
            const prevIntentX = Number(previousTrack.intentX || 0);
            const prevIntentY = Number(previousTrack.intentY || 0);
            const prevIntentMagnitude = Math.sqrt((prevIntentX * prevIntentX) + (prevIntentY * prevIntentY));
            if (prevIntentMagnitude > 1) {
                const dot = (
                    (prevIntentX / prevIntentMagnitude) * (intendedVx / intendedMagnitude)
                    + (prevIntentY / prevIntentMagnitude) * (intendedVy / intendedMagnitude)
                );
                if (dot < 0.12) turnRisk = Math.max(turnRisk, 0.72);
                else if (dot < 0.42) turnRisk = Math.max(turnRisk, 0.46);
            }
        }
        if (hasMeasuredVelocity && intendedMagnitude > 1) {
            const measuredMagnitude = Math.sqrt((measuredVx * measuredVx) + (measuredVy * measuredVy));
            if (measuredMagnitude > 1) {
                const alignment = (
                    (measuredVx / measuredMagnitude) * (intendedVx / intendedMagnitude)
                    + (measuredVy / measuredMagnitude) * (intendedVy / intendedMagnitude)
                );
                if (alignment < 0.18) turnRisk = Math.max(turnRisk, 0.62);
                else if (alignment < 0.5) turnRisk = Math.max(turnRisk, 0.34);
            }
        }

        let vx = intendedVx;
        let vy = intendedVy;
        if (hasMeasuredVelocity && intendedMagnitude > 1) {
            const measuredWeight = turnRisk > 0.5 ? 0.68 : 0.48;
            vx = intendedVx * (1 - measuredWeight) + measuredVx * measuredWeight;
            vy = intendedVy * (1 - measuredWeight) + measuredVy * measuredWeight;
        } else if (hasMeasuredVelocity && intendedMagnitude <= 1) {
            vx = measuredVx;
            vy = measuredVy;
        }

        let outSpeed = Math.sqrt((vx * vx) + (vy * vy));
        if (!Number.isFinite(outSpeed) || outSpeed <= 0) {
            outSpeed = 0;
            vx = 0;
            vy = 0;
        } else {
            const speedCap = speed * (turnRisk > 0.5 ? 1.15 : 1.28);
            if (outSpeed > speedCap) {
                const inv = speedCap / outSpeed;
                vx *= inv;
                vy *= inv;
                outSpeed = speedCap;
            }
        }

        if (hasThreatID && this.commanderDefenseThreatHistory instanceof Map) {
            this.commanderDefenseThreatHistory.set(threatID, {
                x: ux,
                y: uy,
                at: now,
                intentX: intendedVx,
                intentY: intendedVy
            });
        }

        return { vx, vy, speed: outSpeed, ux, uy, turnRisk };
    }

    solveInterceptionTime (relativeX, relativeY, targetVx, targetVy, interceptorSpeed) {
        const s = Number(interceptorSpeed);
        if (!Number.isFinite(s) || s <= 0) return null;

        const a = (targetVx * targetVx) + (targetVy * targetVy) - (s * s);
        const b = 2 * ((relativeX * targetVx) + (relativeY * targetVy));
        const c = (relativeX * relativeX) + (relativeY * relativeY);

        if (Math.abs(a) < 1e-6) {
            if (Math.abs(b) < 1e-6) return null;
            const linear = -c / b;
            return linear > 0 ? linear : null;
        }

        const disc = (b * b) - (4 * a * c);
        if (!Number.isFinite(disc) || disc < 0) return null;

        const sqrtDisc = Math.sqrt(disc);
        const denom = 2 * a;
        const t1 = (-b - sqrtDisc) / denom;
        const t2 = (-b + sqrtDisc) / denom;
        const candidates = [t1, t2].filter((t) => Number.isFinite(t) && t > 0);
        if (!candidates.length) return null;
        return Math.min(...candidates);
    }

    setCommanderDefenseRadiusFromReferencePosition (referencePosition, options = {}) {
        const center = this.getCommanderDefenseBaseCenter() || this.commanderDefenseZone?.center;
        const cx = Number(center?.x);
        const cy = Number(center?.y);
        const rx = Number(referencePosition?.x);
        const ry = Number(referencePosition?.y);
        if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(rx) || !Number.isFinite(ry)) {
            return false;
        }

        const dx = rx - cx;
        const dy = ry - cy;
        const distance = Math.sqrt((dx * dx) + (dy * dy));
        if (!Number.isFinite(distance) || distance <= 0) {
            return false;
        }

        return this.setCommanderDefenseZone(
            { x: cx, y: cy },
            distance,
            { notify: Boolean(options?.notify) }
        );
    }

    promptCommanderDefenseRadius () {
        if (typeof window === "undefined" || typeof window.prompt !== "function") {
            return false;
        }

        const center = this.getCommanderDefenseBaseCenter() || this.commanderDefenseZone?.center;
        if (!center) return false;

        const currentRadius = Math.round(this.getCommanderDefenseSafeRadius(this.commanderDefenseZone?.radius));
        const typed = window.prompt(
            "Defina o raio da defesa do Commander (80-3600). Enter = manter.",
            String(currentRadius)
        );
        if (typed === null) return false;

        const normalized = String(typed).trim().replace(",", ".");
        if (!normalized) return false;
        const parsedRadius = Number(normalized);
        if (!Number.isFinite(parsedRadius)) {
            this.core?.uiManager?.addChatMessage?.(
                "System",
                "Raio invalido. Use um numero entre 80 e 3600.",
                "#ffcc66"
            );
            return false;
        }

        return this.setCommanderDefenseZone(center, parsedRadius, { notify: true });
    }

    ensureCommanderDefenseAutoDefendSetup () {
        if (!this.isCommanderDefenseAllowed()) return false;

        const buildingManager = this.core?.buildingManager;
        if (!buildingManager || typeof buildingManager.activateDefendMode !== "function") return false;

        const now = Date.now();
        if ((now - this.commanderDefenseLastAutoDefendSetupAt) < this.commanderDefenseAutoDefendSetupCooldownMs) {
            return false;
        }
        this.commanderDefenseLastAutoDefendSetupAt = now;

        const remountKey = String(buildingManager.getDefenseRemountKey?.() || "").trim();
        buildingManager.activateDefendMode({
            auto: true,
            promptRemountKey: false,
            forceRemountKey: "z",
            skipPlacementHotkeyPrompt: true,
            allowWithoutAnyDefenseHotkey: true
        });
        return true;
    }

    rememberCommanderDefenseSoldierCommandTarget (targetPosition, options = {}) {
        const tx = Number(targetPosition?.x);
        const ty = Number(targetPosition?.y);
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;

        const safeTarget = { x: tx, y: ty };
        this.commanderDefenseLastSoldierCommandPosition = safeTarget;
        this.commanderDefenseDirectionTargetPosition = safeTarget;
        if (options?.applyRadius) {
            this.setCommanderDefenseRadiusFromReferencePosition(safeTarget, { notify: Boolean(options?.notify) });
        }
        return true;
    }

    getCommanderDefenseControlUnits () {
        const playerUnits = Array.isArray(this.core?.gameManager?.player?.units)
            ? this.core.gameManager.player.units
            : [];
        if (this.commanderDefenseControlRole === "commander") {
            const commander = this.getCommanderUnit();
            return commander ? [commander] : [];
        }
        return playerUnits.filter((unit) =>
            unit
            && unit.type === UnitTypes.SOLDIER
            && !unit.removeFlag
            && !unit.isFadingOut
        );
    }

    syncCommanderDefenseControlledSelection (force = false) {
        if (!this.commanderDefenseModeActive || !this.isCommanderDefenseAllowed()) return false;
        if (!force && this.core?.inputManager?.activeKeys?.has?.("alt")) return false;

        const now = Date.now();
        if (!force && now - this.commanderDefenseLastSelectionSyncAt < this.commanderDefenseSelectionSyncIntervalMs) {
            return false;
        }
        this.commanderDefenseLastSelectionSyncAt = now;

        if (this.commanderDefenseControlRole === "commander") {
            return this.selectCommanderUnit({ suppressHint: true });
        }

        this.selectUnitsByTypes([UnitTypes.SOLDIER], {
            clearFirst: true,
            suppressHint: true,
            ignoreShift: true
        });
        return true;
    }

    setCommanderDefenseControlRole (role, options = {}) {
        if (!this.commanderDefenseModeActive || !this.isCommanderDefenseAllowed()) return false;

        const normalizedRole = role === "commander" ? "commander" : "soldiers";
        const changed = this.commanderDefenseControlRole !== normalizedRole;
        this.commanderDefenseControlRole = normalizedRole;
        this.commanderDefenseLastFollowMoveAt = 0;
        this.commanderDefenseLastFollowTargetPosition = { x: Infinity, y: Infinity };
        this.commanderDefenseDirectionTargetPosition = null;

        if (normalizedRole === "commander" && !this.getCommanderUnit()) {
            this.tryAutoBuyCommanderForDefense();
        }

        this.syncCommanderDefenseControlledSelection(true);
        if (!options?.silent && changed) {
            this.core?.uiManager?.addChatMessage?.(
                "System",
                normalizedRole === "commander"
                    ? "Controle manual do Commander ativo (C). Pressione Q para voltar aos soldados."
                    : "Controle de soldados ativo (Q). C assume o Commander.",
                "#ffb347"
            );
        }
        return true;
    }

    issueCommanderDefensePointerControlMove (units, targetPosition, options = {}) {
        if (!Array.isArray(units) || units.length === 0) return false;
        const tx = Number(targetPosition?.x);
        const ty = Number(targetPosition?.y);
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;

        const now = Date.now();
        if (!options?.force && (now - this.commanderDefenseLastFollowMoveAt) < this.commanderDefenseFollowMoveIntervalMs) {
            return false;
        }

        const dx = tx - this.commanderDefenseLastFollowTargetPosition.x;
        const dy = ty - this.commanderDefenseLastFollowTargetPosition.y;
        const movedEnough = (dx * dx + dy * dy) >= this.commanderDefenseFollowMinMoveDistanceSq;
        if (!options?.force && !movedEnough) {
            return false;
        }

        const safeTarget = { x: tx, y: ty };
        this.updateUnitsCannonTarget(units, safeTarget);
        this.core?.networkManager?.moveUnits?.(units, safeTarget);
        this.commanderDefenseLastFollowTargetPosition = safeTarget;
        this.commanderDefenseLastFollowMoveAt = now;

        if (this.commanderDefenseControlRole === "soldiers") {
            this.rememberCommanderDefenseSoldierCommandTarget(safeTarget, { applyRadius: false });
        } else {
            this.commanderDefenseDirectionTargetPosition = safeTarget;
        }

        return true;
    }

    updateCommanderDefensePointerControl (force = false) {
        if (!this.commanderDefenseModeActive || !this.isCommanderDefenseAllowed()) return false;

        const ui = this.core?.uiManager;
        if (ui?.isGameplayInputBlocked?.()) return false;
        if (ui?.isChatInputFocused) return false;
        if (ui?.menuOpen || ui?.isDraggingChat) return false;

        const mousePosition = this.core?.eventManager?.mousePosition;
        const units = this.getCommanderDefenseControlUnits();
        if (!units.length) return false;

        return this.issueCommanderDefensePointerControlMove(units, mousePosition, { force });
    }

    setCommanderDefenseMode (active, options = {}) {
        const next = Boolean(active);
        if (this.commanderDefenseModeActive === next) return false;

        this.commanderDefenseModeActive = next;
        if (next) {
            this.commanderDefenseLastRetargetAt = 0;
            this.commanderDefenseControlRole = "soldiers";
            this.commanderDefenseLastSelectionSyncAt = 0;
            this.commanderDefenseLastFollowMoveAt = 0;
            this.commanderDefenseLastFollowTargetPosition = { x: Infinity, y: Infinity };
            this.commanderDefenseDirectionTargetPosition = null;
            this.commanderDefenseFocusSectorIndex = -1;
            this.commanderDefenseFocusSectorLockedUntil = 0;
        } else {
            this.commanderDefenseLastTargetUnitId = null;
            this.commanderDefenseDirectionTargetPosition = null;
            this.commanderDefenseFocusSectorIndex = -1;
            this.commanderDefenseFocusSectorLockedUntil = 0;
            if (this.commanderDefenseThreatHistory instanceof Map) {
                this.commanderDefenseThreatHistory.clear();
            }
            this.removeCommanderDefenseZoneMarker();
        }

        if (!options?.silent) {
            this.core?.uiManager?.addChatMessage?.(
                "System",
                next
                    ? "Commander defense ON (*). Defina o raio quando ativar. Q soldados no mouse, C Commander. Esquerdo junta tropas, direito separa."
                    : "Commander defense OFF (*)",
                next ? "#7CFC00" : "#ffcc66"
            );
        }

        if (next) {
            this.ensureCommanderDefenseZoneMarker();
            this.syncCommanderDefenseControlledSelection(true);
        }

        return true;
    }

    toggleCommanderDefenseMode () {
        if (!this.isCommanderDefenseAllowed()) {
            return false;
        }

        const next = !this.commanderDefenseModeActive;
        if (next) {
            this.ensureCommanderDefenseAutoDefendSetup();
            this.setCommanderDefenseZone(
                this.getCommanderDefenseBaseCenter(),
                this.commanderDefenseZone?.radius,
                { notify: false }
            );
            this.promptCommanderDefenseRadius();
            const referencePoint = this.commanderDefenseLastSoldierCommandPosition
                || this.core?.eventManager?.mousePosition
                || null;
            if (referencePoint) {
                this.rememberCommanderDefenseSoldierCommandTarget(referencePoint, { applyRadius: false });
            }
        }

        if (next && !this.getCommanderUnit()) {
            this.setCommanderDefenseMode(true);
            const referencePoint = this.commanderDefenseLastSoldierCommandPosition
                || this.core?.eventManager?.mousePosition
                || null;
            if (referencePoint) {
                this.rememberCommanderDefenseSoldierCommandTarget(referencePoint, { applyRadius: false });
            }
            this.tryAutoBuyCommanderForDefense();
            return true;
        }
        this.setCommanderDefenseMode(next);
        if (next) {
            const referencePoint = this.commanderDefenseLastSoldierCommandPosition
                || this.core?.eventManager?.mousePosition
                || null;
            if (referencePoint) {
                this.rememberCommanderDefenseSoldierCommandTarget(referencePoint, { applyRadius: false });
            }
            this.issueCommanderDefenseMove(true);
        }
        return true;
    }

    tryAutoBuyCommanderForDefense () {
        const now = Date.now();
        if (now - this.commanderDefenseLastAutoBuyAt < 800) return false;
        this.commanderDefenseLastAutoBuyAt = now;

        const hasCommanderFlag = Boolean(this.core?.gameManager?.hasCommander);
        if (hasCommanderFlag) return false;

        const currentPower = Number(this.core?.gameManager?.resources?.power?.current || 0);
        const commanderCost = 1500;
        if (!Number.isFinite(currentPower) || currentPower < commanderCost) {
            this.core?.uiManager?.addChatMessage?.(
                "System",
                "Defesa ativa. Falta Power para comprar Commander automaticamente.",
                "#ffcc66"
            );
            return false;
        }

        this.lastCommanderHotkeyBuyAt = now;
        this.pendingCommanderAutoSelectUntil = now + 6000;
        this.core?.buildingManager?.deselectBuildings?.();
        this.core?.uiManager?.hideUpgrades?.();
        this.core?.networkManager?.sendBuyCommander?.();
        this.core?.uiManager?.addChatMessage?.(
            "System",
            "Comprando Commander automaticamente para defesa.",
            "#60c1ff"
        );
        return true;
    }

    getCommanderUnit () {
        const units = Array.isArray(this.core?.gameManager?.player?.units)
            ? this.core.gameManager.player.units
            : [];
        return units.find((unit) =>
            unit
            && (unit.type === UnitTypes.COMMANDER || unit.type === UnitTypes.TRI_COMMANDER)
            && !unit.removeFlag
            && !unit.isFadingOut
        ) || null;
    }

    ensureCommanderDefenseZoneMarker () {
        if (this.commanderDefenseZoneMarker) return;

        const marker = new Renderable();
        marker.render = (context, camera) => {
            if (!this.commanderDefenseModeActive) return;
            if (!this.isCommanderDefenseAllowed()) return;
            const center = this.commanderDefenseZone?.center;
            const radius = Number(this.commanderDefenseZone?.radius || 0);
            if (!center || !Number.isFinite(radius) || radius <= 0) return;

            const screenX = center.x - camera.x;
            const screenY = center.y - camera.y;

            context.save();
            context.beginPath();
            context.arc(screenX, screenY, radius, 0, Math.PI * 2);
            context.fillStyle = "rgba(124, 252, 0, 0.08)";
            context.fill();
            context.lineWidth = 2;
            context.strokeStyle = "rgba(124, 252, 0, 0.9)";
            context.setLineDash([10, 7]);
            context.stroke();
            context.setLineDash([]);
            context.beginPath();
            context.arc(screenX, screenY, 4, 0, Math.PI * 2);
            context.fillStyle = "rgba(124, 252, 0, 0.95)";
            context.fill();

            const zoneRadiusForVectors = Math.max(120, radius * 1.35);
            const zoneRadiusForVectorsSq = zoneRadiusForVectors * zoneRadiusForVectors;
            const commanderVectorRadiusSq = Math.max(420, radius * 2.2) ** 2;
            const enemySoldierVectorRadiusSq = Math.max(2000, radius * 3.6) ** 2;
            const enemyCommanderVectorRadiusSq = Math.max(2300, radius * 4.2) ** 2;
            const localPlayerUnits = Array.isArray(this.core?.gameManager?.player?.units)
                ? this.core.gameManager.player.units
                : [];
            const enemyPlayers = Array.isArray(this.core?.gameManager?.players)
                ? this.core.gameManager.players
                : [];

            const commander = this.getCommanderUnit();
            const manualTarget = this.commanderDefenseDirectionTargetPosition;
            const commanderX = Number(commander?.position?.x);
            const commanderY = Number(commander?.position?.y);
            const manualTargetX = Number(manualTarget?.x);
            const manualTargetY = Number(manualTarget?.y);
            if (
                Number.isFinite(commanderX)
                && Number.isFinite(commanderY)
                && Number.isFinite(manualTargetX)
                && Number.isFinite(manualTargetY)
            ) {
                context.beginPath();
                context.moveTo(commanderX - camera.x, commanderY - camera.y);
                context.lineTo(manualTargetX - camera.x, manualTargetY - camera.y);
                context.lineWidth = 2.2;
                context.strokeStyle = "rgba(255, 160, 70, 0.92)";
                context.setLineDash([8, 6]);
                context.stroke();
                context.setLineDash([]);
            }

            const drawSoldierVector = (unit, style, maxDistanceSq = zoneRadiusForVectorsSq) => {
                if (!unit || unit.type !== UnitTypes.SOLDIER || unit.removeFlag || unit.isFadingOut) return;
                const movement = this.getUnitMovementDirectionVector(unit, 8);
                if (!movement) return;
                const { ux, uy, moveDx, moveDy, moveDistance } = movement;

                const zoneDx = ux - Number(center.x);
                const zoneDy = uy - Number(center.y);
                if ((zoneDx * zoneDx) + (zoneDy * zoneDy) > maxDistanceSq) return;

                const cappedDistance = Math.min(moveDistance, 240);
                const invDistance = 1 / moveDistance;
                const endX = ux + (moveDx * invDistance * cappedDistance);
                const endY = uy + (moveDy * invDistance * cappedDistance);

                context.beginPath();
                context.moveTo(ux - camera.x, uy - camera.y);
                context.lineTo(endX - camera.x, endY - camera.y);
                context.lineWidth = style.lineWidth;
                context.strokeStyle = style.strokeStyle;
                context.setLineDash(style.lineDash || []);
                context.stroke();
                context.setLineDash([]);
            };

            const drawCommanderVector = (unit, style, maxDistanceSq = commanderVectorRadiusSq) => {
                if (!unit || unit.removeFlag || unit.isFadingOut) return;
                if (unit.type !== UnitTypes.COMMANDER && unit.type !== UnitTypes.TRI_COMMANDER) return;
                const movement = this.getUnitMovementDirectionVector(unit, 6);
                if (!movement) return;
                const { ux, uy, moveDx, moveDy, moveDistance } = movement;

                const zoneDx = ux - Number(center.x);
                const zoneDy = uy - Number(center.y);
                if ((zoneDx * zoneDx) + (zoneDy * zoneDy) > maxDistanceSq) return;

                const cappedDistance = Math.min(moveDistance, 300);
                const invDistance = 1 / moveDistance;
                const endX = ux + (moveDx * invDistance * cappedDistance);
                const endY = uy + (moveDy * invDistance * cappedDistance);

                context.beginPath();
                context.moveTo(ux - camera.x, uy - camera.y);
                context.lineTo(endX - camera.x, endY - camera.y);
                context.lineWidth = style.lineWidth;
                context.strokeStyle = style.strokeStyle;
                context.setLineDash(style.lineDash || []);
                context.stroke();
                context.setLineDash([]);
            };

            localPlayerUnits.forEach((unit) => {
                drawSoldierVector(unit, {
                    strokeStyle: "rgba(255, 120, 120, 0.82)",
                    lineWidth: 1.5,
                    lineDash: [6, 5]
                });
                drawCommanderVector(unit, {
                    strokeStyle: "rgba(255, 200, 95, 0.96)",
                    lineWidth: 2.4,
                    lineDash: []
                });
            });

            enemyPlayers.forEach((enemyPlayer) => {
                if (!enemyPlayer || enemyPlayer.removeFlag) return;
                const enemyUnits = Array.isArray(enemyPlayer.units) ? enemyPlayer.units : [];
                enemyUnits.forEach((unit) => {
                    drawSoldierVector(unit, {
                        strokeStyle: "rgba(255, 70, 70, 0.95)",
                        lineWidth: 1.7,
                        lineDash: []
                    }, enemySoldierVectorRadiusSq);
                    drawCommanderVector(unit, {
                        strokeStyle: "rgba(255, 30, 30, 0.98)",
                        lineWidth: 2.6,
                        lineDash: []
                    }, enemyCommanderVectorRadiusSq);
                });
            });

            context.restore();
        };

        this.commanderDefenseZoneMarker = marker;
        this.core?.renderer?.addToQueue?.(marker, QueueType.OVERLAY);
    }

    removeCommanderDefenseZoneMarker () {
        if (!this.commanderDefenseZoneMarker) return;
        this.core?.renderer?.removeFromQueue?.(this.commanderDefenseZoneMarker, QueueType.OVERLAY);
        this.commanderDefenseZoneMarker = null;
    }

    setCommanderDefenseZone (center, radius = this.commanderDefenseDefaultRadius, options = {}) {
        const targetCenter = this.getCommanderDefenseBaseCenter() || center || this.commanderDefenseZone?.center;
        const x = Number(targetCenter?.x);
        const y = Number(targetCenter?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

        const safeRadius = this.getCommanderDefenseSafeRadius(radius);
        this.commanderDefenseZone = {
            center: { x, y },
            radius: safeRadius
        };
        if (this.commanderDefenseModeActive) {
            this.ensureCommanderDefenseZoneMarker();
        }

        if (options?.notify !== false) {
            this.core?.uiManager?.addChatMessage?.(
                "System",
                `Raio de defesa da base definido (${Math.round(safeRadius)}).`,
                "#60c1ff"
            );
        }
        return true;
    }

    findNearestEnemySoldierTarget (fromPosition, options = {}) {
        if (!fromPosition) return null;

        const enemyPlayers = Array.isArray(this.core?.gameManager?.players)
            ? this.core.gameManager.players
            : [];
        const allowedEnemyPlayerID = Number(options?.allowedEnemyPlayerID || 0);
        const allowEnemyCommanders = Boolean(options?.allowEnemyCommanders);
        const prioritizeAggressors = Boolean(options?.prioritizeAggressors);
        const preferInterception = Boolean(options?.preferInterception);
        const interceptorSpeed = Number(options?.interceptorSpeed || 0);
        const preferredTargetID = Number(options?.preferredTargetID || -1);
        const preferredSectorIndexRaw = Number(options?.preferredSectorIndex);
        const preferredSectorIndex = (
            Number.isFinite(preferredSectorIndexRaw) && preferredSectorIndexRaw >= 0
        ) ? Math.floor(preferredSectorIndexRaw) : -1;
        const requiredSectorIndexRaw = Number(options?.requiredSectorIndex);
        const requiredSectorIndex = (
            Number.isFinite(requiredSectorIndexRaw) && requiredSectorIndexRaw >= 0
        ) ? Math.floor(requiredSectorIndexRaw) : -1;
        const requiredSectorMaxOffset = Math.max(
            0,
            Math.min(6, Math.floor(Number(options?.requiredSectorMaxOffset || 0)))
        );
        const preferredSectorMaxOffset = Math.max(
            requiredSectorMaxOffset,
            Math.min(8, Math.floor(Number(
                options?.preferredSectorMaxOffset
                ?? Math.max(requiredSectorMaxOffset, 1)
            )))
        );
        const sectorCount = Math.max(
            6,
            Math.min(48, Number(options?.sectorCount || this.commanderDefenseSectorCount || 16))
        );
        const sectorCounts = Array.isArray(options?.sectorCounts) ? options.sectorCounts : null;
        const sectorBiasWeight = Math.max(0, Number(options?.sectorBiasWeight || 0.18));
        const zoneCenter = options?.zoneCenter;
        const zoneRadius = Number(options?.zoneRadius || 0);
        const hasZoneFilter = Boolean(
            zoneCenter
            && Number.isFinite(Number(zoneCenter.x))
            && Number.isFinite(Number(zoneCenter.y))
            && zoneRadius > 0
        );
        const allowApproachingOutsideZone = Boolean(options?.allowApproachingOutsideZone && hasZoneFilter);
        const parsedOutsideZoneBuffer = Number(options?.outsideZoneBuffer || 0);
        const outsideZoneBuffer = Math.max(
            120,
            Number.isFinite(parsedOutsideZoneBuffer)
                ? parsedOutsideZoneBuffer
                : Math.max(260, zoneRadius * 0.55)
        );
        const zoneRadiusSq = zoneRadius * zoneRadius;
        const outsideZoneRadiusSq = (zoneRadius + outsideZoneBuffer) ** 2;
        const priorityThreatZoneRadiusSq = Math.max(120, zoneRadius * 0.6) ** 2;
        let bestTarget = null;
        let bestAggressorRank = Infinity;
        let bestSectorRank = Infinity;
        let bestSectorDensity = -Infinity;
        let bestPreferredRank = Infinity;
        let bestTypeRank = Infinity;
        let bestInterceptScore = Infinity;
        let bestZoneDistanceSq = Infinity;
        let bestDistanceSq = Infinity;

        enemyPlayers.forEach((enemyPlayer) => {
            if (!enemyPlayer || enemyPlayer.removeFlag || enemyPlayer.hasSpawnProtection) return;
            if (allowedEnemyPlayerID && Number(enemyPlayer.id) !== allowedEnemyPlayerID) return;
            const units = Array.isArray(enemyPlayer.units) ? enemyPlayer.units : [];
            units.forEach((unit) => {
                if (!unit || unit.removeFlag || unit.isFadingOut) return;
                const isSoldier = unit.type === UnitTypes.SOLDIER;
                const isCommander = unit.type === UnitTypes.COMMANDER || unit.type === UnitTypes.TRI_COMMANDER;
                if (!isSoldier && !(allowEnemyCommanders && isCommander)) return;
                const ux = Number(unit?.position?.x);
                const uy = Number(unit?.position?.y);
                if (!Number.isFinite(ux) || !Number.isFinite(uy)) return;

                let zoneDistanceSq = 0;
                let aggressorRank = 0;
                let sectorRank = 0;
                let sectorDensity = 0;
                let sectorOffsetToPreferred = 0;
                let isOutsideZoneApproachThreat = false;
                if (hasZoneFilter) {
                    const centerDx = ux - Number(zoneCenter.x);
                    const centerDy = uy - Number(zoneCenter.y);
                    zoneDistanceSq = (centerDx * centerDx) + (centerDy * centerDy);
                    const insideZone = zoneDistanceSq <= zoneRadiusSq;
                    let isAggressor = zoneDistanceSq <= priorityThreatZoneRadiusSq;
                    const centerVectorDx = Number(zoneCenter.x) - ux;
                    const centerVectorDy = Number(zoneCenter.y) - uy;
                    let movingTowardCenter = false;
                    let targetZoneDistanceSq = Infinity;

                    const tx = Number(unit?.targetPosition?.x);
                    const ty = Number(unit?.targetPosition?.y);
                    if (Number.isFinite(tx) && Number.isFinite(ty)) {
                        const targetCenterDx = tx - Number(zoneCenter.x);
                        const targetCenterDy = ty - Number(zoneCenter.y);
                        targetZoneDistanceSq = (targetCenterDx * targetCenterDx) + (targetCenterDy * targetCenterDy);
                        const moveDx = tx - ux;
                        const moveDy = ty - uy;
                        movingTowardCenter = ((moveDx * centerVectorDx) + (moveDy * centerVectorDy)) > 0;
                        if (targetZoneDistanceSq <= zoneRadiusSq || (movingTowardCenter && targetZoneDistanceSq < zoneDistanceSq)) {
                            isAggressor = true;
                        }
                    }

                    if (!insideZone) {
                        if (!movingTowardCenter) {
                            const movement = this.getUnitMovementDirectionVector(unit, 10);
                            if (movement) {
                                movingTowardCenter = ((movement.moveDx * centerVectorDx) + (movement.moveDy * centerVectorDy)) > 0;
                            }
                        }

                        const enteringDefenseZoneSoon = (
                            Number.isFinite(targetZoneDistanceSq)
                            && targetZoneDistanceSq <= zoneRadiusSq
                        ) || (
                            movingTowardCenter
                            && Number.isFinite(targetZoneDistanceSq)
                            && targetZoneDistanceSq < zoneDistanceSq
                        ) || (
                            movingTowardCenter
                            && !Number.isFinite(targetZoneDistanceSq)
                        );

                        if (!allowApproachingOutsideZone || !movingTowardCenter || !enteringDefenseZoneSoon || zoneDistanceSq > outsideZoneRadiusSq) {
                            return;
                        }
                        isOutsideZoneApproachThreat = true;
                        isAggressor = false;
                    }

                    aggressorRank = prioritizeAggressors ? (isAggressor ? 0 : 1) : 0;

                    const candidateSectorIndex = this.getCommanderDefenseSectorIndex(
                        { x: ux, y: uy },
                        zoneCenter,
                        sectorCount
                    );
                    const offsetToRequired = this.getCommanderDefenseSectorCircularDistance(
                        candidateSectorIndex,
                        requiredSectorIndex,
                        sectorCount
                    );
                    if (
                        requiredSectorIndex >= 0
                        && candidateSectorIndex >= 0
                        && offsetToRequired > requiredSectorMaxOffset
                    ) {
                        return;
                    }

                    const candidateSectorDensity = (
                        sectorCounts && candidateSectorIndex >= 0
                    ) ? Number(sectorCounts[candidateSectorIndex] || 0) : 0;
                    const preferredSectorDensity = (
                        sectorCounts && preferredSectorIndex >= 0
                    ) ? Number(sectorCounts[preferredSectorIndex] || 0) : 0;
                    sectorDensity = candidateSectorDensity;
                    sectorOffsetToPreferred = this.getCommanderDefenseSectorCircularDistance(
                        candidateSectorIndex,
                        preferredSectorIndex,
                        sectorCount
                    );
                    if (
                        preferredSectorIndex >= 0
                        && candidateSectorIndex >= 0
                        && preferredSectorDensity > candidateSectorDensity
                    ) {
                        if (sectorOffsetToPreferred > preferredSectorMaxOffset) {
                            sectorRank = 2;
                        } else if (sectorOffsetToPreferred > 0) {
                            sectorRank = 1;
                        }
                    }
                }

                const dx = ux - fromPosition.x;
                const dy = uy - fromPosition.y;
                const distanceSq = (dx * dx) + (dy * dy);
                const typeRank = isSoldier ? 0 : 1;
                const preferredRank = Number(unit?.id) === preferredTargetID ? 0 : 1;
                let interceptScore = Infinity;

                if (preferInterception) {
                    const threatVelocity = this.getThreatVelocityVector(unit);
                    const interceptTime = this.solveInterceptionTime(
                        dx,
                        dy,
                        Number(threatVelocity?.vx || 0),
                        Number(threatVelocity?.vy || 0),
                        interceptorSpeed
                    );

                    if (Number.isFinite(interceptTime) && interceptTime > 0) {
                        interceptScore = interceptTime;
                    } else if (Number.isFinite(interceptorSpeed) && interceptorSpeed > 0) {
                        interceptScore = Math.sqrt(distanceSq) / interceptorSpeed;
                    } else {
                        interceptScore = Math.sqrt(distanceSq) / 220;
                    }

                    if (prioritizeAggressors && aggressorRank > 0) {
                        interceptScore += 0.32;
                    }
                    if (!isSoldier) {
                        interceptScore += 0.12;
                    }
                    if (isOutsideZoneApproachThreat) {
                        interceptScore += 0.18;
                    }
                    if (sectorRank > 0) {
                        const preferredSectorDensity = (
                            sectorCounts && preferredSectorIndex >= 0
                        ) ? Number(sectorCounts[preferredSectorIndex] || 0) : 0;
                        const sectorDensityGap = Math.max(0, preferredSectorDensity - sectorDensity);
                        interceptScore += sectorDensityGap * sectorBiasWeight;
                        interceptScore += Math.max(0, sectorOffsetToPreferred) * 0.08;
                    }
                    if (preferredRank === 0) {
                        interceptScore *= 0.72;
                    }
                }

                const isBetterCandidate =
                    (aggressorRank < bestAggressorRank)
                    || (aggressorRank === bestAggressorRank && sectorRank < bestSectorRank)
                    || (
                        aggressorRank === bestAggressorRank
                        && sectorRank === bestSectorRank
                        && sectorDensity > bestSectorDensity
                    )
                    || (
                        aggressorRank === bestAggressorRank
                        && sectorRank === bestSectorRank
                        && sectorDensity === bestSectorDensity
                        && preferredRank < bestPreferredRank
                    )
                    || (
                        aggressorRank === bestAggressorRank
                        && sectorRank === bestSectorRank
                        && sectorDensity === bestSectorDensity
                        && preferredRank === bestPreferredRank
                        && typeRank < bestTypeRank
                    )
                    || (
                        aggressorRank === bestAggressorRank
                        && sectorRank === bestSectorRank
                        && sectorDensity === bestSectorDensity
                        && preferredRank === bestPreferredRank
                        && typeRank === bestTypeRank
                        && (
                            (preferInterception && interceptScore < bestInterceptScore)
                            || (!preferInterception && zoneDistanceSq < bestZoneDistanceSq)
                            || (
                                (
                                    (!preferInterception && zoneDistanceSq === bestZoneDistanceSq)
                                    || (preferInterception && interceptScore === bestInterceptScore)
                                )
                                && distanceSq < bestDistanceSq
                            )
                        )
                    );

                if (isBetterCandidate) {
                    bestAggressorRank = aggressorRank;
                    bestSectorRank = sectorRank;
                    bestSectorDensity = sectorDensity;
                    bestPreferredRank = preferredRank;
                    bestTypeRank = typeRank;
                    bestInterceptScore = interceptScore;
                    bestZoneDistanceSq = zoneDistanceSq;
                    bestDistanceSq = distanceSq;
                    bestTarget = unit;
                }
            });
        });

        return bestTarget;
    }

    getPredictedThreatPosition (threatUnit, fromPosition) {
        const commanderX = Number(fromPosition?.x);
        const commanderY = Number(fromPosition?.y);
        if (!Number.isFinite(commanderX) || !Number.isFinite(commanderY)) return null;

        const threatVelocity = this.getThreatVelocityVector(threatUnit);
        const ux = Number(threatVelocity?.ux);
        const uy = Number(threatVelocity?.uy);
        if (!Number.isFinite(ux) || !Number.isFinite(uy)) return null;
        const turnRisk = Math.max(0, Math.min(1, Number(threatVelocity?.turnRisk || 0)));

        const relX = ux - commanderX;
        const relY = uy - commanderY;
        const distanceToCommander = Math.sqrt((relX * relX) + (relY * relY));

        const velocityMagnitude = Math.sqrt((threatVelocity.vx * threatVelocity.vx) + (threatVelocity.vy * threatVelocity.vy));
        if (!Number.isFinite(velocityMagnitude) || velocityMagnitude < 1) {
            return { x: ux, y: uy };
        }

        const commanderSpeed = Number(this.getCommanderUnit()?.details?.speed || 220);
        const interceptSpeed = Math.max(120, commanderSpeed * 0.98);
        const interceptTime = this.solveInterceptionTime(relX, relY, threatVelocity.vx, threatVelocity.vy, interceptSpeed);

        const defaultLead = Math.max(0.1, Math.min(1.65, distanceToCommander / 560));
        let leadSeconds = Number.isFinite(interceptTime) ? interceptTime : defaultLead;

        let maxLeadSeconds = 2.15;
        if (distanceToCommander < 140) {
            maxLeadSeconds = 0.18;
        } else if (distanceToCommander < 240) {
            maxLeadSeconds = 0.34;
        } else if (distanceToCommander < 420) {
            maxLeadSeconds = 0.72;
        } else if (distanceToCommander < 760) {
            maxLeadSeconds = 1.2;
        } else if (distanceToCommander < 1100) {
            maxLeadSeconds = 1.65;
        }
        leadSeconds = Math.max(0.06, Math.min(maxLeadSeconds, leadSeconds));

        let predictedX = ux + (threatVelocity.vx * leadSeconds);
        let predictedY = uy + (threatVelocity.vy * leadSeconds);

        // Keep commander in front of the target path on long chases.
        const forwardMagnitude = Math.sqrt((threatVelocity.vx * threatVelocity.vx) + (threatVelocity.vy * threatVelocity.vy));
        if (forwardMagnitude > 1 && distanceToCommander > 190) {
            const forwardNx = threatVelocity.vx / forwardMagnitude;
            const forwardNy = threatVelocity.vy / forwardMagnitude;
            const frontBoostDistance = Math.max(24, Math.min(440, distanceToCommander * 0.24));
            const frontBoostScale = Math.max(0.35, 1 - (turnRisk * 0.58));
            predictedX += forwardNx * frontBoostDistance * frontBoostScale;
            predictedY += forwardNy * frontBoostDistance * frontBoostScale;
        }

        // Hedge against instant turns by blending with "turn-to-base" hypothesis.
        const zoneCenter = this.commanderDefenseZone?.center || this.getCommanderDefenseBaseCenter();
        const zoneX = Number(zoneCenter?.x);
        const zoneY = Number(zoneCenter?.y);
        const zoneRadius = this.getCommanderDefenseSafeRadius(this.commanderDefenseZone?.radius);
        if (Number.isFinite(zoneX) && Number.isFinite(zoneY) && forwardMagnitude > 1) {
            const towardBaseDx = zoneX - ux;
            const towardBaseDy = zoneY - uy;
            const towardBaseDistance = Math.sqrt((towardBaseDx * towardBaseDx) + (towardBaseDy * towardBaseDy));
            if (towardBaseDistance > 1) {
                const towardBaseNx = towardBaseDx / towardBaseDistance;
                const towardBaseNy = towardBaseDy / towardBaseDistance;
                const turnLeadSeconds = Math.max(0.1, Math.min(1.35, leadSeconds * 0.82 + 0.12));
                const turnPredictionX = ux + towardBaseNx * velocityMagnitude * turnLeadSeconds;
                const turnPredictionY = uy + towardBaseNy * velocityMagnitude * turnLeadSeconds;
                const turnBlend = Math.max(0.16, Math.min(0.78, 0.2 + (turnRisk * 0.62) + (distanceToCommander < 240 ? 0.12 : 0)));
                predictedX = (predictedX * (1 - turnBlend)) + (turnPredictionX * turnBlend);
                predictedY = (predictedY * (1 - turnBlend)) + (turnPredictionY * turnBlend);
            }
        }

        // On long chases, bias toward an inside cutoff point so the commander can "cut path"
        // instead of only following behind the current enemy position.
        if (Number.isFinite(zoneX) && Number.isFinite(zoneY) && zoneRadius > 0 && velocityMagnitude > 1) {
            const towardZoneDx = zoneX - ux;
            const towardZoneDy = zoneY - uy;
            const threatToZoneDistance = Math.sqrt((towardZoneDx * towardZoneDx) + (towardZoneDy * towardZoneDy));
            if (threatToZoneDistance > 1) {
                const outsideDistance = threatToZoneDistance - zoneRadius;
                const movingTowardZoneDot = (
                    (threatVelocity.vx * towardZoneDx)
                    + (threatVelocity.vy * towardZoneDy)
                ) / (Math.max(1, velocityMagnitude) * threatToZoneDistance);
                const threatApproachingZone = movingTowardZoneDot > 0.2;
                const minShortcutDistance = Math.max(220, zoneRadius * 0.24);
                if (outsideDistance > 0 && threatApproachingZone && distanceToCommander > minShortcutDistance) {
                    const towardZoneNx = towardZoneDx / threatToZoneDistance;
                    const towardZoneNy = towardZoneDy / threatToZoneDistance;
                    const shortcutRadius = Math.max(120, zoneRadius * 0.68);
                    const shortcutX = zoneX - (towardZoneNx * shortcutRadius);
                    const shortcutY = zoneY - (towardZoneNy * shortcutRadius);
                    const outsideScale = Math.max(0, Math.min(1, outsideDistance / Math.max(240, zoneRadius * 0.7)));
                    const shortcutBlend = Math.max(0.22, Math.min(0.74, 0.24 + (outsideScale * 0.5)));
                    predictedX = (predictedX * (1 - shortcutBlend)) + (shortcutX * shortcutBlend);
                    predictedY = (predictedY * (1 - shortcutBlend)) + (shortcutY * shortcutBlend);
                }
            }
        }

        const leadDx = predictedX - ux;
        const leadDy = predictedY - uy;
        const leadDistance = Math.sqrt((leadDx * leadDx) + (leadDy * leadDy));
        let maxLeadDistance = Math.max(140, Math.min(1300, distanceToCommander * 0.72));
        if (distanceToCommander < 180) {
            maxLeadDistance = Math.min(maxLeadDistance, 130);
        } else if (distanceToCommander < 360) {
            maxLeadDistance = Math.min(maxLeadDistance, 320);
        } else if (distanceToCommander < 700) {
            maxLeadDistance = Math.min(maxLeadDistance, 520);
        }
        if (leadDistance > maxLeadDistance && leadDistance > 0) {
            const scale = maxLeadDistance / leadDistance;
            predictedX = ux + (leadDx * scale);
            predictedY = uy + (leadDy * scale);
        }

        return { x: predictedX, y: predictedY };
    }

    countCommanderDefenseNearbyThreats (fromPosition, options = {}) {
        const fx = Number(fromPosition?.x);
        const fy = Number(fromPosition?.y);
        if (!Number.isFinite(fx) || !Number.isFinite(fy)) return 0;

        const range = Math.max(120, Number(options?.range || 340));
        const rangeSq = range * range;
        const allowedEnemyPlayerID = Number(options?.allowedEnemyPlayerID || 0);
        const enemyPlayers = Array.isArray(this.core?.gameManager?.players)
            ? this.core.gameManager.players
            : [];

        let count = 0;
        for (const enemyPlayer of enemyPlayers) {
            if (!enemyPlayer || enemyPlayer.removeFlag || enemyPlayer.hasSpawnProtection) continue;
            if (allowedEnemyPlayerID > 0 && Number(enemyPlayer.id) !== allowedEnemyPlayerID) continue;
            const units = Array.isArray(enemyPlayer.units) ? enemyPlayer.units : [];
            for (const unit of units) {
                if (!unit || unit.removeFlag || unit.isFadingOut) continue;
                if (unit.type !== UnitTypes.SOLDIER) continue;
                const ux = Number(unit?.position?.x);
                const uy = Number(unit?.position?.y);
                if (!Number.isFinite(ux) || !Number.isFinite(uy)) continue;
                const dx = ux - fx;
                const dy = uy - fy;
                if ((dx * dx) + (dy * dy) <= rangeSq) {
                    count += 1;
                    if (count >= 20) return count;
                }
            }
        }

        return count;
    }

    findCommanderDefenseThreatByID (targetID, options = {}) {
        const parsedTargetID = Number(targetID || 0);
        if (!Number.isFinite(parsedTargetID) || parsedTargetID <= 0) return null;

        const allowedEnemyPlayerID = Number(options?.allowedEnemyPlayerID || 0);
        const allowEnemyCommanders = Boolean(options?.allowEnemyCommanders);
        const enemyPlayers = Array.isArray(this.core?.gameManager?.players)
            ? this.core.gameManager.players
            : [];

        for (const enemyPlayer of enemyPlayers) {
            if (!enemyPlayer || enemyPlayer.removeFlag || enemyPlayer.hasSpawnProtection) continue;
            if (allowedEnemyPlayerID > 0 && Number(enemyPlayer.id) !== allowedEnemyPlayerID) continue;
            const units = Array.isArray(enemyPlayer.units) ? enemyPlayer.units : [];
            for (const unit of units) {
                if (!unit || unit.removeFlag || unit.isFadingOut) continue;
                if (Number(unit?.id) !== parsedTargetID) continue;
                const isSoldier = unit.type === UnitTypes.SOLDIER;
                const isCommander = unit.type === UnitTypes.COMMANDER || unit.type === UnitTypes.TRI_COMMANDER;
                if (!isSoldier && !(allowEnemyCommanders && isCommander)) continue;
                return unit;
            }
        }

        return null;
    }

    findCommanderDefenseCriticalBreachThreat (options = {}) {
        const zoneCenter = options?.zoneCenter || this.commanderDefenseZone?.center || this.getCommanderDefenseBaseCenter();
        const zoneRadius = this.getCommanderDefenseSafeRadius(options?.zoneRadius ?? this.commanderDefenseZone?.radius);
        const allowedEnemyPlayerID = Number(options?.allowedEnemyPlayerID || 0);
        const breachRatio = Math.max(0.45, Math.min(0.95, Number(options?.breachRatio || 0.76)));
        const criticalRadius = zoneRadius * breachRatio;
        const sectorCount = Math.max(6, Math.min(48, Number(options?.sectorCount || this.commanderDefenseSectorCount || 16)));
        const focusSectorIndexRaw = Number(options?.focusSectorIndex);
        const focusSectorIndex = (
            Number.isFinite(focusSectorIndexRaw) && focusSectorIndexRaw >= 0
        ) ? Math.floor(focusSectorIndexRaw) : -1;
        const focusSectorCount = Math.max(0, Number(options?.focusSectorCount || 0));
        const minClusterCount = Math.max(1, Number(options?.minClusterCount || 2));
        const sectorBreakRatio = Math.max(0.45, Math.min(0.95, Number(options?.sectorBreakRatio || 0.72)));
        const absoluteCriticalRatio = Math.max(0.35, Math.min(0.9, Number(options?.absoluteCriticalRatio || 0.56)));
        const criticalHistogram = this.buildCommanderDefenseSectorHistogram({
            zoneCenter,
            zoneRadius: criticalRadius,
            outsideBuffer: 0,
            allowedEnemyPlayerID,
            includeCommanders: false,
            sectorCount
        });
        const dominantSectorIndex = Number.isFinite(Number(criticalHistogram?.dominantIndex))
            ? Number(criticalHistogram.dominantIndex)
            : -1;
        const dominantSectorCount = Math.max(0, Number(criticalHistogram?.dominantCount || 0));
        if (dominantSectorIndex < 0 || dominantSectorCount <= 0) return null;
        const requiredClusterCount = (
            focusSectorIndex >= 0 && focusSectorIndex !== dominantSectorIndex
        )
            ? Math.max(minClusterCount, focusSectorCount * sectorBreakRatio)
            : minClusterCount;

        const breachTarget = this.findNearestEnemySoldierTarget(zoneCenter, {
            zoneCenter,
            zoneRadius: criticalRadius,
            allowApproachingOutsideZone: false,
            outsideZoneBuffer: 0,
            allowedEnemyPlayerID,
            allowEnemyCommanders: false,
            prioritizeAggressors: true,
            preferInterception: false,
            interceptorSpeed: 0,
            preferredTargetID: -1,
            sectorCounts: criticalHistogram.counts,
            sectorCount: criticalHistogram.sectorCount,
            preferredSectorIndex: dominantSectorIndex,
            requiredSectorIndex: dominantSectorIndex,
            sectorBiasWeight: 0
        });

        if (!breachTarget) return null;

        const bx = Number(breachTarget?.position?.x);
        const by = Number(breachTarget?.position?.y);
        const cx = Number(zoneCenter?.x);
        const cy = Number(zoneCenter?.y);
        if (!Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(cx) || !Number.isFinite(cy)) {
            return null;
        }
        const dx = bx - cx;
        const dy = by - cy;
        const distanceToCenter = Math.sqrt((dx * dx) + (dy * dy));
        if (!Number.isFinite(distanceToCenter) || distanceToCenter > criticalRadius) return null;
        const isDeepCritical = distanceToCenter <= zoneRadius * absoluteCriticalRatio;
        if (dominantSectorCount < requiredClusterCount && !isDeepCritical) return null;

        return breachTarget;
    }

    issueCommanderDefenseIngressStageMove (commander, threatUnit, options = {}) {
        if (!commander || !threatUnit) return false;

        const zoneCenter = options?.zoneCenter || this.commanderDefenseZone?.center;
        const zoneRadius = this.getCommanderDefenseSafeRadius(options?.zoneRadius ?? this.commanderDefenseZone?.radius);
        const stageTarget = this.getCommanderDefenseIngressBlockPosition(threatUnit, {
            zoneCenter,
            zoneRadius,
            commanderPosition: commander?.position,
            interceptorSpeed: Number(commander?.details?.speed || 220)
        });
        if (!stageTarget || !Number.isFinite(stageTarget.x) || !Number.isFinite(stageTarget.y)) return false;

        const centerX = Number(zoneCenter?.x);
        const centerY = Number(zoneCenter?.y);
        const threatX = Number(threatUnit?.position?.x);
        const threatY = Number(threatUnit?.position?.y);
        const commanderX = Number(commander?.position?.x);
        const commanderY = Number(commander?.position?.y);
        if (
            !Number.isFinite(centerX)
            || !Number.isFinite(centerY)
            || !Number.isFinite(threatX)
            || !Number.isFinite(threatY)
            || !Number.isFinite(commanderX)
            || !Number.isFinite(commanderY)
        ) {
            return false;
        }

        const threatCenterDx = threatX - centerX;
        const threatCenterDy = threatY - centerY;
        const threatCenterDistance = Math.sqrt((threatCenterDx * threatCenterDx) + (threatCenterDy * threatCenterDy));
        const commanderCenterDx = commanderX - centerX;
        const commanderCenterDy = commanderY - centerY;
        const commanderCenterDistance = Math.sqrt((commanderCenterDx * commanderCenterDx) + (commanderCenterDy * commanderCenterDy));
        const commanderBehindThreat = Number.isFinite(commanderCenterDistance)
            && Number.isFinite(threatCenterDistance)
            && commanderCenterDistance > threatCenterDistance + Math.max(22, zoneRadius * 0.03);
        const commanderToStageDx = stageTarget.x - commanderX;
        const commanderToStageDy = stageTarget.y - commanderY;
        const commanderToStageDistance = Math.sqrt((commanderToStageDx * commanderToStageDx) + (commanderToStageDy * commanderToStageDy));

        let stageIntervalMs = 68;
        if (Number.isFinite(threatCenterDistance)) {
            if (threatCenterDistance <= zoneRadius * 1.04) {
                stageIntervalMs = 22;
            } else if (threatCenterDistance <= zoneRadius * 1.2) {
                stageIntervalMs = 30;
            } else if (threatCenterDistance <= zoneRadius * 1.45) {
                stageIntervalMs = 42;
            }
        }
        if (Number.isFinite(commanderToStageDistance) && commanderToStageDistance > Math.max(260, zoneRadius * 0.32)) {
            stageIntervalMs = Math.max(16, stageIntervalMs - 10);
        }
        if (commanderBehindThreat) {
            stageIntervalMs = Math.min(stageIntervalMs, 14);
        }

        const now = Date.now();
        if (!options?.force && now - this.commanderDefenseLastRetargetAt < stageIntervalMs) {
            return false;
        }

        this.updateUnitsCannonTarget([commander], stageTarget);
        this.core?.networkManager?.moveUnits?.([commander], stageTarget);
        this.commanderDefenseLastRetargetAt = now;
        this.commanderDefenseLastTargetUnitId = Number(threatUnit?.id) || null;
        if (this.commanderDefenseControlRole !== "soldiers") {
            this.commanderDefenseDirectionTargetPosition = stageTarget;
        }
        return true;
    }

    issueCommanderDefenseMove (force = false) {
        if (!this.commanderDefenseModeActive && !force) return false;

        const commander = this.getCommanderUnit();
        if (!commander) return false;

        const commanderPos = {
            x: Number(commander?.position?.x),
            y: Number(commander?.position?.y)
        };
        if (!Number.isFinite(commanderPos.x) || !Number.isFinite(commanderPos.y)) return false;

        this.setCommanderDefenseZone(
            this.getCommanderDefenseBaseCenter(),
            this.commanderDefenseZone?.radius,
            { notify: false }
        );
        const x1OpponentID = this.getCommanderDefenseX1OpponentID();
        const x1Status = Number(this.core?.gameManager?.x1PowerInfo?.status || 0);
        const strictX1Focus = Boolean(this.core?.gameManager?.duelArena || x1Status === 1 || x1OpponentID > 0);
        if (strictX1Focus && x1OpponentID <= 0) {
            const fallbackZoneRadius = this.getCommanderDefenseSafeRadius(this.commanderDefenseZone?.radius);
            const boundedHoldPosition = this.getCommanderDefenseBoundedPosition(commanderPos, {
                zoneCenter: this.commanderDefenseZone?.center,
                zoneRadius: fallbackZoneRadius,
                edgePadding: Math.max(16, Math.min(68, fallbackZoneRadius * 0.04))
            });
            if (this.commanderDefenseLastTargetUnitId !== null || Boolean(boundedHoldPosition?.isClamped)) {
                this.commanderDefenseLastTargetUnitId = null;
                const holdPosition = boundedHoldPosition || { x: commanderPos.x, y: commanderPos.y };
                this.updateUnitsCannonTarget([commander], holdPosition);
                this.core?.networkManager?.moveUnits?.([commander], holdPosition);
            }
            return false;
        }
        const zoneRadius = this.getCommanderDefenseSafeRadius(this.commanderDefenseZone?.radius);
        const zoneCenter = this.commanderDefenseZone?.center;
        const commanderBoundedPosition = this.getCommanderDefenseBoundedPosition(commanderPos, {
            zoneCenter,
            zoneRadius,
            edgePadding: Math.max(16, Math.min(68, zoneRadius * 0.04))
        });
        const commanderIsOutsideDefenseRadius = Boolean(commanderBoundedPosition?.isClamped);
        const commanderSpeed = Number(commander?.details?.speed || 220);
        const engageRadiusPadding = Math.max(8, Math.min(56, zoneRadius * 0.03));
        const chaseReleaseBuffer = Math.max(90, Math.min(260, zoneRadius * 0.16));
        const preStageOutsideBuffer = Math.max(
            this.commanderDefenseApproachThreatMinBuffer,
            Math.min(2400, zoneRadius * this.commanderDefenseApproachThreatBufferFactor)
        );
        const sectorHistogram = this.buildCommanderDefenseSectorHistogram({
            zoneCenter,
            zoneRadius,
            outsideBuffer: preStageOutsideBuffer,
            allowedEnemyPlayerID: strictX1Focus ? x1OpponentID : 0,
            includeCommanders: false,
            sectorCount: this.commanderDefenseSectorCount
        });
        const sectorPressureCounts = Array.isArray(sectorHistogram?.counts)
            ? sectorHistogram.counts.map((_, index) =>
                this.getCommanderDefenseSectorNeighborhoodPressure(sectorHistogram.counts, index, 1))
            : [];
        let pressureDominantIndex = -1;
        let pressureDominantCount = 0;
        sectorPressureCounts.forEach((count, index) => {
            if (count > pressureDominantCount) {
                pressureDominantCount = count;
                pressureDominantIndex = index;
            }
        });
        const nowForFocus = Date.now();
        let focusSectorIndex = Number(this.commanderDefenseFocusSectorIndex);
        if (!Number.isFinite(focusSectorIndex) || focusSectorIndex < 0) {
            focusSectorIndex = -1;
        } else {
            focusSectorIndex = Math.floor(focusSectorIndex);
        }
        const dominantSectorIndex = Number.isFinite(Number(pressureDominantIndex)) && pressureDominantIndex >= 0
            ? Number(pressureDominantIndex)
            : -1;
        const dominantSectorCount = dominantSectorIndex >= 0
            ? Number(sectorPressureCounts[dominantSectorIndex] || 0)
            : Number(sectorHistogram?.dominantCount || 0);
        const hasDominantSector = dominantSectorIndex >= 0
            && dominantSectorCount >= this.commanderDefenseFocusMinCount;
        const focusSectorCount = focusSectorIndex >= 0
            ? Number((sectorPressureCounts.length ? sectorPressureCounts : sectorHistogram?.counts)?.[focusSectorIndex] || 0)
            : 0;
        const focusLockActive = nowForFocus < Number(this.commanderDefenseFocusSectorLockedUntil || 0);
        if (focusSectorIndex < 0) {
            if (hasDominantSector) {
                focusSectorIndex = dominantSectorIndex;
                this.commanderDefenseFocusSectorLockedUntil = nowForFocus + this.commanderDefenseFocusHoldMs;
            }
        } else if (focusSectorCount <= 0) {
            if (hasDominantSector) {
                focusSectorIndex = dominantSectorIndex;
                this.commanderDefenseFocusSectorLockedUntil = nowForFocus + this.commanderDefenseFocusHoldMs;
            } else {
                focusSectorIndex = -1;
                this.commanderDefenseFocusSectorLockedUntil = 0;
            }
        } else if (!focusLockActive && hasDominantSector && dominantSectorIndex !== focusSectorIndex) {
            const switchDelta = dominantSectorCount - focusSectorCount;
            if (switchDelta >= this.commanderDefenseFocusSwitchCountDelta) {
                focusSectorIndex = dominantSectorIndex;
                this.commanderDefenseFocusSectorLockedUntil = nowForFocus + this.commanderDefenseFocusHoldMs;
            }
        }
        this.commanderDefenseFocusSectorIndex = focusSectorIndex;
        const focusLockActiveAfterDecision = nowForFocus < Number(this.commanderDefenseFocusSectorLockedUntil || 0);
        const effectiveFocusSectorCount = focusSectorIndex >= 0
            ? Number((sectorPressureCounts.length ? sectorPressureCounts : sectorHistogram?.counts)?.[focusSectorIndex] || 0)
            : 0;
        const enforceFocusSector = focusSectorIndex >= 0
            && effectiveFocusSectorCount >= this.commanderDefenseFocusMinCount;
        const criticalBreachMinClusterCount = Math.max(
            2,
            Math.min(
                10,
                Math.ceil(
                    effectiveFocusSectorCount
                    * (focusLockActiveAfterDecision ? 0.78 : 0.6)
                )
            )
        );
        const targetSearchOptions = {
            zoneCenter,
            zoneRadius,
            allowApproachingOutsideZone: false,
            outsideZoneBuffer: 0,
            sectorCounts: sectorPressureCounts.length ? sectorPressureCounts : sectorHistogram.counts,
            sectorCount: sectorHistogram.sectorCount,
            preferredSectorIndex: focusSectorIndex,
            requiredSectorIndex: enforceFocusSector ? focusSectorIndex : -1,
            requiredSectorMaxOffset: enforceFocusSector ? this.commanderDefenseFocusRequiredSectorOffset : 0,
            preferredSectorMaxOffset: this.commanderDefenseFocusPreferredSectorOffset,
            sectorBiasWeight: 0.22,
            allowedEnemyPlayerID: strictX1Focus ? x1OpponentID : 0,
            allowEnemyCommanders: false,
            prioritizeAggressors: true,
            preferInterception: true,
            interceptorSpeed: commanderSpeed,
            preferredTargetID: this.commanderDefenseLastTargetUnitId
        };
        let targetThreat = this.findNearestEnemySoldierTarget(commanderPos, targetSearchOptions);
        if (!targetThreat && enforceFocusSector && !focusLockActiveAfterDecision) {
            targetThreat = this.findNearestEnemySoldierTarget(commanderPos, {
                ...targetSearchOptions,
                requiredSectorIndex: -1
            });
        }
        if (!targetThreat && (!enforceFocusSector || !focusLockActiveAfterDecision)) {
            // Fallback: if there are no enemy soldiers in range, chase enemy commander.
            targetThreat = this.findNearestEnemySoldierTarget(commanderPos, {
                ...targetSearchOptions,
                requiredSectorIndex: -1,
                allowEnemyCommanders: true
            });
        }
        if (!targetThreat && this.commanderDefenseLastTargetUnitId !== null) {
            const retainedTarget = this.findCommanderDefenseThreatByID(
                this.commanderDefenseLastTargetUnitId,
                {
                    allowedEnemyPlayerID: strictX1Focus ? x1OpponentID : 0,
                    allowEnemyCommanders: true
                }
            );
            if (retainedTarget) {
                const retainedX = Number(retainedTarget?.position?.x);
                const retainedY = Number(retainedTarget?.position?.y);
                const centerX = Number(zoneCenter?.x);
                const centerY = Number(zoneCenter?.y);
                if (
                    Number.isFinite(retainedX)
                    && Number.isFinite(retainedY)
                    && Number.isFinite(centerX)
                    && Number.isFinite(centerY)
                ) {
                    const retainedDx = retainedX - centerX;
                    const retainedDy = retainedY - centerY;
                    const retainedDistance = Math.sqrt((retainedDx * retainedDx) + (retainedDy * retainedDy));
                    const retainedSectorIndex = this.getCommanderDefenseSectorIndex(
                        retainedTarget?.position,
                        zoneCenter,
                        sectorHistogram?.sectorCount || this.commanderDefenseSectorCount
                    );
                    const retainedSectorOffset = this.getCommanderDefenseSectorCircularDistance(
                        retainedSectorIndex,
                        focusSectorIndex,
                        sectorHistogram?.sectorCount || this.commanderDefenseSectorCount
                    );
                    const allowedByFocus = !enforceFocusSector
                        || !focusLockActiveAfterDecision
                        || retainedSectorOffset <= this.commanderDefenseFocusRequiredSectorOffset;
                    if (retainedDistance <= zoneRadius + chaseReleaseBuffer && allowedByFocus) {
                        targetThreat = retainedTarget;
                    }
                }
            }
        }
        const criticalBreachThreat = this.findCommanderDefenseCriticalBreachThreat({
            zoneCenter,
            zoneRadius,
            allowedEnemyPlayerID: strictX1Focus ? x1OpponentID : 0,
            breachRatio: 0.74,
            sectorCount: sectorHistogram?.sectorCount || this.commanderDefenseSectorCount,
            focusSectorIndex,
            focusSectorCount: effectiveFocusSectorCount,
            minClusterCount: criticalBreachMinClusterCount,
            sectorBreakRatio: focusLockActiveAfterDecision ? 0.84 : 0.72,
            absoluteCriticalRatio: 0.52
        });
        if (criticalBreachThreat) {
            if (!targetThreat) {
                targetThreat = criticalBreachThreat;
            } else {
                const criticalX = Number(criticalBreachThreat?.position?.x);
                const criticalY = Number(criticalBreachThreat?.position?.y);
                const currentX = Number(targetThreat?.position?.x);
                const currentY = Number(targetThreat?.position?.y);
                const centerX = Number(zoneCenter?.x);
                const centerY = Number(zoneCenter?.y);
                if (
                    Number.isFinite(criticalX)
                    && Number.isFinite(criticalY)
                    && Number.isFinite(currentX)
                    && Number.isFinite(currentY)
                    && Number.isFinite(centerX)
                    && Number.isFinite(centerY)
                ) {
                    const criticalDx = criticalX - centerX;
                    const criticalDy = criticalY - centerY;
                    const currentDx = currentX - centerX;
                    const currentDy = currentY - centerY;
                    const criticalDistance = Math.sqrt((criticalDx * criticalDx) + (criticalDy * criticalDy));
                    const currentDistance = Math.sqrt((currentDx * currentDx) + (currentDy * currentDy));
                    if (criticalDistance + Math.max(42, zoneRadius * 0.06) < currentDistance) {
                        targetThreat = criticalBreachThreat;
                    }
                }
            }
        }

        if (!targetThreat) {
            if (Number(sectorHistogram?.totalCount || 0) <= 0) {
                this.commanderDefenseFocusSectorIndex = -1;
                this.commanderDefenseFocusSectorLockedUntil = 0;
            }
            const stagingThreat = this.findNearestEnemySoldierTarget(commanderPos, {
                ...targetSearchOptions,
                allowEnemyCommanders: false,
                requiredSectorIndex: (enforceFocusSector && focusLockActiveAfterDecision) ? focusSectorIndex : -1,
                requiredSectorMaxOffset: (enforceFocusSector && focusLockActiveAfterDecision)
                    ? this.commanderDefenseFocusRequiredSectorOffset
                    : 0,
                allowApproachingOutsideZone: true,
                outsideZoneBuffer: preStageOutsideBuffer,
                preferredTargetID: this.commanderDefenseLastTargetUnitId
            });
            if (stagingThreat) {
                const staged = this.issueCommanderDefenseIngressStageMove(commander, stagingThreat, {
                    zoneCenter,
                    zoneRadius,
                    force
                });
                if (staged) {
                    return true;
                }
            }

            const now = Date.now();
            if (!force && now - this.commanderDefenseLastRetargetAt < this.commanderDefenseRetargetIntervalMs) {
                return false;
            }
            if (this.commanderDefenseLastTargetUnitId !== null || commanderIsOutsideDefenseRadius) {
                const holdPosition = commanderBoundedPosition || { x: commanderPos.x, y: commanderPos.y };
                this.updateUnitsCannonTarget([commander], holdPosition);
                this.core?.networkManager?.moveUnits?.([commander], holdPosition);
            }
            this.commanderDefenseLastTargetUnitId = null;
            if (this.commanderDefenseControlRole === "commander") {
                this.commanderDefenseDirectionTargetPosition = null;
            }
            return false;
        }
        const selectedThreatSectorIndex = this.getCommanderDefenseSectorIndex(
            targetThreat?.position,
            zoneCenter,
            sectorHistogram?.sectorCount || this.commanderDefenseSectorCount
        );
        if (selectedThreatSectorIndex >= 0) {
            const selectedSectorOffset = this.getCommanderDefenseSectorCircularDistance(
                selectedThreatSectorIndex,
                focusSectorIndex,
                sectorHistogram?.sectorCount || this.commanderDefenseSectorCount
            );
            if (
                focusSectorIndex < 0
                || selectedSectorOffset <= this.commanderDefenseFocusRequiredSectorOffset
                || (!focusLockActiveAfterDecision && !enforceFocusSector)
            ) {
                this.commanderDefenseFocusSectorIndex = selectedThreatSectorIndex;
                this.commanderDefenseFocusSectorLockedUntil = nowForFocus + this.commanderDefenseFocusHoldMs;
            }
        }

        const threatDx = Number(targetThreat?.position?.x) - commanderPos.x;
        const threatDy = Number(targetThreat?.position?.y) - commanderPos.y;
        const threatDistance = Math.sqrt((threatDx * threatDx) + (threatDy * threatDy));
        const threatMotion = this.getThreatVelocityVector(targetThreat);
        const threatTurnRisk = Math.max(0, Math.min(1, Number(threatMotion?.turnRisk || 0)));
        const nearbyThreatCount = this.countCommanderDefenseNearbyThreats(commanderPos, {
            range: 360,
            allowedEnemyPlayerID: strictX1Focus ? x1OpponentID : 0
        });
        let dynamicRetargetIntervalMs = !Number.isFinite(threatDistance)
            ? this.commanderDefenseRetargetIntervalMs
            : (
                threatDistance < 180
                    ? 72
                    : (threatDistance < 320
                        ? 118
                        : (threatDistance < 450
                            ? 146
                            : (threatDistance < 700 ? 132 : 112)))
            );
        if (threatTurnRisk > 0.55) {
            dynamicRetargetIntervalMs = Math.max(40, Math.floor(dynamicRetargetIntervalMs * 0.52));
        } else if (threatTurnRisk > 0.3) {
            dynamicRetargetIntervalMs = Math.max(48, Math.floor(dynamicRetargetIntervalMs * 0.68));
        }
        if (nearbyThreatCount >= 6) {
            dynamicRetargetIntervalMs = Math.max(42, Math.floor(dynamicRetargetIntervalMs * 0.58));
        } else if (nearbyThreatCount >= 3) {
            dynamicRetargetIntervalMs = Math.max(52, Math.floor(dynamicRetargetIntervalMs * 0.72));
        }
        const threatZoneCenterDx = Number(targetThreat?.position?.x) - Number(zoneCenter?.x);
        const threatZoneCenterDy = Number(targetThreat?.position?.y) - Number(zoneCenter?.y);
        const threatZoneCenterDistance = Math.sqrt(
            (threatZoneCenterDx * threatZoneCenterDx)
            + (threatZoneCenterDy * threatZoneCenterDy)
        );
        const commanderZoneCenterDx = commanderPos.x - Number(zoneCenter?.x);
        const commanderZoneCenterDy = commanderPos.y - Number(zoneCenter?.y);
        const commanderZoneCenterDistance = Math.sqrt(
            (commanderZoneCenterDx * commanderZoneCenterDx)
            + (commanderZoneCenterDy * commanderZoneCenterDy)
        );
        const commanderLagDistance = commanderZoneCenterDistance - threatZoneCenterDistance;
        const commanderIsBehindThreat = Number.isFinite(commanderLagDistance)
            && commanderLagDistance > Math.max(28, zoneRadius * 0.035);
        const antiJukeRisk = commanderIsBehindThreat
            || (Number.isFinite(threatDistance) && threatDistance < Math.max(170, zoneRadius * 0.18))
            || threatTurnRisk > 0.42;
        const threatInsideEngageRadius = Number.isFinite(threatZoneCenterDistance)
            && threatZoneCenterDistance <= zoneRadius + engageRadiusPadding;
        if (!threatInsideEngageRadius) {
            const canPreStageOutsideThreat = Number.isFinite(threatZoneCenterDistance)
                && threatZoneCenterDistance <= zoneRadius + preStageOutsideBuffer;
            if (canPreStageOutsideThreat) {
                const staged = this.issueCommanderDefenseIngressStageMove(commander, targetThreat, {
                    zoneCenter,
                    zoneRadius,
                    force
                });
                if (staged) {
                    return true;
                }
            }
            if (this.commanderDefenseLastTargetUnitId !== null || commanderIsOutsideDefenseRadius) {
                const holdPosition = commanderBoundedPosition || { x: commanderPos.x, y: commanderPos.y };
                this.updateUnitsCannonTarget([commander], holdPosition);
                this.core?.networkManager?.moveUnits?.([commander], holdPosition);
            }
            this.commanderDefenseLastTargetUnitId = null;
            if (this.commanderDefenseControlRole === "commander") {
                this.commanderDefenseDirectionTargetPosition = null;
            }
            return false;
        }
        if (Number.isFinite(threatZoneCenterDistance)) {
            if (threatZoneCenterDistance < zoneRadius * 0.82) {
                dynamicRetargetIntervalMs = Math.min(dynamicRetargetIntervalMs, 26);
            } else if (threatZoneCenterDistance < zoneRadius * 1.06) {
                dynamicRetargetIntervalMs = Math.min(dynamicRetargetIntervalMs, 38);
            }
            if (threatZoneCenterDistance < zoneRadius * 0.64) {
                dynamicRetargetIntervalMs = Math.min(dynamicRetargetIntervalMs, 20);
            }
        }
        if (commanderIsBehindThreat) {
            dynamicRetargetIntervalMs = Math.min(dynamicRetargetIntervalMs, 18);
        } else if (antiJukeRisk) {
            dynamicRetargetIntervalMs = Math.min(dynamicRetargetIntervalMs, 22);
        }
        const now = Date.now();
        if (!force && now - this.commanderDefenseLastRetargetAt < dynamicRetargetIntervalMs) {
            return false;
        }

        const predictedTargetPosition = this.getPredictedThreatPosition(targetThreat, commanderPos);
        const fallbackCurrentPosition = {
            x: Number(targetThreat.position.x),
            y: Number(targetThreat.position.y)
        };
        const targetPosition = predictedTargetPosition || fallbackCurrentPosition;
        if (!Number.isFinite(targetPosition.x) || !Number.isFinite(targetPosition.y)) return false;
        let strategicTargetPosition = targetPosition;
        const ingressBlockPosition = this.getCommanderDefenseIngressBlockPosition(targetThreat, {
            zoneCenter,
            zoneRadius,
            commanderPosition: commanderPos,
            interceptorSpeed: commanderSpeed
        });
        if (ingressBlockPosition && Number.isFinite(threatZoneCenterDistance)) {
            const zoneCenterDx = Number(zoneCenter?.x) - Number(targetThreat?.position?.x);
            const zoneCenterDy = Number(zoneCenter?.y) - Number(targetThreat?.position?.y);
            const zoneCenterDistance = Math.sqrt((zoneCenterDx * zoneCenterDx) + (zoneCenterDy * zoneCenterDy));
            const safeZoneCenterDistance = zoneCenterDistance > 0 ? zoneCenterDistance : 1;
            const approachDot = (
                (Number(threatMotion?.vx || 0) * zoneCenterDx)
                + (Number(threatMotion?.vy || 0) * zoneCenterDy)
            ) / safeZoneCenterDistance;
            const approachingCenter = approachDot > 4 || threatZoneCenterDistance <= zoneRadius * 1.08;
            const nearDefense = threatZoneCenterDistance <= zoneRadius * 1.12;
            if ((approachingCenter || commanderIsBehindThreat) && nearDefense) {
                let blockBlend = threatZoneCenterDistance <= zoneRadius ? 0.62 : 0.4;
                if (antiJukeRisk) {
                    blockBlend += 0.12;
                }
                if (commanderIsBehindThreat) {
                    blockBlend += 0.18;
                }
                if (nearbyThreatCount >= 4) {
                    blockBlend += 0.08;
                }
                if (threatTurnRisk > 0.55) {
                    blockBlend += 0.06;
                }
                blockBlend = Math.max(0.34, Math.min(0.92, blockBlend));
                if (commanderIsBehindThreat && threatZoneCenterDistance <= zoneRadius * 0.98) {
                    strategicTargetPosition = {
                        x: ingressBlockPosition.x,
                        y: ingressBlockPosition.y
                    };
                } else {
                    strategicTargetPosition = {
                        x: (targetPosition.x * (1 - blockBlend)) + (ingressBlockPosition.x * blockBlend),
                        y: (targetPosition.y * (1 - blockBlend)) + (ingressBlockPosition.y * blockBlend)
                    };
                }
            }
        }
        const boundedTargetPosition = this.getCommanderDefenseBoundedPosition(strategicTargetPosition, {
            zoneCenter,
            zoneRadius,
            edgePadding: Math.max(16, Math.min(72, zoneRadius * 0.05))
        });
        const finalTargetPosition = boundedTargetPosition || strategicTargetPosition;

        this.updateUnitsCannonTarget([commander], finalTargetPosition);
        this.core?.networkManager?.moveUnits?.([commander], finalTargetPosition);
        this.commanderDefenseLastRetargetAt = now;
        this.commanderDefenseLastTargetUnitId = targetThreat.id;
        if (this.commanderDefenseControlRole !== "soldiers") {
            this.commanderDefenseDirectionTargetPosition = finalTargetPosition;
        }
        return true;
    }

    updateCommanderAssist (_deltaTime) {
        if (!this.commanderDefenseModeActive) return;

        if (!this.isCommanderDefenseAllowed()) {
            this.setCommanderDefenseMode(false, { silent: true });
            return;
        }

        const hasCommander = Boolean(this.getCommanderUnit());
        if (!hasCommander) {
            this.tryAutoBuyCommanderForDefense();
            this.syncCommanderDefenseControlledSelection(false);
            this.updateCommanderDefensePointerControl(false);
            return;
        }

        this.setCommanderDefenseZone(
            this.getCommanderDefenseBaseCenter(),
            this.commanderDefenseZone?.radius,
            { notify: false }
        );

        this.syncCommanderDefenseControlledSelection(false);
        if (this.commanderDefenseControlRole === "commander") {
            this.updateCommanderDefensePointerControl(false);
            return;
        }

        this.issueCommanderDefenseMove(false);
        this.updateCommanderDefensePointerControl(false);
    }

    onClientCommanderSpawned (commanderUnit) {
        const now = Date.now();
        if (now > this.pendingCommanderAutoSelectUntil) {
            this.pendingCommanderAutoSelectUntil = 0;
            if (this.commanderDefenseModeActive) {
                this.issueCommanderDefenseMove(true);
            }
            return;
        }
        if (!commanderUnit) return;
        if (commanderUnit.type !== UnitTypes.COMMANDER && commanderUnit.type !== UnitTypes.TRI_COMMANDER) return;
        this.pendingCommanderAutoSelectUntil = 0;
        if (this.commanderDefenseModeActive && this.commanderDefenseControlRole === "soldiers") {
            this.syncCommanderDefenseControlledSelection(true);
        } else {
            this.selectCommanderUnit({ suppressHint: true });
        }
        if (this.commanderDefenseModeActive) {
            this.issueCommanderDefenseMove(true);
            this.updateCommanderDefensePointerControl(true);
        }
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

    getUnitSelectionHitRadius (unit) {
        const size = Number(unit?.size);
        if (Number.isFinite(size) && size > 0) {
            return Math.max(10, size * 0.9);
        }
        return 16;
    }

    getNearestUnitAtPoint (point) {
        const player = this.core?.gameManager?.player;
        const units = Array.isArray(player?.units) ? player.units : [];
        if (!units.length) return null;

        const px = Number(point?.x);
        const py = Number(point?.y);
        if (!Number.isFinite(px) || !Number.isFinite(py)) return null;

        let nearestUnit = null;
        let nearestDistanceSq = Infinity;

        units.forEach((unit) => {
            if (!unit || unit.removeFlag || unit.isFadingOut) return;
            const ux = Number(unit?.position?.x);
            const uy = Number(unit?.position?.y);
            if (!Number.isFinite(ux) || !Number.isFinite(uy)) return;

            const dx = ux - px;
            const dy = uy - py;
            const distanceSq = (dx * dx) + (dy * dy);
            const hitRadius = this.getUnitSelectionHitRadius(unit);
            if (distanceSq > (hitRadius * hitRadius)) return;

            if (distanceSq < nearestDistanceSq) {
                nearestDistanceSq = distanceSq;
                nearestUnit = unit;
            }
        });

        return nearestUnit;
    }

    selectUnits (selectionCircle) {
        const rc = selectionCircle; // selection rectangle
        const r_left = rc.position.x + this.core.camera.x;
        const r_top = rc.position.y + this.core.camera.y;
        const r_right = r_left + rc.width;
        const r_bottom = r_top + rc.height;
        const dragDistanceSq = (Number(rc.width) || 0) ** 2 + (Number(rc.height) || 0) ** 2;
        const clickSelectionThresholdSq = 36; // 6px
        const inputButton = Number(this.core?.inputManager?.selectionCircleButton);
        const isPointSelection = dragDistanceSq <= clickSelectionThresholdSq;
        const isAreaDefenseSelection =
            this.commanderDefenseModeActive
            && this.isCommanderDefenseAllowed()
            && this.core?.inputManager?.activeKeys?.has?.("alt");

        // Right click is move/target only; never change current unit selection.
        if (inputButton === 2) {
            this.refreshSelectionHud();
            return;
        }

        if (isAreaDefenseSelection) {
            const zoneCenter = this.getCommanderDefenseBaseCenter() || this.commanderDefenseZone?.center;
            if (!zoneCenter) {
                this.refreshSelectionHud();
                return;
            }

            const minX = Math.min(r_left, r_right);
            const maxX = Math.max(r_left, r_right);
            const minY = Math.min(r_top, r_bottom);
            const maxY = Math.max(r_top, r_bottom);
            let radius = this.getCommanderDefenseSafeRadius(this.commanderDefenseZone?.radius);
            if (isPointSelection) {
                const dx = Number(r_left) - Number(zoneCenter.x);
                const dy = Number(r_top) - Number(zoneCenter.y);
                const pointRadius = Math.sqrt((dx * dx) + (dy * dy));
                if (Number.isFinite(pointRadius) && pointRadius > 0) {
                    radius = pointRadius;
                }
            } else {
                const corners = [
                    { x: minX, y: minY },
                    { x: minX, y: maxY },
                    { x: maxX, y: minY },
                    { x: maxX, y: maxY }
                ];
                let nextRadius = 0;
                corners.forEach((corner) => {
                    const dx = Number(corner.x) - Number(zoneCenter.x);
                    const dy = Number(corner.y) - Number(zoneCenter.y);
                    const distance = Math.sqrt((dx * dx) + (dy * dy));
                    if (Number.isFinite(distance) && distance > nextRadius) {
                        nextRadius = distance;
                    }
                });
                if (nextRadius > 0) {
                    radius = nextRadius;
                }
            }

            this.setCommanderDefenseZone(zoneCenter, radius, { notify: true });
            this.issueCommanderDefenseMove(true);
            this.refreshSelectionHud();
            return;
        }

        if (!this.core.inputManager.shiftPressed) {
            this.clearSelection();
        }

        // Left click/tap on a single unit selects only that unit.
        if (isPointSelection) {
            const clickedUnit = this.getNearestUnitAtPoint({ x: r_left, y: r_top });
            if (clickedUnit) {
                if (!this.selectedUnits.includes(clickedUnit)) {
                    this.selectedUnits.push(clickedUnit);
                }
                clickedUnit.isSelected = true;
                this.refreshSelectionHud();
                this.showSelectionControlsHint();
            } else {
                this.refreshSelectionHud();
            }
            return;
        }
        
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


