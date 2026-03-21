import Wall from "../../entities/building/Wall.js";
import Generator from "../../entities/building/Generator.js";
import House from "../../entities/building/House.js";
import Barracks from "../../entities/building/Barracks.js";
import Portal from "../../entities/building/Portal.js";
import SimpleTurret from "../../entities/building/SimpleTurret.js";
import SniperTurret from "../../entities/building/SniperTurret.js";
import Armory from "../../entities/building/Armory.js";
import BuildingPreview from "../../entities/BuildingPreview.js";
import { BuildingSizes, BuildingTypes, BuildingVariantTypes, UnitTypes, UnitVariantTypes, getAvailableBuildingUpgrades, getBuildingDetails } from "../../network/constants.js";
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

// Legacy socket layout provided by user (angle, radius, legacyType).
// Legacy types map:
// 1 -> Wall, 4 -> House, 7 -> Armory, 8 -> Barracks
const LEGACY_EXTERNA_SOCKET_LAYOUT = [
    [-1.06, 310, 8], [-2.08, 310, 8], [-0.64, 310, 8], [-2.5, 310, 8],
    [-1.67, 306, 1], [-1.47, 306, 1], [-1.87, 306, 1], [-1.27, 306, 1], [-2.29, 306, 1], [-0.85, 306, 1],
    [-2.71, 306, 1], [-0.43, 306, 1], [-2.91, 306, 1], [-0.23, 306, 1], [-3.11, 306, 1], [-0.03, 306, 1],
    [2.97, 306, 1], [0.17, 306, 1], [2.77, 306, 1], [0.37, 306, 1], [2.57, 306, 1], [0.57, 306, 1],
    [2.37, 306, 1], [0.77, 306, 1], [2.17, 306, 1], [0.97, 306, 1], [1.97, 306, 1], [1.17, 306, 1],
    [1.77, 306, 1], [1.37, 306, 1], [1.5707963267948966, 306, 1],
    [-1.7, 245.85, 4], [-1.44, 245.85, 4], [-1.95, 245.85, 4], [-1.19, 245.85, 4], [-2.2, 245.85, 4], [-0.94, 245.85, 4],
    [-2.45, 245.85, 4], [-0.69, 245.85, 4], [-2.7, 245.85, 4], [-0.44, 245.85, 4], [-2.95, 245.85, 4], [-0.19, 245.85, 4],
    [3.08, 245.85, 4], [-6.22, 245.85, 4], [2.83, 245.85, 4], [-5.97, 245.85, 4], [2.58, 245.85, 4], [-5.72, 245.85, 4],
    [2.33, 245.85, 4], [-5.47, 245.85, 4], [2.08, 245.85, 4], [-5.22, 245.85, 4], [1.83, 245.85, 4], [-4.97, 245.85, 4],
    [1.5707963267948966, 245.85, 4],
    [-1.92, 186, 4], [-1.22, 186, 4], [-2.25, 186, 4], [-0.89, 186, 4], [-2.57, 190.5, 4], [-0.57, 190.5, 4],
    [-2.89, 186, 4], [-0.25, 186, 4], [3.05, 186, 4], [-6.19, 186, 4], [2.72, 190.5, 4], [-5.86, 190.5, 4],
    [2.4, 187.5, 4], [-5.54, 187.5, 4], [2.07, 185.5, 4], [-5.21, 185.5, 4], [1.74, 189, 4], [-4.88, 189, 4],
    [4.71238898038469, 140, 7],
    [-2.1, 130, 4], [-1.04, 130, 4], [-2.57, 130, 4], [-0.57, 130, 4], [-3.04, 130, 4], [-0.1, 130, 4],
    [2.77, 130, 4], [-5.91, 130, 4], [2.28, 130, 4], [-5.42, 130, 4], [1.81, 130, 4], [-4.95, 130, 4]
];

// Fine-tuning offsets for legacy ExternaTK preset.
const LEGACY_EXTERNA_ANGLE_OFFSET = 0; // Keep exact socket angles from the provided ExternaTK preset.
const LEGACY_EXTERNA_RADIUS_SCALE = 1.0; // Keep original socket radius fidelity.
const WALL_OUTER_RING_OFFSET = 3; // Wall outer ring tightened by another 1px.
const BARRACKS_OUTER_RING_OFFSET = 5; // Keep barracks aligned with legacy ExternaTK socket radius.
const INNER_RING_VISUAL_MARGIN = 4; // Keep inner-building visuals fully inside the white helper ring.
const INNER_RING_MIN_RADIUS_TOLERANCE = 1; // Preserve legacy sockets near the inner edge.
const INNER_HELPER_RING_OFFSET = WALL_OUTER_RING_OFFSET - (BuildingSizes.WALL?.size || 27);

function getInnerHelperRingRadius (base) {
    return base.buildingRadius.max + INNER_HELPER_RING_OFFSET;
}

// Legacy socket layout for Autogens (angle, radius, legacyType=3 => Generator).
const LEGACY_AUTOGENS_SOCKET_LAYOUT = [
    [-1.71, 243.85, 3], [-1.43, 243.85, 3], [-2.01, 243.85, 3], [-1.13, 243.85, 3],
    [-0.86, 243.85, 3], [-2.28, 243.85, 3], [-2.55, 243.85, 3], [-0.59, 243.85, 3],
    [-2.82, 243.85, 3], [-0.32, 243.85, 3], [-0.05, 243.85, 3], [-3.09, 243.85, 3],
    [2.92, 243.85, 3], [0.22, 243.85, 3], [0.49, 243.85, 3], [2.65, 243.85, 3],
    [0.76, 243.85, 3], [2.38, 243.85, 3], [2.11, 243.85, 3], [1.03, 243.85, 3],
    [1.84, 243.85, 3], [1.3, 243.85, 3], [1.5707963267948966, 243.85, 3],
    [-1.945, 181, 3], [-1.195, 181, 3], [-0.66, 181.3, 3], [-2.48, 181.3, 3],
    [-3.01, 182, 3], [-0.13, 182, 3], [2.75, 183, 3], [0.39, 183, 3],
    [0.88, 184, 3], [2.25, 184, 3], [1.75, 182, 3], [1.39, 182, 3],
    [-0.925, 132, 3], [-2.215, 132, 3], [-2.75, 132, 3], [-0.39, 132, 3],
    [3, 132, 3], [0.14, 132, 3], [2.5, 132, 3], [0.64, 132, 3],
    [1.13, 132, 3], [2.01, 132, 3]
];
const LEGACY_AUTOGENS_ANGLE_OFFSET = 0;
const LEGACY_AUTOGENS_RADIUS_SCALE = 1.0;

