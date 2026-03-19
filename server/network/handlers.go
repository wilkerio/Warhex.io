package network

import (
	"encoding/binary"
	"log"
	"math"
	"math/rand/v2"
	"os"
	"server/game"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gorilla/websocket"
)

var PORT = os.Getenv("PORT")
var DISABLE_MULTIBOX_CHECK = false // Enforce multibox check by default (admins are still exempt).

const (
	joinSecurityFlagUnauthorizedExt byte = 0x80
	joinSecurityColorMask           byte = 0x7F
	maxChatMessageBytes             int  = 180
	maxChatMessageRunes             int  = 120
	maxBulkBuildingActions          int  = 40
)

var (
	enforceClientExtensionBlock    = envBoolDefaultTrue("ENFORCE_CLIENT_EXTENSION_BLOCK")
	enforceClientSecurityAlertKick = envBoolDefaultTrue("ENFORCE_CLIENT_SECURITY_ALERT_KICK")
)

func envBoolDefaultTrue(key string) bool {
	raw := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if raw == "" {
		return true
	}
	switch raw {
	case "0", "false", "off", "no":
		return false
	default:
		return true
	}
}

func hasActiveUnits(player *game.Player) bool {
	if player == nil {
		return false
	}

	player.RLock()
	defer player.RUnlock()

	for _, unit := range player.Units {
		if unit != nil && !unit.IsMarkedForRemoval() && unit.Health.Get() > 0 {
			return true
		}
	}

	return false
}

func handleMessage(conn *websocket.Conn, message []byte) {
	if len(message) < 1 {
		log.Println("Received empty binary message")
		return
	}

	if conn == nil {
		log.Println("WebSocket connection is nil")
		return
	}

	messageType := message[0]
	payload := message[1:]

	switch messageType {
	case MessageTypeHeartbeat:
		break
	case MessageTypeJoin:
		handleJoinMessage(conn, payload)
	case MessageTypeClientPlaceBuilding:
		handlePlacedBuildingMessage(conn, payload)
	case MessageTypeClientUpgradeBuildings:
		handleUpgradeBuildingsMessage(conn, payload)
	case MessageTypeClientDestroyBuildings:
		handleDestroyBuildingsMessage(conn, payload)
	case MessageTypeClientMoveUnits:
		handleMoveUnitsMessage(conn, payload)
	case MessageTypeClientToggleUnitSpawning:
		handleToggleUnitSpawning(conn, payload)
	case MessageTypeClientBuyCommander:
		handleBuyCommander(conn, payload)
	case MessageTypeClientBuyRepair:
		handleBuyRepair(conn, payload)
	case MessageTypeClientBuyRelocateBase:
		handleBuyRelocateBase(conn, payload)
	case MessageTypeClientCameraUpdate:
		handleCameraUpdate(conn, payload)
	case MessageTypeClientRequestResync:
		handleClientRequestResync(conn)
	case MessageTypeClientRequestSkinData:
		handleClientRequestSkinData(conn)
	case MessageTypeClientNewChatMessage:
		handleClientNewChatMessage(conn, payload)
	case MessageTypeClientActivity:
		handleClientActivity(conn, payload)
	case MessageTypeToggleGroupUnits:
		handleToggleGroupUnitsMessage(conn, payload)
	case MessageTypeClientSendX1Challenge:
		handleClientSendX1Challenge(conn, payload)
	case MessageTypeClientX1ChallengeReply:
		handleClientX1ChallengeReply(conn, payload)
	case MessageTypeClientWatchLeaveBase:
		handleClientWatchLeaveBase(conn, payload)
	case MessageTypeClientSecurityAlert:
		handleClientSecurityAlert(conn, payload)

	default:
		log.Printf("Received unsupported message type: %d", messageType)
	}
}

func handleJoinMessage(conn *websocket.Conn, payload []byte) {
	if game.Status == game.Initializing {
		sendGameNotReadyError(conn)
		conn.Close()
		return
	}

	if len(payload) < 6 || len(payload) > 18 {
		log.Println("Invalid payload length for join message")
		return
	}

	if SERVER_REBOOTING && !DISABLE_MULTIBOX_CHECK {
		sendError(conn)
		return
	}

	// Join payload layout:
	// [name...][equippedSkin:1][preferredColorIndex+securityFlags:1][fingerprint:4]
	name := payload[:len(payload)-6]
	equippedSkin := payload[len(name)]
	preferredColorRaw := payload[len(name)+1]
	joinSecurityFlags := preferredColorRaw &^ joinSecurityColorMask
	preferredColorIndex := preferredColorRaw & joinSecurityColorMask

	if (joinSecurityFlags & joinSecurityFlagUnauthorizedExt) != 0 {
		if enforceClientExtensionBlock {
			sendUnauthorizedExtensionError(conn)
			conn.Close()
			return
		}
		log.Printf("join security flag detected but allowed (ENFORCE_CLIENT_EXTENSION_BLOCK=false): %s", conn.RemoteAddr().String())
	}

	// Extract the fingerprint (last 4 bytes)
	fingerprint := uint32(payload[len(payload)-4])<<24 |
		uint32(payload[len(payload)-3])<<16 |
		uint32(payload[len(payload)-2])<<8 |
		uint32(payload[len(payload)-1])

	userData, ok := GetUserDataByConn(conn)
	if !ok {
		sendError(conn)
		return
	}

	permission := MapRoleToPermission(userData.Role)
	isSuperAdmin := permission == game.PERMISSION_ADMIN
	enforceMultiboxCheck := !DISABLE_MULTIBOX_CHECK && !isSuperAdmin

	if enforceMultiboxCheck {
		// Check if the fingerprint is already used for the client's IP
		isUsed := IsFingerprintUsedForIP(userData.ClientIP, fingerprint)
		if isUsed {
			sendError(conn)
			return
		}

		if err := AddFingerprintForConn(conn, fingerprint); err != nil {
			log.Printf("failed to add fingerprint for conn: %v", err)
		}

		if userData.Discord.ID != "" {
			if isDiscordAccountAlreadyPlaying(userData.Discord.ID) {
				sendError(conn)
				return
			}

			AddPlayingDiscordAccount(userData.Discord.ID)
		}
	}

	cleanName := filterProfanity(string(name))
	cleanName = strings.TrimSpace(cleanName)
	if cleanName == "" {
		cleanName = "Player"
	}

	var skinData game.SkinData
	var color []byte

	// Prefer the exact skin selected by client when it's a default catalog skin.
	skinData, ok = game.GetDefaultSkinByID(equippedSkin)
	if !ok {
		// Check for account skins (Premium/Veteran/Other)
		for _, unlockedSkinId := range userData.Skins.Unlocked {
			if unlockedSkinId == int(equippedSkin) {
				skinData, ok = game.GetSkinDataByID(equippedSkin)
				if ok {
					break
				}
			}
		}
	}

	// If still not found, accept the client-provided skin ID (e.g., Supabase skins)
	if !ok {
		colorIndex := int(preferredColorIndex)
		if len(game.NonSkinColors) > 0 {
			colorIndex = colorIndex % len(game.NonSkinColors)
		} else {
			colorIndex = 0
		}

		skinData = game.SkinData{
			ID:           equippedSkin,
			Name:         "external",
			BaseColor:    game.NonSkinColors[colorIndex],
			BaseColorHex: "#ffffff",
		}
		ok = true
	}

	// If skinData is uninitialized, provide a default value
	if len(skinData.BaseColor) == 0 || skinData.BaseColorHex == "" || skinData.BaseColorHex == "transparent" {
		colorIndex := int(preferredColorIndex)
		if len(game.NonSkinColors) > 0 {
			colorIndex = colorIndex % len(game.NonSkinColors)
		} else {
			colorIndex = 0
		}
		color = game.NonSkinColors[colorIndex]
	} else {
		// Use the base color from skinData
		color = skinData.BaseColor
	}

	player, ok := game.AddPlayer(conn, permission, []byte(cleanName), color, game.ID(skinData.ID), userData.ProgressUserID())
	if !ok {
		log.Println("Failed to add player to the game")
		sendError(conn)
		return
	}

	sendGameState(player, &player.ID)
	sendUnitsRotations(player)
	collectAndSendTrapperBullets(player)
	sendInitialPlayerData(player)
	sendActiveDuelArenas(player)
	broadcastPlayerJoined(player)

	changes, changed := game.State.Leaderboard.Update(game.State.Players)
	sendInitialLeaderboardUpdate(player)
	if changed {
		broadcastLeaderboardUpdateToAllExcept(&changes, player.ID)
	}
}

