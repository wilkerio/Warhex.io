package game

import "math"

// Exact traditional sockets requested by user (same order/values as menu ExternaTK preset).
var x1TraditionalExactSocketLayout = []legacySocketEntry{
	{-1.06, 310, 8}, {-2.08, 310, 8}, {-0.64, 310, 8}, {-2.5, 310, 8},
	{-1.67, 306, 1}, {-1.47, 306, 1}, {-1.87, 306, 1}, {-1.27, 306, 1}, {-2.29, 306, 1}, {-0.85, 306, 1},
	{-2.71, 306, 1}, {-0.43, 306, 1}, {-2.91, 306, 1}, {-0.23, 306, 1}, {-3.11, 306, 1}, {-0.03, 306, 1},
	{2.97, 306, 1}, {0.17, 306, 1}, {2.77, 306, 1}, {0.37, 306, 1}, {2.57, 306, 1}, {0.57, 306, 1},
	{2.37, 306, 1}, {0.77, 306, 1}, {2.17, 306, 1}, {0.97, 306, 1}, {1.97, 306, 1}, {1.17, 306, 1},
	{1.77, 306, 1}, {1.37, 306, 1}, {1.5707963267948966, 306, 1},
	{-1.7, 245.85, 4}, {-1.44, 245.85, 4}, {-1.95, 245.85, 4}, {-1.19, 245.85, 4}, {-2.2, 245.85, 4}, {-0.94, 245.85, 4},
	{-2.45, 245.85, 4}, {-0.69, 245.85, 4}, {-2.7, 245.85, 4}, {-0.44, 245.85, 4}, {-2.95, 245.85, 4}, {-0.19, 245.85, 4},
	{3.08, 245.85, 4}, {-6.22, 245.85, 4}, {2.83, 245.85, 4}, {-5.97, 245.85, 4}, {2.58, 245.85, 4}, {-5.72, 245.85, 4},
	{2.33, 245.85, 4}, {-5.47, 245.85, 4}, {2.08, 245.85, 4}, {-5.22, 245.85, 4}, {1.83, 245.85, 4}, {-4.97, 245.85, 4},
	{1.5707963267948966, 245.85, 4},
	{-1.92, 186, 4}, {-1.22, 186, 4}, {-2.25, 186, 4}, {-0.89, 186, 4}, {-2.57, 190.5, 4}, {-0.57, 190.5, 4},
	{-2.89, 186, 4}, {-0.25, 186, 4}, {3.05, 186, 4}, {-6.19, 186, 4}, {2.72, 190.5, 4}, {-5.86, 190.5, 4},
	{2.4, 187.5, 4}, {-5.54, 187.5, 4}, {2.07, 185.5, 4}, {-5.21, 185.5, 4}, {1.74, 189, 4}, {-4.88, 189, 4},
	{4.71238898038469, 140, 7},
	{-2.1, 130, 4}, {-1.04, 130, 4}, {-2.57, 130, 4}, {-0.57, 130, 4}, {-3.04, 130, 4}, {-0.1, 130, 4},
	{2.77, 130, 4}, {-5.91, 130, 4}, {2.28, 130, 4}, {-5.42, 130, 4}, {1.81, 130, 4}, {-4.95, 130, 4},
}

func ApplyTraditionalX1Setup(players ...*Player) {
	for _, player := range players {
		applyTraditionalX1SetupForPlayer(player)
	}
}

func applyTraditionalX1SetupForPlayer(player *Player) {
	if player == nil || player.Base == nil || player.IsMarkedForRemoval() {
		return
	}

	clearX1PlayerBullets(player)
	clearX1PlayerUnits(player)
	clearX1PlayerBuildings(player)

	applyLegacyExternaLayout(player)
	upgradePlayerBuildingsToVariant(player, WALL, MICRO_GENERATOR)
	ensureBarracksVariantWithRetry(player, GREATER_BARRACKS)
	ensureTraditionalBarracksActivation(player)
	upgradePlayerBuildingsToVariant(player, ARMORY, BuildingVariant(1))
	spawnTraditionalOpeningSoldiers(player)
	player.Base.Health.Reset()
	TriggerBaseHealthUpdateEvent(player.Base)
	fillPlayerPowerTo(player, PLAYER_MAX_POWER)
}

func spawnTraditionalOpeningSoldiers(player *Player) {
	if player == nil || player.IsMarkedForRemoval() {
		return
	}

	requiredPopulation, ok := GetUnitRequiredPopulation(SOLDIER)
	if !ok || requiredPopulation == 0 {
		return
	}

	barracks := collectPlayerBuildingsByType(player, BARRACKS)
	if len(barracks) == 0 {
		return
	}

	for {
		if !hasTraditionalUnitIDBudget(player) {
			return
		}

		spawnedAny := false
		for _, building := range barracks {
			if building == nil || building.IsMarkedForRemoval() {
				continue
			}
			if !hasTraditionalUnitIDBudget(player) {
				return
			}

			spawning := player.GetUnitSpawningForBarrack(building)
			if spawning == nil || !spawning.Activated || spawning.UnitType != SOLDIER {
				continue
			}
			if !player.Population.IncrementUsed(requiredPopulation) {
				return
			}

			unit, spawned := player.AddUnit(spawning.UnitType, spawning.UnitVariant, building)
			if !spawned || unit == nil {
				player.Population.DecrementUsed(requiredPopulation)
				continue
			}

			player.AddUnitBulletSpawning(unit)
			TriggerUnitSpawnEvent(unit, building)
			spawnedAny = true
		}

		if !spawnedAny {
			return
		}
	}
}

