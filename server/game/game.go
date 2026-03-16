package game

import (
	"log"
	"math"
	"math/rand"
	"sort"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type GameState struct {
	Players            map[ID]*Player
	NeutralBases       []*NeutralBase
	Bushes             []PositionInt
	Rocks              []Rock
	WildPortals        map[ID]*WildPortal
	AvailablePortalIDs *AvailableIDs
	AvailablePositions map[PositionInt]bool
	Leaderboard        *Leaderboard
	sync.RWMutex
}

var (
	State = GameState{
		Players:            make(map[ID]*Player),
		WildPortals:        make(map[ID]*WildPortal),
		AvailablePortalIDs: InitAvailableIDs(256),
		AvailablePositions: make(map[PositionInt]bool),
	}
	availablePlayerIDs *AvailableIDs
	Status             GameStatus
)

type GameStatus int

const (
	Initializing GameStatus = iota
	Running
)

func init() {
	Status = Initializing
	go StartEventDispatcher()

	// Start the updates
	go startResourceUpdateLoop()
	go startRegenerationLoop()
	go startInactivityCheckLoop()
	go startUnitSpawnLoop()
	go startTargetingLoop()
	go startEntityUpdateLoop()
	go startProtectionCheckLoop()
	go startCommanderRegenerationLoop()
}

type WildPortal struct {
	ID           ID
	Position     PositionFloat
	ExpiresAt    time.Time
	DestinationX float32
	DestinationY float32
}

// clearSpawnArea removes bushes and rocks within a radius of the spawn position
func clearSpawnArea(position PositionInt, radius float32) {
	posFloat := PositionFloat{X: float32(position.X), Y: float32(position.Y)}

	// Clear bushes
	var newBushes []PositionInt
	for _, bush := range State.Bushes {
		bushFloat := PositionFloat{X: float32(bush.X), Y: float32(bush.Y)}
		if posFloat.DistanceTo(bushFloat) > radius {
			newBushes = append(newBushes, bush)
		}
	}
	State.Bushes = newBushes

	// Clear rocks
	var newRocks []Rock
	for _, rock := range State.Rocks {
		if posFloat.DistanceTo(rock.Polygon.Center) > radius {
			newRocks = append(newRocks, rock)
		}
	}
	State.Rocks = newRocks
}

func Start() {
	rand.Seed(time.Now().UnixNano()) // Initialize random seed
	availablePlayerIDs = InitAvailableIDs(64)
	InitializeGameMap()
	State.Leaderboard = &Leaderboard{}

	InitializeNonSkinColors()
	loadSkins()

	Status = Running
	log.Println("Game is running")
}

func startRegenerationLoop() {
	ticker := time.NewTicker(PLAYER_HEALTH_REGENERATION_FREQUENCY * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		State.RLock()
		for _, player := range State.Players {
			if !player.Base.Health.hasMaxHealth() && !player.WasBaseDamagedWithin(15*time.Second) {
				player.Base.Health.Increment(PLAYER_HEALTH_REGENERATION)
				TriggerBaseHealthUpdateEvent(player.Base)
			}
			for _, neutral := range player.CapturedNeutralBases {
				if !neutral.Base.Health.hasMaxHealth() {
					neutral.Base.Health.Increment(PLAYER_HEALTH_REGENERATION)
					TriggerBaseHealthUpdateEvent(neutral.Base)
				}
			}
		}

		State.RUnlock()
	}
}

func startInactivityCheckLoop() {
	ticker := time.NewTicker(1 * time.Second) // Check every second
	defer ticker.Stop()

	for range ticker.C {
		State.RLock()
		for _, player := range State.Players {
			if player.IsMarkedForRemoval() {
				continue
			}

			// Kick after 10 minutes
			if time.Since(player.GetLastActivity()) > PLAYER_TIMEOUT*time.Minute {
				player.MarkForRemoval()
				TriggerKickEvent(player, KICK_REASON_TIMEOUT)
				continue
			}

				// Show AFK warning after configured delay.
				if time.Since(player.GetLastActivity()) > PLAYER_INACTIVITY_WARNING_DELAY*time.Minute &&
					time.Since(player.LastActivityWarningSent) > 10*time.Second {
					player.LastActivityWarningSent = time.Now()
					// Send warning message to player
					TriggerPlayerInactiveWarningEvent(player)
				}
		}
		State.RUnlock()
	}
}

func startProtectionCheckLoop() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		State.RLock()
		for _, player := range State.Players {
			// Self-heal stale duel state to avoid combat lock.
			player.RLock()
			inDuel := player.InDuel
			opponentID := player.DuelOpponentID
			player.RUnlock()
			if !inDuel {
				continue
			}

			opponent := State.Players[opponentID]
			if opponent == nil {
				player.Lock()
				player.InDuel = false
				player.DuelOpponentID = 0
				player.DuelArena = DuelArena{}
				player.DuelPrepEndsAt = time.Time{}
				player.Unlock()
				continue
			}

			opponent.RLock()
			oppInDuel := opponent.InDuel
			oppOpponentID := opponent.DuelOpponentID
			opponent.RUnlock()
			if !oppInDuel || oppOpponentID != player.ID {
				player.Lock()
				player.InDuel = false
				player.DuelOpponentID = 0
				player.DuelArena = DuelArena{}
				player.DuelPrepEndsAt = time.Time{}
				player.Unlock()
			}
		}
		State.RUnlock()
	}
}

func startCommanderRegenerationLoop() {
	ticker := time.NewTicker(COMMANDER_HEALTH_REGENERATION_FREQUENCY * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		State.RLock()
		for _, player := range State.Players {
			for _, unit := range player.Units {
				if unit.Type == COMMANDER {
					if time.Since(unit.LastDamageTime) > COMMANDER_HEALTH_REGENERATION_DELAY*time.Second && unit.Health.Current < unit.Health.Max {
						unit.Health.Increment(COMMANDER_HEALTH_REGENERATION)
						TriggerUnitHealthUpdateEvent(player, unit)
					}
				}
			}
		}
		State.RUnlock()
	}
}

func snapshotWildPortalsLocked() []WildPortalSnapshot {
	portals := make([]WildPortalSnapshot, 0, len(State.WildPortals))
	for _, portal := range State.WildPortals {
		if portal == nil {
			continue
		}
		portals = append(portals, WildPortalSnapshot{
			ID:       portal.ID,
			Position: portal.Position,
		})
	}
	return portals
}

func randomPortalPositionWithRadius(mapRadius int16, padding float32) PositionFloat {
	radius := float32(mapRadius) - padding
	if radius < 0 {
		radius = 0
	}

	return PositionFloat{
		X: (rand.Float32()*2 - 1) * radius,
		Y: (rand.Float32()*2 - 1) * radius,
	}
}

func startWildPortalLoop() {
	// Disabled by gameplay rule: no random wild portals on map.
	const wildPortalsEnabled = false
	if !wildPortalsEnabled {
		return
	}

	const (
		portalTTL              = 35 * time.Second
		portalTick             = 1 * time.Second
		minSpawnEvery          = 12 * time.Second
		maxSpawnEvery          = 22 * time.Second
		maxConcurrentPortals   = 3
		minDistanceToAnyPortal = 260.0
	)

	ticker := time.NewTicker(portalTick)
	defer ticker.Stop()

	nextSpawnAt := time.Now().Add(minSpawnEvery)

	for range ticker.C {
		now := time.Now()
		changed := false
		var snapshot []WildPortalSnapshot

		State.Lock()

		// Remove expired portals.
		for id, portal := range State.WildPortals {
			if portal == nil || now.After(portal.ExpiresAt) {
				delete(State.WildPortals, id)
				State.AvailablePortalIDs.returnID(id)
				changed = true
			}
		}

		// Spawn new portal occasionally.
		if now.After(nextSpawnAt) && len(State.WildPortals) < maxConcurrentPortals {
			if portalID, ok := State.AvailablePortalIDs.getNextAvailableID(); ok {
				spawnPadding := float32(GetBuildingSize(PORTAL) + 14)
				mapRadius := calculateMapRadius(len(State.Players))

				spawnPos := randomPortalPositionWithRadius(mapRadius, spawnPadding)
				attempts := 0
				for attempts < 10 {
					tooClose := false
					for _, existing := range State.WildPortals {
						if existing == nil {
							continue
						}
						dx := float64(existing.Position.X - spawnPos.X)
						dy := float64(existing.Position.Y - spawnPos.Y)
						if dx*dx+dy*dy < minDistanceToAnyPortal*minDistanceToAnyPortal {
							tooClose = true
							break
						}
					}
					if !tooClose {
						break
					}
					spawnPos = randomPortalPositionWithRadius(mapRadius, spawnPadding)
					attempts++
				}

				destination := randomPortalPositionWithRadius(mapRadius, spawnPadding+40)
				State.WildPortals[portalID] = &WildPortal{
					ID:           portalID,
					Position:     spawnPos,
					ExpiresAt:    now.Add(portalTTL),
					DestinationX: destination.X,
					DestinationY: destination.Y,
				}
				changed = true
			}
		}

		if changed {
			snapshot = snapshotWildPortalsLocked()
		}

		State.Unlock()

		if changed {
			TriggerWildPortalsUpdateEvent(snapshot)
		}

		// Recalculate next spawn schedule.
		if now.After(nextSpawnAt) {
			window := maxSpawnEvery - minSpawnEvery
			nextSpawnAt = now.Add(minSpawnEvery + time.Duration(rand.Int63n(int64(window))))
		}
	}
}