const resyncCooldown = 10 * time.Second

func handleClientRequestResync(conn *websocket.Conn) {
	player, ok := game.GetPlayerByConn(conn)
	if !ok {
		//log.Println("Player not found for connection with address:", conn.RemoteAddr())
		return
	}

	lastActivity := player.LastResync
	currentTime := time.Now()

	// Check if the last activity was within the cooldown period
	if currentTime.Sub(lastActivity) < resyncCooldown {
		//log.Printf("Resync request is on cooldown for player %s. Try again later.\n", player.Name)
		return
	}
	player.LastResync = currentTime

	sendGameState(player, nil)
	sendUnitsRotations(player)
	collectAndSendTrapperBullets(player)
	sendInitialLeaderboardUpdate(player)
	sendActiveDuelArenas(player)
}

func handleClientRequestSkinData(conn *websocket.Conn) {
	sendSkinData(conn, &game.AllSkins)
}

func sendUnitsRotations(player *game.Player) {
	game.State.RLock()
	players := make([]*game.Player, 0, len(game.State.Players))
	for _, p := range game.State.Players {
		players = append(players, p)
	}
	game.State.RUnlock()

	for _, otherPlayer := range players {
		if otherPlayer.IsMarkedForRemoval() {
			continue
		}

		otherPlayer.RLock()
		units := make([]*game.Unit, 0, len(otherPlayer.Units))
		for _, unit := range otherPlayer.Units {
			units = append(units, unit)
		}
		otherPlayer.RUnlock()

		SendUnitsRotationUpdate(player.Conn, otherPlayer.ID, units)
	}
}

func collectAndSendTrapperBullets(player *game.Player) {
	game.State.RLock() // Acquire read lock on the game state
	otherPlayers := make([]*game.Player, 0, len(game.State.Players))
	for _, p := range game.State.Players {
		otherPlayers = append(otherPlayers, p)
	}
	// Collect neutral bases from game state
	neutralBases := make([]*game.NeutralBase, 0, len(game.State.NeutralBases))
	neutralBases = append(neutralBases, game.State.NeutralBases...)
	game.State.RUnlock() // Release the read lock

	trapperBullets := make([]*game.Bullet, 0) // Slice to store all trapper bullets from other players

	// Collect trapper bullets from each other player
	for _, otherPlayer := range otherPlayers {
		if otherPlayer.IsMarkedForRemoval() {
			continue
		}

		otherPlayer.Base.RLock() // Acquire read lock on the other player's base
		for _, bullet := range otherPlayer.Base.Bullets {
			if bullet.Behavior == game.TrapperBullet {
				trapperBullets = append(trapperBullets, bullet) // Collect trapper bullets
			}
		}
		otherPlayer.Base.RUnlock() // Release the read lock
	}

	// Collect trapper bullets from each neutral base
	for _, neutralBase := range neutralBases {
		neutralBase.Base.RLock()
		for _, bullet := range neutralBase.Base.Bullets {
			if bullet.Behavior == game.TrapperBullet {
				trapperBullets = append(trapperBullets, bullet)
			}
		}
		neutralBase.Base.RUnlock()
	}

	// Send collected trapper bullets to the specified player
	if len(trapperBullets) > 0 {
		sendInitialBulletStates(player.Conn, trapperBullets)
	}
}

