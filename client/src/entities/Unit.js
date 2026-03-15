import ThemeManager from "../components/managers/ThemeManager.js";
import Renderable from "../components/Renderable.js";
import { BuildingSizes, UnitTypes, getUnitDetails } from "../network/constants.js";

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
        this.targetPosition = { ...targetPosition };
    }

    setTargetPoint (targetPoint) {
        const dx = targetPoint.x - this.position.x;
        const dy = targetPoint.y - this.position.y;
        this.rotation = Math.atan2(dy, dx);
    }

    setRotation (rotation) {
        this.rotation = rotation;
    }

    setUpgrade (unitVariant) {
        this.variant = unitVariant;
        this.details = getUnitDetails(this.type, unitVariant);
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
            const dx = this.targetPosition.x - this.position.x;
            const dy = this.targetPosition.y - this.position.y;
            const distance = Math.hypot(dx, dy);

            if (distance > 0) {
                const unitSpeed = Number(this.details?.speed || 180);
                const maxStep = unitSpeed * (deltaTime / 1000);

                if (distance <= maxStep) {
                    this.position.x = this.targetPosition.x;
                    this.position.y = this.targetPosition.y;
                } else {
                    const invDistance = 1 / distance;
                    this.position.x += dx * invDistance * maxStep;
                    this.position.y += dy * invDistance * maxStep;
                }
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
            this.renderRangeIndicator(context, worldPosition);
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

    renderRangeIndicator (context, worldPosition) {
        const range = Number(this?.bulletDetails?.range || 0);
        if (!Number.isFinite(range) || range <= 0) return;

        const lineWidth = 5;

        context.save();
        context.beginPath();
        context.arc(worldPosition.x, worldPosition.y, Math.max(0, range - lineWidth / 2), 0, Math.PI * 2);
        context.strokeStyle = ThemeManager.currentThemeProperties.selectionColor;
        context.globalAlpha = 0.45;
        context.lineWidth = lineWidth;
        context.stroke();
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
