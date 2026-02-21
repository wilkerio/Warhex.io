import Building from "../Building.js";
import { BuildingDetails, BuildingVariantTypes, BuildingTypes, getBuildingDetails } from '../../network/constants.js';
import Polygon from "../Polygon.js";
import Shapes from "../../components/Shapes.js";
import ThemeManager from "../../components/managers/ThemeManager.js";

export default class Barracks extends Building {
    constructor (color, position = { x: 0, y: 0 }, variant = 0, id = -1) {
        const details = BuildingDetails.BARRACKS.BASIC;
        super(id, BuildingTypes.BARRACKS, color, details, position, variant);
        this.rotationOffset = Math.PI;
        this.setUpgrade(variant);
        this._updateAngleToTarget();

        this.points = [];
        this.points[0] = Shapes.getRectanglePoints(this.size, this.size);

        this.activated = true; // Tracks if the barracks are active for troop production
    }

    activateProduction (isActive) {
        this.activated = isActive; // Set activated state based on the input boolean
    }

    initPolygon () {
        this.polygon = new Polygon(this.points[0], this.position);
        this.updatePolygonRotation();
    }

    setUpgrade (buildingVariant) {
        this.variant = buildingVariant;
        this.details = getBuildingDetails(this.type, buildingVariant);
        const variantMap = {
            [BuildingVariantTypes.BARRACKS.BASIC]: this.renderBarracks,
            [BuildingVariantTypes.BARRACKS.GREATER_BARRACKS]: this.renderGreaterBarracks,
            [BuildingVariantTypes.BARRACKS.TANK_FACTORY]: this.renderTankFactory,
            [BuildingVariantTypes.BARRACKS.HEAVY_TANK_FACTORY]: this.renderHeavyTankFactory,
            [BuildingVariantTypes.BARRACKS.BOOSTER_TANK_FACTORY]: this.renderBoosterTankFactory,
            [BuildingVariantTypes.BARRACKS.BOOSTER_CANNON_TANK_FACTORY]: this.renderBoosterCannonTankFactory,
            [BuildingVariantTypes.BARRACKS.CANNON_TANK_FACTORY]: this.renderCannonTankFactory,
            [BuildingVariantTypes.BARRACKS.SIEGE_TANK_FACTORY]: this.renderSiegeFactory,
            [BuildingVariantTypes.BARRACKS.HEAVY_BOOSTER_TANK_FACTORY]: this.renderHeavyBoosterTankFactory,
            [BuildingVariantTypes.BARRACKS.HEAVY_SIEGE_TANK_FACTORY]: this.renderHeavySiegeFactory,
            [BuildingVariantTypes.BARRACKS.BOOSTER_SIEGE_TANK_FACTORY]: this.renderBoosterSiegeFactory,
            [BuildingVariantTypes.BARRACKS.CANNON_SIEGE_TANK_FACTORY]: this.renderCannonSiegeTankFactory,
            [BuildingVariantTypes.BARRACKS.HEAVY_BOOSTER_SIEGE_TANK_FACTORY]: this.renderHeavyBoosterSiegeFactory,
            [BuildingVariantTypes.BARRACKS.BOOSTER_CANNON_SIEGE_TANK_FACTORY]: this.renderBoosterCannonSiegeFactory,
        };

        this.renderUpgrade = variantMap[buildingVariant] || this.renderBarracks;

        if (!this.renderUpgrade) {
            console.error("UpgradeType not defined!");
        }
    }

    setRallypoint (point) {
        this.rallypoint = point;
    }

    render (context, camera, deltaTime) {
        const worldPosition = this.getWorldPosition(camera);
        context.save();
        context.translate(worldPosition.x, worldPosition.y);
        super.render(context)
        context.rotate(this.angleToTarget);

        if (this.isSelected()) {
            this.renderSelection(context, this.details.range, ThemeManager.currentThemeProperties.selectionColor);
        }

        this.renderUpgrade(context, worldPosition);
        context.restore();
    }