func handlePlacedBuildingMessage(conn *websocket.Conn, payload []byte) {
	if len(payload) != 9 {
		log.Println("Invalid payload length for placed building message")
		return
	}

	player, ok := game.GetPlayerByConn(conn)
	if !ok {
		return
	}

	rawBuildingType := payload[0]
	isDefenseAction := (rawBuildingType & 0x80) != 0
	placementRotationStep := uint8((rawBuildingType >> 4) & 0x07)
	buildingType := game.BuildingType(rawBuildingType & 0x0F)

	// Keep anti-script for normal gameplay, but skip it for explicit defend/remount placements.
	if !isDefenseAction && !player.CanPerformBuildingAction() {
		game.TriggerKickEvent(player, game.KICK_REASON_SCRIPTING)
		return
	}

	position := getPositionFloatFromPayload(payload[1:])
	base := player.Base

	// Validate building type
	if !game.ValidateBuildingType(buildingType) {
		log.Println("Invalid building type")
		return
	}

	// Portal building is disabled.
	if buildingType == game.PORTAL {
		SendBuildingPlacementFailed(player, buildingType, BuildingPlacementFailGeneric, 0)
		return
	}

	basePosition := player.Base.Position

	// Calculate distance between player position and desired building position
	dx := float64(position.X - float32(basePosition.X))
	dy := float64(position.Y - float32(basePosition.Y))
	distance := math.Sqrt(dx*dx + dy*dy)

	// Define maximum and minimum allowed distances (radii)
	maxRadius := game.PLAYER_MAX_BUILDING_RADIUS
	minRadius := game.PLAYER_MIN_BUILDING_RADIUS
	maxRadiusNeutralBase := game.NEUTRAL_BASE_MAX_BUILDING_RADIUS
	minRadiusNeutralBase := game.NEUTRAL_BASE_MIN_BUILDING_RADIUS
	maxRadiusByType := maxRadius
	maxRadiusNeutralByType := maxRadiusNeutralBase
	// Small visual safety so polygon/stroke edges stay inside the white helper ring.
	const innerRingVisualMargin = 4
	const innerRingMinRadiusTolerance = 1
	innerHelperRingRadius := game.PLAYER_MAX_BUILDING_RADIUS + game.WALL_OUTER_RING_OFFSET - game.GetBuildingSize(game.WALL)
	neutralInnerHelperRingRadius := game.NEUTRAL_BASE_MAX_BUILDING_RADIUS + game.WALL_OUTER_RING_OFFSET - game.GetBuildingSize(game.WALL)

	switch buildingType {
	case game.BARRACKS:
		minRadius = game.PLAYER_MAX_BUILDING_RADIUS
		minRadiusNeutralBase = game.NEUTRAL_BASE_MAX_BUILDING_RADIUS
		// Barracks sit on the fixed legacy outer ring standard.
		maxRadiusByType = game.PLAYER_MAX_BUILDING_RADIUS + game.BARRACKS_OUTER_RING_OFFSET
		maxRadiusNeutralByType = game.NEUTRAL_BASE_MAX_BUILDING_RADIUS + game.BARRACKS_OUTER_RING_OFFSET
	case game.WALL:
		// Walls follow the legacy outer ring offset standard.
		size := game.GetBuildingSize(buildingType)
		minRadius += size
		minRadiusNeutralBase += size
		maxRadiusByType = game.PLAYER_MAX_BUILDING_RADIUS + game.WALL_OUTER_RING_OFFSET
		maxRadiusNeutralByType = game.NEUTRAL_BASE_MAX_BUILDING_RADIUS + game.WALL_OUTER_RING_OFFSET
	case game.SIMPLE_TURRET, game.SNIPER_TURRET, game.ARMORY, game.GENERATOR, game.HOUSE:
		// These must remain inside the white helper ring.
		// Clamp center radius so the outer edge never crosses that ring.
		size := game.GetBuildingSize(buildingType)
		minRadius += size - innerRingMinRadiusTolerance
		minRadiusNeutralBase += size - innerRingMinRadiusTolerance
		maxRadiusByType = innerHelperRingRadius - size - innerRingVisualMargin
		maxRadiusNeutralByType = neutralInnerHelperRingRadius - size - innerRingVisualMargin
	default:
		// Circular shape (Wall, turret, etc.)
		size := game.GetBuildingSize(buildingType)
		minRadius += size
		minRadiusNeutralBase += size
	}

	tolerance := 4
	if buildingType == game.BARRACKS {
		// Extra buffer for fixed outer-ring placement.
		tolerance = 12
	} else if buildingType == game.SIMPLE_TURRET || buildingType == game.SNIPER_TURRET ||
		buildingType == game.ARMORY || buildingType == game.GENERATOR || buildingType == game.HOUSE {
		// Near-edge sockets can hit float precision; keep tiny tolerance aligned with client.
		tolerance = 1
	}

	// Validation for building placement
	isPlayerRadiusValid := false

	if buildingType == game.BARRACKS {
		// Barracks must stay on the fixed border ring.
		isPlayerRadiusValid = uint16(math.Floor(distance)) >= uint16(maxRadiusByType-tolerance) &&
			uint16(math.Ceil(distance)) <= uint16(maxRadiusByType+tolerance)
	} else {
		// Other buildings can be within the valid range, including the border
		isPlayerRadiusValid = !(distance > float64(maxRadiusByType+tolerance) ||
			distance < float64(minRadius-tolerance))
	}

	player.RLock()
	neutrals := make([]*game.NeutralBase, 0, len(player.CapturedNeutralBases))
	neutrals = append(neutrals, player.CapturedNeutralBases...)
	player.RUnlock()

	isNeutralBaseValid := false
	if !isPlayerRadiusValid {
		for _, neutral := range neutrals {
			// Calculate distance from the neutral base to the building position
			dx := float64(position.X - float32(neutral.Base.Position.X))
			dy := float64(position.Y - float32(neutral.Base.Position.Y))
			distanceToNeutralBase := math.Sqrt(dx*dx + dy*dy)

			// Calculate the clamped minimum and maximum distances
			minDistance := float64(minRadiusNeutralBase - tolerance)
			maxDistance := float64(maxRadiusNeutralByType + tolerance)

			// Check if the distance is valid within the neutral base radii
			if distanceToNeutralBase >= minDistance && distanceToNeutralBase <= maxDistance {
				isNeutralBaseValid = true
				base = neutral.Base
				break
			}
		}
	}

	// If neither the player nor the neutral base allow the placement, fail it
	if !isPlayerRadiusValid && !isNeutralBaseValid {
		log.Println("Building placement failed: position is not valid for either player or neutral base")
		SendBuildingPlacementFailed(player, buildingType, BuildingPlacementFailGeneric, 0)
		return
	}

	// Subtract the cost from the power
	costs, ok := game.GetBuildingCost(buildingType, game.BASIC_BUILDING)
	if !ok {
		log.Println("Costs not found for building:", buildingType)
		SendBuildingPlacementFailed(player, buildingType, BuildingPlacementFailGeneric, 0)
		return
	}
	ok = player.SpendPower(costs)
	if !ok {
		log.Println("Could not subtract costs for building:", buildingType)
		SendBuildingPlacementFailed(player, buildingType, BuildingPlacementFailGeneric, 0)
		return
	}

	// Check for collision
	if !base.CheckBuildingCollision(buildingType, position, placementRotationStep) {
		log.Println("Building intersects with existing building")
		// Restore resources if collision detected
		player.RefundPower(costs)
		SendBuildingPlacementFailed(player, buildingType, BuildingPlacementFailGeneric, 0)
		return
	}

	// Place the building
	building, ok := base.AddBuilding(buildingType, position, placementRotationStep)
	if !ok {
		log.Println("Failed to place building")
		// Restore resources if building placement failed
		player.RefundPower(costs)
		SendBuildingPlacementFailed(player, buildingType, BuildingPlacementFailGeneric, 0)
		return
	}

	generating, ok := game.GetResourceGeneration(buildingType, game.BASIC_BUILDING)
	if ok {
		player.Lock()
		player.Generating.Power += generating.Power
		player.Unlock()
	}

	capacity, ok := game.GetPopulationCapacity(building.Type, building.Variant)
	if ok {
		player.Population.IncrementCapacity(capacity)
	}

	// Update the player's last activity timestamp
	player.SetLastActivity()

	broadcastBuildingPlaced(base, building.ID)
}

