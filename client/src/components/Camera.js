export default class Camera {
    constructor (x = 0, y = 0, zoom = 1.5, maxRadius = 4500) {
        this.x = x; // Initial X position
        this.y = y; // Initial Y position
        this.targetPosition = { x: x, y: y };
        this.zoom = zoom; // Initial zoom level
        this.targetZoom = zoom; // Target zoom level
        this.zoomStep = 0.1; // Zoom step sizes (used for keyboard shortcuts)
        this.minZoom = 0.02; // Minimum zoom level (very far out)
        this.maxZoom = 50; // Maximum zoom level (very far in)
        this.cameraSpeed = 3; // Camera movement speed
        this.mapHalfSize = maxRadius; // Half the map size (square boundary)
        this.controlsEnabled = false; // Flag to enable/disable camera control
    }

    // Method to move the camera
    move (dx, dy) {
        if (!this.controlsEnabled) return; // Check if controls are enabled

        // Calculate movement speed based on zoom level
        const movementSpeed = this.cameraSpeed / this.zoom;

        // Move the camera
        this.x += dx * movementSpeed;
        this.y += dy * movementSpeed;
        this.targetPosition = {
            x: this.x,
            y: this.y
        }

        // Clamp camera position to square boundary
        this.x = Math.max(-this.mapHalfSize, Math.min(this.mapHalfSize, this.x));
        this.y = Math.max(-this.mapHalfSize, Math.min(this.mapHalfSize, this.y));
    }


    // Method to set the camera position
    setPosition (position, smoothTransition = false) {
        if (!this.controlsEnabled) return; // Check if controls are enabled
        this.targetPosition.x = position.x / 2;
        this.targetPosition.y = position.y / 2;
        if (!smoothTransition) {
            this.x = position.x / 2;
            this.y = position.y / 2;

        }
    }

    getPosition () {
        return { x: this.x * 2, y: this.y * 2 };
    }


    getZoom () {
        return this.zoom;
    }

    getTargetZoom(){
        return this.targetZoom;
    }

    // Method to set the camera zoom level
    setZoom (zoom) {
        if (!this.controlsEnabled) return; // Check if controls are enabled
        this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    }

    // Method to zoom in
    zoomIn () {
        if (!this.controlsEnabled) return; // Check if controls are enabled
        this.targetZoom = Math.min(this.maxZoom, this.targetZoom + this.zoomStep);
    }

    // Method to zoom out
    zoomOut () {
        if (!this.controlsEnabled) return; // Check if controls are enabled
        this.targetZoom = Math.max(this.minZoom, this.targetZoom - this.zoomStep);
    }

    // Adjust zoom by a multiplicative factor while keeping a world point stable on screen
    adjustZoomWithFocus (factor, screenToWorldFunc, clientX, clientY, canvas) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const sX = (clientX - rect.left) * scaleX - canvas.width / 2;
        const sY = (clientY - rect.top) * scaleY - canvas.height / 2;

        const worldBeforeX = screenToWorldFunc(clientX, clientY).x;
        const worldBeforeY = screenToWorldFunc(clientX, clientY).y;

        const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));

        // Compute new camera center so that worldBefore stays under the same screen point
        const newCamX = (worldBeforeX - sX / newZoom) / 2;
        const newCamY = (worldBeforeY - sY / newZoom) / 2;

        this.targetZoom = newZoom;
        this.targetPosition.x = newCamX;
        this.targetPosition.y = newCamY;
    }

    // Method to update the camera (e.g., for easing)
    update (deltaTime) {
        const zoomSnapThreshold = 0.0005; // Define the threshold for snapping to targetZoom
        const easeFactor = 0.05; // Adjust this value for desired easing effect

        if (Math.abs(this.zoom - this.targetZoom) > zoomSnapThreshold) {
            // Calculate the new zoom level based on easing
            this.zoom += (this.targetZoom - this.zoom) * easeFactor * deltaTime / 10;

            // Ensure the zoom level stays within bounds
            this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom));
        } else {
            // Snap to targetZoom if close enough
            this.zoom = this.targetZoom;
        }

        if (this.x !== this.targetPosition.x || this.y !== this.targetPosition.y) {
            this.x += (this.targetPosition.x - this.x) * easeFactor;
            this.y += (this.targetPosition.y - this.y) * easeFactor;
        }
    }

    getBounds (canvas) {
        const zoomedWidth = canvas.width / this.zoom;
        const zoomedHeight = canvas.height / this.zoom;

        return {
            left: this.x - (zoomedWidth / 2),
            right: this.x + (zoomedWidth / 2),
            top: this.y - (zoomedHeight / 2),
            bottom: this.y + (zoomedHeight / 2),
        };
    }

    enableControls (enabled) {
        this.controlsEnabled = enabled;
    }
}