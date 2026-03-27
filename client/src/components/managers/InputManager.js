import Renderable from "../Renderable.js";
import { QueueType } from "../Renderer.js";
import ThemeManager from "./ThemeManager.js";

export default class InputManager {
    constructor (core) {
        this.core = core;
        this.clickHandlers = {
            rightClick: [],
            leftClick: [],
            mouseDown: [],
            mouseMove: [],
            mouseUp: []
        };
        this.shiftPressed = false;
        this.activeKeys = new Set();
        this.selectionCircle = null;
        this.selectionCircleHandlers = {
            onCreate: [],
            onUpdate: [],
            onRemove: [],
        };

        this.registerMouseDownHandler((mousePosition, button) => this.createSelectionCircle(mousePosition, button));
        this.registerMouseUpHandler((mousePosition, button) => {
            if (button === 0) {
                this.removeSelectionCircle(mousePosition);
            }
        });
        this.registerMouseMoveHandler((mousePosition) => this.updateSelectionCircle(mousePosition));

        this.activityEvents = ['mousemove', 'keydown', 'mousedown'];
        this.activityHandler = () => this.notifyServerOfActivity();
        this.addActivityListeners();

        this.initializeKeyListeners();
    }

    addActivityListeners() {
        this.activityEvents.forEach(eventType => {
            document.addEventListener(eventType, this.activityHandler);
        });
    }

    removeActivityListeners() {
        this.activityEvents.forEach(eventType => {
            document.removeEventListener(eventType, this.activityHandler);
        });
    }

    notifyServerOfActivity() {
        this.core.networkManager.sendPlayerActivity();
        this.core.uiManager.hideInactivityWarning();
    }