func handleUpgradeBuildingsMessage(conn *websocket.Conn, payload []byte) {
	if len(payload) < 3 {
		log.Println("Invalid payload length for upgrade building message")
		return
	}

	player, ok := game.GetPlayerByConn(conn)
	if !ok {
		return
	}

	base := player.Base

	// First byte of the payload contains the flag indicating neutralBaseID presence
	flag := payload[0]
	if flag == 1 {
		// If flag is 1, neutralBaseID is present in the second byte
		if len(payload) < 4 {
			log.Println("Payload length mismatch, neutralBaseID expected")
			return
		}

		neutralBaseID := game.ID(payload[1]) // Get neutralBaseID from the second byte

		neutral, ok := player.GetCapturedNeutralBase(neutralBaseID)
		if !ok {
			log.Println("Neutral base not captured by player")
			return
		}

		base = neutral.Base
		payload = payload[2:] // Skip flag + neutralBaseID
	} else {
		payload = payload[1:] // Skip flag only
	}

	buildingVariant := game.BuildingVariant(payload[0])
	payload = payload[1:] // Skip buildingVariant
	if len(payload) == 0 || len(payload) > maxBulkBuildingActions {
		log.Println("Invalid number of buildings for upgrade message")
		return
	}

	// Now, process each buildingID in the payload
	var buildingIDs []game.ID
	for _, buildingByte := range payload {

		buildingID := game.ID(buildingByte)

		// Add the buildingID to the list
		buildingIDs = append(buildingIDs, buildingID)

		base.RLock()
		buildings := base.Buildings
		building, ok := buildings[buildingID]
		if !ok {
			base.RUnlock()
			log.Println("Failed to upgrade building: Building not found")
			return
		}
		base.RUnlock()

		if !game.ValidateUpgradePath(building.Type, building.Variant, buildingVariant) {
			log.Printf(
				"Upgrade path is not valid. Building Type: %d, Current Variant: %d, Attempted Variant: %d, Building ID: %d, Player: %s",
				building.Type,
				building.Variant,
				buildingVariant,
				building.ID,
				player.Name,
			)
			return
		}

		if building.Type == game.ARMORY &&
			(buildingVariant == game.BuildingVariant(2) ||
				buildingVariant == game.BuildingVariant(3) ||
				buildingVariant == game.BuildingVariant(4) ||
				buildingVariant == game.BuildingVariant(5) ||
				buildingVariant == game.BuildingVariant(6) ||
				buildingVariant == game.BuildingVariant(7) ||
				buildingVariant == game.BuildingVariant(8)) {
			if !player.HasBarracksVariant(game.TANK_FACTORY) {
				log.Println("Tank upgrades require at least one Tank Factory")
				return
			}
		}

		// Subtract the cost from the power
		costs, ok := game.GetBuildingCost(building.Type, buildingVariant)
		if !ok {
			log.Println("Costs not found for building:", building.Type, buildingVariant)
			return
		}

		ok = player.SpendPower(costs)
		if !ok {
			log.Println("Could not subtract costs for building:", building.Type, buildingVariant)
			return
		}

		// Retrieve the current power generation of the building with its current variant
		generating, ok := game.GetResourceGeneration(building.Type, building.Variant)
		if ok {
			// Subtract the current power generation amount from the player's total power generation
			player.Lock()
			player.Generating.Power -= generating.Power
			player.Unlock()
		}

		// Retrieve the power generation of the building with the new variant
		generating, ok = game.GetResourceGeneration(building.Type, buildingVariant)
		if ok {
			// Add the new power generation amount to the player's total power generation
			player.Lock()
			player.Generating.Power += generating.Power
			player.Unlock()
		}

		capacity, ok := game.GetPopulationCapacity(building.Type, building.Variant)
		if ok {
			player.Population.DecrementCapacity(capacity)
		}

		capacity, ok = game.GetPopulationCapacity(building.Type, buildingVariant)
		if ok {
			player.Population.IncrementCapacity(capacity)
		}

		var wasUnitSpawningActive bool
		switch building.Type {
		case game.BARRACKS:
			// Save the current activation state of the unit spawning before removing the old one
			unitSpawning := player.GetUnitSpawningForBarrack(building)
			if unitSpawning != nil {
				wasUnitSpawningActive = unitSpawning.Activated // Save the current state
			}
			player.RemoveUnitSpawning(building)
		case game.SIMPLE_TURRET, game.SNIPER_TURRET:
			base.RemoveBulletSpawning(building)
		}

		if !base.UpgradeBuilding(buildingID, buildingVariant) {
			log.Println("Could not upgrade building:", building.Type, buildingVariant)
			// Restore resources if building upgrade failed
			player.RefundPower(costs)
			return
		}

		switch building.Type {
		case game.BARRACKS:
			player.AddUnitSpawning(building, wasUnitSpawningActive)
		case game.SIMPLE_TURRET, game.SNIPER_TURRET:
			base.AddBulletSpawning(building)
		case game.ARMORY:
			// Armory upgrades are powerups and must stack.
			if buildingVariant == game.BuildingVariant(1) {
				player.ApplySoldierArmorUpgrade(true)
			}
			if buildingVariant == game.BuildingVariant(2) ||
				buildingVariant == game.BuildingVariant(4) ||
				buildingVariant == game.BuildingVariant(6) ||
				buildingVariant == game.BuildingVariant(8) {
				player.ApplyTankBoosterUpgrade(true)
			}
			if buildingVariant == game.BuildingVariant(3) ||
				buildingVariant == game.BuildingVariant(4) ||
				buildingVariant == game.BuildingVariant(7) ||
				buildingVariant == game.BuildingVariant(8) {
				player.ApplyTankCannonUpgrade(true)
			}
			if buildingVariant == game.BuildingVariant(5) ||
				buildingVariant == game.BuildingVariant(6) ||
				buildingVariant == game.BuildingVariant(7) ||
				buildingVariant == game.BuildingVariant(8) {
				player.ApplyTankCloakUpgrade(true)
			}
		}
	}

	// Update the player's last activity timestamp
	player.SetLastActivity()

	broadcastBuildingsUpgraded(base, buildingIDs)
}

func handleDestroyBuildingsMessage(conn *websocket.Conn, payload []byte) {
	if len(payload) < 2 {
		log.Println("Invalid payload length for destroy building message")
		return
	}

	// Get the player based on the connection
	player, ok := game.GetPlayerByConn(conn)
	if !ok {
		return
	}

	base := player.Base

	// First byte of the payload contains the flag indicating neutralBaseID presence
	flag := payload[0]

	if flag == 1 {
		// If flag is 1, neutralBaseID is present in the second byte
		if len(payload) < 3 {
			log.Println("Payload length mismatch, neutralBaseID expected")
			return
		}

		neutralBaseID := game.ID(payload[1]) // Get neutralBaseID from the second byte

		neutral, ok := player.GetCapturedNeutralBase(neutralBaseID)
		if !ok {
			log.Println("Neutral base not captured by player")
			return
		}

		base = neutral.Base
		payload = payload[2:] // Remove the second byte (neutralBaseID) for the building IDs processing
	} else {
		payload = payload[1:] // Remove the first byte (flag) for the building IDs processing
	}
	if len(payload) == 0 || len(payload) > maxBulkBuildingActions {
		log.Println("Invalid number of buildings for destroy message")
		return
	}

	// Now, process each buildingID in the payload
	var buildingIDs []game.ID
	for _, buildingByte := range payload {
		buildingID := game.ID(buildingByte)

		// Add the buildingID to the list
		buildingIDs = append(buildingIDs, buildingID)

		base.RLock()
		building, ok := base.Buildings[buildingID]
		base.RUnlock()

		if !ok {
			log.Println("Failed to get building for refund: Building not found, ID:", buildingID)
			continue
		}

		var refund uint16
		costs, ok := game.GetBuildingCost(building.Type, building.Variant)
		if !ok {
			log.Println("Costs not found for building:", building.Type)
		} else {
			refund = costs / 2
			player.RefundPower(refund)
		}

		// Remove the building from the base
		success := base.RemoveBuilding(buildingID)
		if !success {
			log.Println("Failed to remove building: Building not found, ID:", buildingID)
			if ok {
				player.SpendPower(refund)
			}
			continue
		}
	}

	// Update the player's last activity timestamp
	player.SetLastActivity()

	// Broadcast the destruction of all buildings
	broadcastBuildingsDestroyed(base, buildingIDs)
}

