package game

import (
	"math"
	"math/rand"
	"sync"
	"time"
)

type UnitTargetRotation struct {
	Rotation float32
	IsDirty  bool
}

type Unit struct {
	Player                    *Player
	ID                        ID
	Type                      UnitType
	Variant                   UnitVariant
	Position                  PositionFloat
	TargetPosition            PositionFloat
	TargetRotation            UnitTargetRotation
	Polygon                   Polygon
	Health                    Health
	Damage                    uint16
	Speed                     float64
	Size                      int
	ExplosionRadius           int
	LastTargetPositionUpdate  time.Time
	ExactTargetPositonRequest PositionInt
	LastDamageTime            time.Time
	RemoveFlag                bool // Flag to mark unit for removal
	sync.RWMutex
}

func (u *Unit) GetRotation() float64 {
	return u.Polygon.Rotation + u.Polygon.rotationOffset
}

func (u *Unit) GetObjectPointer() interface{} {
	return u
}

func (u *Unit) IsMarkedForRemoval() bool {
	return u.RemoveFlag
}

func (u *Unit) MarkForRemoval() {
	u.RemoveFlag = true
}

func (u *Unit) GetPosition() PositionFloat {
	return u.Position
}

func (u *Unit) TakeDamage(amount uint16) bool {
	u.LastDamageTime = time.Now()
	u.Health.Decrement(amount)
	return u.Health.IsAlive()
}

func (u *Unit) SetTargetPosition(pos PositionFloat) {
	u.Lock()
	defer u.Unlock()

	// Set the target position
	u.TargetPosition = PositionFloat{
		X: float32(pos.X),
		Y: float32(pos.Y),
	}

	// Calculate the rotation angle in radians
	deltaX := float64(u.TargetPosition.X - u.Position.X)
	deltaY := float64(u.TargetPosition.Y - u.Position.Y)
	u.TargetRotation.Rotation = float32(math.Atan2(deltaY, deltaX))

	u.Polygon.SetRotation(float64(u.TargetRotation.Rotation))

	u.LastTargetPositionUpdate = time.Now()

	// Mark rotation as dirty
	u.TargetRotation.IsDirty = true
}

func (u *Unit) IsExplosiv() bool {
	return u.ExplosionRadius > 0
}

// Ease-out function: starts fast and slows down as it approaches the target.
func easeOut(t float64) float64 {
	return 1 - math.Pow(1-t, 3)
}
func (u *Unit) UpdatePosition(deltaTime time.Duration, units []*Unit) bool {
	u.Lock()
	defer u.Unlock()

	// Calculate distance to target position
	dx := float64(u.TargetPosition.X - u.Position.X)
	dy := float64(u.TargetPosition.Y - u.Position.Y)
	distanceSquared := dx*dx + dy*dy

	// Snap to target position when close enough
	if distanceSquared <= 1.0 {
		u.Position = u.TargetPosition
		return false
	}

	// Normalize dx and dy to get unit direction vector
	distance := math.Sqrt(distanceSquared)
	unitVectorX := dx / distance
	unitVectorY := dy / distance

	// Calculate base distance to move in this frame
	// Use a fixed delta time to avoid frame rate dependency
	distanceToMove := u.Speed * float64(deltaTime) / float64(time.Second)

	// Apply ease-out only when within a threshold distance to the target
	easeThreshold := 100.0
	minMovementThreshold := 0.05 // Minimum movement threshold to consider easing
	if distance < easeThreshold {
		progress := distance / easeThreshold
		easedProgress := easeOut(progress)

		// If the eased progress is too small to notice, stop easing
		if easedProgress*distanceToMove < minMovementThreshold {
			easedProgress = 1.0 // Disable easing
		}

		distanceToMove *= easedProgress
	}

	// Limit distanceToMove to the remaining distance to avoid overshoot
	if distanceToMove > distance {
		distanceToMove = distance
	}

	// Calculate new position
	newX := float64(u.Position.X) + unitVectorX*distanceToMove
	newY := float64(u.Position.Y) + unitVectorY*distanceToMove

	// Update position
	u.Position.X = float32(newX)
	u.Position.Y = float32(newY)
	return true
}

// Check if the unit is within a specified radius of a position
func (u *Unit) IsWithinRadius(position PositionFloat, radius float32) bool {
	dx := u.Position.X - float32(position.X)
	dy := u.Position.Y - float32(position.Y)
	distanceSquared := dx*dx + dy*dy
	radiusSquared := float32(radius * radius)
	return distanceSquared <= radiusSquared
}

type SpawnFrequency struct {
	Current  uint16 // Current frequency value
	Original uint16 // Original (initial) frequency value
	sync.RWMutex
}

func (f *SpawnFrequency) Decrement(amount uint16) {
	f.Lock()
	defer f.Unlock()
	if amount >= f.Current {
		f.Current = 0
	} else {
		f.Current -= amount
	}
}

func (f *SpawnFrequency) Get() uint16 {
	f.RLock()
	defer f.RUnlock()
	return f.Current
}