func resolvePortalOwnerPlayer(building *Building) *Player {
	if building == nil || building.Owner == nil {
		return nil
	}
	if owner, ok := building.Owner.(*Player); ok {
		return owner
	}
	if neutral, ok := building.Owner.(*NeutralBase); ok {
		return neutral.CapturedBy
	}
	return nil
}

func startOwnedPortalLifecycleLoop() {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	portalLifetime := time.Duration(PORTAL_LIFETIME_SECONDS) * time.Second
	portalCooldown := time.Duration(PORTAL_COOLDOWN_SECONDS) * time.Second

	for range ticker.C {
		State.RLock()
		players := make([]*Player, 0, len(State.Players))
		for _, p := range State.Players {
			if p != nil && !p.IsMarkedForRemoval() {
				players = append(players, p)
			}
		}
		State.RUnlock()

		type portalEntry struct {
			base     *Base
			building *Building
		}
		expiredPortals := make([]portalEntry, 0)
		now := time.Now()

		for _, p := range players {
			if p == nil || p.Base == nil {
				continue
			}

			p.Base.RLock()
			for _, b := range p.Base.Buildings {
				if b == nil || b.Type != PORTAL || b.IsMarkedForRemoval() {
					continue
				}
				if !b.PlacedAt.IsZero() && now.Sub(b.PlacedAt) >= portalLifetime {
					expiredPortals = append(expiredPortals, portalEntry{base: p.Base, building: b})
				}
			}
			p.Base.RUnlock()

			p.RLock()
			captured := make([]*NeutralBase, 0, len(p.CapturedNeutralBases))
			captured = append(captured, p.CapturedNeutralBases...)
			p.RUnlock()

			for _, neutral := range captured {
				if neutral == nil || neutral.Base == nil {
					continue
				}
				neutral.Base.RLock()
				for _, b := range neutral.Base.Buildings {
					if b == nil || b.Type != PORTAL || b.IsMarkedForRemoval() {
						continue
					}
					if !b.PlacedAt.IsZero() && now.Sub(b.PlacedAt) >= portalLifetime {
						expiredPortals = append(expiredPortals, portalEntry{base: neutral.Base, building: b})
					}
				}
				neutral.Base.RUnlock()
			}
		}

		if len(expiredPortals) == 0 {
			continue
		}

		for _, expired := range expiredPortals {
			if expired.base == nil || expired.building == nil {
				continue
			}

			owner := resolvePortalOwnerPlayer(expired.building)
			if owner != nil {
				next := now.Add(portalCooldown)
				owner.Lock()
				if owner.NextPortalAllowedAt.Before(next) {
					owner.NextPortalAllowedAt = next
				}
				owner.Unlock()
			}

			handleBuildingDestroyed(expired.building, expired.base)
		}
	}
}

func startResourceUpdateLoop() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

		for range ticker.C {
			State.RLock()
			for _, player := range State.Players {
				generatingPower := player.GetGenerating().Power
				player.Resources.Power.Increment(generatingPower)

			numNeutralBases := len(player.CapturedNeutralBases)

				// Calculate score increment while ensuring it doesn't go negative or overflow
				scoreIncrement := int32(generatingPower) - 1 + int32(numNeutralBases)*10 // Calculate as int32 to prevent overflow

					// Ensure the score increment is non-negative
					if scoreIncrement < 0 {
						scoreIncrement = 0 // Prevent negative score increments
					}

					// Base passive generation is 1. If total generation is <= 1, the player has
					// no Generator/Micro Generator and should still gain at least +1 score/s.
					if generatingPower <= 1 && scoreIncrement < 1 {
						scoreIncrement = 1
					}

				// Passive score gain is enabled when spawn protection is off.
				if !player.HasProtection() {
					player.IncrementScore(uint32(scoreIncrement)) // Cast back to uint32
				}

				// Trigger resource update event
				TriggerResourceUpdateEvent(player)
			}
			State.RUnlock()
		}
}

func isCommanderOutsideSpawnProtectionArea(player *Player) bool {
	if player == nil || player.Base == nil {
		return false
	}

	basePosition := IntToFloat(player.Base.Position)
	protectionRadius := float32(PLAYER_SPAWN_PROTECTION_RADIUS)

	player.RLock()
	defer player.RUnlock()

	for _, unit := range player.Units {
		if unit == nil || unit.IsMarkedForRemoval() || unit.Type != COMMANDER {
			continue
		}
		allowedRadius := protectionRadius - float32(unit.Size)
		if allowedRadius < 0 {
			allowedRadius = 0
		}
		if !unit.IsWithinRadius(basePosition, allowedRadius) {
			return true
		}
	}

	return false
}

func startUnitSpawnLoop() {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {

		State.RLock()
		players := make([]*Player, 0, len(State.Players)) // Create a slice of players
		for _, player := range State.Players {
			players = append(players, player)
		}
		State.RUnlock()

		for _, player := range players {

			if player.IsMarkedForRemoval() {
				continue
			}

			for _, spawning := range player.UnitSpawning {
				if spawning == nil || spawning.Barracks == nil || !spawning.Activated {
					continue
				}
				if spawning.Barracks.IsMarkedForRemoval() {
					continue
				}

				// Frequencies are configured in milliseconds (legacy parity).
				if spawning.Frequency.Current > 0 {
					decrement := uint16(100) // 100ms tick
					spawning.Frequency.Decrement(decrement)
				}

				// Only proceed if the frequency has reached zero
				if spawning.Frequency.Get() == 0 {
					// Check and increment population
					requiredPopulation, ok := GetUnitRequiredPopulation(spawning.UnitType)
					if !ok {
						log.Println("Could not find required population for unit")
						continue
					}

					if !player.Population.IncrementUsed(requiredPopulation) {
						continue
					}

					unit, ok := player.AddUnit(spawning.UnitType, spawning.UnitVariant, spawning.Barracks)
					if !ok {
						player.Population.DecrementUsed(requiredPopulation)
						//log.Printf("Could not add unit of type %v to player %v", spawning.UnitType, player.ID)
						continue
					}
					spawning.Frequency.Reset()

					player.AddUnitBulletSpawning(unit)

					TriggerUnitSpawnEvent(unit, spawning.Barracks)
				}
			}
		}
	}
}

func startTargetingLoop() {
	duration := 100 * time.Millisecond
	ticker := time.NewTicker(duration)
	defer ticker.Stop()

	for range ticker.C {
		State.RLock()
		players := make([]*Player, 0, len(State.Players))
		for _, player := range State.Players {
			if !player.IsMarkedForRemoval() {
				players = append(players, player)
			}
		}
		neutrals := make([]*NeutralBase, 0, len(State.NeutralBases))
		neutrals = append(neutrals, State.NeutralBases...)
		State.RUnlock()

		var wg sync.WaitGroup
		wg.Add(len(players) + len(neutrals))

		// Process captured neutral bases
		for _, player := range players {
			go func(player *Player) {
				defer wg.Done()
				processPlayerTurrets(player, duration, players)
				processPlayerUnitTurrets(player, duration, players, neutrals)
			}(player)
		}

		// Process non-captured neutral bases
		for _, neutral := range neutrals {
			go func(neutral *NeutralBase) {
				defer wg.Done()
				processNeutralTurrets(neutral, duration, players)
			}(neutral)
		}
		wg.Wait()
	}
}

func processPlayerTurrets(player *Player, duration time.Duration, players []*Player) {
	player.Base.RLock()
	spawnings := make([]*BulletSpawning, 0, len(player.Base.BulletSpawning))
	spawnings = append(spawnings, player.Base.BulletSpawning...)
	player.Base.RUnlock()

	for _, spawning := range spawnings {
		if spawning.Shooter.IsMarkedForRemoval() { // Check before adding
			continue
		}

		// Always decrement the frequency
		decrement := uint16(duration.Milliseconds())
		spawning.Frequency.Decrement(decrement)

		// Only proceed if the frequency has reached zero
		if spawning.Frequency.Get() == 0 {
			turret := spawning.Shooter.GetObjectPointer().(*Building)
			turretOwner := turret.Owner

			ownerBase := turret.Owner.(*Player).Base

			// Find the closest unit and spawn bullets if in range
			closestUnit := findClosestUnitInRange(spawning, players, player)
				if closestUnit != nil {
					spawning.Frequency.Reset()
					closedUnitPosition := closestUnit.GetPosition()
					TriggerTurretRotationUpdateEvent(turretOwner, turret, closedUnitPosition)
					if !spawnTurretVolley(ownerBase, spawning, closedUnitPosition, turretOwner, turret) {
						log.Println("Could not add bullet to owner")
					}
				}
			}
		}
	}

