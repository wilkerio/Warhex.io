import Wall from "../../entities/building/Wall.js";
import Generator from "../../entities/building/Generator.js";
import House from "../../entities/building/House.js";
import Barracks from "../../entities/building/Barracks.js";
import SimpleTurret from "../../entities/building/SimpleTurret.js";
import SniperTurret from "../../entities/building/SniperTurret.js";
import Armory from "../../entities/building/Armory.js";
import BuildingPreview from "../../entities/BuildingPreview.js";
import { BuildingTypes, BuildingVariantTypes, UnitTypes, UnitVariantTypes, getBuildingDetails } from "../../network/constants.js";
import { QueueType, Renderer } from "../Renderer.js";
import { SelectionState } from "../../entities/Building.js";

// Define a namespace/module for buildings
export const Buildings = {
    Wall: Wall,
    SimpleTurret: SimpleTurret,
    SniperTurret: SniperTurret,
    Armory: Armory,
    Barracks: Barracks,
    Generator: Generator,
    House: House
};

const buildingsArray = Object.values(Buildings);

export class BuildingManager {
    constructor (core) {
        this.core = core;
        this.buildingToPlace = null; // Selected by toolbar
        this.selectedBuildings = []; // Clicked, or selected by selection circle
        this.lastSelectedBuilding = null;

        this.blockBuildingSelection = false;

        this.selectionCircleActive = false;
        this.lastX1ChallengeSentAt = 0;
        this.relocateBaseMode = false;

        // Register click handler for building selection
        this.core.inputManager.registerLeftClickHandler((mousePosition) => this.handleLeftClick(mousePosition));
        this.core.inputManager.registerRightClickHandler((mousePosition) => this.handleRightClick(mousePosition));
        this.core.inputManager.registerMouseMoveHandler(() => this.updateBuildingPosition());

        this.core.inputManager.registerSelectionCircleOnCreateHandler((selectionCircle) => {
            this.selectionCircleActive = true;
        });

        this.core.inputManager.registerSelectionCircleOnRemoveHandler((selectionCircle) => {
            if (this.core.unitManager.hasSelectedUnits()) return;

            const firstBuilding = this.selectedBuildings[0];
            if (firstBuilding && firstBuilding.selectionState === SelectionState.HIGHLIGHT) {
                this.lastSelectedBuilding = { ...firstBuilding };
            }

            this.deselectBuildings();
            this.core.uiManager.hideUpgrades();

            this.selectBuildings(selectionCircle);

            this.lastSelectedBuilding = null;

            this.selectionCircleActive = false;
        });

    }

    static getBuildingClassByType (type) {
        return buildingsArray[type];
    }

    deselectBuildings () {
        this.selectedBuildings.forEach(building => building.setSelectionState(SelectionState.NOT_SELECTED));
        this.selectedBuildings = [];
    }