    initializeKeyListeners () {
        document.addEventListener("keydown", (event) => {
            const ui = this.core.uiManager;
            const normalizeHudKey = (value) => {
                const fromUI = ui?.normalizeKeybindValue?.(value);
                if (typeof fromUI === "string" && fromUI) return fromUI;
                return String(value || "").toLowerCase();
            };
            const key = normalizeHudKey(event.key);
            const gameplayInputBlocked = Boolean(ui?.isGameplayInputBlocked?.());
            const bindKey = (action, fallback) => {
                const resolved = ui?.getHudKeybind?.(action, fallback);
                if (resolved === null || resolved === undefined) return normalizeHudKey(fallback);
                return normalizeHudKey(resolved);
            };
            const keySelectArmy = bindKey("selectArmy", "q");
            const keySelectCommander = bindKey("selectCommander", "c");
            const keySelectAll = bindKey("selectAllUnits", "e");
            const keyToggleMap = bindKey("toggleMap", "m");
            const keyReturnToBase = bindKey("returnToBase", "r");
            const keyToggleGroupTroops = bindKey("toggleGroupTroops", "z");
            const keyToggleHudMiniMap = bindKey("toggleHudMiniMap", "");
            const keyToggleHudChat = bindKey("toggleHudChat", "");
            const keyToggleHudLeaderboard = bindKey("toggleHudLeaderboard", "");
            const keyToggleHudToolbar = bindKey("toggleHudToolbar", "");
            const keyToggleHudGroupTroopsPanel = bindKey("toggleHudGroupTroopsPanel", "");
            const keySelectSoldiersOnly = bindKey("selectSoldiersOnly", "x");
            const keySelectTanksOnly = bindKey("selectTanksOnly", "v");
            const keySelectSiegeOnly = bindKey("selectSiegeOnly", "b");
            const keySelectCommanderSoldiers = bindKey("selectCommanderSoldiers", "");
            const keySelectCommanderTanks = bindKey("selectCommanderTanks", "");
            const keySelectCommanderSiege = bindKey("selectCommanderSiege", "");
            const keySelectCommanderSoldiersTanks = bindKey("selectCommanderSoldiersTanks", "");
            const keySelectCommanderSoldiersSiege = bindKey("selectCommanderSoldiersSiege", "");
            const keySelectCommanderTanksSiege = bindKey("selectCommanderTanksSiege", "");
            const keySelectCommanderArmy = bindKey("selectCommanderArmy", "");
            const keyUpgradeDestroyAll = bindKey("upgradeDestroyAll", "u");
            this.activeKeys.add(key); // Add key to active keys
            if (event.key === "Shift") {
                this.shiftPressed = true;
            }

            // Handle number keys
            if (event.key >= '1' && event.key <= '9') {
                this.handleNumberKeyPress(parseInt(event.key, 10));
            }

            const upgradesContainer = this.core.uiManager?.DOM?.game?.upgrades?.container;
            const upgradePanelOpenBeforeAction = upgradesContainer?.style?.display !== "none";
            const activeElement = document.activeElement;
            const activeTag = activeElement?.tagName?.toLowerCase?.() || "";
            const isFormFocused = Boolean(
                activeElement &&
                (activeTag === "input" || activeTag === "textarea" || activeTag === "select" || activeElement.isContentEditable)
            );
            const consumedByBaseLayoutHotkey = Boolean(
                !event.repeat
                && !this.core.uiManager?.isChatInputFocused
                && !gameplayInputBlocked
                && !isFormFocused
                && ui?.triggerBaseLayoutHotkeyLoad?.(key)
            );
            const consumedByGlobalUpgradeHotkey = Boolean(
                !event.repeat
                && !this.core.uiManager?.isChatInputFocused
                && !gameplayInputBlocked
                && !isFormFocused
                && ui?.triggerGlobalUpgradeHotkey?.(key)
            );
            let handledAnyAction = consumedByBaseLayoutHotkey || consumedByGlobalUpgradeHotkey;
            const canUseGameplayHotkeys = !this.core.uiManager.isChatInputFocused && !gameplayInputBlocked;
            const isCommanderAssistHotkey = (
                key === "*"
                || event.code === "NumpadMultiply"
                || (event.code === "Digit8" && event.shiftKey)
            );

            if (isCommanderAssistHotkey && canUseGameplayHotkeys && !isFormFocused && !event.repeat) {
                this.core.unitManager?.toggleCommanderAssistMode?.();
                handledAnyAction = true;
            }

            const isDeleteSellHotkey = (
                key === "delete"
                && !this.core.uiManager?.isChatInputFocused
                && !gameplayInputBlocked
                && !isFormFocused
            );
            if (isDeleteSellHotkey) {
                if (!event.repeat) {
                    this.triggerDeleteSellHotkey({
                        upgradePanelOpen: upgradePanelOpenBeforeAction
                    });
                }
                event.preventDefault();
                return;
            }

            const isTabKey = event.key === "Tab";
            const isEnterKey = event.key === "Enter";
            if (isEnterKey && !ui?.isChatInputFocused) {
                if (!gameplayInputBlocked && !isFormFocused && !event.repeat) {
                    event.preventDefault();
                    ui?.focusChatInput?.();
                }
                return;
            }
            if (key === "r") {
                if (!this.core.uiManager.isChatInputFocused && !gameplayInputBlocked && !isFormFocused && !event.repeat) {
                    const rotated = this.core.buildingManager?.rotateCurrentPlacement?.(1);
                    if (rotated) {
                        event.preventDefault();
                        return;
                    }
                }
            }
            if (keyReturnToBase && key === keyReturnToBase) {
                if (!this.core.uiManager.isChatInputFocused && !gameplayInputBlocked && !isFormFocused && !event.repeat) {
                    if (this.core.gameManager.player) {
                        const playerPosition = this.core.gameManager.player.position;
                        this.core.camera.setPosition(playerPosition);
                        this.core.buildingManager.updateBuildingPosition();
                        handledAnyAction = true;
                    }
                }
            }
            if (key === keyToggleMap || isTabKey) {
                if (this.core.uiManager.isChatInputFocused || gameplayInputBlocked || isFormFocused) {
                    return;
                }
                if (isTabKey) {
                    // Keep Tab from moving browser focus while playing.
                    event.preventDefault();
                }
                // Toggle actions should only fire once per key press.
                if (!event.repeat) {
                    // Toggle map overview (zoomed out) for better visualization
                    if (typeof this.core.toggleMapView === "function") {
                        this.core.toggleMapView();
                    } else {
                        this.core.miniMap.toggleFullScreen();
                    }
                    handledAnyAction = true;
                }
            }
            if (key === "g") {
                if (canUseGameplayHotkeys) {
                    this.core.unitManager.selectAllUnits();
                    handledAnyAction = true;
                }
            }
            if (key === keyToggleGroupTroops) {
                if (canUseGameplayHotkeys) {
                    this.core.uiManager?.DOM?.game?.unitControls?.groupUnitsButton?.click?.();
                    handledAnyAction = true;
                }
            }
            if (keyToggleHudMiniMap && key === keyToggleHudMiniMap) {
                if (!this.core.uiManager.isChatInputFocused && !gameplayInputBlocked && !isFormFocused && !event.repeat) {
                    const visible = this.core.uiManager?.toggleHudMiniMapVisibility?.();
                    this.core.uiManager?.notifySystemInfo?.(visible ? "Minimap shown." : "Minimap hidden.");
                    handledAnyAction = true;
                }
            }
            if (keyToggleHudChat && key === keyToggleHudChat) {
                if (!this.core.uiManager.isChatInputFocused && !gameplayInputBlocked && !isFormFocused && !event.repeat) {
                    const collapsed = this.core.uiManager?.toggleHudPanelCollapsed?.("chat");
                    this.core.uiManager?.notifySystemInfo?.(collapsed ? "Chat minimized." : "Chat expanded.");
                    handledAnyAction = true;
                }
            }
            if (keyToggleHudLeaderboard && key === keyToggleHudLeaderboard) {
                if (!this.core.uiManager.isChatInputFocused && !gameplayInputBlocked && !isFormFocused && !event.repeat) {
                    const collapsed = this.core.uiManager?.toggleHudPanelCollapsed?.("leaderboard");
                    this.core.uiManager?.notifySystemInfo?.(collapsed ? "Rank minimized." : "Rank expanded.");
                    handledAnyAction = true;
                }
            }
            if (keyToggleHudToolbar && key === keyToggleHudToolbar) {
                if (!this.core.uiManager.isChatInputFocused && !gameplayInputBlocked && !isFormFocused && !event.repeat) {
                    const visible = this.core.uiManager?.toggleHudPanelVisibility?.("toolbar");
                    this.core.uiManager?.notifySystemInfo?.(visible ? "Toolbar shown." : "Toolbar hidden.");
                    handledAnyAction = true;
                }
            }
            if (keyToggleHudGroupTroopsPanel && key === keyToggleHudGroupTroopsPanel) {
                if (!this.core.uiManager.isChatInputFocused && !gameplayInputBlocked && !isFormFocused && !event.repeat) {
                    const visible = this.core.uiManager?.toggleHudPanelVisibility?.("groupTroops");
                    this.core.uiManager?.notifySystemInfo?.(visible ? "Group Troops shown." : "Group Troops hidden.");
                    handledAnyAction = true;
                }
            }
            if (key === keySelectArmy) {
                if (canUseGameplayHotkeys) {
                    this.core.unitManager.selectArmyCombatUnits();
                    handledAnyAction = true;
                }
            }
            if (key === keySelectSoldiersOnly) {
                if (canUseGameplayHotkeys) {
                    this.core.unitManager.selectOnlySoldiers();
                    handledAnyAction = true;
                }
            }
            if (key === keySelectTanksOnly) {
                if (canUseGameplayHotkeys) {
                    this.core.unitManager.selectOnlyTanks();
                    handledAnyAction = true;
                }
            }
            if (key === keySelectSiegeOnly) {
                if (canUseGameplayHotkeys) {
                    this.core.unitManager.selectOnlySiege();
                    handledAnyAction = true;
                }
            }
            if (key === keySelectAll) {
                if (canUseGameplayHotkeys) {
                    this.core.unitManager.selectAllUnits();
                    handledAnyAction = true;
                }
            }
            if (key === keySelectCommander) {
                if (canUseGameplayHotkeys && !event.repeat) {
                    this.core.unitManager.selectCommanderOrBuy();
                    handledAnyAction = true;
                }
            }
            if (keySelectCommanderSoldiers && key === keySelectCommanderSoldiers) {
                if (canUseGameplayHotkeys) {
                    this.core.unitManager.selectCommanderAndSoldiers();
                    handledAnyAction = true;
                }
            }
            if (keySelectCommanderTanks && key === keySelectCommanderTanks) {
                if (canUseGameplayHotkeys) {
                    this.core.unitManager.selectCommanderAndTanks();
                    handledAnyAction = true;
                }
            }
            if (keySelectCommanderSiege && key === keySelectCommanderSiege) {
                if (canUseGameplayHotkeys) {
                    this.core.unitManager.selectCommanderAndSiege();
                    handledAnyAction = true;
                }
            }
            if (keySelectCommanderSoldiersTanks && key === keySelectCommanderSoldiersTanks) {
                if (canUseGameplayHotkeys) {
                    this.core.unitManager.selectCommanderAndSoldiersTanks();
                    handledAnyAction = true;
                }
            }
            if (keySelectCommanderSoldiersSiege && key === keySelectCommanderSoldiersSiege) {
                if (canUseGameplayHotkeys) {
                    this.core.unitManager.selectCommanderAndSoldiersSiege();
                    handledAnyAction = true;
                }
            }
            if (keySelectCommanderTanksSiege && key === keySelectCommanderTanksSiege) {
                if (canUseGameplayHotkeys) {
                    this.core.unitManager.selectCommanderAndTanksSiege();
                    handledAnyAction = true;
                }
            }
            if (keySelectCommanderArmy && key === keySelectCommanderArmy) {
                if (canUseGameplayHotkeys) {
                    this.core.unitManager.selectCommanderAndArmy();
                    handledAnyAction = true;
                }
            }
            if (key === keyUpgradeDestroyAll) {
                if (!this.core.uiManager.isChatInputFocused && !gameplayInputBlocked && !isFormFocused && !event.repeat) {
                    this.core.buildingManager?.sellAllOwnedBuildingsAcrossBase?.({
                        triggerLabel: "Sell All"
                    });
                    handledAnyAction = true;
                }
            }
            if (!isFormFocused && !gameplayInputBlocked && upgradePanelOpenBeforeAction && this.handleUpgradeKeyPress(key)) {
                handledAnyAction = true;
            }
            if (this.core.buildingManager?.handleDefenseHotkeyDown) {
                this.core.buildingManager.handleDefenseHotkeyDown(key);
            }
            if (handledAnyAction) {
                event.preventDefault();
            }
        });

        document.addEventListener("keyup", (event) => {
            const ui = this.core.uiManager;
            const normalizeHudKey = (value) => {
                const fromUI = ui?.normalizeKeybindValue?.(value);
                if (typeof fromUI === "string" && fromUI) return fromUI;
                return String(value || "").toLowerCase();
            };
            const key = normalizeHudKey(event.key);
            this.activeKeys.delete(key); // Remove key from active keys
            if (event.key === "Shift") {
                this.shiftPressed = false;
            }
            if (this.core.buildingManager?.handleDefenseHotkeyUp) {
                this.core.buildingManager.handleDefenseHotkeyUp(key);
            }
        });
    }

