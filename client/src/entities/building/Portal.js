import Building from "../Building.js";
import { BuildingDetails, BuildingTypes } from "../../network/constants.js";
import Polygon from "../Polygon.js";
import Shapes from "../../components/Shapes.js";
import ThemeManager from "../../components/managers/ThemeManager.js";

export default class Portal extends Building {
    constructor (color, position = { x: 0, y: 0 }, variant = 0, id = -1) {
        const details = BuildingDetails.PORTAL.BASIC;
        super(id, BuildingTypes.PORTAL, color, details, position, variant);
        this.rotationOffset = 0;
        this.portalPhase = Math.random() * Math.PI * 2;
        this.frameRotation = Math.random() * Math.PI * 2;
        this.morphPhase = Math.random() * Math.PI * 2;
        this.activationDurationMs = 30000;
        this.activationStartedAtMs = null;
        this.particlePerspective = 220;
        this.maxParticleDepth = 620;
        this.particles = [];
        this.particleCount = 34;
        this._initParticles();
        this.polygonPoints = Shapes.getCirclePoints(this.size, 20);
        this.initPolygon();
    }

    initPolygon () {
        // Match server-side circle collision envelope (+2 for non-wall circles).
        const collisionOffset = 2;
        this.polygon = new Polygon(Shapes.getCirclePoints(this.size + collisionOffset, 20), this.position);
        this.updatePolygonRotation();
    }

    _initParticles () {
        for (let i = 0; i < this.particleCount; i++) {
            this.particles.push(this._createParticle(true));
        }
    }

    _createParticle (randomDepth = false) {
        return {
            angle: Math.random() * Math.PI * 2,
            radius: this.size * (0.35 + Math.random() * 0.45),
            depth: randomDepth ? (Math.random() * this.maxParticleDepth) : this.maxParticleDepth,
            speed: 0.7 + Math.random() * 0.9,
            spin: 0.4 + Math.random() * 0.9,
            color: Math.random() > 0.5 ? "#00d4ff" : "#bd00ff"
        };
    }

    _updateParticles (deltaSeconds) {
        const depthSpeed = 220;
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            p.depth -= depthSpeed * p.speed * deltaSeconds;
            p.angle += p.spin * deltaSeconds;
            if (p.depth <= 0) {
                this.particles[i] = this._createParticle(false);
            }
        }
    }

    _renderMorphFrame (context) {
        const outerRadius = this.size * 1.05;
        const innerRadius = this.size * 0.95;
        const points = 40;

        context.save();
        context.rotate(this.frameRotation);
        context.beginPath();
        for (let i = 0; i <= points; i++) {
            const t = (i / points) * Math.PI * 2;
            const wobble = 1 + 0.1 * Math.sin(3 * t + this.morphPhase) + 0.05 * Math.sin(7 * t - this.morphPhase * 0.8);
            const r = outerRadius * wobble;
            const x = Math.cos(t) * r;
            const y = Math.sin(t) * r;
            if (i === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        }
        context.closePath();

        const gradient = context.createRadialGradient(0, 0, innerRadius * 0.15, 0, 0, outerRadius * 1.2);
        gradient.addColorStop(0, "rgba(142,45,226,0.05)");
        gradient.addColorStop(0.55, "rgba(74,0,224,0.55)");
        gradient.addColorStop(1, "rgba(142,45,226,0.95)");
        context.fillStyle = gradient;
        context.shadowBlur = this.size * 0.9;
        context.shadowColor = "rgba(142,45,226,0.95)";
        context.fill();

        context.restore();
    }

    _renderPortalCore (context) {
        const coreRadius = this.size * 0.9;

        context.save();
        context.beginPath();
        context.arc(0, 0, coreRadius, 0, Math.PI * 2);
        context.clip();

        context.fillStyle = "rgba(0,0,0,0.18)";
        context.fillRect(-coreRadius, -coreRadius, coreRadius * 2, coreRadius * 2);

        for (const p of this.particles) {
            const scale = this.particlePerspective / (this.particlePerspective + p.depth);
            const x = Math.cos(p.angle) * p.radius * scale;
            const y = Math.sin(p.angle) * p.radius * scale;
            const size = Math.max(0.8, 3.8 * scale);

            context.beginPath();
            context.arc(x, y, size, 0, Math.PI * 2);
            context.fillStyle = p.color;
            context.globalAlpha = Math.max(0.2, Math.min(1, scale));
            context.shadowBlur = 14 * scale;
            context.shadowColor = p.color;
            context.fill();
        }
        context.globalAlpha = 1;
        context.restore();
    }

    _renderActivationTimer (context) {
        if (this.id < 0) return;
        if (this.activationStartedAtMs === null) {
            this.activationStartedAtMs = Date.now();
        }

        const elapsed = Date.now() - this.activationStartedAtMs;
        const remainingMs = this.activationDurationMs - elapsed;
        if (remainingMs <= 0) return;

        const secondsLeft = Math.ceil(remainingMs / 1000);
        context.save();
        context.font = "bold 14px Arial";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = "#9ce6ff";
        context.strokeStyle = "rgba(0,0,0,0.85)";
        context.lineWidth = 3;
        context.strokeText(`${secondsLeft}s`, 0, -this.size - 18);
        context.fillText(`${secondsLeft}s`, 0, -this.size - 18);
        context.restore();
    }

    render (context, camera, deltaTime) {
        const worldPosition = this.getWorldPosition(camera);
        context.save();
        context.translate(worldPosition.x, worldPosition.y);
        super.render(context);

        if (this.isSelected()) {
            this.renderSelection(context, 0, ThemeManager.currentThemeProperties.selectionColor);
        }

        const dt = Math.max(0, (deltaTime || 16) / 1000);
        this.portalPhase += dt * 2.2;
        this.frameRotation += dt * 0.5;
        this.morphPhase += dt * 1.1;
        this._updateParticles(dt);
        const pulse = 0.78 + Math.sin(this.portalPhase) * 0.1;

        context.beginPath();
        context.arc(0, 0, this.size, 0, Math.PI * 2);
        context.fillStyle = "#120626";
        context.strokeStyle = "#666666";
        context.lineWidth = 4;
        context.fill();
        context.stroke();

        this._renderMorphFrame(context);
        this._renderPortalCore(context);

        context.beginPath();
        context.arc(0, 0, this.size * pulse, 0, Math.PI * 2);
        context.fillStyle = "rgba(106, 206, 255, 0.18)";
        context.fill();

        context.beginPath();
        context.arc(0, 0, this.size * 0.42, 0, Math.PI * 2);
        context.fillStyle = "rgba(8, 8, 20, 0.85)";
        context.fill();

        this._renderActivationTimer(context);

        context.restore();
    }
}
