/*
Contains multiple utility functions
TODO: move those function into a seperate file

TODO: 
    export const MessageTypes = {
    // Client -> Server Messages
    CLIENT: {
        JOIN: 0,                              // Player joining message
        PLACE_BUILDING: 1,                    // Place building
        ...
    },

    // Server -> Client Messages
    SERVER: {
        PLAYER_JOINED: 5,                     // Player joined
        PLAYER_LEFT: 6,                       // Player left
        BASE_HEALTH_UPDATE: 7,                // Base health update
        ...
    },
};*/


export const Servers = {
    "Frankfurt": "https://fra1.blobl.io",
};

export const MessageTypes = {
    JOIN: 0,                           
    CLIENT_PLACE_BUILDING: 1,            
    CLIENT_UPGRADE_BUILDINGS: 2,         
    CLIENT_REMOVE_BUILDINGS: 3,      
    CLIENT_MOVE_UNITS: 4,             
    PLAYER_JOINED: 5,                    
    PLAYER_LEFT: 6,                      
    BASE_HEALTH_UPDATE: 7,           
    BUILDING_PLACED: 8,                
    BUILDINGS_REMOVED: 9,               
    BUILDINGS_UPGRADED: 10,             
    GAME_STATE: 11,                     
    INITIAL_PLAYER_DATA: 12,           
    RESOURCE_UPDATE: 13,                
    SPAWN_UNIT: 14,                      
    UNITS_POSITION_UPDATE: 15,
    REMOVE_UNIT: 16,
    KILLED: 17,
    SPAWN_BULLET: 18,
    BULLET_POSITION_UPDATE: 19,
    REMOVE_BULLET: 20,
    LEADERBOARD_UPDATE: 21,
    REMOVE_SPAWN_PROTECTION: 22,
    KICK_NOTIFICATION: 23,
    SEND_CHAT_MESSAGE: 24,
    CHAT_MESSAGE: 25,
    UNIT_HEALTH_UPDATE: 26,
    UNIT_SPAWN_BULLET: 28,
    BUILDING_PLACEMENT_FAILED: 29,
    UNITS_ROTATION_UPDATE: 30,
    CLIENT_CAMERA_UPDATE: 31,
    INITIAL_BULLET_STATES: 32,
    CLIENT_REQUEST_RESYNC: 33,
    TURRET_ROTATION_UPDATE: 34,
    NEUTRAL_BASE_CAPTURED: 35,
    TOGGLE_UNIT_SPAWNING: 36,
    BARRACKS_ACTIVATION_UPDATE: 37,
    BUY_REPAIR: 38,
    BUY_COMMANDER: 39,
    CLIENT_REQUEST_SKIN_DATA: 40,
    SKIN_DATA: 41,
    PLAYER_INACTIVE_WARNING: 42,
    PLAYER_ACTIVE: 43,
    CLIENT_ACTIVITY: 44,
    TOGGLE_GROUP_UNITS: 45,
    HEARTBEAT: 69,
    SERVER_VERSION: 98,
    REBOOT_ALERT: 99,
    ERROR: 100
};

export const BuildingSizes = {
    WALL: { size: 30 },
    SIMPLE_TURRET: { size: 29 },
    SNIPER_TURRET: { size: 32 },
    ARMORY: { size: 40 },
    BARRACKS: { size: 60 },
    GENERATOR: { size: 32 },
    HOUSE: { size: 30 }
};

export const BuildingLimits = {
    WALL: 9999,
    SIMPLE_TURRET: 9999,
    SNIPER_TURRET: 9999,
    ARMORY: 1,
    BARRACKS: 4,
    GENERATOR: 9999,
    HOUSE: 64
}

export const BuildingTypes = {
    WALL: 0,
    SIMPLE_TURRET: 1,
    SNIPER_TURRET: 2,
    ARMORY: 3,
    BARRACKS: 4,
    GENERATOR: 5,
    HOUSE: 6
}