    registerSelectionCircleOnCreateHandler(handler) {
        this.selectionCircleHandlers.onCreate.unshift(handler);
    }
    
    registerSelectionCircleOnRemoveHandler(handler) {
        this.selectionCircleHandlers.onRemove.unshift(handler);
    }
    
    registerSelectionCircleOnUpdateHandler(handler) {
        this.selectionCircleHandlers.onUpdate.unshift(handler);
    }

    invokeSelectionCircleOnCreateHandler(selectionCircle){
        this.selectionCircleHandlers.onCreate.forEach(handler => handler(selectionCircle));
    }

    invokeSelectionCircleOnUpdateHandler(selectionCircle){
        this.selectionCircleHandlers.onUpdate.forEach(handler => handler(selectionCircle));
    }

    invokeSelectionCircleOnRemoveHandler(selectionCircle){
        this.selectionCircleHandlers.onRemove.forEach(handler => handler(selectionCircle));
    }

    // Creates the selection circle and notifies listeners
    createSelectionCircle (mousePosition, button = 0) {
        if (button !== 0) {
            return;
        }

        if (this.core.uiManager?.isGameplayInputBlocked?.()) {
            return;
        }

        if (this.core.unitManager?.hasSelectedUnits?.() && !this.shiftPressed) {
            return;
        }

        if(this.core.gameManager.player === null
            || this.core.buildingManager.buildingToPlace
        ){
            return;
        }
        
        if (this.selectionCircle) {
            this.removeSelectionCircle();
        }

        this.selectionCircle = new Renderable();
        this.selectionCircle.position = { x: mousePosition.x - this.core.camera.x, y: mousePosition.y - this.core.camera.y };
        this.selectionCircle.width = 0;
        this.selectionCircle.height = 0;
        this.selectionCircle.radius = 0;

        this.selectionCircle.render = (context) => {
            const width = this.selectionCircle.width;
            const height = this.selectionCircle.height;

            context.strokeStyle = ThemeManager.currentThemeProperties.selectionStroke;
            context.fillStyle = ThemeManager.currentThemeProperties.selectionColor;
            context.lineWidth = 2;
            context.beginPath();
            context.rect(this.selectionCircle.position.x, this.selectionCircle.position.y, width, height);
            context.stroke();
            context.fill();
        };

        // Add to rendering queue
        this.core.renderer.addToQueue(this.selectionCircle, QueueType.OVERLAY);
        // Notify listeners about the creation
        this.invokeSelectionCircleOnCreateHandler(this.selectionCircle);
    }

