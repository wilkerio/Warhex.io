package game

import (
	"math"
	"sync"
	"time"
)

type Building struct {
	Owner                 Owner // Specifies the owner of the building, which can be a player or a neutral base
	ID                    ID
	Type                  BuildingType
	Variant               BuildingVariant
	PlacementRotationStep uint8
	Position              PositionFloat
	PlacedAt              time.Time
	Polygon               Polygon
	Health                Health
	RemoveFlag            bool // Flag to mark unit for removal
	sync.RWMutex
}

func (b *Building) GetRotation() float64 {
	return b.Polygon.Rotation + b.Polygon.rotationOffset
}

func (b *Building) GetObjectPointer() interface{} {
	return b
}

func (b *Building) IsMarkedForRemoval() bool {
	return b.RemoveFlag
}

func (b *Building) MarkForRemoval() {
	b.RemoveFlag = true
}

func (b *Building) TakeDamage(amount uint16) bool {
	b.Health.Decrement(amount)
	return b.Health.IsAlive()
}

func (b *Building) GetPosition() PositionFloat {
	return b.Position
}

type BuildingUpgrade struct {
	Variant BuildingVariant
	Health  Health
	Damage  uint16
	Next    []BuildingVariant
	Cost    uint16
}

var buildingTypes = map[BuildingType]map[BuildingVariant]BuildingUpgrade{
		WALL: {
			BASIC_BUILDING: {
				Variant: BASIC_BUILDING,
				Health:  Health{Current: 100, Max: 100},
				Damage:  50,
				Next:    []BuildingVariant{MICRO_GENERATOR, BOULDER},
				Cost:    60,
			},
		MICRO_GENERATOR: {
			Variant: MICRO_GENERATOR,
			Health:  Health{Current: 50, Max: 50},
			Damage:  10,
			Next:    nil,
			Cost:    30,
		},
			BOULDER: {
				Variant: BOULDER,
				Health:  Health{Current: 180, Max: 180},
				Damage:  60,
				Next:    []BuildingVariant{SPIKE},
				Cost:    60,
			},
			SPIKE: {
				Variant: SPIKE,
				Health:  Health{Current: 300, Max: 300},
				Damage:  130,
				Next:    nil,
				Cost:    200,
			},
		},
	SIMPLE_TURRET: {
		BASIC_BUILDING: {
			Variant: BASIC_BUILDING,
			Health:  Health{Current: 20, Max: 20},
			Damage:  20,
			Next:    []BuildingVariant{RAPID_TURRET, HEAVY_TURRET, RANGED_TURRET},
			Cost:    25,
		},
		RAPID_TURRET: {
			Variant: RAPID_TURRET,
			Health:  Health{Current: 20, Max: 20},
			Damage:  20,
			Next:    []BuildingVariant{GATLING_TURRET},
			Cost:    60,
		},
		GATLING_TURRET: {
			Variant: GATLING_TURRET,
			Health:  Health{Current: 20, Max: 20},
			Damage:  15,
			Next:    nil,
			Cost:    100,
		},
		HEAVY_TURRET: {
			Variant: HEAVY_TURRET,
			Health:  Health{Current: 30, Max: 30},
			Damage:  30,
			Next:    nil,
			Cost:    60,
		},
		RAGE_TURRET: {
			Variant: RAGE_TURRET,
			Health:  Health{Current: 30, Max: 30},
			Damage:  18,
			Next:    nil,
			Cost:    180,
		},
		RANGED_TURRET: {
			Variant: RANGED_TURRET,
			Health:  Health{Current: 20, Max: 20},
			Damage:  30,
			Next:    []BuildingVariant{TWIN_TURRET},
			Cost:    60,
		},
		TWIN_TURRET: {
			Variant: TWIN_TURRET,
			Health:  Health{Current: 26, Max: 26},
			Damage:  24,
			Next:    []BuildingVariant{SPOTTER_TURRET},
			Cost:    80,
		},
		SPOTTER_TURRET: {
			Variant: SPOTTER_TURRET,
			Health:  Health{Current: 30, Max: 30},
			Damage:  30,
			Next:    []BuildingVariant{RAGE_TURRET},
			Cost:    100,
		},
	},
	SNIPER_TURRET: {
		BASIC_BUILDING: {
			Variant: BASIC_BUILDING,
			Health:  Health{Current: 30, Max: 30},
			Damage:  30,
			Next:    []BuildingVariant{SEMI_AUTOMATIC_SNIPER, HEAVY_SNIPER},
			Cost:    80,
		},
		SEMI_AUTOMATIC_SNIPER: {
			Variant: SEMI_AUTOMATIC_SNIPER,
			Health:  Health{Current: 60, Max: 60},
			Damage:  30,
			Next:    nil,
			Cost:    180,
		},
		HEAVY_SNIPER: {
			Variant: HEAVY_SNIPER,
			Health:  Health{Current: 60, Max: 60},
			Damage:  30,
			Next:    []BuildingVariant{TRAPPER, ANTI_TANK_GUN},
			Cost:    180,
		},
		ANTI_TANK_GUN: {
			Variant: ANTI_TANK_GUN,
			Health:  Health{Current: 60, Max: 60},
			Damage:  30,
			Next:    nil,
			Cost:    300,
		},
		TRAPPER: {
			Variant: TRAPPER,
			Health:  Health{Current: 100, Max: 100},
			Damage:  30,
			Next:    nil,
			Cost:    550,
		},
	},
	ARMORY: {
		BASIC_BUILDING: {
			Variant: BASIC_BUILDING,
			Health:  Health{Current: 90, Max: 90},
			Damage:  30,
			Next:    []BuildingVariant{BuildingVariant(1), BuildingVariant(2), BuildingVariant(3), BuildingVariant(5)},
			Cost:    100,
		},
		BuildingVariant(1): {
			Variant: BuildingVariant(1),
			Health:  Health{Current: 90, Max: 90},
			Damage:  30,
			Next:    []BuildingVariant{BuildingVariant(2), BuildingVariant(3), BuildingVariant(5)},
			Cost:    500,
		},
		BuildingVariant(2): {
			Variant: BuildingVariant(2),
			Health:  Health{Current: 90, Max: 90},
			Damage:  30,
			Next:    []BuildingVariant{BuildingVariant(4), BuildingVariant(6)},
			Cost:    600,
		},
		BuildingVariant(3): {
			Variant: BuildingVariant(3),
			Health:  Health{Current: 90, Max: 90},
			Damage:  30,
			Next:    []BuildingVariant{BuildingVariant(7)},
			Cost:    1000,
		},
		BuildingVariant(4): {
			Variant: BuildingVariant(4),
			Health:  Health{Current: 90, Max: 90},
			Damage:  30,
			Next:    []BuildingVariant{BuildingVariant(8)},
			Cost:    1000,
		},
		BuildingVariant(5): {
			Variant: BuildingVariant(5),
			Health:  Health{Current: 90, Max: 90},
			Damage:  30,
			Next:    nil,
			Cost:    2000,
		},
		BuildingVariant(6): {
			Variant: BuildingVariant(6),
			Health:  Health{Current: 90, Max: 90},
			Damage:  30,
			Next:    []BuildingVariant{BuildingVariant(8)},
			Cost:    2000,
		},
		BuildingVariant(7): {
			Variant: BuildingVariant(7),
			Health:  Health{Current: 90, Max: 90},
			Damage:  30,
			Next:    []BuildingVariant{BuildingVariant(8)},
			Cost:    2000,
		},
		BuildingVariant(8): {
			Variant: BuildingVariant(8),
			Health:  Health{Current: 90, Max: 90},
			Damage:  30,
			Next:    nil,
			Cost:    2000,
		},
	},
	BARRACKS: {
		BASIC_BUILDING: {
			Variant: BASIC_BUILDING,
			Health:  Health{Current: 60, Max: 60},
			Damage:  30,
			Next:    []BuildingVariant{GREATER_BARRACKS, TANK_FACTORY, SIEGE_TANK_FACTORY},
			Cost:    150,
		},
		GREATER_BARRACKS: {
			Variant: GREATER_BARRACKS,
			Health:  Health{Current: 80, Max: 80},
			Damage:  40,
			Next:    nil,
			Cost:    500,
		},
		TANK_FACTORY: {
			Variant: TANK_FACTORY,
			Health:  Health{Current: 140, Max: 140},
			Damage:  50,
			Next:    nil,
			Cost:    2000,
		},
		SIEGE_TANK_FACTORY: {
			Variant: SIEGE_TANK_FACTORY,
			Health:  Health{Current: 200, Max: 200},
			Damage:  100,
			Next:    nil,
			Cost:    3000,
		},
	},
	PORTAL: {
		BASIC_BUILDING: {
			Variant: BASIC_BUILDING,
			Health:  Health{Current: 120, Max: 120},
			Damage:  0,
			Next:    []BuildingVariant{},
			Cost:    2500,
		},
	},
	GENERATOR: {
		BASIC_BUILDING: {
			Variant: BASIC_BUILDING,
			Health:  Health{Current: 50, Max: 50},
			Damage:  10,
			Next:    []BuildingVariant{POWER_PLANT},
			Cost:    50,
		},
		POWER_PLANT: {
			Variant: POWER_PLANT,
			Health:  Health{Current: 80, Max: 80},
			Damage:  10,
			Next:    nil,
			Cost:    100,
		},
	},
	HOUSE: {
		BASIC_BUILDING: {
			Variant: BASIC_BUILDING,
			Health:  Health{Current: 40, Max: 40},
			Damage:  10,
			Next:    []BuildingVariant{LARGE_HOUSE},
			Cost:    60,
		},
		LARGE_HOUSE: {
			Variant: LARGE_HOUSE,
			Health:  Health{Current: 60, Max: 60},
			Damage:  10,
			Next:    []BuildingVariant{},
			Cost:    120,
		},
	},
}

