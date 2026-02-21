import { darkenColor } from "../network/constants.js";

export default class MiniMap {
    constructor(core) {
        this.core = core; // Store the core reference
        this.players = [];
        this.container = document.getElementById("minimap-container");

        if (!this.container) {
            console.error("MiniMap not found!");
            return;
        }

        // Create a new static canvas element
        this.staticCanvas = document.createElement("canvas");
        this.staticCanvas.width = 150;
        this.staticCanvas.height = 150;
        this.container.appendChild(this.staticCanvas);

        // Create a new dynamic canvas element
        this.dynamicCanvas = document.createElement("canvas");
        this.dynamicCanvas.width = 150;
        this.dynamicCanvas.height = 150;
        this.container.appendChild(this.dynamicCanvas);

        // Get the 2D rendering contexts
        this.staticContext = this.staticCanvas.getContext("2d");
        this.dynamicContext = this.dynamicCanvas.getContext("2d");

        // Position the dynamic canvas on top of the static canvas using CSS
        this.dynamicCanvas.style.position = "absolute";
        this.dynamicCanvas.style.top = "0";
        this.dynamicCanvas.style.left = "0";

        this.renderStatic(); // Call the render method when initializing
        this.initEventListeners(); 
        this.toggleFullScreen = this.toggleFullScreen.bind(this);
        this.isFullScreen = false;
        this.entityScale = 0.45; // Keep minimap objects visually compact
        this.baseScale = 0.30; // Bases should be smaller than other minimap objects
    }

    initEventListeners() {
        this.dynamicCanvas.addEventListener('click', this.handleCanvasClick.bind(this));
    }

    handleCanvasClick(event) {
        // Get the bounding rectangle of the canvas
        const rect = this.dynamicCanvas.getBoundingClientRect();

        // Calculate the click position relative to the canvas
        const x = event.clientX - rect.left; // X coordinate
        const y = event.clientY - rect.top;  // Y coordinate

        // Convert click position to world coordinates using current map size
        const scale = this.dynamicCanvas.width / this.getMapSize();
        const mapX = (x - this.dynamicCanvas.width / 2) / scale;
        const mapY = (y - this.dynamicCanvas.height / 2) / scale;

        this.core.camera.setPosition({x: mapX, y: mapY}, false);
    }

    getMapSize() {
        return this.core.renderer?.getMapSize?.() || 2400;
    }

    reset(){
        this.minimize();
    }

    toggleFullScreen() {
        if (this.isFullScreen) {
            this.minimize(); // Minimize to original size
         
        } else {
            this.maximize(); // Maximize to fullscreen
        }
    }

    maximize() {
        this.isFullScreen = true;
        // Set the new size for the canvases
        this.staticCanvas.width = this.dynamicCanvas.width = 150; 
        this.staticCanvas.height = this.dynamicCanvas.height = 150;

        this.container.style.top = "50%";
        this.container.style.left = "50%";
        this.container.style.transform = "translate(-50%, -50%)";
        this.container.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
        this.renderDynamic();
        this.renderStatic();
    }

    minimize() {
        this.isFullScreen = false;

        // Set the original size for the canvases
        this.staticCanvas.width = this.dynamicCanvas.width = 150; // Original width
        this.staticCanvas.height = this.dynamicCanvas.height = 150; // Original height

        this.container.style.bottom = "170px";
        this.container.style.left = "8px";
        this.container.style.width = "auto";
        this.container.style.height = "auto";
        this.container.style.zIndex = ""; // Reset z-index if necessary
        this.container.style.transform = "translate(0, 0)";
        this.container.style.backgroundColor = "rgba(0, 0, 0, 0.0)";

        this.renderDynamic();
        this.renderStatic();
    }

    // Method to update players
    update() {
        this.players = this.core.gameManager.players;
        this.neutrals = this.core.gameManager.neutrals;
        this.bushes = this.core.gameManager.bushes;
        this.rocks = this.core.gameManager.rocks;
        this.renderStatic(); // Call the render method when updating players
    }