    // Updates the selection circle's position and size, and notifies listeners
    updateSelectionCircle (mousePosition) {
        if (this.selectionCircle) {
            const startX = this.selectionCircle.position.x;
            const startY = this.selectionCircle.position.y;

            this.selectionCircle.width = mousePosition.x - startX - this.core.camera.x;
            this.selectionCircle.height = mousePosition.y - startY - this.core.camera.y;

            // Notify listeners about the update
            this.invokeSelectionCircleOnUpdateHandler(this.selectionCircle);
        }
    }

    // Removes the selection circle and notifies listeners
    removeSelectionCircle () {
        if (this.selectionCircle) {
            this.core.renderer.removeFromQueue(this.selectionCircle, QueueType.OVERLAY);
            
            // Notify listeners about the removal
            this.invokeSelectionCircleOnRemoveHandler(this.selectionCircle);
            this.selectionCircle = null;
        }
    }


    // Clear all active key states
    clearActiveKeys () {
        this.shiftPressed = false;
        this.activeKeys.clear(); // Clears all active keys
    }

    registerLeftClickHandler (handler) {
        this.clickHandlers.leftClick.push(handler);
    }


    registerRightClickHandler (handler) {
        this.clickHandlers.rightClick.push(handler);
    }

    registerMouseDownHandler (handler) {
        this.clickHandlers.mouseDown.push(handler);
    }