var buildingSizes = map[BuildingType]int{
	WALL:          27,
	SIMPLE_TURRET: 29,
	SNIPER_TURRET: 32,
	ARMORY:        36,
	BARRACKS:      64,
	PORTAL:        40,
	GENERATOR:     32,
	HOUSE:         32,
}

type BuildingLimit struct {
	Current int
	Max     int
}

var resourceGeneration = map[BuildingType]map[BuildingVariant]Generating{
	WALL: {
		MICRO_GENERATOR: Generating{Power: 1},
	},
	GENERATOR: {
		BASIC_BUILDING: Generating{Power: 1},
		POWER_PLANT:    Generating{Power: 2},
	},
}

var populationCapacity = map[BuildingType]map[BuildingVariant]uint16{
	HOUSE: {
		BASIC_BUILDING: 3,
		LARGE_HOUSE:    6,
	},
}

var unitSpawningConfig = map[BuildingType]map[BuildingVariant]UnitSpawning{
	BARRACKS: {
		// Soldiers
		BASIC_BUILDING: UnitSpawning{
			Barracks:    nil,
			UnitType:    SOLDIER,
			UnitVariant: BASIC_UNIT,
			Frequency:   SpawnFrequency{Current: 0, Original: 3500},
		},
		GREATER_BARRACKS: UnitSpawning{
			Barracks:    nil,
			UnitType:    SOLDIER,
			UnitVariant: BASIC_UNIT,
			Frequency:   SpawnFrequency{Current: 0, Original: 2500},
		},
		// Tanks
		TANK_FACTORY: UnitSpawning{
			Barracks:    nil,
			UnitType:    TANK,
			UnitVariant: BASIC_UNIT,
			Frequency:   SpawnFrequency{Current: 0, Original: 10000},
		},
		// Siege Tanks
		SIEGE_TANK_FACTORY: UnitSpawning{
			Barracks:    nil,
			UnitType:    SIEGE_TANK,
			UnitVariant: BASIC_UNIT,
			Frequency:   SpawnFrequency{Current: 0, Original: 20000},
		},
	},
}

