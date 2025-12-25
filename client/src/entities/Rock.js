import Renderable from "../components/Renderable.js";
import Shapes from "../components/Shapes.js";

export default class Rock extends Renderable {
    constructor(position, size, rotation) {
        super();
        this.position = position;
        this.size = size;     
        this.rotation = rotation;  

        this.mainRockEdgePoints = Shapes.getHexagonPoints(this.size);
        this.topRockEdgePoints = Shapes.getHexagonPoints(this.size * 0.6);
    }

    // Rendering
    render(context, camera) {
        // Adjust position based on camera offset
        const x = this.position.x - camera.x;
        const y = this.position.y - camera.y;

        // Save the context state
        context.save();

        // Move to the rock's position and apply rotation
        context.translate(x, y);
        context.rotate(this.rotation);

        // Draw the rock with pre-calculated points
        this.drawRock(context, this.mainRockEdgePoints, "#98a3a8", "#696969");
        this.drawRock(context, this.topRockEdgePoints, "#b4bcbf", "#696969");

        // Restore the context state
        context.restore();
    }

    // Helper method to draw a rock with jagged edges and rocky colors
    drawRock(context, points, fillColor, strokeColor) {
        // Begin the path for the rock
        context.beginPath();

        // Move to the first point
        context.moveTo(points[0].x, points[0].y);

        // Draw lines connecting each of the points
        for (const point of points.slice(1)) {
            context.lineTo(point.x, point.y);
        }

        // Close the path to complete the rock shape
        context.closePath();

        // Fill and stroke the rock
        context.fillStyle = fillColor;
        context.fill();

        context.lineWidth = 3;
        context.strokeStyle = strokeColor;
        context.stroke();
    }
}
