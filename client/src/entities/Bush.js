import Renderable from "../components/Renderable.js";

export default class Bush extends Renderable {
    constructor(position) {
        super();
        this.position = position;

        // Calculate a random size based on position
        this.size = this.calculateSize();

        // Calculate a random rotation based on position
        this.rotation = this.calculateRotation();

        // Pre-calculate jagged edge points for both bushes
        this.mainBushPoints = this.generateJaggedEdgePoints(this.size);
        this.topBushPoints = this.generateJaggedEdgePoints(this.size * 0.6); // Smaller bush
    }

    // Method to calculate size based on position (introduce randomness)
    calculateSize() {
        const seed = this.position.x + this.position.y;
        return 60 + (Math.abs(seed) % 40); // Size range from 60 to 100
    }

    // Method to calculate random rotation based on position
    calculateRotation() {
        const seed = this.position.x * this.position.y;
        return (seed % 360) * (Math.PI / 180); // Convert degrees to radians
    }

    // Rendering
    render(context, camera) {
        // Adjust position based on camera offset
        const x = this.position.x - camera.x;
        const y = this.position.y - camera.y;

        // Save the context state
        context.save();

        // Move to the bush's position and apply rotation
        context.translate(x, y);
        context.rotate(this.rotation);

        // Draw both bushes using pre-calculated points
        this.drawBushWithJaggedEdges(context, this.mainBushPoints, "#4caf50", "#666666"); // Bottom bush
        this.drawBushWithJaggedEdges(context, this.topBushPoints, "#7aaf4c", "#666666"); // Top bush

        // Restore the context state
        context.restore();
    }

    // Helper method to draw a bush with jagged edges and custom colors
    drawBushWithJaggedEdges(context, points, fillColor, strokeColor) {
        // Begin the path for the bush
        context.beginPath();

        // Move to the first point
        context.moveTo(points[0].x, points[0].y);

        // Draw lines connecting each of the points
        for (const point of points.slice(1)) {
            context.lineTo(point.x, point.y);
        }

        // Close the path to complete the bush shape
        context.closePath();

        // Fill and stroke the bush
        context.fillStyle = fillColor;
        context.fill();

        context.lineWidth = 4;
        context.strokeStyle = strokeColor;
        context.stroke();
    }

    // Generate jagged edge points
    generateJaggedEdgePoints(size) {
        const points = [];
        const numEdges = 16;
        const angleStep = Math.PI / (numEdges / 2); // Pre-compute angle step

        for (let i = 0; i < numEdges; i++) {
            const spikeLength = (i % 2 === 0) ? size : size * 0.8; // Alternate between long and short spikes
            const angle = angleStep * i; // Calculate angle for each point

            // Calculate the x and y positions for each point
            points.push({
                x: spikeLength * Math.cos(angle),
                y: spikeLength * Math.sin(angle),
            });
        }

        return points;
    }
}
