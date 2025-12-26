export const Shapes = {
    // Generate points for a circle
    getCirclePoints: function (radius, numPoints = 16) {
        const points = [];
        const angleStep = (Math.PI * 2) / numPoints;

        for (let i = 0; i < numPoints; i++) {
            const angle = angleStep * i;
            points.push({
                x: radius * Math.cos(angle),
                y: radius * Math.sin(angle),
            });
        }

        return points;
    },

    // Generate points for a triangle
    getTrianglePoints: function (size) {
        const points = [];
        const angleStep = (Math.PI * 2) / 3;

        for (let i = 0; i < 3; i++) {
            const angle = angleStep * i;
            points.push({
                x: size * Math.cos(angle),
                y: size * Math.sin(angle),
            });
        }

        return points;
    },

    // Generate points for a pentagon
    getPentagonPoints: function (size) {
        const points = [];
        const numSides = 5;
        const angleStep = (Math.PI * 2) / numSides;

        for (let i = 0; i < numSides; i++) {
            const angle = angleStep * i;
            points.push({
                x: size * Math.cos(angle),
                y: size * Math.sin(angle),
            });
        }

        return points;
    },

    // Generate points for a hexagon
    getHexagonPoints: function (size) {
        const points = [];
        const numSides = 6;
        const angleStep = (Math.PI * 2) / numSides;

        for (let i = 0; i < numSides; i++) {
            const angle = angleStep * i;
            points.push({
                x: size * Math.cos(angle),
                y: size * Math.sin(angle),
            });
        }

        return points;
    },

    // Generate points for an octagon
    getOctagonPoints: function (size) {
        const points = [];
        const numSides = 8; // Number of sides for an octagon
        const angleStep = (Math.PI * 2) / numSides;

        for (let i = 0; i < numSides; i++) {
            const angle = angleStep * i;
            points.push({
                x: size * Math.cos(angle),
                y: size * Math.sin(angle),
            });
        }

        return points;
    },

      // Generate points for an octagon
      getPolygonPoints: function (size, numSides) {
        const points = [];
        const angleStep = (Math.PI * 2) / numSides;

        for (let i = 0; i < numSides; i++) {
            const angle = angleStep * i;
            points.push({
                x: size * Math.cos(angle),
                y: size * Math.sin(angle),
            });
        }

        return points;
    },

    // Generate points for a rectangle
    getRectanglePoints: function (width, height) {
        return [
            { x: -width / 2, y: -height / 2 }, // Top-left
            { x: width / 2, y: -height / 2 },  // Top-right
            { x: width / 2, y: height / 2 },   // Bottom-right
            { x: -width / 2, y: height / 2 },  // Bottom-left
        ];
    },

    // Generate points with spikes
    generateSpikePoints: function (size, numEdges = 16, angleToTarget = 0) {
        const points = [];
        const angleStep = (Math.PI / (numEdges / 2)); // Calculate angle step
    
        for (let i = 0; i < numEdges; i++) {
            const spikeLength = (i % 2 === 0) ? size : size * 0.8; // Alternate between long and short spikes
            const angle = angleStep * i + angleToTarget; // Calculate angle for each point
            points.push({
                x: spikeLength * Math.cos(angle), // Position based on spike length and angle
                y: spikeLength * Math.sin(angle),
            });
        }
    
        return points;
    }
    
};

export default Shapes;
