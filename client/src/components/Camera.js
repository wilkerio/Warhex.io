export default class Camera {
    constructor (x = 0, y = 0, zoom = 1.5, maxRadius = 4500) {
        this.x = x; // Initial X position
        this.y = y; // Initial Y position
        this.targetPosition = { x: x, y: y };
        this.zoom = zoom; // Initial zoom level
        this.targetZoom = 0.75; // Target zoom level
        this.zoomStep = 0.1; // Zoom step sizes
        this.minZoom = 0.5; // Minimum zoom level
        this.maxZoom = 1.5; // Maximum zoom level
        this.cameraSpeed = 3; // Camera movement speed
        this.maxRadius = maxRadius; // Maximum distance from the center
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

        // Clamp camera position to circular boundary
        const distanceToCenter = Math.sqrt(this.x * this.x + this.y * this.y);
        if (distanceToCenter > this.maxRadius) {
            const angle = Math.atan2(this.y, this.x);
            this.x = Math.cos(angle) * this.maxRadius;
            this.y = Math.sin(angle) * this.maxRadius;
        }
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