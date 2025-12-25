import Effect from "./Effect.js";

export default class Particle extends Effect {
    constructor(position, explosionAngle, color, lifespan) {
        super(position, lifespan);
        this.explosionAngle = explosionAngle; // Angle in radians
        this.color = color;
        this.size = 6;
        this.numTriangles = 3;
        this.rotationSpeed = 0.5;

        // Initialize triangles with random initial positions and velocities
        this.triangles = [];
        for (let i = 0; i < this.numTriangles; i++) {
            const randomRadius = Math.random() * this.size;
            const randomAngle = this.explosionAngle + (Math.random() - 0.5) * Math.PI / 4;
            const initialPosX = this.position.x + randomRadius * Math.cos(randomAngle);
            const initialPosY = this.position.y + randomRadius * Math.sin(randomAngle);

            const velocityMagnitude = Math.random() * 180;
            const velocityAngle = randomAngle + Math.PI;
            const velocityX = velocityMagnitude * Math.cos(velocityAngle);
            const velocityY = velocityMagnitude * Math.sin(velocityAngle);

            const triangle = {
                position: { x: initialPosX, y: initialPosY },
                velocity: { x: velocityX, y: velocityY },
                rotation: Math.random() * Math.PI * 2,
                size: this.size,
                opacity: 1
            };
            this.triangles.push(triangle);
        }
    }

    update(deltaTime) {
        const expired = super.update(deltaTime); // Call base update to manage lifespan

        this.triangles.forEach(triangle => {
            triangle.position.x += triangle.velocity.x * deltaTime / 1000;
            triangle.position.y += triangle.velocity.y * deltaTime / 1000;
            triangle.rotation += this.rotationSpeed * deltaTime / 1000;

            // Update opacity and size
            triangle.opacity = this.lifespan / this.initialLifespan;
            const maxTriangleSize = this.size * 1.5;
            triangle.size = this.size + (maxTriangleSize - this.size) * (1 - this.lifespan / this.initialLifespan);
        });

        return expired; // Return if the particle has expired
    }

    render(context, camera) {
        super.render(context, camera); // Call base render
        this.triangles.forEach(triangle => {
            const worldPosition = {
                x: triangle.position.x - camera.x,
                y: triangle.position.y - camera.y
            };

            const trianglePoints = [];
            for (let i = 0; i < 3; i++) {
                const angle = triangle.rotation + (Math.PI * 2 / 3) * i;
                const x = worldPosition.x + triangle.size * Math.cos(angle);
                const y = worldPosition.y + triangle.size * Math.sin(angle);
                trianglePoints.push({ x, y });
            }

            context.globalAlpha = triangle.opacity;

            context.beginPath();
            context.moveTo(trianglePoints[0].x, trianglePoints[0].y);
            for (let i = 1; i < 3; i++) {
                context.lineTo(trianglePoints[i].x, trianglePoints[i].y);
            }
            context.closePath();

            context.fillStyle = this.color;
            context.fill();

            context.strokeStyle = "#666666";
            context.lineWidth = 4;
            context.stroke();
        });

        context.globalAlpha = 1;
    }
}