    // Method to render the static content of the minimap
    renderStatic() {
        const clientPlayer = this.core.gameManager.player;
        if (!clientPlayer || !this.players || !this.neutrals || !this.bushes) return;

        // Clear the static canvas before rendering
        this.staticContext.clearRect(0, 0, this.staticCanvas.width, this.staticCanvas.height);

        // Save the current context state
        this.staticContext.save();

        // Scale down the context for rendering
        const scale = this.staticCanvas.width / this.getMapSize();
        this.staticContext.translate(this.staticCanvas.width / 2, this.staticCanvas.height / 2);
        this.staticContext.scale(scale, scale); // Apply scaling

        const drawBase = (x, y, color, radius, hasSpawnProtection = false, spawnProtectionRadius = 0, drawRings = true) => {
            const scaledRadius = radius * this.baseScale;
            this.staticContext.beginPath();
            // Adjust player position based on the center
            this.staticContext.arc(x, y, scaledRadius, 0, Math.PI * 2);
            this.staticContext.fillStyle = color;
            this.staticContext.fill();
            this.staticContext.strokeStyle = darkenColor(color, 30);
            this.staticContext.lineWidth = 36;
            this.staticContext.stroke();
            this.staticContext.closePath();

            if (drawRings) {
                const drawDashedRing = (ringRadius, strokeStyle, lineWidth, dashLength, gapLength) => {
                    this.staticContext.save();
                    this.staticContext.beginPath();
                    this.staticContext.arc(x, y, ringRadius, 0, Math.PI * 2);
                    this.staticContext.strokeStyle = strokeStyle;
                    this.staticContext.lineWidth = lineWidth;
                    this.staticContext.lineCap = "round";
                    this.staticContext.setLineDash([dashLength, gapLength]);
                    this.staticContext.stroke();
                    this.staticContext.closePath();
                    this.staticContext.restore();
                };

                // White dashed building radius ring
                drawDashedRing(radius * this.baseScale, "rgba(255,255,255,0.92)", 14, 80, 70);

                // Green dashed spawn-protection ring
                if (hasSpawnProtection && spawnProtectionRadius > 0) {
                    drawDashedRing(spawnProtectionRadius * this.baseScale, "rgba(57,255,20,0.9)", 10, 65, 60);
                }
            }
        };

        this.players.forEach(p => {
            drawBase(
                p.position.x,
                p.position.y,
                p.color,
                p.buildingRadius.max,
                p.hasSpawnProtection,
                p.spawnProtectionRadius
            );
        });

        this.neutrals.forEach(n => {
            drawBase(n.position.x, n.position.y, n.color, n.buildingRadius.max);
        });

        this.bushes.forEach(b => {
            drawBase(b.position.x, b.position.y, "#7aaf4c", b.size * 1.2, false, 0, false);
        });

        this.rocks.forEach(r => {
            drawBase(r.position.x, r.position.y, "#98a3a8", r.size * 1.3, false, 0, false);
        });


        // Draw the client player as a circle
        drawBase(
            clientPlayer.position.x,
            clientPlayer.position.y,
            clientPlayer.color,
            clientPlayer.buildingRadius.max,
            clientPlayer.hasSpawnProtection,
            clientPlayer.spawnProtectionRadius
        );

        // Restore the context to its original state
        this.staticContext.restore();
    }

    // Method to render the dynamic content of the minimap
    renderDynamic() {
        const clientPlayer = this.core.gameManager.player;
        if (!clientPlayer) return;
        this.dynamicContext.lineJoin = "round";
        this.dynamicContext.lineCap = "round";
        // Clear the dynamic canvas before rendering
        this.dynamicContext.clearRect(0, 0, this.dynamicCanvas.width, this.dynamicCanvas.height);

        // Save the current context state
        this.dynamicContext.save();

        // Scale down the context for rendering
        const scale = this.dynamicCanvas.width / this.getMapSize();
        this.dynamicContext.translate(this.dynamicCanvas.width / 2, this.dynamicCanvas.height / 2);
        this.dynamicContext.scale(scale, scale); // Apply scaling

        // Calculate the rectangle dimensions based on camera zoom
        const cameraPosition = this.core.camera.getPosition();
        const cameraWidth = Math.min(this.getMapSize(), (this.core.canvas.width / this.core.camera.zoom) * 2);
        const cameraHeight = Math.min(this.getMapSize(), (this.core.canvas.height / this.core.camera.zoom) * 2);

        const drawUnit = (x, y, color, size, rotation) => {
            const scaledSize = size * this.entityScale;
            this.dynamicContext.save(); // Save the current context state

            // Move to the unit's position
            this.dynamicContext.translate(x, y); // Translate to unit's position
            this.dynamicContext.rotate(rotation); // Rotate based on the unit's rotation

            this.dynamicContext.beginPath();
            // Draw a triangle centered at (0, 0) after translation and rotation
            this.dynamicContext.moveTo(0, -scaledSize); // Top vertex
            this.dynamicContext.lineTo(-scaledSize, scaledSize); // Bottom left vertex
            this.dynamicContext.lineTo(scaledSize, scaledSize); // Bottom right vertex
            this.dynamicContext.closePath();

            this.dynamicContext.fillStyle = color;
            this.dynamicContext.fill();
            this.dynamicContext.strokeStyle = darkenColor(color, 30); // Outline color
            this.dynamicContext.lineWidth = 20; // Outline thickness
            this.dynamicContext.stroke();

            this.dynamicContext.restore(); // Restore to the original state
        };

        // Draw each unit as a triangle, using its rotation for all players
        this.players.forEach(player => {
            player.units.forEach(unit => drawUnit(unit.position.x, unit.position.y, player.color, 150, unit.rotation + Math.PI / 2));
        });

        // Draw client player's units
        clientPlayer.units.forEach(unit => drawUnit(unit.position.x, unit.position.y, clientPlayer.color, 150, unit.rotation + Math.PI / 2));

        // Draw the camera rectangle
        this.drawCamera(cameraPosition.x, cameraPosition.y, cameraWidth, cameraHeight, clientPlayer.color);

        // Restore the context to its original state
        this.dynamicContext.restore();
    }

    // Helper method to draw the camera rectangle
    drawCamera(x, y, width, height, color) {
        const scale = this.dynamicCanvas.width / this.getMapSize();
        this.dynamicContext.strokeStyle = darkenColor(color, 20);
        this.dynamicContext.lineWidth = 1.5 / scale; // thinner camera frame
        this.dynamicContext.strokeRect(x - width / 2, y - height / 2, width, height); // Draw the rectangle
    }
}