func handleMoveUnitsMessage(conn *websocket.Conn, payload []byte) {
	if len(payload) < 6 {
		log.Println("Invalid payload length for move units message. Payload length:", len(payload))
		return
	}

	numUnits := int(payload[0])
	if numUnits <= 0 || numUnits > len(payload[1:]) {
		log.Println("Invalid number of units to move:", numUnits)
		return
	}

	player, ok := game.GetPlayerByConn(conn)
	if !ok {
		return
	}

	player.SetLastActivity()

	offset := 1
	targetPosition := getPositionIntFromPayload(payload[offset:])
	const mapEdgeSafetyMargin int16 = 120
	targetPosition = game.ClampPositionIntToMap(targetPosition, mapEdgeSafetyMargin)
	targetPositionFloat := clampTargetToDuelArena(player, game.IntToFloat(targetPosition))
	targetPositionFloat = clampTargetAgainstForeignDuelArenas(player, targetPositionFloat)
	targetPosition = game.FloatToInt(targetPositionFloat)
	offset += 4

	unitIDs := payload[offset:]
	if len(unitIDs) != numUnits {
		log.Println("Mismatch between declared number of units and actual units in payload")
		return
	}

	// Continue with normal movement processing
	// Collect valid units
	player.RLock()
	unitsToUpdate := make([]*game.Unit, 0, len(unitIDs))
	validUnitCount := 0                                        // Count of valid units
	unitPositions := make([]game.PositionInt, 0, len(unitIDs)) // To store the positions of the valid units

	for _, unitIDByte := range unitIDs {
		unitID := game.ID(unitIDByte)
		unit, exists := player.Units[unitID]
		if !exists || unit.IsMarkedForRemoval() || time.Since(unit.LastTargetPositionUpdate) < time.Millisecond*50 {
			continue
		}

		// Set the target position for the unit
		unit.ExactTargetPositonRequest = targetPosition
		unitsToUpdate = append(unitsToUpdate, unit)
		validUnitCount++

		// Store the current position of the unit to be added to unitPositions
		unitPositions = append(unitPositions, game.FloatToInt(unit.Position))
	}

	player.RUnlock()

	// Create the new movement package
	newMovement := game.MovementPackage{
		Timestamp:      time.Now(),
		TargetPosition: targetPosition,
		UnitPositions:  unitPositions,
		UnitIds:        unitIDs,
	}

	// Check if the movement is suspicious based on the last 5 movements
	if isSuspiciousMovement(player, newMovement) {
		player.HandleSuspiciousBehavior()
		return

	}

	isScripting := player.UpdateSuspicion()
	if isScripting {
		log.Printf("Kicked Player: %s for unit movement script", player.Name)
		game.TriggerKickEvent(player, game.KICK_REASON_SCRIPTING)
	}

	// Set the new movement package to the player's history and remove the old
	player.LastMovementPackage = newMovement

	// Check if we have any valid units to move
	if validUnitCount == 0 {
		//log.Println("No valid units found to move.")
		return
	}

	basePosition := player.Base.Position
	dx_base := float64(targetPosition.X - basePosition.X)
	dy_base := float64(targetPosition.Y - basePosition.Y)
	distance_from_base := math.Sqrt(dx_base*dx_base + dy_base*dy_base)

	isClickOnBase := distance_from_base <= game.PLAYER_MAX_BUILDING_RADIUS

	isClickOnBush := false
	if !isClickOnBase {
		const bushClickRadius = 100.0 // Max bush size from client code
		game.State.RLock()
		for _, bushPos := range game.State.Bushes {
			dx_bush := float64(targetPosition.X - bushPos.X)
			dy_bush := float64(targetPosition.Y - bushPos.Y)
			distance_from_bush := math.Sqrt(dx_bush*dx_bush + dy_bush*dy_bush)
			if distance_from_bush <= bushClickRadius {
				isClickOnBush = true
				break
			}
		}
		game.State.RUnlock()
	}

	if player.GroupUnits || isClickOnBase || isClickOnBush {
		// Target is inside the base radius or on a bush, group all units at the exact target position.
		for _, unit := range unitsToUpdate {
			unit.SetTargetPosition(targetPositionFloat)
		}
	} else {
		// Target is outside the base radius, use formation logic.
		if validUnitCount == 1 {
			unitsToUpdate[0].SetTargetPosition(targetPositionFloat)
		} else {
			// Set the spacing between units
			const spacing = 50.0 // Space between units
			radius := spacing    // Start radius
			totalUnits := 0      // Count total units placed

			// Store the index of the nearest unit
			var nearestUnitIndex int
			nearestDistance := float32(math.MaxFloat32)

			for {
				circumference := 2.0 * math.Pi * radius
				unitsInLayer := int(circumference / spacing)

				// Exit if no units can fit or we placed all valid units
				if unitsInLayer <= 0 || totalUnits >= validUnitCount {
					break
				}

				// Define the magnitude of the random offset
				const offsetMagnitude float32 = 50.0 // Adjust this value to control how large the offset is

				// Place units for the current layer
				for i := 0; i < unitsInLayer && totalUnits < validUnitCount; i++ {
					angle := float64(i) * (2.0 * math.Pi / float64(unitsInLayer))
					targetX := float32(targetPosition.X) + float32(radius)*float32(math.Cos(angle))
					targetY := float32(targetPosition.Y) + float32(radius)*float32(math.Sin(angle))

					// Add random offset
					offsetX := (rand.Float32() - 0.5) * offsetMagnitude
					offsetY := (rand.Float32() - 0.5) * offsetMagnitude

					// Apply the offset to target positions
					targetX += offsetX
					targetY += offsetY

					// Set the target position for the unit.
					clampedTarget := game.ClampPositionFloatToMap(game.PositionFloat{X: targetX, Y: targetY}, float32(mapEdgeSafetyMargin))
					clampedTarget = clampTargetToDuelArena(player, clampedTarget)
					clampedTarget = clampTargetAgainstForeignDuelArenas(player, clampedTarget)
					unitsToUpdate[totalUnits].SetTargetPosition(clampedTarget)

					// Get the current position of the unit
					currentPosition := unitsToUpdate[totalUnits].Position
					// Calculate distance from the current position of the unit to the targetPosition
					distance := float32(math.Sqrt(float64((currentPosition.X-float32(targetPosition.X))*(currentPosition.X-float32(targetPosition.X)) +
						(currentPosition.Y-float32(targetPosition.Y))*(currentPosition.Y-float32(targetPosition.Y)))))

					// Check if this unit is the nearest to the targetPosition
					if distance < nearestDistance {
						nearestDistance = distance
						nearestUnitIndex = totalUnits
					}

					totalUnits++
				}
				radius += spacing // Increase the radius for the next layer
			}
			// Set the nearest unit's target position to the exact targetPosition if it's not already set
			unitsToUpdate[nearestUnitIndex].SetTargetPosition(targetPositionFloat)
		}
	}
	BroadcastUnitsRotationUpdate(player.ID, unitsToUpdate)
}

// isSuspiciousMovement checks if the current movement is suspicious based on the last 5 movement packages
func isSuspiciousMovement(player *game.Player, newMovement game.MovementPackage) bool {
	const distanceThreshold = 100.0              // Radius threshold to group units
	const targetThreshold = 50.0                 // Threshold for target position similarity
	const timeThreshold = time.Millisecond * 250 // Time threshold (for quick successive moves)

	lastMove := player.LastMovementPackage

	// Check if all units in newMovement are found in lastMove
	allUnitsFound := true
	for _, newUnitId := range newMovement.UnitIds {
		found := false
		for _, lastUnitId := range lastMove.UnitIds {
			if newUnitId == lastUnitId {
				found = true
				break
			}
		}
		if !found {
			allUnitsFound = false
			break
		}
	}

	if allUnitsFound {
		return false
	}

	// Check if the movement target is within the suspicious radius and within the time frame
	if time.Since(lastMove.Timestamp) < timeThreshold &&
		lastMove.TargetPosition.DistanceTo(newMovement.TargetPosition) < targetThreshold &&
		areUnitsGrouped(lastMove.UnitPositions, newMovement.UnitPositions, distanceThreshold) {

		return true
	}

	return false
}

