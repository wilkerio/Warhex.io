import ThemeManager from "../components/managers/ThemeManager.js";
import Renderable from "../components/Renderable.js";
import { BuildingSizes, UnitTypes } from "../network/constants.js";

export default class Unit extends Renderable {
    constructor (id, type, color, details, position, variant = 0, health, maxHealth) {
        super();
        this.id = id;
        this.type = type;
        this.details = details;
        this.color = color;
        this.size = details.size;
        this.position = { ...position };
        this.targetPosition = { ...position };
        this.barrackPosition = { ...position };
        this.rotation = 0;
        this.variant = variant; // Store the current upgrade
        this.isSelected = false;
        this.health = health;
        this.maxHealth = maxHealth;

        // Fading properties
        this.isFadingOut = false;
        this.fadeDuration = 250; // Duration of fade-out in milliseconds
        this.fadeStartTime = 0;
        this.sizeIncrement = 20; // Size increment
        this.alpha = 1; // Full opacity
    }

    // Getters and Setters
    setColor (color) {
        this.color = color;
    }
    setHealth (health) {
        this.health = health;
    }

    setTargetPosition (targetPosition) {
        this.targetPosition = targetPosition;
    }

    setTargetPoint (targetPoint) {
        const dx = targetPoint.x - this.position.x;
        const dy = targetPoint.y - this.position.y;
        this.rotation = Math.atan2(dy, dx);
    }

    setRotation (rotation) {
        this.rotation = rotation;
    }

    setUpgrade (buildingVariant) {
        this.variant = buildingVariant;
        this.details = getBuildingDetails(this.type, variant);
    }

    hasReachedTarget (tolerance = 1) {
        const dx = this.position.x - this.targetPosition.x;
        const dy = this.position.y - this.targetPosition.y;
        return Math.sqrt(dx * dx + dy * dy) <= tolerance;
    }

    hasLeftBarracks () {
        // Calculate the distance between the unit's position and the barrack's position
        const dx = this.position.x - this.barrackPosition.x;
        const dy = this.position.y - this.barrackPosition.y;
        const distanceFromBarrack = Math.sqrt(dx * dx + dy * dy);
        // Check if the distance is greater than the barrack's size (radius)
        return distanceFromBarrack > BuildingSizes.BARRACKS.size;
    }

    update (deltaTime) {
        if (this.isFadingOut) {
            const elapsed = Date.now() - this.fadeStartTime;
            this.alpha = 1 - (elapsed / this.fadeDuration);

            if (elapsed >= this.fadeDuration) {
                this.alpha = 0;
                return true; // Mark for removal
            } else {
                this.size += (deltaTime / 1000) * this.sizeIncrement;
            }
        } else {
            // Define LERP function (Linear Interpolation)
            const lerp = (start, end, t) => start + (end - start) * t;

            // Calculate the smooth interpolation ratio
            const maxSpeed = 0.05;  // Max speed ratio for interpolation (feel free to adjust)
            const interpolationRatio = Math.min(maxSpeed, deltaTime / 100); // Adjust ratio by deltaTime for frame-rate independence

            // Update position using LERP with dynamic interpolation
            this.position.x = lerp(this.position.x, this.targetPosition.x, interpolationRatio);
            this.position.y = lerp(this.position.y, this.targetPosition.y, interpolationRatio);

            // Snap to target position if very close
            const epsilon = 0.1; // Threshold for snapping
            if (Math.abs(this.targetPosition.x - this.position.x) < epsilon &&
                Math.abs(this.targetPosition.y - this.position.y) < epsilon) {
                this.position.x = this.targetPosition.x;
                this.position.y = this.targetPosition.y;
            }

            return false; // Unit not marked for removal
        }

        return false; // Unit not marked for removal
    }

    markForRemoval () {
        if (!this.isFadingOut) {
            this.isFadingOut = true;
            this.fadeStartTime = Date.now();
        }
    }

    // Rendering
    render (context, camera, worldPosition) {
        if (this.isSelected) {
            this.renderShadow(context, worldPosition);
        }
        context.globalAlpha = this.alpha;

        // Add health bar rendering here
        if (this.type === UnitTypes.COMMANDER || this.health < this.maxHealth) { // Only show if not full health
            const healthBarWidth = this.size * 1.5;
            const healthBarHeight = 5;
            const x = worldPosition.x - healthBarWidth / 2;
            const y = worldPosition.y - this.size - 10;

            // Background of the health bar
            context.fillStyle = '#333';
            context.fillRect(x, y, healthBarWidth, healthBarHeight);

            // Foreground of the health bar
            const healthPercentage = this.health / this.maxHealth;
            let healthBarColor = 'green';
            if (healthPercentage < 0.6) {
                healthBarColor = 'yellow';
            }
            if (healthPercentage < 0.3) {
                healthBarColor = 'red';
            }
            context.fillStyle = healthBarColor;
            context.fillRect(x, y, healthBarWidth * healthPercentage, healthBarHeight);
        }
    }

    // When selected
    renderShadow (context, worldPosition) {
        // Adjust shadow size as needed
        const shadowSize = this.size * 1.5;

        // Save the current drawing state
        context.save();


        context.fillStyle = ThemeManager.currentThemeProperties.selectionColor;

        // Draw circular shadow
        context.beginPath();
        context.arc(worldPosition.x, worldPosition.y, shadowSize, 0, Math.PI * 2);
        context.fill();

        // Restore the previous drawing state
        context.restore();
    }


    // Utility Methods
    getWorldPosition (camera) {
        return {
            x: this.position.x - camera.x,
            y: this.position.y - camera.y
        };
    }

}
