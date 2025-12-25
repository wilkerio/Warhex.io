import { darkenColor } from "../../network/constants.js";
import Effect from "./Effect.js";
export default class Explosion extends Effect {
    constructor (position, color, radius, lifespan) {
        super(position, lifespan);
        this.size = 6; // Starting size of the explosion
        this.maxSize = radius; // End size of the explosion
        this.color = color;
        this.darkenColor = darkenColor(color, 30);
    }

    update (deltaTime) {
        const expired = super.update(deltaTime); // Call base update to manage lifespan

        // Calculate the size based on remaining lifespan
        const sizeFactor = 1 - (this.lifespan / this.initialLifespan);
        this.size = this.size + (this.maxSize - this.size) * sizeFactor;

        return expired; // Return if the explosion has expired
    }

    render (context, camera) {
        const worldPosition = {
            x: this.position.x - camera.x,
            y: this.position.y - camera.y
        };
        
        // Set global alpha based on remaining lifespan
        context.globalAlpha = 0.85 * (this.lifespan / this.initialLifespan);

        // Create a radial gradient
        const gradient = context.createRadialGradient(worldPosition.x, worldPosition.y, 0, worldPosition.x, worldPosition.y, this.size);
        gradient.addColorStop(.8, this.color); // Center color
        gradient.addColorStop(1, this.darkenColor); // Edge color

        // Set the fill style to the gradient
        context.fillStyle = gradient;

        // Draw the circle
        context.beginPath();
        context.arc(worldPosition.x, worldPosition.y, this.size, 0, Math.PI * 2);
        context.closePath();
        context.fill();

        // Restore global alpha to avoid affecting other drawings
        context.globalAlpha = 1.0; // Reset global alpha
    }

}