func processNeutralTurrets(neutral *NeutralBase, duration time.Duration, players []*Player) {
	neutral.Base.RLock()
	spawnings := make([]*BulletSpawning, 0, len(neutral.Base.BulletSpawning))
	spawnings = append(spawnings, neutral.Base.BulletSpawning...)
	neutral.Base.RUnlock()

	for _, spawning := range spawnings {
		if spawning.Shooter.IsMarkedForRemoval() { // Check before adding
			continue
		}

		// Always decrement the frequency
		decrement := uint16(duration.Milliseconds())
		spawning.Frequency.Decrement(decrement)

		// Only proceed if the frequency has reached zero
		if spawning.Frequency.Get() == 0 {
			turret := spawning.Shooter.GetObjectPointer().(*Building)
			turretOwner := turret.Owner

			// Find the closest unit and spawn bullets if in range
			closestUnit := findClosestUnitInRange(spawning, players, neutral.CapturedBy)
				if closestUnit != nil {
					spawning.Frequency.Reset()
					closedUnitPosition := closestUnit.GetPosition()
					TriggerTurretRotationUpdateEvent(turretOwner, turret, closedUnitPosition)
					if !spawnTurretVolley(neutral.Base, spawning, closedUnitPosition, turretOwner, turret) {
						log.Println("Could not add bullet to neutral base owner")
					}
				}
			}
		}
	}

func spawnTurretVolley(base *Base, spawning *BulletSpawning, target PositionFloat, owner Owner, turret *Building) bool {
	offsets := []float32{0}
	if turret != nil && turret.Type == SIMPLE_TURRET {
		switch turret.Variant {
		case TWIN_TURRET:
			// Twin: two-shot volley.
			offsets = []float32{-10, 10}
		case SPOTTER_TURRET:
			// Spotter: three-shot volley.
			offsets = []float32{-12, 0, 12}
		}
	}

	firedAny := false
	for _, offset := range offsets {
		bullet, ok := base.AddBullet(spawning, target, offset)
		if !ok {
			continue
		}
		TriggerBulletSpawnEvent(owner, bullet, turret)
		firedAny = true
	}
	return firedAny
}

func processPlayerUnitTurrets(player *Player, duration time.Duration, players []*Player, neutrals []*NeutralBase) {
	player.RLock()
	unitSpawnings := make([]*BulletSpawning, 0, len(player.UnitBulletSpawning))
	unitSpawnings = append(unitSpawnings, player.UnitBulletSpawning...)
	player.RUnlock()

	for _, spawning := range unitSpawnings {
		// Check if the Turret is marked for removal
		if spawning.Shooter.IsMarkedForRemoval() {
			continue
		}

		// Always decrement the frequency
		decrement := uint16(duration.Milliseconds())
		spawning.Frequency.Decrement(decrement)

		// Only proceed if the frequency has reached zero
		if spawning.Frequency.Get() == 0 {
			unit := spawning.Shooter.GetObjectPointer().(*Unit)

			closestUnit := findClosestUnitInRange(spawning, players, player)
			if closestUnit != nil {
				spawning.Frequency.Reset()
				closestUnitPosition := closestUnit.GetPosition()
				bullet, ok := player.Base.AddBullet(spawning, closestUnitPosition, 0)
				if ok {
					TriggerUnitBulletSpawnEvent(player, bullet, unit)
				} else {
					log.Println("Could not add bullet to player")
				}
				continue
			}

			closestBuilding := findClosestBuildingInRange(spawning, player, players)
			if closestBuilding != nil {
				spawning.Frequency.Reset()
				closedBuildingPosition := closestBuilding.GetPosition()
				bullet, ok := player.Base.AddBullet(spawning, closedBuildingPosition, 0)
				if ok {
					TriggerUnitBulletSpawnEvent(player, bullet, unit)
				} else {
					log.Println("Could not add bullet to player")
				}
				continue
			}

			closestBuilding = findClosestBuildingInRangeNeutralBase(spawning, player, neutrals)
			if closestBuilding != nil {
				spawning.Frequency.Reset()
				closedBuildingPosition := closestBuilding.GetPosition()
				bullet, ok := player.Base.AddBullet(spawning, closedBuildingPosition, 0)
				if ok {
					TriggerUnitBulletSpawnEvent(player, bullet, unit)
				} else {
					log.Println("Could not add bullet to player")
				}
				continue
			}
		}
	}
}

func findClosestUnitInRange(spawning *BulletSpawning, players []*Player, excludePlayer *Player) *Unit {
	var closestUnit *Unit
	minDistance := float32(math.MaxFloat32)
	shooterBuilding, shooterIsTower := spawning.Shooter.GetObjectPointer().(*Building)
	revealsCloak := shooterIsTower &&
		shooterBuilding != nil &&
		shooterBuilding.Type == SIMPLE_TURRET &&
		shooterBuilding.Variant == SPOTTER_TURRET

	for _, otherPlayer := range players {
		if excludePlayer == otherPlayer || otherPlayer.IsMarkedForRemoval() {
			continue
		}
		if excludePlayer != nil && !CanPlayersInteract(excludePlayer, otherPlayer) {
			continue
		}
		if otherPlayer.HasProtection() && !AreDuelOpponents(excludePlayer, otherPlayer) {
			continue
		}

		// Lock the player to access units
		otherPlayer.RLock()
		otherPlayerUnits := make([]*Unit, 0, len(otherPlayer.Units))
		for _, otherPlayerUnit := range otherPlayer.Units {
			otherPlayerUnits = append(otherPlayerUnits, otherPlayerUnit)
		}
		otherPlayer.RUnlock()

		for _, unit := range otherPlayerUnits {
			if unit.IsMarkedForRemoval() {
				continue
			}
				if shooterIsTower && otherPlayer.HasTankCloak && unit.Type == TANK && !revealsCloak {
					continue
				}

			// ? GetPosition doesnt use a LOCK
			turretPosition := spawning.Shooter.GetPosition()
			unitPosition := unit.GetPosition()

			distance := turretPosition.DistanceTo(unitPosition)
			if distance < minDistance && distance <= float32(spawning.Range) {
				minDistance = distance
				closestUnit = unit
			}
		}
	}
	return closestUnit
}

func findClosestBuildingInRange(spawning *BulletSpawning, player *Player, players []*Player) *Building {
	var closestBuilding *Building
	minDistance := float32(math.MaxFloat32)

	for _, otherPlayer := range players {
		if player == otherPlayer || otherPlayer.IsMarkedForRemoval() {
			continue
		}
		if !CanPlayersInteract(player, otherPlayer) {
			continue
		}
		if otherPlayer.HasProtection() && !AreDuelOpponents(player, otherPlayer) {
			continue
		}

		// Lock the player to access units
		otherPlayer.Base.RLock()
		otherPlayerBuildings := make([]*Building, 0, len(otherPlayer.Base.Buildings))
		for _, otherPlayerBuilding := range otherPlayer.Base.Buildings {
			otherPlayerBuildings = append(otherPlayerBuildings, otherPlayerBuilding)
		}
		otherPlayer.Base.RUnlock()

		for _, building := range otherPlayerBuildings {
			if building.IsMarkedForRemoval() {
				continue
			}

			// ? GetPosition doesnt use a LOCK
			turretPosition := spawning.Shooter.GetPosition()
			buildingPosition := building.GetPosition()

			distance := turretPosition.DistanceTo(buildingPosition)
			if distance < minDistance && distance <= float32(spawning.Range) {
				minDistance = distance
				closestBuilding = building
			}
		}
	}
	return closestBuilding
}

func findClosestBuildingInRangeNeutralBase(spawning *BulletSpawning, player *Player, neutral []*NeutralBase) *Building {
	var closestBuilding *Building
	minDistance := float32(math.MaxFloat32)

	for _, neutral := range neutral {

		// Check if the player has captured the neutral base
		if neutral.CapturedBy == player {
			continue // Skip if the player has captured this neutral base
		}

		// Lock the neutral base to access buildings
		neutral.Base.RLock()
		neutralBaseBuildings := make([]*Building, 0, len(neutral.Base.Buildings))
		for _, building := range neutral.Base.Buildings {
			neutralBaseBuildings = append(neutralBaseBuildings, building)
		}
		neutral.Base.RUnlock()

		for _, building := range neutralBaseBuildings {
			if building.IsMarkedForRemoval() {
				continue
			}

			// ? GetPosition doesnt use a LOCK
			turretPosition := spawning.Shooter.GetPosition()
			buildingPosition := building.GetPosition()

			distance := turretPosition.DistanceTo(buildingPosition)
			if distance < minDistance && distance <= float32(spawning.Range) {
				minDistance = distance
				closestBuilding = building
			}
		}
	}
	return closestBuilding
}

// hasCaptured checks if the player has captured the given neutral base
func hasCaptured(base *NeutralBase, capturedBases []*NeutralBase) bool {
	for _, capturedBase := range capturedBases {
		if capturedBase == base { // Compare pointers to check if it's the same base
			return true
		}
	}
	return false
}

func startEntityUpdateLoop() {
	duration := 50 * time.Millisecond
	ticker := time.NewTicker(duration)
	defer ticker.Stop()

	for range ticker.C {
		State.RLock()
		players := make([]*Player, 0, len(State.Players))
		for _, player := range State.Players {
			if !player.IsMarkedForRemoval() {
				players = append(players, player)
			}
		}
		neutrals := make([]*NeutralBase, 0, len(State.NeutralBases))
		neutrals = append(neutrals, State.NeutralBases...)
		State.RUnlock()

		updateEntities(players, neutrals, duration)
		checkCollisions(players, neutrals)
	}
}

func updateEntities(players []*Player, neutrals []*NeutralBase, duration time.Duration) {
	for _, player := range players {
		updateBullets(player.Base, duration)
		updateUnits(player, duration, players)
	}
	for _, neutral := range neutrals {
		updateBullets(neutral.Base, duration)
	}
}