// areUnitsGrouped checks if the units in both movement packages are grouped within a certain radius
func areUnitsGrouped(lastUnitPositions, newUnitPositions []game.PositionInt, radius float64) bool {
	for _, newPos := range newUnitPositions {
		for _, lastPos := range lastUnitPositions {
			if float64(lastPos.DistanceTo(newPos)) > radius {
				return false
			}
		}
	}
	return true
}

func handleToggleUnitSpawning(conn *websocket.Conn, payload []byte) {
	if len(payload) > 2 {
		log.Println("Invalid payload length for upgrade building message")
		return
	}

	player, ok := game.GetPlayerByConn(conn)
	if !ok {
		return
	}

	buildingID := game.ID(payload[0])
	base := player.Base
	if len(payload) == 2 {
		neutralBaseID := game.ID(payload[1])
		neutral, ok := player.GetCapturedNeutralBase(neutralBaseID)
		if !ok {
			log.Println("Neutral base not captured by player")
			return
		}
		base = neutral.Base
	}

	base.RLock()
	buildings := base.Buildings
	building, ok := buildings[buildingID]
	base.RUnlock()

	if !ok {
		log.Println("Failed to upgrade building: Building not found")
		return
	}

	unitSpawning := player.GetUnitSpawningForBarrack(building)
	if unitSpawning == nil {
		return
	}

	ok = player.ToggleUnitSpawning(building)
	if ok {
		broadcastBarracksActivationUpdate(base.Owner, unitSpawning)
	}
}

func handleBuyCommander(conn *websocket.Conn, payload []byte) {
	if len(payload) > 0 {
		log.Println("Invalid payload length for buying commander")
		return
	}

	player, ok := game.GetPlayerByConn(conn)
	if !ok {
		return
	}

	if player.HasCommander {
		// Already has a commander
		return
	}

	// Subtract the cost from the power
	cost := uint16(game.COMMANDER_COST)

	ok = player.SpendPower(cost)
	if !ok {
		log.Println("Could not subtract costs for:", game.COMMANDER)
		return
	}

	unit, ok := player.AddCommander()
	if !ok {
		log.Println("Commander not found!")
		return
	}

	broadcastUnitSpawn(player.Base.Owner, 255, unit) //! 255 to signal its a commander that is spawned
}

func handleBuyRepair(conn *websocket.Conn, payload []byte) {
	if len(payload) > 0 {
		log.Println("Invalid payload length for buying repair")
		return
	}

	player, ok := game.GetPlayerByConn(conn)
	if !ok {
		return
	}

	costs := uint16(6000)
	ok = player.SpendPower(costs)
	if !ok {
		log.Println("Could not subtract costs for:", game.COMMANDER)
		return
	}

	player.Base.Repair()
	broadcastBaseHealthUpdate(player.Base)
}

func handleBuyRelocateBase(conn *websocket.Conn, payload []byte) {
	if len(payload) != 0 && len(payload) != 4 {
		log.Println("Invalid payload length for buying base relocation (expected 0 or 4)")
		return
	}

	player, ok := game.GetPlayerByConn(conn)
	if !ok {
		return
	}

	// Avoid relocation during protected duel to prevent arena desync and abuse.
	if player.InDuel {
		return
	}

	now := time.Now()
	canRelocate, remaining := player.CanRelocateNow(now)
	if !canRelocate {
		remainingSecondsFloat := math.Ceil(remaining.Seconds())
		if remainingSecondsFloat < 1 {
			remainingSecondsFloat = 1
		}
		if remainingSecondsFloat > 65535 {
			remainingSecondsFloat = 65535
		}
		sendRelocateCooldownError(conn, uint16(remainingSecondsFloat))
		return
	}

	cost := uint16(game.RELOCATE_BASE_COST)
	ok = player.SpendPower(cost)
	if !ok {
		log.Println("Could not subtract costs for base relocation")
		return
	}

	var targetPosition *game.PositionInt
	if len(payload) == 4 {
		pos := getPositionIntFromPayload(payload)
		targetPosition = &pos
	}

	ok = game.RelocatePlayerBaseTo(player, targetPosition)
	if !ok {
		player.RefundPower(cost)
		return
	}

	player.RecordRelocation(now)

	sendResourceUpdate(player)

	// Full resync to all players so everyone sees the new base/building/unit positions.
	game.State.RLock()
	players := make([]*game.Player, 0, len(game.State.Players))
	for _, p := range game.State.Players {
		players = append(players, p)
	}
	game.State.RUnlock()

	for _, p := range players {
		if p.IsMarkedForRemoval() {
			continue
		}
		sendGameState(p, nil)
		sendActiveDuelArenas(p)
	}
}

func handleCameraUpdate(conn *websocket.Conn, payload []byte) {

	return
	//!!!
	// TODO: Implement this shit :D

	if len(payload) < 5 {
		log.Println("Payload too short for camera update")
		return
	}

	player, ok := game.GetPlayerByConn(conn)
	if !ok {
		//log.Println("Player not found for connection")
		return
	}

	if player.IsMarkedForRemoval() {
		return
	}

	offset := 0
	position := getPositionIntFromPayload(payload[offset:])
	offset += 4

	scalingFactor := float32(10.0)
	zoomLevel := float32(payload[offset]) / scalingFactor

	if player.Camera.CanUpdate() {
		player.Camera.Position = position
		player.Camera.SetZoom(zoomLevel)
		player.Camera.UpdateBounds()
		player.Camera.UpdateLastTime()
	} else {
		return
	}

	game.State.RLock()
	players := make([]*game.Player, 0, len(game.State.Players)) // Create a slice of players
	for _, player := range game.State.Players {
		players = append(players, player)
	}
	game.State.RUnlock()

	for _, otherPlayer := range players {
		if player.IsMarkedForRemoval() {
			continue
		}

		otherPlayer.RLock()
		units := make([]*game.Unit, 0, len(otherPlayer.Units))
		for _, unit := range otherPlayer.Units {
			units = append(units, unit)
		}
		otherPlayer.RUnlock()

		for _, unit := range units {
			if unit.IsMarkedForRemoval() {
				continue
			}

			SendUnitPositionUpdate(player.Conn, otherPlayer, unit)
		}
	}
}

// Create a struct to store message state for each player
type PlayerMessageState struct {
	lastMessageTime time.Time
	lastMessage     string
}

var (
	messageState        = make(map[game.ID]*PlayerMessageState)
	messageMx           sync.Mutex
	x1ChallengeRequests = make(map[game.ID]game.ID) // target -> challenger
	x1ChallengeMx       sync.Mutex
)

