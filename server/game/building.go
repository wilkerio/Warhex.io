package game

import (
	"math"
	"sync"
)

type Building struct {
	Owner      Owner // Specifies the owner of the building, which can be a player or a neutral base
	ID         ID
	Type       BuildingType
	Variant    BuildingVariant
	Position   PositionFloat
	Polygon    Polygon
	Health     Health
	RemoveFlag bool // Flag to mark unit for removal
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
	Next    []BuildingVariant
	Cost    uint16
}

var buildingTypes = map[BuildingType]map[BuildingVariant]BuildingUpgrade{
	WALL: {
		BASIC_BUILDING: {
			Variant: BASIC_BUILDING,
			Health:  Health{Current: 800, Max: 800},
			Next:    []BuildingVariant{MICRO_GENERATOR, BOULDER},
			Cost:    50,
		},
		MICRO_GENERATOR: {
			Variant: MICRO_GENERATOR,
			Health:  Health{Current: 800, Max: 800},
			Next:    nil,
			Cost:    100,
		},
		BOULDER: {
			Variant: BOULDER,
			Health:  Health{Current: 1000, Max: 1000},
			Next:    []BuildingVariant{SPIKE},
			Cost:    80,
		},
		SPIKE: {
			Variant: SPIKE,
			Health:  Health{Current: 1200, Max: 1200},
			Next:    nil,
			Cost:    120,
		},
	},
	SIMPLE_TURRET: {
		BASIC_BUILDING: {
			Variant: BASIC_BUILDING,
			Health:  Health{Current: 100, Max: 100},
			Next:    []BuildingVariant{RAPID_TURRET, HEAVY_TURRET},
			Cost:    150,
		},
		RAPID_TURRET: {
			Variant: RAPID_TURRET,
			Health:  Health{Current: 100, Max: 100},
			Next:    []BuildingVariant{GATLING_TURRET},
			Cost:    200,
		},
		GATLING_TURRET: {
			Variant: GATLING_TURRET,
			Health:  Health{Current: 100, Max: 100},
			Next:    nil,
			Cost:    300,
		},
		HEAVY_TURRET: {
			Variant: GATLING_TURRET,
			Health:  Health{Current: 100, Max: 100},
			Next:    nil,
			Cost:    500,
		},
	},
	SNIPER_TURRET: {
		BASIC_BUILDING: {
			Variant: BASIC_BUILDING,
			Health:  Health{Current: 100, Max: 100},
			Next:    []BuildingVariant{SEMI_AUTOMATIC_SNIPER, HEAVY_SNIPER},
			Cost:    200,
		},
		SEMI_AUTOMATIC_SNIPER: {
			Variant: SEMI_AUTOMATIC_SNIPER,
			Health:  Health{Current: 100, Max: 100},
			Next:    nil,
			Cost:    250,
		},
		HEAVY_SNIPER: {
			Variant: HEAVY_SNIPER,
			Health:  Health{Current: 100, Max: 100},
			Next:    []BuildingVariant{TRAPPER, ANTI_TANK_GUN},
			Cost:    250,
		},
		ANTI_TANK_GUN: {
			Variant: ANTI_TANK_GUN,
			Health:  Health{Current: 100, Max: 100},
			Next:    nil,
			Cost:    400,
		},
		TRAPPER: {
			Variant: TRAPPER,
			Health:  Health{Current: 100, Max: 100},
			Next:    nil,
			Cost:    550,
		},
	},
	/*ARMORY: {
		BASIC_BUILDING: {
			Variant: BASIC_BUILDING,
			Health:  Health{Current: 200, Max: 200},
			Next:    nil,
			Cost:    150,
		},
	},*/
	BARRACKS: {
		BASIC_BUILDING: {
			Variant: BASIC_BUILDING,
			Health:  Health{Current: 150, Max: 150},
			Next:    []BuildingVariant{GREATER_BARRACKS, TANK_FACTORY},
			Cost:    150,
		},
		GREATER_BARRACKS: {
			Variant: GREATER_BARRACKS,
			Health:  Health{Current: 150, Max: 150},
			Next:    nil,
			Cost:    200,
		},
		TANK_FACTORY: {
			Variant: TANK_FACTORY,
			Health:  Health{Current: 150, Max: 150},
			Next:    []BuildingVariant{HEAVY_TANK_FACTORY, BOOSTER_TANK_FACTORY},
			Cost:    200,
		},
		HEAVY_TANK_FACTORY: {
			Variant: HEAVY_TANK_FACTORY,
			Health:  Health{Current: 150, Max: 150},
			Next:    []BuildingVariant{CANNON_TANK_FACTORY, SIEGE_TANK_FACTORY},
			Cost:    250,
		},
		BOOSTER_TANK_FACTORY: {
			Variant: BOOSTER_TANK_FACTORY,
			Health:  Health{Current: 150, Max: 150},
			Next:    []BuildingVariant{HEAVY_BOOSTER_TANK_FACTORY, BOOSTER_CANNON_TANK_FACTORY},
			Cost:    250,
		},
		CANNON_TANK_FACTORY: {
			Variant: CANNON_TANK_FACTORY,
			Health:  Health{Current: 150, Max: 150},
			Next:    nil,
			Cost:    300,
		},
		SIEGE_TANK_FACTORY: {
			Variant: SIEGE_TANK_FACTORY,
			Health:  Health{Current: 150, Max: 150},
			Next:    []BuildingVariant{HEAVY_SIEGE_TANK_FACTORY, BOOSTER_SIEGE_TANK_FACTORY},
			Cost:    300,
		},
		HEAVY_BOOSTER_TANK_FACTORY: {
			Variant: HEAVY_BOOSTER_TANK_FACTORY,
			Health:  Health{Current: 150, Max: 150},
			Next:    []BuildingVariant{BOOSTER_SIEGE_TANK_FACTORY},
			Cost:    300,
		},
		BOOSTER_CANNON_TANK_FACTORY: {
			Variant: BOOSTER_CANNON_TANK_FACTORY,
			Health:  Health{Current: 150, Max: 150},
			Next:    nil,
			Cost:    300,
		},
		HEAVY_SIEGE_TANK_FACTORY: {
			Variant: HEAVY_SIEGE_TANK_FACTORY,
			Health:  Health{Current: 150, Max: 150},
			Next:    []BuildingVariant{CANNON_SIEGE_TANK_FACTORY, HEAVY_BOOSTER_SIEGE_TANK_FACTORY},
			Cost:    350,
		},
		BOOSTER_SIEGE_TANK_FACTORY: {
			Variant: BOOSTER_SIEGE_TANK_FACTORY,
			Health:  Health{Current: 150, Max: 150},
			Next:    []BuildingVariant{HEAVY_BOOSTER_SIEGE_TANK_FACTORY, BOOSTER_CANNON_SIEGE_TANK_FACTORY},
			Cost:    350,
		},
		CANNON_SIEGE_TANK_FACTORY: {
			Variant: CANNON_SIEGE_TANK_FACTORY,
			Health:  Health{Current: 150, Max: 150},
			Next:    nil,
			Cost:    400,
		},
		HEAVY_BOOSTER_SIEGE_TANK_FACTORY: {
			Variant: HEAVY_BOOSTER_SIEGE_TANK_FACTORY,
			Health:  Health{Current: 150, Max: 150},
			Next:    nil,
			Cost:    400,
		},
		BOOSTER_CANNON_SIEGE_TANK_FACTORY: {
			Variant: BOOSTER_CANNON_SIEGE_TANK_FACTORY,
			Health:  Health{Current: 150, Max: 150},
			Next:    nil,
			Cost:    400,
		},
	},
	GENERATOR: {
		BASIC_BUILDING: {
			Variant: BASIC_BUILDING,
			Health:  Health{Current: 100, Max: 100},
			Next:    []BuildingVariant{POWER_PLANT},
			Cost:    100,
		},
		POWER_PLANT: {
			Variant: POWER_PLANT,
			Health:  Health{Current: 100, Max: 100},
			Next:    nil,
			Cost:    200,
		},
	},
	HOUSE: {
		BASIC_BUILDING: {
			Variant: BASIC_BUILDING,
			Health:  Health{Current: 100, Max: 100},
			Next:    []BuildingVariant{LARGE_HOUSE},
			Cost:    120,
		},
		LARGE_HOUSE: {
			Variant: LARGE_HOUSE,
			Health:  Health{Current: 100, Max: 100},
			Next:    []BuildingVariant{},
			Cost:    150,
		},
	},
}