func updateBullets(base *Base, duration time.Duration) {
	base.RLock()
	bullets := make([]*Bullet, 0, len(base.Bullets))
	for _, bullet := range base.Bullets {
		bullets = append(bullets, bullet)
	}
	base.RUnlock()

	for _, bullet := range bullets {
		if bullet.isMarkedForRemoval() {
			continue
		}

		// Skip position update if bullet is a trapper and has already reached target
		if bullet.Behavior == TrapperBullet && bullet.ReachedTargetPosition {
			// Handle stay duration countdown for trapper bullets
			if bullet.StayDuration > 0 {
				bullet.StayDuration -= duration
			}
			// Remove the trapper bullet once its stay duration has expired
			if bullet.StayDuration <= 0 {
				TriggerBulletRemoveEvent(base.Owner, bullet.ID)
				bullet.MarkForRemoval()
				base.RemoveBullet(bullet.ID)
			}
			continue
		}

		updated := bullet.UpdatePosition(duration)
		if !updated {
			// Handle normal bullet behavior
			if bullet.Behavior != TrapperBullet {
				TriggerBulletRemoveEvent(base.Owner, bullet.ID)
				bullet.MarkForRemoval()
				base.RemoveBullet(bullet.ID)
				continue
			} else {
				bullet.ReachedTargetPosition = true
				continue // No need to trigger position update for trapper bullets once they reach the target
			}
		}

		// Trigger position update event only if bullet still moves or is not a trapper bullet
		TriggerBulletPositionUpdateEvent(base.Owner, bullet)
	}
}

type portalPair struct {
	A *Building
	B *Building
}

const unitPortalTeleportCooldown = 1200 * time.Millisecond

func collectOwnedPortals(player *Player) []*Building {
	portals := make([]*Building, 0, 2)
	if player == nil {
		return portals
	}

	player.Base.RLock()
	for _, building := range player.Base.Buildings {
		if building.Type == PORTAL && !building.IsMarkedForRemoval() {
			portals = append(portals, building)
		}
	}
	player.Base.RUnlock()

	player.RLock()
	capturedNeutrals := make([]*NeutralBase, 0, len(player.CapturedNeutralBases))
	capturedNeutrals = append(capturedNeutrals, player.CapturedNeutralBases...)
	player.RUnlock()

	for _, neutral := range capturedNeutrals {
		if neutral == nil || neutral.Base == nil {
			continue
		}
		neutral.Base.RLock()
		for _, building := range neutral.Base.Buildings {
			if building.Type == PORTAL && !building.IsMarkedForRemoval() {
				portals = append(portals, building)
			}
		}
		neutral.Base.RUnlock()
	}

	sort.Slice(portals, func(i, j int) bool {
		return portals[i].ID < portals[j].ID
	})

	return portals
}

func getPortalPairs(players []*Player) []portalPair {
	pairs := make([]portalPair, 0, len(players))

	for _, owner := range players {
		portals := collectOwnedPortals(owner)
		if len(portals) < 2 {
			continue
		}
		pairs = append(pairs, portalPair{A: portals[0], B: portals[1]})
	}

	return pairs
}

func applyPortalTeleportForUnit(unit *Unit, portalPairs []portalPair) bool {
	if unit == nil || len(portalPairs) == 0 {
		return false
	}
	if !unit.LastPortalTeleportAt.IsZero() && time.Since(unit.LastPortalTeleportAt) < unitPortalTeleportCooldown {
		return false
	}

	var (
		closestSource      *Building
		closestDestination *Building
		minDistanceSq      = float64(math.MaxFloat64)
	)

	for _, pair := range portalPairs {
		if pair.A == nil || pair.B == nil || pair.A.IsMarkedForRemoval() || pair.B.IsMarkedForRemoval() {
			continue
		}

		checkEndpoint := func(source *Building, destination *Building) {
			dx := float64(unit.Position.X - source.Position.X)
			dy := float64(unit.Position.Y - source.Position.Y)
			distanceSq := dx*dx + dy*dy
			activationRadius := float64(GetBuildingSize(PORTAL) + unit.Size + 6)
			if distanceSq <= activationRadius*activationRadius && distanceSq < minDistanceSq {
				minDistanceSq = distanceSq
				closestSource = source
				closestDestination = destination
			}
		}

		checkEndpoint(pair.A, pair.B)
		checkEndpoint(pair.B, pair.A)
	}

	if closestSource == nil || closestDestination == nil {
		return false
	}

	source := closestSource.Position
	destination := closestDestination.Position

	dirX := destination.X - source.X
	dirY := destination.Y - source.Y
	length := float32(math.Sqrt(float64(dirX*dirX + dirY*dirY)))
	if length <= 0.0001 {
		dirX, dirY = 1, 0
		length = 1
	}
	normalX := dirX / length
	normalY := dirY / length
	exitDistance := float32(GetBuildingSize(PORTAL) + unit.Size + 8)

	newPosition := PositionFloat{
		X: destination.X + normalX*exitDistance,
		Y: destination.Y + normalY*exitDistance,
	}

	deltaX := newPosition.X - unit.Position.X
	deltaY := newPosition.Y - unit.Position.Y

	unit.Lock()
	unit.Position = newPosition
	unit.TargetPosition.X += deltaX
	unit.TargetPosition.Y += deltaY
	unit.LastPortalTeleportAt = time.Now()
	unit.Unlock()

	return true
}

func applyWildPortalTeleportForUnit(unit *Unit, wildPortals []*WildPortal) bool {
	if unit == nil || len(wildPortals) == 0 {
		return false
	}
	if !unit.LastPortalTeleportAt.IsZero() && time.Since(unit.LastPortalTeleportAt) < unitPortalTeleportCooldown {
		return false
	}

	var closest *WildPortal
	minDistanceSq := float64(math.MaxFloat64)
	activationRadius := float64(GetBuildingSize(PORTAL) + unit.Size + 8)

	for _, portal := range wildPortals {
		if portal == nil {
			continue
		}
		dx := float64(unit.Position.X - portal.Position.X)
		dy := float64(unit.Position.Y - portal.Position.Y)
		distanceSq := dx*dx + dy*dy
		if distanceSq <= activationRadius*activationRadius && distanceSq < minDistanceSq {
			minDistanceSq = distanceSq
			closest = portal
		}
	}

	if closest == nil {
		return false
	}

	newPosition := ClampPositionFloatToMap(PositionFloat{
		X: closest.DestinationX,
		Y: closest.DestinationY,
	}, float32(unit.Size+8))

	deltaX := newPosition.X - unit.Position.X
	deltaY := newPosition.Y - unit.Position.Y

	unit.Lock()
	unit.Position = newPosition
	unit.TargetPosition.X += deltaX
	unit.TargetPosition.Y += deltaY
	unit.LastPortalTeleportAt = time.Now()
	unit.Unlock()

	return true
}

func updateUnits(player *Player, duration time.Duration, _ []*Player) {
	// Lock the player to access units
	player.RLock()
	units := make([]*Unit, 0, len(player.Units))
	for _, unit := range player.Units {
		units = append(units, unit)
	}
	player.RUnlock()

	// Slice to hold units that have been updated
	updatedUnits := make([]*Unit, 0)
	mapRadius := float32(GetCurrentMapRadius())
	for _, unit := range units {
		if unit.IsMarkedForRemoval() {
			continue
		}

		// Units die when touching the red world border.
		if math.Abs(float64(unit.Position.X))+float64(unit.Size) >= float64(mapRadius) ||
			math.Abs(float64(unit.Position.Y))+float64(unit.Size) >= float64(mapRadius) {
			unit.MarkForRemoval()
			handleUnitDestroyed(unit)
			continue
		}

		// Update unit position
		if unit.UpdatePosition(duration, units) {
			if math.Abs(float64(unit.Position.X))+float64(unit.Size) >= float64(mapRadius) ||
				math.Abs(float64(unit.Position.Y))+float64(unit.Size) >= float64(mapRadius) {
				unit.MarkForRemoval()
				handleUnitDestroyed(unit)
				continue
			}
			updatedUnits = append(updatedUnits, unit)
		}
	}

	// Trigger a single update event for all updated units
	if len(updatedUnits) > 0 {
		TriggerUnitPositionUpdatesEvent(player, updatedUnits)
	}
}

func checkCollisions(players []*Player, neutrals []*NeutralBase) {
	for _, player := range players {
		// Lock the player to access units
		player.RLock()
		units := make([]*Unit, 0, len(player.Units))
		for _, unit := range player.Units {
			units = append(units, unit)
		}
		player.RUnlock()

		player.Base.RLock()
		buildings := make([]*Building, 0, len(player.Base.Buildings))
		for _, building := range player.Base.Buildings {
			buildings = append(buildings, building)
		}
		player.Base.RUnlock()

		checkBulletCollisions(player, players, neutrals, units, buildings)

		checkBaseCollisions(player, players, units)

		checkNeutralBaseCollisions(player, neutrals, units)

		checkUnitCollisions(player, players, units)

		checkRockCollisions(units)

	}
}

func checkRockCollisions(units []*Unit) {
	for _, rock := range State.Rocks {

		for _, unit := range units {
			if unit.IsMarkedForRemoval() {
				continue
			}
			if isUnitCollidingWithRock(unit, &rock) {
				unit.MarkForRemoval()
				handleUnitDestroyed(unit)
			}
		}
	}
}