func (f *SpawnFrequency) Reset() {
	f.Lock()
	defer f.Unlock()
	f.Current = f.Original
}

type UnitSpawning struct {
	Barracks    *Building
	UnitType    UnitType
	UnitVariant UnitVariant
	Frequency   SpawnFrequency
	Activated   bool
}

type UnitStats struct {
	Variant            UnitVariant    // Identifies the unit variant.
	Health             Health         // Current and max health of the unit.
	Damage             uint16         // Contact/ram damage.
	Speed              float64        // Movement speed of the unit.
	Size               int            // Unit's size
	RequiredPopulation uint16         // Population required to spawn
	BulletSpawning     BulletSpawning // Optional: For Units with cannons
	ExplosionRadius    uint16         // Optional: Radius of explosion (default: 0).
}

var unitTypes = map[UnitType]map[UnitVariant]UnitStats{
	SOLDIER: {
		BASIC_UNIT: {
			Variant:            BASIC_UNIT,
			Health:             Health{Current: 120, Max: 120},
			Damage:             20,
			Speed:              140,
			Size:               18,
			RequiredPopulation: 16,
		},
		LIGHT_ARMOR_SOLDIER: {
			Variant: LIGHT_ARMOR_SOLDIER,
			Health:  Health{Current: 140, Max: 140},
			Damage:  20,
			Speed:   140,
			Size:    18,
		},
	},
	TANK: {
		BASIC_UNIT: {
			Variant:            BASIC_UNIT,
			Health:             Health{Current: 250, Max: 250},
			Damage:             50,
			Speed:              63,
			Size:               31,
			RequiredPopulation: 15,
		},
		HEAVY_ARMOR_TANK: {
			Variant: HEAVY_ARMOR_TANK,
			Health:  Health{Current: 320, Max: 320},
			Damage:  50,
			Speed:   63,
			Size:    31,
		},
		CANNON_TANK: {
			Variant: CANNON_TANK,
			Health:  Health{Current: 250, Max: 250},
			Damage:  50,
			Speed:   63,
			Size:    31,
		},
		BOOSTER_ENGINE_TANK: {
			Variant: BOOSTER_ENGINE_TANK,
			Health:  Health{Current: 250, Max: 250},
			Damage:  50,
			Speed:   80,
			Size:    31,
		},
		HEAVY_ARMOR_BOOSTER_ENGINE_TANK: {
			Variant: HEAVY_ARMOR_BOOSTER_ENGINE_TANK,
			Health:  Health{Current: 320, Max: 320},
			Damage:  50,
			Speed:   80,
			Size:    31,
		},
		BOOSTER_ENGINE_CANNON_TANK: {
			Variant: BOOSTER_ENGINE_CANNON_TANK,
			Health:  Health{Current: 250, Max: 250},
			Damage:  50,
			Speed:   80,
			Size:    31,
		},
	},
	SIEGE_TANK: {
		BASIC_UNIT: {
			Variant:            BASIC_UNIT,
			Health:             Health{Current: 1500, Max: 1500},
			Damage:             100,
			Speed:              20,
			Size:               40,
			RequiredPopulation: 40,
		},
		HEAVY_ARMOR_SIEGE_TANK: {
			Variant: HEAVY_ARMOR_SIEGE_TANK,
			Health:  Health{Current: 1800, Max: 1800},
			Damage:  100,
			Speed:   20,
			Size:    40,
		},
		BOOSTER_ENGINE_SIEGE_TANK: {
			Variant: BOOSTER_ENGINE_SIEGE_TANK,
			Health:  Health{Current: 1500, Max: 1500},
			Damage:  100,
			Speed:   28,
			Size:    40,
		},
		CANNON_SIEGE_TANK: {
			Variant: CANNON_SIEGE_TANK,
			Health:  Health{Current: 1800, Max: 1800},
			Damage:  100,
			Speed:   20,
			Size:    40,
		},
		BOOSTER_ENGINE_CANNON_SIEGE_TANK: {
			Variant: BOOSTER_ENGINE_CANNON_SIEGE_TANK,
			Health:  Health{Current: 1500, Max: 1500},
			Damage:  100,
			Speed:   28,
			Size:    40,
		},
		HEAVY_ARMOR_BOOSTER_ENGINE_SIEGE_TANK: {
			Variant: HEAVY_ARMOR_BOOSTER_ENGINE_SIEGE_TANK,
			Health:  Health{Current: 1800, Max: 1800},
			Damage:  100,
			Speed:   28,
			Size:    40,
		},
	},
	COMMANDER: {
		BASIC_UNIT: {
			Variant:            BASIC_UNIT,
			Health:             Health{Current: 700, Max: 700},
			Damage:             100,
			Speed:              200,
			Size:               32,
			RequiredPopulation: 0,
		},
	},
}