var wallPolygon = func() Polygon {
	// Wall collision must match the client wall footprint (no hidden +2 offset).
	polygon := InitCirclePolygonWithOffset(GetBuildingSize(WALL), 0)
	polygon.rotationOffset = math.Pi / 2
	return polygon
}()

var buildingPolygons = map[BuildingType]Polygon{
	BARRACKS:      GeneratePolygon(ShapeRectangle, GetBuildingSize(BARRACKS), math.Pi),
	PORTAL:        GeneratePolygon(ShapeCircle, GetBuildingSize(PORTAL), math.Pi/2),
	GENERATOR:     GeneratePolygon(ShapeHexagon, GetBuildingSize(GENERATOR), math.Pi/2),
	HOUSE:         GeneratePolygon(ShapePentagon, GetBuildingSize(HOUSE), 0),
	SIMPLE_TURRET: GeneratePolygon(ShapeCircle, GetBuildingSize(SIMPLE_TURRET), math.Pi/2),
	SNIPER_TURRET: GeneratePolygon(ShapeCircle, GetBuildingSize(SNIPER_TURRET), math.Pi/2),
	ARMORY:        GeneratePolygon(ShapeCircle, GetBuildingSize(ARMORY), math.Pi/2),
	WALL:          wallPolygon,
}

func GetBuildingPolygon(buildingType BuildingType) (Polygon, bool) {
	polygon, ok := buildingPolygons[buildingType]
	return polygon, ok
}