func isPlayerBaseDefeated(base *Base) bool {
	if base == nil {
		return true
	}

	base.Health.RLock()
	currentHealth := base.Health.Current
	maxHealth := base.Health.Max
	base.Health.RUnlock()

	if currentHealth == 0 || maxHealth == 0 {
		return true
	}

	currentRatio := float32(currentHealth) / float32(maxHealth)
	thresholdRatio := float32(PLAYER_CORE_ELIMINATION_PERCENT) / 100
	return currentRatio <= thresholdRatio
}

func getPlayerCoreRadius(base *Base) float32 {
	if base == nil {
		return 0
	}

	base.Health.RLock()
	currentHealth := base.Health.Current
	maxHealth := base.Health.Max
	base.Health.RUnlock()

	if maxHealth == 0 {
		return 0
	}

	currentRatio := float32(currentHealth) / float32(maxHealth)
	return currentRatio * PLAYER_MAX_CORE_RADIUS
}

// ! TODO: Optimize this shit
func checkBulletCollisions(player *Player, players []*Player, neutrals []*NeutralBase, units []*Unit, buildings []*Building) {
	for _, otherPlayer := range players {
		// Skip self or players marked for removal
		if otherPlayer.ID == player.ID || otherPlayer.IsMarkedForRemoval() {
			continue
		}
		if !CanPlayersInteract(player, otherPlayer) {
			continue
		}

		otherPlayer.Base.RLock()
		bullets := make([]*Bullet, 0, len(otherPlayer.Base.Bullets))
		for _, bullet := range otherPlayer.Base.Bullets {
			bullets = append(bullets, bullet)
		}
		otherPlayer.Base.RUnlock()

		for _, unit := range units {
			// Skip units that are marked for removal
			if unit.IsMarkedForRemoval() {
				continue
			}

			for _, bullet := range bullets {
				// Skip bullets that are marked for removal
				if bullet.isMarkedForRemoval() {
					continue
				}

				if isBulletCollidingWithUnit(bullet, unit) {
					unitHealth := unit.Health.Current
					bulletHealth := bullet.Health.Current

					isAlive := bullet.TakeDamage(unitHealth)
					if !isAlive { // Bullet is destroyed
						TriggerBulletRemoveEvent(otherPlayer.Base.Owner, bullet.ID)
						bullet.MarkForRemoval()
						otherPlayer.Base.RemoveBullet(bullet.ID)
					}

					damage := bulletHealth
					if bullet.Behavior == AntiTankBullet {
						if unit.Type == TANK || unit.Type == SIEGE_TANK {
							damage *= uint16(bullet.DamageMultiplier)
						} else if unit.Type == COMMANDER {
							// Keep legacy feeling: anti-tank should punish commanders heavily.
							damage *= 7
						}
					}

					isAlive = unit.TakeDamage(damage)
					if !isAlive { // Unit is destroyed
						unit.MarkForRemoval()
						handleUnitDestroyed(unit)
						break // Unit destroyed no need for more bullet checks for that unit
					} else {
						TriggerUnitHealthUpdateEvent(unit.Player, unit)
					}
				}
			}
		}

		for _, building := range buildings {
			// Skip units that are marked for removal
			if building.IsMarkedForRemoval() {
				continue
			}

			for _, bullet := range bullets {
				// Skip bullets that are marked for removal
				if bullet.isMarkedForRemoval() {
					continue
				}

				if !bullet.IsFiredByUnit() {
					continue
				}

				if isBulletCollidingWithBuilding(bullet, building) {
					buildingHealth := building.Health.Current
					bulletHealth := bullet.Health.Current

					isAlive := bullet.TakeDamage(buildingHealth)
					if !isAlive { // Bullet is destroyed
						TriggerBulletRemoveEvent(otherPlayer.Base.Owner, bullet.ID)
						bullet.MarkForRemoval()
						otherPlayer.Base.RemoveBullet(bullet.ID)
					}

					isAlive = building.TakeDamage(bulletHealth)
					if !isAlive { // Unit is destroyed
						building.MarkForRemoval()
						handleBuildingDestroyed(building, player.Base)
						break // Building destroyed no need for more bullet checks for that building
					}
				}
			}
		}

		// Unit-fired bullets can also damage the enemy core.
		playerBasePosition := IntToFloat(player.Base.Position)
		otherPlayer.RLock()
		attackerUnits := make([]*Unit, 0, len(otherPlayer.Units))
		for _, u := range otherPlayer.Units {
			attackerUnits = append(attackerUnits, u)
		}
		otherPlayer.RUnlock()

		for _, bullet := range bullets {
			if bullet.isMarkedForRemoval() {
				continue
			}
			if !bullet.IsFiredByUnit() {
				continue
			}

			// Spawn protection blocks core damage unless they are duel opponents.
			if player.HasProtection() && !AreDuelOpponents(player, otherPlayer) {
				continue
			}

			coreRadius := getPlayerCoreRadius(player.Base) + float32(bullet.Size)
			if !bullet.IsWithinRadius(playerBasePosition, coreRadius) {
				continue
			}

			playerHealth := player.Base.Health.Current
			bulletHealth := bullet.Health.Current

			isBulletAlive := bullet.TakeDamage(playerHealth)
			if !isBulletAlive {
				TriggerBulletRemoveEvent(otherPlayer.Base.Owner, bullet.ID)
				bullet.MarkForRemoval()
				otherPlayer.Base.RemoveBullet(bullet.ID)
			}

			isBaseAlive := player.Base.TakeDamage(bulletHealth)
			if isBaseAlive && isPlayerBaseDefeated(player.Base) {
				isBaseAlive = false
			}
			if !isBaseAlive {
				if !player.IsMarkedForRemoval() {
					scoreIncrement := (player.Score / 100) * 50
					powerIncrement := math.Min((float64(player.Score)/100)*10, 6000)
					otherPlayer.IncrementScore(scoreIncrement)
					otherPlayer.IncrementKills(1)
					otherPlayer.Resources.Power.Increment(uint16(powerIncrement))
					player.MarkForRemoval()
					TriggerPlayerKilledEvent(player, otherPlayer)
				}
			} else {
				TriggerBaseHealthUpdateEvent(player.Base)
			}

			// Core retaliates: closest attacking unit also takes damage.
			var (
				closestAttacker   *Unit
				closestDistanceSq = float64(math.MaxFloat64)
			)
			for _, attacker := range attackerUnits {
				if attacker == nil || attacker.IsMarkedForRemoval() {
					continue
				}
				dx := float64(attacker.Position.X - playerBasePosition.X)
				dy := float64(attacker.Position.Y - playerBasePosition.Y)
				distanceSq := dx*dx + dy*dy
				if distanceSq < closestDistanceSq {
					closestDistanceSq = distanceSq
					closestAttacker = attacker
				}
			}

			if closestAttacker != nil {
				retaliationDamage := bulletHealth
				if retaliationDamage < 80 {
					retaliationDamage = 80
				}

				attackerAlive := closestAttacker.TakeDamage(retaliationDamage)
				if !attackerAlive {
					closestAttacker.MarkForRemoval()
					handleUnitDestroyed(closestAttacker)
				} else {
					TriggerUnitHealthUpdateEvent(closestAttacker.Player, closestAttacker)
				}
			}
		}

		for _, rock := range State.Rocks {
			for _, bullet := range bullets {
				// Skip bullets that are marked for removal
				if bullet.isMarkedForRemoval() {
					continue
				}

				if !bullet.IsFiredByUnit() {
					continue
				}

				if isBulletCollidingWithRock(bullet, &rock) {
					TriggerBulletRemoveEvent(otherPlayer.Base.Owner, bullet.ID)
					bullet.MarkForRemoval()
					otherPlayer.Base.RemoveBullet(bullet.ID)
				}
			}
		}
	}

	for _, neutral := range neutrals {

		if hasCaptured(neutral, player.CapturedNeutralBases) {
			continue
		}

		neutral.Base.RLock()
		bullets := make([]*Bullet, 0, len(neutral.Base.Bullets))
		for _, bullet := range neutral.Base.Bullets {
			bullets = append(bullets, bullet)
		}
		neutral.Base.RUnlock()

		for _, unit := range units {
			// Skip units that are marked for removal
			if unit.IsMarkedForRemoval() {
				continue
			}

			for _, bullet := range bullets {
				// Skip bullets that are marked for removal
				if bullet.isMarkedForRemoval() {
					continue
				}

				if isBulletCollidingWithUnit(bullet, unit) {
					unitHealth := unit.Health.Current
					bulletHealth := bullet.Health.Current

					isAlive := bullet.TakeDamage(unitHealth)
					if !isAlive { // Bullet is destroyed
						TriggerBulletRemoveEvent(neutral.Base.Owner, bullet.ID)
						bullet.MarkForRemoval()
						neutral.Base.RemoveBullet(bullet.ID)
					}

					damage := bulletHealth
					if bullet.Behavior == AntiTankBullet {
						if unit.Type == TANK || unit.Type == SIEGE_TANK {
							damage *= uint16(bullet.DamageMultiplier)
						} else if unit.Type == COMMANDER {
							// Keep legacy feeling: anti-tank should punish commanders heavily.
							damage *= 7
						}
					}

					isAlive = unit.TakeDamage(damage)
					if !isAlive { // Unit is destroyed
						unit.MarkForRemoval()
						handleUnitDestroyed(unit)
						break // Unit destroyed no need for more bullet checks for that unit
					} else {
						TriggerUnitHealthUpdateEvent(unit.Player, unit)
					}
				}
			}
		}
	}

	player.Base.RLock()
	bullets := make([]*Bullet, 0, len(player.Base.Bullets))
	for _, bullet := range player.Base.Bullets {
		bullets = append(bullets, bullet)
	}
	player.Base.RUnlock()
	for _, neutral := range neutrals {
		if hasCaptured(neutral, player.CapturedNeutralBases) {
			continue
		}
		neutral.Base.RLock()
		neutralBuildings := make([]*Building, 0, len(neutral.Base.Buildings))
		for _, neutralBuilding := range neutral.Base.Buildings {
			neutralBuildings = append(neutralBuildings, neutralBuilding)
		}
		neutral.Base.RUnlock()
		for _, building := range neutralBuildings {
			// Skip units that are marked for removal
			if building.IsMarkedForRemoval() {
				continue
			}

			for _, bullet := range bullets {
				// Skip bullets that are marked for removal
				if bullet.isMarkedForRemoval() {
					continue
				}

				if !bullet.IsFiredByUnit() {
					continue
				}

				if !bullet.IsWithinRadius(building.Position, float32(GetBuildingSize(building.Type))) {
					continue
				}

				if isBulletCollidingWithBuilding(bullet, building) {
					buildingHealth := building.Health.Current
					bulletHealth := bullet.Health.Current

					isAlive := bullet.TakeDamage(buildingHealth)
					if !isAlive { // Bullet is destroyed
						TriggerBulletRemoveEvent(player.Base.Owner, bullet.ID)
						bullet.MarkForRemoval()
						player.Base.RemoveBullet(bullet.ID)
					}

					isAlive = building.TakeDamage(bulletHealth)
					if !isAlive { // Unit is destroyed
						building.MarkForRemoval()
						handleBuildingDestroyed(building, neutral.Base)
						break // Building destroyed no need for more bullet checks for that building
					}
				}
			}
		}
	}
}

