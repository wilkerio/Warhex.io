import ThemeManager from "../components/managers/ThemeManager.js";
import Renderable from "../components/Renderable.js";
import { SelectionState } from "./Building.js";
import Polygon from "./Polygon.js"

export default class BuildingPreview extends Renderable {
    constructor (building) {
        super();
        this.building = building;
        this.building.initPolygon();
        this.buildable = true; // Default state

    }

    _getDistance (x1, y1, x2, y2) {
        return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    }

    checkCollision (buildings, units) {
        this.buildable = true; // Assume it's buildable initially
        let polygonTransformed = false;
        const selfSize = Number(this.building?.size) || 0;

        // Loop through each building
        for (const otherBuilding of buildings) {
            if (!otherBuilding || otherBuilding.removeFlag) {
                continue;
            }
            if (otherBuilding !== this.building) { // Make sure not to check collision with itself
                if (!otherBuilding.polygon && typeof otherBuilding.initPolygon === "function") {
                    otherBuilding.initPolygon();
                }
                if (!otherBuilding.polygon) {
                    continue;
                }
                if (typeof otherBuilding.updatePolygonTransform === "function") {
                    otherBuilding.updatePolygonTransform();
                }

                // Calculate the distance between the centers of the buildings
                const distance = this._getDistance(
                    this.building.position.x, this.building.position.y,
                    otherBuilding.position.x, otherBuilding.position.y
                );

                // Set a dynamic threshold using both sizes to avoid missing rotated overlaps.
                const otherSize = Number(otherBuilding.size) || 0;
                const minimumDistance = Math.max(40, selfSize + otherSize + 6);

                if (distance > minimumDistance) {
                    continue; // Skip further checks if the buildings are too far apart
                }

                if (!polygonTransformed) {
                    this.building.updatePolygonTransform()
                    polygonTransformed = true;
                }

                if (Polygon.doPolygonsIntersect(this.building.polygon, otherBuilding.polygon)) {
                    this.buildable = false;
                    break; // No need to check further if a collision is found
                }
            }
        }
    }


    render (context, camera, deltaTime) {
        // Save the current drawing state
        context.save();

        // Define fill style based on buildable status
        const color = this.buildable ? ThemeManager.currentThemeProperties.selectionColor : "#ff00004d";
        
        // Translate canvas coordinates based on camera position
        const translatedX = this.building.position.x - camera.x;
        const translatedY = this.building.position.y - camera.y;

        context.translate(translatedX, translatedY);
        this.building.renderSelection(context, this.building.details.range, color, true)

        // Restore the previous drawing state
        context.restore();
    }
}