    renderBasic (context) {
        // Square style following the same visual pattern used by other buildings.
        const outerSize = this.size;
        const outerHalf = outerSize / 2;

        // Outer square
        context.fillStyle = this.activated ? this.color : "#8a8a8a";
        context.fillRect(-outerHalf, -outerHalf, outerSize, outerSize);
        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.strokeRect(-outerHalf, -outerHalf, outerSize, outerSize);

        // Inner gray square
        const innerSize = outerSize * 0.5;
        const innerHalf = innerSize / 2;
        context.fillStyle = "#a8a8a8";
        context.fillRect(-innerHalf, -innerHalf, innerSize, innerSize);

        // Inner border
        context.strokeStyle = "#666666";
        context.lineWidth = 2.5;
        context.strokeRect(-innerHalf, -innerHalf, innerSize, innerSize);
    }

    renderBarracks (context) {
        // Basic barracks should use only the clean framed-square design.
        this.renderBasic(context);
    }
    renderGreaterBarracks(context) {
        // Exact pattern from reference:
        // pink square + dark border + two gray bars with dark borders.
        const outerSize = this.size;
        const outerHalf = outerSize / 2;

        // Outer container follows base color
        context.fillStyle = this.activated ? this.color : "#8a8a8a";
        context.fillRect(-outerHalf, -outerHalf, outerSize, outerSize);
        context.strokeStyle = "#666666";
        context.lineWidth = outerSize * 0.1; // 10px for a 200px reference
        context.strokeRect(-outerHalf, -outerHalf, outerSize, outerSize);

        // Inner bars (120x40 over a 200x200 reference)
        const barWidth = outerSize * 0.6;
        const barHeight = outerSize * 0.2;
        const barX = -barWidth / 2;
        const barGap = outerSize * 0.1;
        const topBarY = -(barHeight + barGap / 2);
        const bottomBarY = barGap / 2;

        context.fillStyle = "#a8a8a8";
        context.strokeStyle = "#666666";
        context.lineWidth = outerSize * 0.08; // 8px for a 200px reference

        // Top bar
        context.fillRect(barX, topBarY, barWidth, barHeight);
        context.strokeRect(barX, topBarY, barWidth, barHeight);

        // Bottom bar
        context.fillRect(barX, bottomBarY, barWidth, barHeight);
        context.strokeRect(barX, bottomBarY, barWidth, barHeight);
    }
    
