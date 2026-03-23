package game

type BuildingType byte
type BuildingVariant byte
type UnitType byte
type UnitVariant byte
type Permission byte

const (
	WALL          BuildingType = 0
	SIMPLE_TURRET BuildingType = 1
	SNIPER_TURRET BuildingType = 2
	ARMORY        BuildingType = 3
	BARRACKS      BuildingType = 4
	PORTAL        BuildingType = 5
	GENERATOR     BuildingType = 6
	HOUSE         BuildingType = 7
)

const (
	// Default
	BASIC_BUILDING BuildingVariant = 0

	// Wall
	BOULDER         BuildingVariant = 1
	SPIKE           BuildingVariant = 2
	MICRO_GENERATOR BuildingVariant = 3

	// Simple Turret
	RAPID_TURRET   BuildingVariant = 1
	GATLING_TURRET BuildingVariant = 2
	HEAVY_TURRET   BuildingVariant = 3
	RAGE_TURRET    BuildingVariant = 4
	RANGED_TURRET  BuildingVariant = 5
	SPOTTER_TURRET BuildingVariant = 6
	TWIN_TURRET    BuildingVariant = 7

	// Sniper Turret
	SEMI_AUTOMATIC_SNIPER BuildingVariant = 1
	HEAVY_SNIPER          BuildingVariant = 2
	ANTI_TANK_GUN         BuildingVariant = 3

	TRAPPER       BuildingVariant = 4
	HEAVY_TRAPPER BuildingVariant = 5

	// Barracks
	GREATER_BARRACKS BuildingVariant = 1
	TANK_FACTORY     BuildingVariant = 2

	HEAVY_TANK_FACTORY   BuildingVariant = 3
	BOOSTER_TANK_FACTORY BuildingVariant = 4

	CANNON_TANK_FACTORY         BuildingVariant = 5
	SIEGE_TANK_FACTORY          BuildingVariant = 6
	HEAVY_BOOSTER_TANK_FACTORY  BuildingVariant = 7
	BOOSTER_CANNON_TANK_FACTORY BuildingVariant = 8

	HEAVY_SIEGE_TANK_FACTORY   BuildingVariant = 9
	BOOSTER_SIEGE_TANK_FACTORY BuildingVariant = 10

	CANNON_SIEGE_TANK_FACTORY         BuildingVariant = 11
	HEAVY_BOOSTER_SIEGE_TANK_FACTORY  BuildingVariant = 12
	BOOSTER_CANNON_SIEGE_TANK_FACTORY BuildingVariant = 13

	// House
	POWER_PLANT BuildingVariant = 1
	LARGE_HOUSE BuildingVariant = 1
)

const (
	SOLDIER    UnitType = 0
	TANK       UnitType = 1
	SIEGE_TANK UnitType = 2
	COMMANDER  UnitType = 3
)

const (
	BASIC_UNIT UnitVariant = 0

	LIGHT_ARMOR_SOLDIER UnitVariant = 1

	HEAVY_ARMOR_TANK                UnitVariant = 1
	BOOSTER_ENGINE_TANK             UnitVariant = 2
	CANNON_TANK                     UnitVariant = 3
	HEAVY_ARMOR_BOOSTER_ENGINE_TANK UnitVariant = 4
	BOOSTER_ENGINE_CANNON_TANK      UnitVariant = 5

	HEAVY_ARMOR_SIEGE_TANK                UnitVariant = 1
	BOOSTER_ENGINE_SIEGE_TANK             UnitVariant = 2
	CANNON_SIEGE_TANK                     UnitVariant = 3
	HEAVY_ARMOR_BOOSTER_ENGINE_SIEGE_TANK UnitVariant = 4
	BOOSTER_ENGINE_CANNON_SIEGE_TANK      UnitVariant = 5
)

const (
	PERMISSION_NONE      Permission = 0 // User with no special permissions
	PERMISSION_MODERATOR Permission = 1 // Moderator has limited access
	PERMISSION_ADMIN     Permission = 2 // Admin has full access
)

