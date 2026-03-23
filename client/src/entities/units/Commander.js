import Shapes from "../../components/Shapes.js";
import { UnitDetails, UnitTypes, UnitVariantTypes, darkenColor, getUnitBulletDetails, getUnitDetails } from "../../network/constants.js";
import Unit from "../Unit.js";

export default class Commander extends Unit {
    constructor (color, position = { x: 0, y: 0 }, variant = 0, id = -1, health = 1170, maxHealth = 1170) {
        const details = getUnitDetails(UnitTypes.COMMANDER, variant);

        super(id, UnitTypes.COMMANDER, color, details, position, variant, health, maxHealth);

        this.flameAnimationTime = 0; // Time tracker for flame animation

        this.recoil = 0; // Initial recoil state
        this.maxRecoil = 8; // Maximum recoil distance
        this.recoilDecay = 0.05; // Speed of recoil decay
        this.cannonRotationOffset = Math.PI / 2;
        this.cannonAngleToTarget = this.cannonRotationOffset;

        // Timestamp for last cannon target update
        this.targetUpdateThreshold = 2100; // Time threshold in milliseconds
        this.lastCannonTargetUpdate = this.targetUpdateThreshold;

        this.points = Shapes.generateSpikePoints(this.size, 12);

        this._updateBulletDetails();
        // Spawn facing down by default.
        this.rotation = Math.PI / 2;
    }

    _updateBulletDetails () {
        this.bulletDetails = getUnitBulletDetails(UnitTypes.COMMANDER, this.variant);
    }

    triggerRecoil () {
        this.recoil = this.maxRecoil;
    }

    setCannonTargetPoint (targetPoint) {
        if (!targetPoint || !Number.isFinite(targetPoint.x) || !Number.isFinite(targetPoint.y)) return;
        const originX = Number.isFinite(this.position?.x) ? this.position.x : this.targetPosition.x;
        const originY = Number.isFinite(this.position?.y) ? this.position.y : this.targetPosition.y;

        // Calculate the vector from the current commander position to the target point.
        const dx = targetPoint.x - originX;
        const dy = targetPoint.y - originY;
        if (Math.hypot(dx, dy) <= 0.001) return;

        // Scale the vector to make the target point further away
        const scaleFactor = 2;
        const extendedTargetPoint = {
            x: originX + dx * scaleFactor,
            y: originY + dy * scaleFactor
        };

        // Update cannon rotation to point to the extended target point
        this.cannonAngleToTarget = Math.atan2(
            extendedTargetPoint.y - originY,
            extendedTargetPoint.x - originX
        ) + this.cannonRotationOffset;

        // Reset the cannon target update timer
        this.lastCannonTargetUpdate = 0;
    }


    update (deltaTime) {
        if (this.lastCannonTargetUpdate < this.targetUpdateThreshold) {
            // Increment the elapsed time for the cannon target update
            this.lastCannonTargetUpdate += deltaTime
        }

        if (this.recoil > 0) {
            this.recoil -= this.recoilDecay * deltaTime;
            if (this.recoil < 0) {
                this.recoil = 0;
            }
        }
        return super.update(deltaTime);
    }

    renderCannonBarrel (context, deltaTime) {
        if (this.lastCannonTargetUpdate < this.targetUpdateThreshold) {
            // Rotate the context so the final orientation equals the absolute target angle
            context.rotate(this.cannonAngleToTarget - this.rotation);
        } else {
            // Keep idle cannon aligned with commander body orientation.
            context.rotate(this.cannonRotationOffset);
        }
        const recoilOffset = this.recoil;
        const cannonWidth = this.size * 0.6;
        const cannonLength = this.size * 0.9;

        // Draw the rectangle (cannon) with recoil effect
        context.fillStyle = "#a8a8a8"; // Color of the cannon
        context.fillRect(-cannonWidth / 2, recoilOffset - cannonLength - this.size * 0.2, cannonWidth, cannonLength);

        // Draw a border around the cannon
        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.strokeRect(-cannonWidth / 2, recoilOffset - cannonLength - this.size * 0.2, cannonWidth, cannonLength);


        // Draw the smaller circle in the middle
        context.beginPath();
        context.arc(0, 0, this.size * 0.5, 0, Math.PI * 2);
        context.closePath();
        context.fillStyle = "#a8a8a8"; // Color of the smaller circle
        context.fill();
        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.stroke();
    }

    render (context, camera, deltaTime) {
        const worldPosition = this.getWorldPosition(camera);

        // Save the context state
        context.save();

        super.render(context, camera, worldPosition);

        // Translate and rotate context for the tank
        context.translate(worldPosition.x, worldPosition.y);
        context.rotate(this.rotation);

        // Draw body
        context.beginPath();
        context.moveTo(this.points.x, this.points.y);
        this.points.forEach(point => context.lineTo(point.x, point.y));
        context.closePath();

        context.fillStyle = this.color;
        context.fill();

        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.stroke();

        this.renderCannonBarrel(context, deltaTime);

        // Restore the context state
        context.restore();
    }

}