export const BuildingVariantTypes = {
    WALL: {
        BASIC: 0,
        BOULDER: 1,
        SPIKE: 2,
        MICRO_GENERATOR: 3,
    },
    SIMPLE_TURRET: {
        BASIC: 0,
        RAPID_TURRET: 1,
        GATLING_TURRET: 2,
        HEAVY_TURRET: 3,
    },
    SNIPER_TURRET: {
        BASIC: 0,
        SEMI_AUTOMATIC_SNIPER: 1,
        HEAVY_SNIPER: 2,
        ANTI_TANK_GUN: 3,
        TRAPPER: 4,
    },
    ARMORY: {
        BASIC: 0,
        POWER_ARMOR: 1,
        BOOSTER_ENGINES: 2,
        PANZER_CANNONS: 3,
        PANZER_CANNONS_COMBO: 4,
        CLOAKING_DEVICE: 5,
        BOOSTER_CLOAK_COMBO: 6,
        PANZER_CLOAK_COMBO: 7,
        PANZER_BOOSTER_CLOAK_COMBO: 8,
    },
    BARRACKS: {
        BASIC: 0,
        GREATER_BARRACKS: 1,
        TANK_FACTORY: 2,
        HEAVY_TANK_FACTORY: 3,
        BOOSTER_TANK_FACTORY: 4,
        CANNON_TANK_FACTORY: 5,
        SIEGE_TANK_FACTORY: 6,
        HEAVY_BOOSTER_TANK_FACTORY: 7,
        BOOSTER_CANNON_TANK_FACTORY: 8,
        HEAVY_SIEGE_TANK_FACTORY: 9,
        BOOSTER_SIEGE_TANK_FACTORY: 10,
        CANNON_SIEGE_TANK_FACTORY: 11,
        HEAVY_BOOSTER_SIEGE_TANK_FACTORY: 12,
        BOOSTER_CANNON_SIEGE_TANK_FACTORY: 13,
    },
    GENERATOR: {
        BASIC: 0,
        POWER_PLANT: 1
    },
    HOUSE: {
        BASIC: 0,
        LARGE_HOUSE: 1
    }
};