func handleClientNewChatMessage(conn *websocket.Conn, payload []byte) {
	if len(payload) == 0 || len(payload) > maxChatMessageBytes {
		log.Println("Invalid payload length for a chat message. Payload length:", len(payload))
		return
	}

	if !utf8.Valid(payload) {
		log.Println("Invalid UTF-8 payload for chat message")
		return
	}

	// Check if connection comes from a player
	player, ok := game.GetPlayerByConn(conn)
	if !ok {
		return
	}

	player.SetLastActivity()

	messageText := strings.TrimSpace(string(payload))
	if messageText == "" {
		return
	}
	if hasDisallowedControlChars(messageText) {
		log.Println("Chat message rejected due to control characters")
		return
	}
	messageRunes := []rune(messageText)
	if len(messageRunes) > maxChatMessageRunes {
		messageText = string(messageRunes[:maxChatMessageRunes])
	}
	message := []byte(messageText)

	game.TriggerChatMessageEvent(player.ID, message)
}

func hasDisallowedControlChars(text string) bool {
	for _, r := range text {
		if r < 32 {
			return true
		}
	}
	return false
}

func handleClientActivity(conn *websocket.Conn, payload []byte) {
	player, ok := game.GetPlayerByConn(conn)
	if !ok {
		return
	}

	player.SetLastActivity()
	player.LastActivityWarningSent = time.Now()
	SendPlayerActive(player)
}

func securityAlertReasonName(code byte) string {
	switch code {
	case 1:
		return "devtools_shortcut"
	case 2:
		return "viewsource_shortcut"
	case 3:
		return "devtools_opened"
	default:
		return "unknown"
	}
}

func handleClientSecurityAlert(conn *websocket.Conn, payload []byte) {
	reason := byte(0)
	if len(payload) > 0 {
		reason = payload[0]
	}

	player, ok := game.GetPlayerByConn(conn)
	if !ok {
		log.Printf("security alert before join from %s: reason=%d (%s)", conn.RemoteAddr().String(), reason, securityAlertReasonName(reason))
		if enforceClientSecurityAlertKick {
			CloseConnection(conn)
		}
		return
	}

	log.Printf("security alert from player=%d reason=%d (%s)", player.ID, reason, securityAlertReasonName(reason))
	if enforceClientSecurityAlertKick {
		game.TriggerKickEvent(player, game.KICK_REASON_SCRIPTING)
	}
}

func handleToggleGroupUnitsMessage(conn *websocket.Conn, payload []byte) {
	if len(payload) != 1 {
		log.Println("Invalid payload length for toggle group units message")
		return
	}

	player, ok := game.GetPlayerByConn(conn)
	if !ok {
		return
	}

	isGrouped := payload[0] == 1

	player.SetGroupUnits(isGrouped)
}

const (
	x1ResultSent        byte = 0
	x1ResultAccepted    byte = 1
	x1ResultDeclined    byte = 2
	x1ResultInvalidSide byte = 3
	x1ResultUnavailable byte = 4
	x1ResultNoPending   byte = 5
	x1ResultLeaveBase   byte = 6
	x1ResultUnderAttack byte = 7
	x1ResultWatchNotice byte = 8
)

const x1TargetUnderAttackWindow = 5 * time.Minute

func isLeftOrRightNeighbor(challenger *game.Player, target *game.Player) bool {
	if challenger == nil || target == nil || challenger.Base == nil || target.Base == nil {
		return false
	}

	dx := float64(target.Base.Position.X - challenger.Base.Position.X)
	dy := math.Abs(float64(target.Base.Position.Y - challenger.Base.Position.Y))

	// Must be aligned on the same horizontal lane (left/right), not diagonal.
	const axisTolerance = 250.0
	return dy <= axisTolerance && math.Abs(dx) > axisTolerance
}

func hasPendingX1ForPlayerUnsafe(playerID game.ID) bool {
	for targetID, challengerID := range x1ChallengeRequests {
		if targetID == playerID || challengerID == playerID {
			return true
		}
	}
	return false
}

func clearPendingX1ForPlayersUnsafe(playerIDs ...game.ID) {
	for targetID, challengerID := range x1ChallengeRequests {
		for _, playerID := range playerIDs {
			if targetID == playerID || challengerID == playerID {
				delete(x1ChallengeRequests, targetID)
				break
			}
		}
	}
}

func isInProtectedX1(player *game.Player) bool {
	if player == nil {
		return false
	}
	player.RLock()
	inDuel := player.InDuel
	player.RUnlock()
	return inDuel
}

func clampTargetToDuelArena(player *game.Player, target game.PositionFloat) game.PositionFloat {
	if player == nil {
		return target
	}

	player.RLock()
	inDuel := player.InDuel
	arena := player.DuelArena
	player.RUnlock()

	if !inDuel {
		return target
	}

	const edgePadding float32 = 18
	minX := arena.MinX + edgePadding
	maxX := arena.MaxX - edgePadding
	minY := arena.MinY + edgePadding
	maxY := arena.MaxY - edgePadding

	if minX > maxX || minY > maxY {
		return target
	}

	if target.X < minX {
		target.X = minX
	} else if target.X > maxX {
		target.X = maxX
	}

	if target.Y < minY {
		target.Y = minY
	} else if target.Y > maxY {
		target.Y = maxY
	}

	return target
}

func projectPointOutsideRect(target game.PositionFloat, minX, maxX, minY, maxY, push float32) game.PositionFloat {
	leftDist := target.X - minX
	rightDist := maxX - target.X
	topDist := target.Y - minY
	bottomDist := maxY - target.Y

	nearest := leftDist
	edge := byte(0) // 0=left,1=right,2=top,3=bottom
	if rightDist < nearest {
		nearest = rightDist
		edge = 1
	}
	if topDist < nearest {
		nearest = topDist
		edge = 2
	}
	if bottomDist < nearest {
		edge = 3
	}

	switch edge {
	case 0:
		target.X = minX - push
	case 1:
		target.X = maxX + push
	case 2:
		target.Y = minY - push
	default:
		target.Y = maxY + push
	}
	return target
}

func clampTargetAgainstForeignDuelArenas(player *game.Player, target game.PositionFloat) game.PositionFloat {
	if player == nil {
		return target
	}

	playerID := player.ID
	const edgePadding float32 = 18
	const pushOutside float32 = 2

	game.State.RLock()
	defer game.State.RUnlock()

	for _, p := range game.State.Players {
		if p == nil {
			continue
		}

		p.RLock()
		inDuel := p.InDuel
		arena := p.DuelArena
		opponentID := p.DuelOpponentID
		ownerID := p.ID
		p.RUnlock()

		if !inDuel || opponentID == 0 {
			continue
		}
		// Process each duel arena once per pair.
		if ownerID > opponentID {
			continue
		}
		// Duel participants are allowed inside their own arena.
		if playerID == ownerID || playerID == opponentID {
			continue
		}

		minX := arena.MinX + edgePadding
		maxX := arena.MaxX - edgePadding
		minY := arena.MinY + edgePadding
		maxY := arena.MaxY - edgePadding
		if minX > maxX || minY > maxY {
			continue
		}

		inside := target.X >= minX && target.X <= maxX && target.Y >= minY && target.Y <= maxY
		if inside {
			target = projectPointOutsideRect(target, minX, maxX, minY, maxY, pushOutside)
		}
	}

	return target
}