func hasTraditionalUnitIDBudget(player *Player) bool {
	if player == nil || player.AvailableUnitIDs == nil {
		return false
	}

	// Keep one slot reserved so commander spawn for X1 round setup never fails.
	player.AvailableUnitIDs.Lock()
	defer player.AvailableUnitIDs.Unlock()
	return len(player.AvailableUnitIDs.IDs) > 1
}

func applyLegacyExternaLayout(player *Player) {
	if player == nil || player.Base == nil || player.IsMarkedForRemoval() {
		return
	}

	// Use exact requested ExternaTK layout from socket preset.
	slots := convertLegacySocketLayout(x1TraditionalExactSocketLayout, 0, 1.0)
	if len(slots) == 0 {
		return
	}

	basePos := IntToFloat(player.Base.GetPosition())
	for _, slot := range slots {
		if player.IsMarkedForRemoval() {
			return
		}
		candidates := getExternalATKFallbackPositions(basePos, slot.Angle, slot.Radius)
		placed := false
		for _, candidate := range candidates {
			sizePadding := float32(GetBuildingSize(slot.BuildingType) + 24)
			candidate = ClampPositionFloatToMap(candidate, sizePadding)

			rotationStep := uint8(0)
			if !player.Base.CheckBuildingCollision(slot.BuildingType, candidate, rotationStep) {
				continue
			}
			if placeBotBuildingAtPosition(player, slot.BuildingType, candidate, rotationStep, 0) {
				placed = true
				break
			}
		}
		if !placed {
			continue
		}
	}
}

func getExternalATKFallbackPositions(basePos PositionFloat, baseAngle float64, baseRadius float32) []PositionFloat {
	angleOffsets := []float64{0, -0.018, 0.018, -0.035, 0.035}
	radiusOffsets := []float32{0, -2, 2, -4, 4}

	out := make([]PositionFloat, 0, len(angleOffsets)*len(radiusOffsets))
	seen := make(map[[2]int]struct{}, len(angleOffsets)*len(radiusOffsets))
	for _, angleOffset := range angleOffsets {
		for _, radiusOffset := range radiusOffsets {
			r := baseRadius + radiusOffset
			if r < 0 {
				r = 0
			}
			a := baseAngle + angleOffset
			p := PositionFloat{
				X: basePos.X + r*float32(math.Cos(a)),
				Y: basePos.Y + r*float32(math.Sin(a)),
			}
			key := [2]int{
				int(math.Round(float64(p.X * 10))),
				int(math.Round(float64(p.Y * 10))),
			}
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, p)
		}
	}
	return out
}

func upgradePlayerBuildingsToVariant(player *Player, buildingType BuildingType, targetVariant BuildingVariant) {
	if player == nil || player.Base == nil {
		return
	}

	buildings := collectPlayerBuildingsByType(player, buildingType)
	if len(buildings) == 0 {
		return
	}

	upgradedIDs := make([]ID, 0, len(buildings))
	for _, building := range buildings {
		if building == nil {
			continue
		}
		if building.Variant == targetVariant {
			continue
		}
		if !ValidateUpgradePath(building.Type, building.Variant, targetVariant) {
			continue
		}
		if forceUpgradeBuildingVariant(player, building, targetVariant) {
			upgradedIDs = append(upgradedIDs, building.ID)
		}
	}

	if len(upgradedIDs) > 0 {
		TriggerBuildingsUpgradedEvent(player.Base, upgradedIDs)
	}
}

func ensureBarracksVariantWithRetry(player *Player, targetVariant BuildingVariant) {
	if player == nil || player.Base == nil {
		return
	}

	for attempt := 0; attempt < 2; attempt++ {
		upgradePlayerBuildingsToVariant(player, BARRACKS, targetVariant)
		if allBarracksOnVariant(player, targetVariant) {
			return
		}
	}

	// Hard fallback: try direct force-upgrade on every remaining barracks.
	barracks := collectPlayerBuildingsByType(player, BARRACKS)
	if len(barracks) == 0 {
		return
	}
	upgradedIDs := make([]ID, 0, len(barracks))
	for _, building := range barracks {
		if building == nil {
			continue
		}
		if building.Variant == targetVariant {
			continue
		}
		if forceUpgradeBuildingVariant(player, building, targetVariant) {
			upgradedIDs = append(upgradedIDs, building.ID)
		}
	}
	if len(upgradedIDs) > 0 {
		TriggerBuildingsUpgradedEvent(player.Base, upgradedIDs)
	}

	// Second verification pass requested by user for reliability.
	if !allBarracksOnVariant(player, targetVariant) {
		upgradePlayerBuildingsToVariant(player, BARRACKS, targetVariant)
	}
}