    selectBuildings (selectionCircle) {
        // During relocation mode, ignore selection-circle flow completely.
        // Relocation is handled only by direct left-click + confirmation.
        if (this.relocateBaseMode) {
            return;
        }

        const startX = selectionCircle.position.x;
        const startY = selectionCircle.position.y;
        const endX = startX + selectionCircle.width;
        const endY = startY + selectionCircle.height;

        // For click detection
        const diameter = Math.sqrt(Math.pow(selectionCircle.width, 2) + Math.pow(selectionCircle.height, 2));
        const radius = diameter / 2;
        
        const worldStartX = startX + this.core.camera.x;
        const worldStartY = startY + this.core.camera.y;
        const worldEndX = endX + this.core.camera.x;
        const worldEndY = endY + this.core.camera.y;

        const minX = Math.min(worldStartX, worldEndX);
        const maxX = Math.max(worldStartX, worldEndX);
        const minY = Math.min(worldStartY, worldEndY);
        const maxY = Math.max(worldStartY, worldEndY);

        const mousePosition = { ...this.core.eventManager.mousePosition };
        const player = this.core.gameManager.player;
        const neutrals = this.core.gameManager.capturedNeutrals;

        let isNeutralBase = false;
        const bases = [player, ...neutrals];
        let closestBase = null;
        let closestDistance = Infinity;

        bases.forEach(base => {
            const dx = mousePosition.x - base.position.x;
            const dy = mousePosition.y - base.position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Check if this base is the closest one so far
            if (distance < closestDistance) {
                closestDistance = distance;
                closestBase = base;

                // Check if the base is a neutral base
                isNeutralBase = neutrals.includes(base);
            }
        });


        const checkForBuildingClicked = radius < 50;
        if (checkForBuildingClicked) {
            this.lastSelectedBuilding = null;
        }

        const trySelectBuilding = (building) => {
            if (!this.selectedBuildings.includes(building)) {
                this.selectedBuildings.push(building);
                return true;
            }

            return false;
        };

        for (const building of closestBase.buildings) {
            const buildingX = building.position.x;
            const buildingY = building.position.y;

            if (checkForBuildingClicked) {
                const clickX = worldStartX + selectionCircle.width / 2;
                const clickY = worldStartY + selectionCircle.height / 2;
                const isBuildingClicked = this.isBuildingClicked(building, { x: clickX, y: clickY });
                if (isBuildingClicked) {
                    if (trySelectBuilding(building)) {
                        building.setSelectionState(SelectionState.HIGHLIGHT);
                        break; // Stops the loop
                    };
                }
            } else {
                // Check if the building is within the rectangle
                if (buildingX >= minX && buildingX <= maxX && buildingY >= minY && buildingY <= maxY) {
                    if (trySelectBuilding(building)) {
                        building.setSelectionState(SelectionState.SELECTED);
                    };
                }
            }
        }

        if (this.selectedBuildings.length > 0) {
            const buildingIDs = this.selectedBuildings.map(building => building.id);
            const onDestroyClicked = () => {
                this.deselectBuildings();
                this.core.uiManager.hideUpgrades();

                const neutralBaseID = isNeutralBase ? closestBase.id : null;

                this.core.networkManager.removeBuildings(buildingIDs, neutralBaseID);
            };

            const allSameTypeAndVariant = this.selectedBuildings.every(b => b.type === this.selectedBuildings[0].type && b.variant === this.selectedBuildings[0].variant);

            if (allSameTypeAndVariant) {
                const onUpgradeClicked = (data) => {

                    if (data) {
                        // Armory unit upgrade flow
                        if (data.unitType !== undefined && data.unitVariant !== undefined) {
                            const currentPower = this.core.gameManager.resources.power.current;
                            if (currentPower < data.cost) {
                                console.error("Not enough power to build!");
                                return;
                            }

                            // Tank upgrades require at least one Tank Factory.
                            if (data.unitType === UnitTypes.TANK) {
                                const hasTankFactory = [this.core.gameManager.player, ...this.core.gameManager.capturedNeutrals]
                                    .some(base => base && base.buildings.some(b =>
                                        b.type === BuildingTypes.BARRACKS &&
                                        b.variant === BuildingVariantTypes.BARRACKS.TANK_FACTORY
                                    ));
                                if (!hasTankFactory) {
                                    const playerName = this.core.gameManager.player?.name || "player";
                                    this.core.uiManager.addChatMessage(
                                        "System",
                                        `@${playerName}, you need to build a Tank Factory first.`,
                                        "#ffcc66"
                                    );
                                    return;
                                }
                            }

                            this.core.gameManager.subtractResources(data.cost);
                            this.core.gameManager.applyUnitUpgrade(data.unitType, data.unitVariant);

                            const neutralBaseID = isNeutralBase ? closestBase.id : null;
                            this.core.networkManager.upgradeBuildings(buildingIDs, data.buildingVariant, neutralBaseID);

                            this.selectedBuildings.forEach(building => {
                                if (building.type === BuildingTypes.ARMORY) {
                                    building.variant = data.buildingVariant;
                                    if (!building.purchasedUpgrades) building.purchasedUpgrades = new Set();
                                    building.purchasedUpgrades.add(data.buildingVariant);
                                }
                            });

                            // Keep the panel open and refresh available upgrades.
                            this.core.uiManager.showUpgrades({
                                buildings: this.selectedBuildings,
                                count: this.selectedBuildings.length,
                                name: this.selectedBuildings[0].details.name,
                                type: this.selectedBuildings[0].type,
                                variant: this.selectedBuildings[0].variant,
                                color: this.selectedBuildings[0].color,
                                purchasedUpgrades: this.selectedBuildings[0].purchasedUpgrades,
                                activated: this.selectedBuildings[0].activated
                            },
                            onUpgradeClicked, onDestroyClicked);
                            return;
                        }

                        const currentPower = this.core.gameManager.resources.power.current;
    
                        // Check if sufficient power is available
                        if (currentPower < data.cost) {
                            console.error("Not enough power to build!");
                            return;
                        }
    
                        this.core.gameManager.subtractResources(data.cost);
    
                        const neutralBaseID = isNeutralBase ? closestBase.id : null;
    
                        this.deselectBuildings();
                        this.core.uiManager.hideUpgrades();
    
                        this.core.networkManager.upgradeBuildings(buildingIDs, data.buildingVariant, neutralBaseID);
                    }else if(this.selectedBuildings.length === 1 && this.selectedBuildings[0].type === BuildingTypes.BARRACKS){
                        const neutralBaseID = isNeutralBase ? closestBase.id : null;
                        this.core.networkManager.toggleUnitSpawning(this.selectedBuildings[0].id, neutralBaseID)
                    }
                };

                this.core.uiManager.showUpgrades({
                    buildings: this.selectedBuildings,
                    count: this.selectedBuildings.length,
                    name: this.selectedBuildings[0].details.name,
                    type: this.selectedBuildings[0].type,
                    variant: this.selectedBuildings[0].variant,
                    color: this.selectedBuildings[0].color,
                    purchasedUpgrades: this.selectedBuildings[0].purchasedUpgrades,
                    activated: this.selectedBuildings[0].activated //! Only used for barracks (count === 1)
                },
                onUpgradeClicked, onDestroyClicked);

            } else {
                // Buildings of different types are selected, only allow destroy
                this.core.uiManager.showUpgrades({
                    buildings: this.selectedBuildings,
                    count: this.selectedBuildings.length,
                    name: "Multiple Buildings",
                }, null, onDestroyClicked);
            }
        } else {
            if (checkForBuildingClicked) {
                const clickedEmptyBaseSlot = this.getClickedRelocationSlot(mousePosition);
                if (clickedEmptyBaseSlot) {
                    const relocateCost = 4000;
                    this.core.uiManager.showRelocateBasePrompt(
                        relocateCost,
                        () => {
                            const currentPower = this.core.gameManager.resources.power.current;
                            if (currentPower < relocateCost) {
                                this.core.uiManager.addChatMessage(
                                    "System",
                                    "Not enough power to relocate base.",
                                    "#ffcc66"
                                );
                                return;
                            }
                            this.relocateBaseMode = false;
                            this.core.uiManager.hideUpgrades();
                            this.core.networkManager.sendBuyRelocateBase(clickedEmptyBaseSlot);
                        },
                        () => { }
                    );
                    return;
                }
            }

            const minBuildingRadius = player.buildingRadius.min;
            const isWithinCoreRadius = Math.sqrt(
                Math.pow(mousePosition.x - player.position.x, 2) +
                Math.pow(mousePosition.y - player.position.y, 2)
            ) <= minBuildingRadius;

            if (isWithinCoreRadius) {
                this.showCoreUpgradePanel();
                return;
            }

            // Click on an enemy core to send a 1v1 challenge.
            if (checkForBuildingClicked) {
                const clickX = worldStartX + selectionCircle.width / 2;
                const clickY = worldStartY + selectionCircle.height / 2;
                const enemy = this.core.gameManager.players.find(p => {
                    const dx = clickX - p.position.x;
                    const dy = clickY - p.position.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    return distance <= p.buildingRadius.min;
                });

                if (enemy) {
                    const localPlayer = this.core.gameManager.player;
                    const localPlayerID = localPlayer?.id;
                    if (localPlayer?.hasSpawnProtection) {
                        this.core.uiManager.addChatMessage(
                            "System",
                            "Leave your base protection area before sending an X1 challenge.",
                            "#ffcc66"
                        );
                        return;
                    }

                    const enemyInProtectedX1 = (this.core.gameManager.globalDuelArenas || [])
                        .some(arena => {
                            const enemyInArena = arena.playerAID === enemy.id || arena.playerBID === enemy.id;
                            const includesLocalPlayer = localPlayerID && (arena.playerAID === localPlayerID || arena.playerBID === localPlayerID);
                            return enemyInArena && !includesLocalPlayer;
                        });
                    if (enemyInProtectedX1) {
                        this.core.uiManager.addChatMessage(
                            "System",
                            "This player is already in a protected X1 duel.",
                            "#ffcc66"
                        );
                        return;
                    }

                    if (this.core.gameManager.duelArena) {
                        if (this.core.gameManager.duelOpponentID === enemy.id) {
                            this.core.uiManager.addChatMessage(
                                "System",
                                "You are already in a protected X1 with this player.",
                                "#ffcc66"
                            );
                            return;
                        }
                        this.core.uiManager.addChatMessage(
                            "System",
                            "You are already in a protected X1 duel.",
                            "#ffcc66"
                        );
                        return;
                    }

                    const dx = enemy.position.x - localPlayer.position.x;
                    const dy = enemy.position.y - localPlayer.position.y;
                    const isLeftOrRight = Math.abs(dx) >= Math.abs(dy);

                    if (!isLeftOrRight) {
                        this.core.uiManager.addChatMessage(
                            "System",
                            "You can challenge only players on your left or right.",
                            "#ffcc66"
                        );
                        return;
                    }

                    const now = Date.now();
                    if (now - this.lastX1ChallengeSentAt < 2000) {
                        return;
                    }
                    this.core.uiManager.showX1SendPrompt(enemy.name || "Player", () => {
                        this.lastX1ChallengeSentAt = Date.now();
                        this.core.networkManager.sendX1Challenge(enemy.id);
                    });
                    return;
                }
            }
        }
    }