func checkBaseCollisions(player *Player, players []*Player, units []*Unit) {
	for _, otherPlayer := range players {
		// Skip  players marked for removal
		if otherPlayer.IsMarkedForRemoval() {
			continue
		}

		hasSpawnProtection := otherPlayer.HasProtection()
		basePosition := otherPlayer.Base.Position

			// Same player: spawn protection leave is controlled by explicit move command
			// (handled in network/handlers.go), not by passive unit position checks.
			if otherPlayer.ID == player.ID {
				continue
			}
		if !CanPlayersInteract(player, otherPlayer) {
			continue
		}
		if AreDuelOpponents(player, otherPlayer) {
			// Safety: if any stale spawn-protection flag remains on duelists,
			// clear it so the X1 pair can fight normally.
			if player.HasProtection() {
				player.RemoveProtection()
			}
			if otherPlayer.HasProtection() {
				otherPlayer.RemoveProtection()
			}
		}
		if hasSpawnProtection && AreDuelOpponents(player, otherPlayer) {
			hasSpawnProtection = false
		}

		// Lock the player to access buildings
		otherPlayer.Base.RLock()
		otherBuildings := make([]*Building, 0, len(otherPlayer.Base.Buildings))
		for _, building := range otherPlayer.Base.Buildings {
			otherBuildings = append(otherBuildings, building)
		}
		otherPlayer.Base.RUnlock()

		for _, unit := range units {
			if unit.IsMarkedForRemoval() {
				continue
			}

			unitSize := float32(unit.Size)

			isNearBase := unit.IsWithinRadius(IntToFloat(basePosition), (PLAYER_SPAWN_PROTECTION_RADIUS + unitSize))

			// Check if the unit entered enemy protection zone
			if hasSpawnProtection {
				if isNearBase {
					unit.MarkForRemoval()
					handleUnitDestroyed(unit)
					continue
				}
			}

			if !isNearBase {
				continue
			}

				// Check if unit is colliding with the core
				otherPlayerHealth := otherPlayer.Base.Health.Current
				isNearCore := unit.IsWithinRadius(IntToFloat(basePosition), getPlayerCoreRadius(otherPlayer.Base)+unitSize)
				if isNearCore {
					unitDamage := unit.Damage
					if unit.Type == COMMANDER {
						unitDamage *= COMMANDER_CORE_DAMAGE_MULTIPLIER
					}
					unitIsAlive := unit.TakeDamage(otherPlayerHealth)
					otherPlayerIsAlive := otherPlayer.Base.TakeDamage(unitDamage)
					if otherPlayerIsAlive && isPlayerBaseDefeated(otherPlayer.Base) {
						otherPlayerIsAlive = false
					}

				if !otherPlayerIsAlive {
					// Calculate the score and power increment
					scoreIncrement := (otherPlayer.Score / 100) * 50
					powerIncrement := math.Min((float64(otherPlayer.Score)/100)*10, 6000)

					// Apply the increments
					player.IncrementScore(scoreIncrement)
					player.IncrementKills(1)
					player.Resources.Power.Increment(uint16(powerIncrement))

					// Mark the other player for removal and trigger the kill event
					otherPlayer.MarkForRemoval()
					TriggerPlayerKilledEvent(otherPlayer, player)
				} else {
					// Update the health
					TriggerBaseHealthUpdateEvent(otherPlayer.Base)
				}

				if !unitIsAlive {
					unit.MarkForRemoval()
					handleUnitDestroyed(unit)
					continue
				} else {
					TriggerUnitHealthUpdateEvent(unit.Player, unit)
				}
			}

			// Check collision with buildings
			for _, building := range otherBuildings {
				if building.IsMarkedForRemoval() {
					continue
				}

				if isUnitCollidingWithBuilding(unit, building) {
					unitAlive, buildingAlive := handleUnitBuildingCollision(unit, building)
					if !buildingAlive {
						player.IncrementScore(uint32(building.Health.Max))
						building.MarkForRemoval()
						handleBuildingDestroyed(building, otherPlayer.Base)
					}

					if !unitAlive {
						unit.MarkForRemoval()
						handleUnitDestroyed(unit)
						break // Break out if the unit is destroyed
					}
				}
			}
		}
	}
}

func checkNeutralBaseCollisions(player *Player, neutrals []*NeutralBase, units []*Unit) {
	for _, neutral := range neutrals {
		basePosition := neutral.Base.Position

		if neutral.CapturedBy == player {
			continue
		}

		// Lock the neutral to access buildings
		neutral.Base.RLock()
		neutralBuildings := make([]*Building, 0, len(neutral.Base.Buildings))
		for _, building := range neutral.Base.Buildings {
			neutralBuildings = append(neutralBuildings, building)
		}
		neutral.Base.RUnlock()

		for _, unit := range units {
			if unit.IsMarkedForRemoval() {
				continue
			}

			unitSize := float32(unit.Size)

			isNearBase := unit.IsWithinRadius(IntToFloat(basePosition), (NEUTRAL_BASE_MAX_BUILDING_RADIUS + 100 + unitSize))
			if !isNearBase {
				continue
			}

				// Check if unit is colliding with the core
				neutralBaseHealth := neutral.Base.Health.Current
				isNearCore := unit.IsWithinRadius(IntToFloat(basePosition), (float32(neutralBaseHealth)/NEUTRAL_BASE_INITIAL_HEALTH)*NEUTRAL_BASE_MAX_CORE_RADIUS+unitSize)
				if isNearCore {
					unitDamage := unit.Damage
					if unit.Type == COMMANDER {
						unitDamage *= COMMANDER_CORE_DAMAGE_MULTIPLIER
					}
					unitIsAlive := unit.TakeDamage(neutralBaseHealth)
					neutralBaseIsAlive := neutral.Base.TakeDamage(unitDamage)

				if !neutralBaseIsAlive {
					handleNeutralBaseCaptured(player, neutral)
					break
				} else {
					// Update the health
					TriggerBaseHealthUpdateEvent(neutral.Base)
				}

				if !unitIsAlive {
					unit.MarkForRemoval()
					handleUnitDestroyed(unit)
					continue
				} else {
					TriggerUnitHealthUpdateEvent(unit.Player, unit)
				}
			}

			// Check collision with buildings
			for _, building := range neutralBuildings {
				if building.IsMarkedForRemoval() {
					continue
				}

				if isUnitCollidingWithBuilding(unit, building) {
					unitAlive, buildingAlive := handleUnitBuildingCollision(unit, building)
					if !buildingAlive {
						player.IncrementScore(uint32(building.Health.Max))
						building.MarkForRemoval()
						handleBuildingDestroyed(building, neutral.Base)
					}

					if !unitAlive {
						unit.MarkForRemoval()
						handleUnitDestroyed(unit)
						break // Break out if the unit is destroyed
					}
				}
			}
		}
	}
}

