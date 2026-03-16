export default class EventManager {
    constructor (core) {
        this.core = core;
        this.lastMouseEvent = null;
        this.mousePosition = { x: 0, y: 0 };
        this.pointerDownStartedOnCanvas = false;
    }

    init () {
        this.setupEventListeners();
    }

    setupEventListeners () {
        window.addEventListener("wheel", (event) => this.core.handleZoom(event));
        window.addEventListener("mousemove", (event) => {
            this.lastMouseEvent = event;
            this.updateMousePosition(event);
            this.core.inputManager.onMouseMove(event);
        });
        // Add mousedown and mouseup listeners
        window.addEventListener("mousedown", (event) => {
            this.lastMouseEvent = event;
            this.updateMousePosition(event);
            const startedOnCanvas = event.target === this.core.canvas;
            this.pointerDownStartedOnCanvas = startedOnCanvas;
            if (!startedOnCanvas) return;
            this.core.inputManager.onMouseDown(event);
        });
        window.addEventListener("mouseup", (event) => {
            this.lastMouseEvent = event;
            this.updateMousePosition(event);
            const shouldForwardMouseUp = event.target === this.core.canvas || this.pointerDownStartedOnCanvas;
            this.pointerDownStartedOnCanvas = false;
            if (!shouldForwardMouseUp) return;
            this.core.inputManager.onMouseUp(event);
        });
        this.core.canvas.addEventListener("click", (event) => {
            this.lastMouseEvent = event;
            this.updateMousePosition(event);
            this.core.inputManager.onCanvasMouseClick(event);
        });
        this.core.canvas.addEventListener("contextmenu", (event) => {
            this.lastMouseEvent = event;
            this.updateMousePosition(event);
            this.core.inputManager.onCanvasContextMenu(event);
            event.preventDefault();
        });
        // Add visibilitychange listener
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                this.core.inputManager.clearActiveKeys();
                if (typeof this.core?.setGameplayActive === "function") {
                    this.core.setGameplayActive(false);
                }
            } else {
                this.core.networkManager.sendResyncRequest();
                
                // Re-ensure skin is loaded when page becomes visible again
                const player = this.core.gameManager?.player;
                if (player && player.skinID && !player.skin) {
                    console.log('Page visible again, reloading skin...');
                    player.skinLoadAttempts = 0; // Reset attempts
                    player._loadSkin(player.skinID);
                }

                if (!this.core.uiManager?.menuOpen && typeof this.core?.setGameplayActive === "function") {
                    this.core.setGameplayActive(true);
                }
            }
        });
        // Handle window focus loss (when user switches to another app or browser window)
        window.addEventListener("blur", () => {
            this.core.inputManager.clearActiveKeys();
        });
    }

    updateMousePosition (event) {
        const rect = this.core.canvas.getBoundingClientRect();
        const scaleX = this.core.canvas.width / rect.width;
        const scaleY = this.core.canvas.height / rect.height;

        this.mousePosition.x = ((event.clientX - rect.left) * scaleX - this.core.canvas.width / 2) / this.core.camera.zoom + this.core.camera.x * 2;
        this.mousePosition.y = ((event.clientY - rect.top) * scaleY - this.core.canvas.height / 2) / this.core.camera.zoom + this.core.camera.y * 2;
    }
}