func allBarracksOnVariant(player *Player, targetVariant BuildingVariant) bool {
	barracks := collectPlayerBuildingsByType(player, BARRACKS)
	if len(barracks) == 0 {
		return false
	}
	for _, building := range barracks {
		if building == nil {
			return false
		}
		if building.Variant != targetVariant {
			return false
		}
	}
	return true
}

func ensureTraditionalBarracksActivation(player *Player) {
	barracks := collectPlayerBuildingsByType(player, BARRACKS)
	for _, building := range barracks {
		ensureX1BarracksSpawningState(player, building, true)
	}
}

func collectPlayerBuildingsByType(player *Player, buildingType BuildingType) []*Building {
	if player == nil || player.Base == nil {
		return nil
	}

	player.Base.RLock()
	defer player.Base.RUnlock()

	out := make([]*Building, 0, len(player.Base.Buildings))
	for _, building := range player.Base.Buildings {
		if building == nil || building.IsMarkedForRemoval() {
			continue
		}
		if building.Type != buildingType {
			continue
		}
		out = append(out, building)
	}
	return out
}

func forceUpgradeBuildingVariant(player *Player, building *Building, targetVariant BuildingVariant) bool {
	if player == nil || player.Base == nil || building == nil {
		return false
	}
	if building.Variant == targetVariant {
		return true
	}

	buildingType := building.Type
	currentVariant := building.Variant

	if generating, ok := GetResourceGeneration(buildingType, currentVariant); ok {
		decreasePlayerGeneratingPower(player, generating.Power)
	}
	if generating, ok := GetResourceGeneration(buildingType, targetVariant); ok {
		increasePlayerGeneratingPower(player, generating.Power)
	}

	if capacity, ok := GetPopulationCapacity(buildingType, currentVariant); ok {
		player.Population.DecrementCapacity(capacity)
	}
	if capacity, ok := GetPopulationCapacity(buildingType, targetVariant); ok {
		player.Population.IncrementCapacity(capacity)
	}

	wasUnitSpawningActive := true
	switch buildingType {
	case BARRACKS:
		unitSpawning := player.GetUnitSpawningForBarrack(building)
		if unitSpawning != nil {
			wasUnitSpawningActive = unitSpawning.Activated
		}
		player.RemoveUnitSpawning(building)
	case SIMPLE_TURRET, SNIPER_TURRET:
		player.Base.RemoveBulletSpawning(building)
	}

	if !player.Base.UpgradeBuilding(building.ID, targetVariant) {
		return false
	}

	switch buildingType {
	case BARRACKS:
		player.AddUnitSpawning(building, wasUnitSpawningActive)
	case SIMPLE_TURRET, SNIPER_TURRET:
		player.Base.AddBulletSpawning(building)
	case ARMORY:
		applyTraditionalArmoryUpgradeEffects(player, targetVariant)
	}

	return true
}

func applyTraditionalArmoryUpgradeEffects(player *Player, buildingVariant BuildingVariant) {
	if player == nil {
		return
	}
	if buildingVariant == BuildingVariant(1) {
		player.ApplySoldierArmorUpgrade(true)
	}
	if buildingVariant == BuildingVariant(2) ||
		buildingVariant == BuildingVariant(4) ||
		buildingVariant == BuildingVariant(6) ||
		buildingVariant == BuildingVariant(8) {
		player.ApplyTankBoosterUpgrade(true)
	}
	if buildingVariant == BuildingVariant(3) ||
		buildingVariant == BuildingVariant(4) ||
		buildingVariant == BuildingVariant(7) ||
		buildingVariant == BuildingVariant(8) {
		player.ApplyTankCannonUpgrade(true)
	}
	if buildingVariant == BuildingVariant(5) ||
		buildingVariant == BuildingVariant(6) ||
		buildingVariant == BuildingVariant(7) ||
		buildingVariant == BuildingVariant(8) {
		player.ApplyTankCloakUpgrade(true)
	}
}

func decreasePlayerGeneratingPower(player *Player, amount uint16) {
	if player == nil || amount == 0 {
		return
	}
	player.Lock()
	if player.Generating.Power > amount {
		player.Generating.Power -= amount
	} else {
		player.Generating.Power = 0
	}
	player.Unlock()
}

func increasePlayerGeneratingPower(player *Player, amount uint16) {
	if player == nil || amount == 0 {
		return
	}
	player.Lock()
	player.Generating.Power += amount
	player.Unlock()
}

func fillPlayerPowerTo(player *Player, target uint16) {
	if player == nil {
		return
	}
	player.Resources.Power.Lock()
	if target > player.Resources.Power.Capacity {
		player.Resources.Power.Current = player.Resources.Power.Capacity
	} else {
		player.Resources.Power.Current = target
	}
	player.Resources.Power.Unlock()
}