func GetInitialHealth(buildingType BuildingType, buildingVariant BuildingVariant) Health {
	if upgrades, ok := buildingTypes[buildingType]; ok {
		if building, ok := upgrades[buildingVariant]; ok {
			return building.Health
		}
	}
	return Health{}
}

func GetBuildingSize(buildingType BuildingType) int {
	return buildingSizes[buildingType]
}

func GetBuildingCost(buildingType BuildingType, buildingVariant BuildingVariant) (uint16, bool) {
	if upgrades, ok := buildingTypes[buildingType]; ok {
		if upgrade, ok := upgrades[buildingVariant]; ok {
			return upgrade.Cost, true
		}
	}
	return 0, false
}

func GetBuildingContactDamage(buildingType BuildingType, buildingVariant BuildingVariant) (uint16, bool) {
	if upgrades, ok := buildingTypes[buildingType]; ok {
		if upgrade, ok := upgrades[buildingVariant]; ok {
			return upgrade.Damage, true
		}
	}
	return 0, false
}

func GetResourceGeneration(buildingType BuildingType, buildingVariant BuildingVariant) (Generating, bool) {
	if generatingMap, ok := resourceGeneration[buildingType]; ok {
		if generating, ok := generatingMap[buildingVariant]; ok {
			return generating, true
		}
	}
	return Generating{}, false
}

func GetPopulationCapacity(buildingType BuildingType, buildingVariant BuildingVariant) (uint16, bool) {
	if capacityMap, ok := populationCapacity[buildingType]; ok {
		// Check if buildingVariant exists in the nested map
		if capacity, ok := capacityMap[buildingVariant]; ok {
			return capacity, true // Found Capacity configuration
		}
	}
	return 0, false // Not found
}

func GetUnitSpawning(buildingVariant BuildingVariant) (UnitSpawning, bool) {
	// Check if barracks type exists in unitSpawning map
	if config, ok := unitSpawningConfig[BARRACKS]; ok {
		// Check if buildingVariant exists in the nested map
		if spawning, ok := config[buildingVariant]; ok {
			return spawning, true // Found UnitSpawning configuration
		}
	}
	return UnitSpawning{}, false // Not found
}

func ValidateBuildingType(buildingType BuildingType) bool {
	if upgrades, ok := buildingTypes[buildingType]; ok {
		if _, ok := upgrades[BASIC_BUILDING]; ok {
			return true
		}
	}
	return false
}

func ValidateUpgradePath(buildingType BuildingType, currentVariant, targetVariant BuildingVariant) bool {
	if upgrades, ok := buildingTypes[buildingType]; ok {
		if buildingType == ARMORY {
			if targetVariant == BASIC_BUILDING || targetVariant == currentVariant {
				return false
			}
			_, exists := upgrades[targetVariant]
			return exists
		}

		if currentUpgrade, ok := upgrades[currentVariant]; ok {
			for _, nextVariant := range currentUpgrade.Next {
				if nextVariant == targetVariant {
					return true
				}
			}
		}
	}
	return false
}

// ? For preventing wall spamming
func CheckBuildingOverlapWithUnits(player *Player, buildingType BuildingType, position PositionFloat) bool {
	State.RLock()
	otherPlayers := make([]*Player, 0, len(State.Players))
	for _, p := range State.Players {
		if player.ID != p.ID {
			otherPlayers = append(otherPlayers, p)
		}
	}
	State.RUnlock()
	buildingSize := GetBuildingSize(buildingType)

	for _, otherPlayer := range otherPlayers {
		if otherPlayer.IsMarkedForRemoval() {
			continue
		}

		otherPlayer.RLock()
		units := make([]*Unit, 0, len(otherPlayer.Units))
		for _, u := range otherPlayer.Units {
			units = append(units, u)
		}
		otherPlayer.RUnlock()

		for _, unit := range units {
			if unit.IsMarkedForRemoval() {
				continue
			}
			// Get the position and size of the unit
			unitPosition := unit.Position
			unitSize := unit.Size

			// Calculate the distance between the building center and the unit center
			dx := position.X - unitPosition.X
			dy := position.Y - unitPosition.Y
			distanceSquared := dx*dx + dy*dy
			radiusSum := float32(buildingSize + unitSize)

			// Check if the distance between centers is less than or equal to the sum of the radii
			if distanceSquared <= radiusSum*radiusSum {
				return true // A unit overlaps with the building's area
			}
		}
	}

	return false
}