    registerMouseMoveHandler (handler) {
        this.clickHandlers.mouseMove.push(handler);
    }


    registerMouseUpHandler (handler) {
        this.clickHandlers.mouseUp.push(handler);
    }


    invokeMouseDownHandlers (event, button) {
        this.clickHandlers.mouseDown.forEach(handler => handler(event, button));
    }

    invokeMouseUpHandlers (event, button) {
        this.clickHandlers.mouseUp.forEach(handler => handler(event, button));
    }


    invokeMouseMoveHandlers (event) {
        this.clickHandlers.mouseMove.forEach(handler => handler(event));
    }

    invokeLeftClickHandlers (event) {
        this.clickHandlers.leftClick.forEach(handler => handler(event));
    }

    invokeRightClickHandlers (event) {
        this.clickHandlers.rightClick.forEach(handler => handler(event));
    }

    onCanvasContextMenu (event) {
        if (this.core.uiManager?.isGameplayInputBlocked?.()) return;
        this.invokeRightClickHandlers(this.core.eventManager.mousePosition);
    }

    onCanvasMouseClick (event) {
        if (this.core.uiManager?.isGameplayInputBlocked?.()) return;
        this.invokeLeftClickHandlers(this.core.eventManager.mousePosition);
    }

    onMouseDown (event) {
        const ui = this.core.uiManager;
        if (
            ui
            && !ui.isGameplayInputBlocked?.()
            && !ui.isChatInputFocused
            && Number.isInteger(event?.button)
            && event.button >= 3
        ) {
            const mouseHotkey = ui.normalizeKeybindValue(`mouse${event.button + 1}`);
            const consumed = ui.triggerBaseLayoutHotkeyLoad?.(mouseHotkey);
            if (consumed) {
                event.preventDefault?.();
                return;
            }
        }
        if (this.core.uiManager?.isGameplayInputBlocked?.()) return;
        this.invokeMouseDownHandlers(this.core.eventManager.mousePosition, event.button);
    }