func applyExplosionDamage(unit *Unit) {
	//damage := unit.Health.Max
	damage := uint16(100)
	explosionRadius := float32(unit.ExplosionRadius)
	offset := float32(1.2)

	State.RLock()
	players := make([]*Player, 0, len(State.Players))
	for _, player := range State.Players {
		if !player.IsMarkedForRemoval() {
			players = append(players, player)
		}
	}
	neutrals := make([]*NeutralBase, 0, len(State.NeutralBases))
	for _, neutral := range State.NeutralBases {
		//f !neutral.IsMarkedForRemoval() {
		neutrals = append(neutrals, neutral)
		//}
	}
	State.RUnlock()

	for _, player := range players {
		if player.IsMarkedForRemoval() {
			continue
		}

		// Skip friendly damage
		if player.ID == unit.Player.ID {
			continue
		}
		if !CanPlayersInteract(unit.Player, player) {
			continue
		}

		// Lock the player to access units
		player.RLock()
		otherUnits := make([]*Unit, 0, len(player.Units))
		for _, unit := range player.Units {
			otherUnits = append(otherUnits, unit)
		}
		otherBuildings := make([]*Building, 0, len(player.Base.Buildings))
		for _, building := range player.Base.Buildings {
			otherBuildings = append(otherBuildings, building)
		}
		player.RUnlock()

		// Damage nearby units
		for _, otherUnit := range otherUnits {
			if otherUnit.IsMarkedForRemoval() {
				continue
			}
			if unit.IsWithinRadius(otherUnit.Position, explosionRadius*offset) {
				isAlive := otherUnit.TakeDamage(damage)
				if !isAlive {
					otherUnit.MarkForRemoval()
					unit.Player.IncrementScore(uint32(otherUnit.Health.Max) / 10)
					handleUnitDestroyed(otherUnit)
				} else {
					TriggerUnitHealthUpdateEvent(otherUnit.Player, otherUnit)
				}
			}
		}

		isNearBase := unit.IsWithinRadius(IntToFloat(player.Base.Position), float32(UNIT_DETECTION_RADIUS))

		// Damage nearby buildings
		if isNearBase {
			for _, otherBuilding := range otherBuildings {
				if otherBuilding.IsMarkedForRemoval() {
					continue
				}
				if unit.IsWithinRadius(otherBuilding.Position, explosionRadius*offset) {
					isAlive := otherBuilding.TakeDamage(damage)
					if !isAlive {
						otherBuilding.MarkForRemoval()
						unit.Player.IncrementScore(uint32(otherBuilding.Health.Max))
						handleBuildingDestroyed(otherBuilding, player.Base)
					}
				}
			}

			basePosition := player.Base.Position
			isNearCore := unit.IsWithinRadius(IntToFloat(basePosition), getPlayerCoreRadius(player.Base)+explosionRadius)
			if isNearCore {
				isAlive := player.Base.TakeDamage(damage)
				if isAlive && isPlayerBaseDefeated(player.Base) {
					isAlive = false
				}
				TriggerBaseHealthUpdateEvent(player.Base)
				if !isAlive {
					player.MarkForRemoval()
					unit.Player.IncrementScore((player.Score / 100) * 50)
					unit.Player.IncrementKills(1)

					// Calculate the score and power increment
					scoreIncrement := (player.Score / 100) * 50
					powerIncrement := math.Min((float64(player.Score)/100)*10, 6000)

					// Apply the increments
					unit.Player.IncrementScore(scoreIncrement)
					unit.Player.Resources.Power.Increment(uint16(powerIncrement))

					TriggerPlayerKilledEvent(player, unit.Player)
				}
			}
		}
	}
}

func checkUnitCollisions(player *Player, players []*Player, units []*Unit) {
	for _, otherPlayer := range players {
		// Skip self or players marked for removal
		if otherPlayer.ID == player.ID || otherPlayer.IsMarkedForRemoval() {
			continue
		}
		if !CanPlayersInteract(player, otherPlayer) {
			continue
		}
		// Lock the player to access units
		otherPlayer.RLock()
		otherUnits := make([]*Unit, 0, len(otherPlayer.Units))
		for _, otherPlayerUnit := range otherPlayer.Units {
			otherUnits = append(otherUnits, otherPlayerUnit)
		}
		otherPlayer.RUnlock()

		for _, unit := range units {
			if unit.IsMarkedForRemoval() {
				continue
			}
			for _, otherUnit := range otherUnits {
				if otherUnit.IsMarkedForRemoval() {
					continue
				}

				if isUnitCollidingWithUnit(unit, otherUnit) {
					unit1IsAlive, unit2IsAlive := handleUnitCollision(unit, otherUnit)
					if !unit2IsAlive {
						player.IncrementScore(uint32(otherUnit.Health.Max) / 10)
						otherUnit.MarkForRemoval()
						handleUnitDestroyed(otherUnit)
					}
					if !unit1IsAlive {
						otherPlayer.IncrementScore(uint32(unit.Health.Max) / 10)
						unit.MarkForRemoval()
						handleUnitDestroyed(unit)
						break // If own unit is destroyed break out
					}
				}
			}
		}
	}
}

func isBulletCollidingWithUnit(bullet *Bullet, unit *Unit) bool {

	bulletPos := bullet.Position
	unitPos := unit.Position

	if !bullet.IsWithinRadius(unitPos, float32(unit.Size+bullet.Size)) {
		return false
	}

	// Lock the bullet and unit to update polygons
	bullet.Polygon.SetCenter(bulletPos)
	bulletPolygon := bullet.Polygon

	unit.Polygon.SetCenter(unitPos)
	//! Rotation is already set on targetPosition update
	unitPolygon := unit.Polygon

	// Check if the bullet's polygon intersects with the unit's polygon
	return DoPolygonsIntersect(bulletPolygon, unitPolygon)
}

func isBulletCollidingWithRock(bullet *Bullet, rock *Rock) bool {
	if !bullet.IsWithinRadius(rock.Polygon.Center, float32(rock.Size)) {
		return false
	}

	bullet.Polygon.SetCenter(bullet.Position)
	bulletPolygon := bullet.Polygon

	// Check if the bullet's polygon intersects with the rock's polygon
	return DoPolygonsIntersect(bulletPolygon, rock.Polygon)
}

func isUnitCollidingWithRock(unit *Unit, rock *Rock) bool {
	if !unit.IsWithinRadius(rock.Polygon.Center, float32(rock.Size+unit.Size)) {
		return false
	}

	unit.Polygon.SetCenter(unit.Position)
	unitPolygon := unit.Polygon

	// Check if the rock's polygon intersects with the unit's polygon
	return DoPolygonsIntersect(unitPolygon, rock.Polygon)
}

func isBulletCollidingWithBuilding(bullet *Bullet, building *Building) bool {

	if !bullet.IsWithinRadius(building.Position, float32(GetBuildingSize(building.Type)+bullet.Size)) {
		return false
	}

	bullet.Polygon.SetCenter(bullet.Position)
	bulletPolygon := bullet.Polygon

	buildingPolygon := building.Polygon

	// Check if the bullet's polygon intersects with the unit's polygon
	return DoPolygonsIntersect(bulletPolygon, buildingPolygon)
}

func isUnitCollidingWithBuilding(unit *Unit, building *Building) bool {
	if !unit.IsWithinRadius(building.Position, float32(GetBuildingSize(building.Type)+unit.Size)) {
		return false
	}

	unit.Polygon.SetCenter(unit.Position)
	//! Rotation is already set on targetPosition update
	unitPolygon := unit.Polygon

	buildingPolygon := building.Polygon

	return DoPolygonsIntersect(unitPolygon, buildingPolygon)
}

func isUnitCollidingWithUnit(unit1, unit2 *Unit) bool {

	if !unit1.IsWithinRadius(unit2.Position, float32(unit1.Size+unit2.Size)) {
		return false
	}

	unit1.Polygon.SetCenter(unit1.Position)
	//! Rotation is already set on targetPosition update
	unit1Polygon := unit1.Polygon

	unit2.Polygon.SetCenter(unit2.Position)
	//! Rotation is already set on targetPosition update
	unit2Polygon := unit2.Polygon

	// Check if the polygons intersect
	return DoPolygonsIntersect(unit1Polygon, unit2Polygon)
}

func handleNeutralBaseCaptured(player *Player, neutral *NeutralBase) {
	if neutral.CapturedBy != nil {
		neutral.CapturedBy.RemoveCapturedNeutralBase(neutral)
	}
	neutral.Captured(player)
	player.AddCapturedNeutralBase(neutral)
	TriggerNeutralBaseCaptured(neutral)
}

func handleUnitBuildingCollision(unit *Unit, building *Building) (bool, bool) {
	unitDamage := unit.Damage
	buildingDamage, ok := GetBuildingContactDamage(building.Type, building.Variant)
	if !ok {
		buildingDamage = building.Health.Current
	}

	isUnitAlive := unit.TakeDamage(buildingDamage)
	if isUnitAlive {
		TriggerUnitHealthUpdateEvent(unit.Player, unit)
	}
	isBuildingAlive := building.TakeDamage(unitDamage)

	return isUnitAlive, isBuildingAlive
}

func handleUnitCollision(unit1, unit2 *Unit) (bool, bool) {
	// Capture the IDs before potential swapping
	originalUnit1 := unit1.ID
	originalUnit2 := unit2.ID

	// Ensure consistent locking order
	if unit1.ID > unit2.ID {
		unit1, unit2 = unit2, unit1
	}

	unit1Damage := unit1.Damage
	unit2Damage := unit2.Damage

	// Apply damage
	isAliveUnit1 := unit1.TakeDamage(unit2Damage)
	if isAliveUnit1 {
		TriggerUnitHealthUpdateEvent(unit1.Player, unit1)
	}
	isAliveUnit2 := unit2.TakeDamage(unit1Damage)
	if isAliveUnit2 {
		TriggerUnitHealthUpdateEvent(unit2.Player, unit2)
	}

	// Return the alive status in the original order
	if originalUnit1 > originalUnit2 {
		// If the original unit1 was swapped with unit2, return the result for the swapped unit1
		return isAliveUnit2, isAliveUnit1
	}
	return isAliveUnit1, isAliveUnit2
}