const (
	// Player configuration
	PLAYER_INITIAL_POPULATION = 8
	PLAYER_INITIAL_HEALTH     = 2000
	PLAYER_INITIAL_POWER      = 1500
	PLAYER_MAX_POWER          = 6000
	// Base is considered defeated at or below this percentage of max health.
	PLAYER_CORE_ELIMINATION_PERCENT = 35

	// Player timeout and protection settings
	PLAYER_TIMEOUT                  = 10 // Minutes
	PLAYER_INACTIVITY_WARNING_DELAY = 1  // Minutes before showing AFK warning
	PLAYER_SPAWN_PROTECTION_TIME    = 2  // Minutes
	PLAYER_SPAWN_PROTECTION_RADIUS  = 306 + 145
	PORTAL_LIFETIME_SECONDS         = 30
	PORTAL_COOLDOWN_SECONDS         = 300

	// Player health regeneration settings
	PLAYER_HEALTH_REGENERATION           = 30
	PLAYER_HEALTH_REGENERATION_FREQUENCY = 30 // Seconds
	// Commander regeneration disabled by request.
	COMMANDER_HEALTH_REGENERATION           = 0 // HP per tick
	COMMANDER_HEALTH_REGENERATION_FREQUENCY = 120 // Seconds (2 minutes)
	COMMANDER_HEALTH_REGENERATION_DELAY     = 120 // Seconds without taking damage

	// Player building settings
	PLAYER_MAX_BUILDING_RADIUS = 306
	PLAYER_MIN_BUILDING_RADIUS = 99
	// Outer wall ring offset (tightened by 1px from previous setting).
	WALL_OUTER_RING_OFFSET = 3
	// Barracks stay on legacy ExternaTK outer ring.
	BARRACKS_OUTER_RING_OFFSET = 5
	// Core matches inner ring baseline to keep first-row buildings visually tight.
	PLAYER_MAX_CORE_RADIUS = PLAYER_MIN_BUILDING_RADIUS

	// Neutral base configuration
	NEUTRAL_BASE_POPULATION                    = 32
	NEUTRAL_BASE_INITIAL_HEALTH                = 1000
	NEUTRAL_BASE_HEALTH_REGENERATION           = 50
	NEUTRAL_BASE_HEALTH_REGENERATION_FREQUENCY = 30 // Seconds
	NEUTRAL_BASE_MAX_BUILDING_RADIUS           = 260
	NEUTRAL_BASE_MIN_BUILDING_RADIUS           = 70
	NEUTRAL_BASE_MAX_CORE_RADIUS               = NEUTRAL_BASE_MIN_BUILDING_RADIUS
	NEUTRAL_BASE_CAPTURE_SCORE                 = 10 // Per Second

	// Unit and detection settings
	// Spawn units closer to barracks to avoid long gap after outer-ring placement.
	BARRACKS_UNIT_SPAWN_RADIUS = 68
	UNIT_DETECTION_RADIUS      = 1000

	KICK_REASON_TIMEOUT   = 0
	KICK_REASON_SCRIPTING = 1

	COMMANDER_COST     = 1500
	RELOCATE_BASE_COST = 4000
	// Commander deals amplified damage only when ramming a core/nucleus.
	COMMANDER_CORE_DAMAGE_MULTIPLIER = 3
	// Soldiers are swarms; boost only when colliding with enemy core.
	SOLDIER_CORE_DAMAGE_MULTIPLIER = 3
	// No extra modifier: commander survivability is balanced through commander health.
	SOLDIER_VS_COMMANDER_DAMAGE_MULTIPLIER = 1

	// Spawn settings
	MIN_PLAYER_SPAWN_DISTANCE = 1500 // Minimum distance between player spawns
	MIN_BORDER_DISTANCE       = 500  // Minimum distance from map borders
	PLAYER_SPAWN_CLEAR_RADIUS = 600  // Radius to clear objects around spawn
)