    onMouseMove (event) {
        this.invokeMouseMoveHandlers(this.core.eventManager.mousePosition);
    }

    onMouseUp (event) {
        if (this.core.uiManager?.isGameplayInputBlocked?.()) return;
        this.invokeMouseUpHandlers(this.core.eventManager.mousePosition, event.button);
    }


    handleNumberKeyPress (number) {
        const toolbar = this.core.toolbar;
        if (toolbar) {
            toolbar.selectByIndex(number - 1); // Adjust for 0-based index
        }
    }

    handleUpgradeKeyPress (key) {
        if (this.core.uiManager.DOM.game.upgrades.container.style.display === "none") {
            return false;
        }
        if (this.core.uiManager.isChatInputFocused) {
            return false;
        }
        const ui = this.core.uiManager;
        const normalizeHudKey = (value) => {
            const fromUI = ui?.normalizeKeybindValue?.(value);
            if (typeof fromUI === "string" && fromUI) return fromUI;
            return String(value || "").toLowerCase();
        };
        const bindKey = (action, fallback) => {
            const resolved = ui?.getHudKeybind?.(action, fallback);
            if (resolved === null || resolved === undefined) return normalizeHudKey(fallback);
            return normalizeHudKey(resolved);
        };
        const keyUpgrade1 = bindKey("upgrade1", "q");
        const keyUpgrade2 = bindKey("upgrade2", "e");
        const keyUpgrade3 = bindKey("upgrade3", "t");
        const keyUpgradeDestroy = bindKey("upgradeDestroy", "r");
        const keyUpgradeBarracks = bindKey("upgradeBarracksToggle", "f");
        const keyUpgradeAllMode = bindKey("upgradeAllMode", "y");
        const keyUpgradeDestroyAll = bindKey("upgradeDestroyAll", "u");

        const upgradeListElement = this.core.uiManager.DOM.game.upgrades.list; // Get the upgrade list element

        // Check if the upgrade list element exists
        if (upgradeListElement) {
            const upgradeItems = upgradeListElement.querySelectorAll('.upgrade-item'); // Get all upgrade items
            const triggerUpgradeItem = (index) => {
                const item = upgradeItems[index];
                if (!item) return;
                if (item.dataset?.clickOnly === "1") {
                    this.core.uiManager?.notifySystemWarning?.("Repair is click-only to avoid accidental purchase.");
                    return true;
                }
                item.click();
                return true;
            };

            // Specific per-upgrade hotkeys configured from the Theme menu.
            const directMatch = Array.from(upgradeItems).find((item) => {
                const itemKey = normalizeHudKey(item?.dataset?.upgradeHotkey || "");
                return itemKey && itemKey === key;
            });
            if (directMatch) {
                if (directMatch.dataset?.clickOnly === "1") {
                    this.core.uiManager?.notifySystemWarning?.("Repair is click-only to avoid accidental purchase.");
                    return true;
                }
                directMatch.click();
                return true;
            }

            if (key === keyUpgrade1 && upgradeItems.length > 0) {
                return triggerUpgradeItem(0);
            } else if (key === keyUpgrade2 && upgradeItems.length > 1) {
                return triggerUpgradeItem(1);
            } else if (key === keyUpgrade3 && upgradeItems.length > 2) {
                return triggerUpgradeItem(2);
            } else if (key === keyUpgradeDestroy) {
                // If 'R' is pressed, click the destroy button
                const upgradeDestroyButton = this.core.uiManager.DOM.game.upgrades.destroyButton;
                if (upgradeDestroyButton) {
                    upgradeDestroyButton.click(); // Simulate a click on the destroy button
                    return true;
                }
            } else if (key === keyUpgradeDestroyAll) {
                const upgradeDestroyAllButton = document.getElementById("upgrade-destroy-all-button");
                if (upgradeDestroyAllButton) {
                    upgradeDestroyAllButton.click();
                    return true;
                }
            } else if (key === keyUpgradeBarracks) {
                // If 'F' is pressed, simulate a click on the barracks activation tab
                const barracksTab = document.querySelector('[data-type="barracks-activation-toggle"]');
                if (barracksTab) {
                    barracksTab.click();
                    return true;
                }
            } else if (key === keyUpgradeAllMode) {
                const upgradeBulkToggleButton = document.getElementById("upgrade-bulk-toggle-button");
                if (upgradeBulkToggleButton) {
                    upgradeBulkToggleButton.click();
                    return true;
                }
            }
        }
        return false;
    }

