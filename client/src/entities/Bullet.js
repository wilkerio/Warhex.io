import Renderable from "../components/Renderable.js";
import { BulletTypes } from "../network/constants.js";
import Shapes from "../components/Shapes.js";
import ThemeManager from "../components/managers/ThemeManager.js";

export default class Bullet extends Renderable {
    constructor (details, color, position = { x: 0, y: 0 }, id = -1) {
        super();
        this.id = id;
        this.type = details.type;
        this.size = details.size;
        this.targetPosition = { ...position };
        this.position = { ...position };
        this.color = color;
        this.speed = details.speed; // Speed in pixels per second

        // Fading properties
        this.isFadingOut = false;
        this.fadeDuration = 250; // Duration of fade-out in milliseconds
        this.fadeStartTime = 0;
        this.sizeIncrement = 20; // Size increment
        this.alpha = 1; // Full opacity
        this.directionX = 0; // Direction X for movement during fade-out
        this.directionY = 0; // Direction Y for movement during fade-out

        // Initialize points
        this.points = [];
        this.initPoints();

        // Set the rendering function based on the bullet type
        this.renderFunction = this._getRenderFunction(this.type);
    }

    // Initialize the polygon based on the bullet type
    initPoints () {
        switch (this.type) {
            case BulletTypes.BASIC:
                this.points = Shapes.getCirclePoints(this.size, 16); 
                break;
            case BulletTypes.TRAPPER:
                this.points = Shapes.generateSpikePoints(this.size); 
                break;
            default:
                this.points = Shapes.getCirclePoints(this.size, 16); 
        }
    }

    // Method to get the appropriate render function based on the bullet type
    _getRenderFunction (type) {
        switch (type) {
            case BulletTypes.BASIC:
                return this._renderBasicBullet.bind(this);
            case BulletTypes.TRAPPER:
                return this._renderTrapperBullet.bind(this);
            default:
                return this._renderBasicBullet.bind(this); // Fallback to basic
        }
    }

    setColor (color) {
        this.color = color;
    }

    setTargetPosition (targetPosition) {
        // Calculate initial direction when target position is set
        const dx = targetPosition.x - this.position.x;
        const dy = targetPosition.y - this.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 0 && this.type !== BulletTypes.TRAPPER) {
            this.directionX = dx / distance;
            this.directionY = dy / distance;
        }

        // Update the target position
        this.targetPosition = { ...targetPosition };
    }

    update (deltaTime) {
        if (this.isFadingOut) {
            const elapsed = Date.now() - this.fadeStartTime;
            this.alpha = 1 - (elapsed / this.fadeDuration);

            if (elapsed >= this.fadeDuration) {
                this.alpha = 0;
                return true; // Mark for removal
            } else {
                const dx = this.targetPosition.x - this.position.x;
                const dy = this.targetPosition.y - this.position.y;
                const distance = Math.hypot(dx, dy);
                const maxStep = this.speed * 0.5 * (deltaTime / 1000);

                if (distance > 0) {
                    if (distance <= maxStep) {
                        this.position.x = this.targetPosition.x;
                        this.position.y = this.targetPosition.y;
                    } else {
                        const invDistance = 1 / distance;
                        this.position.x += dx * invDistance * maxStep;
                        this.position.y += dy * invDistance * maxStep;
                    }
                }

                this.size += deltaTime / 1000 * this.sizeIncrement;  
            }
        } else {
            const dx = this.targetPosition.x - this.position.x;
            const dy = this.targetPosition.y - this.position.y;
            const distance = Math.hypot(dx, dy);
            const maxStep = this.speed * (deltaTime / 1000);

            if (distance > 0) {
                if (distance <= maxStep) {
                    this.position.x = this.targetPosition.x;
                    this.position.y = this.targetPosition.y;
                } else {
                    const invDistance = 1 / distance;
                    this.position.x += dx * invDistance * maxStep;
                    this.position.y += dy * invDistance * maxStep;
                }
            }
        }

        return false; // Unit not marked for removal
    }

    markForRemoval () {
        if (!this.isFadingOut) {
            this.isFadingOut = true;
            this.fadeStartTime = Date.now();
        }
    }

    render (context, camera) {
        const screenX = this.position.x - camera.x;
        const screenY = this.position.y - camera.y;

        // Call the assigned render function
        this.renderFunction(context, screenX, screenY);
    }

    _renderBasicBullet (context, screenX, screenY) {
        context.save();
        context.translate(screenX, screenY);
        context.globalAlpha = this.alpha; 
        this._drawPolygon(context, this.points, this.color);
        context.globalAlpha = 1.0;
        context.restore();
    }

    _renderTrapperBullet (context, screenX, screenY) {
        context.save();
        context.translate(screenX, screenY);
        context.globalAlpha = this.alpha; 
        this._drawPolygon(context, this.points, this.color);
        context.globalAlpha = 1.0;
        context.restore();
    }

    _drawPolygon (context, points, fillColor) {
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            context.lineTo(points[i].x, points[i].y);
        }
        context.closePath();
        context.fillStyle = fillColor;
        context.fill();
        this._strokeShape(context, fillColor);
    }

    _strokeShape (context, color) {
        context.strokeStyle = ThemeManager.currentThemeProperties.darkColor || "#666666";
        context.lineWidth = 3;
        context.stroke();
    }
}
