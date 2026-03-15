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
            const key = event.key.toLowerCase();
            const ui = this.core.uiManager;
            const gameplayInputBlocked = Boolean(ui?.isGameplayInputBlocked?.());
            const bindKey = (action, fallback) => String(ui?.getHudKeybind?.(action, fallback) || fallback).toLowerCase();
            const keySelectArmy = bindKey("selectArmy", "q");
            const keySelectCommander = bindKey("selectCommander", "c");
            const keySelectAll = bindKey("selectAllUnits", "e");
            const keyToggleMap = bindKey("toggleMap", "m");
            const keyToggleGroupTroops = bindKey("toggleGroupTroops", "z");
            const keySelectSoldiersOnly = bindKey("selectSoldiersOnly", "x");
            const keySelectTanksOnly = bindKey("selectTanksOnly", "v");
            const keySelectSiegeOnly = bindKey("selectSiegeOnly", "b");
            const upgradeHotkeys = [
                bindKey("upgrade1", "q"),
                bindKey("upgrade2", "e"),
                bindKey("upgrade3", "t"),
                bindKey("upgradeDestroy", "r"),
                bindKey("upgradeBarracksToggle", "f")
            ];
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
            if (upgradePanelOpenBeforeAction && upgradeHotkeys.includes(key)) {
                this.handleUpgradeKeyPress(key);
                return;
            }
            const isTabKey = event.key === "Tab";
            const activeElement = document.activeElement;
            const activeTag = activeElement?.tagName?.toLowerCase?.() || "";
            const isFormFocused = Boolean(
                activeElement &&
                (activeTag === "input" || activeTag === "textarea" || activeTag === "select" || activeElement.isContentEditable)
            );
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
            if (key === keyToggleMap || isTabKey) {
                if (this.core.uiManager.isChatInputFocused || gameplayInputBlocked || isFormFocused) {
                    return;
                }
                if (isTabKey) {
                    // Keep Tab from moving browser focus while playing.
                    event.preventDefault();
                }
                // Toggle actions should only fire once per key press.
                if (event.repeat) {
                    return;
                }
                // Toggle map overview (zoomed out) for better visualization
                if (typeof this.core.toggleMapView === "function") {
                    this.core.toggleMapView();
                } else {
                    this.core.miniMap.toggleFullScreen();
                }
            }
            if(event.key == 'g'){
                if (this.core.uiManager.isChatInputFocused || gameplayInputBlocked) {
                    return
                }
                this.core.unitManager.selectAllUnits();
            }
            if (key === keyToggleGroupTroops) {
                if (this.core.uiManager.isChatInputFocused || gameplayInputBlocked) {
                    return;
                }
                this.core.uiManager?.DOM?.game?.unitControls?.groupUnitsButton?.click?.();
            }
            if (key === keySelectArmy) {
                if (this.core.uiManager.isChatInputFocused || gameplayInputBlocked) {
                    return;
                }
                this.core.unitManager.selectArmyCombatUnits();
            }
            if (key === keySelectSoldiersOnly) {
                if (this.core.uiManager.isChatInputFocused || gameplayInputBlocked) return;
                this.core.unitManager.selectOnlySoldiers();
            }
            if (key === keySelectTanksOnly) {
                if (this.core.uiManager.isChatInputFocused || gameplayInputBlocked) return;
                this.core.unitManager.selectOnlyTanks();
            }
            if (key === keySelectSiegeOnly) {
                if (this.core.uiManager.isChatInputFocused || gameplayInputBlocked) return;
                this.core.unitManager.selectOnlySiege();
            }
            if (key === keySelectAll) {
                if (this.core.uiManager.isChatInputFocused || gameplayInputBlocked) {
                    return;
                }
                this.core.unitManager.selectAllUnits();
            }
            if (key === keySelectCommander) {
                if (this.core.uiManager.isChatInputFocused || gameplayInputBlocked) {
                    return;
                }
                if (event.repeat) return;
                this.core.unitManager.selectCommanderOrBuy();
            }
            if (this.core.buildingManager?.handleDefenseHotkeyDown) {
                this.core.buildingManager.handleDefenseHotkeyDown(key);
            }
        });

        document.addEventListener("keyup", (event) => {
            this.activeKeys.delete(event.key.toLowerCase()); // Remove key from active keys
            if (event.key === "Shift") {
                this.shiftPressed = false;
            }
            if (this.core.buildingManager?.handleDefenseHotkeyUp) {
                this.core.buildingManager.handleDefenseHotkeyUp(event.key.toLowerCase());
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
            return;
        }
        if (this.core.uiManager.isChatInputFocused) {
            return;
        }
        const ui = this.core.uiManager;
        const bindKey = (action, fallback) => String(ui?.getHudKeybind?.(action, fallback) || fallback).toLowerCase();
        const keyUpgrade1 = bindKey("upgrade1", "q");
        const keyUpgrade2 = bindKey("upgrade2", "e");
        const keyUpgrade3 = bindKey("upgrade3", "t");
        const keyUpgradeDestroy = bindKey("upgradeDestroy", "r");
        const keyUpgradeBarracks = bindKey("upgradeBarracksToggle", "f");

        const upgradeListElement = this.core.uiManager.DOM.game.upgrades.list; // Get the upgrade list element

        // Check if the upgrade list element exists
        if (upgradeListElement) {
            const upgradeItems = upgradeListElement.querySelectorAll('.upgrade-item'); // Get all upgrade items

            if (key === keyUpgrade1 && upgradeItems.length > 0) {
                // If 'Q' is pressed, click the first upgrade item
                upgradeItems[0].click();
            } else if (key === keyUpgrade2 && upgradeItems.length > 1) {
                // If 'E' is pressed, click the second upgrade item
                upgradeItems[1].click();
            } else if (key === keyUpgrade3 && upgradeItems.length > 2) {
                // If 'T' is pressed, click the third upgrade item
                upgradeItems[2].click();
            } else if (key === keyUpgradeDestroy) {
                // If 'R' is pressed, click the destroy button
                const upgradeDestroyButton = this.core.uiManager.DOM.game.upgrades.destroyButton;
                if (upgradeDestroyButton) {
                    upgradeDestroyButton.click(); // Simulate a click on the destroy button
                }
            } else if (key === keyUpgradeBarracks) {
                // If 'F' is pressed, simulate a click on the barracks activation tab
                const barracksTab = document.querySelector('[data-type="barracks-activation-toggle"]');
                if (barracksTab) {
                    barracksTab.click();
                }
            }
        }
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

        // Handle other actions like resetting camera position
        if (this.activeKeys.has(' ') && this.core.gameManager.player) {
            const playerPosition = this.core.gameManager.player.position;
            this.core.camera.setPosition(playerPosition);
            this.core.buildingManager.updateBuildingPosition();
        }
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
