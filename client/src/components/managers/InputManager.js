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

        this.registerMouseDownHandler((mousePosition) => this.createSelectionCircle(mousePosition));
        this.registerMouseUpHandler((mousePosition) => this.removeSelectionCircle(mousePosition));
        this.registerMouseMoveHandler((mousePosition) => this.updateSelectionCircle(mousePosition));

        this.initializeKeyListeners();
    }

    initializeKeyListeners () {
        document.addEventListener("keydown", (event) => {
            this.activeKeys.add(event.key.toLowerCase()); // Add key to active keys
            if (event.key === "Shift") {
                this.shiftPressed = true;
            }

            // Handle number keys
            if (event.key >= '1' && event.key <= '9') {
                this.handleNumberKeyPress(parseInt(event.key, 10));
            }

            this.handleUpgradeKeyPress(event.key.toLowerCase());
            if (event.key == 'm') {
                if (this.core.uiManager.isChatInputFocused) {
                    return
                }
                this.core.miniMap.toggleFullScreen();
            }
            if(event.key == 'g'){
                if (this.core.uiManager.isChatInputFocused) {
                    return
                }
                this.core.unitManager.selectAllUnits();
            }
        });

        document.addEventListener("keyup", (event) => {
            this.activeKeys.delete(event.key.toLowerCase()); // Remove key from active keys
            if (event.key === "Shift") {
                this.shiftPressed = false;
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
    createSelectionCircle (mousePosition) {
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
            const centerX = this.selectionCircle.position.x + this.selectionCircle.width / 2;
            const centerY = this.selectionCircle.position.y + this.selectionCircle.height / 2;

            const width = Math.abs(this.selectionCircle.width);
            const height = Math.abs(this.selectionCircle.height);
            const diameter = Math.sqrt(width * width + height * height);

            context.strokeStyle = ThemeManager.currentThemeProperties.selectionStroke;
            context.fillStyle = ThemeManager.currentThemeProperties.selectionColor;
            context.lineWidth = 2;
            context.beginPath();
            context.arc(centerX, centerY, diameter / 2, 0, 2 * Math.PI);
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
        this.invokeRightClickHandlers(this.core.eventManager.mousePosition);
    }

    onCanvasMouseClick (event) {
        this.invokeLeftClickHandlers(this.core.eventManager.mousePosition);
    }

    onMouseDown (event) {
        this.invokeMouseDownHandlers(this.core.eventManager.mousePosition, event.button);
    }

    onMouseMove (event) {
        this.invokeMouseMoveHandlers(this.core.eventManager.mousePosition);
    }

    onMouseUp (event) {
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

        const upgradeListElement = this.core.uiManager.DOM.game.upgrades.list; // Get the upgrade list element

        // Check if the upgrade list element exists
        if (upgradeListElement) {
            const upgradeItems = upgradeListElement.querySelectorAll('.upgrade-item'); // Get all upgrade items

            if (key === 'q' && upgradeItems.length > 0) {
                // If 'Q' is pressed, click the first upgrade item
                upgradeItems[0].click();
            } else if (key === 'e' && upgradeItems.length > 1) {
                // If 'E' is pressed, click the second upgrade item
                upgradeItems[1].click();
            } else if (key === 't' && upgradeItems.length > 2) {
                // If 'T' is pressed, click the third upgrade item
                upgradeItems[2].click();
            } else if (key === 'r') {
                // If 'R' is pressed, click the destroy button
                const upgradeDestroyButton = this.core.uiManager.DOM.game.upgrades.destroyButton;
                if (upgradeDestroyButton) {
                    upgradeDestroyButton.click(); // Simulate a click on the destroy button
                }
            } else if (key === 'f') {
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
