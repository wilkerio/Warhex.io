import Renderable from "./Renderable.js";
import Player from "../entities/Player.js";
import Effect from "../entities/effects/Effect.js";
import ThemeManager from "./managers/ThemeManager.js";

export const QueueType = {
    STATIC: 0,
    PLAYER: 1,
    EFFECT: 2,
    OVERLAY: 3,
}

export class Renderer {
    constructor (canvas, context, camera, core) {
        this.canvas = canvas;
        this.context = context;
        this.camera = camera;
        this.core = core;
        this.grid = {
            spacing: 40,
            lineWidth: 1
        };
        this.mapSize = 19000;

        this.queues = {
            static: [],
            player: [],
            effect: [],
            overlay: []
        };

        this.connectionLines = []; // Store players connection lines

        this.frameCount = 0;
        this.lastFPSUpdateTime = performance.now();

        // Flags and variables to track camera state
        this.cameraMoved = true;
        this.cameraZoomChanged = true;
        this.lastCameraPosition = this.camera.getPosition();
        this.lastCameraZoom = this.camera.getZoom();
    }

    clearQueues () {
        this.queues.static = [];
        this.queues.player = [];
        this.queues.effect = [];
        this.queues.overlay = [];
    }

    clearCanvas () {
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }


    addToQueue (renderable, queueType = QueueType.STATIC) {
        if (!(renderable instanceof Renderable)) {
            console.warn("Object must implement the Renderable interface");
        }

        switch (queueType) {
            case QueueType.PLAYER:
                if (renderable instanceof Player) {
                    this.queues.player.push(renderable);
                    this.updatePlayerConnections();
                    this._updateVisiblePlayers();
                }
                break;
            case QueueType.EFFECT:
                if (renderable instanceof Effect) {
                    this.queues.effect.push(renderable);
                }
                break;
            case QueueType.OVERLAY:
                this.queues.overlay.push(renderable);
                break;
            default:
                this.queues.static.push(renderable);
                break;
        }
    }

    removeFromQueue (renderable, queueType = QueueType.STATIC) {
        if (!(renderable instanceof Renderable)) {
            console.warn("Object must implement the Renderable interface");
        }

        switch (queueType) {
            case QueueType.PLAYER:
                if (renderable instanceof Player) {
                    const index = this.queues.player.indexOf(renderable);
                    if (index > -1) {
                        this.queues.player.splice(index, 1);
                    }
                    this.updatePlayerConnections();
                    this._updateVisiblePlayers();
                }
                break;
            case QueueType.EFFECT:
                if (renderable instanceof Effect) {
                    const index = this.queues.effect.indexOf(renderable);
                    if (index > -1) {
                        this.queues.effect.splice(index, 1);
                    }
                }
                break;
            case QueueType.OVERLAY:
                const index = this.queues.overlay.indexOf(renderable);
                if (index > -1) {
                    this.queues.overlay.splice(index, 1);
                }
                break;
            default:
                console.error(`Invalid queue type: ${queueType}`);
                break;
        }
    }

    static calculateGridBounds (mapSize, spacing) {
        const mapWidth = mapSize * 2;
        const mapHeight = mapSize * 2;
        const startX = Math.floor(-mapWidth / 2 / spacing) * spacing;
        const startY = Math.floor(-mapHeight / 2 / spacing) * spacing;
        const endX = Math.ceil(mapWidth / 2 / spacing) * spacing;
        const endY = Math.ceil(mapHeight / 2 / spacing) * spacing;
        return { startX, startY, endX, endY };
    }

    // Helper method to check if a point is within the viewable area
    isInView (renderable, offset = 0, cameraBounds) {
        const { camera } = this;  // Accessing the camera from the renderer
        const { x, y } = renderable.getWorldPosition(camera);  // Get the world position of the renderable

        // Update the bounds coordinates based on the camera's bounds with the offset applied
        const cameraLeft = cameraBounds.left - offset;
        const cameraRight = cameraBounds.right + offset;
        const cameraTop = cameraBounds.top - offset;
        const cameraBottom = cameraBounds.bottom + offset;

        // Check if the renderable's position is within the camera's bounds
        return x >= cameraLeft && x <= cameraRight && y >= cameraTop && y <= cameraBottom;
    }