export const BuildingDetails = {
    WALL: {
        BASIC: {
            variant: BuildingVariantTypes.WALL.BASIC,
            name: "Basic Wall",
            description: "Simple defensive structure.",
            cost: 60,
            size: BuildingSizes.WALL.size,
            next: [BuildingVariantTypes.WALL.BOULDER, BuildingVariantTypes.WALL.MICRO_GENERATOR]
        },
        BOULDER: {
            variant: BuildingVariantTypes.WALL.BOULDER,
            name: "Boulder",
            description: "Stronger than a wall.",
            cost: 60,
            size: BuildingSizes.WALL.size,
            next: [BuildingVariantTypes.WALL.SPIKE]
        },
        SPIKE: {
            variant: BuildingVariantTypes.WALL.SPIKE,
            name: "Spike",
            description: "Stronger than a boulder.",
            cost: 200,
            size: BuildingSizes.WALL.size,
            next: []
        },
        MICRO_GENERATOR: {
            variant: BuildingVariantTypes.WALL.MICRO_GENERATOR,
            name: "Micro Generator",
            description: "Generates power slowly over time.",
            cost: 30,
            size: BuildingSizes.WALL.size,
            next: []
        },
    },
    SIMPLE_TURRET: {
        BASIC: {
            variant: BuildingVariantTypes.SIMPLE_TURRET.BASIC,
            name: "Simple Turret",
            description: "Automatically attacks enemy units.",
            cost: 25,
            range: 180,
            size: BuildingSizes.SIMPLE_TURRET.size,
            next: [BuildingVariantTypes.SIMPLE_TURRET.RAPID_TURRET, BuildingVariantTypes.SIMPLE_TURRET.HEAVY_TURRET]
        },
        RAPID_TURRET: {
            variant: BuildingVariantTypes.SIMPLE_TURRET.RAPID_TURRET,
            name: "Rapid Turret",
            description: "Higher fire rate, lower damage.",
            cost: 60,
            range: 180,
            size: BuildingSizes.SIMPLE_TURRET.size,
            next: [BuildingVariantTypes.SIMPLE_TURRET.GATLING_TURRET]
        },
        GATLING_TURRET: {
            variant: BuildingVariantTypes.SIMPLE_TURRET.GATLING_TURRET,
            name: "Gatling Turret",
            description: "Fires rapidly at close range.",
            cost: 100,
            range: 180,
            size: BuildingSizes.SIMPLE_TURRET.size,
            next: []
        },
        HEAVY_TURRET: {
            variant: BuildingVariantTypes.SIMPLE_TURRET.HEAVY_TURRET,
            name: "Heavy Turret",
            description: "Heavy shots with massive damage.",
            cost: 60,
            range: 240,
            size: BuildingSizes.SIMPLE_TURRET.size,
            next: []
        }
    },
    SNIPER_TURRET: {
        BASIC: {
            variant: BuildingVariantTypes.SNIPER_TURRET.BASIC,
            name: "Sniper Turret",
            description: "High damage, long range, slow fire rate.",
            cost: 80,
            range: 240,
            size: BuildingSizes.SNIPER_TURRET.size,
            next: [BuildingVariantTypes.SNIPER_TURRET.SEMI_AUTOMATIC_SNIPER, BuildingVariantTypes.SNIPER_TURRET.HEAVY_SNIPER]
        },
        SEMI_AUTOMATIC_SNIPER: {
            variant: BuildingVariantTypes.SNIPER_TURRET.SEMI_AUTOMATIC_SNIPER,
            name: "Semi-Automatic",
            description: "Higher fire rate.",
            cost: 180,
            range: 240,
            size: BuildingSizes.SNIPER_TURRET.size,
            next: []
        },
        HEAVY_SNIPER: {
            variant: BuildingVariantTypes.SNIPER_TURRET.HEAVY_SNIPER,
            name: "Heavy Sniper",
            description: "High damage, long range, slow fire rate.",
            cost: 180,
            range: 240,
            size: BuildingSizes.SNIPER_TURRET.size,
            next: [BuildingVariantTypes.SNIPER_TURRET.TRAPPER, BuildingVariantTypes.SNIPER_TURRET.ANTI_TANK_GUN]
        },
        ANTI_TANK_GUN: {
            variant: BuildingVariantTypes.SNIPER_TURRET.ANTI_TANK_GUN,
            name: "Anti-Tank Gun",
            description: "Huge damage, slow fire rate.",
            cost: 300,
            range: 280,
            size: BuildingSizes.SNIPER_TURRET.size,
            next: []
        },
        TRAPPER: {
            variant: BuildingVariantTypes.SNIPER_TURRET.TRAPPER,
            name: "Trapper",
            description: "Fires long-lasting traps.",
            cost: 550,
            range: 450,
            size: BuildingSizes.SNIPER_TURRET.size,
            next: []
        },
    },
    ARMORY: {
        BASIC: {
            variant: BuildingVariantTypes.ARMORY.BASIC,
            name: "Armory",
            description: "Unlocks unit upgrades.",
            cost: 100,
            size: BuildingSizes.ARMORY.size,
            next: [
                BuildingVariantTypes.ARMORY.POWER_ARMOR,
                BuildingVariantTypes.ARMORY.BOOSTER_ENGINES,
                BuildingVariantTypes.ARMORY.PANZER_CANNONS,
                BuildingVariantTypes.ARMORY.CLOAKING_DEVICE
            ]
        },
        POWER_ARMOR: {
            // Soldier LIGHT_ARMOR variant (use numeric literal to avoid load-order reference error)
            variant: 1,
            unitType: 0,
            unitVariant: 1,
            name: "Power Armor",
            description: "Increases soldier armor.",
            cost: 500,
            size: BuildingSizes.ARMORY.size,
            next: [
                BuildingVariantTypes.ARMORY.BOOSTER_ENGINES,
                BuildingVariantTypes.ARMORY.PANZER_CANNONS,
                BuildingVariantTypes.ARMORY.CLOAKING_DEVICE
            ]
        },
        BOOSTER_ENGINES: {
            variant: 2,
            unitType: 1,
            unitVariant: 2,
            name: "Booster Engines",
            description: "Increases tank movement speed.",
            cost: 600,
            size: BuildingSizes.ARMORY.size,
            next: [
                BuildingVariantTypes.ARMORY.PANZER_CANNONS_COMBO,
                BuildingVariantTypes.ARMORY.BOOSTER_CLOAK_COMBO
            ]
        },
        PANZER_CANNONS: {
            variant: 3,
            unitType: 1,
            unitVariant: 3,
            name: "Panzer Cannons",
            description: "Adds cannons to your tanks, making them ranged units.",
            cost: 1000,
            size: BuildingSizes.ARMORY.size,
            next: [BuildingVariantTypes.ARMORY.PANZER_CLOAK_COMBO]
        },
        PANZER_CANNONS_COMBO: {
            variant: 4,
            unitType: 1,
            unitVariant: 5,
            name: "Panzer Cannons",
            description: "Adds cannons to your tanks, making them ranged units.",
            cost: 1000,
            size: BuildingSizes.ARMORY.size,
            next: [BuildingVariantTypes.ARMORY.PANZER_BOOSTER_CLOAK_COMBO]
        },
        CLOAKING_DEVICE: {
            variant: 5,
            unitType: 1,
            unitVariant: 0,
            name: "Cloaking Device",
            description: "This hides tanks from enemy towers, only spotters can see the tanks.",
            cost: 2000,
            size: BuildingSizes.ARMORY.size,
            next: []
        },
        BOOSTER_CLOAK_COMBO: {
            variant: 6,
            unitType: 1,
            unitVariant: 2,
            name: "Cloaking Device",
            description: "This hides tanks from enemy towers, only spotters can see the tanks.",
            cost: 2000,
            size: BuildingSizes.ARMORY.size,
            next: [BuildingVariantTypes.ARMORY.PANZER_BOOSTER_CLOAK_COMBO]
        },
        PANZER_CLOAK_COMBO: {
            variant: 7,
            unitType: 1,
            unitVariant: 3,
            name: "Cloaking Device",
            description: "This hides tanks from enemy towers, only spotters can see the tanks.",
            cost: 2000,
            size: BuildingSizes.ARMORY.size,
            next: [BuildingVariantTypes.ARMORY.PANZER_BOOSTER_CLOAK_COMBO]
        },
        PANZER_BOOSTER_CLOAK_COMBO: {
            variant: 8,
            unitType: 1,
            unitVariant: 5,
            name: "Cloaking Device",
            description: "This hides tanks from enemy towers, only spotters can see the tanks.",
            cost: 2000,
            size: BuildingSizes.ARMORY.size,
            next: []
        }
    },
    BARRACKS: {
        BASIC: {
            variant: BuildingVariantTypes.BARRACKS.BASIC,
            name: "Barracks",
            description: "Produces soldiers over time.",
            cost: 150,
            size: BuildingSizes.BARRACKS.size,
            next: [
                BuildingVariantTypes.BARRACKS.GREATER_BARRACKS,
                BuildingVariantTypes.BARRACKS.TANK_FACTORY,
                BuildingVariantTypes.BARRACKS.SIEGE_TANK_FACTORY
            ]
        },
        GREATER_BARRACKS: {
            variant: BuildingVariantTypes.BARRACKS.GREATER_BARRACKS,
            name: "Greater Barracks",
            description: "Produces soldiers at a faster rate.",
            cost: 500,
            size: BuildingSizes.BARRACKS.size,
            next: []
        },
        TANK_FACTORY: {
            variant: BuildingVariantTypes.BARRACKS.TANK_FACTORY,
            name: "Tank Factory",
            description: "Slowly produces tanks over time.",
            cost: 2000,
            size: BuildingSizes.BARRACKS.size,
            next: []
        },
        SIEGE_TANK_FACTORY: {
            variant: BuildingVariantTypes.BARRACKS.SIEGE_TANK_FACTORY,
            name: "Siege Factory",
            description: "Produces siege tanks over time.",
            cost: 3000,
            size: BuildingSizes.BARRACKS.size,
            next: []
        },
    },
    GENERATOR: {
        BASIC: {
            variant: BuildingVariantTypes.GENERATOR.BASIC,
            name: "Generator",
            description: "Basic power supply.",
            cost: 50,
            size: BuildingSizes.GENERATOR.size,
            next: [BuildingVariantTypes.GENERATOR.POWER_PLANT]
        },
        POWER_PLANT: {
            variant: BuildingVariantTypes.GENERATOR.POWER_PLANT,
            name: "Power Plant",
            description: "Increased energy output.",
            cost: 100,
            size: BuildingSizes.GENERATOR.size,
            next: []
        }
    },
    HOUSE: {
        BASIC: {
            variant: BuildingVariantTypes.HOUSE.BASIC,
            name: "House",
            description: "Increases population limit.",
            cost: 60,
            size: BuildingSizes.HOUSE.size,
            next: [BuildingVariantTypes.HOUSE.LARGE_HOUSE]
        },
        LARGE_HOUSE: {
            variant: BuildingVariantTypes.HOUSE.LARGE_HOUSE,
            name: "Large House",
            description: "Increases population limit.",
            cost: 120,
            size: BuildingSizes.HOUSE.size,
            next: []
        },
    }
};

