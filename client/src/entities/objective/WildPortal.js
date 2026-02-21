import Renderable from "../../components/Renderable.js";

export default class WildPortal extends Renderable {
    constructor (id, position = { x: 0, y: 0 }) {
        super();
        this.id = id;
        this.position = position;
        this.phase = Math.random() * Math.PI * 2;
        this.rotation = Math.random() * Math.PI * 2;
        this.size = 34;
    }

    getWorldPosition (camera) {
        return {
            x: this.position.x - camera.x,
            y: this.position.y - camera.y
        };
    }

    render (context, camera, deltaTime) {
        const worldPosition = this.getWorldPosition(camera);
        const dt = Math.max(0, (deltaTime || 16) / 1000);
        this.phase += dt * 1.9;
        this.rotation += dt * 0.7;

        const pulse = 0.86 + Math.sin(this.phase) * 0.1;

        context.save();
        context.translate(worldPosition.x, worldPosition.y);
        context.rotate(this.rotation);

        context.beginPath();
        context.arc(0, 0, this.size, 0, Math.PI * 2);
        context.fillStyle = "rgba(10, 16, 30, 0.78)";
        context.fill();

        const ring = context.createRadialGradient(0, 0, this.size * 0.15, 0, 0, this.size * 1.1);
        ring.addColorStop(0, "rgba(0,212,255,0.12)");
        ring.addColorStop(0.6, "rgba(136,56,255,0.55)");
        ring.addColorStop(1, "rgba(0,212,255,0.86)");

        context.beginPath();
        context.arc(0, 0, this.size * pulse, 0, Math.PI * 2);
        context.lineWidth = 5;
        context.strokeStyle = ring;
        context.shadowBlur = 14;
        context.shadowColor = "rgba(0,212,255,0.9)";
        context.stroke();

        context.beginPath();
        context.arc(0, 0, this.size * 0.42, 0, Math.PI * 2);
        context.fillStyle = "rgba(0, 0, 0, 0.82)";
        context.fill();

        context.restore();
    }
}