var unitPolygons = map[UnitType]map[UnitVariant]Polygon{
	SOLDIER: {
		BASIC_UNIT:          GeneratePolygon(ShapeTriangle, getSize(SOLDIER, BASIC_UNIT), 0),
		LIGHT_ARMOR_SOLDIER: GeneratePolygon(ShapeTriangle, getSize(SOLDIER, LIGHT_ARMOR_SOLDIER), 0),
	},
	TANK: {
		BASIC_UNIT:                      GeneratePolygon(ShapeTriangle, getSize(TANK, BASIC_UNIT), 0),
		HEAVY_ARMOR_TANK:                GeneratePolygon(ShapeTriangle, getSize(TANK, HEAVY_ARMOR_TANK), 0),
		CANNON_TANK:                     GeneratePolygon(ShapeTriangle, getSize(TANK, CANNON_TANK), 0),
		BOOSTER_ENGINE_TANK:             GeneratePolygon(ShapeTriangle, getSize(TANK, BOOSTER_ENGINE_TANK), 0),
		HEAVY_ARMOR_BOOSTER_ENGINE_TANK: GeneratePolygon(ShapeTriangle, getSize(TANK, HEAVY_ARMOR_BOOSTER_ENGINE_TANK), 0),
		BOOSTER_ENGINE_CANNON_TANK:      GeneratePolygon(ShapeTriangle, getSize(TANK, BOOSTER_ENGINE_CANNON_TANK), 0),
	},
	SIEGE_TANK: {
		BASIC_UNIT:                            GeneratePolygon(ShapeTriangle, getSize(SIEGE_TANK, BASIC_UNIT), 0),
		HEAVY_ARMOR_SIEGE_TANK:                GeneratePolygon(ShapeTriangle, getSize(SIEGE_TANK, HEAVY_ARMOR_SIEGE_TANK), 0),
		BOOSTER_ENGINE_SIEGE_TANK:             GeneratePolygon(ShapeTriangle, getSize(SIEGE_TANK, BOOSTER_ENGINE_SIEGE_TANK), 0),
		CANNON_SIEGE_TANK:                     GeneratePolygon(ShapeTriangle, getSize(SIEGE_TANK, CANNON_SIEGE_TANK), 0),
		BOOSTER_ENGINE_CANNON_SIEGE_TANK:      GeneratePolygon(ShapeTriangle, getSize(SIEGE_TANK, BOOSTER_ENGINE_CANNON_SIEGE_TANK), 0),
		HEAVY_ARMOR_BOOSTER_ENGINE_SIEGE_TANK: GeneratePolygon(ShapeTriangle, getSize(SIEGE_TANK, HEAVY_ARMOR_BOOSTER_ENGINE_SIEGE_TANK), 0),
	},
	COMMANDER: {
		BASIC_UNIT: GeneratePolygon(ShapeHexagon, getSize(COMMANDER, BASIC_UNIT), 0),
	},
}

func getSize(unitType UnitType, variant UnitVariant) int {
	size, ok := GetUnitSize(unitType, variant)
	if !ok {
		// Handle the case where the size could not be retrieved (return a default size or panic)
		return 0 // or a sensible default size
	}
	return size
}

func GetUnitSize(unitType UnitType, variant UnitVariant) (int, bool) {
	unit, ok := unitTypes[unitType][variant]
	if !ok {
		return 0, false
	}
	return unit.Size, true
}

func GetUnitSpeed(unitType UnitType, variant UnitVariant) (float64, bool) {
	unit, ok := unitTypes[unitType][variant]
	if !ok {
		return 0, false
	}
	return unit.Speed, true
}

func GetUnitRequiredPopulation(unitType UnitType) (uint16, bool) {
	unit, ok := unitTypes[unitType][BASIC_UNIT]
	if !ok {
		return 0, false
	}
	return unit.RequiredPopulation, true
}

func GetUnitPolygon(unitType UnitType, variant UnitVariant) (Polygon, bool) {
	unitPolygonsForType, ok := unitPolygons[unitType]
	if !ok {
		return Polygon{}, false
	}
	polygon, ok := unitPolygonsForType[variant]
	return polygon, ok
}

func GetUnitStats(unitType UnitType, variant UnitVariant) (UnitStats, bool) {
	stats, ok := unitTypes[unitType][variant]
	return stats, ok
}

func CalculateUnitSpawnPosition(barracks *Building) PositionFloat {
	spawnRadius := float64(BARRACKS_UNIT_SPAWN_RADIUS)

	// Get a random angle within the range [-pi/8, pi/8] (45 degrees)
	randomAngle := rand.Float64()*math.Pi/4.0 - math.Pi/8.0

	// Convert barracksPosition coordinates to float64 for calculations
	barracksX := float64(barracks.Position.X)
	barracksY := float64(barracks.Position.Y)
	rotation := barracks.Polygon.Rotation

	// Calculate spawn position based on random angle, barracks position, and spawn radius
	unitPosition := PositionFloat{
		X: float32(barracksX - spawnRadius*math.Cos(rotation+randomAngle)),
		Y: float32(barracksY - spawnRadius*math.Sin(rotation+randomAngle)),
	}

	return unitPosition
}

func ValidateUnitType(unitType UnitType) bool {
	if upgrades, ok := unitTypes[unitType]; ok {
		if _, ok := upgrades[BASIC_UNIT]; ok {
			return true
		}
	}
	return false
}