var buildingSizes = map[BuildingType]int{
	WALL:          30,
	SIMPLE_TURRET: 30,
	SNIPER_TURRET: 33,
	BARRACKS:      60,
	GENERATOR:     40,
	HOUSE:         35,
}

type BuildingLimit struct {
	Current int
	Max     int
}

var resourceGeneration = map[BuildingType]map[BuildingVariant]Generating{
	WALL: {
		MICRO_GENERATOR: Generating{Power: 2},
	},
	GENERATOR: {
		BASIC_BUILDING: Generating{Power: 2},
		POWER_PLANT:    Generating{Power: 3},
	},
}

var populationCapacity = map[BuildingType]map[BuildingVariant]uint16{
	HOUSE: {
		BASIC_BUILDING: 8,
		LARGE_HOUSE:    12,
	},
}

var unitSpawningConfig = map[BuildingType]map[BuildingVariant]UnitSpawning{
	BARRACKS: {
		// Soldiers
		BASIC_BUILDING: UnitSpawning{
			Barracks:    nil,
			UnitType:    SOLDIER,
			UnitVariant: BASIC_UNIT,
			Frequency:   SpawnFrequency{Current: 0, Original: 4},
		},
		GREATER_BARRACKS: UnitSpawning{
			Barracks:    nil,
			UnitType:    SOLDIER,
			UnitVariant: BASIC_UNIT,
			Frequency:   SpawnFrequency{Current: 0, Original: 2},
		},
		// Tanks
		TANK_FACTORY: UnitSpawning{
			Barracks:    nil,
			UnitType:    TANK,
			UnitVariant: BASIC_UNIT,
			Frequency:   SpawnFrequency{Current: 0, Original: 20},
		},
		HEAVY_TANK_FACTORY: UnitSpawning{
			Barracks:    nil,
			UnitType:    TANK,
			UnitVariant: HEAVY_ARMOR_TANK,
			Frequency:   SpawnFrequency{Current: 0, Original: 20},
		},
		BOOSTER_TANK_FACTORY: UnitSpawning{
			Barracks:    nil,
			UnitType:    TANK,
			UnitVariant: BOOSTER_ENGINE_TANK,
			Frequency:   SpawnFrequency{Current: 0, Original: 20},
		},
		CANNON_TANK_FACTORY: UnitSpawning{
			Barracks:    nil,
			UnitType:    TANK,
			UnitVariant: CANNON_TANK,
			Frequency:   SpawnFrequency{Current: 0, Original: 20},
		},
		HEAVY_BOOSTER_TANK_FACTORY: UnitSpawning{
			Barracks:    nil,
			UnitType:    TANK,
			UnitVariant: HEAVY_ARMOR_BOOSTER_ENGINE_SIEGE_TANK,
			Frequency:   SpawnFrequency{Current: 0, Original: 20},
		},
		BOOSTER_CANNON_TANK_FACTORY: UnitSpawning{
			Barracks:    nil,
			UnitType:    TANK,
			UnitVariant: BOOSTER_ENGINE_CANNON_TANK,
			Frequency:   SpawnFrequency{Current: 0, Original: 20},
		},
		// Siege Tanks
		SIEGE_TANK_FACTORY: UnitSpawning{
			Barracks:    nil,
			UnitType:    SIEGE_TANK,
			UnitVariant: BASIC_UNIT,
			Frequency:   SpawnFrequency{Current: 0, Original: 30},
		},
		HEAVY_SIEGE_TANK_FACTORY: UnitSpawning{
			Barracks:    nil,
			UnitType:    SIEGE_TANK,
			UnitVariant: HEAVY_ARMOR_SIEGE_TANK,
			Frequency:   SpawnFrequency{Current: 0, Original: 30},
		},
		BOOSTER_SIEGE_TANK_FACTORY: UnitSpawning{
			Barracks:    nil,
			UnitType:    SIEGE_TANK,
			UnitVariant: BOOSTER_ENGINE_SIEGE_TANK,
			Frequency:   SpawnFrequency{Current: 0, Original: 30},
		},
		CANNON_SIEGE_TANK_FACTORY: UnitSpawning{
			Barracks:    nil,
			UnitType:    SIEGE_TANK,
			UnitVariant: CANNON_SIEGE_TANK,
			Frequency:   SpawnFrequency{Current: 0, Original: 30},
		},
		HEAVY_BOOSTER_SIEGE_TANK_FACTORY: UnitSpawning{
			Barracks:    nil,
			UnitType:    SIEGE_TANK,
			UnitVariant: HEAVY_ARMOR_BOOSTER_ENGINE_SIEGE_TANK,
			Frequency:   SpawnFrequency{Current: 0, Original: 30},
		},
		BOOSTER_CANNON_SIEGE_TANK_FACTORY: UnitSpawning{
			Barracks:    nil,
			UnitType:    SIEGE_TANK,
			UnitVariant: BOOSTER_ENGINE_CANNON_SIEGE_TANK,
			Frequency:   SpawnFrequency{Current: 0, Original: 30},
		},
	},
}

var buildingPolygons = map[BuildingType]Polygon{
	BARRACKS:      GeneratePolygon(ShapeRectangle, GetBuildingSize(BARRACKS), math.Pi),
	GENERATOR:     GeneratePolygon(ShapeHexagon, GetBuildingSize(GENERATOR), math.Pi/2),
	HOUSE:         GeneratePolygon(ShapePentagon, GetBuildingSize(HOUSE), 0),
	SIMPLE_TURRET: GeneratePolygon(ShapeCircle, GetBuildingSize(SIMPLE_TURRET), math.Pi/2),
	SNIPER_TURRET: GeneratePolygon(ShapeCircle, GetBuildingSize(SNIPER_TURRET), math.Pi/2),
	WALL:          GeneratePolygon(ShapeCircle, GetBuildingSize(WALL), math.Pi/2),
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
