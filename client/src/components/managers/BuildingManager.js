import Wall from "../../entities/building/Wall.js";
import Generator from "../../entities/building/Generator.js";
import House from "../../entities/building/House.js";
import Barracks from "../../entities/building/Barracks.js";
import Portal from "../../entities/building/Portal.js";
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
    Portal: Portal,
    Generator: Generator,
    House: House
};

const buildingsArray = Object.values(Buildings);

export class BuildingManager {
    constructor (core) {
        this.core = core;
        this.buildingToPlace = null; // Selected by toolbar
        this.selectedPlacementType = null;
        this.selectedBuildings = []; // Clicked, or selected by selection circle
        this.lastSelectedBuilding = null;
        this.placementHintShown = false;

        this.blockBuildingSelection = false;

        this.selectionCircleActive = false;
        this.lastX1ChallengeSentAt = 0;
        this.relocateBaseMode = false;
        this.autogensTimer = null;
        this.autogensRunning = false;
        this.autoBuildMode = null;
        this.baseLoadTimer = null;
        this.baseLoadRunning = false;
        this.defenseProfile = null;
        this.defensePlacementKey = "v";
        this.defenseRemountKey = "b";
        this.defensePlacementActive = false;
        this.defensePlacementTimer = null;
        this.defenseRemountActive = false;
        this.defenseRemountTimer = null;
        this.defensePlacedWalls = [];

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

    hasSelectedOwnedUnits () {
        return Boolean(this.core.unitManager?.hasSelectedUnits?.());
    }

    isPortalTooCloseToAnyBase (position, portalSize) {
        const gameManager = this.core.gameManager;
        const extraPortalBaseGap = 120;

        const tooClose = (targetPos, centerPos, forbiddenRadius) => {
            const dx = targetPos.x - centerPos.x;
            const dy = targetPos.y - centerPos.y;
            return dx * dx + dy * dy <= forbiddenRadius * forbiddenRadius;
        };

        const playerBases = [
            gameManager.player,
            ...(gameManager.players || [])
        ].filter(Boolean);

        for (const base of playerBases) {
            if (!base?.position) continue;
            const baseRadius = base?.buildingRadius?.max ?? 306;
            const forbiddenRadius = baseRadius + portalSize + extraPortalBaseGap;
            if (tooClose(position, base.position, forbiddenRadius)) {
                return true;
            }
        }

        for (const neutral of gameManager.neutrals || []) {
            if (!neutral?.position) continue;
            const baseRadius = neutral?.buildingRadius?.max ?? 260;
            const forbiddenRadius = baseRadius + portalSize + extraPortalBaseGap;
            if (tooClose(position, neutral.position, forbiddenRadius)) {
                return true;
            }
        }

        return false;
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

                        this.core.networkManager.upgradeBuildings(buildingIDs, data.buildingVariant, neutralBaseID);

                        // Keep selection/panel open so next evolution appears immediately.
                        this.selectedBuildings.forEach((selectedBuilding) => {
                            if (selectedBuilding?.setUpgrade) {
                                selectedBuilding.setUpgrade(data.buildingVariant);
                            } else {
                                selectedBuilding.variant = data.buildingVariant;
                            }
                        });

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
                    const onNotifyLeaveBase = enemy.hasSpawnProtection ? () => {
                        this.core.networkManager.watchPlayerLeaveBase(enemy.id, enemy.name || "Player");
                    } : null;

                    const onChallengeX1 = enemy.hasSpawnProtection ? null : () => {
                        if (localPlayer?.hasSpawnProtection) {
                            this.core.uiManager.addChatMessage(
                                "System",
                                "Leave your base protection area before sending an X1 challenge.",
                                "#ffcc66"
                            );
                            return;
                        }

                        if (this.core.unitManager.hasSelectedUnits()) {
                            this.core.uiManager.addChatMessage(
                                "System",
                                "Deselect your units before sending an X1 challenge.",
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
                        const dy = Math.abs(enemy.position.y - localPlayer.position.y);
                        const axisTolerance = 250;
                        const isLeftOrRight = dy <= axisTolerance && Math.abs(dx) > axisTolerance;

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
                    };

                    this.core.uiManager.showEnemyCoreActions(
                        enemy.name || "Player",
                        onChallengeX1,
                        onNotifyLeaveBase
                    );
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
        this.selectedPlacementType = building.type;
        this.core.toolbar?.setActiveBuildingType?.(building.type);

        if (!this.placementHintShown) {
            this.core.uiManager?.addChatMessage?.(
                "System",
                "Placement stays active. Click the same toolbar box again or right-click to cancel.",
                "#60c1ff"
            );
            this.placementHintShown = true;
        }

        this.updateBuildingPosition()
    }

    // Update the position of the selected building based on mouse movement
    updateBuildingPosition () {
        if (this.buildingToPlace) {
            const mousePosition = { ...this.core.eventManager.mousePosition };
            const player = this.core.gameManager.player;
            const neutrals = this.core.gameManager.capturedNeutrals;
            const isPortal = this.buildingToPlace.building.type === BuildingTypes.PORTAL;

            if (isPortal) {
                const halfMap = this.core.renderer.mapSize / 2;
                const padding = this.buildingToPlace.building.size + 8;
                mousePosition.x = Math.max(-halfMap + padding, Math.min(halfMap - padding, mousePosition.x));
                mousePosition.y = Math.max(-halfMap + padding, Math.min(halfMap - padding, mousePosition.y));

                this.buildingToPlace.building.setPosition(mousePosition);
                this.buildingToPlace.building.setTargetPoint({
                    x: mousePosition.x + 1,
                    y: mousePosition.y
                });

                const allBuildings = player ? Object.values(player.buildings || {}) : [];
                let allUnits = [];
                this.core.gameManager.players.forEach(p => {
                    allUnits.push(...p.units);
                });

                this.buildingToPlace.buildingPreview.checkCollision(allBuildings, allUnits);
                if (this.isPortalTooCloseToAnyBase(mousePosition, this.buildingToPlace.building.size)) {
                    this.buildingToPlace.buildingPreview.buildable = false;
                }
                return;
            }

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
            const buildingType = this.buildingToPlace.building.type;
            const enforceRadiusLimit = true;

            // Calculate min/max placement radius based on building type.
            let minRadius = closestBase.buildingRadius.min;
            let maxRadius = closestBase.buildingRadius.max;
            switch (buildingType) {
                case BuildingTypes.BARRACKS:
                    // Barracks fixed slightly outside the ring.
                    minRadius = closestBase.buildingRadius.max + 34;
                    maxRadius = minRadius;
                    break;
                case BuildingTypes.WALL:
                    // Walls can be placed from inner ring up to the same outer radius used by barracks.
                    minRadius += this.buildingToPlace.building.size;
                    maxRadius = closestBase.buildingRadius.max + 34;
                    break;
                case BuildingTypes.SIMPLE_TURRET:
                case BuildingTypes.SNIPER_TURRET:
                case BuildingTypes.ARMORY:
                case BuildingTypes.PORTAL:
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

            if (enforceRadiusLimit) {
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
            const buildingType = this.buildingToPlace.building.type;
            if (buildingType === BuildingTypes.PORTAL && this.isPortalOnCooldown()) {
                const remainingMs = this.core.gameManager.portalCooldownEndsAt - Date.now();
                const remainingMinutes = Math.ceil(Math.max(0, remainingMs) / 60000);
                this.core.uiManager.addChatMessage(
                    "System",
                    `Portal is on cooldown. Wait ${remainingMinutes} min to buy again.`,
                    "#ffcc66"
                );
                return;
            }
            const cost = this.getPlacementCost(buildingType);
            const currentPower = this.core.gameManager.resources.power.current;
            if (currentPower < cost) {
                console.log("Not enought power to build!");
                return;
            }
            const position = this.buildingToPlace.building.position;

            const ok = this.core.gameManager.increaseBuildingLimit(buildingType);
            if (!ok) {
                return
            }

            this.core.networkManager.placeBuilding(buildingType, position);

            // Client prediction
            this.core.gameManager.player.setBuildingCache(this.buildingToPlace.building);


            this.core.gameManager.subtractResources(cost);

            this.reselectBuildingForPlacement();
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
        this.selectedPlacementType = null;
        this.core.toolbar?.setActiveBuildingType?.(null);
    }

    // Handle clicks on buildings
    handleLeftClick (mousePosition) {
        if (this.relocateBaseMode) {
            const clickedEmptyBaseSlot = this.getClickedRelocationSlot(mousePosition);
            if (clickedEmptyBaseSlot) {
                if (this.hasSelectedOwnedUnits()) {
                    this.core.uiManager.addChatMessage(
                        "System",
                        "Deselect your units before relocating your base.",
                        "#ffcc66"
                    );
                    return;
                }
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

        const clickedEmptyBaseSlot = this.getClickedRelocationSlot(mousePosition);
        if (clickedEmptyBaseSlot) {
            if (this.hasSelectedOwnedUnits()) {
                this.core.uiManager.addChatMessage(
                    "System",
                    "Deselect your units before relocating your base.",
                    "#ffcc66"
                );
                return;
            }

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

        if (this.autogensRunning) {
            this.stopAutoPlaceGenerators();
            this.core.uiManager.addChatMessage("System", "Autogens canceled.", "#ffcc66");
            return;
        }

        if (this.core.unitManager?.hasSelectedUnits?.() && !this.buildingToPlace) {
            // Let UnitManager consume right-click for movement/targeting.
            return;
        }

        if (this.buildingToPlace) {
            this.removeBuildingToPlace();
        } else {
            this.deselectBuildings();
            this.core.uiManager.hideUpgrades();
            this.core.uiManager.hideEnemyCoreActions();
        }
    }

    showCoreUpgradePanel () {
        const onUpgradeClicked = (data) => {
            const currentPower = this.core.gameManager.resources.power.current;

            if (data.name === "Relocate Base") {
                if (this.hasSelectedOwnedUnits()) {
                    this.core.uiManager.addChatMessage(
                        "System",
                        "Deselect your units before relocating your base.",
                        "#ffcc66"
                    );
                    return;
                }
                if (currentPower < data.cost) {
                    console.error("Not enough power to build!");
                    return;
                }
                this.core.uiManager.showRelocateBasePrompt(
                    4000,
                    () => {
                        this.relocateBaseMode = true;
                        this.core.uiManager.hideUpgrades();
                        this.core.uiManager.addChatMessage(
                            "System",
                            "Relocation mode enabled. Click an empty slot to relocate your base.",
                            "#60c1ff"
                        );
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

    getOwnedPortalCount () {
        let total = 0;
        const player = this.core.gameManager.player;
        if (player?.buildings) {
            total += Object.values(player.buildings).filter(b => b && b.type === BuildingTypes.PORTAL).length;
        }

        const capturedNeutrals = this.core.gameManager.capturedNeutrals || [];
        for (const neutral of capturedNeutrals) {
            if (!neutral?.buildings) continue;
            total += Object.values(neutral.buildings).filter(b => b && b.type === BuildingTypes.PORTAL).length;
        }

        return total;
    }

    getPlacementCost (buildingType) {
        if (buildingType === BuildingTypes.PORTAL) {
            const ownedPortals = this.getOwnedPortalCount();
            return ownedPortals >= 1 ? 0 : 2500;
        }
        return getBuildingDetails(buildingType).cost;
    }

    isPortalOnCooldown () {
        const until = this.core.gameManager.portalCooldownEndsAt || 0;
        return until > Date.now();
    }

    stopAutoPlaceGenerators () {
        if (this.autogensTimer) {
            clearInterval(this.autogensTimer);
            this.autogensTimer = null;
        }
        this.autogensRunning = false;
        this.autoBuildMode = null;
    }

    stopDefensePlacement () {
        if (this.defensePlacementTimer) {
            clearInterval(this.defensePlacementTimer);
            this.defensePlacementTimer = null;
        }
        this.defensePlacementActive = false;
    }

    stopDefenseRemount () {
        if (this.defenseRemountTimer) {
            clearInterval(this.defenseRemountTimer);
            this.defenseRemountTimer = null;
        }
        this.defenseRemountActive = false;
    }

    syncDefensePlacedWallsWithCurrentState (player, toleranceSq = 14 * 14) {
        if (!player) return;
        const currentWalls = (player.buildings || []).filter(
            b => b && !b.removeFlag && b.type === BuildingTypes.WALL
        );
        this.defensePlacedWalls = (this.defensePlacedWalls || []).filter(saved => {
            return currentWalls.some(wall => {
                const dx = wall.position.x - saved.x;
                const dy = wall.position.y - saved.y;
                return dx * dx + dy * dy <= toleranceSq;
            });
        });
    }

    announceDefenseHotkeys () {
        this.core.uiManager.addChatMessage(
            "System",
            "Defense: use the Defend button to save base and choose defense/remount keys.",
            "#60c1ff"
        );
    }

    stopConflictingAutoActions () {
        if (this.autogensRunning) {
            this.stopAutoPlaceGenerators();
        }
        if (this.baseLoadRunning) {
            this.stopBaseLayoutLoad();
        }
    }

    activateDefendMode () {
        const player = this.core.gameManager.player;
        if (!player) return;

        this.stopConflictingAutoActions();
        this.stopDefensePlacement();
        this.stopDefenseRemount();

        const entries = (player.buildings || [])
            .filter(b => b && !b.removeFlag && b.type !== BuildingTypes.WALL)
            .map(b => ({
                type: b.type,
                position: {
                    x: Math.round(b.position.x * 10) / 10,
                    y: Math.round(b.position.y * 10) / 10
                }
            }));

        if (entries.length === 0) {
            this.core.uiManager.addChatMessage("System", "No buildings to save for defend.", "#ffcc66");
            return;
        }

        window.alert("You saved defend base.");

        const suggestedDefense = this.defensePlacementKey;
        const rawDefense = window.prompt("Choose DEFENSE key (single key). Hold this key to place walls.", suggestedDefense);
        if (rawDefense === null) {
            this.core.uiManager.addChatMessage("System", "Defend setup canceled.", "#ffcc66");
            return;
        }

        const defenseKey = String(rawDefense).trim().toLowerCase();
        if (!defenseKey || defenseKey.length !== 1) {
            this.core.uiManager.addChatMessage("System", "Invalid defense key. Use a single key.", "#ffcc66");
            return;
        }

        const suggestedRemount = this.defenseRemountKey;
        const rawRemount = window.prompt("Choose REMOUNT key (single key). Hold this key to rebuild saved slots.", suggestedRemount);
        if (rawRemount === null) {
            this.core.uiManager.addChatMessage("System", "Defend setup canceled.", "#ffcc66");
            return;
        }

        const remountKey = String(rawRemount).trim().toLowerCase();
        if (!remountKey || remountKey.length !== 1) {
            this.core.uiManager.addChatMessage("System", "Invalid remount key. Use a single key.", "#ffcc66");
            return;
        }

        if (defenseKey === remountKey) {
            this.core.uiManager.addChatMessage("System", "Defense and remount keys must be different.", "#ffcc66");
            return;
        }

        this.defensePlacementKey = defenseKey;
        this.defenseRemountKey = remountKey;
        this.defenseProfile = {
            createdAt: Date.now(),
            entries
        };

        this.core.uiManager.addChatMessage(
            "System",
            `Defend base saved.`,
            "#60c1ff"
        );
        this.core.uiManager.addChatMessage(
            "System",
            `Hold [${defenseKey.toUpperCase()}] for defense walls. Hold [${remountKey.toUpperCase()}] to remount.`,
            "#60c1ff"
        );
    }

    activateRecoverMode () {
        const player = this.core.gameManager.player;
        if (!player) return;

        if (!Array.isArray(this.defensePlacedWalls) || this.defensePlacedWalls.length === 0) {
            this.core.uiManager.addChatMessage("System", "No defense walls to clear.", "#ffcc66");
            return;
        }

        this.stopConflictingAutoActions();
        this.stopDefensePlacement();
        this.stopDefenseRemount();

        const positionToleranceSq = 16 * 16;
        const usedWallIDs = new Set();
        const wallIDsToRemove = [];
        const currentWalls = (player.buildings || []).filter(
            building => building && !building.removeFlag && building.type === BuildingTypes.WALL
        );

        for (const target of this.defensePlacedWalls) {
            let chosen = null;
            let bestDistanceSq = Infinity;
            for (const wall of currentWalls) {
                if (usedWallIDs.has(wall.id)) continue;
                const dx = wall.position.x - target.x;
                const dy = wall.position.y - target.y;
                const distanceSq = dx * dx + dy * dy;
                if (distanceSq <= positionToleranceSq && distanceSq < bestDistanceSq) {
                    bestDistanceSq = distanceSq;
                    chosen = wall;
                }
            }
            if (chosen) {
                usedWallIDs.add(chosen.id);
                wallIDsToRemove.push(chosen.id);
            }
        }

        if (wallIDsToRemove.length > 0) {
            this.core.networkManager.removeBuildings(wallIDsToRemove);
        }

        this.defensePlacedWalls = [];
        this.core.uiManager.addChatMessage(
            "System",
            wallIDsToRemove.length > 0
                ? `Recover complete: removed ${wallIDsToRemove.length} defense wall${wallIDsToRemove.length === 1 ? "" : "s"}.`
                : "Recover complete: no matching defense walls found.",
            wallIDsToRemove.length > 0 ? "#60c1ff" : "#ffcc66"
        );
    }

    handleDefenseHotkeyDown (key) {
        if (!this.defenseProfile || !key) return;
        if (this.core.uiManager.isChatInputFocused) return;
        if (key === this.defensePlacementKey) {
            if (this.defensePlacementActive) return;
            this.stopDefenseRemount();
            this.defensePlacementActive = true;
            this.placeOneDefenseWall();
            this.defensePlacementTimer = setInterval(() => {
                if (!this.defensePlacementActive) return;
                this.placeOneDefenseWall();
            }, 120);
            return;
        }

        if (key === this.defenseRemountKey) {
            if (this.defenseRemountActive) return;
            this.stopDefensePlacement();
            this.defenseRemountActive = true;
            this.remountOneDefenseSlot();
            this.defenseRemountTimer = setInterval(() => {
                if (!this.defenseRemountActive) return;
                this.remountOneDefenseSlot();
            }, 140);
        }
    }

    handleDefenseHotkeyUp (key) {
        if (!key) return;
        if (key === this.defensePlacementKey) {
            this.stopDefensePlacement();
            return;
        }
        if (key === this.defenseRemountKey) {
            this.stopDefenseRemount();
        }
    }

    placeOneDefenseWall () {
        if (!this.defenseProfile || !Array.isArray(this.defenseProfile.entries)) return;

        const player = this.core.gameManager.player;
        if (!player) return;

        const wallType = BuildingTypes.WALL;
        const wallSize = getBuildingDetails(wallType)?.size || 30;
        const cost = this.getPlacementCost(wallType);
        if (this.core.gameManager.resources.power.current < cost) return;

        const positionToleranceSq = 14 * 14;
        const currentBuildings = (player.buildings || []).filter(b => b && !b.removeFlag);
        this.syncDefensePlacedWallsWithCurrentState(player, positionToleranceSq);
        const currentWalls = currentBuildings.filter(b => b.type === BuildingTypes.WALL);
        let selectedPosition = null;
        for (const entry of this.defenseProfile.entries) {
            const hasOriginalBuilding = currentBuildings.some(b => {
                if (b.type !== entry.type) return false;
                const dx = b.position.x - entry.position.x;
                const dy = b.position.y - entry.position.y;
                return dx * dx + dy * dy <= positionToleranceSq;
            });
            if (hasOriginalBuilding) continue;

            const hasDefenseWallThere = currentWalls.some(w => {
                const dx = w.position.x - entry.position.x;
                const dy = w.position.y - entry.position.y;
                return dx * dx + dy * dy <= positionToleranceSq;
            });
            if (hasDefenseWallThere) continue;

            const candidate = { x: entry.position.x, y: entry.position.y };
            if (!this.canAutoPlaceBuilding(player, candidate, [], [], wallType, wallSize, { ignoreUnits: true })) {
                continue;
            }
            selectedPosition = candidate;
            break;
        }

        if (!selectedPosition) return;

        const ok = this.core.gameManager.increaseBuildingLimit(wallType);
        if (!ok) return;

        this.core.networkManager.placeBuilding(wallType, selectedPosition);
        const predicted = this.prepareAutoPlacementBuilding(
            new Wall(player.color, selectedPosition),
            player,
            selectedPosition
        );
        player.setBuildingCache(predicted);
        this.core.gameManager.subtractResources(cost);
        this.defensePlacedWalls.push(selectedPosition);
        if (this.defensePlacedWalls.length > 240) {
            this.defensePlacedWalls.splice(0, this.defensePlacedWalls.length - 240);
        }
    }

    remountOneDefenseSlot () {
        if (!this.defenseProfile || !Array.isArray(this.defenseProfile.entries)) return;
        const player = this.core.gameManager.player;
        if (!player) return;

        const slotToleranceSq = 18 * 18;
        const wallMatchToleranceSq = 40 * 40;
        this.syncDefensePlacedWallsWithCurrentState(player, wallMatchToleranceSq);
        const currentBuildings = (player.buildings || []).filter(b => b && !b.removeFlag);

        const findWallsInSavedSlot = (entry) => {
            return currentBuildings.filter(b => {
                if (b.type !== BuildingTypes.WALL) return false;
                const dx = b.position.x - entry.position.x;
                const dy = b.position.y - entry.position.y;
                return dx * dx + dy * dy <= wallMatchToleranceSq;
            });
        };

        const isOriginalBuildingPresent = (entry) => currentBuildings.some(b => {
            if (b.type !== entry.type) return false;
            const dx = b.position.x - entry.position.x;
            const dy = b.position.y - entry.position.y;
            return dx * dx + dy * dy <= slotToleranceSq;
        });

        const hasOtherBuildingInSlot = (entry) => currentBuildings.some(b => {
            if (b.type === BuildingTypes.WALL) return false;
            const dx = b.position.x - entry.position.x;
            const dy = b.position.y - entry.position.y;
            return dx * dx + dy * dy <= slotToleranceSq;
        });

        // First pass: if there is a wall in a saved slot, sell it first.
        for (const entry of this.defenseProfile.entries) {
            if (isOriginalBuildingPresent(entry)) continue;
            if (hasOtherBuildingInSlot(entry)) continue;
            const matchingWalls = findWallsInSavedSlot(entry);
            if (matchingWalls.length === 0) continue;
            this.defensePlacedWalls = this.defensePlacedWalls.filter(w => {
                const dx = w.x - entry.position.x;
                const dy = w.y - entry.position.y;
                return dx * dx + dy * dy > wallMatchToleranceSq;
            });
            const wallIDs = [...new Set(matchingWalls.map(w => w.id))];
            this.core.networkManager.removeBuildings(wallIDs);
            return;
        }

        // Second pass: rebuild on the first free saved slot.
        let targetEntry = null;
        for (const entry of this.defenseProfile.entries) {
            if (isOriginalBuildingPresent(entry)) continue;
            if (hasOtherBuildingInSlot(entry)) continue;
            targetEntry = entry;
            break;
        }

        if (!targetEntry) return;

        const type = targetEntry.type;
        const cost = this.getPlacementCost(type);
        if (this.core.gameManager.resources.power.current < cost) return;

        const ok = this.core.gameManager.increaseBuildingLimit(type);
        if (!ok) return;

        const BuildingClass = BuildingManager.getBuildingClassByType(type);
        if (!BuildingClass) return;

        const position = { x: targetEntry.position.x, y: targetEntry.position.y };
        this.core.networkManager.placeBuilding(type, position);
        const predicted = this.prepareAutoPlacementBuilding(
            new BuildingClass(player.color, position),
            player,
            position
        );
        player.setBuildingCache(predicted);
        this.core.gameManager.subtractResources(cost);
    }

    exportCurrentBaseLayout (layoutName, snapshotDataUrl = null) {
        const player = this.core.gameManager.player;
        if (!player) return null;

        const basePos = player.position;
        const buildings = (player.buildings || [])
            .filter(building => building && !building.removeFlag)
            .map(building => ({
                type: building.type,
                variant: building.variant ?? 0,
                dx: Math.round((building.position.x - basePos.x) * 10) / 10,
                dy: Math.round((building.position.y - basePos.y) * 10) / 10,
            }))
            .sort((a, b) => (a.dx * a.dx + a.dy * a.dy) - (b.dx * b.dx + b.dy * b.dy));

        return {
            id: `base_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
            name: (layoutName || "My Base").trim() || "My Base",
            createdAt: Date.now(),
            snapshot: snapshotDataUrl || null,
            buildings
        };
    }

    stopBaseLayoutLoad () {
        if (this.baseLoadTimer) {
            clearInterval(this.baseLoadTimer);
            this.baseLoadTimer = null;
        }
        this.baseLoadRunning = false;
    }

    loadBaseLayout (layout) {
        const player = this.core.gameManager.player;
        if (!player || !layout || !Array.isArray(layout.buildings)) {
            this.core.uiManager.addChatMessage("System", "Invalid base layout.", "#ffcc66");
            return;
        }

        if (this.baseLoadRunning) {
            this.stopBaseLayoutLoad();
        }

        const queue = layout.buildings
            .filter(item => item && Number.isFinite(item.type) && Number.isFinite(item.dx) && Number.isFinite(item.dy))
            .map(item => ({ ...item }))
            .sort((a, b) => (a.dx * a.dx + a.dy * a.dy) - (b.dx * b.dx + b.dy * b.dy));

        if (queue.length === 0) {
            this.core.uiManager.addChatMessage("System", "Layout has no buildings to load.", "#ffcc66");
            return;
        }

        const collectAllUnits = () => {
            const allUnits = [];
            this.core.gameManager.players.forEach(p => allUnits.push(...(p.units || [])));
            return allUnits;
        };

        const pendingBuildings = [];
        let placed = 0;
        let skipped = 0;
        let index = 0;

        this.baseLoadRunning = true;
        this.core.uiManager.addChatMessage("System", `Loading base layout "${layout.name || "Base"}"...`, "#60c1ff");

        this.baseLoadTimer = setInterval(() => {
            if (!this.baseLoadRunning) return;

            const livePlayer = this.core.gameManager.player;
            if (!livePlayer) {
                this.stopBaseLayoutLoad();
                return;
            }

            if (index >= queue.length) {
                this.stopBaseLayoutLoad();
                this.core.uiManager.addChatMessage(
                    "System",
                    `Base loaded: ${placed} placed, ${skipped} skipped.`,
                    placed > 0 ? "#60c1ff" : "#ffcc66"
                );
                return;
            }

            const item = queue[index++];
            const type = item.type;
            const details = getBuildingDetails(type);
            const size = details?.size || 32;
            const position = {
                x: livePlayer.position.x + item.dx,
                y: livePlayer.position.y + item.dy
            };
            const cost = this.getPlacementCost(type);

            if (this.core.gameManager.resources.power.current < cost) {
                skipped++;
                return;
            }

            const allUnits = collectAllUnits();
            if (!this.canAutoPlaceBuilding(livePlayer, position, allUnits, pendingBuildings, type, size)) {
                skipped++;
                return;
            }

            const ok = this.core.gameManager.increaseBuildingLimit(type);
            if (!ok) {
                skipped++;
                return;
            }

            const BuildingClass = BuildingManager.getBuildingClassByType(type);
            if (!BuildingClass) {
                skipped++;
                return;
            }

            this.core.networkManager.placeBuilding(type, position);
            const predicted = this.prepareAutoPlacementBuilding(
                new BuildingClass(livePlayer.color, position),
                livePlayer,
                position
            );
            livePlayer.setBuildingCache(predicted);
            this.core.gameManager.subtractResources(cost);
            pendingBuildings.push(predicted);
            placed++;
        }, 150);
    }

    placeExternalAtkArmory () {
        const player = this.core.gameManager.player;
        if (!player) return 0;

        if (this.autogensRunning) {
            this.stopAutoPlaceGenerators();
            this.core.uiManager.addChatMessage("System", "Auto build canceled.", "#ffcc66");
            return 0;
        }

        if (this.buildingToPlace) this.removeBuildingToPlace();

        const collectAllUnits = () => {
            const units = [];
            this.core.gameManager.players.forEach(p => units.push(...(p.units || [])));
            return units;
        };

        const pendingBuildings = [];
        let armoryPlaced = false;
        let housesPlaced = 0;

        const armoryType = BuildingTypes.ARMORY;
        const armorySize = getBuildingDetails(armoryType)?.size || 34;
        const armoryCheckSize = armorySize + 1; // Minimal safety margin.
        const armoryCost = this.getPlacementCost(armoryType);

        const houseType = BuildingTypes.HOUSE;
        const houseSize = getBuildingDetails(houseType)?.size || 26;
        const houseCheckSize = houseSize; // Maximum tight packing.
        const houseCost = this.getPlacementCost(houseType);

        const queue = [];
        // Planning should ignore transient unit positions; live placement still validates units.
        const planningUnits = [];
        const packedHouseCandidates = this.getAutoPackedHouseCandidates(player, houseCheckSize);

        const armoryCandidates = [];
        const { minRadius, maxRadius } = this.getPlacementRadiusRangeForType(player, armoryType, armoryCheckSize);
        if (maxRadius >= minRadius) {
            const desiredArmoryAngle = -Math.PI / 2; // Top center.
            const preferredAngles = [desiredArmoryAngle, desiredArmoryAngle - 0.08, desiredArmoryAngle + 0.08];
            const preferredRadius = minRadius;
            const angleOffsets = [0, -0.03, 0.03];
            const radiusOffsets = [0, 5, -5, 10];

            for (const baseAngle of preferredAngles) {
                for (const radiusOffset of radiusOffsets) {
                    const radius = Math.max(minRadius, Math.min(maxRadius, preferredRadius + radiusOffset));
                    for (const angleOffset of angleOffsets) {
                        const angle = baseAngle + angleOffset;
                        armoryCandidates.push({
                            angle,
                            radius,
                            position: {
                                x: player.position.x + radius * Math.cos(angle),
                                y: player.position.y + radius * Math.sin(angle)
                            }
                        });
                    }
                }
            }
        }

        let bestArmoryCandidate = null;
        let bestHousePositions = [];
        const targetHouseCount = 80;

        for (const armoryCandidate of armoryCandidates) {
            if (!this.canAutoPlaceBuilding(player, armoryCandidate.position, planningUnits, [], armoryType, armoryCheckSize)) {
                continue;
            }

            const pendingArmory = this.prepareAutoPlacementBuilding(
                new Armory(player.color, armoryCandidate.position),
                player,
                armoryCandidate.position
            );

            const optimizedHousePositions = this.getOptimizedHousePlacementOrder(
                player,
                planningUnits,
                houseCheckSize,
                packedHouseCandidates,
                [pendingArmory]
            );

            const desiredArmoryAngle = -Math.PI / 2;
            const angleBias = Math.abs(armoryCandidate.angle - desiredArmoryAngle);
            const currentScore = optimizedHousePositions.length * 10000 - Math.round(angleBias * 1200) - Math.round(armoryCandidate.radius);
            const bestScore = bestHousePositions.length * 10000 - (bestArmoryCandidate ? Math.round(Math.abs(bestArmoryCandidate.angle - desiredArmoryAngle) * 1200) + Math.round(bestArmoryCandidate.radius) : 0);

            if (!bestArmoryCandidate || currentScore > bestScore) {
                bestArmoryCandidate = armoryCandidate;
                bestHousePositions = optimizedHousePositions;
                if (bestHousePositions.length >= targetHouseCount) {
                    break;
                }
            }
        }

        if (bestArmoryCandidate) {
            queue.push({
                type: armoryType,
                size: armorySize,
                checkSize: armoryCheckSize,
                cost: armoryCost,
                ctor: Armory,
                position: bestArmoryCandidate.position
            });
        }

        // Fallback: if no armory candidate survived planning, still try houses.
        if (!bestArmoryCandidate && bestHousePositions.length === 0) {
            bestHousePositions = this.getOptimizedHousePlacementOrder(
                player,
                planningUnits,
                houseCheckSize,
                packedHouseCandidates,
                []
            );
        }

        const finalHousePositions = bestHousePositions.slice(0, targetHouseCount);
        for (const position of finalHousePositions) {
            queue.push({
                type: houseType,
                size: houseSize,
                checkSize: houseCheckSize,
                cost: houseCost,
                ctor: House,
                position
            });
        }

        if (queue.length === 0) {
            this.core.uiManager.addChatMessage("System", "ExternaTK: no valid candidate positions.", "#ffcc66");
            return 0;
        }

        let queueIndex = 0;

        const finish = (message, color = "#60c1ff") => {
            this.stopAutoPlaceGenerators();
            this.core.uiManager.addChatMessage("System", message, color);
        };

        this.autogensRunning = true;
        this.autoBuildMode = "externatk";
        this.core.uiManager.addChatMessage("System", "ExternaTK started...", "#60c1ff");

        this.autogensTimer = setInterval(() => {
            if (!this.autogensRunning) return;

            const livePlayer = this.core.gameManager.player;
            if (!livePlayer) {
                finish("ExternaTK stopped.", "#ffcc66");
                return;
            }

            const livePower = this.core.gameManager.resources.power.current;
            const remaining = queue.slice(queueIndex);
            const cheapestRemaining = remaining.length > 0
                ? remaining.reduce((min, item) => Math.min(min, item.cost), Infinity)
                : Infinity;

            if (livePower < cheapestRemaining) {
                if (!armoryPlaced && housesPlaced === 0) {
                    finish("ExternaTK: not enough power.", "#ffcc66");
                    return;
                }
                finish(`ExternaTK: ${armoryPlaced ? "Armory + " : ""}${housesPlaced} house${housesPlaced === 1 ? "" : "s"} placed.`);
                return;
            }

            let placedThisTick = false;

            while (queueIndex < queue.length) {
                const item = queue[queueIndex++];

                if (item.type === armoryType && armoryPlaced) continue;
                if (this.core.gameManager.resources.power.current < item.cost) continue;

                const liveUnits = collectAllUnits();
                if (!this.canAutoPlaceBuilding(livePlayer, item.position, liveUnits, pendingBuildings, item.type, item.checkSize || item.size)) {
                    continue;
                }

                const ok = this.core.gameManager.increaseBuildingLimit(item.type);
                if (!ok) {
                    if (item.type === houseType) {
                        finish(`ExternaTK: ${armoryPlaced ? "Armory + " : ""}${housesPlaced} house${housesPlaced === 1 ? "" : "s"} placed.`);
                        return;
                    }
                    continue;
                }

                this.core.networkManager.placeBuilding(item.type, item.position);
                const predicted = this.prepareAutoPlacementBuilding(
                    new item.ctor(livePlayer.color, item.position),
                    livePlayer,
                    item.position
                );
                livePlayer.setBuildingCache(predicted);
                this.core.gameManager.subtractResources(item.cost);
                pendingBuildings.push(predicted);

                if (item.type === armoryType) {
                    armoryPlaced = true;
                } else if (item.type === houseType) {
                    housesPlaced++;
                }

                placedThisTick = true;
                break;
            }

            if (!placedThisTick || queueIndex >= queue.length) {
                if (!armoryPlaced && housesPlaced === 0) {
                    finish("ExternaTK: no space, limit or power to place buildings.", "#ffcc66");
                    return;
                }
                finish(`ExternaTK: ${armoryPlaced ? "Armory + " : ""}${housesPlaced} house${housesPlaced === 1 ? "" : "s"} placed.`);
            }
        }, 220);

        return 0;
    }

    autoPlaceGenerators () {
        const player = this.core.gameManager.player;
        if (!player) return 0;

        if (this.autogensRunning) {
            this.stopAutoPlaceGenerators();
            this.core.uiManager.addChatMessage("System", "Autogens canceled.", "#ffcc66");
            return 0;
        }

        if (this.buildingToPlace) {
            this.removeBuildingToPlace();
        }

        const base = player;
        const details = getBuildingDetails(BuildingTypes.GENERATOR);
        const generatorSize = details?.size || 32;
        const cost = this.getPlacementCost(BuildingTypes.GENERATOR);

        const limitEntry = this.core.gameManager.buildingLimits
            .find(entry => entry.type === BuildingTypes.GENERATOR);
        const remainingLimit = Math.max(0, (limitEntry?.limit || 0) - (limitEntry?.current || 0));
        if (remainingLimit <= 0) {
            this.core.uiManager.addChatMessage("System", "Generator limit reached.", "#ffcc66");
            return 0;
        }

        const initialPower = this.core.gameManager.resources.power.current;
        if (initialPower < cost) {
            this.core.uiManager.addChatMessage("System", "Not enough power to place generators.", "#ffcc66");
            return 0;
        }

        const maxAffordable = Math.floor(initialPower / cost);
        const maxToPlace = Math.min(remainingLimit, maxAffordable);
        if (maxToPlace <= 0) {
            this.core.uiManager.addChatMessage("System", "Not enough power to place generators.", "#ffcc66");
            return 0;
        }

        const allUnits = [];
        this.core.gameManager.players.forEach(p => {
            allUnits.push(...(p.units || []));
        });

        const candidates = this.getAutoGeneratorCandidates(base, generatorSize);
        const pendingGenerators = [];
        let placed = 0;
        let candidateIndex = 0;

        const finishAutogens = (message, color = "#60c1ff") => {
            this.stopAutoPlaceGenerators();
            if (message) {
                this.core.uiManager.addChatMessage("System", message, color);
            }
        };

        this.autogensRunning = true;
        this.autoBuildMode = "autogens";
        this.core.uiManager.addChatMessage("System", "Autogens started...", "#60c1ff");

        this.autogensTimer = setInterval(() => {
            if (!this.autogensRunning) return;

            const livePlayer = this.core.gameManager.player;
            if (!livePlayer) {
                finishAutogens("Autogens stopped.", "#ffcc66");
                return;
            }

            const livePower = this.core.gameManager.resources.power.current;
            if (livePower < cost) {
                if (placed > 0) {
                    finishAutogens(
                        `Autogens placed ${placed} generator${placed > 1 ? "s" : ""} (not enough power).`
                    );
                } else {
                    finishAutogens("Not enough power to place generators.", "#ffcc66");
                }
                return;
            }

            const liveLimitEntry = this.core.gameManager.buildingLimits
                .find(entry => entry.type === BuildingTypes.GENERATOR);
            const liveRemainingLimit = Math.max(0, (liveLimitEntry?.limit || 0) - (liveLimitEntry?.current || 0));
            if (liveRemainingLimit <= 0 || placed >= maxToPlace) {
                if (placed > 0) {
                    finishAutogens(`Autogens placed ${placed} generator${placed > 1 ? "s" : ""}.`);
                } else {
                    finishAutogens("Generator limit reached.", "#ffcc66");
                }
                return;
            }

            let placedThisTick = false;

            while (candidateIndex < candidates.length) {
                const position = candidates[candidateIndex++];
                if (!this.canAutoPlaceGenerator(base, position, allUnits, pendingGenerators, generatorSize)) {
                    continue;
                }

                const ok = this.core.gameManager.increaseBuildingLimit(BuildingTypes.GENERATOR);
                if (!ok) {
                    finishAutogens(`Autogens placed ${placed} generator${placed > 1 ? "s" : ""}.`);
                    return;
                }

                this.core.networkManager.placeBuilding(BuildingTypes.GENERATOR, position);

                const predicted = new Generator(livePlayer.color, position);
                livePlayer.setBuildingCache(predicted);
                this.core.gameManager.subtractResources(cost);
                pendingGenerators.push(predicted);
                placed++;
                placedThisTick = true;
                break;
            }

            if (!placedThisTick || candidateIndex >= candidates.length) {
                if (placed === 0) {
                    finishAutogens("Couldn't find valid space to auto-place generators.", "#ffcc66");
                    return;
                }

                finishAutogens(`Autogens placed ${placed} generator${placed > 1 ? "s" : ""}.`);
            }
        }, 220);

        return 0;
    }

    getPlacementRadiusRangeForType (base, buildingType, buildingSize) {
        let minRadius = base.buildingRadius.min;
        let maxRadius = base.buildingRadius.max;

        switch (buildingType) {
            case BuildingTypes.BARRACKS:
                minRadius = base.buildingRadius.max + 34;
                maxRadius = minRadius;
                break;
            case BuildingTypes.WALL:
                minRadius += buildingSize;
                maxRadius = base.buildingRadius.max + 34;
                break;
            case BuildingTypes.SIMPLE_TURRET:
            case BuildingTypes.SNIPER_TURRET:
            case BuildingTypes.ARMORY:
            case BuildingTypes.PORTAL:
            case BuildingTypes.GENERATOR:
            case BuildingTypes.HOUSE:
                minRadius += buildingSize;
                maxRadius = base.buildingRadius.max - buildingSize;
                break;
            default:
                minRadius += buildingSize;
        }

        return { minRadius, maxRadius };
    }

    getAutoBuildingCandidates (base, buildingType, buildingSize, preferredRadiusPct = 0.5, spacingExtra = 2) {
        const { minRadius, maxRadius } = this.getPlacementRadiusRangeForType(base, buildingType, buildingSize);
        if (maxRadius < minRadius) return [];

        const spacing = Math.max(2, buildingSize * 2 + spacingExtra);
        const radialStep = Math.max(8, spacing * 0.866);
        const startAngle = -Math.PI / 2;
        const preferredRadius = minRadius + (maxRadius - minRadius) * Math.max(0, Math.min(1, preferredRadiusPct));

        const candidates = [];
        const seen = new Set();
        const addCandidate = (x, y) => {
            const key = `${Math.round(x)}:${Math.round(y)}`;
            if (seen.has(key)) return;
            seen.add(key);
            candidates.push({ x, y });
        };

        const buildRing = (radius, offsetFactor = 0) => {
            const perimeter = 2 * Math.PI * radius;
            const count = Math.max(6, Math.round(perimeter / spacing));
            const angleStep = (Math.PI * 2) / count;
            const offset = angleStep * offsetFactor;
            for (let i = 0; i < count; i++) {
                const angle = startAngle + offset + i * angleStep;
                addCandidate(
                    base.position.x + radius * Math.cos(angle),
                    base.position.y + radius * Math.sin(angle)
                );
            }
        };

        if (Math.abs(maxRadius - minRadius) < 1) {
            buildRing(minRadius, 0);
        } else {
            let ring = 0;
            for (let radius = minRadius; radius <= maxRadius; radius += radialStep) {
                buildRing(radius, ring % 2 ? 0.5 : 0);
                ring++;
            }
            ring = 0;
            for (let radius = minRadius + radialStep * 0.5; radius <= maxRadius; radius += radialStep) {
                buildRing(radius, ring % 2 ? 0.5 : 0.25);
                ring++;
            }
        }

        const normalizeAngle = (a) => {
            let out = a - startAngle;
            while (out < 0) out += Math.PI * 2;
            while (out >= Math.PI * 2) out -= Math.PI * 2;
            return out;
        };

        candidates.sort((a, b) => {
            const dax = a.x - base.position.x;
            const day = a.y - base.position.y;
            const dbx = b.x - base.position.x;
            const dby = b.y - base.position.y;
            const ra = Math.sqrt(dax * dax + day * day);
            const rb = Math.sqrt(dbx * dbx + dby * dby);
            const dr = Math.abs(ra - preferredRadius) - Math.abs(rb - preferredRadius);
            if (Math.abs(dr) > 0.5) return dr;

            const aa = normalizeAngle(Math.atan2(day, dax));
            const ab = normalizeAngle(Math.atan2(dby, dbx));
            return aa - ab;
        });

        return candidates;
    }

    getAutoGeneratorCandidates (base, generatorSize) {
        return this.getAutoBuildingCandidates(base, BuildingTypes.GENERATOR, generatorSize, 0.5);
    }

    getAutoPackedHouseCandidates (base, houseSize) {
        const range = this.getPlacementRadiusRangeForType(base, BuildingTypes.HOUSE, houseSize);
        const radiusTolerance = 4; // Keep candidate search aligned with server-side tolerance.
        const minRadius = Math.max(0, range.minRadius);
        const maxRadius = range.maxRadius + radiusTolerance;
        if (maxRadius < minRadius) return [];

        // Beauty-first concentric sockets (close to the yellow reference pattern):
        // tight rings + staggered phases + symmetric top opening for armory.
        // Force one dedicated inner ring at minRadius so houses stay visually glued to the core.
        const radius = houseSize;
        const diameter = radius * 2;
        const tangentialGap = Math.max(0.5, radius * 0.02);
        const spacing = diameter + tangentialGap;
        const radialStep = Math.max(radius * 1.58, spacing * 0.82);
        const TWO_PI = Math.PI * 2;
        const centerX = base.position.x;
        const centerY = base.position.y;
        const topAngle = -Math.PI / 2;

        const innerRingRadius = minRadius;
        const maxHouseLayers = 3; // Keep layout cleaner: inner + 2 rings.
        const outerSafetyGap = Math.max(2, houseSize * 0.35); // Avoid the largest outer ring.
        const usableMaxRadius = Math.max(innerRingRadius, maxRadius - outerSafetyGap);
        const distributedStep = (usableMaxRadius - innerRingRadius) / Math.max(1, maxHouseLayers - 1);
        // Prefer wider inter-ring spacing to avoid cross-ring collision holes.
        const ringStep = Math.max(1, Math.max(radialStep, distributedStep));

        const ringTargetRadii = [innerRingRadius];
        for (let layer = 1; layer < maxHouseLayers; layer++) {
            const ringRadius = innerRingRadius + ringStep * layer;
            if (ringRadius >= usableMaxRadius + 0.01) break;
            ringTargetRadii.push(ringRadius);
        }

        const buildTemplateCandidates = (globalRotation) => {
            const list = [];
            const seen = new Set();

            for (let ringIndex = 0; ringIndex < ringTargetRadii.length; ringIndex++) {
                const ringRadius = ringTargetRadii[ringIndex];
                const circumference = TWO_PI * ringRadius;
                const rawCount = Math.max(10, Math.round(circumference / spacing));
                const count = (rawCount % 2 === 0) ? rawCount : rawCount + 1; // cleaner mirror symmetry
                const angleStep = TWO_PI / count;
                const ringOffset = (ringIndex % 2 === 0) ? 0 : (angleStep * 0.5);
                const phase = (ringIndex % 3) * angleStep * 0.08;
                const phaseOffsets = [phase];

                for (const phaseOffset of phaseOffsets) {
                    for (let i = 0; i < count; i++) {
                        const angle = globalRotation + ringOffset + phaseOffset + i * angleStep;

                        // Keep one top socket at the inner ring for armory.
                        if (ringIndex === 0) {
                            const delta = Math.abs(Math.atan2(Math.sin(angle - topAngle), Math.cos(angle - topAngle)));
                            if (delta < angleStep * 0.26) continue;
                        }

                        const wx = centerX + ringRadius * Math.cos(angle);
                        const wy = centerY + ringRadius * Math.sin(angle);
                        const key = `${Math.round(wx)}:${Math.round(wy)}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        list.push({ x: wx, y: wy });
                    }
                }
            }

            return list;
        };

        let bestCandidates = [];
        let bestScore = -1;
        const rotationSteps = 84;
        for (let step = 0; step < rotationSteps; step++) {
            const rotation = (step * TWO_PI) / rotationSteps;
            const candidates = buildTemplateCandidates(rotation);
            let outerBandCount = 0;
            const outerBandStart = maxRadius - radialStep * 0.9;
            for (const p of candidates) {
                const dx = p.x - centerX;
                const dy = p.y - centerY;
                const r = Math.sqrt(dx * dx + dy * dy);
                if (r >= outerBandStart) outerBandCount++;
            }
            const score = candidates.length * 10000 + outerBandCount * 12;
            if (score > bestScore) {
                bestScore = score;
                bestCandidates = candidates;
            }
        }

        const signedAngleFromTop = (p) => {
            const a = Math.atan2(p.y - centerY, p.x - centerX);
            let d = a - topAngle;
            while (d <= -Math.PI) d += TWO_PI;
            while (d > Math.PI) d -= TWO_PI;
            return d;
        };

        bestCandidates.sort((a, b) => {
            const dax = a.x - centerX;
            const day = a.y - centerY;
            const dbx = b.x - centerX;
            const dby = b.y - centerY;
            const ra = Math.sqrt(dax * dax + day * day);
            const rb = Math.sqrt(dbx * dbx + dby * dby);
            const aInInnerRing = Math.abs(ra - innerRingRadius) <= Math.max(2, tangentialGap * 3);
            const bInInnerRing = Math.abs(rb - innerRingRadius) <= Math.max(2, tangentialGap * 3);
            if (aInInnerRing !== bInInnerRing) return aInInnerRing ? -1 : 1;
            if (Math.abs(ra - rb) > 0.5) return ra - rb;

            const aa = signedAngleFromTop(a);
            const ab = signedAngleFromTop(b);
            const absDiff = Math.abs(aa) - Math.abs(ab);
            if (Math.abs(absDiff) > 0.0001) return absDiff;
            return aa - ab;
        });

        return bestCandidates;
    }

    getOptimizedHousePlacementOrder (base, allUnits, houseSize, candidates, initialPendingBuildings = []) {
        if (!candidates || candidates.length === 0) return [];

        const range = this.getPlacementRadiusRangeForType(base, BuildingTypes.HOUSE, houseSize);
        const centerX = base.position.x;
        const centerY = base.position.y;
        const ringStep = Math.max(8, houseSize * 2 * 0.92);
        const minRadius = range.minRadius;

        const radiusOf = (p) => {
            const dx = p.x - centerX;
            const dy = p.y - centerY;
            return Math.sqrt(dx * dx + dy * dy);
        };
        const angleOf = (p) => Math.atan2(p.y - centerY, p.x - centerX);
        const keyOf = (p) => `${Math.round(p.x)}:${Math.round(p.y)}`;
        const topAngle = -Math.PI / 2;
        const innerPriorityTolerance = Math.max(2, houseSize * 0.12);
        const isInnerRingPoint = (p) => Math.abs(radiusOf(p) - minRadius) <= innerPriorityTolerance;
        const signedAngleFromTop = (p) => {
            let d = angleOf(p) - topAngle;
            while (d <= -Math.PI) d += Math.PI * 2;
            while (d > Math.PI) d -= Math.PI * 2;
            return d;
        };

        const tryPlaceAccepted = (ordered, accepted, pending, acceptedKeys) => {
            for (const position of ordered) {
                const key = keyOf(position);
                if (acceptedKeys.has(key)) continue;
                if (!this.canAutoPlaceBuilding(base, position, allUnits, pending, BuildingTypes.HOUSE, houseSize)) {
                    continue;
                }

                accepted.push(position);
                acceptedKeys.add(key);
                const pendingHouse = this.prepareAutoPlacementBuilding(
                    new House(this.core.gameManager.player.color, position),
                    base,
                    position
                );
                pending.push(pendingHouse);
            }
        };

        const sorters = [
            // Symmetric sweep from top (closest to reference look).
            (a, b) => {
                const ra = radiusOf(a);
                const rb = radiusOf(b);
                const aInner = isInnerRingPoint(a);
                const bInner = isInnerRingPoint(b);
                if (aInner !== bInner) return aInner ? -1 : 1;
                if (Math.abs(ra - rb) > 0.5) return ra - rb;
                const aa = signedAngleFromTop(a);
                const ab = signedAngleFromTop(b);
                const absDiff = Math.abs(aa) - Math.abs(ab);
                if (Math.abs(absDiff) > 0.0001) return absDiff;
                return aa - ab;
            },
            // Center -> outside, then angle.
            (a, b) => {
                const ra = radiusOf(a);
                const rb = radiusOf(b);
                if (Math.abs(ra - rb) > 0.5) return ra - rb;
                return angleOf(a) - angleOf(b);
            },
            // Angle sweep, then radius.
            (a, b) => {
                const aa = angleOf(a);
                const ab = angleOf(b);
                if (Math.abs(aa - ab) > 0.0001) return aa - ab;
                return radiusOf(a) - radiusOf(b);
            },
            // Outside -> center (can fill edge gaps first).
            (a, b) => radiusOf(b) - radiusOf(a),
            // Alternate rings to reduce local locking.
            (a, b) => {
                const ra = radiusOf(a);
                const rb = radiusOf(b);
                const ringA = Math.floor(ra / ringStep);
                const ringB = Math.floor(rb / ringStep);
                const parityA = ringA % 2;
                const parityB = ringB % 2;
                if (parityA !== parityB) return parityA - parityB;
                if (ringA !== ringB) return ringA - ringB;
                return angleOf(a) - angleOf(b);
            }
        ];

        const aestheticPenalty = (accepted) => {
            if (accepted.length <= 2) return 0;

            // Lower penalty means more uniform angular distribution per ring.
            let penalty = 0;
            const rings = new Map();
            for (const p of accepted) {
                const r = radiusOf(p);
                const ringIndex = Math.max(0, Math.floor((r - minRadius) / ringStep));
                if (!rings.has(ringIndex)) rings.set(ringIndex, []);
                rings.get(ringIndex).push(angleOf(p));
            }

            for (const [, angles] of rings) {
                if (angles.length < 3) continue;
                angles.sort((a, b) => a - b);
                const idealGap = (Math.PI * 2) / angles.length;
                for (let i = 0; i < angles.length; i++) {
                    const current = angles[i];
                    const next = (i === angles.length - 1) ? (angles[0] + Math.PI * 2) : angles[i + 1];
                    const gap = next - current;
                    penalty += Math.abs(gap - idealGap);
                }
            }

            return penalty;
        };

        let bestOrder = [];
        let bestInnerCount = -1;
        let bestCount = -1;
        let bestPenalty = Infinity;

        for (const sorter of sorters) {
            const ordered = [...candidates].sort(sorter);
            const pending = [...initialPendingBuildings];
            const accepted = [];
            const acceptedKeys = new Set();
            tryPlaceAccepted(ordered, accepted, pending, acceptedKeys);

            // Second pass: fill local gaps that remain after the first greedy order.
            const fillOrders = [
                [...candidates].sort((a, b) => radiusOf(a) - radiusOf(b)),
                [...candidates].sort((a, b) => radiusOf(b) - radiusOf(a)),
                [...candidates].sort((a, b) => angleOf(a) - angleOf(b)),
                [...candidates].sort((a, b) => angleOf(b) - angleOf(a))
            ];
            for (const fillOrder of fillOrders) {
                const before = accepted.length;
                tryPlaceAccepted(fillOrder, accepted, pending, acceptedKeys);
                if (accepted.length === before) continue;
            }

            const innerCount = accepted.reduce((acc, p) => acc + (isInnerRingPoint(p) ? 1 : 0), 0);
            const currentPenalty = aestheticPenalty(accepted);
            if (
                innerCount > bestInnerCount ||
                (innerCount === bestInnerCount && accepted.length > bestCount) ||
                (innerCount === bestInnerCount && accepted.length === bestCount && currentPenalty < bestPenalty)
            ) {
                bestInnerCount = innerCount;
                bestCount = accepted.length;
                bestPenalty = currentPenalty;
                bestOrder = accepted;
            }
        }

        return bestOrder;
    }

    canAutoPlaceBuilding (base, position, allUnits, pendingBuildings, buildingType, buildingSize, options = {}) {
        const ignoreUnits = Boolean(options.ignoreUnits);
        const ignoreRadius = Boolean(options.ignoreRadius);
        const { minRadius, maxRadius } = this.getPlacementRadiusRangeForType(base, buildingType, buildingSize);
        const dx = position.x - base.position.x;
        const dy = position.y - base.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const radiusTolerance = buildingType === BuildingTypes.BARRACKS ? 12 : 4;
        if (!ignoreRadius && (distance < (minRadius - radiusTolerance) || distance > (maxRadius + radiusTolerance))) {
            return false;
        }

        const BuildingClass = BuildingManager.getBuildingClassByType(buildingType);
        if (!BuildingClass) return false;

        const existingBuildings = Array.isArray(base.buildings)
            ? base.buildings
            : Object.values(base.buildings || {});
        const collisionBuildings = [];
        for (const building of [...existingBuildings, ...(pendingBuildings || [])]) {
            if (!building || !building.position) continue;
            if (building.removeFlag) continue;
            if (!building.polygon && typeof building.initPolygon === "function") {
                building.initPolygon();
            }
            if (!building.polygon) continue;
            if (typeof building.updatePolygonTransform === "function") {
                building.updatePolygonTransform();
            }
            collisionBuildings.push(building);
        }
        const safeUnits = ignoreUnits ? [] : (allUnits || []).filter(unit => unit && unit.position && !unit.isFadingOut);

        const previewBuilding = new BuildingClass(this.core.gameManager.player.color, position);
        this.prepareAutoPlacementBuilding(previewBuilding, base, position);
        const preview = new BuildingPreview(previewBuilding);
        preview.checkCollision(collisionBuildings, safeUnits);
        return preview.buildable;
    }

    prepareAutoPlacementBuilding (building, base, position) {
        if (!building) return building;
        if (position && typeof building.setPosition === "function") {
            building.setPosition(position);
        }
        this.setAutoPlacementTargetPoint(building, base, position || building.position);
        if (!building.polygon && typeof building.initPolygon === "function") {
            building.initPolygon();
        }
        if (building.polygon && typeof building.updatePolygonTransform === "function") {
            building.updatePolygonTransform();
        }
        return building;
    }

    setAutoPlacementTargetPoint (building, base, position) {
        if (!building || !base || !position || typeof building.setTargetPoint !== "function") return;
        const dx = position.x - base.position.x;
        const dy = position.y - base.position.y;
        building.setTargetPoint({
            x: base.position.x + dx * 1.5,
            y: base.position.y + dy * 1.5
        });
    }

    canAutoPlaceGenerator (base, position, allUnits, pendingGenerators, generatorSize) {
        return this.canAutoPlaceBuilding(
            base,
            position,
            allUnits,
            pendingGenerators,
            BuildingTypes.GENERATOR,
            generatorSize
        );
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