    triggerDeleteSellHotkey (options = {}) {
        const upgradePanelOpen = Boolean(options?.upgradePanelOpen);
        if (upgradePanelOpen) {
            const destroyBtn = this.core.uiManager?.DOM?.game?.upgrades?.destroyButton;
            if (destroyBtn) {
                destroyBtn.click();
                return true;
            }
        }
        const removed = this.core.buildingManager?.destroySelectedBuildings?.() || 0;
        return removed > 0;
    }

    handleKeys (deltaTime) {
        let dx = 0;
        let dy = 0;
        // Determine movement direction
        if (this.activeKeys.has('w') || this.activeKeys.has('arrowup')) {
            dy -= 1;
        }
        if (this.activeKeys.has('s') || this.activeKeys.has('arrowdown')) {
            dy += 1;
        }
        if (this.activeKeys.has('a') || this.activeKeys.has('arrowleft')) {
            dx -= 1;
        }
        if (this.activeKeys.has('d') || this.activeKeys.has('arrowright')) {
            dx += 1;
        }

        // Adjust deltaTime if Shift is pressed
        if (this.activeKeys.has('shift')) {
            deltaTime *= 1.5;
        }
        if (dx !== 0 || dy !== 0) {
            this.handleCameraMovement(dx, dy, deltaTime);
        }

        // Camera recenter hotkey is handled on keydown.
    }


    handleCameraMovement (dx, dy, deltaTime) {
        // Calculate the length of the movement vector
        const length = Math.sqrt(dx * dx + dy * dy);

        // Normalize the movement vector if necessary
        if (length > 0) {
            dx /= length;
            dy /= length;
        }

        // Apply the normalized movement vector
        this.core.camera.move(dx * deltaTime / 10, dy * deltaTime / 10);

        if (this.core.eventManager.lastMouseEvent) {
            this.core.eventManager.updateMousePosition(this.core.eventManager.lastMouseEvent);
        }

        this.core.buildingManager.updateBuildingPosition();

        if (this.core.unitManager.selectionCircle) {
            this.core.unitManager.removeSelectionCircle();
        }
    }

}