export const BulletTypes = {
    BASIC: 0,
    TRAPPER: 1
}

export const BulletDetails = {
    SIMPLE_TURRET: {
        BASIC: {
            type: BulletTypes.BASIC,
            speed: 500,
            size: 10
        },
        RAPID_TURRET: {
            type: BulletTypes.BASIC,
            speed: 500,
            size: 10
        },
        GATLING_TURRET: {
            type: BulletTypes.BASIC,
            speed: 600,
            size: 8
        },
        HEAVY_TURRET: {
            type: BulletTypes.BASIC,
            speed: 800,
            size: 12
        }
    },
    SNIPER_TURRET: {
        BASIC: {
            type: BulletTypes.BASIC,
            speed: 800,
            size: 10
        },
        SEMI_AUTOMATIC_SNIPER: {
            type: BulletTypes.BASIC,
            speed: 800,
            size: 10
        },
        HEAVY_SNIPER: {
            type: BulletTypes.BASIC,
            speed: 900,
            size: 12
        },
        ANTI_TANK_GUN: {
            type: BulletTypes.BASIC,
            speed: 1000,
            size: 12
        },
        TRAPPER: {
            type: BulletTypes.TRAPPER,
            speed: 300,
            size: 20
        },
    }
};

export const UnitTypes = {
    SOLDIER: 0,
    TANK: 1,
    SIEGE_TANK: 2,
    COMMANDER: 3,
    TRI_COMMANDER: 4,
};