    renderBackground () {
        const showGrid = localStorage.getItem('showGrid') !== 'false'; // Default true
        if (!showGrid) return;

        const { context, grid, camera, mapSize } = this;
        const { spacing, lineWidth } = grid;

        context.save();
        context.strokeStyle = ThemeManager.currentThemeProperties.lineColor;;
        context.lineWidth = lineWidth;

        // Translate context to the camera's position
        context.translate(-camera.x, -camera.y);

        // Calculate the visible area based on the camera's position and zoom
        const cameraWidth = context.canvas.width / camera.zoom;
        const cameraHeight = context.canvas.height / camera.zoom;

        // Calculate the camera bounds
        const cameraBounds = {
            left: camera.x * 2 - cameraWidth / 2,
            right: camera.x * 2 + cameraWidth / 2,
            top: camera.y * 2 - cameraHeight / 2,
            bottom: camera.y * 2 + cameraHeight / 2,
        };

        // Calculate the visible grid lines based on camera bounds
        const startX = Math.max(Math.floor(cameraBounds.left / spacing) * spacing, -mapSize);
        const endX = Math.min(Math.ceil(cameraBounds.right / spacing) * spacing, mapSize);
        const startY = Math.max(Math.floor(cameraBounds.top / spacing) * spacing, -mapSize);
        const endY = Math.min(Math.ceil(cameraBounds.bottom / spacing) * spacing, mapSize);

        context.beginPath();

        // Draw vertical grid lines within the camera's view
        for (let x = startX; x <= endX; x += spacing) {
            context.moveTo(x, startY);
            context.lineTo(x, endY);
        }

        // Draw horizontal grid lines within the camera's view
        for (let y = startY; y <= endY; y += spacing) {
            context.moveTo(startX, y);
            context.lineTo(endX, y);
        }

        context.stroke();
        context.restore();
    }

    renderBorder () {
        const { context, camera } = this;

        // Save the current transformation matrix
        context.save();

        // Apply camera transformations
        context.translate(-camera.x, -camera.y);

        // Define the clipping path for the outer circle
        const circleX = 0; // Center of the canvas
        const circleY = 0; // Center of the canvas
        const circleRadius = this.mapSize * 2;
        context.beginPath();
        context.arc(circleX, circleY, circleRadius / 2, 0, Math.PI * 2);
        context.closePath(); // Close the path to ensure a complete shape
        context.clip(); // Set the clipping region

        // Draw the outer dark transparent circle
        context.globalAlpha = 0.1; // Set transparency level
        context.fillStyle = 'rgba(0, 0, 0, 0.7)'; // Dark color with transparency
        context.beginPath();
        context.arc(circleX, circleY, circleRadius, 0, Math.PI * 2);
        context.fill();

        // Define the clipping path for the inner circle
        const innerCircleRadius = this.mapSize / 2; // Adjust as needed
        context.beginPath();
        context.arc(circleX, circleY, innerCircleRadius, 0, Math.PI * 2);
        context.closePath(); // Close the path to ensure a complete shape
        context.clip(); // Set the clipping region

        // Clear the inner circle area
        context.clearRect(circleX - innerCircleRadius, circleY - innerCircleRadius, innerCircleRadius * 2, innerCircleRadius * 2);

        // Restore the previous transformation matrix
        context.restore();
    }

    updatePlayerConnections () {
        const connectionRadius = 4000; // Define the radius for connections
        this.connectionLines = []; // Clear previous connections

        // Iterate through the players to calculate connection lines
        for (let i = 0; i < this.queues.player.length; i++) {
            const playerA = this.queues.player[i];
            const posA = playerA.getWorldPosition(this.camera); // Get the world position of player A

            for (let j = i + 1; j < this.queues.player.length; j++) {
                const playerB = this.queues.player[j];
                const posB = playerB.getWorldPosition(this.camera); // Get the world position of player B

                // Calculate the distance between player A and player B
                const dist = Math.sqrt((posA.x - posB.x) ** 2 + (posA.y - posB.y) ** 2);

                // Store line positions if conditions are met
                if (dist <= connectionRadius && !playerB.hasSpawnProtection && !playerA.hasSpawnProtection) {
                    this.connectionLines.push({ from: playerA, to: playerB });
                }
            }
        }
    }

    _renderPlayerConnections (camera) {
        const { context } = this;

        // Save the current state
        context.save();

        context.strokeStyle = ThemeManager.currentThemeProperties.lineColor;
        context.lineWidth = 6; // Set the line width
        context.setLineDash([30, 30]); // Set the line dash pattern for dotted lines

        // Draw each stored connection line
        for (const x of this.connectionLines) {
            context.beginPath();
            const playerA = x.from;
            const playerB = x.to;
            const posA = playerA.getWorldPosition(this.camera);
            const posB = playerB.getWorldPosition(this.camera);
            context.moveTo(posA.x, posA.y);
            context.lineTo(posB.x, posB.y);
            context.stroke();
        }

        context.setLineDash([]); // Reset the line dash pattern
        context.save(); // Save the current context state
        context.globalCompositeOperation = "destination-out"; // Set composite operation to erase

        for (let i = 0; i < this.visiblePlayers.length; i++) {
            const player = this.visiblePlayers[i];
            const pos = player.getWorldPosition(this.camera); // Get the world position of the player
            const radius = player.buildingRadius.max; // Get the building radius for the player

            // Draw a circular area to clear
            context.beginPath(); // Start a new path
            context.arc(pos.x, pos.y, radius, 0, Math.PI * 2); // Create a circular path
            context.closePath(); // Close the path
            context.fill(); // Fill the circular area, effectively erasing it
        }

        context.globalCompositeOperation = "source-over"; // Reset composite operation to default
        context.restore();
        // Restore the previous state
        context.restore();
    }

