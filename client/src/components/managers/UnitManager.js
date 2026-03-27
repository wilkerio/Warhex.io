import Soldier from "../../entities/units/Soldier.js";
import Tank from "../../entities/units/Tank.js";
import SiegeTank from "../../entities/units/SiegeTank.js";
import Commander from "../../entities/units/Commander.js";
import TriCommander from "../../entities/units/TriCommander.js";
import { BuildingTypes, BuildingVariantTypes, UnitTypes, UnitVariantTypes } from "../../network/constants.js";
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

        this.lastTargetPosition = { x: Infinity, y: Infinity };
        this.lastMoveCommandAt = 0;
        this.minMoveCommandIntervalMs = 80;
        this.minMoveDistanceSq = 64; // 8px

        this.commanderAssistEnabled = false;
        this.commanderAssistTickIntervalMs = 90;
        this.commanderAssistPredictMs = 320;
        this.commanderAssistClusterRadius = 175;
        this.commanderAssistOvershootDistance = 85;
        this.commanderAssistPreDefenseScanPadding = 260;
        this.commanderAssistFarInterceptDistance = 260;
        this.commanderAssistMinCutLeadDistance = 65;
        this.commanderAssistMaxCutLeadDistance = 220;
        this.commanderAssistDefenseEdgePadding = 18;
        this.commanderAssistMinThreatSpeed = 0.025;
        this.commanderAssistVelocitySmoothing = 0.45;
        this.commanderAssistMinMoveIntervalMs = 120;
        this.commanderAssistMinTargetDistanceSq = 45 * 45;
        this.commanderAssistBuyCooldownMs = 900;
        this.commanderAssistThreatMemoryMs = 2400;
        this.commanderAssistLastTickAt = 0;
        this.commanderAssistLastMoveAt = 0;
        this.commanderAssistLastBuyAt = 0;
        this.commanderAssistLastThreatNearDefenseAt = 0;
        this.commanderAssistLastTarget = { x: Infinity, y: Infinity };
        this.commanderAssistEnemyTrack = new Map();
        this.commanderAssistActivationTapTarget = 1;
        this.commanderAssistActivationTapCount = 0;
        this.commanderAssistActivationTapWindowMs = 1300;
        this.commanderAssistActivationTapLastAt = 0;
        this.commanderAssistLastPowerPeekAt = 0;
        this.commanderAssistPowerPeekCooldownMs = 450;
        this.commanderAssistPowerPollIntervalMs = 1200;
        this.commanderAssistLastPowerPollAt = 0;
        this.pendingX1PowerChatRequest = false;
        this.commanderAssistMouseFollowEnabled = false;
        this.commanderAssistSoldierMoveIntervalMs = 90;
        this.commanderAssistSoldierMinTargetDistanceSq = 28 * 28;
        this.commanderAssistSoldierLastMoveAt = 0;
        this.commanderAssistSoldierLastTarget = { x: Infinity, y: Infinity };
        this.commanderAssistLineBandPx = 64;
        this.commanderAssistBarracksSplitRequired = 4;
        this.commanderAssistCommanderBarracksQuota = 2;
        this.commanderAssistSplitModeActive = false;
        this.commanderAssistCatchupMinDistance = 230;
        this.commanderAssistCatchupMaxPredictSeconds = 3.2;
        this.commanderAssistCatchupStepSeconds = 0.2;
        this.commanderAssistAutoSelectIntervalMs = 900;
        this.commanderAssistLastAutoSelectAt = 0;
        this.commanderDefenseRadiusMin = 80;
        this.commanderDefenseRadiusMax = 1200;
        const cachedDefenseRadius = Number(localStorage.getItem("warhex_commander_defense_radius"));
        this.commanderDefenseRadius = Number.isFinite(cachedDefenseRadius)
            ? Math.max(this.commanderDefenseRadiusMin, Math.min(this.commanderDefenseRadiusMax, cachedDefenseRadius))
            : 260;
        this.commanderDefenseRadiusPlacementActive = false;
        this.commanderDefenseOverlayRenderable = {
            render: (context, camera) => this.renderCommanderDefenseOverlay(context, camera)
        };

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
        this.commanderAssistActivationTapCount = 0;
        this.commanderAssistActivationTapLastAt = 0;
        this.commanderAssistLastThreatNearDefenseAt = 0;

        if (!this.commanderAssistEnabled) {
            this.commanderAssistEnemyTrack.clear();
            this.cancelCommanderDefenseRadiusPlacement();
            this.commanderAssistMouseFollowEnabled = false;
            this.commanderAssistSoldierLastMoveAt = 0;
            this.commanderAssistSoldierLastTarget = { x: Infinity, y: Infinity };
            this.core?.buildingManager?.setCommanderAssistAutoDefenseEnabled?.(false);
        } else {
            this.commanderAssistMouseFollowEnabled = true;
            this.commanderAssistLastAutoSelectAt = 0;
            this.requestCommanderDefenseRadiusPlacement();
            this.core?.buildingManager?.setCommanderAssistAutoDefenseEnabled?.(true, {
                silent: true,
                forceRefresh: true
            });
        }

        this.commanderAssistSplitModeActive = false;

        this.core?.networkManager?.sendToggleCommanderAssist?.(this.commanderAssistEnabled);

        this.core?.uiManager?.notifySystemInfo?.(
            this.commanderAssistEnabled
                ? `Commander Assist ON (*): auto-select/buy + defend automatico do painel (radius ${Math.round(this.commanderDefenseRadius)}). Use [,] para voltar commander/base.`
                : "Commander Assist OFF (*)."
        );
    }

    handleCommanderAssistHotkeyPress () {
        const now = Date.now();

        if (this.commanderAssistEnabled) {
            this.toggleCommanderAssistMode();
            return {
                toggled: true,
                enabled: false,
                deactivated: true
            };
        }

        if ((now - this.commanderAssistActivationTapLastAt) > this.commanderAssistActivationTapWindowMs) {
            this.commanderAssistActivationTapCount = 0;
        }

        this.commanderAssistActivationTapLastAt = now;
        this.commanderAssistActivationTapCount = Math.min(
            this.commanderAssistActivationTapTarget,
            this.commanderAssistActivationTapCount + 1
        );

        const remainingTaps = this.commanderAssistActivationTapTarget - this.commanderAssistActivationTapCount;
        if (remainingTaps <= 0) {
            this.toggleCommanderAssistMode();
            if (this.commanderAssistEnabled) {
                this.core?.buildingManager?.promptCommanderAssistRemountKey?.();
            }
            return {
                toggled: true,
                enabled: true,
                activated: true
            };
        }

        this.core?.uiManager?.notifySystemInfo?.(
            `Commander Assist: aperte * mais ${remainingTaps}x para ativar.`
        );

        return {
            toggled: false,
            enabled: false,
            pending: true,
            remainingTaps
        };
    }

    getClientCommanderUnit () {
        const units = this.core?.gameManager?.player?.units;
        if (!Array.isArray(units)) return null;

        return units.find(unit =>
            unit && (unit.type === UnitTypes.COMMANDER || unit.type === UnitTypes.TRI_COMMANDER)
        ) || null;
    }

    ensureCommanderDefenseOverlay () {
        if (!this.core?.renderer) return;
        const overlays = this.core.renderer.queues?.overlay;
        if (Array.isArray(overlays) && overlays.includes(this.commanderDefenseOverlayRenderable)) return;
        this.core.renderer.addToQueue(this.commanderDefenseOverlayRenderable, QueueType.OVERLAY);
    }

    isAwaitingCommanderDefenseRadiusPlacement () {
        return Boolean(this.commanderDefenseRadiusPlacementActive);
    }

    getCommanderDefenseCenter () {
        const player = this.core?.gameManager?.player;
        if (!player?.position) return null;
        const x = Number(player.position.x);
        const y = Number(player.position.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y };
    }

    getCommanderDefenseRadiusToRender () {
        if (!this.commanderDefenseRadiusPlacementActive) {
            return this.commanderDefenseRadius;
        }
        const center = this.getCommanderDefenseCenter();
        const mouse = this.core?.eventManager?.mousePosition;
        if (!center || !mouse) return this.commanderDefenseRadius;
        const dx = Number(mouse.x) - center.x;
        const dy = Number(mouse.y) - center.y;
        const distance = Math.hypot(dx, dy);
        if (!Number.isFinite(distance)) return this.commanderDefenseRadius;
        return Math.max(this.commanderDefenseRadiusMin, Math.min(this.commanderDefenseRadiusMax, distance));
    }

    requestCommanderDefenseRadiusPlacement () {
        if (!this.core?.gameManager?.player) return;
        this.commanderDefenseRadiusPlacementActive = true;
        this.ensureCommanderDefenseOverlay();
        this.core?.uiManager?.notifySystemInfo?.("Commander defense radius: clique esquerdo no mapa para definir.");
    }

    cancelCommanderDefenseRadiusPlacement () {
        if (!this.commanderDefenseRadiusPlacementActive) return;
        this.commanderDefenseRadiusPlacementActive = false;
        this.core?.uiManager?.notifySystemInfo?.("Commander defense radius: ajuste cancelado.");
    }

    showX1PowerInfo () {
        return this.requestX1PowerInfo({ showChat: true });
    }

    requestX1PowerInfo (options = {}) {
        const { showChat = true, bypassCooldown = false } = options;
        const gameManager = this.core?.gameManager;
        if (!gameManager?.player) return false;
        const now = Date.now();
        if (!bypassCooldown && (now - this.commanderAssistLastPowerPeekAt) < this.commanderAssistPowerPeekCooldownMs) return false;
        if (!bypassCooldown) {
            this.commanderAssistLastPowerPeekAt = now;
        }

        const opponentId = this.normalizePlayerId(gameManager.duelOpponentID);
        if (opponentId === null) {
            if (showChat) {
                const localPower = Number(gameManager.resources?.power?.current || 0);
                const localPowerMax = Number(gameManager.resources?.power?.max || 0);
                const localPowerRate = Number(gameManager.resources?.power?.generationRate || 0);
                this.core?.uiManager?.addChatMessage?.(
                    "System",
                    `Power: ${localPower}/${localPowerMax} (+${localPowerRate}/s). Nenhum X1 ativo.`,
                    "#9fd7ff"
                );
            }
            return false;
        }

        this.pendingX1PowerChatRequest = Boolean(showChat);
        this.core?.networkManager?.sendRequestX1PowerInfo?.();
        return true;
    }

    consumePendingX1PowerChatRequest () {
        if (!this.pendingX1PowerChatRequest) return false;
        this.pendingX1PowerChatRequest = false;
        return true;
    }

    pollX1PowerInfoForOverlay (nowMs = Date.now()) {
        const opponentId = this.normalizePlayerId(this.core?.gameManager?.duelOpponentID);
        if (opponentId === null) return;
        if ((nowMs - this.commanderAssistLastPowerPollAt) < this.commanderAssistPowerPollIntervalMs) return;
        this.commanderAssistLastPowerPollAt = nowMs;
        this.requestX1PowerInfo({ showChat: false, bypassCooldown: true });
    }

    getAliveClientSoldiers () {
        const player = this.core?.gameManager?.player;
        const units = Array.isArray(player?.units) ? player.units : [];
        return units.filter((unit) => unit && unit.type === UnitTypes.SOLDIER && !unit.isFadingOut);
    }

    isCommanderOnDefenseLine (commanderPosition = null, defenseCenter = null, defenseRadius = this.commanderDefenseRadius) {
        if (!commanderPosition || !defenseCenter) return false;
        const cx = Number(commanderPosition.x);
        const cy = Number(commanderPosition.y);
        const bx = Number(defenseCenter.x);
        const by = Number(defenseCenter.y);
        if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(bx) || !Number.isFinite(by)) return false;
        const radius = Math.max(10, Number(defenseRadius) || this.commanderDefenseRadius);
        const distance = Math.hypot(cx - bx, cy - by);
        return Number.isFinite(distance) && Math.abs(distance - radius) <= this.commanderAssistLineBandPx;
    }

    findNearestBarracksForPoint (point, barracks = []) {
        if (!point || !Array.isArray(barracks) || !barracks.length) return null;
        const px = Number(point.x);
        const py = Number(point.y);
        if (!Number.isFinite(px) || !Number.isFinite(py)) return null;

        let nearest = null;
        let bestDistanceSq = Infinity;
        for (const b of barracks) {
            const bx = Number(b?.position?.x);
            const by = Number(b?.position?.y);
            if (!Number.isFinite(bx) || !Number.isFinite(by)) continue;
            const dx = bx - px;
            const dy = by - py;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq < bestDistanceSq) {
                bestDistanceSq = distanceSq;
                nearest = b;
            }
        }
        return nearest;
    }

    getCommanderAssistSoldierSplit (commander, defenseCenter = null, defenseRadius = this.commanderDefenseRadius, enemyFocusPoint = null) {
        const soldiers = this.getAliveClientSoldiers();
        const barracks = this.getClientBarracksForAssist();
        if (!commander?.position || barracks.length < this.commanderAssistBarracksSplitRequired) {
            return {
                active: false,
                commanderSoldiers: [],
                manualSoldiers: soldiers
            };
        }

        if (!this.isCommanderOnDefenseLine(commander.position, defenseCenter, defenseRadius)) {
            return {
                active: false,
                commanderSoldiers: [],
                manualSoldiers: soldiers
            };
        }

        const focusPoint = (() => {
            const ex = Number(enemyFocusPoint?.x);
            const ey = Number(enemyFocusPoint?.y);
            if (Number.isFinite(ex) && Number.isFinite(ey)) {
                return { x: ex, y: ey };
            }
            return {
                x: Number(commander.position.x),
                y: Number(commander.position.y)
            };
        })();

        const sortedBarracks = [...barracks].sort((a, b) => {
            const ax = Number(a?.position?.x);
            const ay = Number(a?.position?.y);
            const bx = Number(b?.position?.x);
            const by = Number(b?.position?.y);
            const cx = Number(focusPoint.x);
            const cy = Number(focusPoint.y);
            const adx = ax - cx;
            const ady = ay - cy;
            const bdx = bx - cx;
            const bdy = by - cy;
            return (adx * adx + ady * ady) - (bdx * bdx + bdy * bdy);
        });
        const commanderBarracks = sortedBarracks.slice(0, this.commanderAssistCommanderBarracksQuota);
        const commanderBarracksIdSet = new Set(
            commanderBarracks.map((b) => b?.id).filter((id) => id !== undefined && id !== null)
        );

        const commanderSoldiers = [];
        const manualSoldiers = [];
        soldiers.forEach((soldier) => {
            const sourceBarracks = this.findNearestBarracksForPoint(soldier?.barrackPosition, barracks);
            const sourceBarracksId = sourceBarracks?.id;
            if (sourceBarracksId !== undefined && sourceBarracksId !== null && commanderBarracksIdSet.has(sourceBarracksId)) {
                commanderSoldiers.push(soldier);
            } else {
                manualSoldiers.push(soldier);
            }
        });

        return {
            active: true,
            commanderSoldiers,
            manualSoldiers
        };
    }

    ensureSoldiersSelectedForCommanderAssist (force = false) {
        const nowMs = Date.now();
        if (!force && (nowMs - this.commanderAssistLastAutoSelectAt) < this.commanderAssistAutoSelectIntervalMs) {
            return;
        }

        const aliveSoldiers = this.getAliveClientSoldiers();
        if (!aliveSoldiers.length) return;

        this.commanderAssistLastAutoSelectAt = nowMs;
        const soldierSet = new Set(aliveSoldiers);
        const selectedSoldiers = this.selectedUnits.filter((unit) => unit && unit.type === UnitTypes.SOLDIER && soldierSet.has(unit));
        const hasOnlySoldiersSelected = this.selectedUnits.length > 0 && this.selectedUnits.every((unit) => unit?.type === UnitTypes.SOLDIER && soldierSet.has(unit));
        const allSoldiersSelected = selectedSoldiers.length === aliveSoldiers.length;

        if (hasOnlySoldiersSelected && allSoldiersSelected) return;

        this.clearSelection();
        aliveSoldiers.forEach((soldier) => {
            if (!this.selectedUnits.includes(soldier)) {
                this.selectedUnits.push(soldier);
            }
            soldier.isSelected = true;
        });
        this.refreshSelectionHud();
    }

    updateCommanderAssistSoldiersFollowMouse (nowMs = Date.now()) {
        if (!this.commanderAssistEnabled || !this.commanderAssistMouseFollowEnabled) return;
        if (this.commanderDefenseRadiusPlacementActive) return;
        if (this.core?.uiManager?.isGameplayInputBlocked?.()) return;
        if (this.core?.uiManager?.menuOpen) return;
        if (this.core?.uiManager?.isDraggingChat) return;

        this.ensureSoldiersSelectedForCommanderAssist();

        const soldiersToMove = this.selectedUnits.filter((unit) => unit && unit.type === UnitTypes.SOLDIER && !unit.isFadingOut);
        if (!soldiersToMove.length) return;

        const mouse = this.core?.eventManager?.mousePosition;
        const tx = Number(mouse?.x);
        const ty = Number(mouse?.y);
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
        const targetPosition = { x: tx, y: ty };

        const dx = targetPosition.x - this.commanderAssistSoldierLastTarget.x;
        const dy = targetPosition.y - this.commanderAssistSoldierLastTarget.y;
        const movedEnough = (dx * dx + dy * dy) >= this.commanderAssistSoldierMinTargetDistanceSq;
        const intervalPassed = (nowMs - this.commanderAssistSoldierLastMoveAt) >= this.commanderAssistSoldierMoveIntervalMs;
        if (!movedEnough && !intervalPassed) return;

        this.updateUnitsCannonTarget(soldiersToMove, targetPosition);
        this.core?.networkManager?.moveUnits?.(soldiersToMove, targetPosition);
        this.commanderAssistSoldierLastMoveAt = nowMs;
        this.commanderAssistSoldierLastTarget = targetPosition;
    }

    updateCommanderAssistSoldiersFollowCommander (commander, soldiersToMove = [], nowMs = Date.now()) {
        if (!this.commanderAssistEnabled) return;
        if (!commander?.position) return;
        if (!Array.isArray(soldiersToMove) || !soldiersToMove.length) return;

        const targetPosition = {
            x: Number(commander.position.x),
            y: Number(commander.position.y)
        };
        if (!Number.isFinite(targetPosition.x) || !Number.isFinite(targetPosition.y)) return;

        const dx = targetPosition.x - this.commanderAssistSoldierLastTarget.x;
        const dy = targetPosition.y - this.commanderAssistSoldierLastTarget.y;
        const movedEnough = (dx * dx + dy * dy) >= this.commanderAssistSoldierMinTargetDistanceSq;
        const intervalPassed = (nowMs - this.commanderAssistSoldierLastMoveAt) >= this.commanderAssistSoldierMoveIntervalMs;
        if (!movedEnough && !intervalPassed) return;

        this.updateUnitsCannonTarget(soldiersToMove, targetPosition);
        this.core?.networkManager?.moveUnits?.(soldiersToMove, targetPosition);
        this.commanderAssistSoldierLastMoveAt = nowMs;
        this.commanderAssistSoldierLastTarget = targetPosition;
    }

    getCommanderCatchupTarget (commander, soldiers = [], defenseCenter = null, defenseRadius = this.commanderDefenseRadius) {
        if (!commander?.position || !Array.isArray(soldiers) || soldiers.length === 0) return null;

        const commanderX = Number(commander.position.x);
        const commanderY = Number(commander.position.y);
        if (!Number.isFinite(commanderX) || !Number.isFinite(commanderY)) return null;

        const commanderDefenseDistance = defenseCenter
            ? Math.hypot(commanderX - Number(defenseCenter.x), commanderY - Number(defenseCenter.y))
            : 0;
        const minDistance = Math.max(80, Number(this.commanderAssistCatchupMinDistance) || 230);

        let leadSoldier = null;
        let leadScore = -Infinity;
        for (const soldier of soldiers) {
            if (!soldier?.position) continue;
            const sx = Number(soldier.position.x);
            const sy = Number(soldier.position.y);
            if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;

            const distanceToCommander = Math.hypot(sx - commanderX, sy - commanderY);
            if (distanceToCommander < minDistance) continue;

            let aheadBonus = 0;
            if (defenseCenter) {
                const soldierDefenseDistance = Math.hypot(sx - Number(defenseCenter.x), sy - Number(defenseCenter.y));
                if (soldierDefenseDistance > commanderDefenseDistance) {
                    aheadBonus = (soldierDefenseDistance - commanderDefenseDistance) * 0.45;
                }
            }

            const score = distanceToCommander + aheadBonus;
            if (score > leadScore) {
                leadScore = score;
                leadSoldier = soldier;
            }
        }

        if (!leadSoldier?.position) return null;

        const sx = Number(leadSoldier.position.x);
        const sy = Number(leadSoldier.position.y);
        if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;

        const txRaw = Number(leadSoldier?.targetPosition?.x);
        const tyRaw = Number(leadSoldier?.targetPosition?.y);
        const hasTarget = Number.isFinite(txRaw) && Number.isFinite(tyRaw);
        const tx = hasTarget ? txRaw : sx;
        const ty = hasTarget ? tyRaw : sy;

        const moveDx = tx - sx;
        const moveDy = ty - sy;
        const moveDistance = Math.hypot(moveDx, moveDy);
        const hasMovementVector = moveDistance > 1;
        const dirX = hasMovementVector ? moveDx / moveDistance : 0;
        const dirY = hasMovementVector ? moveDy / moveDistance : 0;

        const commanderSpeed = Math.max(1, Number(commander?.details?.speed || 180));
        const soldierSpeed = Math.max(1, Number(leadSoldier?.details?.speed || 180));
        const maxPredictSeconds = Math.max(0.4, Number(this.commanderAssistCatchupMaxPredictSeconds) || 3.2);
        const stepSeconds = Math.max(0.05, Number(this.commanderAssistCatchupStepSeconds) || 0.2);

        let intercept = null;
        for (let t = stepSeconds; t <= maxPredictSeconds; t += stepSeconds) {
            let futureX = sx;
            let futureY = sy;
            if (hasMovementVector) {
                const projectedTravel = Math.min(moveDistance, soldierSpeed * t);
                futureX = sx + dirX * projectedTravel;
                futureY = sy + dirY * projectedTravel;
            }

            const commanderTravel = commanderSpeed * t;
            const distanceNeeded = Math.hypot(futureX - commanderX, futureY - commanderY);
            if (distanceNeeded <= commanderTravel * 1.06) {
                intercept = { x: futureX, y: futureY };
                break;
            }
        }

        if (!intercept) {
            if (hasMovementVector) {
                const fallbackTravel = Math.min(moveDistance, soldierSpeed * (maxPredictSeconds * 0.55));
                intercept = {
                    x: sx + dirX * fallbackTravel,
                    y: sy + dirY * fallbackTravel
                };
            } else {
                intercept = { x: sx, y: sy };
            }
        }

        return this.clampPointInsideCommanderDefenseRadius(intercept, defenseCenter, defenseRadius);
    }

    hasX1PowerOverlayData () {
        const snapshot = this.core?.gameManager?.x1PowerInfo;
        if (!snapshot) return false;
        const updatedAt = Number(snapshot.updatedAt || 0);
        if (!Number.isFinite(updatedAt) || updatedAt <= 0) return false;
        return (Date.now() - updatedAt) <= 6500;
    }

    renderX1OpponentPowerOverlay (context, camera) {
        const gameManager = this.core?.gameManager;
        const snapshot = gameManager?.x1PowerInfo;
        if (!snapshot || !this.hasX1PowerOverlayData()) return;

        const status = Number(snapshot.status || 0);
        if (status !== 1) return;

        const opponentId = this.normalizePlayerId(snapshot.opponentID);
        if (opponentId === null) return;
        const opponent = gameManager?.getPlayerById?.(opponentId);
        if (!opponent?.position) return;

        const screenX = Number(opponent.position.x) - (camera?.x || 0);
        const screenY = Number(opponent.position.y) - (camera?.y || 0);
        if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;

        const opponentPower = Number(snapshot.opponentPower || 0);
        const opponentGeneratingPower = Number(snapshot.opponentGeneratingPower || 0);
        const label = `Power rival: ${opponentPower} (+${opponentGeneratingPower}/s)`;

        context.save();
        context.font = "700 14px 'Ubuntu', sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";

        const paddingX = 11;
        const paddingY = 6;
        const textWidth = context.measureText(label).width;
        const boxWidth = textWidth + paddingX * 2;
        const boxHeight = 26;
        const boxX = screenX - boxWidth / 2;
        const boxY = screenY + 112;

        context.fillStyle = "rgba(10, 16, 28, 0.82)";
        context.strokeStyle = "rgba(126, 206, 255, 0.8)";
        context.lineWidth = 1.4;
        context.beginPath();
        if (typeof context.roundRect === "function") {
            context.roundRect(boxX, boxY, boxWidth, boxHeight, 9);
        } else {
            context.rect(boxX, boxY, boxWidth, boxHeight);
        }
        context.fill();
        context.stroke();

        context.fillStyle = "#dff4ff";
        context.fillText(label, screenX, boxY + boxHeight / 2 + 0.5);
        context.restore();
    }

    getClientBarracksForAssist () {
        const gameManager = this.core?.gameManager;
        const localPlayer = gameManager?.player;

        const allBuildings = [];
        if (Array.isArray(localPlayer?.buildings)) {
            allBuildings.push(...localPlayer.buildings);
        }

        const capturedNeutrals = Array.isArray(gameManager?.capturedNeutrals) ? gameManager.capturedNeutrals : [];
        capturedNeutrals.forEach((neutral) => {
            if (Array.isArray(neutral?.buildings)) {
                allBuildings.push(...neutral.buildings);
            }
        });

        return allBuildings.filter((building) => {
            if (!building || building.removeFlag) return false;
            if (building.type !== BuildingTypes.BARRACKS) return false;
            const bx = Number(building?.position?.x);
            const by = Number(building?.position?.y);
            return Number.isFinite(bx) && Number.isFinite(by);
        });
    }

    getNearestEnemyPointForAssist (enemyPoints = [], defenseCenter = null, commanderPosition = null) {
        if (!Array.isArray(enemyPoints) || enemyPoints.length === 0) return null;

        const reference = defenseCenter || commanderPosition;
        const highestPriority = enemyPoints.reduce((best, point) => {
            const priority = Math.max(1, Number(point?.priority || 1));
            return priority > best ? priority : best;
        }, 1);
        if (!reference) {
            const first = enemyPoints.find((point) =>
                Math.max(1, Number(point?.priority || 1)) === highestPriority
            ) || enemyPoints[0];
            return { x: Number(first?.x), y: Number(first?.y) };
        }

        let bestPoint = null;
        let bestDistanceSq = Infinity;
        for (const point of enemyPoints) {
            const priority = Math.max(1, Number(point?.priority || 1));
            if (priority < highestPriority) continue;
            const px = Number(point?.x);
            const py = Number(point?.y);
            if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
            const dx = px - Number(reference.x);
            const dy = py - Number(reference.y);
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq < bestDistanceSq) {
                bestDistanceSq = distanceSq;
                bestPoint = { x: px, y: py };
            }
        }
        return bestPoint;
    }

    getCommanderBarracksGuardTarget (enemyPoints = [], commanderPosition = null, defenseCenter = null) {
        const barracks = this.getClientBarracksForAssist();
        if (!barracks.length) return defenseCenter || null;

        const threatPoint = this.getNearestEnemyPointForAssist(enemyPoints, defenseCenter, commanderPosition);
        const fallbackReference = defenseCenter || commanderPosition || threatPoint;
        if (!fallbackReference) {
            const b = barracks[0];
            return { x: Number(b.position.x), y: Number(b.position.y) };
        }

        let bestBarracks = null;
        let bestScore = Infinity;
        for (const b of barracks) {
            const bx = Number(b?.position?.x);
            const by = Number(b?.position?.y);
            if (!Number.isFinite(bx) || !Number.isFinite(by)) continue;

            const rx = threatPoint ? threatPoint.x : Number(fallbackReference.x);
            const ry = threatPoint ? threatPoint.y : Number(fallbackReference.y);
            const dx = bx - rx;
            const dy = by - ry;
            const score = dx * dx + dy * dy;
            if (score < bestScore) {
                bestScore = score;
                bestBarracks = { x: bx, y: by };
            }
        }

        return bestBarracks || defenseCenter || null;
    }

    moveCommanderAssistToTarget (commander, rawTarget, nowMs, cannonTarget = null, defenseCenter = null, defenseRadius = this.commanderDefenseRadius) {
        if (!commander || !rawTarget) return false;
        const target = this.clampPointInsideCommanderDefenseRadius(rawTarget, defenseCenter, defenseRadius);
        if (!target) return false;

        const dx = target.x - this.commanderAssistLastTarget.x;
        const dy = target.y - this.commanderAssistLastTarget.y;
        const movedEnough = (dx * dx + dy * dy) >= this.commanderAssistMinTargetDistanceSq;
        const intervalPassed = (nowMs - this.commanderAssistLastMoveAt) >= this.commanderAssistMinMoveIntervalMs;
        if (!movedEnough && !intervalPassed) return false;

        this.core?.networkManager?.moveUnits?.([commander], target);
        if (typeof commander.setCannonTargetPoint === "function") {
            commander.setCannonTargetPoint(cannonTarget || target);
        }

        this.commanderAssistLastMoveAt = nowMs;
        this.commanderAssistLastTarget = target;
        return true;
    }

    setCommanderDefenseRadiusByWorldPosition (targetPosition) {
        const center = this.getCommanderDefenseCenter();
        if (!center || !targetPosition) return false;

        const tx = Number(targetPosition.x);
        const ty = Number(targetPosition.y);
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;

        const dx = tx - center.x;
        const dy = ty - center.y;
        const distance = Math.hypot(dx, dy);
        if (!Number.isFinite(distance)) return false;

        this.commanderDefenseRadius = Math.max(
            this.commanderDefenseRadiusMin,
            Math.min(this.commanderDefenseRadiusMax, distance)
        );
        localStorage.setItem("warhex_commander_defense_radius", String(Math.round(this.commanderDefenseRadius)));
        this.commanderDefenseRadiusPlacementActive = false;
        this.core?.uiManager?.notifySystemInfo?.(
            `Commander defense radius definido: ${Math.round(this.commanderDefenseRadius)}`
        );
        return true;
    }

    isPointInsideCommanderDefenseRadius (point, center = null, radius = this.commanderDefenseRadius) {
        const safeCenter = center || this.getCommanderDefenseCenter();
        if (!safeCenter || !point) return false;
        const px = Number(point.x);
        const py = Number(point.y);
        if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
        const dx = px - safeCenter.x;
        const dy = py - safeCenter.y;
        return (dx * dx + dy * dy) <= (radius * radius);
    }

    renderCommanderDefenseOverlay (context, camera) {
        const center = this.getCommanderDefenseCenter();
        const shouldRender = this.commanderAssistEnabled || this.commanderDefenseRadiusPlacementActive;
        const shouldRenderPowerOverlay = this.hasX1PowerOverlayData();
        if (!center && !shouldRenderPowerOverlay) return;
        if (!shouldRender && !shouldRenderPowerOverlay) return;

        if (center && shouldRender) {
            const radius = this.getCommanderDefenseRadiusToRender();
            if (!Number.isFinite(radius) || radius <= 0) return;

            const screenX = center.x - (camera?.x || 0);
            const screenY = center.y - (camera?.y || 0);

            context.save();
            context.beginPath();
            context.setLineDash(this.commanderDefenseRadiusPlacementActive ? [8, 7] : [10, 6]);
            context.lineWidth = this.commanderDefenseRadiusPlacementActive ? 2.4 : 1.6;
            context.strokeStyle = this.commanderDefenseRadiusPlacementActive ? "rgba(255, 215, 120, 0.95)" : "rgba(96, 234, 255, 0.7)";
            context.fillStyle = this.commanderDefenseRadiusPlacementActive ? "rgba(255, 215, 120, 0.1)" : "rgba(96, 234, 255, 0.07)";
            context.arc(screenX, screenY, radius, 0, Math.PI * 2);
            context.fill();
            context.stroke();
            context.setLineDash([]);

            if (this.commanderDefenseRadiusPlacementActive) {
                const mouse = this.core?.eventManager?.mousePosition;
                const mx = Number(mouse?.x);
                const my = Number(mouse?.y);
                if (Number.isFinite(mx) && Number.isFinite(my)) {
                    const endX = mx - (camera?.x || 0);
                    const endY = my - (camera?.y || 0);
                    context.beginPath();
                    context.moveTo(screenX, screenY);
                    context.lineTo(endX, endY);
                    context.lineWidth = 2;
                    context.strokeStyle = "rgba(255, 230, 170, 0.95)";
                    context.stroke();
                    context.beginPath();
                    context.arc(endX, endY, 4, 0, Math.PI * 2);
                    context.fillStyle = "rgba(255, 230, 170, 0.95)";
                    context.fill();
                }
            }
            context.restore();
        }

        if (shouldRenderPowerOverlay) {
            this.renderX1OpponentPowerOverlay(context, camera);
        }
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
            const duelPlayers = Array.from(assistOpponentIds)
                .map((id) => playersById.get(id))
                .filter(Boolean);
            if (duelPlayers.length > 0) {
                sourcePlayers = duelPlayers;
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
                    if (!unit || unit.isFadingOut || !unit.position) return;
                    const unitType = unit.type;
                    const isSoldier = unitType === UnitTypes.SOLDIER;
                    const isCommander = unitType === UnitTypes.COMMANDER || unitType === UnitTypes.TRI_COMMANDER;
                    if (!isSoldier && !isCommander) return;
                    enemySoldiers.push({
                        key: `${playerId}:${unit.id}`,
                        unit,
                        priority: isCommander ? 2 : 1
                    });
                });
            });
        });

        return enemySoldiers;
    }

    getEnemyCommanderFocusPoint () {
        const gameManager = this.core?.gameManager;
        const players = Array.isArray(gameManager?.players) ? gameManager.players : [];
        const localPlayerId = this.normalizePlayerId(
            gameManager?.getCurrentPlayerId?.() ?? gameManager?.player?.id
        );
        const defenseCenter = this.getCommanderDefenseCenter();
        const defenseRadius = Math.max(10, Number(this.commanderDefenseRadius) || 0);
        const defenseLineThreshold = defenseRadius + Math.max(0, Number(this.commanderAssistLineBandPx) || 0);
        const assistOpponentIds = this.getAssistOpponentIds();
        const reference = this.getCommanderDefenseCenter()
            || this.getClientCommanderUnit()?.position
            || gameManager?.player?.position
            || null;

        let sourcePlayers = players;
        if (assistOpponentIds.size > 0) {
            sourcePlayers = players.filter((player) => {
                const playerId = this.normalizePlayerId(player?.id);
                return playerId !== null && assistOpponentIds.has(playerId);
            });
        }

        const commanders = [];
        sourcePlayers.forEach((player) => {
            if (!player) return;
            const playerId = this.normalizePlayerId(player.id);
            if ((localPlayerId !== null && playerId === localPlayerId) || player.isClient) return;

            const pools = [player.units, player.spawningUnits];
            pools.forEach((pool) => {
                if (!Array.isArray(pool)) return;
                pool.forEach((unit) => {
                    if (!unit || unit.isFadingOut || !unit.position) return;
                    if (unit.type !== UnitTypes.COMMANDER && unit.type !== UnitTypes.TRI_COMMANDER) return;
                    const x = Number(unit.position.x);
                    const y = Number(unit.position.y);
                    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                    if (defenseCenter) {
                        const dx = x - Number(defenseCenter.x);
                        const dy = y - Number(defenseCenter.y);
                        const distance = Math.hypot(dx, dy);
                        if (!Number.isFinite(distance) || distance > defenseLineThreshold) {
                            return;
                        }
                    } else {
                        return;
                    }
                    commanders.push({ x, y });
                });
            });
        });

        if (!commanders.length) return null;
        if (!reference) return commanders[0];

        const rx = Number(reference.x);
        const ry = Number(reference.y);
        if (!Number.isFinite(rx) || !Number.isFinite(ry)) return commanders[0];

        let best = commanders[0];
        let bestDistanceSq = Infinity;
        commanders.forEach((candidate) => {
            const dx = candidate.x - rx;
            const dy = candidate.y - ry;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq < bestDistanceSq) {
                bestDistanceSq = distanceSq;
                best = candidate;
            }
        });
        return best;
    }

    predictEnemySoldierPosition (trackedEnemy, nowMs) {
        const { key, unit } = trackedEnemy;
        const priority = Math.max(1, Number(trackedEnemy?.priority || 1));
        const currentX = Number(unit?.position?.x);
        const currentY = Number(unit?.position?.y);
        if (!Number.isFinite(currentX) || !Number.isFinite(currentY)) return null;
        const previous = this.commanderAssistEnemyTrack.get(key);

        if (!previous) {
            this.commanderAssistEnemyTrack.set(key, {
                x: currentX,
                y: currentY,
                vx: 0,
                vy: 0,
                t: nowMs
            });
            return {
                key,
                x: currentX,
                y: currentY,
                currentX,
                currentY,
                vx: 0,
                vy: 0,
                priority
            };
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
            key,
            x: currentX + vx * this.commanderAssistPredictMs,
            y: currentY + vy * this.commanderAssistPredictMs,
            currentX,
            currentY,
            vx,
            vy,
            priority
        };
    }

    isPredictedThreatInsideDefenseRadius (predictedEnemy, defenseCenter = null, defenseRadius = this.commanderDefenseRadius) {
        const center = defenseCenter || this.getCommanderDefenseCenter();
        if (!center || !predictedEnemy) return false;

        const isInsideNow = this.isPointInsideCommanderDefenseRadius(
            { x: predictedEnemy.currentX, y: predictedEnemy.currentY },
            center,
            defenseRadius
        );
        if (isInsideNow) return true;

        return this.isPointInsideCommanderDefenseRadius(
            { x: predictedEnemy.x, y: predictedEnemy.y },
            center,
            defenseRadius
        );
    }

    getThreatsNearDefenseArea (predictedPoints = [], defenseCenter = null, defenseRadius = this.commanderDefenseRadius) {
        if (!Array.isArray(predictedPoints) || predictedPoints.length === 0) return [];
        const center = defenseCenter || this.getCommanderDefenseCenter();
        if (!center) return predictedPoints;

        const safeDefenseRadius = Math.max(10, Number(defenseRadius) || this.commanderDefenseRadius);
        const awarenessRadius = safeDefenseRadius + this.commanderAssistPreDefenseScanPadding;
        const awarenessRadiusSq = awarenessRadius * awarenessRadius;
        const lowerIgnoreThresholdY = center.y + Math.max(110, safeDefenseRadius * 0.6);

        return predictedPoints.filter((enemy) => {
            const currentX = Number(enemy?.currentX ?? enemy?.x);
            const currentY = Number(enemy?.currentY ?? enemy?.y);
            const predictedX = Number(enemy?.x);
            const predictedY = Number(enemy?.y);
            if (
                !Number.isFinite(currentX)
                || !Number.isFinite(currentY)
                || !Number.isFinite(predictedX)
                || !Number.isFinite(predictedY)
            ) {
                return false;
            }

            const nowDx = currentX - center.x;
            const nowDy = currentY - center.y;
            const predDx = predictedX - center.x;
            const predDy = predictedY - center.y;

            const withinAwarenessNow = (nowDx * nowDx + nowDy * nowDy) <= awarenessRadiusSq;
            const withinAwarenessPredicted = (predDx * predDx + predDy * predDy) <= awarenessRadiusSq;
            if (!withinAwarenessNow && !withinAwarenessPredicted) {
                return false;
            }

            const outsideDefenseNow = !this.isPointInsideCommanderDefenseRadius(
                { x: currentX, y: currentY },
                center,
                safeDefenseRadius
            );
            const outsideDefensePredicted = !this.isPointInsideCommanderDefenseRadius(
                { x: predictedX, y: predictedY },
                center,
                safeDefenseRadius
            );
            const isFarBelowBase = currentY > lowerIgnoreThresholdY && predictedY > lowerIgnoreThresholdY;
            if (isFarBelowBase && outsideDefenseNow && outsideDefensePredicted) {
                return false;
            }

            return true;
        });
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
                const weight = Math.max(1, Number(point?.priority || 1));
                acc.x += point.x * weight;
                acc.y += point.y * weight;
                acc.vx += Number(point.vx || 0) * weight;
                acc.vy += Number(point.vy || 0) * weight;
                acc.weight += weight;
                return acc;
            }, { x: 0, y: 0, vx: 0, vy: 0, weight: 0 });
            if (center.weight <= 0) continue;

            center.x /= center.weight;
            center.y /= center.weight;
            center.vx /= center.weight;
            center.vy /= center.weight;

            const distanceToCommanderSq = (() => {
                if (!commanderPosition) return Infinity;
                const dx = center.x - commanderPosition.x;
                const dy = center.y - commanderPosition.y;
                return dx * dx + dy * dy;
            })();

            if (
                !bestCluster
                || center.weight > bestCluster.weightedCount
                || (center.weight === bestCluster.weightedCount && members.length > bestCluster.count)
                || (
                    center.weight === bestCluster.weightedCount
                    && members.length === bestCluster.count
                    && distanceToCommanderSq < bestCluster.distanceToCommanderSq
                )
            ) {
                bestCluster = {
                    x: center.x,
                    y: center.y,
                    vx: center.vx,
                    vy: center.vy,
                    count: members.length,
                    weightedCount: center.weight,
                    distanceToCommanderSq
                };
            }
        }

        return bestCluster;
    }

    clampPointInsideCommanderDefenseRadius (point, defenseCenter = null, defenseRadius = this.commanderDefenseRadius) {
        const center = defenseCenter || this.getCommanderDefenseCenter();
        if (!center || !point) return point;

        const px = Number(point.x);
        const py = Number(point.y);
        if (!Number.isFinite(px) || !Number.isFinite(py)) return point;

        const dx = px - center.x;
        const dy = py - center.y;
        const distance = Math.hypot(dx, dy);
        const clampedRadius = Math.max(10, Number(defenseRadius) - this.commanderAssistDefenseEdgePadding);
        if (!Number.isFinite(distance) || distance <= clampedRadius) {
            return { x: px, y: py };
        }

        const ratio = clampedRadius / (distance || 1);
        return {
            x: center.x + dx * ratio,
            y: center.y + dy * ratio
        };
    }

    buildCommanderAssistTarget (commanderPosition, clusterCenter, defenseCenter = null, defenseRadius = this.commanderDefenseRadius) {
        const vx = clusterCenter.x - commanderPosition.x;
        const vy = clusterCenter.y - commanderPosition.y;
        const distanceToCluster = Math.hypot(vx, vy) || 1;

        let targetX = clusterCenter.x;
        let targetY = clusterCenter.y;
        const farDistanceThreshold = Math.max(this.commanderAssistFarInterceptDistance, defenseRadius * 0.45);
        const clusterVelocityX = Number(clusterCenter.vx || 0);
        const clusterVelocityY = Number(clusterCenter.vy || 0);
        const clusterSpeed = Math.hypot(clusterVelocityX, clusterVelocityY);

        if (distanceToCluster >= farDistanceThreshold) {
            let cutDirX = 0;
            let cutDirY = 0;

            if (clusterSpeed >= this.commanderAssistMinThreatSpeed) {
                cutDirX = clusterVelocityX / clusterSpeed;
                cutDirY = clusterVelocityY / clusterSpeed;
            } else if (defenseCenter) {
                const toCenterX = defenseCenter.x - clusterCenter.x;
                const toCenterY = defenseCenter.y - clusterCenter.y;
                const toCenterLength = Math.hypot(toCenterX, toCenterY) || 1;
                cutDirX = toCenterX / toCenterLength;
                cutDirY = toCenterY / toCenterLength;
            }

            if (cutDirX !== 0 || cutDirY !== 0) {
                const leadDistance = Math.max(
                    this.commanderAssistMinCutLeadDistance,
                    Math.min(this.commanderAssistMaxCutLeadDistance, distanceToCluster * 0.35)
                );
                targetX = clusterCenter.x + cutDirX * leadDistance;
                targetY = clusterCenter.y + cutDirY * leadDistance;
            }
        } else {
            targetX = clusterCenter.x + (vx / distanceToCluster) * this.commanderAssistOvershootDistance;
            targetY = clusterCenter.y + (vy / distanceToCluster) * this.commanderAssistOvershootDistance;
        }

        return this.clampPointInsideCommanderDefenseRadius(
            { x: targetX, y: targetY },
            defenseCenter,
            defenseRadius
        );
    }

    buyCommanderForAssist () {
        if (this.core?.gameManager?.hasCommander) return false;
        this.core?.buildingManager?.deselectBuildings?.();
        this.core?.uiManager?.hideUpgrades?.();
        this.core?.networkManager?.sendBuyCommander?.();
        return true;
    }

    handleCommanderReturnToBaseHotkey () {
        const player = this.core?.gameManager?.player;
        if (!player?.position) return false;

        const baseTarget = {
            x: Number(player.position.x),
            y: Number(player.position.y)
        };
        if (!Number.isFinite(baseTarget.x) || !Number.isFinite(baseTarget.y)) return false;

        this.core?.camera?.setPosition?.(player.position);
        this.core?.buildingManager?.updateBuildingPosition?.();

        const commander = this.getClientCommanderUnit();
        if (commander) {
            this.core?.networkManager?.moveUnits?.([commander], baseTarget);
            if (typeof commander.setCannonTargetPoint === "function") {
                commander.setCannonTargetPoint(baseTarget);
            }
            this.commanderAssistLastMoveAt = Date.now();
            this.commanderAssistLastTarget = baseTarget;
            this.selectCommanderUnit({ suppressHint: true });
            this.core?.uiManager?.notifySystemInfo?.("Commander retornando para a base.");
            return true;
        }

        if (this.commanderAssistEnabled) {
            this.selectCommanderOrBuy();
        }
        this.core?.uiManager?.notifySystemInfo?.("Camera voltou para a base.");
        return true;
    }

    updateCommanderAssist (deltaTime = 0) {
        this.ensureCommanderDefenseOverlay();
        if (!this.commanderAssistEnabled) return;

        const nowMs = Date.now();
        if (nowMs - this.commanderAssistLastTickAt < this.commanderAssistTickIntervalMs) return;
        this.commanderAssistLastTickAt = nowMs;

        if (this.core?.uiManager?.isGameplayInputBlocked?.()) return;
        if (!this.core?.gameManager?.player) return;
        const defenseCenter = this.getCommanderDefenseCenter();
        const defenseRadius = this.commanderDefenseRadius;
        this.core?.buildingManager?.updateCommanderAssistAutoDefense?.(nowMs);
        this.pollX1PowerInfoForOverlay(nowMs);

        let commander = this.getClientCommanderUnit();
        if (!commander) {
            if (nowMs - this.commanderAssistLastBuyAt >= this.commanderAssistBuyCooldownMs) {
                this.commanderAssistLastBuyAt = nowMs;
                this.buyCommanderForAssist();
            }
            this.commanderAssistSplitModeActive = false;
            this.updateCommanderAssistSoldiersFollowMouse(nowMs);
            return;
        }

        const enemyCommanderFocusPoint = this.getEnemyCommanderFocusPoint();
        const split = this.getCommanderAssistSoldierSplit(
            commander,
            defenseCenter,
            defenseRadius,
            enemyCommanderFocusPoint
        );
        this.updateCommanderAssistSoldiersFollowMouse(nowMs);
        this.commanderAssistSplitModeActive = split.active;
        const soldiersForCatchup = split.active ? split.commanderSoldiers : this.getAliveClientSoldiers();
        const commanderCatchupTarget = this.getCommanderCatchupTarget(
            commander,
            soldiersForCatchup,
            defenseCenter,
            defenseRadius
        );

        const trackedEnemies = this.getEnemySoldiersForAssist();
        if (!trackedEnemies.length) {
            this.commanderAssistEnemyTrack.clear();
            if (commanderCatchupTarget) {
                this.moveCommanderAssistToTarget(
                    commander,
                    commanderCatchupTarget,
                    nowMs,
                    commanderCatchupTarget,
                    defenseCenter,
                    defenseRadius
                );
                return;
            }
            const shouldHoldDefensePosture = (nowMs - this.commanderAssistLastThreatNearDefenseAt) <= this.commanderAssistThreatMemoryMs;
            if (shouldHoldDefensePosture) {
                return;
            }
            const fallbackGuardTarget = this.getCommanderBarracksGuardTarget([], commander.position, defenseCenter);
            this.moveCommanderAssistToTarget(
                commander,
                fallbackGuardTarget,
                nowMs,
                fallbackGuardTarget,
                defenseCenter,
                defenseRadius
            );
            return;
        }

        const activeEnemyKeys = new Set(trackedEnemies.map(enemy => enemy.key));
        for (const key of this.commanderAssistEnemyTrack.keys()) {
            if (!activeEnemyKeys.has(key)) {
                this.commanderAssistEnemyTrack.delete(key);
            }
        }

        const predictedPoints = trackedEnemies
            .map((enemy) => this.predictEnemySoldierPosition(enemy, nowMs))
            .filter(Boolean);
        const threatsNearDefense = this.getThreatsNearDefenseArea(
            predictedPoints,
            defenseCenter,
            defenseRadius
        );
        const threatsInsideDefenseRadius = threatsNearDefense.filter((enemy) =>
            this.isPredictedThreatInsideDefenseRadius(enemy, defenseCenter, defenseRadius)
        );
        if (threatsInsideDefenseRadius.length > 0) {
            this.commanderAssistLastThreatNearDefenseAt = nowMs;
        }
        if (!threatsInsideDefenseRadius.length) {
            const shouldHoldDefensePosture = (nowMs - this.commanderAssistLastThreatNearDefenseAt) <= this.commanderAssistThreatMemoryMs;
            if (shouldHoldDefensePosture) {
                return;
            }

            if (commanderCatchupTarget) {
                this.moveCommanderAssistToTarget(
                    commander,
                    commanderCatchupTarget,
                    nowMs,
                    commanderCatchupTarget,
                    defenseCenter,
                    defenseRadius
                );
                return;
            }

            const fallbackGuardTarget = this.getCommanderBarracksGuardTarget(
                [],
                commander.position,
                defenseCenter
            );
            this.moveCommanderAssistToTarget(
                commander,
                fallbackGuardTarget,
                nowMs,
                fallbackGuardTarget,
                defenseCenter,
                defenseRadius
            );
            return;
        }
        const cluster = this.findLargestEnemyCluster(threatsInsideDefenseRadius, commander.position);
        if (!cluster) return;

        const target = this.buildCommanderAssistTarget(
            commander.position,
            cluster,
            defenseCenter,
            defenseRadius
        );
        this.moveCommanderAssistToTarget(
            commander,
            target,
            nowMs,
            { x: cluster.x, y: cluster.y },
            defenseCenter,
            defenseRadius
        );
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
        if (this.commanderDefenseRadiusPlacementActive) {
            this.setCommanderDefenseRadiusByWorldPosition(mousePosition);
            return;
        }

        if (this.hasSelectedUnits()) {
            this.clearSelection();
            return;
        }
    }

    handleRightClick (mousePosition) {
        if (this.commanderDefenseRadiusPlacementActive) {
            this.cancelCommanderDefenseRadiusPlacement();
            return;
        }
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
