export default class Polygon {
  constructor(vertices, center = { x: 0, y: 0 }, rotation = 0) {
    this.vertices = vertices; // Array of {x, y} objects representing the local vertices of the polygon
    this.center = center; // Center position of the polygon
    this.setRotation(rotation);
  }

  setCenter(center) {
    this.center = center;
  }

  setRotation(angle) {
    this.rotation = angle;
  }

  getGlobalVertices() {
    const { x: centerX, y: centerY } = this.center;
    const globalVertices = [];

    // Apply rotation and center translation to each local vertex
    for (const vertex of this.vertices) {
      const { x, y } = vertex;
      // Apply rotation
      const rotatedX = x * Math.cos(this.rotation) - y * Math.sin(this.rotation);
      const rotatedY = x * Math.sin(this.rotation) + y * Math.cos(this.rotation);
      // Apply center translation
      const globalX = rotatedX + centerX;
      const globalY = rotatedY + centerY;
      globalVertices.push({ x: globalX, y: globalY });
    }

    return globalVertices;
  }

  // Check if two polygons intersect using the Separating Axis Theorem (SAT)
  static doPolygonsIntersect(polygon1, polygon2) {
    const SAT_EPSILON = 0.0001;
    const polygons = [polygon1, polygon2];

    for (const polygon of polygons) {
      const globalVertices = polygon.getGlobalVertices();

      for (let i1 = 0; i1 < globalVertices.length; i1++) {
        // Grab 2 vertices to create an edge
        const i2 = (i1 + 1) % globalVertices.length;
        const p1 = globalVertices[i1];
        const p2 = globalVertices[i2];

        // Find the line perpendicular to this edge
        const normal = { x: p2.y - p1.y, y: p1.x - p2.x };
        const axisLength = Math.hypot(normal.x, normal.y);
        if (axisLength === 0) continue;
        const axis = {
          x: normal.x / axisLength,
          y: normal.y / axisLength
        };

        // Project all vertices of both polygons onto the normal
        const [minA, maxA] = this.projectPolygon(axis, polygon1);
        const [minB, maxB] = this.projectPolygon(axis, polygon2);

        // Keep a tiny epsilon so near-touching edges are treated conservatively.
        if (maxA < (minB - SAT_EPSILON) || maxB < (minA - SAT_EPSILON)) {
          return false;
        }
      }
    }
    return true;
  }

  // Project all vertices of a polygon onto a line and return the min and max projection values
  static projectPolygon(normal, polygon) {
    const globalVertices = polygon.getGlobalVertices();
    let min = null;
    let max = null;

    for (const vertex of globalVertices) {
      const projected = normal.x * vertex.x + normal.y * vertex.y; // Fixed indexing to use {x, y}
      if (min === null || projected < min) {
        min = projected;
      }
      if (max === null || projected > max) {
        max = projected;
      }
    }

    return [min, max];
  }
}
