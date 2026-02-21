import Player from "../Player.js";
import SkinCache from "../../components/SkinCache.js";

export default class NeutralBase extends Player {
    constructor (id, position = { x: 0, y: 0 }, health = 1000, ownerId = null) {
        super();
        this.id = id;
        this.ownerID = null;
        this.defaultName = "Neutral";
        this.name = this.defaultName;
        this.nameWidth = null;
        this.defaultColor = "#CCCCCC";
        this.color = this.defaultColor;
        this.position = position;
        this.health = { current: health, max: 1000 };
        this.targetHealth = health; // Target health value for animation
        this.buildingRadius = {
            max: 260,
            min: 70
        }
        this.coreRadius = { max: this.buildingRadius.min };
        this.buildings = [];
        this.borderRotation = 0;
        this.hasSpawnProtection = false;
    }

    update (deltaTime) {
        super.updateHealth(deltaTime);
        super.updateBullets(deltaTime);
        super.updateBuildings(deltaTime);
    }

    reset () {
        this.ownerID = null;
        this.color = this.defaultColor;
        this.name = this.defaultName;
        this.skin = null;
        this.setHealth(this.health.max);
        this.nameWidth = null; // Reset the name width
        this.buildings.forEach(building => building.setColor(this.defaultColor));
        this.bullets.forEach(bullet => bullet.setColor(this.defaultColor));
    }

    setOwner (player) {
        this.ownerID = player.id;
        this.color = player.color;
        this.name = player.name;
        this.nameWidth = null; // Reset the name width
        this.buildings.forEach(building => building.setColor(this.color));
        this.bullets.forEach(bullet => bullet.setColor(this.color));
       
        // Handle skin asynchronously
        if (player.skin) {
            this.skin = player.skin;
        } else {
            player.getSkin().then(() => {
                this.skin = player.skin;
            }).catch(error => {
                console.error("Error loading skin for player:", error);
            });
        }
    }

    clear () {
        this.buildings = [];
        this.bullets = [];
    }
}