func handleClientSendX1Challenge(conn *websocket.Conn, payload []byte) {
	if len(payload) != 1 {
		return
	}

	challenger, ok := game.GetPlayerByConn(conn)
	if !ok {
		return
	}
	challenger.SetLastActivity()
	targetID := game.ID(payload[0])
	if targetID == challenger.ID {
		sendX1ChallengeResult(challenger, x1ResultUnavailable, challenger)
		return
	}

	game.State.RLock()
	target, targetExists := game.State.Players[targetID]
	game.State.RUnlock()

	if !targetExists || target == nil || target.IsMarkedForRemoval() {
		sendX1ChallengeResult(challenger, x1ResultUnavailable, nil)
		return
	}
	if challenger.HasProtection() {
		sendX1ChallengeResult(challenger, x1ResultLeaveBase, target)
		return
	}
	if target.HasProtection() {
		sendX1ChallengeResult(challenger, x1ResultUnavailable, target)
		return
	}
	if isInProtectedX1(challenger) || isInProtectedX1(target) {
		sendX1ChallengeResult(challenger, x1ResultUnavailable, target)
		return
	}
	if target.WasBaseDamagedWithin(x1TargetUnderAttackWindow) {
		sendX1ChallengeResult(challenger, x1ResultUnderAttack, target)
		return
	}

	if !isLeftOrRightNeighbor(challenger, target) {
		sendX1ChallengeResult(challenger, x1ResultInvalidSide, target)
		return
	}

	x1ChallengeMx.Lock()
	if hasPendingX1ForPlayerUnsafe(challenger.ID) || hasPendingX1ForPlayerUnsafe(target.ID) {
		x1ChallengeMx.Unlock()
		sendX1ChallengeResult(challenger, x1ResultUnavailable, target)
		return
	}
	x1ChallengeRequests[target.ID] = challenger.ID
	x1ChallengeMx.Unlock()

	// Re-check duel state right before notifying target to avoid race with duel start.
	if isInProtectedX1(challenger) || isInProtectedX1(target) {
		x1ChallengeMx.Lock()
		if currentChallengerID, exists := x1ChallengeRequests[target.ID]; exists && currentChallengerID == challenger.ID {
			delete(x1ChallengeRequests, target.ID)
		}
		x1ChallengeMx.Unlock()
		sendX1ChallengeResult(challenger, x1ResultUnavailable, target)
		return
	}

	sendX1ChallengeReceived(target, challenger)
	sendX1ChallengeResult(challenger, x1ResultSent, target)
}

func handleClientX1ChallengeReply(conn *websocket.Conn, payload []byte) {
	if len(payload) != 2 {
		return
	}

	targetPlayer, ok := game.GetPlayerByConn(conn)
	if !ok {
		return
	}
	targetPlayer.SetLastActivity()

	challengerID := game.ID(payload[0])
	accepted := payload[1] == 1

	x1ChallengeMx.Lock()
	expectedChallengerID, exists := x1ChallengeRequests[targetPlayer.ID]
	if !exists || expectedChallengerID != challengerID {
		x1ChallengeMx.Unlock()
		sendX1ChallengeResult(targetPlayer, x1ResultNoPending, nil)
		return
	}
	delete(x1ChallengeRequests, targetPlayer.ID)
	x1ChallengeMx.Unlock()

	game.State.RLock()
	challenger, challengerExists := game.State.Players[challengerID]
	game.State.RUnlock()

	if !challengerExists || challenger == nil || challenger.IsMarkedForRemoval() {
		sendX1ChallengeResult(targetPlayer, x1ResultUnavailable, nil)
		return
	}
	if targetPlayer.HasProtection() || challenger.HasProtection() {
		sendX1ChallengeResult(targetPlayer, x1ResultLeaveBase, challenger)
		sendX1ChallengeResult(challenger, x1ResultLeaveBase, targetPlayer)
		return
	}
	if isInProtectedX1(challenger) || isInProtectedX1(targetPlayer) {
		sendX1ChallengeResult(targetPlayer, x1ResultUnavailable, challenger)
		sendX1ChallengeResult(challenger, x1ResultUnavailable, targetPlayer)
		return
	}
	if targetPlayer.WasBaseDamagedWithin(x1TargetUnderAttackWindow) {
		sendX1ChallengeResult(targetPlayer, x1ResultUnderAttack, challenger)
		sendX1ChallengeResult(challenger, x1ResultUnderAttack, targetPlayer)
		return
	}

	if accepted {
		x1ChallengeMx.Lock()
		clearPendingX1ForPlayersUnsafe(challenger.ID, targetPlayer.ID)
		x1ChallengeMx.Unlock()

		arena := game.StartProtectedDuel(challenger, targetPlayer)
		sendX1ChallengeResult(challenger, x1ResultAccepted, targetPlayer)
		sendX1ChallengeResult(targetPlayer, x1ResultAccepted, challenger)
		broadcastX1DuelArenaUpdate(challenger.ID, targetPlayer.ID, arena)
		return
	}

	sendX1ChallengeResult(challenger, x1ResultDeclined, targetPlayer)
	sendX1ChallengeResult(targetPlayer, x1ResultDeclined, challenger)
}

func handleClientWatchLeaveBase(conn *websocket.Conn, payload []byte) {
	if len(payload) != 1 {
		return
	}

	watcher, ok := game.GetPlayerByConn(conn)
	if !ok {
		return
	}
	watcher.SetLastActivity()

	targetID := game.ID(payload[0])
	if targetID == watcher.ID {
		return
	}

	game.State.RLock()
	target, targetExists := game.State.Players[targetID]
	game.State.RUnlock()
	if !targetExists || target == nil || target.IsMarkedForRemoval() {
		return
	}

	if !target.HasProtection() {
		return
	}

	sendX1ChallengeResult(target, x1ResultWatchNotice, watcher)
}

func removePlayerMessageState(playerID game.ID) {
	messageMx.Lock()
	defer messageMx.Unlock()

	delete(messageState, playerID)

	x1ChallengeMx.Lock()
	defer x1ChallengeMx.Unlock()

	delete(x1ChallengeRequests, playerID)
	for targetID, challengerID := range x1ChallengeRequests {
		if challengerID == playerID {
			delete(x1ChallengeRequests, targetID)
		}
	}
}

func getPositionIntFromPayload(payload []byte) game.PositionInt {
	// Ensure payload contains at least 4 bytes (2 bytes for X, 2 bytes for Y)
	if len(payload) < 4 {
		// Payload doesn't contain enough data for position extraction
		// Return a zero position or handle this situation based on your requirements
		log.Println("Payload doesn't contain enough data for position extraction")
		return game.PositionInt{}
	}
	// Extract X and Y bytes from the payload and reconstruct the int16 values
	x := int16(payload[0])<<8 | int16(payload[1])
	y := int16(payload[2])<<8 | int16(payload[3])

	return game.PositionInt{X: x, Y: y}
}

func getPositionFloatFromPayload(payload []byte) game.PositionFloat {
	// Ensure payload contains at least 8 bytes (4 bytes for X, 4 bytes for Y)
	if len(payload) < 8 {
		// Payload doesn't contain enough data for position extraction
		log.Println("Payload doesn't contain enough data for position extraction")
		return game.PositionFloat{}
	}

	// Create a DataView from the payload bytes
	dataView := binary.BigEndian

	// Extract X and Y as float32 from the payload
	x := dataView.Uint32(payload[0:4])
	y := dataView.Uint32(payload[4:8])

	return game.PositionFloat{
		X: math.Float32frombits(x),
		Y: math.Float32frombits(y),
	}
}