    _updateVisiblePlayers () {
        const cameraBounds = this.camera.getBounds(this.canvas); // Precompute bounds
        // Filter visible players and update their visibility status
        this.visiblePlayers = this.queues.player.filter(player => {
            const isVisible = this.isInView(player, player.spawnProtectionRadius, cameraBounds);
            player.isVisible = isVisible;
            return isVisible;
        });
    }

    _renderQueues(context, camera, deltaTime) {
        if (this.cameraMoved || this.cameraZoomChanged) {
            this._updateVisiblePlayers();
            this.cameraMoved = false; // Reset the flag after checking visibility
            this.cameraZoomChanged = false; // Reset zoom change flag

            const position = {
                x: camera.x * 2,
                y: camera.y * 2
            }

            //! needs to be async...
            // this.core.networkManager.sendCameraUpdate(position, camera.getZoom());
        }
        this.queues.static.forEach(renderable => renderable.render(context, camera, deltaTime));

        const spawningUnitsUnder = [];
        const spawningUnitsOver = [];
        const unitsUnder = [];
        const unitsOver = [];

        for (const player of this.queues.player) {
            for (const unit of player.spawningUnits) {
                let isUnder = false;
                for (const p of this.visiblePlayers) {
                    if (p.isUnitInsideCore(unit)) {
                        isUnder = true;
                        break;
                    }
                }
                if (isUnder) {
                    spawningUnitsUnder.push(unit);
                } else {
                    spawningUnitsOver.push(unit);
                }
            }

            for (const unit of player.units) {
                let isUnder = false;
                for (const p of this.visiblePlayers) {
                    if (p.isUnitInsideCore(unit)) {
                        isUnder = true;
                        break;
                    }
                }
                if (isUnder) {
                    unitsUnder.push(unit);
                } else {
                    unitsOver.push(unit);
                }
            }
        }

        spawningUnitsOver.forEach(unit => unit.render(context, camera, deltaTime));
        unitsOver.forEach(unit => unit.render(context, camera, deltaTime));

        for (const player of this.visiblePlayers) {
            player.render(this.context, this.camera, deltaTime);
        }

        context.save();
        context.globalCompositeOperation = 'destination-over';

        spawningUnitsUnder.forEach(unit => unit.render(context, camera, deltaTime));
        unitsUnder.forEach(unit => unit.render(context, camera, deltaTime));

        context.restore();


        for (const player of this.visiblePlayers) {
            player.renderBullets(this.context, this.camera, deltaTime);
        }

        for (const player of this.queues.player) {
            player.renderUnitBullets(this.context, this.camera, deltaTime)
        }

        this.updateEffects(deltaTime); // Update effects and remove expired ones
        for (const effect of this.queues.effect) {
            effect.render(this.context, this.camera, deltaTime);
        }

        for (const renderable of this.queues.overlay) {
            renderable.render(this.context, this.camera, deltaTime);
        }
    }


    render (deltaTime) {
        this.clearCanvas();
        this.context.save();

        // Apply camera transformations
        this.context.translate(this.canvas.width / 2, this.canvas.height / 2);
        this.context.scale(this.camera.zoom, this.camera.zoom);
        this.context.translate(-this.camera.x, -this.camera.y);

        this.renderBorder();
        this._renderPlayerConnections();
        this.renderBackground();
        this.context.lineJoin = "round";
        this.context.lineCap = "round";
        this._renderQueues(this.context, this.camera, deltaTime);

        this.context.restore();

        // Render camera, and own units on miniMap
        this.core.miniMap.renderDynamic();

        this.updateFPS();

        // Update camera movement and zoom flags
        const currentCameraPosition = this.camera.getPosition();
        const currentCameraZoom = this.camera.getTargetZoom();

        const tolerance = 10;

        if (Math.abs(currentCameraPosition.x - this.lastCameraPosition.x) > tolerance ||
            Math.abs(currentCameraPosition.y - this.lastCameraPosition.y) > tolerance) {
            this.cameraMoved = true;
            this.lastCameraPosition = currentCameraPosition;
        }
        if (currentCameraZoom !== this.lastCameraZoom) {
            this.cameraZoomChanged = true;
            this.lastCameraZoom = currentCameraZoom;
        }
    }

    updateEffects (deltaTime) {
        this.queues.effect = this.queues.effect.filter(effect => !effect.update(deltaTime));
    }

    updateFPS () {
        this.frameCount++;
        const now = performance.now();
        const elapsed = now - this.lastFPSUpdateTime;

        if (elapsed >= 3000) { // 3 seconds
            this.core.gameManager.metrics.fps = ((this.frameCount / elapsed) * 1000).toFixed(0);
            this.frameCount = 0;
            this.lastFPSUpdateTime = now;
            this.core.uiManager.updateMetrics();
        }
    }
}