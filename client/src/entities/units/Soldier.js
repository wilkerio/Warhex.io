import { UnitTypes, UnitVariantTypes, getUnitDetails } from "../../network/constants.js";
import Unit from "../Unit.js";

const getHudShapeMode = (unitKey) => {
    try {
        let mode = globalThis?.window?.__warhexHudConfig?.unitShapes?.[unitKey];
        if (mode === "square") mode = "triangle";
        return mode === "triangle" ? "triangle" : "round";
    } catch {
        return "round";
    }
};

const getSoldierModelMode = () => {
    try {
        return globalThis?.window?.__warhexHudConfig?.unitStyles?.soldierModel || "model1";
    } catch {
        return "model1";
    }
};

export default class Soldier extends Unit {
    constructor (color, position = { x: 0, y: 0 }, variant = 0, id = -1) {
        const details = getUnitDetails(UnitTypes.SOLDIER, variant);
        const baseColor = color;

        // Darken the color if the variant requires it
        const variantColorMap = {
            [UnitVariantTypes.SOLDIER.BASIC]: color,
            [UnitVariantTypes.SOLDIER.LIGHT_ARMOR]: "#9a9a9a",
        };

        const adjustedColor = variantColorMap[variant] || color;


        super(id, UnitTypes.SOLDIER, adjustedColor, details, position, variant);
        this.baseColor = baseColor;

        // Set the upgrade method based on the variant during initialization
        this.renderUpgrade = this.getUpgradeRenderMethod(variant);
    }

    setVariant (variant) {
        this.variant = variant;
        this.details = getUnitDetails(UnitTypes.SOLDIER, variant);
        this.size = this.details.size;
        this.color = variant === UnitVariantTypes.SOLDIER.LIGHT_ARMOR ? "#9a9a9a" : this.baseColor;
        this.renderUpgrade = this.getUpgradeRenderMethod(variant);
    }

    getUpgradeRenderMethod (buildingVariant) {
        const variantMap = {
            [UnitVariantTypes.SOLDIER.BASIC]: this.renderBasic,
            [UnitVariantTypes.SOLDIER.LIGHT_ARMOR]: this.renderLightArmor,
        };

        const renderMethod = variantMap[buildingVariant];
        if (!renderMethod) {
            console.error("UpgradeType not defined!");
            return this.renderBasic; // Fallback to basic render
        }
        return renderMethod.bind(this); // Bind to ensure correct context
    }

    render (context, camera, deltaTime) {
        const worldPosition = this.getWorldPosition(camera);

        // Save the context state
        context.save();

        super.render(context, camera, worldPosition);

        // Translate and rotate context for the soldier
        context.translate(worldPosition.x, worldPosition.y);
        context.rotate(this.rotation);

        // Render the soldier using the current upgrade method
        this.renderUpgrade(context, deltaTime);

        // Restore the context state
        context.restore();
    }

    renderBasic(context, deltaTime) {
        this.renderSoldier(context, deltaTime);
    }

    renderLightArmor(context, deltaTime) {
        this.renderSoldier(context, deltaTime);
    }

    renderSoldier (context) {
        const shape = getHudShapeMode("soldier");
        const model = getSoldierModelMode();

        if (shape === "round") {
            context.beginPath();
            context.arc(0, 0, this.size * 0.9, 0, Math.PI * 2);
            context.closePath();
            context.fillStyle = this.color;
            context.fill();
            context.strokeStyle = "#666666";
            context.lineWidth = 4;
            context.stroke();
            this.renderSoldierModelOverlay(context, model, shape);
            return;
        }
        const outerPoints = this.calculateOuterPoints();

        // Draw outer triangle
        context.beginPath();
        context.moveTo(outerPoints[0].x, outerPoints[0].y);
        for (let i = 1; i < outerPoints.length; i++) {
            context.lineTo(outerPoints[i].x, outerPoints[i].y);
        }
        context.closePath();

        // Fill and stroke the soldier
        context.fillStyle = this.color;
        context.fill();

        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.stroke();
        this.renderSoldierModelOverlay(context, model, shape);
    }

    renderSoldierModelOverlay(context, model, shape) {
        const r = this.size * 0.9;
        if (shape === "triangle" && model === "model1") return;
        const clipToShape = () => {
            context.save();
            context.beginPath();
            if (shape === "round") {
                context.arc(0, 0, r, 0, Math.PI * 2);
            } else {
                const pts = this.calculateOuterPoints();
                context.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) context.lineTo(pts[i].x, pts[i].y);
                context.closePath();
            }
            context.clip();
        };
        const endClip = () => context.restore();

        switch (model) {
            case "model2": // ring + core
                context.beginPath();
                context.arc(0, 0, r * 0.55, 0, Math.PI * 2);
                context.strokeStyle = "#dfe7ff";
                context.lineWidth = 3;
                context.stroke();
                context.beginPath();
                context.arc(0, 0, r * 0.18, 0, Math.PI * 2);
                context.fillStyle = "#dfe7ff";
                context.fill();
                break;
            case "model3": // stripes
                clipToShape();
                context.strokeStyle = "rgba(255,255,255,0.85)";
                context.lineWidth = 2.5;
                for (let y = -r; y <= r; y += 6) {
                    context.beginPath();
                    context.moveTo(-r, y);
                    context.lineTo(r, y + 4);
                    context.stroke();
                }
                endClip();
                break;
            case "model4": // chevron
                context.beginPath();
                context.moveTo(0, -r * 0.55);
                context.lineTo(r * 0.42, 0);
                context.lineTo(0, r * 0.55);
                context.lineTo(-r * 0.42, 0);
                context.closePath();
                context.fillStyle = "rgba(255,255,255,0.85)";
                context.fill();
                break;
            case "model5": // twin eyes + line
                context.beginPath();
                context.arc(-r * 0.28, -r * 0.08, r * 0.14, 0, Math.PI * 2);
                context.arc(r * 0.28, -r * 0.08, r * 0.14, 0, Math.PI * 2);
                context.fillStyle = "#dfe7ff";
                context.fill();
                context.beginPath();
                context.moveTo(-r * 0.35, r * 0.28);
                context.lineTo(r * 0.35, r * 0.28);
                context.strokeStyle = "#dfe7ff";
                context.lineWidth = 3;
                context.stroke();
                break;
            case "model1":
            default: // classic dot + ring
                context.beginPath();
                context.arc(0, 0, r * 0.38, 0, Math.PI * 2);
                context.strokeStyle = "rgba(255,255,255,0.9)";
                context.lineWidth = 2.5;
                context.stroke();
                context.beginPath();
                context.arc(0, 0, r * 0.10, 0, Math.PI * 2);
                context.fillStyle = "rgba(255,255,255,0.9)";
                context.fill();
                break;
        }
    }


    calculateOuterPoints () {
        const points = [];
        for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i; // No need for rotation adjustment here
            const x = this.size * Math.cos(angle);
            const y = this.size * Math.sin(angle);
            points.push({ x, y });
        }
        return points;
    }
}
