import Soldier from "../../entities/units/Soldier.js";
import Tank from "../../entities/units/Tank.js";
import SiegeTank from "../../entities/units/SiegeTank.js";
import Commander from "../../entities/units/Commander.js";
import TriCommander from "../../entities/units/TriCommander.js";
import { BuildingTypes, BuildingVariantTypes, UnitTypes } from "../../network/constants.js";

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

        const availableForSoldiers = Math.max(0, totalPopulationCapacity - nonSoldierUsedPopulation);
        const totalSoldierSlots = Math.max(spawnedSoldiers, Math.floor(availableForSoldiers / 2));

        this.core?.uiManager?.updateSoldierSelectionCounter?.(spawnedSoldiers, totalSoldierSlots);
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
            this.sendMoveCommand(mousePosition);
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

        // Match previous UX: after issuing a move command, clear selection
        // unless the user is holding Shift.
        if (!this.core.inputManager.shiftPressed) {
            this.clearSelection();
        }
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

    selectCommanderUnit () {
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
        return true;
    }

    selectCommanderOrBuy () {
        if (this.selectCommanderUnit()) {
            return;
        }

        // Buy commander if none exists yet (same behavior as core upgrade action).
        if (this.core?.gameManager?.hasCommander) return;

        const now = Date.now();
        if (now - this.lastCommanderHotkeyBuyAt < 350) return;
        this.lastCommanderHotkeyBuyAt = now;

        this.core?.networkManager?.sendBuyCommander?.();
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
    }
}
