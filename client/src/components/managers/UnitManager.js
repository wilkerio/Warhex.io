import Soldier from "../../entities/units/Soldier.js";
import Tank from "../../entities/units/Tank.js";
import SiegeTank from "../../entities/units/SiegeTank.js";
import Commander from "../../entities/units/Commander.js";
import TriCommander from "../../entities/units/TriCommander.js";

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

        this.lastTargetPosition = { x: Infinity, y: Infinity };

        // Register mouse handlers
        this.core.inputManager.registerMouseDownHandler((mousePosition, button) => this.handleMouseDown(mousePosition, button));
        this.core.inputManager.registerMouseUpHandler((mousePosition, button) => this.handleMouseUp(mousePosition, button));

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
        return this.selectedUnits.length > 0;
    }

    handleMouseDown (mousePosition, button) {
        if (button !== 0) return; // If not left click return
        if (this.core.uiManager.isDraggingChat) return;
        if (this.core.uiManager.menuOpen) return;

        if (this.hasSelectedUnits()) {
            const targetPosition = { ...mousePosition };

            this.selectedUnits.forEach((unit) => {
                if (!this.core.inputManager.shiftPressed) {
                    unit.isSelected = false;  // Deselect units
                }
            });

            // If the position has changed, send the move command to the network manager and update the last target position.
            if (
                this.lastTargetPosition.x !== targetPosition.x &&
                this.lastTargetPosition.y !== targetPosition.y
            ) {
                this.core.networkManager.moveUnits(this.selectedUnits, targetPosition);
                this.lastTargetPosition = targetPosition; // Update last position
            }


            if (!this.core.inputManager.shiftPressed) {
                this.selectedUnits = [];
            }
        } else /* No units selected */ {
            /* Seperate the selection circle mechanisim from this class, 
               and move this code here out of the UnitManager...*/
        }
    }

    handleMouseUp (mousePosition, button) {
        if (button === 2) { // right click
            this.selectedUnits.forEach((unit) => {
                unit.isSelected = false;  // Deselect units
            });
            this.selectedUnits = [];
        }
    }

    selectAllUnits(){
        this.core.gameManager.player.units.forEach(unit => { 
            if (!this.selectedUnits.includes(unit)) {
                this.selectedUnits.push(unit);
                unit.isSelected = true;
            }
        });
    }

    selectUnits (selectionCircle) {
        const startX = selectionCircle.position.x;
        const startY = selectionCircle.position.y;
        const endX = startX + selectionCircle.width;
        const endY = startY + selectionCircle.height;

        // Calculate the center and radius of the selection circle)
        const centerX = (startX + endX) / 2 + this.core.camera.x;
        const centerY = (startY + endY) / 2 + this.core.camera.y;
        const diameter = Math.sqrt(Math.pow(selectionCircle.width, 2) + Math.pow(selectionCircle.height, 2));
        const radius = diameter / 2;

        this.core.gameManager.player.units.forEach(unit => {

            const unitX = unit.position.x;
            const unitY = unit.position.y;

            // Calculate distance from the unit to the circle's center
            const distance = Math.sqrt((unitX - centerX) ** 2 + (unitY - centerY) ** 2);

            // Check if the unit is within the circle's radius
            if (distance <= radius) {
                if (!this.selectedUnits.includes(unit)) {
                    this.selectedUnits.push(unit);
                    unit.isSelected = true;
                }
            }
        });

    }
}