export const UnitVariantTypes = {
    SOLDIER: {
        BASIC: 0,
        LIGHT_ARMOR: 1,
    },
    TANK: {
        BASIC: 0,
        HEAVY_ARMOR: 1,
        BOOSTER_ENGINE: 2,
        CANNON: 3,
        HEAVY_ARMOR_BOOSTER_ENGINE: 4,
        BOOSTER_ENGINE_CANNON: 5
    },
    SIEGE_TANK: {
        BASIC: 0,
        HEAVY_ARMOR: 1,
        BOOSTER_ENGINE: 2,
        CANNON: 3,
        HEAVY_ARMOR_BOOSTER_ENGINE: 4,
        BOOSTER_ENGINE_CANNON: 5
    },
    COMMANDER: {
        BASIC: 0,
    },
    TRI_COMMANDER: {
        BASIC: 0,
    }
};

export const UnitDetails = {
    SOLDIER: {
        BASIC: {
            variant: UnitVariantTypes.SOLDIER.BASIC,
            size: 18,
        },
        LIGHT_ARMOR: {
            variant: UnitVariantTypes.SOLDIER.LIGHT_ARMOR,
            size: 18,
        },
    },
    TANK: {
        BASIC: {
            variant: UnitVariantTypes.TANK.BASIC,
            size: 31,
        },
        HEAVY_ARMOR: {
            variant: UnitVariantTypes.TANK.HEAVY_ARMOR,
            size: 31,
        },
        BOOSTER_ENGINE: {
            variant: UnitVariantTypes.TANK.BOOSTER_ENGINE,
            size: 31,
        },
        CANNON: {
            variant: UnitVariantTypes.TANK.CANNON,
            size: 31,
        },
        HEAVY_ARMOR_BOOSTER_ENGINE: {
            variant: UnitVariantTypes.TANK.HEAVY_ARMOR_BOOSTER_ENGINE,
            size: 31,
        },
        BOOSTER_ENGINE_CANNON: {
            variant: UnitVariantTypes.TANK.BOOSTER_ENGINE_CANNON,
            size: 31,
        }
    },
    SIEGE_TANK: {
        BASIC: {
            variant: UnitVariantTypes.SIEGE_TANK.BASIC,
            size: 40,
        },
        HEAVY_ARMOR: {
            variant: UnitVariantTypes.SIEGE_TANK.HEAVY_ARMOR,
            size: 40,
        },
        BOOSTER_ENGINE: {
            variant: UnitVariantTypes.SIEGE_TANK.BOOSTER_ENGINE,
            size: 40,
            next: []
        },
        CANNON: {
            variant: UnitVariantTypes.SIEGE_TANK.CANNON,
            size: 40,
            next: []
        },
        HEAVY_ARMOR_BOOSTER_ENGINE: {
            variant: UnitVariantTypes.SIEGE_TANK.HEAVY_ARMOR_BOOSTER_ENGINE,
            size: 40,
        },
        BOOSTER_ENGINE_CANNON: {
            variant: UnitVariantTypes.SIEGE_TANK.BOOSTER_ENGINE_CANNON,
            size: 40,
        }
    },
    COMMANDER: {
        BASIC: {
            variant: UnitVariantTypes.COMMANDER.BASIC,
            name: "Commander",
            description: "Powerful unit, you can only have 1",
            cost: 5000,
            size: 32,
        },
    },
    TRI_COMMANDER: {
        BASIC: {
            variant: UnitVariantTypes.TRI_COMMANDER.BASIC,
            name: "Anti-Tank Commander",
            description: "",
            cost: 5000,
            size: 40,
        },
    },
};

