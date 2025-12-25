export default class EventManager {
    constructor (core) {
        this.core = core;
        this.lastMouseEvent = null;
        this.mousePosition = { x: 0, y: 0 };
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
        window.addEventListener("mousedown", (event) => this.core.inputManager.onMouseDown(event));
        window.addEventListener("mouseup", (event) => this.core.inputManager.onMouseUp(event));
        this.core.canvas.addEventListener("click", (event) => this.core.inputManager.onCanvasMouseClick(event));
        this.core.canvas.addEventListener("contextmenu", (event) => {
            this.core.inputManager.onCanvasContextMenu(event);
            event.preventDefault();
        });
        // Add visibilitychange listener
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                this.core.inputManager.clearActiveKeys();
            } else {
                this.core.networkManager.sendResyncRequest();
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
