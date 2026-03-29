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
        } else {
            this.commanderDefenseLastTargetUnitId = null;
            this.commanderDefenseDirectionTargetPosition = null;
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
        const zoneCenter = options?.zoneCenter;
        const zoneRadius = Number(options?.zoneRadius || 0);
        const hasZoneFilter = Boolean(
            zoneCenter
            && Number.isFinite(Number(zoneCenter.x))
            && Number.isFinite(Number(zoneCenter.y))
            && zoneRadius > 0
        );
        const zoneRadiusSq = zoneRadius * zoneRadius;
        const priorityThreatZoneRadiusSq = Math.max(120, zoneRadius * 0.6) ** 2;
        let bestTarget = null;
        let bestAggressorRank = Infinity;
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
                if (hasZoneFilter) {
                    const zdx = ux - Number(zoneCenter.x);
                    const zdy = uy - Number(zoneCenter.y);
                    if ((zdx * zdx) + (zdy * zdy) > zoneRadiusSq) return;
                }

                let zoneDistanceSq = 0;
                let aggressorRank = 0;
                if (hasZoneFilter) {
                    const centerDx = ux - Number(zoneCenter.x);
                    const centerDy = uy - Number(zoneCenter.y);
                    zoneDistanceSq = (centerDx * centerDx) + (centerDy * centerDy);
                    let isAggressor = zoneDistanceSq <= priorityThreatZoneRadiusSq;

                    const tx = Number(unit?.targetPosition?.x);
                    const ty = Number(unit?.targetPosition?.y);
                    if (Number.isFinite(tx) && Number.isFinite(ty)) {
                        const targetCenterDx = tx - Number(zoneCenter.x);
                        const targetCenterDy = ty - Number(zoneCenter.y);
                        const targetZoneDistanceSq = (targetCenterDx * targetCenterDx) + (targetCenterDy * targetCenterDy);
                        const moveDx = tx - ux;
                        const moveDy = ty - uy;
                        const centerVectorDx = Number(zoneCenter.x) - ux;
                        const centerVectorDy = Number(zoneCenter.y) - uy;
                        const movingTowardCenter = ((moveDx * centerVectorDx) + (moveDy * centerVectorDy)) > 0;
                        if (targetZoneDistanceSq <= zoneRadiusSq || (movingTowardCenter && targetZoneDistanceSq < zoneDistanceSq)) {
                            isAggressor = true;
                        }
                    }

                    aggressorRank = prioritizeAggressors ? (isAggressor ? 0 : 1) : 0;
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
                    if (preferredRank === 0) {
                        interceptScore *= 0.72;
                    }
                }

                const isBetterCandidate =
                    (aggressorRank < bestAggressorRank)
                    || (aggressorRank === bestAggressorRank && preferredRank < bestPreferredRank)
                    || (aggressorRank === bestAggressorRank && preferredRank === bestPreferredRank && typeRank < bestTypeRank)
                    || (
                        aggressorRank === bestAggressorRank
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
            if (this.commanderDefenseLastTargetUnitId !== null) {
                this.commanderDefenseLastTargetUnitId = null;
                const holdPosition = { x: commanderPos.x, y: commanderPos.y };
                this.updateUnitsCannonTarget([commander], holdPosition);
                this.core?.networkManager?.moveUnits?.([commander], holdPosition);
            }
            return false;
        }
        const zoneRadius = this.getCommanderDefenseSafeRadius(this.commanderDefenseZone?.radius);
        const commanderSpeed = Number(commander?.details?.speed || 220);
        const targetThreat = this.findNearestEnemySoldierTarget(commanderPos, {
            zoneCenter: this.commanderDefenseZone?.center,
            zoneRadius,
            allowedEnemyPlayerID: strictX1Focus ? x1OpponentID : 0,
            allowEnemyCommanders: false,
            prioritizeAggressors: true,
            preferInterception: true,
            interceptorSpeed: commanderSpeed,
            preferredTargetID: this.commanderDefenseLastTargetUnitId
        });

        if (!targetThreat) {
            const now = Date.now();
            if (!force && now - this.commanderDefenseLastRetargetAt < this.commanderDefenseRetargetIntervalMs) {
                return false;
            }
            if (this.commanderDefenseLastTargetUnitId !== null) {
                const holdPosition = { x: commanderPos.x, y: commanderPos.y };
                this.updateUnitsCannonTarget([commander], holdPosition);
                this.core?.networkManager?.moveUnits?.([commander], holdPosition);
            }
            this.commanderDefenseLastTargetUnitId = null;
            if (this.commanderDefenseControlRole === "commander") {
                this.commanderDefenseDirectionTargetPosition = null;
            }
            return false;
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

        this.updateUnitsCannonTarget([commander], targetPosition);
        this.core?.networkManager?.moveUnits?.([commander], targetPosition);
        this.commanderDefenseLastRetargetAt = now;
        this.commanderDefenseLastTargetUnitId = targetThreat.id;
        if (this.commanderDefenseControlRole !== "soldiers") {
            this.commanderDefenseDirectionTargetPosition = targetPosition;
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