export const UnitBulletDetails = {
    TANK: {
        type: UnitTypes.TANK,
        CANNON: {
            variant: UnitVariantTypes.TANK.CANNON,
            type: BulletTypes.BASIC,
            speed: 500,
            size: 6
        },
        BOOSTER_ENGINE_CANNON: {
            variant: UnitVariantTypes.TANK.BOOSTER_ENGINE_CANNON,
            type: BulletTypes.BASIC,
            speed: 500,
            size: 6
        }
    },
    SIEGE_TANK: {
        type: UnitTypes.SIEGE_TANK,
        CANNON: {
            variant: UnitVariantTypes.SIEGE_TANK.CANNON,
            type: BulletTypes.BASIC,
            speed: 500,
            size: 8
        },
        BOOSTER_ENGINE_CANNON: {
            variant: UnitVariantTypes.SIEGE_TANK.BOOSTER_ENGINE_CANNON,
            type: BulletTypes.BASIC,
            speed: 500,
            size: 8
        }
    },
    COMMANDER: {
        type: UnitTypes.COMMANDER,
        BASIC: {
            variant: UnitVariantTypes.COMMANDER.BASIC,
            type: BulletTypes.BASIC,
            speed: 700,
            size: 12
        },
    }
}

export function getAvailableUnitUpgrades (unitType, unitVariant) {
    // Find the key corresponding to the unitType
    const unitKey = Object.keys(UnitTypes).find(key => UnitTypes[key] === unitType);

    // Retrieve upgrade details for the unitType
    const details = Object.values(UnitDetails[unitKey])[unitVariant];
    let availableUpgrades = [];
    details.next.forEach(unit => {
        availableUpgrades.push(Object.values(UnitDetails[unitKey])[unit]);
    });

    return availableUpgrades;
}

export function getUnitDetails (unitType, unitVariant) {
    const unitKey = Object.keys(UnitTypes).find(key => UnitTypes[key] === unitType);
    const details = Object.values(UnitDetails[unitKey])[unitVariant];
    return details;
}

export function getBulletDetails (buildingType, buildingVariant) {
    // Find the key corresponding to the buildingType
    const buildingKey = Object.keys(BuildingTypes).find(key => BuildingTypes[key] === buildingType);
    const details = Object.values(BulletDetails[buildingKey])[buildingVariant];
    return details;
}

export function getUnitBulletDetails (unitType, unitVariant) {
    // Find the key corresponding to the unitType in UnitBulletDetails
    const unitKey = Object.keys(UnitBulletDetails).find(
        key => UnitBulletDetails[key].type === unitType
    );

    // Ensure the unit type exists in UnitBulletDetails
    if (unitKey) {
        const unitDetails = UnitBulletDetails[unitKey];

        // Now find the variant that matches the provided unitVariant
        const variantKey = Object.keys(unitDetails).find(
            key => unitDetails[key].variant === unitVariant
        );

        // If a variant is found, return its details
        if (variantKey) {
            const bulletDetail = unitDetails[variantKey];
            return bulletDetail;
        }
    }

    return null; // Handle the case where the unit or variant doesn't exist
}


