package game

import "sort"

type X1BuildingSnapshot struct {
	Type           BuildingType
	Variant        BuildingVariant
	RotationStep   uint8
	Position       PositionFloat
	BarracksActive bool
	// Tracks whether barracks activation state was explicitly captured.
	// When false, restore should fallback to active to avoid false "disabled" barracks.
	BarracksActiveCaptured bool
}

type X1PlayerSnapshot struct {
	Buildings []X1BuildingSnapshot
}

func RefillX1Power(players ...*Player) {
	for _, player := range players {
		if player == nil || player.IsMarkedForRemoval() {
			continue
		}
		fillPlayerPowerTo(player, PLAYER_MAX_POWER)
	}
}

func CaptureX1PlayerSnapshot(player *Player) X1PlayerSnapshot {
	if player == nil || player.Base == nil {
		return X1PlayerSnapshot{}
	}

	type captured struct {
		id       ID
		snapshot X1BuildingSnapshot
	}

	player.Base.RLock()
	capturedBuildings := make([]captured, 0, len(player.Base.Buildings))
	for id, building := range player.Base.Buildings {
		if building == nil || building.IsMarkedForRemoval() {
			continue
		}
		capturedBuildings = append(capturedBuildings, captured{
			id: id,
			snapshot: X1BuildingSnapshot{
				Type:         building.Type,
				Variant:      building.Variant,
				RotationStep: building.PlacementRotationStep,
				Position:     building.Position,
			},
		})
	}
	player.Base.RUnlock()

	sort.Slice(capturedBuildings, func(i, j int) bool {
		return capturedBuildings[i].id < capturedBuildings[j].id
	})

	barracksActivation := make(map[ID]bool, len(capturedBuildings))
	player.RLock()
	for _, spawning := range player.UnitSpawning {
		if spawning == nil || spawning.Barracks == nil {
			continue
		}
		barracksActivation[spawning.Barracks.ID] = spawning.Activated
	}
	player.RUnlock()

	out := X1PlayerSnapshot{
		Buildings: make([]X1BuildingSnapshot, 0, len(capturedBuildings)),
	}
	for _, building := range capturedBuildings {
		snapshot := building.snapshot
		if snapshot.Type == BARRACKS {
			if active, exists := barracksActivation[building.id]; exists {
				snapshot.BarracksActive = active
				snapshot.BarracksActiveCaptured = true
			} else {
				snapshot.BarracksActive = true
				snapshot.BarracksActiveCaptured = false
			}
		}
		out.Buildings = append(out.Buildings, snapshot)
	}
	return out
}

func RestoreX1PlayerSnapshot(player *Player, snapshot X1PlayerSnapshot) {
	if player == nil || player.Base == nil || player.IsMarkedForRemoval() {
		return
	}

	clearX1PlayerBullets(player)
	clearX1PlayerUnits(player)
	clearX1PlayerBuildings(player)

	for _, entry := range snapshot.Buildings {
		sizePadding := float32(GetBuildingSize(entry.Type) + 24)
		position := ClampPositionFloatToMap(entry.Position, sizePadding)
		building, ok := placeX1SnapshotBuilding(player, entry.Type, position, entry.RotationStep)
		if !ok || building == nil {
			continue
		}

		if entry.Variant != BASIC_BUILDING {
			forceUpgradeBuildingVariant(player, building, entry.Variant)
		}

		if entry.Type == BARRACKS {
			desiredActive := true
			if entry.BarracksActiveCaptured {
				desiredActive = entry.BarracksActive
			}
			ensureX1BarracksSpawningState(player, building, desiredActive)
		}
	}

	player.Base.Health.Reset()
	TriggerBaseHealthUpdateEvent(player.Base)
	fillPlayerPowerTo(player, PLAYER_MAX_POWER)
}

func clearX1PlayerBullets(player *Player) {
	if player == nil || player.Base == nil {
		return
	}

	player.Base.RLock()
	bulletIDs := make([]ID, 0, len(player.Base.Bullets))
	for id := range player.Base.Bullets {
		bulletIDs = append(bulletIDs, id)
	}
	player.Base.RUnlock()

	for _, bulletID := range bulletIDs {
		if player.Base.RemoveBullet(bulletID) {
			TriggerBulletRemoveEvent(player, bulletID)
		}
	}
}

func clearX1PlayerUnits(player *Player) {
	if player == nil {
		return
	}

	player.RLock()
	units := make([]*Unit, 0, len(player.Units))
	for _, unit := range player.Units {
		if unit == nil || unit.IsMarkedForRemoval() {
			continue
		}
		units = append(units, unit)
	}
	player.RUnlock()

	for _, unit := range units {
		player.RemoveUnitBulletSpawning(unit)
		if player.RemoveUnit(unit.ID) {
			if requiredPopulation, ok := GetUnitRequiredPopulation(unit.Type); ok {
				player.Population.DecrementUsed(requiredPopulation)
			}
			TriggerUnitRemoveEvent(player, unit.ID)
		}
	}

	player.Population.Lock()
	player.Population.Used = 0
	player.Population.Unlock()
}

func clearX1PlayerBuildings(player *Player) {
	if player == nil || player.Base == nil {
		return
	}

	player.Base.RLock()
	buildings := make([]*Building, 0, len(player.Base.Buildings))
	for _, building := range player.Base.Buildings {
		if building == nil || building.IsMarkedForRemoval() {
			continue
		}
		buildings = append(buildings, building)
	}
	player.Base.RUnlock()

	sort.Slice(buildings, func(i, j int) bool {
		return buildings[i].ID < buildings[j].ID
	})

	for _, building := range buildings {
		if player.Base.RemoveBuilding(building.ID) {
			TriggerBuildingRemovedEvent(player.Base, building)
		}
	}

	player.UnitSpawningLimit.Lock()
	player.UnitSpawningLimit.Current = 0
	player.UnitSpawningLimit.Unlock()
}

func placeX1SnapshotBuilding(player *Player, buildingType BuildingType, pos PositionFloat, rotationStep uint8) (*Building, bool) {
	if player == nil || player.Base == nil {
		return nil, false
	}

	building, placed := player.Base.AddBuilding(buildingType, pos, rotationStep)
	if !placed || building == nil {
		return nil, false
	}

	if generating, ok := GetResourceGeneration(buildingType, BASIC_BUILDING); ok {
		increasePlayerGeneratingPower(player, generating.Power)
	}
	if capacity, ok := GetPopulationCapacity(buildingType, BASIC_BUILDING); ok {
		player.Population.IncrementCapacity(capacity)
	}

	TriggerBuildingPlacedEvent(player.Base, building)
	return building, true
}

func ensureX1BarracksSpawningState(player *Player, barracks *Building, desiredActive bool) {
	if player == nil || barracks == nil || barracks.Type != BARRACKS {
		return
	}

	unitSpawning := player.GetUnitSpawningForBarrack(barracks)
	if unitSpawning == nil {
		player.AddUnitSpawning(barracks, desiredActive)
		unitSpawning = player.GetUnitSpawningForBarrack(barracks)
	}
	if unitSpawning == nil || unitSpawning.Activated == desiredActive {
		return
	}

	player.ToggleUnitSpawning(barracks)
}
