package game

import (
	"log"
	"math"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type MovementPackage struct {
	Timestamp      time.Time     // Timestamp of the movement
	TargetPosition PositionInt   // The target position for the movement
	UnitPositions  []PositionInt // The positions of the units being moved
	UnitIds        []byte
}

const (
	commanderAssistPowerFloor uint16 = 2000
	PLAYER_NAME_MAX_BYTES     int    = 32
)

type Player struct {
	// Identification & Connection
	ID                      ID
	Conn                    *websocket.Conn
	IsBot                   bool
	IsOwner                 bool
	AuthUserID              string
	Permission              Permission
	Name                    [PLAYER_NAME_MAX_BYTES]byte
	LastActivity            time.Time // Used for timeout
	LastActivityWarningSent time.Time
	LastResync              time.Time
	SkinID                  ID

	// Statistics
	StartTime time.Time // For playtime
	Kills     uint32
	/* XP is calculated based on the score at the end of the run */

	// Game State
	Score                  uint32
	Population             Population
	Resources              Resources
	Generating             Generating
	CapturedNeutralBases   []*NeutralBase
	Base                   *Base
	SpawnProtectionEndTime time.Time
	HasSpawnProtection     bool
	RelocateCount          uint32
	NextRelocateAllowedAt  time.Time
	NextPortalAllowedAt    time.Time

	// Unit
	AvailableUnitIDs       *AvailableIDs
	Units                  map[ID]*Unit
	UnitSpawning           []*UnitSpawning
	UnitBulletSpawning     []*BulletSpawning
	UnitSpawningLimit      Capacity
	HasCommander           bool
	HasSoldierArmor        bool
	HasTankBooster         bool
	HasTankCannon          bool
	HasTankCloak           bool
	GroupUnits             bool
	CommanderAssistEnabled bool
	InDuel                 bool
	DuelOpponentID         ID
	DuelArena              DuelArena
	DuelPrepEndsAt         time.Time
	LastBaseDamageAt       time.Time

	// Script prevention
	LastBuildingAction  time.Time // Timestamp of the last building upgraded/placed
	BuildingActionCount uint32    // Counter to track the number of building actions
	LastMovementPackage MovementPackage

	//! Currently only for unit movement
	// Suspicion Handling
	SuspiciousCounter  float32 // Counter to track suspicious activity
	SuspicionDecayRate float32 // Rate at which the suspicion counter decreases over time
	SuspicionThreshold float32 // Threshold at which suspicious action is triggered

	// Camera
	Camera Camera

	// Flags & Conditions
	RemoveFlag bool // Flag to mark unit for removal

	// Synchronization
	sync.RWMutex
}

func (p *Player) UpdateSuspicion() bool {

	// Check if the suspicion threshold is exceeded
	if p.SuspiciousCounter >= p.SuspicionThreshold {
		return true
	}

	// Decay the suspicion counter over time
	p.SuspiciousCounter -= p.SuspicionDecayRate
	if p.SuspiciousCounter < 0 {
		p.SuspiciousCounter = 0
	}

	return false
}

func (p *Player) HandleSuspiciousBehavior() {
	// Increase the suspicion counter based on detected suspicious behavior
	p.SuspiciousCounter++
}

// Building Script prevention
func (p *Player) CanPerformBuildingAction() bool {
	now := time.Now()

	// Define thresholds for the prevention system
	const maxActionsPerSecond = 10    // Max building actions allowed per second
	const timeThreshold = time.Second // Time window for building action spamming

	// Check if the last action timestamp has fallen outside the time window
	if now.Sub(p.LastBuildingAction) >= timeThreshold {
		// Reset the counter and timestamp to start a new window
		p.BuildingActionCount = 0
		p.LastBuildingAction = now
	}

	// Check if the player has exceeded the action limit within the window
	if p.BuildingActionCount >= maxActionsPerSecond {
		return false // Deny action due to spamming
	}

	// Increment the action counter (and allow the action)
	p.BuildingActionCount++
	return true
}

func (p *Player) GetBase() *Base {
	return p.Base
}

func (p *Player) IsMarkedForRemoval() bool {
	return p.RemoveFlag
}

func (p *Player) MarkForRemoval() {
	p.RemoveFlag = true
}

func isSameBarracksRef(a *Building, b *Building) bool {
	if a == nil || b == nil {
		return false
	}
	return a == b || a.ID == b.ID
}

// GetUnitSpawningForBarrack returns the UnitSpawning for a specific barrack.
func (p *Player) GetUnitSpawningForBarrack(barrack *Building) *UnitSpawning {
	p.RLock() // Lock for thread safety during read operation
	defer p.RUnlock()

	for _, unitSpawn := range p.UnitSpawning {
		if unitSpawn == nil {
			continue
		}
		if isSameBarracksRef(unitSpawn.Barracks, barrack) {
			return unitSpawn
		}
	}
	return nil
}

func (p *Player) GetGenerating() Generating {
	p.RLock()
	defer p.RUnlock()
	return p.Generating
}

func (p *Player) GetEffectiveGeneratingPower() uint16 {
	p.RLock()
	baseGenerating := p.Generating.Power
	assistEnabled := p.CommanderAssistEnabled
	hasCommander := p.HasCommander
	p.RUnlock()

	if !assistEnabled || !hasCommander {
		return baseGenerating
	}

	// Commander Assist grants +30% generation while active.
	// Use integer math with ceil to preserve small-value gains.
	bonus := uint16((uint32(baseGenerating)*30 + 99) / 100)

	effective := uint32(baseGenerating) + uint32(bonus)
	if effective > uint32(^uint16(0)) {
		return ^uint16(0)
	}
	return uint16(effective)
}

func (p *Player) GetCommanderAssistPowerFloor() uint16 {
	if p == nil {
		return 0
	}

	p.RLock()
	assistEnabled := p.CommanderAssistEnabled
	p.RUnlock()
	if !assistEnabled {
		return 0
	}

	p.Resources.Power.RLock()
	capacity := p.Resources.Power.Capacity
	p.Resources.Power.RUnlock()

	if capacity == 0 {
		return 0
	}
	if capacity < commanderAssistPowerFloor {
		return capacity
	}
	return commanderAssistPowerFloor
}

func (p *Player) EnforceCommanderAssistPowerFloor() bool {
	if p == nil {
		return false
	}

	floor := p.GetCommanderAssistPowerFloor()
	if floor == 0 {
		return false
	}

	p.Resources.Power.Lock()
	defer p.Resources.Power.Unlock()
	if p.Resources.Power.Current >= floor {
		return false
	}
	p.Resources.Power.Current = floor
	return true
}

func (p *Player) SetLastActivity() {
	p.Lock()
	defer p.Unlock()
	p.LastActivity = time.Now()
}

func (p *Player) GetLastActivity() time.Time {
	p.RLock()
	defer p.RUnlock()
	return p.LastActivity
}

func (p *Player) HasProtection() bool {
	p.RLock()
	defer p.RUnlock()
	return p.HasSpawnProtection
}

func (p *Player) GetProtectionEndTime() time.Time {
	p.RLock()
	defer p.RUnlock()
	return p.SpawnProtectionEndTime
}

func (p *Player) AddCapturedNeutralBase(neutralBase *NeutralBase) {
	p.Population.IncrementCapacity(NEUTRAL_BASE_POPULATION)
	p.Lock()
	defer p.Unlock()
	p.CapturedNeutralBases = append(p.CapturedNeutralBases, neutralBase)
}

func (p *Player) RemoveCapturedNeutralBase(neutralBase *NeutralBase) {
	p.Population.DecrementCapacity(NEUTRAL_BASE_POPULATION)

	p.Lock()
	defer p.Unlock()

	for i, base := range p.CapturedNeutralBases {
		if base == neutralBase {

			for _, building := range neutralBase.Base.Buildings {
				p.Base.decrementBuildingLimit(building.Type)
			}

			// Remove the base by slicing the array
			p.CapturedNeutralBases = append(p.CapturedNeutralBases[:i], p.CapturedNeutralBases[i+1:]...)
			break // Exit after removing the base
		}
	}
}

func (p *Player) GetCapturedNeutralBase(id ID) (*NeutralBase, bool) {
	p.RLock()
	defer p.RUnlock()
	for _, base := range p.CapturedNeutralBases {
		if base.ID == id {
			return base, true
		}
	}
	return nil, false
}

func (p *Player) RemoveProtection() {
	p.Lock()
	defer p.Unlock()
	if p.HasSpawnProtection {
		p.HasSpawnProtection = false
		p.SpawnProtectionEndTime = time.Time{}
		TriggerRemoveSpawnProtectionEvent(p)
	}
}

func (p *Player) CanRelocateNow(now time.Time) (bool, time.Duration) {
	if p.IsOwnerGodMode() {
		return true, 0
	}

	p.RLock()
	defer p.RUnlock()

	if p.NextRelocateAllowedAt.IsZero() || !now.Before(p.NextRelocateAllowedAt) {
		return true, 0
	}

	return false, p.NextRelocateAllowedAt.Sub(now)
}

func (p *Player) RecordRelocation(now time.Time) {
	if p.IsOwnerGodMode() {
		return
	}

	p.Lock()
	defer p.Unlock()

	p.RelocateCount++
	cooldown := time.Duration(p.RelocateCount) * 15 * time.Minute
	p.NextRelocateAllowedAt = now.Add(cooldown)
}

func (p *Player) RecordBaseDamage(now time.Time) {
	p.Lock()
	defer p.Unlock()
	p.LastBaseDamageAt = now
}

func (p *Player) WasBaseDamagedWithin(window time.Duration) bool {
	p.RLock()
	last := p.LastBaseDamageAt
	p.RUnlock()
	if last.IsZero() {
		return false
	}
	return time.Since(last) < window
}

func (p *Player) IncrementScore(value uint32) {
	p.RLock()
	inDuel := p.InDuel
	p.RUnlock()
	if inDuel {
		// Do not award rank score while player is in protected X1.
		return
	}
	p.Lock()
	p.Score += uint32(value)
	p.Unlock()
	changes, changed := State.Leaderboard.Update(State.Players)
	if changed {
		TriggerLeaderboardUpdateEvent(&changes)
	}
}

func (p *Player) IncrementKills(value uint32) {
	p.Lock()
	defer p.Unlock()
	p.Kills += value
}

func (p *Player) AddCommander() (*Unit, bool) {
	unitID, ok := p.AvailableUnitIDs.getNextAvailableID()
	if !ok {
		//log.Println("No available unit IDs")
		return nil, false
	}

	unitStats, ok := GetUnitStats(COMMANDER, 0)
	if !ok {
		log.Println("Unit stats not found for unit:", COMMANDER)
		return nil, false
	}

	polygon, ok := GetUnitPolygon(COMMANDER, 0)
	if !ok {
		log.Println("Unit polygon not found for unit:", COMMANDER)
		return nil, false
	}
	// Create the unit
	unit := &Unit{
		Player:           p,
		ID:               unitID,
		Type:             COMMANDER,
		Variant:          0,
		Position:         IntToFloat(p.Base.Position),
		PreviousPosition: IntToFloat(p.Base.Position),
		Polygon:          polygon,
		TargetPosition:   IntToFloat(p.Base.Position),
		TargetRotation:   UnitTargetRotation{float32(0), false},
		Health:           unitStats.Health,
		Damage:           unitStats.Damage,
		Size:             unitStats.Size,
		Speed:            unitStats.Speed,

		ExplosionRadius: int(unitStats.ExplosionRadius),
		LastDamageTime:  time.Now(),
	}
	ApplyOwnerCommanderBuff(unit)

	// Commander should spawn with an initial offset below the base.
	unit.SetTargetPosition(PositionFloat{X: unit.TargetPosition.X, Y: unit.TargetPosition.Y + 200})

	p.Lock()
	// Add the unit to the player's list of units
	p.Units[unitID] = unit

	p.HasCommander = true
	p.Unlock()

	p.AddUnitBulletSpawning(unit)

	return unit, true
}

func (p *Player) AddUnit(unitType UnitType, unitVariant UnitVariant, barracks *Building) (*Unit, bool) {
	unitID, ok := p.AvailableUnitIDs.getNextAvailableID()
	if !ok {
		//log.Println("No available unit IDs")
		return nil, false
	}

	unitStats, ok := GetUnitStats(unitType, unitVariant)
	if !ok {
		log.Println("Unit stats not found for unit:", unitType)
		return nil, false
	}

	unitTargetPosition := CalculateUnitSpawnPosition(barracks)

	polygon, ok := GetUnitPolygon(unitType, unitVariant)
	if !ok {
		log.Println("Unit polygon not found for unit:", unitType)
		return nil, false
	}

	// Calculate the direction vector and rotation angle
	dx := unitTargetPosition.X - barracks.Position.X
	dy := unitTargetPosition.Y - barracks.Position.Y
	targetRotation := math.Atan2(float64(dy), float64(dx)) // Angle in radians

	// Create the unit
	unit := &Unit{
		Player:           p,
		ID:               unitID,
		Type:             unitType,
		Variant:          unitVariant,
		Position:         barracks.Position,
		PreviousPosition: barracks.Position,
		Polygon:          polygon,
		TargetPosition:   unitTargetPosition,
		TargetRotation:   UnitTargetRotation{float32(targetRotation), false},
		Health:           unitStats.Health,
		Damage:           unitStats.Damage,
		Size:             unitStats.Size,
		Speed:            unitStats.Speed,
		ExplosionRadius:  int(unitStats.ExplosionRadius),
		LastDamageTime:   time.Now(),
	}

	p.Lock()
	// Add the unit to the player's list of units
	p.Units[unitID] = unit
	p.Unlock()

	return unit, true
}

func (p *Player) RemoveUnit(unitID ID) bool {
	p.RLock()
	// Retrieve the unit
	unit, ok := p.Units[unitID]
	p.RUnlock()
	if !ok {
		return false // Unit not found
	}

	// Remove the unit from the player's list of units
	p.Lock()
	if unit.Type == COMMANDER {
		p.HasCommander = false
	}
	delete(p.Units, unitID)
	p.Unlock()

	p.AvailableUnitIDs.returnID(unitID)

	return true // Unit was successfully removed
}

func (p *Player) AddUnitSpawning(barracks *Building, setActive bool) bool {
	if barracks == nil {
		return false
	}
	// Ensure a single UnitSpawning entry per barracks (safe even if no entry exists).
	p.RemoveUnitSpawning(barracks)

	// Get unit spawning data based on barracks variant
	unitSpawning, ok := GetUnitSpawning(barracks.Variant)
	if !ok {
		log.Println("Could not add UnitSpawning to player")
		return false
	}

	// Check if unit spawning can be activated
	if p.UnitSpawningLimit.HasMaxCapacity() {
		// If the limit is reached, force the unit spawning to be inactive
		setActive = false
	}

	spawning := &UnitSpawning{
		Barracks:    barracks,
		UnitType:    unitSpawning.UnitType,
		UnitVariant: unitSpawning.UnitVariant,
		Frequency:   unitSpawning.Frequency,
		Activated:   setActive,
	}

	if barracks.Variant == TANK_FACTORY && spawning.UnitType == TANK {
		switch {
		case p.HasTankBooster && p.HasTankCannon:
			spawning.UnitVariant = BOOSTER_ENGINE_CANNON_TANK
		case p.HasTankBooster:
			spawning.UnitVariant = BOOSTER_ENGINE_TANK
		case p.HasTankCannon:
			spawning.UnitVariant = CANNON_TANK
		default:
			spawning.UnitVariant = BASIC_UNIT
		}
	}
	if spawning.UnitType == SOLDIER {
		if p.HasSoldierArmor {
			spawning.UnitVariant = LIGHT_ARMOR_SOLDIER
		} else {
			spawning.UnitVariant = BASIC_UNIT
		}
	}
	if p.IsOwnerGodMode() {
		ApplyOwnerSpawnRate(spawning)
	}

	// If the spawning is activated, increment the limit
	if setActive {
		p.UnitSpawningLimit.Increment(1)
	}

	// Add the UnitSpawning instance to the player's list
	p.Lock()
	p.UnitSpawning = append(p.UnitSpawning, spawning)
	p.Unlock()
	return true
}

func (p *Player) RemoveUnitSpawning(barracks *Building) {
	if barracks == nil {
		return
	}
	var activeRemoved uint16

	// Create a new slice to store updated UnitSpawning entries
	var updatedUnitSpawning []*UnitSpawning

	p.Lock()
	// Iterate through player's UnitSpawning list
	for _, s := range p.UnitSpawning {
		if s == nil {
			continue
		}
		// Match by pointer or barracks ID to avoid stale-pointer desync.
		if isSameBarracksRef(s.Barracks, barracks) {
			if s.Activated {
				activeRemoved++
			}
			// Skip this UnitSpawning entry (effectively removing it)
			continue
		}

		// Add UnitSpawning entry to updated slice
		updatedUnitSpawning = append(updatedUnitSpawning, s)
	}

	// Update player's UnitSpawning list with the filtered slice
	p.UnitSpawning = updatedUnitSpawning
	p.Unlock()

	if activeRemoved > 0 {
		p.UnitSpawningLimit.Decrement(activeRemoved)
	}
}

func (p *Player) ToggleUnitSpawning(building *Building) bool {
	unitSpawning := p.GetUnitSpawningForBarrack(building)
	if unitSpawning == nil {
		return false
	}
	if unitSpawning.Activated {
		if p.UnitSpawningLimit.Get() == 0 {
			return false
		}
		p.UnitSpawningLimit.Decrement(1)
	} else {
		if p.UnitSpawningLimit.HasMaxCapacity() {
			return false
		}
		p.UnitSpawningLimit.Increment(1)
	}

	unitSpawning.Activated = !unitSpawning.Activated
	return true
}

func (p *Player) AddUnitBulletSpawning(unit *Unit) bool {
	bulletSpawning, ok := GetBulletSpawning(unit.Type, unit.Variant)
	if !ok {
		return false
	}

	// Create a new BulletSpawning instance
	spawning := &BulletSpawning{
		Shooter: unit,
		Frequency: SpawnFrequency{
			Current:  bulletSpawning.Frequency.Current,
			Original: bulletSpawning.Frequency.Original,
		},
		Range: bulletSpawning.Range,
	}

	// Add the BulletSpawning instance to the base's list
	p.Lock()
	p.UnitBulletSpawning = append(p.UnitBulletSpawning, spawning)
	p.Unlock()

	return true
}

func (p *Player) RemoveUnitBulletSpawning(unit *Unit) {
	p.Lock()
	defer p.Unlock()
	// Create a new slice to store updated UnitBulletSpawning entries
	var updatedBulletSpawning []*BulletSpawning

	// Iterate through base's UnitSpawning list
	for _, s := range p.UnitBulletSpawning {
		// Check if Unit pointer matches
		if shooterUnit, ok := s.Shooter.GetObjectPointer().(*Unit); ok {
			// If the Turret matches, skip this BulletSpawning entry (effectively removing it)
			if shooterUnit == unit {
				continue
			}
		}
		// Add BulletSpawning entry to updated slice
		updatedBulletSpawning = append(updatedBulletSpawning, s)
	}

	// Update player's UnitBulletSpawning list with the filtered slice
	p.UnitBulletSpawning = updatedBulletSpawning
}

func (p *Player) GetScore() uint32 {
	return p.Score
}

func (p *Player) GetKills() uint32 {
	return p.Kills
}

func (p *Player) GetPlayDuration() time.Duration {
	return time.Since(p.StartTime)
}

func (p *Player) GetObjectPointer() interface{} {
	return p // or return the relevant pointer
}

func (p *Player) GetID() ID {
	return p.ID
}

func (p *Player) SetGroupUnits(isGrouped bool) {
	p.Lock()
	defer p.Unlock()
	p.GroupUnits = isGrouped
}

func (p *Player) SetCommanderAssistEnabled(enabled bool) {
	p.Lock()
	defer p.Unlock()
	p.CommanderAssistEnabled = enabled
}

func (p *Player) IsCommanderAssistEnabled() bool {
	p.RLock()
	defer p.RUnlock()
	return p.CommanderAssistEnabled
}

func (p *Player) ApplySoldierArmorUpgrade(enabled bool) {
	targetVariant := BASIC_UNIT
	if enabled {
		targetVariant = LIGHT_ARMOR_SOLDIER
	}

	p.Lock()
	p.HasSoldierArmor = enabled
	for _, spawning := range p.UnitSpawning {
		if spawning.UnitType == SOLDIER {
			spawning.UnitVariant = targetVariant
		}
	}
	p.Unlock()
}

func (p *Player) ApplyTankBoosterUpgrade(enabled bool) {
	p.Lock()
	p.HasTankBooster = enabled
	for _, spawning := range p.UnitSpawning {
		if spawning.UnitType != TANK {
			continue
		}
		if spawning.Barracks != nil && spawning.Barracks.Variant == TANK_FACTORY {
			switch {
			case p.HasTankBooster && p.HasTankCannon:
				spawning.UnitVariant = BOOSTER_ENGINE_CANNON_TANK
			case p.HasTankBooster:
				spawning.UnitVariant = BOOSTER_ENGINE_TANK
			case p.HasTankCannon:
				spawning.UnitVariant = CANNON_TANK
			default:
				spawning.UnitVariant = BASIC_UNIT
			}
		}
	}
	p.Unlock()
}

func (p *Player) ApplyTankCannonUpgrade(enabled bool) {
	p.Lock()
	p.HasTankCannon = enabled
	for _, spawning := range p.UnitSpawning {
		if spawning.UnitType != TANK {
			continue
		}
		if spawning.Barracks != nil && spawning.Barracks.Variant == TANK_FACTORY {
			switch {
			case p.HasTankBooster && p.HasTankCannon:
				spawning.UnitVariant = BOOSTER_ENGINE_CANNON_TANK
			case p.HasTankBooster:
				spawning.UnitVariant = BOOSTER_ENGINE_TANK
			case p.HasTankCannon:
				spawning.UnitVariant = CANNON_TANK
			default:
				spawning.UnitVariant = BASIC_UNIT
			}
		}
	}
	p.Unlock()
}

func (p *Player) ApplyTankCloakUpgrade(enabled bool) {
	p.Lock()
	p.HasTankCloak = enabled
	p.Unlock()
}

func (p *Player) HasBarracksVariant(variant BuildingVariant) bool {
	p.RLock()
	defer p.RUnlock()
	for _, spawning := range p.UnitSpawning {
		if spawning.Barracks != nil && spawning.Barracks.Variant == variant {
			return true
		}
	}
	return false
}