export function getAvailableBuildingUpgrades (buildingType, buildingVariant, purchasedVariants = []) {
    // Find the key corresponding to the buildingType
    const buildingKey = Object.keys(BuildingTypes).find(key => BuildingTypes[key] === buildingType);

    // Armory: allow buying any upgrade without order, hide purchased upgrades.
    if (buildingType === BuildingTypes.ARMORY) {
        const purchased = new Set(purchasedVariants);
        const armoryDetails = Object.values(BuildingDetails[buildingKey]);
        const visibleArmoryVariants = new Set([
            BuildingVariantTypes.ARMORY.POWER_ARMOR,
            BuildingVariantTypes.ARMORY.BOOSTER_ENGINES,
            BuildingVariantTypes.ARMORY.PANZER_CANNONS,
            BuildingVariantTypes.ARMORY.CLOAKING_DEVICE
        ]);
        return armoryDetails.filter(detail =>
            detail &&
            visibleArmoryVariants.has(detail.variant) &&
            !purchased.has(detail.variant)
        );
    }

    // Retrieve upgrade details for the buildingType
    const details = Object.values(BuildingDetails[buildingKey])[buildingVariant];
    let availableUpgrades = [];
    details.next.forEach(building => {
        availableUpgrades.push(Object.values(BuildingDetails[buildingKey])[building]);
    });

    return availableUpgrades;
}

export function getBuildingDetails (buildingType, buildingVariant = 0) {
    // Find the key corresponding to the buildingType
    const buildingKey = Object.keys(BuildingTypes).find(key => BuildingTypes[key] === buildingType);

    // Retrieve upgrade details for the buildingType and upgradeLevel
    const details = Object.values(BuildingDetails[buildingKey])[buildingVariant];
    return details;
}

export function calculateRequiredXP(level, baseXP = 50){
    return Math.round(baseXP * Math.pow(level, 1.1));
}

export function getColorForLevel(level) {
    // Ensure the level is between 0 and 100
    level = Math.min(100, Math.max(0, level));
  
    // Calculate the gradient ratio
    const gradientRatio = level / 100;
  
    const colors = [
        "#60eaff", "#a0c7f9", "#61b0ff", "#9e82f6", "#61ffb0", "#7aff60", 
        "#7bdc6a", "#3fc6a8", "#ffda48", "#ffb061", "#d88166", "#ff6a4d", 
        "#ff605f", "#d16aa5", "#ff6ef1"
    ];
  
    // Calculate the index and the ratio between two colors
    const numStops = colors.length;
    const stopIndex = Math.floor(gradientRatio * (numStops - 1));
    const nextStopIndex = Math.min(stopIndex + 1, numStops - 1);
    const stopRatio = (gradientRatio * (numStops - 1)) - stopIndex;
  
    // Extract the RGB values from the two closest colors
    const getColorRgb = (hex) => {
        const bigint = parseInt(hex.slice(1), 16);
        return {
            r: (bigint >> 16) & 255,
            g: (bigint >> 8) & 255,
            b: bigint & 255,
        };
    };

    const color1 = getColorRgb(colors[stopIndex]);
    const color2 = getColorRgb(colors[nextStopIndex]);
  
    // Interpolate between the two colors
    const r = Math.round(color1.r + (color2.r - color1.r) * stopRatio);
    const g = Math.round(color1.g + (color2.g - color1.g) * stopRatio);
    const b = Math.round(color1.b + (color2.b - color1.b) * stopRatio);

    // Adjust colors to ensure better contrast with white text
    const adjustForContrast = (r, g, b) => {
        // If the color is too light, darken it slightly
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b);
        if (luminance > 200) {  // Bright colors
            r = Math.max(0, r - 30); // Darken slightly
            g = Math.max(0, g - 30);
            b = Math.max(0, b - 30);
        }
        return { r, g, b };
    };

    const adjustedColor = adjustForContrast(r, g, b);
  
    // Return the new color as a hex code
    return `#${((1 << 24) + (adjustedColor.r << 16) + (adjustedColor.g << 8) + adjustedColor.b).toString(16).slice(1)}`;
}

export function darkenColor (hex, percent) {
    // Convert HEX to RGB
    let r = 0, g = 0, b = 0;

    if (hex.length === 4) { // 3 digits
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) { // 6 digits
        r = parseInt(hex[1] + hex[2], 16);
        g = parseInt(hex[3] + hex[4], 16);
        b = parseInt(hex[5] + hex[6], 16);
    }

    // Darken each color component
    r = Math.floor(r * (1 - percent / 100));
    g = Math.floor(g * (1 - percent / 100));
    b = Math.floor(b * (1 - percent / 100));

    // Convert RGB back to HEX
    return rgbToHex(r, g, b);
}

function rgbToHex (r, g, b) {
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