export class BuildingManager {
    constructor (core) {
        this.core = core;
        this.buildingToPlace = null; // Selected by toolbar
        this.selectedPlacementType = null;
        this.placementRotationStep = 0;
        this.selectedBuildings = []; // Clicked, or selected by selection circle
        this.lastSelectedBuilding = null;
        this.placementHintShown = false;
        this.placementRotateHintShown = false;

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
        this.defensePlacementPressure = 0;
        this.defensePlacementPressureMax = 12;
        this.lastDefensePlacementPressAt = 0;
        this.defenseThreatCache = { at: 0, units: [], dominantAngle: null };
        // Batch-defense: place/remount many slots per cycle for fast rebuilds.
        this.defensePlacementBurstSize = 12;
        this.defenseRemountBurstSize = 30;
        this.defensePlacementIntervalMs = 120;

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

    canRotatePlacementType (buildingType) {
        return buildingType === BuildingTypes.GENERATOR || buildingType === BuildingTypes.HOUSE;
    }

    getPlacementRotationModulo (buildingType) {
        if (buildingType === BuildingTypes.GENERATOR) return 6;
        if (buildingType === BuildingTypes.HOUSE) return 5;
        return 1;
    }

    getPlacementRotationOrder (buildingType, preferredStep = 0) {
        const modulo = this.getPlacementRotationModulo(buildingType);
        if (modulo <= 1) return [0];

        const numericPreferred = Number.isFinite(Number(preferredStep)) ? Math.floor(Number(preferredStep)) : 0;
        const baseStep = ((numericPreferred % modulo) + modulo) % modulo;
        const order = [baseStep];
        for (let delta = 1; order.length < modulo; delta++) {
            const plus = (baseStep + delta) % modulo;
            if (!order.includes(plus)) {
                order.push(plus);
            }
            if (order.length >= modulo) break;

            const minus = (baseStep - delta + modulo) % modulo;
            if (!order.includes(minus)) {
                order.push(minus);
            }
        }
        return order;
    }

    findBestAutoPlacementRotationStep (base, position, allUnits, pendingBuildings, buildingType, buildingSize, options = {}) {
        const modulo = this.getPlacementRotationModulo(buildingType);
        const canPlaceOptions = { ...options };
        const preferredRotationStep = canPlaceOptions.preferredRotationStep;
        delete canPlaceOptions.preferredRotationStep;

        const providedOrder = Array.isArray(canPlaceOptions.rotationOrder) ? canPlaceOptions.rotationOrder : null;
        delete canPlaceOptions.rotationOrder;

        if (modulo <= 1) {
            return this.canAutoPlaceBuilding(
                base,
                position,
                allUnits,
                pendingBuildings,
                buildingType,
                buildingSize,
                { ...canPlaceOptions, rotationStep: 0 }
            ) ? 0 : null;
        }

        const normalizeStep = (step) => {
            const numeric = Number.isFinite(Number(step)) ? Math.floor(Number(step)) : 0;
            return ((numeric % modulo) + modulo) % modulo;
        };

        const rotationOrder = providedOrder && providedOrder.length > 0
            ? [...new Set(providedOrder.map(normalizeStep))]
            : this.getPlacementRotationOrder(buildingType, preferredRotationStep);

        for (const rotationStep of rotationOrder) {
            if (this.canAutoPlaceBuilding(
                base,
                position,
                allUnits,
                pendingBuildings,
                buildingType,
                buildingSize,
                { ...canPlaceOptions, rotationStep }
            )) {
                return rotationStep;
            }
        }

        return null;
    }

    rotateCurrentPlacement (direction = 1) {
        const placed = this.buildingToPlace?.building;
        if (!placed) return false;
        const buildingType = placed.type;
        if (!this.canRotatePlacementType(buildingType)) return false;
        const modulo = this.getPlacementRotationModulo(buildingType);
        const delta = direction >= 0 ? 1 : -1;
        this.placementRotationStep = (this.placementRotationStep + delta + modulo) % modulo;
        if (typeof placed.setPlacementRotationStep === "function") {
            placed.setPlacementRotationStep(this.placementRotationStep);
        }
        this.updateBuildingPosition();
        return true;
    }

    getCurrentPlacementRotationStep () {
        const placed = this.buildingToPlace?.building;
        if (!placed) return 0;
        if (!this.canRotatePlacementType(placed.type)) return 0;
        return this.placementRotationStep;
    }

    getPlacementRadiusToleranceForType (buildingType) {
        if (buildingType === BuildingTypes.BARRACKS) return 12;
        if (
            buildingType === BuildingTypes.SIMPLE_TURRET ||
            buildingType === BuildingTypes.SNIPER_TURRET ||
            buildingType === BuildingTypes.ARMORY ||
            buildingType === BuildingTypes.GENERATOR ||
            buildingType === BuildingTypes.HOUSE
        ) {
            return 1;
        }
        return 4;
    }

    isPlacementDistanceValidForType (distance, minRadius, maxRadius, buildingType, tolerance) {
        if (buildingType === BuildingTypes.BARRACKS) {
            return distance >= (maxRadius - tolerance) && distance <= (maxRadius + tolerance);
        }
        return distance >= (minRadius - tolerance) && distance <= (maxRadius + tolerance);
    }

    resolvePlacementBaseForPosition (position, buildingType, buildingSize) {
        const playerBase = this.core.gameManager.player;
        if (!playerBase || !position) return null;

        const tolerance = this.getPlacementRadiusToleranceForType(buildingType);
        const isValidForBase = (base) => {
            if (!base?.position) return false;
            const { minRadius, maxRadius } = this.getPlacementRadiusRangeForType(base, buildingType, buildingSize);
            const dx = position.x - base.position.x;
            const dy = position.y - base.position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            return this.isPlacementDistanceValidForType(distance, minRadius, maxRadius, buildingType, tolerance);
        };

        // Match server priority: player base first, then captured neutrals.
        if (isValidForBase(playerBase)) {
            return playerBase;
        }

        const neutrals = this.core.gameManager.capturedNeutrals || [];
        for (const neutralBase of neutrals) {
            if (isValidForBase(neutralBase)) {
                return neutralBase;
            }
        }

        return null;
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
            const referenceBuilding = this.selectedBuildings[0];
            const getAllSameTypeTargetsInClosestBase = () => {
                const reference = referenceBuilding;
                if (!reference || !closestBase) return [];
                return (closestBase.buildings || []).filter((building) =>
                    building
                    && !building.removeFlag
                    && building.type === reference.type
                );
            };
            const getSameTypeVariantTargetsInClosestBase = () => {
                const reference = referenceBuilding;
                if (!reference || !closestBase) return [];
                return (closestBase.buildings || []).filter((building) =>
                    building
                    && !building.removeFlag
                    && building.type === reference.type
                    && building.variant === reference.variant
                );
            };
            const onDestroyClicked = (options = {}) => {
                const applyAll = Boolean(options?.applyAll);
                const targets = applyAll ? getAllSameTypeTargetsInClosestBase() : this.selectedBuildings;
                const buildingIDs = targets.map((building) => building.id);
                if (buildingIDs.length === 0) return;

                this.deselectBuildings();
                this.core.uiManager.hideUpgrades();

                const neutralBaseID = isNeutralBase ? closestBase.id : null;

                this.core.networkManager.removeBuildings(buildingIDs, neutralBaseID);
            };

            const allSameTypeAndVariant = this.selectedBuildings.every(b => b.type === this.selectedBuildings[0].type && b.variant === this.selectedBuildings[0].variant);
            const getAllCountForPanel = () => {
                if (!allSameTypeAndVariant) return this.selectedBuildings.length;
                return Math.max(this.selectedBuildings.length, getAllSameTypeTargetsInClosestBase().length);
            };
            const getAllRefundForPanel = () => {
                const sameTypeTargets = getAllSameTypeTargetsInClosestBase();
                if (sameTypeTargets.length === 0) return 0;
                return sameTypeTargets.reduce((total, building) => {
                    const details = getBuildingDetails(building.type, building.variant);
                    return total + Math.floor((details?.cost || 0) / 2);
                }, 0);
            };

            if (allSameTypeAndVariant) {
                const onUpgradeClicked = (data) => {

                    if (data) {
                        const upgradeAll = Boolean(data?.upgradeAll);
                        let targetBuildings = (upgradeAll && allSameTypeAndVariant)
                            ? getAllSameTypeTargetsInClosestBase()
                            : [...this.selectedBuildings];
                        if (targetBuildings.length === 0) return;
                        if (upgradeAll) {
                            const targetVariant = Number(data?.buildingVariant);
                            targetBuildings = targetBuildings.filter((building) => {
                                if (!building || building.removeFlag || building.type !== referenceBuilding?.type) return false;
                                if (building.variant === targetVariant) return false;
                                const available = getAvailableBuildingUpgrades(building.type, building.variant, building.purchasedUpgrades ? Array.from(building.purchasedUpgrades) : []);
                                return available.some((u) => Number(u?.variant) === targetVariant);
                            });
                            if (targetBuildings.length === 0) {
                                this.core.uiManager.addChatMessage("System", "No valid buildings left for this upgrade.", "#ffcc66");
                                return;
                            }
                        }
                        const perBuildingCost = Number.isFinite(Number(data.baseCost))
                            ? Number(data.baseCost)
                            : (Number(data.cost) / Math.max(1, this.selectedBuildings.length));
                        if (!Number.isFinite(perBuildingCost) || perBuildingCost <= 0) return;
                        if (upgradeAll && targetBuildings.length > 1) {
                            const affordableCount = Math.floor(this.core.gameManager.resources.power.current / perBuildingCost);
                            if (affordableCount <= 0) {
                                this.core.uiManager.addChatMessage("System", "Not enough power for Auto Upgrade.", "#ffcc66");
                                return;
                            }
                            if (affordableCount < targetBuildings.length) {
                                targetBuildings = targetBuildings.slice(0, affordableCount);
                                this.core.uiManager.addChatMessage(
                                    "System",
                                    `Auto Upgrade: upgraded ${targetBuildings.length}/${(upgradeAll && allSameTypeAndVariant) ? getAllSameTypeTargetsInClosestBase().length : targetBuildings.length}.`,
                                    "#60c1ff"
                                );
                            }
                        }
                        const targetIDs = targetBuildings.map((building) => building.id);
                        if (targetIDs.length === 0) return;
                        const totalCost = Math.max(0, Math.round(perBuildingCost * targetIDs.length));

                        // Armory unit upgrade flow
                        if (data.unitType !== undefined && data.unitVariant !== undefined) {
                            const currentPower = this.core.gameManager.resources.power.current;
                            if (currentPower < totalCost) {
                                this.core.uiManager.addChatMessage("System", "Not enough power to upgrade.", "#ffcc66");
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

                            this.core.gameManager.subtractResources(totalCost);
                            this.core.gameManager.applyUnitUpgrade(data.unitType, data.unitVariant);

                            const neutralBaseID = isNeutralBase ? closestBase.id : null;
                            this.core.networkManager.upgradeBuildings(targetIDs, data.buildingVariant, neutralBaseID);

                            targetBuildings.forEach(building => {
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
                                allCount: getAllCountForPanel(),
                                allRefund: getAllRefundForPanel(),
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
                        if (currentPower < totalCost) {
                            this.core.uiManager.addChatMessage("System", "Not enough power to upgrade.", "#ffcc66");
                            return;
                        }
    
                        this.core.gameManager.subtractResources(totalCost);
    
                        const neutralBaseID = isNeutralBase ? closestBase.id : null;

                        this.core.networkManager.upgradeBuildings(targetIDs, data.buildingVariant, neutralBaseID);

                        // Keep selection/panel open so next evolution appears immediately.
                        targetBuildings.forEach((selectedBuilding) => {
                            if (selectedBuilding?.setUpgrade) {
                                selectedBuilding.setUpgrade(data.buildingVariant);
                            } else {
                                selectedBuilding.variant = data.buildingVariant;
                            }
                        });

                        this.core.uiManager.showUpgrades({
                            buildings: this.selectedBuildings,
                            count: this.selectedBuildings.length,
                            allCount: getAllCountForPanel(),
                            allRefund: getAllRefundForPanel(),
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
                    allCount: getAllCountForPanel(),
                    allRefund: getAllRefundForPanel(),
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
        this.placementRotationStep = 0;
        if (typeof building.setPlacementRotationStep === "function") {
            building.setPlacementRotationStep(0);
        }

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
        if (this.canRotatePlacementType(building.type) && !this.placementRotateHintShown) {
            this.core.uiManager?.addChatMessage?.(
                "System",
                "Press R while placing to rotate this building and fit corners.",
                "#60c1ff"
            );
            this.placementRotateHintShown = true;
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
                    minRadius = closestBase.buildingRadius.max + BARRACKS_OUTER_RING_OFFSET;
                    maxRadius = minRadius;
                    break;
                case BuildingTypes.WALL:
                    // Walls follow the legacy outer ring offset standard.
                    minRadius += this.buildingToPlace.building.size;
                    maxRadius = closestBase.buildingRadius.max + WALL_OUTER_RING_OFFSET;
                    break;
                case BuildingTypes.SIMPLE_TURRET:
                case BuildingTypes.SNIPER_TURRET:
                case BuildingTypes.ARMORY:
                case BuildingTypes.PORTAL:
                case BuildingTypes.GENERATOR:
                case BuildingTypes.HOUSE:
                    // These buildings must stay inside the white helper ring.
                    maxRadius = getInnerHelperRingRadius(closestBase) - this.buildingToPlace.building.size - INNER_RING_VISUAL_MARGIN;
                    minRadius += Math.max(0, this.buildingToPlace.building.size - INNER_RING_MIN_RADIUS_TOLERANCE);
                    break;
                default:
                    // Circular shape (Wall, turret, ...)
                    minRadius += this.buildingToPlace.building.size;
            }

            if (maxRadius < minRadius) {
                maxRadius = minRadius;
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

            const resolvedPlacementBase = this.resolvePlacementBaseForPosition(
                mousePosition,
                buildingType,
                this.buildingToPlace.building.size
            );
            const placementBase = resolvedPlacementBase || closestBase;

            // Calculate the direction vector from the player to the building
            const directionX = this.buildingToPlace.building.position.x - placementBase.position.x;
            const directionY = this.buildingToPlace.building.position.y - placementBase.position.y;

            // Calculate the inverted position by reversing the direction and scaling it
            const invertedPosition = {
                x: placementBase.position.x + directionX * 1.5,
                y: placementBase.position.y + directionY * 1.5
            };
            if (typeof this.buildingToPlace.building.applyPlacementTargetFromBase === "function") {
                this.buildingToPlace.building.applyPlacementTargetFromBase(placementBase.position, 1.5);
            } else {
                this.buildingToPlace.building.setTargetPoint(invertedPosition);
            }

            const allBuildings = placementBase.buildings;
            let allUnits = [];
            this.core.gameManager.players.forEach(p => {
                allUnits.push(...p.units);
            });

            // Check for collisions with other buildings
            this.buildingToPlace.buildingPreview.checkCollision(allBuildings, allUnits);
            if (!resolvedPlacementBase) {
                this.buildingToPlace.buildingPreview.buildable = false;
            }

        }
    }

    // Place the selected building on the map
    placeBuilding () {
        if (this.buildingToPlace) {
            this.updateBuildingPosition();
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
            const resolvedPlacementBase = this.resolvePlacementBaseForPosition(
                position,
                buildingType,
                this.buildingToPlace.building.size
            );
            if (!resolvedPlacementBase) {
                this.buildingToPlace.buildingPreview.buildable = false;
                return;
            }
            const placementRotationStep = this.getCurrentPlacementRotationStep();
            let allUnits = [];
            this.core.gameManager.players.forEach(p => {
                allUnits.push(...p.units);
            });
            const snappedPosition = this.findNearestValidPlacementPosition(
                resolvedPlacementBase,
                position,
                allUnits,
                buildingType,
                this.buildingToPlace.building.size,
                placementRotationStep
            );
            if (!snappedPosition) {
                this.buildingToPlace.buildingPreview.buildable = false;
                this.core.uiManager?.addChatMessage?.(
                    "System",
                    "Invalid placement after rotation. Try a slightly different position.",
                    "#ffcc66"
                );
                return;
            }
            if (snappedPosition.x !== position.x || snappedPosition.y !== position.y) {
                this.buildingToPlace.building.setPosition(snappedPosition);
            }

            const ok = this.core.gameManager.increaseBuildingLimit(buildingType);
            if (!ok) {
                this.core.uiManager?.addChatMessage?.(
                    "System",
                    "Building limit reached for this type.",
                    "#ffcc66"
                );
                return
            }

            const finalPosition = this.buildingToPlace.building.position;
            this.core.networkManager.placeBuilding(buildingType, finalPosition, false, placementRotationStep);

            // Client prediction
            this.core.gameManager.player.setBuildingCache(this.buildingToPlace.building);


            this.core.gameManager.subtractResources(cost);

            this.reselectBuildingForPlacement();
        }
    }

    // Helper method to re-select the building type for continued placement
    reselectBuildingForPlacement () {
        const previousRotationStep = this.placementRotationStep;
        const buildingType = this.buildingToPlace.building.constructor;
        this.handleBuildingSelectionForPlacement(buildingType);
        if (this.buildingToPlace?.building && this.canRotatePlacementType(this.buildingToPlace.building.type)) {
            const modulo = this.getPlacementRotationModulo(this.buildingToPlace.building.type);
            this.placementRotationStep = previousRotationStep % modulo;
            if (typeof this.buildingToPlace.building.setPlacementRotationStep === "function") {
                this.buildingToPlace.building.setPlacementRotationStep(this.placementRotationStep);
            }
            this.updateBuildingPosition();
        }
    }

    // Ensure the selected building is properly removed
    removeBuildingToPlace () {
        if (this.buildingToPlace) {
            const { building, buildingPreview } = this.buildingToPlace;
            this.core.renderer.removeFromQueue(buildingPreview, QueueType.OVERLAY);
            this.core.renderer.removeFromQueue(building, QueueType.OVERLAY);
            this.buildingToPlace = null;
        }
        this.placementRotationStep = 0;
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
            clearTimeout(this.defensePlacementTimer);
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
            .filter(b => b && !b.removeFlag)
            .map(b => ({
                type: b.type,
                rotationStep: Number.isFinite(Number(b.placementRotationStep)) ? Number(b.placementRotationStep) : 0,
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
            this.bumpDefensePlacementPressure();
            if (this.defensePlacementActive) {
                this.placeDefenseWallBurst();
                return;
            }
            this.stopDefenseRemount();
            this.defensePlacementActive = true;
            this.placeDefenseWallBurst();
            this.scheduleDefensePlacementTick();
            return;
        }

        if (key === this.defenseRemountKey) {
            if (this.defenseRemountActive) return;
            this.stopDefensePlacement();
            this.defenseRemountActive = true;
            this.remountDefenseSlotsBurst();
            this.defenseRemountTimer = setInterval(() => {
                if (!this.defenseRemountActive) return;
                this.remountDefenseSlotsBurst();
            }, 120);
        }
    }

    placeDefenseWallBurst () {
        if (!this.defensePlacementActive || !this.defenseProfile) return 0;
        const player = this.core.gameManager.player;
        if (!player) return 0;

        const pressureBonus = Math.max(0, Math.floor(this.getDefensePlacementPressureLevel() * 1.35));
        const burst = Math.max(1, (Number(this.defensePlacementBurstSize) || 1) + pressureBonus);
        const pendingPredictedWalls = [];
        const sharedContext = {
            threatCandidates: null,
            threatCursor: 0,
            slotCursor: 0
        };
        let placed = 0;
        for (let i = 0; i < burst; i++) {
            if (!this.placeOneDefenseWall(pendingPredictedWalls, sharedContext)) break;
            placed++;
        }
        return placed;
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

    getDefensePlacementPressureLevel () {
        const now = Date.now();
        const idleMs = now - this.lastDefensePlacementPressAt;
        if (idleMs > 1300) return 0;
        if (idleMs <= 0) return this.defensePlacementPressure;
        const decaySteps = Math.floor(idleMs / 180);
        return Math.max(0, this.defensePlacementPressure - decaySteps);
    }

    bumpDefensePlacementPressure () {
        const now = Date.now();
        const idleMs = now - this.lastDefensePlacementPressAt;
        if (idleMs > 1300) {
            this.defensePlacementPressure = 0;
        }
        if (idleMs > 45 || this.lastDefensePlacementPressAt === 0) {
            this.defensePlacementPressure = Math.min(
                this.defensePlacementPressureMax,
                this.defensePlacementPressure + 1
            );
        }
        this.lastDefensePlacementPressAt = now;
    }

    getDefensePlacementIntervalMs () {
        const pressure = this.getDefensePlacementPressureLevel();
        const base = Math.max(40, Number(this.defensePlacementIntervalMs) || 180);
        return Math.max(38, base - pressure * 9);
    }

    scheduleDefensePlacementTick () {
        if (!this.defensePlacementActive) return;
        const intervalMs = this.getDefensePlacementIntervalMs();
        this.defensePlacementTimer = setTimeout(() => {
            if (!this.defensePlacementActive) return;
            this.placeDefenseWallBurst();
            this.scheduleDefensePlacementTick();
        }, intervalMs);
    }

    collectDefenseThreatUnits (player, limit = 24) {
        if (!player) return [];
        const others = Array.isArray(this.core.gameManager.players) ? this.core.gameManager.players : [];
        const maxThreatRadius = Math.max(player.buildingRadius.max + 220, 420);
        const maxThreatRadiusSq = maxThreatRadius * maxThreatRadius;
        const preferredWallRadius = player.buildingRadius.max;
        const threats = [];

        for (const other of others) {
            if (!other || other === player || other.id === player.id) continue;
            const unitPools = [other.units || [], other.spawningUnits || []];
            for (const pool of unitPools) {
                for (const unit of pool) {
                    if (!unit || unit.isFadingOut || !unit.position) continue;
                    const dx = unit.position.x - player.position.x;
                    const dy = unit.position.y - player.position.y;
                    const distanceSq = dx * dx + dy * dy;
                    if (!Number.isFinite(distanceSq) || distanceSq > maxThreatRadiusSq) continue;
                    const distance = Math.sqrt(distanceSq);
                    const angle = Math.atan2(dy, dx);

                    let unitWeight = 1;
                    if (unit.type === UnitTypes.SIEGE_TANK) unitWeight = 1.8;
                    else if (unit.type === UnitTypes.TANK) unitWeight = 1.4;
                    else if (unit.type === UnitTypes.COMMANDER || unit.type === UnitTypes.TRI_COMMANDER) unitWeight = 1.6;

                    const ringDelta = Math.abs(distance - preferredWallRadius);
                    const ringScore = 1 / (1 + ringDelta * 0.045);
                    const score = unitWeight * ringScore;
                    threats.push({ angle, distance, score });
                }
            }
        }

        threats.sort((a, b) => b.score - a.score);
        return threats.slice(0, Math.max(1, limit | 0));
    }

    buildDefenseThreatWallCandidates (player, wallSize) {
        if (!player) return [];
        const range = this.getPlacementRadiusRangeForType(player, BuildingTypes.WALL, wallSize);
        const minRadius = Number(range?.minRadius) || 0;
        const maxRadius = Number(range?.maxRadius) || minRadius;
        if (maxRadius < minRadius) return [];

        const clampRadius = (radius) => Math.max(minRadius, Math.min(maxRadius, radius));
        const preferredRadius = clampRadius(maxRadius);
        const coneOffsetsWide = [0, -0.05, 0.05, -0.1, 0.1, -0.15, 0.15, -0.2, 0.2, -0.25, 0.25, -0.3, 0.3];
        const coneOffsetsTight = [0, -0.03, 0.03, -0.06, 0.06, -0.09, 0.09];
        const radiusOffsets = [0, -2, 2, -4, 4];
        const layeredRadii = [];
        for (let i = 0; i < 5; i++) {
            layeredRadii.push(clampRadius(preferredRadius - i * 8));
        }
        const threats = this.collectDefenseThreatUnits(player, 24);
        if (threats.length === 0) return [];

        const out = [];
        const seen = new Set();
        const addCandidate = (angle, radius) => {
            const r = clampRadius(radius);
            const x = player.position.x + Math.cos(angle) * r;
            const y = player.position.y + Math.sin(angle) * r;
            const key = `${Math.round(x * 4)}:${Math.round(y * 4)}`;
            if (seen.has(key)) return;
            seen.add(key);
            out.push({ x, y });
        };

        let weightedX = 0;
        let weightedY = 0;
        for (const threat of threats) {
            const weight = Math.max(0.05, Number(threat.score) || 0.05);
            weightedX += Math.cos(threat.angle) * weight;
            weightedY += Math.sin(threat.angle) * weight;
        }
        const dominantAngle = Math.atan2(weightedY || 0, weightedX || 1);

        // Priority #1: deep layered cone at the dominant attack direction.
        for (const radius of layeredRadii) {
            for (const angleOffset of coneOffsetsWide) {
                addCandidate(dominantAngle + angleOffset, radius);
            }
        }

        // Priority #2: reinforce around top threats with tighter cones across layers.
        const focusedThreats = threats.slice(0, 12);
        for (const threat of focusedThreats) {
            for (const radius of layeredRadii) {
                for (const angleOffset of coneOffsetsTight) {
                    addCandidate(threat.angle + angleOffset, radius);
                }
            }
        }

        // Priority #3: keep classic per-threat sockets for broader coverage.
        for (const threat of threats) {
            const baseRadius = clampRadius(threat.distance);
            for (const angleOffset of coneOffsetsTight) {
                for (const radiusOffset of radiusOffsets) {
                    addCandidate(threat.angle + angleOffset, baseRadius + radiusOffset);
                }
            }
            addCandidate(threat.angle, preferredRadius);
        }

        return out;
    }

    placeOneDefenseWall (pendingPredictedWalls = null, context = null) {
        if (!this.defenseProfile || !Array.isArray(this.defenseProfile.entries)) return false;

        const player = this.core.gameManager.player;
        if (!player) return false;

        const wallType = BuildingTypes.WALL;
        const wallSize = getBuildingDetails(wallType)?.size || 30;
        const cost = this.getPlacementCost(wallType);
        if (this.core.gameManager.resources.power.current < cost) return false;

        const positionToleranceSq = 14 * 14;
        const baseBuildings = (player.buildings || []).filter(b => b && !b.removeFlag);
        const pendingWalls = Array.isArray(pendingPredictedWalls)
            ? pendingPredictedWalls.filter(b => b && !b.removeFlag)
            : [];
        const currentBuildings = [...baseBuildings, ...pendingWalls];
        this.syncDefensePlacedWallsWithCurrentState(player, positionToleranceSq);
        const currentWalls = currentBuildings.filter(b => b.type === BuildingTypes.WALL);
        const hasWallNearPosition = (position, toleranceSq = positionToleranceSq) => {
            return currentWalls.some(w => {
                const dx = w.position.x - position.x;
                const dy = w.position.y - position.y;
                return dx * dx + dy * dy <= toleranceSq;
            });
        };

        const runtime = context || {};
        if (!Array.isArray(runtime.threatCandidates)) {
            runtime.threatCandidates = this.buildDefenseThreatWallCandidates(player, wallSize);
            runtime.threatCursor = 0;
        }
        if (!Number.isInteger(runtime.slotCursor) || runtime.slotCursor < 0) {
            runtime.slotCursor = 0;
        }

        let selectedPosition = null;

        // Priority #1: block enemy advance with layered threat candidates.
        while (runtime.threatCursor < runtime.threatCandidates.length) {
            const candidate = runtime.threatCandidates[runtime.threatCursor++];
            if (!candidate) continue;
            if (hasWallNearPosition(candidate, 11 * 11)) continue;
            if (this.canAutoPlaceBuilding(player, candidate, [], pendingWalls, wallType, wallSize, { ignoreUnits: true })) {
                selectedPosition = candidate;
                break;
            }
        }

        // Priority #2: keep legacy defend slots recovered.
        if (!selectedPosition) {
            const entries = this.defenseProfile.entries;
            const total = entries.length;
            if (total > 0) {
                for (let i = 0; i < total; i++) {
                    const idx = (runtime.slotCursor + i) % total;
                    const entry = entries[idx];
                    const hasOriginalBuilding = currentBuildings.some(b => {
                        if (b.type !== entry.type) return false;
                        const dx = b.position.x - entry.position.x;
                        const dy = b.position.y - entry.position.y;
                        return dx * dx + dy * dy <= positionToleranceSq;
                    });
                    if (hasOriginalBuilding) continue;

                    const slotPosition = { x: entry.position.x, y: entry.position.y };
                    if (hasWallNearPosition(slotPosition)) continue;

                    const candidate = slotPosition;
                    runtime.slotCursor = (idx + 1) % total;
                    if (!this.canAutoPlaceBuilding(player, candidate, [], pendingWalls, wallType, wallSize, { ignoreUnits: true })) {
                        continue;
                    }
                    selectedPosition = candidate;
                    break;
                }
            }
        }

        // Priority #3: regenerate threat candidates once if everything above is exhausted.
        if (!selectedPosition && context && context.threatCandidates.length > 0) {
            context.threatCandidates = this.buildDefenseThreatWallCandidates(player, wallSize);
            context.threatCursor = 0;
            while (context.threatCursor < context.threatCandidates.length) {
                const candidate = context.threatCandidates[context.threatCursor++];
                if (!candidate) continue;
                if (hasWallNearPosition(candidate, 11 * 11)) continue;
                if (!this.canAutoPlaceBuilding(player, candidate, [], pendingWalls, wallType, wallSize, { ignoreUnits: true })) {
                    continue;
                }
                selectedPosition = candidate;
                break;
            }
        }

        if (!selectedPosition) return false;

        const ok = this.core.gameManager.increaseBuildingLimit(wallType);
        if (!ok) return false;

        this.core.networkManager.placeBuilding(wallType, selectedPosition, true);
        const predicted = this.prepareAutoPlacementBuilding(
            new Wall(player.color, selectedPosition),
            player,
            selectedPosition
        );
        player.setBuildingCache(predicted);
        if (Array.isArray(pendingPredictedWalls)) {
            pendingPredictedWalls.push(predicted);
        }
        this.core.gameManager.subtractResources(cost);
        this.defensePlacedWalls.push(selectedPosition);
        if (this.defensePlacedWalls.length > 240) {
            this.defensePlacedWalls.splice(0, this.defensePlacedWalls.length - 240);
        }
        return true;
    }

    remountDefenseSlotsBurst () {
        if (!this.defenseProfile || !Array.isArray(this.defenseProfile.entries)) return 0;
        const player = this.core.gameManager.player;
        if (!player) return 0;

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

        // First pass: remove all matching walls in one batch.
        const slotsWithWalls = [];
        const wallIDsToRemove = new Set();
        for (const entry of this.defenseProfile.entries) {
            if (isOriginalBuildingPresent(entry)) continue;
            if (hasOtherBuildingInSlot(entry)) continue;
            const matchingWalls = findWallsInSavedSlot(entry);
            if (matchingWalls.length === 0) continue;
            slotsWithWalls.push(entry.position);
            for (const wall of matchingWalls) {
                wallIDsToRemove.add(wall.id);
            }
        }
        if (wallIDsToRemove.size > 0) {
            this.defensePlacedWalls = this.defensePlacedWalls.filter(saved => {
                return !slotsWithWalls.some(position => {
                    const dx = saved.x - position.x;
                    const dy = saved.y - position.y;
                    return dx * dx + dy * dy <= wallMatchToleranceSq;
                });
            });
            this.core.networkManager.removeBuildings([...wallIDsToRemove]);
            return 0;
        }

        // Second pass: rebuild many free slots in a burst.
        const burst = Math.max(1, Number(this.defenseRemountBurstSize) || 1);
        let placed = 0;
        for (const entry of this.defenseProfile.entries) {
            if (placed >= burst) break;
            if (isOriginalBuildingPresent(entry)) continue;
            if (hasOtherBuildingInSlot(entry)) continue;

            const type = entry.type;
            const rotationStep = Number.isFinite(Number(entry.rotationStep)) ? Number(entry.rotationStep) : 0;
            const cost = this.getPlacementCost(type);
            if (this.core.gameManager.resources.power.current < cost) {
                continue;
            }

            const ok = this.core.gameManager.increaseBuildingLimit(type);
            if (!ok) continue;

            const BuildingClass = BuildingManager.getBuildingClassByType(type);
            if (!BuildingClass) continue;

            const position = { x: entry.position.x, y: entry.position.y };
            this.core.networkManager.placeBuilding(type, position, true, rotationStep);
            const predicted = new BuildingClass(player.color, position);
            if (typeof predicted.setPlacementRotationStep === "function") {
                predicted.setPlacementRotationStep(rotationStep);
            }
            this.prepareAutoPlacementBuilding(predicted, player, position);
            player.setBuildingCache(predicted);
            currentBuildings.push(predicted);
            this.core.gameManager.subtractResources(cost);
            placed++;
        }

        return placed;
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
                rotationStep: Number.isFinite(Number(building.placementRotationStep)) ? Number(building.placementRotationStep) : 0,
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

        while (index < queue.length && this.baseLoadRunning) {
            const livePlayer = this.core.gameManager.player;
            if (!livePlayer) break;

            const item = queue[index++];
            const type = item.type;
            const rotationStep = Number.isFinite(Number(item.rotationStep)) ? Number(item.rotationStep) : 0;
            const details = getBuildingDetails(type);
            const size = details?.size || 32;
            const position = {
                x: livePlayer.position.x + item.dx,
                y: livePlayer.position.y + item.dy
            };
            const cost = this.getPlacementCost(type);

            if (this.core.gameManager.resources.power.current < cost) {
                skipped++;
                continue;
            }

            const allUnits = collectAllUnits();
            if (!this.canAutoPlaceBuilding(
                livePlayer,
                position,
                allUnits,
                pendingBuildings,
                type,
                size,
                { rotationStep, ignoreRadius: true }
            )) {
                skipped++;
                continue;
            }

            const ok = this.core.gameManager.increaseBuildingLimit(type);
            if (!ok) {
                skipped++;
                continue;
            }

            const BuildingClass = BuildingManager.getBuildingClassByType(type);
            if (!BuildingClass) {
                skipped++;
                continue;
            }

            this.core.networkManager.placeBuilding(type, position, true, rotationStep);
            const predicted = new BuildingClass(livePlayer.color, position);
            if (typeof predicted.setPlacementRotationStep === "function") {
                predicted.setPlacementRotationStep(rotationStep);
            }
            this.prepareAutoPlacementBuilding(predicted, livePlayer, position);
            livePlayer.setBuildingCache(predicted);
            this.core.gameManager.subtractResources(cost);
            pendingBuildings.push(predicted);
            placed++;
        }

        this.stopBaseLayoutLoad();
        this.core.uiManager.addChatMessage(
            "System",
            `Base loaded: ${placed} placed, ${skipped} skipped.`,
            placed > 0 ? "#60c1ff" : "#ffcc66"
        );
    }

    mapLegacySocketBuildingType (legacyType) {
        switch (legacyType) {
        case 1: return BuildingTypes.WALL;
        case 4: return BuildingTypes.HOUSE;
        case 7: return BuildingTypes.ARMORY;
        case 8: return BuildingTypes.BARRACKS;
        default: return null;
        }
    }

    buildExternalAtkPresetQueue (player) {
        if (!player) return [];
        const queue = [];

        for (const entry of LEGACY_EXTERNA_SOCKET_LAYOUT) {
            if (!Array.isArray(entry) || entry.length < 3) continue;
            const angle = Number(entry[0]);
            const radius = Number(entry[1]);
            const legacyType = Number(entry[2]);
            if (!Number.isFinite(angle) || !Number.isFinite(radius) || !Number.isFinite(legacyType)) continue;

            const type = this.mapLegacySocketBuildingType(legacyType);
            if (!Number.isFinite(type)) continue;

            const ctor = BuildingManager.getBuildingClassByType(type);
            if (!ctor) continue;

            const details = getBuildingDetails(type);
            const size = details?.size || 32;
            const adjustedAngle = angle + LEGACY_EXTERNA_ANGLE_OFFSET;
            let adjustedRadius = radius * LEGACY_EXTERNA_RADIUS_SCALE;
            if (
                type === BuildingTypes.SIMPLE_TURRET ||
                type === BuildingTypes.SNIPER_TURRET ||
                type === BuildingTypes.ARMORY ||
                type === BuildingTypes.GENERATOR ||
                type === BuildingTypes.HOUSE
            ) {
                const { minRadius } = this.getPlacementRadiusRangeForType(player, type, size);
                if (Number.isFinite(minRadius) && adjustedRadius < minRadius) {
                    adjustedRadius = minRadius;
                }
            }
            const position = {
                x: player.position.x + Math.cos(adjustedAngle) * adjustedRadius,
                y: player.position.y + Math.sin(adjustedAngle) * adjustedRadius
            };

            queue.push({
                type,
                size,
                checkSize: size,
                cost: this.getPlacementCost(type),
                ctor,
                position,
                rotationStep: 0
            });
        }

        // Preserve legacy order exactly for Full ATK fidelity.
        return queue;
    }

    buildAutogensPresetCandidates (base) {
        if (!base) return [];
        const candidates = [];
        const seen = new Set();

        for (const entry of LEGACY_AUTOGENS_SOCKET_LAYOUT) {
            if (!Array.isArray(entry) || entry.length < 3) continue;
            const angle = Number(entry[0]);
            const radius = Number(entry[1]);
            const legacyType = Number(entry[2]);
            if (!Number.isFinite(angle) || !Number.isFinite(radius) || !Number.isFinite(legacyType)) continue;
            if (legacyType !== 3) continue; // 3 => Generator in legacy socket format.

            const adjustedAngle = angle + LEGACY_AUTOGENS_ANGLE_OFFSET;
            const adjustedRadius = Math.max(0, radius * LEGACY_AUTOGENS_RADIUS_SCALE);
            const x = base.position.x + Math.cos(adjustedAngle) * adjustedRadius;
            const y = base.position.y + Math.sin(adjustedAngle) * adjustedRadius;
            const key = `${Math.round(x * 10)}:${Math.round(y * 10)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            candidates.push({ x, y });
        }

        return candidates;
    }

    getExternalAtkFallbackPositions (basePosition, originalPosition) {
        if (!basePosition || !originalPosition) return [originalPosition];
        const dx = originalPosition.x - basePosition.x;
        const dy = originalPosition.y - basePosition.y;
        const baseAngle = Math.atan2(dy, dx);
        const baseRadius = Math.sqrt(dx * dx + dy * dy);
        const angleOffsets = [0, -0.018, 0.018, -0.035, 0.035];
        const radiusOffsets = [0, -2, 2, -4, 4];
        const out = [];
        const seen = new Set();
        for (const angleOffset of angleOffsets) {
            for (const radiusOffset of radiusOffsets) {
                const r = Math.max(0, baseRadius + radiusOffset);
                const a = baseAngle + angleOffset;
                const p = {
                    x: basePosition.x + Math.cos(a) * r,
                    y: basePosition.y + Math.sin(a) * r
                };
                const key = `${Math.round(p.x * 10)}:${Math.round(p.y * 10)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(p);
            }
        }
        return out;
    }

    getExternalAtkSummaryText (placedByType) {
        const wallCount = placedByType.get(BuildingTypes.WALL) || 0;
        const houseCount = placedByType.get(BuildingTypes.HOUSE) || 0;
        const armoryCount = placedByType.get(BuildingTypes.ARMORY) || 0;
        const barracksCount = placedByType.get(BuildingTypes.BARRACKS) || 0;
        const total = wallCount + houseCount + armoryCount + barracksCount;
        return `${total} placed (House ${houseCount}, Wall ${wallCount}, Armory ${armoryCount}, Barracks ${barracksCount})`;
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
        const placedByType = new Map();
        const queue = this.buildExternalAtkPresetQueue(player);

        if (queue.length === 0) {
            this.core.uiManager.addChatMessage("System", "ExternaTK: no valid candidate positions.", "#ffcc66");
            return 0;
        }

        let queueIndex = 0;
        let skippedSlots = 0;

        const finish = (message, color = "#60c1ff") => {
            this.stopAutoPlaceGenerators();
            this.core.uiManager.addChatMessage("System", message, color);
        };

        this.autogensRunning = true;
        this.autoBuildMode = "externatk";
        this.core.uiManager.addChatMessage("System", "ExternaTK started...", "#60c1ff");

        while (queueIndex < queue.length && this.autogensRunning) {
            const livePlayer = this.core.gameManager.player;
            if (!livePlayer) {
                finish("ExternaTK stopped.", "#ffcc66");
                return 0;
            }

            const item = queue[queueIndex++];

            if (this.core.gameManager.resources.power.current < item.cost) {
                skippedSlots++;
                continue;
            }

            const liveUnits = collectAllUnits();
            let rotationStep = Number.isFinite(Number(item.rotationStep)) ? Number(item.rotationStep) : 0;
            const candidatePositions = this.getExternalAtkFallbackPositions(livePlayer.position, item.position);
            let selectedPosition = null;
            let selectedRotationStep = rotationStep;
            for (const candidatePosition of candidatePositions) {
                let candidateStep = rotationStep;
                if (this.canRotatePlacementType(item.type)) {
                    const bestStep = this.findBestAutoPlacementRotationStep(
                        livePlayer,
                        candidatePosition,
                        liveUnits,
                        pendingBuildings,
                        item.type,
                        item.checkSize || item.size,
                        { preferredRotationStep: rotationStep, ignoreUnits: true }
                    );
                    if (bestStep === null) continue;
                    candidateStep = bestStep;
                } else if (!this.canAutoPlaceBuilding(
                    livePlayer,
                    candidatePosition,
                    liveUnits,
                    pendingBuildings,
                    item.type,
                    item.checkSize || item.size,
                    { rotationStep: candidateStep, ignoreUnits: true }
                )) {
                    continue;
                }
                selectedPosition = candidatePosition;
                selectedRotationStep = candidateStep;
                break;
            }

            if (!selectedPosition) {
                skippedSlots++;
                continue;
            }

            const ok = this.core.gameManager.increaseBuildingLimit(item.type);
            if (!ok) {
                skippedSlots++;
                continue;
            }

            this.core.networkManager.placeBuilding(item.type, selectedPosition, true, selectedRotationStep);
            const predicted = this.prepareAutoPlacementBuilding(
                new item.ctor(livePlayer.color, selectedPosition),
                livePlayer,
                selectedPosition,
                selectedRotationStep
            );
            livePlayer.setBuildingCache(predicted);
            this.core.gameManager.subtractResources(item.cost);
            pendingBuildings.push(predicted);
            placedByType.set(item.type, (placedByType.get(item.type) || 0) + 1);
        }

        if (placedByType.size === 0) {
            finish("ExternaTK: no space, limit or power to place buildings.", "#ffcc66");
            return 0;
        }

        const skippedSuffix = skippedSlots > 0
            ? ` (${skippedSlots} skipped)`
            : "";
        finish(`ExternaTK: ${this.getExternalAtkSummaryText(placedByType)}${skippedSuffix}.`);

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

        let candidates = this.buildAutogensPresetCandidates(base);
        if (!Array.isArray(candidates) || candidates.length === 0) {
            candidates = this.getAutoGeneratorCandidates(base, generatorSize);
        }
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

        const livePlayer = this.core.gameManager.player;
        if (!livePlayer) {
            finishAutogens("Autogens stopped.", "#ffcc66");
            return 0;
        }

        while (candidateIndex < candidates.length && placed < maxToPlace) {
            if (this.core.gameManager.resources.power.current < cost) {
                break;
            }

            const position = candidates[candidateIndex++];
            if (!this.canAutoPlaceGenerator(base, position, allUnits, pendingGenerators, generatorSize)) {
                continue;
            }

            const ok = this.core.gameManager.increaseBuildingLimit(BuildingTypes.GENERATOR);
            if (!ok) {
                break;
            }

            this.core.networkManager.placeBuilding(BuildingTypes.GENERATOR, position, true);
            const predicted = new Generator(livePlayer.color, position);
            livePlayer.setBuildingCache(predicted);
            this.core.gameManager.subtractResources(cost);
            pendingGenerators.push(predicted);
            placed++;
        }

        if (placed === 0) {
            if (this.core.gameManager.resources.power.current < cost) {
                finishAutogens("Not enough power to place generators.", "#ffcc66");
            } else {
                finishAutogens("Couldn't find valid space to auto-place generators.", "#ffcc66");
            }
            return 0;
        }

        const stoppedByPower = this.core.gameManager.resources.power.current < cost;
        const suffix = stoppedByPower ? " (not enough power)." : ".";
        finishAutogens(`Autogens placed ${placed} generator${placed > 1 ? "s" : ""}${suffix}`);

        return 0;
    }

    getPlacementRadiusRangeForType (base, buildingType, buildingSize) {
        let minRadius = base.buildingRadius.min;
        let maxRadius = base.buildingRadius.max;

        switch (buildingType) {
            case BuildingTypes.BARRACKS:
                minRadius = base.buildingRadius.max + BARRACKS_OUTER_RING_OFFSET;
                maxRadius = minRadius;
                break;
            case BuildingTypes.WALL:
                minRadius += buildingSize;
                maxRadius = base.buildingRadius.max + WALL_OUTER_RING_OFFSET;
                break;
            case BuildingTypes.SIMPLE_TURRET:
            case BuildingTypes.SNIPER_TURRET:
            case BuildingTypes.ARMORY:
            case BuildingTypes.PORTAL:
            case BuildingTypes.GENERATOR:
            case BuildingTypes.HOUSE:
                minRadius += Math.max(0, buildingSize - INNER_RING_MIN_RADIUS_TOLERANCE);
                maxRadius = getInnerHelperRingRadius(base) - buildingSize - INNER_RING_VISUAL_MARGIN;
                break;
            default:
                minRadius += buildingSize;
        }

        if (maxRadius < minRadius) {
            maxRadius = minRadius;
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
        const radiusTolerance = 0; // Keep candidate search strictly aligned with server-side clamp.
        const minRadius = Math.max(0, range.minRadius);
        const maxRadius = range.maxRadius + radiusTolerance;
        if (maxRadius < minRadius) return [];

        // Beauty-first concentric sockets (close to the yellow reference pattern):
        // tight rings + staggered phases + symmetric top opening for armory.
        // Force one dedicated inner ring at minRadius so houses stay visually glued to the core.
        const radius = houseSize;
        const diameter = radius * 2;
        const tangentialGap = Math.max(1.5, radius * 0.14);
        const spacing = diameter + tangentialGap;
        const radialStep = Math.max(radius * 1.55, spacing * 0.86);
        const TWO_PI = Math.PI * 2;
        const centerX = base.position.x;
        const centerY = base.position.y;
        const topAngle = -Math.PI / 2;

        const innerRingRadius = minRadius;
        const outerSafetyGap = Math.max(1, houseSize * 0.08); // Keep only a tiny safety margin.
        const usableMaxRadius = Math.max(innerRingRadius, maxRadius - outerSafetyGap);
        const ringStep = Math.max(1, radialStep);

        const buildTemplateCandidates = (globalRotation, radialOffset = 0) => {
            const list = [];
            const seen = new Set();
            let ringIndex = 0;
            for (
                let ringRadius = innerRingRadius + radialOffset;
                ringRadius <= usableMaxRadius + 0.01;
                ringRadius += ringStep
            ) {
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
                ringIndex++;
            }

            return list;
        };

        const templates = [];
        const rotationSteps = 120;
        const radialOffsets = [0, ringStep * 0.5];
        for (let step = 0; step < rotationSteps; step++) {
            const rotation = (step * TWO_PI) / rotationSteps;
            for (const radialOffset of radialOffsets) {
                const candidates = buildTemplateCandidates(rotation, radialOffset);
                let outerBandCount = 0;
                const outerBandStart = maxRadius - radialStep * 0.8;
                for (const p of candidates) {
                    const dx = p.x - centerX;
                    const dy = p.y - centerY;
                    const r = Math.sqrt(dx * dx + dy * dy);
                    if (r >= outerBandStart) outerBandCount++;
                }
                const score = candidates.length * 10000 + outerBandCount * 20;
                templates.push({ score, candidates });
            }
        }

        templates.sort((a, b) => b.score - a.score);
        const bestCandidates = templates.length > 0 ? [...templates[0].candidates] : [];

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

        const unwrapPosition = (entry) => entry?.position || entry;
        const radiusOf = (entry) => {
            const p = unwrapPosition(entry);
            const dx = p.x - centerX;
            const dy = p.y - centerY;
            return Math.sqrt(dx * dx + dy * dy);
        };
        const angleOf = (entry) => {
            const p = unwrapPosition(entry);
            return Math.atan2(p.y - centerY, p.x - centerX);
        };
        const keyOf = (entry) => {
            const p = unwrapPosition(entry);
            return `${Math.round(p.x)}:${Math.round(p.y)}`;
        };
        const topAngle = -Math.PI / 2;
        const innerPriorityTolerance = Math.max(2, houseSize * 0.12);
        const isInnerRingPoint = (entry) => Math.abs(radiusOf(entry) - minRadius) <= innerPriorityTolerance;
        const signedAngleFromTop = (entry) => {
            let d = angleOf(entry) - topAngle;
            while (d <= -Math.PI) d += Math.PI * 2;
            while (d > Math.PI) d -= Math.PI * 2;
            return d;
        };

        const tryPlaceAccepted = (ordered, accepted, pending, acceptedKeys) => {
            for (const candidate of ordered) {
                const position = unwrapPosition(candidate);
                const key = keyOf(position);
                if (acceptedKeys.has(key)) continue;
                const rotationStep = this.findBestAutoPlacementRotationStep(
                    base,
                    position,
                    allUnits,
                    pending,
                    BuildingTypes.HOUSE,
                    houseSize
                );
                if (rotationStep === null) {
                    continue;
                }

                accepted.push({ position, rotationStep });
                acceptedKeys.add(key);
                const pendingHouse = this.prepareAutoPlacementBuilding(
                    new House(this.core.gameManager.player.color, position),
                    base,
                    position,
                    rotationStep
                );
                pending.push(pendingHouse);
            }
        };

        const sorters = [
            // Primary: strict concentric order from inner ring, symmetric around top.
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
            // Alternate sweep direction to avoid one-sided locking.
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
                return ab - aa;
            }
        ];

        const aestheticPenalty = (accepted) => {
            if (accepted.length <= 2) return 0;

            // Lower penalty means more uniform angular distribution per ring.
            let penalty = 0;
            const rings = new Map();
            for (const entry of accepted) {
                const r = radiusOf(entry);
                const ringIndex = Math.max(0, Math.floor((r - minRadius) / ringStep));
                if (!rings.has(ringIndex)) rings.set(ringIndex, []);
                rings.get(ringIndex).push(angleOf(entry));
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

            const innerCount = accepted.reduce((acc, entry) => acc + (isInnerRingPoint(entry) ? 1 : 0), 0);
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
        const rotationStep = Number.isFinite(Number(options.rotationStep)) ? Number(options.rotationStep) : 0;
        const { minRadius, maxRadius } = this.getPlacementRadiusRangeForType(base, buildingType, buildingSize);
        const dx = position.x - base.position.x;
        const dy = position.y - base.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        let radiusTolerance = 4;
        if (buildingType === BuildingTypes.BARRACKS) {
            radiusTolerance = 12;
        } else if (
            buildingType === BuildingTypes.SIMPLE_TURRET ||
            buildingType === BuildingTypes.SNIPER_TURRET ||
            buildingType === BuildingTypes.ARMORY ||
            buildingType === BuildingTypes.GENERATOR ||
            buildingType === BuildingTypes.HOUSE
        ) {
            // Keep client-side radius check in sync with server side for inner-ring sockets.
            radiusTolerance = 1;
        }
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
        this.prepareAutoPlacementBuilding(previewBuilding, base, position, rotationStep);
        const preview = new BuildingPreview(previewBuilding);
        preview.checkCollision(collisionBuildings, safeUnits);
        return preview.buildable;
    }

    prepareAutoPlacementBuilding (building, base, position, rotationStep = null) {
        if (!building) return building;
        if (Number.isFinite(Number(rotationStep)) && typeof building.setPlacementRotationStep === "function") {
            building.setPlacementRotationStep(rotationStep);
        }
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
        if (typeof building.applyPlacementTargetFromBase === "function") {
            building.applyPlacementTargetFromBase(base.position, 1.5);
            return;
        }
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

    findNearestValidPlacementPosition (base, position, allUnits, buildingType, buildingSize, rotationStep = 0, maxSnap = 3) {
        if (!base || !position) return null;
        const isValid = (candidate) => this.canAutoPlaceBuilding(
            base,
            candidate,
            allUnits,
            [],
            buildingType,
            buildingSize,
            { rotationStep }
        );

        if (isValid(position)) {
            return position;
        }

        for (let r = 1; r <= maxSnap; r++) {
            const offsets = [
                { x: r, y: 0 }, { x: -r, y: 0 }, { x: 0, y: r }, { x: 0, y: -r },
                { x: r, y: r }, { x: r, y: -r }, { x: -r, y: r }, { x: -r, y: -r }
            ];
            for (const offset of offsets) {
                const candidate = {
                    x: position.x + offset.x,
                    y: position.y + offset.y
                };
                if (isValid(candidate)) {
                    return candidate;
                }
            }
        }

        return null;
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