func handleUnitDestroyed(unit *Unit) {
	// ! Quick dirty implementation
	if unit.Type == TANK && unit.Variant == CANNON_TANK || unit.Type == SIEGE_TANK && unit.Variant == CANNON_SIEGE_TANK {
		unit.Player.RemoveUnitBulletSpawning(unit)
	}

	unitID := unit.ID
	ok := unit.Player.RemoveUnit(unit.ID)
	if ok {
		requiredPopulation, ok := GetUnitRequiredPopulation(unit.Type)
		if !ok {
			log.Println("Could not find the required population for unit (handleUnitDestroyed)")
			return
		}
		unit.Player.Population.DecrementUsed(requiredPopulation)
		TriggerUnitRemoveEvent(unit.Player, unitID)
	} else {
		//! Is already removed
	}
}

func handleBuildingDestroyed(building *Building, base *Base) {
	ok := base.RemoveBuilding(building.ID)
	if ok {
		TriggerBuildingRemovedEvent(base, building)
	}
}

func AddPlayer(conn *websocket.Conn, permission Permission, name []byte, color []byte, skinID ID) (*Player, bool) {
	State.Lock()
	defer State.Unlock()

	for _, player := range State.Players {
		if player.Conn == conn {
			log.Println("Connection has already added a player")
			return nil, false
		}
	}

	initialPower := uint16(PLAYER_INITIAL_POWER)
	maxPower := uint16(PLAYER_MAX_POWER)
	if permission == PERMISSION_ADMIN {
		// ! OP power for me :)
		initialPower = uint16(6000)
		maxPower = uint16(60000)
	}

	player := &Player{
		Conn:              conn,
		Permission:        permission,
		Name:              [12]byte{},
		SkinID:            skinID,
		StartTime:         time.Now(),
		Kills:             0,
		Camera:            NewCamera(),
		Units:             make(map[ID]*Unit),
		AvailableUnitIDs:  InitAvailableIDs(128),
		Population:        Population{Capacity: PLAYER_INITIAL_POPULATION, Used: 0},
		UnitSpawningLimit: Capacity{Current: 0, Max: 4},
		Resources: Resources{
			Power: Resource{
				Current:  initialPower,
				Capacity: maxPower,
			},
		},
		Generating: Generating{
			Power: 1, // 1 per sec
		},
		HasSpawnProtection:      true,
		HasCommander:            false,
		SpawnProtectionEndTime:  time.Time{},
		LastActivity:            time.Now(),
		LastActivityWarningSent: time.Now(),
		RemoveFlag:              false,
		SuspiciousCounter:       0.0, // Initial suspicious counter is 0
		SuspicionDecayRate:      1.0, // Decay rate per update, adjust as needed
		SuspicionThreshold:      5.0, // Threshold where suspicion triggers action
	}

	player.Base = &Base{
		Owner:     player, // Reference back to the player
		Color:     color,
		Health:    Health{Current: PLAYER_INITIAL_HEALTH, Max: PLAYER_INITIAL_HEALTH},
		Buildings: make(map[ID]*Building),
		Bullets:   make(map[ID]*Bullet),
		BuildingLimits: map[BuildingType]BuildingLimit{
			WALL:          {0, 9999},
			SIMPLE_TURRET: {0, 9999},
			SNIPER_TURRET: {0, 9999},
			ARMORY:        {0, 1},
			BARRACKS:      {0, 4},
			PORTAL:        {0, 2},
			GENERATOR:     {0, 9999},
			HOUSE:         {0, 9999}},
		AvailableBuildingIDs: InitAvailableIDs(256),
		AvailableBulletIDs:   InitAvailableIDs(256),
	}

	// Truncate the player name if it's longer than 12 bytes
	if len(name) > 12 {
		log.Println("Player name exceeds maximum length and will be truncated")
		name = name[:12] // Truncate name to 12 bytes
	}

	copy(player.Name[:], name)

	player.Base.Position = FindFreePosition()
	player.Camera.Position = player.Base.Position
	player.Camera.UpdateBounds()

	// Clear objects around spawn position
	clearSpawnArea(player.Base.Position, PLAYER_SPAWN_CLEAR_RADIUS)

	playerID, ok := availablePlayerIDs.getNextAvailableID()
	if !ok {
		log.Println("No available player IDs")
		return nil, false
	}

	player.ID = playerID
	State.Players[player.ID] = player
	AddDynamicBushesForPlayerCount(len(State.Players))

	return player, true
}

func RemovePlayer(conn *websocket.Conn) (ID, uint32, uint32, time.Duration, bool) {
	State.Lock()
	defer State.Unlock()

	var playerID ID
	var player *Player

	if conn == nil {
		return 0, 0, 0, 0, false // Player not found
	}

	// Find the player associated with the connection
	for id, p := range State.Players {
		if p.Conn == conn {
			playerID = id
			player = p
			break
		}
	}

	if player == nil {
		return 0, 0, 0, 0, false // Player not found
	}

	player.MarkForRemoval() // ! Just to be sure
	if player.InDuel {
		opponent := State.Players[player.DuelOpponentID]
		if opponent != nil && opponent.DuelOpponentID == player.ID {
			opponent.InDuel = false
			opponent.DuelOpponentID = 0
			opponent.DuelArena = DuelArena{}
			opponent.DuelPrepEndsAt = time.Time{}
		}
		player.InDuel = false
		player.DuelOpponentID = 0
		player.DuelArena = DuelArena{}
		player.DuelPrepEndsAt = time.Time{}
	}

	playerBasePosition := player.Base.Position
	MarkPositionAvailable(playerBasePosition)

	// Lock the player and player base
	player.Lock()
	playerScore := player.Score
	playtime := player.GetPlayDuration()
	kills := player.GetKills()

	// Clean up player resources
	// Remove units
	for unitID := range player.Units {
		delete(player.Units, unitID) // Remove unit from map
	}
	player.Unlock()

	player.Base.Lock()
	// Remove buildings
	for buildingID := range player.Base.Buildings {
		delete(player.Base.Buildings, buildingID) // Remove building from map
	}
	// Remove bullets
	for bulletID := range player.Base.Bullets {
		delete(player.Base.Bullets, bulletID) // Remove bullet from map
	}
	player.Base.Unlock()

	for _, base := range player.CapturedNeutralBases {
		base.Captured(nil)
	}

	// Return player ID to available pool
	availablePlayerIDs.returnID(playerID)

	// Remove player from the State.Players map
	delete(State.Players, playerID)
	log.Printf("Player %d removed successfully", playerID)

	return playerID, playerScore, kills, playtime, true // Player successfully removed
}

// RelocatePlayerBaseTo moves a player's base to a selected free slot (or first free slot when target is nil).
func RelocatePlayerBaseTo(player *Player, target *PositionInt) bool {
	if player == nil {
		return false
	}

	State.Lock()
	defer State.Unlock()

	var (
		newPos PositionInt
		ok     bool
	)

	if target != nil {
		if !IsRelocationSlotAvailable(*target, player.ID) {
			return false
		}
		newPos = *target
		ok = true
	} else {
		newPos, ok = FindFreeRelocationPosition(player.ID)
		if !ok {
			return false
		}
	}

	oldPos := player.Base.Position
	if oldPos == newPos {
		return false
	}

	dx := float32(newPos.X - oldPos.X)
	dy := float32(newPos.Y - oldPos.Y)

	player.Base.Lock()
	player.Base.Position = newPos

	for _, building := range player.Base.Buildings {
		building.Position.X += dx
		building.Position.Y += dy
		building.Polygon.SetCenter(building.Position)
	}

	for _, bullet := range player.Base.Bullets {
		bullet.Position.X += dx
		bullet.Position.Y += dy
		bullet.TargetPosition.X += dx
		bullet.TargetPosition.Y += dy
		bullet.Polygon.SetCenter(bullet.Position)
	}
	player.Base.Unlock()

	player.Lock()
	for _, unit := range player.Units {
		unit.Position.X += dx
		unit.Position.Y += dy
		unit.TargetPosition.X += dx
		unit.TargetPosition.Y += dy
		unit.Polygon.SetCenter(unit.Position)
	}
	player.Camera.Position = newPos
	player.Camera.UpdateBounds()
	player.Unlock()

	MarkPositionAvailable(oldPos)
	clearSpawnArea(newPos, PLAYER_SPAWN_CLEAR_RADIUS)

	// If player is currently in duel, rebuild arena bounds to include new base position.
	if player.InDuel {
		opponent := State.Players[player.DuelOpponentID]
		if opponent != nil {
			arena := buildDuelArena(player, opponent)
			player.DuelArena = arena
			opponent.DuelArena = arena
		}
	}

	return true
}

// RelocatePlayerBase keeps compatibility and relocates to the first available slot.
func RelocatePlayerBase(player *Player) bool {
	return RelocatePlayerBaseTo(player, nil)
}

func GetPlayerByConn(conn *websocket.Conn) (*Player, bool) {
	State.RLock()
	defer State.RUnlock()
	for _, player := range State.Players {
		if player.Conn == conn {
			return player, true
		}
	}

	return nil, false
}