    renderTankFactory (context) {
        // Exact HTML/CSS reference recreation:
        // width/height 200, border 10, padding 15, gap 15, cell border 8 (all scaled).
        const outerSize = this.size;
        const outerHalf = outerSize / 2;

        const scale = outerSize / 200;
        const border = 10 * scale;
        const padding = 15 * scale;
        const gap = 15 * scale;
        const cellBorder = 8 * scale;

        // Outer square follows base color
        context.fillStyle = this.color;
        context.fillRect(-outerHalf, -outerHalf, outerSize, outerSize);

        // Draw border inside the outer square (CSS border-box equivalent)
        context.strokeStyle = "#666666";
        context.lineWidth = border;
        context.strokeRect(
            -outerHalf + border / 2,
            -outerHalf + border / 2,
            outerSize - border,
            outerSize - border
        );

        // Content area after border (like border-box)
        const contentSize = outerSize - border * 2;
        const gridAreaSize = contentSize - padding * 2;
        const cellSize = (gridAreaSize - gap) / 2;
        const startX = -outerHalf + border + padding;
        const startY = -outerHalf + border + padding;

        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 2; col++) {
                const x = startX + col * (cellSize + gap);
                const y = startY + row * (cellSize + gap);

                // Cell border (box-sizing border-box)
                context.fillStyle = "#666666";
                context.fillRect(x, y, cellSize, cellSize);

                // Cell fill
                context.fillStyle = "#a0a0a0";
                context.fillRect(
                    x + cellBorder,
                    y + cellBorder,
                    cellSize - cellBorder * 2,
                    cellSize - cellBorder * 2
                );
            }
        }
    }

    renderHeavyTankFactory (context) {
        this.renderBasic(context);

        context.rotate(this.rotationOffset); // Align with the barracks' rotation
        context.translate(-3, 0);

        context.beginPath();
        const unitSize = 20;
        const outerPoints = [];
        for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i;
            const x = unitSize * Math.cos(angle);
            const y = unitSize * Math.sin(angle);
            outerPoints.push({ x, y });
        }

        context.moveTo(outerPoints[0].x, outerPoints[0].y);
        for (let i = 1; i < outerPoints.length; i++) {
            context.lineTo(outerPoints[i].x, outerPoints[i].y);
        }
        context.closePath();

        context.fillStyle = "#8a8a8a"; // Gray color
        context.fill();
        context.strokeStyle = "#666666"; // Darker outline
        context.lineWidth = 4;
        context.stroke();
    }

    renderBoosterTankFactory (context) {
        this.renderBasic(context);
        context.rotate(this.rotationOffset); // Align with the barracks' rotation

        const unitSize = 20;

        context.save();
        // Translate to the position where the booster should be, behind the tank
        context.translate(-unitSize / 3.5, 0); // Move booster to the back of the tank

        // Draw the booster
        context.fillStyle = "#a4a4a4";
        context.beginPath();
        context.moveTo(-unitSize / 2, -unitSize / 1.6);  // Top left corner
        context.lineTo(unitSize / 10, -unitSize / 2.5);  // Top right corner
        context.lineTo(unitSize / 10, unitSize / 2.5);   // Bottom right corner
        context.lineTo(-unitSize / 2, unitSize / 1.6);   // Bottom left corner
        context.closePath();
        context.fill();

        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.stroke();
        context.restore();

        context.beginPath();
        const outerPoints = [];
        for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i;
            const x = unitSize * Math.cos(angle);
            const y = unitSize * Math.sin(angle);
            outerPoints.push({ x, y });
        }

        context.moveTo(outerPoints[0].x, outerPoints[0].y);
        for (let i = 1; i < outerPoints.length; i++) {
            context.lineTo(outerPoints[i].x, outerPoints[i].y);
        }
        context.closePath();

        context.fillStyle = "#a8a8a8"; // Gray color
        context.fill();
        context.strokeStyle = "#666666"; // Darker outline
        context.lineWidth = 4;
        context.stroke();
    }

    renderBoosterCannonTankFactory (context) {
        this.renderBasic(context);
        context.rotate(this.rotationOffset); // Align with the barracks' rotation

        const unitSize = 20;

        context.save();
        // Translate to the position where the booster should be, behind the tank
        context.translate(-unitSize / 3.5, 0); // Move booster to the back of the tank

        // Draw the booster
        context.fillStyle = "#a4a4a4";
        context.beginPath();
        context.moveTo(-unitSize / 2, -unitSize / 1.6);  // Top left corner
        context.lineTo(unitSize / 10, -unitSize / 2.5);  // Top right corner
        context.lineTo(unitSize / 10, unitSize / 2.5);   // Bottom right corner
        context.lineTo(-unitSize / 2, unitSize / 1.6);   // Bottom left corner
        context.closePath();
        context.fill();

        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.stroke();
        context.restore();

        context.beginPath();
        const outerPoints = [];
        for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i;
            const x = unitSize * Math.cos(angle);
            const y = unitSize * Math.sin(angle);
            outerPoints.push({ x, y });
        }

        context.moveTo(outerPoints[0].x, outerPoints[0].y);
        for (let i = 1; i < outerPoints.length; i++) {
            context.lineTo(outerPoints[i].x, outerPoints[i].y);
        }
        context.closePath();

        context.fillStyle = "#a8a8a8"; // Gray color
        context.fill();
        context.strokeStyle = "#666666"; // Darker outline
        context.lineWidth = 4;
        context.stroke();

        context.rotate(-Math.PI / 2);

        // Apply recoil effect
        const cannonWidth = 11;
        const cannonLength = 10;

        // Draw the rectangle (cannon) with recoil effect
        context.fillStyle = "#a8a8a8"; // Color of the cannon
        context.fillRect(-cannonWidth / 2, cannonLength - unitSize * 0.25, cannonWidth, cannonLength);

        // Draw a border around the cannon
        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.strokeRect(-cannonWidth / 2, cannonLength - unitSize * 0.25, cannonWidth, cannonLength);


        // Draw the smaller circle in the middle
        context.beginPath();
        context.arc(0, 0, unitSize * 0.35, 0, Math.PI * 2);
        context.closePath();
        context.fillStyle = "#a8a8a8"; // Color of the smaller circle
        context.fill();
        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.stroke();
    }

    renderCannonTankFactory (context) {
        this.renderBasic(context);

        const offset = -3;

        context.rotate(this.rotationOffset); // Align with the barracks' rotation
        context.translate(offset, 0);

        context.beginPath();
        const unitSize = 20;
        const outerPoints = [];
        for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i;
            const x = unitSize * Math.cos(angle);
            const y = unitSize * Math.sin(angle);
            outerPoints.push({ x, y });
        }

        context.moveTo(outerPoints[0].x, outerPoints[0].y);
        for (let i = 1; i < outerPoints.length; i++) {
            context.lineTo(outerPoints[i].x, outerPoints[i].y);
        }
        context.closePath();

        context.fillStyle = "#8a8a8a"; // Gray color
        context.fill();
        context.strokeStyle = "#666666"; // Darker outline
        context.lineWidth = 4;
        context.stroke();


        context.rotate(-Math.PI / 2);

        // Apply recoil effect
        const cannonWidth = 11;
        const cannonLength = 10;

        // Draw the rectangle (cannon) with recoil effect
        context.fillStyle = "#a8a8a8"; // Color of the cannon
        context.fillRect(-cannonWidth / 2, cannonLength - unitSize * 0.25, cannonWidth, cannonLength);

        // Draw a border around the cannon
        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.strokeRect(-cannonWidth / 2, cannonLength - unitSize * 0.25, cannonWidth, cannonLength);


        // Draw the smaller circle in the middle
        context.beginPath();
        context.arc(0, 0, unitSize * 0.35, 0, Math.PI * 2);
        context.closePath();
        context.fillStyle = "#a8a8a8"; // Color of the smaller circle
        context.fill();
        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.stroke();
    }


    renderHeavyBoosterTankFactory (context) {
        this.renderBasic(context);
        context.rotate(this.rotationOffset); // Align with the barracks' rotation

        const unitSize = 20;

        context.save();
        // Translate to the position where the booster should be, behind the tank
        context.translate(-unitSize / 3.5, 0); // Move booster to the back of the tank

        // Draw the booster
        context.fillStyle = "#a4a4a4";
        context.beginPath();
        context.moveTo(-unitSize / 2, -unitSize / 1.6);  // Top left corner
        context.lineTo(unitSize / 10, -unitSize / 2.5);  // Top right corner
        context.lineTo(unitSize / 10, unitSize / 2.5);   // Bottom right corner
        context.lineTo(-unitSize / 2, unitSize / 1.6);   // Bottom left corner
        context.closePath();
        context.fill();

        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.stroke();
        context.restore();

        context.beginPath();
        const outerPoints = [];
        for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i;
            const x = unitSize * Math.cos(angle);
            const y = unitSize * Math.sin(angle);
            outerPoints.push({ x, y });
        }

        context.moveTo(outerPoints[0].x, outerPoints[0].y);
        for (let i = 1; i < outerPoints.length; i++) {
            context.lineTo(outerPoints[i].x, outerPoints[i].y);
        }
        context.closePath();

        context.fillStyle = "#8a8a8a"; // Gray color
        context.fill();
        context.strokeStyle = "#666666"; // Darker outline
        context.lineWidth = 4;
        context.stroke();
    }


    renderSiegeFactory (context) {
        // Pixel-art style cross, snapped to integer pixels to match the reference look.
        const size = this.size;
        const half = size / 2;
        const bodyColor = "#a6a6a6";
        const borderColor = "#555555";
        const px = (n) => Math.round(n);
        const borderThickness = Math.max(2, px(size * 0.04)); // 12 on 300 reference

        const drawBlock = (x, y, w, h, fill) => {
            const bx = px(x);
            const by = px(y);
            const bw = px(w);
            const bh = px(h);

            context.fillStyle = borderColor;
            context.fillRect(bx, by, bw, bh);

            const innerX = bx + borderThickness;
            const innerY = by + borderThickness;
            const innerW = Math.max(1, bw - borderThickness * 2);
            const innerH = Math.max(1, bh - borderThickness * 2);

            context.fillStyle = fill;
            context.fillRect(innerX, innerY, innerW, innerH);
        };

        // Background square uses base color
        drawBlock(-half, -half, size, size, this.color);

        // Arms exactly from provided JS reference
        const armSize = size * 0.3;
        drawBlock(size * 0.35 - half, size * 0.08 - half, armSize, armSize, bodyColor); // top
        drawBlock(size * 0.35 - half, size * 0.62 - half, armSize, armSize, bodyColor); // bottom
        drawBlock(size * 0.08 - half, size * 0.35 - half, armSize, armSize, bodyColor); // left
        drawBlock(size * 0.62 - half, size * 0.35 - half, armSize, armSize, bodyColor); // right

        // Center block exactly from provided JS reference
        const centerSize = size * 0.45;
        const centerPos = (size - centerSize) / 2;
        drawBlock(centerPos - half, centerPos - half, centerSize, centerSize, bodyColor);
    }


    renderHeavySiegeFactory (context) {
        this.renderBasic(context);

        context.rotate(this.rotationOffset); // Align with the barracks' rotation
        // Move to the center of the square
        context.translate(-4, 0);

        context.beginPath();
        const unitSize = 25;
        const outerPoints = [];
        for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i;
            const x = unitSize * Math.cos(angle);
            const y = unitSize * Math.sin(angle);
            outerPoints.push({ x, y });
        }

        context.moveTo(outerPoints[0].x, outerPoints[0].y);
        for (let i = 1; i < outerPoints.length; i++) {
            context.lineTo(outerPoints[i].x, outerPoints[i].y);
        }
        context.closePath();

        context.fillStyle = "#8a8a8a"; // Gray color
        context.fill();
        context.strokeStyle = "#666666"; // Darker outline
        context.lineWidth = 4;
        context.stroke();

        // Draw the smaller triangle
        context.beginPath();
        const smallerUnitSize = unitSize * 0.45;
        for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i;
            const x = smallerUnitSize * Math.cos(angle);
            const y = smallerUnitSize * Math.sin(angle);
            outerPoints[i] = { x, y };
        }

        context.moveTo(outerPoints[0].x, outerPoints[0].y);
        for (let i = 1; i < outerPoints.length; i++) {
            context.lineTo(outerPoints[i].x, outerPoints[i].y);
        }
        context.closePath();

        context.fill();
        context.stroke();
    }


    renderBoosterCannonSiegeTank (context) {
        this.renderBasic(context);

        context.rotate(this.rotationOffset); // Align with the barracks' rotation
        // Move to the center of the square
        context.translate(-4, 0);

        context.beginPath();
        const unitSize = 25;
        const outerPoints = [];
        for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i;
            const x = unitSize * Math.cos(angle);
            const y = unitSize * Math.sin(angle);
            outerPoints.push({ x, y });
        }

        context.moveTo(outerPoints[0].x, outerPoints[0].y);
        for (let i = 1; i < outerPoints.length; i++) {
            context.lineTo(outerPoints[i].x, outerPoints[i].y);
        }
        context.closePath();

        context.fillStyle = "#a8a8a8"; // Gray color
        context.fill();
        context.strokeStyle = "#666666"; // Darker outline
        context.lineWidth = 4;
        context.stroke();

        // Draw the smaller triangle
        context.beginPath();
        const smallerUnitSize = unitSize * 0.45;
        for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i;
            const x = smallerUnitSize * Math.cos(angle);
            const y = smallerUnitSize * Math.sin(angle);
            outerPoints[i] = { x, y };
        }

        context.moveTo(outerPoints[0].x, outerPoints[0].y);
        for (let i = 1; i < outerPoints.length; i++) {
            context.lineTo(outerPoints[i].x, outerPoints[i].y);
        }
        context.closePath();

        context.fill();
        context.stroke();


        context.rotate(-Math.PI / 2);

        const cannonWidth = 15;
        const cannonLength = 12.5;

        // Draw the rectangle (cannon) with recoil effect
        context.fillStyle = "#a8a8a8"; // Color of the cannon
        context.fillRect(-cannonWidth / 2, cannonLength - unitSize * 0.25, cannonWidth, cannonLength);

        // Draw a border around the cannon
        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.strokeRect(-cannonWidth / 2, cannonLength - unitSize * 0.25, cannonWidth, cannonLength);


        // Draw the smaller circle in the middle
        context.beginPath();
        context.arc(0, 0, unitSize * 0.35, 0, Math.PI * 2);
        context.closePath();
        context.fillStyle = "#a8a8a8"; // Color of the smaller circle
        context.fill();
        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.stroke();
    }

    renderCannonSiegeTankFactory (context) {
        this.renderBasic(context);

        context.rotate(this.rotationOffset); // Align with the barracks' rotation
        // Move to the center of the square
        context.translate(-4, 0);

        context.beginPath();
        const unitSize = 25;
        const outerPoints = [];
        for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i;
            const x = unitSize * Math.cos(angle);
            const y = unitSize * Math.sin(angle);
            outerPoints.push({ x, y });
        }

        context.moveTo(outerPoints[0].x, outerPoints[0].y);
        for (let i = 1; i < outerPoints.length; i++) {
            context.lineTo(outerPoints[i].x, outerPoints[i].y);
        }
        context.closePath();

        context.fillStyle = "#8a8a8a"; // Gray color
        context.fill();
        context.strokeStyle = "#666666"; // Darker outline
        context.lineWidth = 4;
        context.stroke();

        // Draw the smaller triangle
        context.beginPath();
        const smallerUnitSize = unitSize * 0.45;
        for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i;
            const x = smallerUnitSize * Math.cos(angle);
            const y = smallerUnitSize * Math.sin(angle);
            outerPoints[i] = { x, y };
        }

        context.moveTo(outerPoints[0].x, outerPoints[0].y);
        for (let i = 1; i < outerPoints.length; i++) {
            context.lineTo(outerPoints[i].x, outerPoints[i].y);
        }
        context.closePath();

        context.fill();
        context.stroke();


        context.rotate(-Math.PI / 2);

        const cannonWidth = 15;
        const cannonLength = 12.5;

        // Draw the rectangle (cannon) with recoil effect
        context.fillStyle = "#a8a8a8"; // Color of the cannon
        context.fillRect(-cannonWidth / 2, cannonLength - unitSize * 0.25, cannonWidth, cannonLength);

        // Draw a border around the cannon
        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.strokeRect(-cannonWidth / 2, cannonLength - unitSize * 0.25, cannonWidth, cannonLength);


        // Draw the smaller circle in the middle
        context.beginPath();
        context.arc(0, 0, unitSize * 0.35, 0, Math.PI * 2);
        context.closePath();
        context.fillStyle = "#a8a8a8"; // Color of the smaller circle
        context.fill();
        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.stroke();

    }

    renderBoosterSiegeFactory (context) {
        this.renderBasic(context);
        context.rotate(this.rotationOffset); // Align with the barracks' rotation
        context.translate(-2, 0);

        const unitSize = 25;

        context.save();
        // Translate to the position where the booster should be, behind the tank
        context.translate(-unitSize / 4, 0); // Move booster to the back of the tank

        // Draw the booster
        context.fillStyle = "#a4a4a4";
        context.beginPath();
        context.moveTo(-unitSize / 2, -unitSize / 1.6);  // Top left corner
        context.lineTo(unitSize / 10, -unitSize / 2.5);  // Top right corner
        context.lineTo(unitSize / 10, unitSize / 2.5);   // Bottom right corner
        context.lineTo(-unitSize / 2, unitSize / 1.6);   // Bottom left corner
        context.closePath();
        context.fill();

        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.stroke();
        context.restore();

        context.beginPath();
        const outerPoints = [];
        for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i;
            const x = unitSize * Math.cos(angle);
            const y = unitSize * Math.sin(angle);
            outerPoints.push({ x, y });
        }

        context.moveTo(outerPoints[0].x, outerPoints[0].y);
        for (let i = 1; i < outerPoints.length; i++) {
            context.lineTo(outerPoints[i].x, outerPoints[i].y);
        }
        context.closePath();

        context.fillStyle = "#a8a8a8"; // Gray color
        context.fill();
        context.strokeStyle = "#666666"; // Darker outline
        context.lineWidth = 4;
        context.stroke();


        // Draw the smaller triangle
        context.beginPath();
        const smallerUnitSize = unitSize * 0.45;
        for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i;
            const x = smallerUnitSize * Math.cos(angle);
            const y = smallerUnitSize * Math.sin(angle);
            outerPoints[i] = { x, y };
        }

        context.moveTo(outerPoints[0].x, outerPoints[0].y);
        for (let i = 1; i < outerPoints.length; i++) {
            context.lineTo(outerPoints[i].x, outerPoints[i].y);
        }
        context.closePath();

        context.fill();
        context.stroke();
    }

    renderHeavyBoosterSiegeFactory (context) {
        this.renderBasic(context);
        context.rotate(this.rotationOffset); // Align with the barracks' rotation
        context.translate(-2, 0);

        const unitSize = 25;

        context.save();
        // Translate to the position where the booster should be, behind the tank
        context.translate(-unitSize / 4, 0); // Move booster to the back of the tank

        // Draw the booster
        context.fillStyle = "#a4a4a4";
        context.beginPath();
        context.moveTo(-unitSize / 2, -unitSize / 1.6);  // Top left corner
        context.lineTo(unitSize / 10, -unitSize / 2.5);  // Top right corner
        context.lineTo(unitSize / 10, unitSize / 2.5);   // Bottom right corner
        context.lineTo(-unitSize / 2, unitSize / 1.6);   // Bottom left corner
        context.closePath();
        context.fill();

        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.stroke();
        context.restore();

        context.beginPath();
        const outerPoints = [];
        for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i;
            const x = unitSize * Math.cos(angle);
            const y = unitSize * Math.sin(angle);
            outerPoints.push({ x, y });
        }

        context.moveTo(outerPoints[0].x, outerPoints[0].y);
        for (let i = 1; i < outerPoints.length; i++) {
            context.lineTo(outerPoints[i].x, outerPoints[i].y);
        }
        context.closePath();

        context.fillStyle = "#8a8a8a"; // Gray color
        context.fill();
        context.strokeStyle = "#666666"; // Darker outline
        context.lineWidth = 4;
        context.stroke();


        // Draw the smaller triangle
        context.beginPath();
        const smallerUnitSize = unitSize * 0.45;
        for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i;
            const x = smallerUnitSize * Math.cos(angle);
            const y = smallerUnitSize * Math.sin(angle);
            outerPoints[i] = { x, y };
        }

        context.moveTo(outerPoints[0].x, outerPoints[0].y);
        for (let i = 1; i < outerPoints.length; i++) {
            context.lineTo(outerPoints[i].x, outerPoints[i].y);
        }
        context.closePath();

        context.fill();
        context.stroke();
    }

    renderBoosterCannonSiegeFactory (context) {
        this.renderBasic(context);
        context.rotate(this.rotationOffset); // Align with the barracks' rotation
        context.translate(-2, 0);

        const unitSize = 25;

        context.save();
        // Translate to the position where the booster should be, behind the tank
        context.translate(-unitSize / 4, 0); // Move booster to the back of the tank

        // Draw the booster
        context.fillStyle = "#a4a4a4";
        context.beginPath();
        context.moveTo(-unitSize / 2, -unitSize / 1.6);  // Top left corner
        context.lineTo(unitSize / 10, -unitSize / 2.5);  // Top right corner
        context.lineTo(unitSize / 10, unitSize / 2.5);   // Bottom right corner
        context.lineTo(-unitSize / 2, unitSize / 1.6);   // Bottom left corner
        context.closePath();
        context.fill();

        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.stroke();
        context.restore();

        context.beginPath();
        const outerPoints = [];
        for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i;
            const x = unitSize * Math.cos(angle);
            const y = unitSize * Math.sin(angle);
            outerPoints.push({ x, y });
        }

        context.moveTo(outerPoints[0].x, outerPoints[0].y);
        for (let i = 1; i < outerPoints.length; i++) {
            context.lineTo(outerPoints[i].x, outerPoints[i].y);
        }
        context.closePath();

        context.fillStyle = "#a8a8a8"; // Gray color
        context.fill();
        context.strokeStyle = "#666666"; // Darker outline
        context.lineWidth = 4;
        context.stroke();


        // Draw the smaller triangle
        context.beginPath();
        const smallerUnitSize = unitSize * 0.45;
        for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i;
            const x = smallerUnitSize * Math.cos(angle);
            const y = smallerUnitSize * Math.sin(angle);
            outerPoints[i] = { x, y };
        }

        context.moveTo(outerPoints[0].x, outerPoints[0].y);
        for (let i = 1; i < outerPoints.length; i++) {
            context.lineTo(outerPoints[i].x, outerPoints[i].y);
        }
        context.closePath();

        context.fill();
        context.stroke();


        context.rotate(-Math.PI / 2);

        const cannonWidth = 15;
        const cannonLength = 12.5;

        // Draw the rectangle (cannon) with recoil effect
        context.fillStyle = "#a8a8a8"; // Color of the cannon
        context.fillRect(-cannonWidth / 2, cannonLength - unitSize * 0.25, cannonWidth, cannonLength);

        // Draw a border around the cannon
        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.strokeRect(-cannonWidth / 2, cannonLength - unitSize * 0.25, cannonWidth, cannonLength);


        // Draw the smaller circle in the middle
        context.beginPath();
        context.arc(0, 0, unitSize * 0.35, 0, Math.PI * 2);
        context.closePath();
        context.fillStyle = "#a8a8a8"; // Color of the smaller circle
        context.fill();
        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.stroke();

    }
}