    hasSelectedBuildings () {
        return this.selectedBuildings.length > 0;
    }

    // Method to handle selection of a building from the UI (toolbar)
    handleBuildingSelectionForPlacement (buildingClass) {
        // Remove any previously selected building
        if (this.buildingToPlace) {
            this.removeBuildingToPlace();
        }

        // Create a new instance of the selected building class
        const building = new buildingClass(this.core.gameManager.player.color, this.core.gameManager.player.position);

        // Create a preview for the building
        const buildingPreview = new BuildingPreview(building);
        // Add the building and its shadow to the render queue
        this.core.renderer.addToQueue(buildingPreview, QueueType.OVERLAY);
        this.core.renderer.addToQueue(building, QueueType.OVERLAY);

        // Store the selected building and its shadow
        this.buildingToPlace = { building, buildingPreview };

        this.updateBuildingPosition()
    }

    // Update the position of the selected building based on mouse movement
    updateBuildingPosition () {
        if (this.buildingToPlace) {
            const mousePosition = { ...this.core.eventManager.mousePosition };
            const player = this.core.gameManager.player;
            const neutrals = this.core.gameManager.capturedNeutrals;

            const bases = [player, ...neutrals];
            let closestBase = null;
            let closestDistance = Infinity;

            bases.forEach(base => {
                const dx = mousePosition.x - base.position.x;
                const dy = mousePosition.y - base.position.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // Check if this base is the closest one so far
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestBase = base;
                }
            });

            const dx = mousePosition.x - closestBase.position.x;
            const dy = mousePosition.y - closestBase.position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Calculate min/max placement radius based on building type.
            let minRadius = closestBase.buildingRadius.min;
            let maxRadius = closestBase.buildingRadius.max;
            switch (this.buildingToPlace.building.type) {
                case BuildingTypes.BARRACKS:
                    // Barracks fixed slightly outside the ring.
                    minRadius = closestBase.buildingRadius.max + 34;
                    maxRadius = minRadius;
                    break;
                case BuildingTypes.WALL:
                    // Wall can be placed freely and a bit outside the ring.
                    minRadius += this.buildingToPlace.building.size;
                    maxRadius = closestBase.buildingRadius.max + 16;
                    break;
                case BuildingTypes.SIMPLE_TURRET:
                case BuildingTypes.SNIPER_TURRET:
                case BuildingTypes.ARMORY:
                case BuildingTypes.GENERATOR:
                case BuildingTypes.HOUSE:
                    // These buildings must stay inside the ring: outer edge cannot cross the line.
                    maxRadius = closestBase.buildingRadius.max - this.buildingToPlace.building.size;
                    minRadius += this.buildingToPlace.building.size;
                    break;
                default:
                    // Circular shape (Wall, turret, ...)
                    minRadius += this.buildingToPlace.building.size;
            }

            // Check if the distance is greater than the building radius or less than the inner radius
            if (distance > maxRadius) {
                // Normalize the distance and set the position to the edge of the building radius
                const angle = Math.atan2(dy, dx);
                mousePosition.x = closestBase.position.x + maxRadius * Math.cos(angle);
                mousePosition.y = closestBase.position.y + maxRadius * Math.sin(angle);
            } else if (distance < minRadius) {
                // Normalize the distance and set the position to the edge of the inner radius
                const angle = Math.atan2(dy, dx);
                mousePosition.x = closestBase.position.x + minRadius * Math.cos(angle);
                mousePosition.y = closestBase.position.y + minRadius * Math.sin(angle);
            }

            // Set the position of the selected building
            this.buildingToPlace.building.setPosition(mousePosition);

            // Calculate the direction vector from the player to the building
            const directionX = this.buildingToPlace.building.position.x - closestBase.position.x;
            const directionY = this.buildingToPlace.building.position.y - closestBase.position.y;

            // Calculate the inverted position by reversing the direction and scaling it
            const invertedPosition = {
                x: closestBase.position.x + directionX * 1.5,
                y: closestBase.position.y + directionY * 1.5
            };

            this.buildingToPlace.building.setTargetPoint(invertedPosition);

            const allBuildings = closestBase.buildings;
            let allUnits = [];
            this.core.gameManager.players.forEach(p => {
                allUnits.push(...p.units);
            });

            // Check for collisions with other buildings
            this.buildingToPlace.buildingPreview.checkCollision(allBuildings, allUnits);

        }
    }

    // Place the selected building on the map
    placeBuilding () {
        if (this.buildingToPlace) {
            if (!this.buildingToPlace.buildingPreview.buildable) return;
            const cost = getBuildingDetails(this.buildingToPlace.building.type).cost;
            const currentPower = this.core.gameManager.resources.power.current;
            if (currentPower < cost) {
                console.log("Not enought power to build!");
                return;
            }
            const buildingType = this.buildingToPlace.building.type;
            const position = this.buildingToPlace.building.position;

            const ok = this.core.gameManager.increaseBuildingLimit(buildingType);
            if (!ok) {
                return
            }

            this.core.networkManager.placeBuilding(buildingType, position);

            // Client prediction
            this.core.gameManager.player.setBuildingCache(this.buildingToPlace.building);


            this.core.gameManager.subtractResources(cost);

            // If Shift is pressed, re-select the building type and update the position for another placement
            if (this.core.inputManager.shiftPressed) {
                const buildingLimit = this.core.toolbar.getBuildingLimit(buildingType); // Use item.type instead of itemClass

                if (buildingLimit.current < buildingLimit.limit) {

                    // Re-select the building type and keep the selection
                    this.reselectBuildingForPlacement();
                } else {
                    this.removeBuildingToPlace();

                }
            } else {
                // Otherwise, remove the selected building and its preview
                this.removeBuildingToPlace();
            }
        }
    }

    // Helper method to re-select the building type for continued placement
    reselectBuildingForPlacement () {
        const buildingType = this.buildingToPlace.building.constructor;
        this.handleBuildingSelectionForPlacement(buildingType);
    }

    // Ensure the selected building is properly removed
    removeBuildingToPlace () {
        if (this.buildingToPlace) {
            const { building, buildingPreview } = this.buildingToPlace;
            this.core.renderer.removeFromQueue(buildingPreview, QueueType.OVERLAY);
            this.core.renderer.removeFromQueue(building, QueueType.OVERLAY);
            this.buildingToPlace = null;
        }
    }

    // Handle clicks on buildings
    handleLeftClick (mousePosition) {
        if (this.relocateBaseMode) {
            const clickedEmptyBaseSlot = this.getClickedRelocationSlot(mousePosition);
            if (clickedEmptyBaseSlot) {
                const relocateCost = 4000;
                this.core.uiManager.showRelocateBasePrompt(
                    relocateCost,
                    () => {
                        const currentPower = this.core.gameManager.resources.power.current;
                        if (currentPower < relocateCost) {
                            this.core.uiManager.addChatMessage(
                                "System",
                                "Not enough power to relocate base.",
                                "#ffcc66"
                            );
                            return;
                        }
                        this.core.networkManager.sendBuyRelocateBase(clickedEmptyBaseSlot);
                        this.relocateBaseMode = false;
                    },
                    () => { }
                );
            }
            return;
        }

        if (this.buildingToPlace) {
            this.placeBuilding()
            return;
        }
    }

    handleRightClick (mousePosition) { // Called on rightClick -> contextMenu
        if (this.relocateBaseMode) {
            this.relocateBaseMode = false;
            this.core.uiManager.hideRelocateBasePrompt();
            this.core.uiManager.addChatMessage(
                "System",
                "Base relocation canceled.",
                "#ffcc66"
            );
            return;
        }

        if (this.buildingToPlace) {
            this.removeBuildingToPlace();
        } else {
            this.deselectBuildings();
            this.core.uiManager.hideUpgrades();
        }
    }

    showCoreUpgradePanel () {
        const onUpgradeClicked = (data) => {
            const currentPower = this.core.gameManager.resources.power.current;

            if (data.name === "Relocate Base") {
                if (currentPower < data.cost) {
                    console.error("Not enough power to build!");
                    return;
                }
                this.core.uiManager.showRelocateBasePrompt(
                    4000,
                    () => {
                        const latestPower = this.core.gameManager.resources.power.current;
                        if (latestPower < 4000) {
                            this.core.uiManager.addChatMessage(
                                "System",
                                "Not enough power to relocate base.",
                                "#ffcc66"
                            );
                            return;
                        }
                        this.relocateBaseMode = false;
                        this.core.uiManager.hideUpgrades();
                        this.core.networkManager.sendBuyRelocateBase();
                    },
                    () => { }
                );
                return;
            }

            // Check if sufficient power is available
            if (currentPower < data.cost) {
                console.error("Not enough power to build!");
                return;
            }

            this.core.gameManager.subtractResources(data.cost);

            this.core.uiManager.hideUpgrades();

            if (data.name === "Commander") {
                this.core.networkManager.sendBuyCommander();
            } else if (data.name === "Repair") {
                this.core.networkManager.sendBuyRepair();
            }
        }

        this.core.uiManager.showCoreUpgrades(onUpgradeClicked)
    }

    getClickedRelocationSlot (worldPosition) {
        const gameManager = this.core.gameManager;
        const occupied = [];
        if (gameManager.player) occupied.push(gameManager.player.position);
        gameManager.players.forEach(p => occupied.push(p.position));
        gameManager.neutrals.forEach(n => occupied.push(n.position));

        const step = 1500;
        const halfMap = this.core.renderer.mapSize / 2;
        const borderDistance = 500;
        const minBound = -halfMap + borderDistance;
        const maxBound = halfMap - borderDistance;
        const maxAxis = Math.max(Math.abs(minBound), Math.abs(maxBound));
        const maxRing = Math.max(1, Math.ceil(maxAxis / step));
        const candidateCount = 1 + 4 * maxRing * (maxRing + 1);
        const occupancyRadiusSq = 180 * 180;
        const clickRadiusSq = 180 * 180;

        for (let i = 0; i < candidateCount; i++) {
            const cell = Renderer.getSpawnGridCell(i);
            const x = cell.x * step;
            const y = cell.y * step;

            if (x < minBound || x > maxBound || y < minBound || y > maxBound) {
                continue;
            }

            let isOccupied = false;
            for (const pos of occupied) {
                const dx = pos.x - x;
                const dy = pos.y - y;
                if (dx * dx + dy * dy <= occupancyRadiusSq) {
                    isOccupied = true;
                    break;
                }
            }
            if (isOccupied) continue;

            const dx = worldPosition.x - x;
            const dy = worldPosition.y - y;
            if (dx * dx + dy * dy <= clickRadiusSq) {
                return { x, y };
            }

            const labelWidthHalf = 220;
            const labelTop = y - 190;
            const labelBottom = y - 130;
            const isLabelClicked = worldPosition.x >= (x - labelWidthHalf) &&
                worldPosition.x <= (x + labelWidthHalf) &&
                worldPosition.y >= labelTop &&
                worldPosition.y <= labelBottom;
            if (isLabelClicked) {
                return { x, y };
            }
        }

        return null;
    }

    // Check if a building is clicked
    isBuildingClicked (building, mousePosition) {
        const dx = mousePosition.x - building.position.x;
        const dy = mousePosition.y - building.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance <= building.size;
    }
}
