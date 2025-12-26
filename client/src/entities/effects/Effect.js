import Renderable from "../../components/Renderable.js";

export default class Effect extends Renderable {
    constructor(position, lifespan) {
        super();
        this.position = position;
        this.initialLifespan = lifespan;
        this.lifespan = lifespan; // Remaining lifespan in seconds
    }

    update(deltaTime) {
        // Decrease lifespan
        this.lifespan -= deltaTime / 1000;
        return this.lifespan <= 0; // Return true if the effect has expired
    }

    render(context, camera) {
        context.save(); // Save the current state of the context
        // Common rendering logic can go here if applicable
        context.restore(); // Restore the context
    }
}
