package network

import (
	"bytes"
	"encoding/binary"
	"errors"
	"log"
	"math"
	"net"
	"os"
	"server/game"
	"sync"
	"syscall"

	"github.com/gorilla/websocket"
)

var connMutex sync.Mutex

func sendToClient(conn *websocket.Conn, message []byte, toRemove *[]*websocket.Conn) error {
	if conn == nil {
		log.Println("Connection is nil, cannot send message")
		return errors.New("nil connection")
	}

	connMutex.Lock()
	defer connMutex.Unlock()

	err := conn.WriteMessage(websocket.BinaryMessage, message)
	if err != nil {
		log.Printf("Network error while writing message to %s: %v", conn.RemoteAddr().String(), err)

		if websocket.IsCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure, websocket.CloseAbnormalClosure) {
			log.Printf("Client %s disconnected normally", conn.RemoteAddr().String())
		} else if ne, ok := err.(*net.OpError); ok && ne.Err != nil {
			if se, ok := ne.Err.(*os.SyscallError); ok && (se.Err == syscall.EPIPE || se.Err == syscall.ECONNRESET) {
				log.Printf("Broken pipe or connection reset by peer for %s: %v", conn.RemoteAddr().String(), err)
			} else {
				log.Printf("Unexpected network error for %s: %v", conn.RemoteAddr().String(), err)
			}
		} else {
			log.Printf("Unexpected WebSocket error for %s: %v", conn.RemoteAddr().String(), err)
		}

		if toRemove != nil {
			*toRemove = append(*toRemove, conn)
		} else {
			//log.Println("toRemove is nil; unable to track connection for removal")
		}
		return err
	}
	return nil
}

func broadcastUnitHealthUpdate(playerID game.ID, unit *game.Unit) {
	message := Message{
		Type: MessageTypeUnitHealthUpdate,
	}

	buffer := new(bytes.Buffer)
	buffer.WriteByte(byte(playerID))
	buffer.WriteByte(byte(unit.ID))
	binary.Write(buffer, binary.BigEndian, unit.Health.Current)

	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

func broadcastToAll(message []byte) {
	var toRemove []*websocket.Conn

	game.State.RLock()

	for _, player := range game.State.Players {
		if !player.IsMarkedForRemoval() {
			sendToClient(player.Conn, message, &toRemove)
		}
	}

	game.State.RUnlock()

	for _, conn := range toRemove {
		removePlayerByConnection(conn)
	}
}

func broadcastToAllExcept(message []byte, exceptPlayerID game.ID) {
	var toRemove []*websocket.Conn

	game.State.RLock()

	for id, player := range game.State.Players {
		if id != exceptPlayerID {
			if !player.IsMarkedForRemoval() {
				sendToClient(player.Conn, message, &toRemove)
			}
		}
	}

	game.State.RUnlock()

	for _, conn := range toRemove {
		removePlayerByConnection(conn)
	}
}

func BroadcastRebootAlert(minutesLeft byte) {
	message := Message{
		Type: MessageTypeRebootAlertMessage,
	}

	buffer := new(bytes.Buffer)
	buffer.WriteByte(minutesLeft)

	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

func broadcastChatMessage(playerID game.ID, text []byte) {
	message := Message{
		Type: MessageTypeChatMessage,
	}

	buffer := new(bytes.Buffer)
	buffer.WriteByte(byte(playerID))
	if len(text) > 64 {
		text = text[:64]
	}
	buffer.Write(text)

	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

func sendX1ChallengeReceived(target *game.Player, challenger *game.Player) {
	message := Message{
		Type: MessageTypeX1ChallengeReceived,
	}

	buffer := new(bytes.Buffer)
	buffer.WriteByte(byte(challenger.ID))
	buffer.Write(challenger.Name[:])

	message.Payload = buffer.Bytes()
	sendToClient(target.Conn, EncodeMessage(message), nil)
}

func sendX1ChallengeResult(target *game.Player, status byte, other *game.Player) {
	message := Message{
		Type: MessageTypeX1ChallengeResult,
	}

	buffer := new(bytes.Buffer)
	buffer.WriteByte(status)

	if other != nil {
		buffer.WriteByte(byte(other.ID))
		buffer.Write(other.Name[:])
	} else {
		buffer.WriteByte(byte(0))
		var emptyName [12]byte
		buffer.Write(emptyName[:])
	}

	// For accepted duels, append arena bounds so clients can render the protected rectangle.
	if status == 1 && target != nil {
		target.RLock()
		arena := target.DuelArena
		target.RUnlock()
		binary.Write(buffer, binary.BigEndian, arena.MinX)
		binary.Write(buffer, binary.BigEndian, arena.MinY)
		binary.Write(buffer, binary.BigEndian, arena.MaxX)
		binary.Write(buffer, binary.BigEndian, arena.MaxY)
		buffer.WriteByte(game.DuelPreparationSeconds())
	}

	message.Payload = buffer.Bytes()
	sendToClient(target.Conn, EncodeMessage(message), nil)
}

func broadcastX1DuelArenaUpdate(playerAID game.ID, playerBID game.ID, arena game.DuelArena) {
	message := buildX1DuelArenaMessage(playerAID, playerBID, arena)
	broadcastToAll(EncodeMessage(message))
}

func sendX1DuelArenaUpdateToClient(conn *websocket.Conn, playerAID game.ID, playerBID game.ID, arena game.DuelArena) {
	message := buildX1DuelArenaMessage(playerAID, playerBID, arena)
	sendToClient(conn, EncodeMessage(message), nil)
}

func buildX1DuelArenaMessage(playerAID game.ID, playerBID game.ID, arena game.DuelArena) Message {
	message := Message{
		Type: MessageTypeX1DuelArenaUpdate,
	}

	buffer := new(bytes.Buffer)
	buffer.WriteByte(byte(playerAID))
	buffer.WriteByte(byte(playerBID))
	binary.Write(buffer, binary.BigEndian, arena.MinX)
	binary.Write(buffer, binary.BigEndian, arena.MinY)
	binary.Write(buffer, binary.BigEndian, arena.MaxX)
	binary.Write(buffer, binary.BigEndian, arena.MaxY)

	message.Payload = buffer.Bytes()
	return message
}

func sendActiveDuelArenas(player *game.Player) {
	if player == nil || player.Conn == nil {
		return
	}

	game.State.RLock()
	for _, p := range game.State.Players {
		if p == nil || p.IsMarkedForRemoval() {
			continue
		}

		p.RLock()
		inDuel := p.InDuel
		opponentID := p.DuelOpponentID
		arena := p.DuelArena
		pid := p.ID
		p.RUnlock()

		if !inDuel || pid >= opponentID {
			continue
		}

		opponent := game.State.Players[opponentID]
		if opponent == nil || opponent.IsMarkedForRemoval() {
			continue
		}

		sendX1DuelArenaUpdateToClient(player.Conn, pid, opponentID, arena)
	}
	game.State.RUnlock()
}

func broadcastPlayerJoined(player *game.Player) {
	message := Message{
		Type: MessageTypePlayerJoined,
	}

	buffer := new(bytes.Buffer)
	buffer.WriteByte(byte(player.ID))
	colorBytes := player.Base.Color
	buffer.Write(colorBytes)
	buffer.WriteByte(byte(player.SkinID))
	binary.Write(buffer, binary.BigEndian, player.Base.Position.X)
	binary.Write(buffer, binary.BigEndian, player.Base.Position.Y)
	buffer.Write(player.Name[:])

	message.Payload = buffer.Bytes()
	broadcastToAllExcept(EncodeMessage(message), player.ID)
}

func broadcastPlayerLeft(playerID game.ID) {
	message := Message{
		Type: MessageTypePlayerLeft,
	}

	buffer := new(bytes.Buffer)
	buffer.WriteByte(byte(playerID))

	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

// Only send to killed player
func sendKilledNotification(player *game.Player, killedByID game.ID) {
	message := Message{
		Type: MessageTypeKilled,
	}

	score := player.GetScore()
	xp := ScoreToXP(score)
	kills := player.GetKills()
	playtimeInSeconds := uint32(player.GetPlayDuration().Seconds())

	buffer := new(bytes.Buffer)
	buffer.WriteByte(byte(killedByID))
	binary.Write(buffer, binary.BigEndian, score)
	binary.Write(buffer, binary.BigEndian, xp)
	binary.Write(buffer, binary.BigEndian, kills)
	binary.Write(buffer, binary.BigEndian, playtimeInSeconds)

	message.Payload = buffer.Bytes()
	var toRemove []*websocket.Conn

	sendToClient(player.Conn, EncodeMessage(message), &toRemove)

	for _, conn := range toRemove {
		removePlayerByConnection(conn)
	}
}

func sendKickNotification(player *game.Player, reason byte) {
	message := Message{
		Type: MessageTypeKickNotification,
	}

	buffer := new(bytes.Buffer)
	buffer.WriteByte(reason)
	score := player.GetScore()
	xp := ScoreToXP(score)
	kills := player.GetKills()
	playtimeInSeconds := uint32(player.GetPlayDuration().Seconds())

	binary.Write(buffer, binary.BigEndian, score)
	binary.Write(buffer, binary.BigEndian, xp)
	binary.Write(buffer, binary.BigEndian, kills)
	binary.Write(buffer, binary.BigEndian, playtimeInSeconds)

	message.Payload = buffer.Bytes()

	var toRemove []*websocket.Conn

	sendToClient(player.Conn, EncodeMessage(message), &toRemove)

	for _, conn := range toRemove {
		removePlayerByConnection(conn)
	}
}

func sendSkinData(conn *websocket.Conn, skinCategory *game.SkinCategory) {
	message := Message{
		Type: MessageTypeSkinData,
	}

	buffer := new(bytes.Buffer)

	EncodeSkinData(buffer, *skinCategory)

	message.Payload = buffer.Bytes()

	sendToClient(conn, EncodeMessage(message), nil)
}

func broadcastBaseHealthUpdate(base *game.Base) {

	message := Message{
		Type: MessageTypeBaseHealthUpdate,
	}

	buffer := new(bytes.Buffer)

	// Determine if the owner is a Player or a NeutralBase and write the relevant data
	if player, ok := base.Owner.(*game.Player); ok {
		buffer.WriteByte(1) // Indicating it's a Player
		buffer.WriteByte(byte(player.ID))
		binary.Write(buffer, binary.BigEndian, player.Base.Health.Current)
	} else if neutral, ok := base.Owner.(*game.NeutralBase); ok {
		buffer.WriteByte(0) // Indicating it's a NeutralBase
		buffer.WriteByte(byte(neutral.ID))
		binary.Write(buffer, binary.BigEndian, neutral.Base.Health.Current)
	}

	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

func broadcastNeutralBaseCaptured(neutral *game.NeutralBase) {
	message := Message{
		Type: MessageTypeNeutralBaseCaptured,
	}

	buffer := new(bytes.Buffer)
	buffer.WriteByte(byte(neutral.ID))

	// Write playerID only if CapturedBy is not nil
	if neutral.CapturedBy != nil {
		buffer.WriteByte(byte(neutral.CapturedBy.ID))

		// Iterate over buildings and write their details
		for _, building := range neutral.Base.Buildings {
			buffer.WriteByte(byte(building.ID))
			buffer.WriteByte(byte(building.Type))
			buffer.WriteByte(byte(building.Variant))
			buffer.WriteByte(byte(building.PlacementRotationStep))

			// Write building positions
			binary.Write(buffer, binary.BigEndian, building.Position.X)
			binary.Write(buffer, binary.BigEndian, building.Position.Y)
		}
	}

	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

func broadcastBuildingPlaced(base *game.Base, buildingID game.ID) {
	message := Message{
		Type: MessageTypeBuildingPlaced,
	}

	building := base.Buildings[buildingID]

	buffer := new(bytes.Buffer)

	var player *game.Player

	// Determine if the owner is a Player or a NeutralBase and write the relevant data
	if player_, ok := base.Owner.(*game.Player); ok {
		player = player_
		buffer.WriteByte(1) // Indicating it's a Player
		buffer.WriteByte(byte(player.ID))
	} else if neutral, ok := base.Owner.(*game.NeutralBase); ok {
		player = neutral.CapturedBy
		buffer.WriteByte(0) // Indicating it's a NeutralBase
		buffer.WriteByte(byte(neutral.ID))
	}
	buffer.WriteByte(byte(building.ID))
	buffer.WriteByte(byte(building.Type))
	buffer.WriteByte(byte(building.PlacementRotationStep))
	binary.Write(buffer, binary.BigEndian, building.Position.X)
	binary.Write(buffer, binary.BigEndian, building.Position.Y)

	if building.Type == game.BARRACKS && player != nil {
		unitSpawning := player.GetUnitSpawningForBarrack(building)
		if unitSpawning != nil && unitSpawning.Activated {
			buffer.WriteByte(1) // Indicate active spawning
		} else {
			buffer.WriteByte(0) // Indicate no active spawning
		}
	}

	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

func broadcastBuildingsUpgraded(base *game.Base, buildingIDs []game.ID) {
	message := Message{
		Type: MessageTypeBuildingsUpgraded,
	}

	building := base.Buildings[buildingIDs[0]]

	buffer := new(bytes.Buffer)

	// Determine if the owner is a Player or a NeutralBase and write the relevant data
	if player, ok := base.Owner.(*game.Player); ok {
		buffer.WriteByte(1) // Indicating it's a Player
		buffer.WriteByte(byte(player.ID))
	} else if neutral, ok := base.Owner.(*game.NeutralBase); ok {
		buffer.WriteByte(0) // Indicating it's a NeutralBase
		buffer.WriteByte(byte(neutral.ID))
	}
	buffer.WriteByte(byte(building.Variant))

	// Write all buildingIDs to the buffer
	for _, buildingID := range buildingIDs {
		buffer.WriteByte(byte(buildingID)) // Each buildingID in the payload
	}

	message.Payload = buffer.Bytes()

	broadcastToAll(EncodeMessage(message))
}

func broadcastBuildingsDestroyed(base *game.Base, buildingIDs []game.ID) {
	message := Message{
		Type: MessageTypeBuildingsDestroyed,
	}

	buffer := new(bytes.Buffer)

	// Determine if the owner is a Player or a NeutralBase and write the relevant data
	if player, ok := base.Owner.(*game.Player); ok {
		buffer.WriteByte(1) // Indicating it's a Player
		buffer.WriteByte(byte(player.ID))
	} else if neutral, ok := base.Owner.(*game.NeutralBase); ok {
		buffer.WriteByte(0) // Indicating it's a NeutralBase (unowned)
		buffer.WriteByte(byte(neutral.ID))
	}

	// Write all buildingIDs to the buffer
	for _, buildingID := range buildingIDs {
		buffer.WriteByte(byte(buildingID)) // Each buildingID in the payload
	}

	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

func broadcastBulletSpawn(owner game.Owner, turretID game.ID, bullet *game.Bullet) {
	message := Message{
		Type: MessageTypeSpawnBullet,
	}

	buffer := new(bytes.Buffer)

	// Determine if the owner is a Player or a NeutralBase and write the relevant data
	if player, ok := owner.(*game.Player); ok {
		buffer.WriteByte(1) // Indicating it's a Player
		buffer.WriteByte(byte(player.ID))
	} else if neutral, ok := owner.(*game.NeutralBase); ok {
		buffer.WriteByte(0) // Indicating it's a NeutralBase (unowned)
		buffer.WriteByte(byte(neutral.ID))
	}

	buffer.WriteByte(byte(turretID))
	buffer.WriteByte(byte(bullet.ID))

	binary.Write(buffer, binary.BigEndian, bullet.Position.X)
	binary.Write(buffer, binary.BigEndian, bullet.Position.Y)

	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

func broadcastUnitBulletSpawn(playerID game.ID, unitID game.ID, bullet *game.Bullet) {
	message := Message{
		Type: MessageTypeUnitSpawnBullet,
	}

	buffer := new(bytes.Buffer)
	buffer.WriteByte(byte(playerID))
	buffer.WriteByte(byte(unitID))
	buffer.WriteByte(byte(bullet.ID))

	binary.Write(buffer, binary.BigEndian, bullet.Position.X)
	binary.Write(buffer, binary.BigEndian, bullet.Position.Y)

	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

func broadcastBulletRemove(owner game.Owner, bulletID game.ID) {
	message := Message{
		Type: MessageTypeRemoveBullet,
	}

	buffer := new(bytes.Buffer)

	// Determine if the owner is a Player or a NeutralBase and write the relevant data
	if player, ok := owner.(*game.Player); ok {
		buffer.WriteByte(1) // Indicating it's a Player
		buffer.WriteByte(byte(player.ID))
	} else if neutral, ok := owner.(*game.NeutralBase); ok {
		buffer.WriteByte(0) // Indicating it's a NeutralBase (unowned)
		buffer.WriteByte(byte(neutral.ID))
	}

	buffer.WriteByte(byte(bulletID))

	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

func broadcastBulletPositionUpdate(owner game.Owner, bullet *game.Bullet) {
	message := Message{
		Type: MessageTypeBulletPositionUpdate,
	}

	buffer := new(bytes.Buffer)

	// Determine if the owner is a Player or a NeutralBase and write the relevant data
	if player, ok := owner.(*game.Player); ok {
		buffer.WriteByte(1) // Indicating it's a Player
		buffer.WriteByte(byte(player.ID))
	} else if neutral, ok := owner.(*game.NeutralBase); ok {
		buffer.WriteByte(0) // Indicating it's a NeutralBase (unowned)
		buffer.WriteByte(byte(neutral.ID))
	}

	buffer.WriteByte(byte(bullet.ID))

	binary.Write(buffer, binary.BigEndian, bullet.Position.X)
	binary.Write(buffer, binary.BigEndian, bullet.Position.Y)

	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

func broadcastBarracksActivationUpdate(owner game.Owner, unitSpawning *game.UnitSpawning) {
	message := Message{
		Type: MessageTypeBarrackActivationUpdate,
	}

	buffer := new(bytes.Buffer)

	// Determine if the owner is a Player or a NeutralBase and write the relevant data
	if player, ok := owner.(*game.Player); ok {
		buffer.WriteByte(1) // Indicating it's a Player
		buffer.WriteByte(byte(player.ID))
	} else if neutral, ok := owner.(*game.NeutralBase); ok {
		buffer.WriteByte(0) // Indicating it's a NeutralBase (unowned)
		buffer.WriteByte(byte(neutral.ID))
	}

	buffer.WriteByte(byte(unitSpawning.Barracks.ID))
	if unitSpawning.Activated {
		buffer.WriteByte(1)
	} else {
		buffer.WriteByte(0)
	}

	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

func broadcastUnitSpawn(owner game.Owner, barracksID game.ID, unit *game.Unit) {
	message := Message{
		Type: MessageTypeSpawnUnit,
	}

	buffer := new(bytes.Buffer)

	// Determine if the owner is a Player or a NeutralBase and write the relevant data
	if player, ok := owner.(*game.Player); ok {
		buffer.WriteByte(1) // Indicating it's a Player
		buffer.WriteByte(byte(player.ID))
	} else if neutral, ok := owner.(*game.NeutralBase); ok {
		buffer.WriteByte(0) // Indicating it's a NeutralBase (unowned)
		buffer.WriteByte(byte(neutral.ID))
	}

	buffer.WriteByte(byte(barracksID))
	buffer.WriteByte(byte(unit.ID))
	buffer.WriteByte(byte(unit.Type))
	buffer.WriteByte(byte(unit.Variant))

	binary.Write(buffer, binary.BigEndian, unit.TargetPosition.X)
	binary.Write(buffer, binary.BigEndian, unit.TargetPosition.Y)

	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

func broadcastUnitPositionUpdates(playerID game.ID, units []*game.Unit) {
	message := Message{
		Type: MessageTypeUnitPositionUpdates,
	}

	buffer := new(bytes.Buffer)
	buffer.WriteByte(byte(playerID))
	// Encode unit data into the buffer
	for _, unit := range units {
		buffer.WriteByte(byte(unit.ID))
		binary.Write(buffer, binary.BigEndian, unit.Position.X)
		binary.Write(buffer, binary.BigEndian, unit.Position.Y)
	}

	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

// ! Like a resync for camera movement (not used yet)
func SendUnitPositionUpdate(conn *websocket.Conn, player *game.Player, unit *game.Unit) {
	message := Message{
		Type: MessageTypeUnitPositionUpdates,
	}

	buffer := new(bytes.Buffer)
	buffer.WriteByte(byte(player.ID))
	buffer.WriteByte(byte(unit.ID))
	binary.Write(buffer, binary.BigEndian, unit.Position.X)
	binary.Write(buffer, binary.BigEndian, unit.Position.Y)

	message.Payload = buffer.Bytes()

	var toRemove []*websocket.Conn

	if !player.IsMarkedForRemoval() {
		// Get the camera bounds for the player
		bounds := player.Camera.Bounds

		// Check if the player's camera bounds contain the unit's position
		if int(unit.Position.X) >= bounds.Left && int(unit.Position.X) <= bounds.Right &&
			int(unit.Position.Y) >= bounds.Top && int(unit.Position.Y) <= bounds.Bottom {
			sendToClient(conn, EncodeMessage(message), &toRemove)
		}
	}

	for _, conn := range toRemove {
		removePlayerByConnection(conn)
	}
}

func sendInitialBulletStates(conn *websocket.Conn, bullets []*game.Bullet) {
	message := Message{
		Type: MessageTypeInitialBulletStates,
	}

	buffer := new(bytes.Buffer)
	for _, bullet := range bullets {
		// Identify the owner type and write the relevant identifier byte
		if player, ok := bullet.Owner.(*game.Player); ok {
			buffer.WriteByte(1) // Indicate it's a Player
			buffer.WriteByte(byte(player.ID))
		} else if neutral, ok := bullet.Owner.(*game.NeutralBase); ok {
			buffer.WriteByte(0) // Indicate it's a NeutralBase
			buffer.WriteByte(byte(neutral.ID))
		}

		// Write the bullet's ID and position data
		buffer.WriteByte(byte(bullet.ID))
		binary.Write(buffer, binary.BigEndian, bullet.Position.X)
		binary.Write(buffer, binary.BigEndian, bullet.Position.Y)
	}

	message.Payload = buffer.Bytes()

	var toRemove []*websocket.Conn

	sendToClient(conn, EncodeMessage(message), &toRemove)

	for _, conn := range toRemove {
		removePlayerByConnection(conn)
	}
}

func BroadcastUnitsRotationUpdate(playerID game.ID, units []*game.Unit) {
	message := Message{
		Type: MessageUnitsRotationUpdate,
	}

	buffer := new(bytes.Buffer)
	buffer.WriteByte(byte(playerID))

	for _, unit := range units {
		buffer.WriteByte(byte(unit.ID))
		binary.Write(buffer, binary.BigEndian, unit.TargetRotation.Rotation)
	}
	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

func broadcastTurretRotationUpdate(owner game.Owner, turret *game.Building, target game.PositionFloat) {
	message := Message{
		Type: MessageTypeTurretRotationUpdate,
	}

	// Calculate the direction vector from the turret to the target
	turretPosition := turret.Position
	directionX := target.X - turretPosition.X
	directionY := target.Y - turretPosition.Y
	// Calculate the angle in radians
	angle := math.Atan2(float64(directionY), float64(directionX))

	buffer := new(bytes.Buffer)

	// Determine if the owner is a Player or a NeutralBase and write the relevant data
	if player, ok := owner.(*game.Player); ok {
		buffer.WriteByte(1) // Indicating it's a Player
		buffer.WriteByte(byte(player.ID))
	} else if neutral, ok := owner.(*game.NeutralBase); ok {
		buffer.WriteByte(0) // Indicating it's a NeutralBase
		buffer.WriteByte(byte(neutral.ID))
	}

	buffer.WriteByte(byte(turret.ID))
	binary.Write(buffer, binary.BigEndian, float32(angle))
	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

func SendUnitsRotationUpdate(conn *websocket.Conn, playerID game.ID, units []*game.Unit) {
	message := Message{
		Type: MessageUnitsRotationUpdate,
	}

	buffer := new(bytes.Buffer)
	buffer.WriteByte(byte(playerID))

	for _, unit := range units {
		buffer.WriteByte(byte(unit.ID))
		binary.Write(buffer, binary.BigEndian, unit.TargetRotation.Rotation)
	}

	message.Payload = buffer.Bytes()

	// Send the message to the specified connection
	var toRemove []*websocket.Conn
	sendToClient(conn, EncodeMessage(message), &toRemove)

	// Handle any connections that need to be removed
	for _, conn := range toRemove {
		removePlayerByConnection(conn)
	}
}

func broadcastRemoveUnit(playerID game.ID, unitID game.ID) {
	message := Message{
		Type: MessageTypeRemoveUnit,
	}
	buffer := new(bytes.Buffer)
	buffer.WriteByte(byte(playerID))
	buffer.WriteByte(byte(unitID))
	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

func broadcastRemoveSpawnProtection(playerID game.ID) {
	message := Message{
		Type: MessageTypeRemoveSpawnProtection,
	}
	buffer := new(bytes.Buffer)
	buffer.WriteByte(byte(playerID))
	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

func broadcastWildPortalsUpdate(portals []game.WildPortalSnapshot) {
	message := Message{
		Type: MessageTypeWildPortalsUpdate,
	}

	buffer := new(bytes.Buffer)
	PrepareWildPortalData(buffer, portals)
	message.Payload = buffer.Bytes()

	broadcastToAll(EncodeMessage(message))
}

func broadcastLeaderboardUpdate(changes *[]game.LeaderboardEntry) {
	message := Message{
		Type: MessageTypeLeaderboardUpdate,
	}

	buffer := new(bytes.Buffer)

	// Encode the number of changed leaderboard entries
	binary.Write(buffer, binary.BigEndian, uint8(len(*changes)))

	// Encode each changed leaderboard entry
	for _, entry := range *changes {
		buffer.WriteByte(byte(entry.Player.ID))

		// Encode the score
		EncodeScore(buffer, entry.Score)
	}

	message.Payload = buffer.Bytes()
	broadcastToAll(EncodeMessage(message))
}

func broadcastLeaderboardUpdateToAllExcept(changes *[]game.LeaderboardEntry, playerID game.ID) {
	message := Message{
		Type: MessageTypeLeaderboardUpdate,
	}
	buffer := new(bytes.Buffer)

	// Encode the number of changed leaderboard entries
	binary.Write(buffer, binary.BigEndian, uint8(len(*changes)))

	// Encode each changed leaderboard entry
	for _, entry := range *changes {
		buffer.WriteByte(byte(entry.Player.ID))

		// Encode the score
		EncodeScore(buffer, entry.Score)
	}

	message.Payload = buffer.Bytes()
	broadcastToAllExcept(EncodeMessage(message), playerID)
}

func sendInitialLeaderboardUpdate(player *game.Player) {
	message := Message{
		Type: MessageTypeLeaderboardUpdate,
	}

	buffer := new(bytes.Buffer)

	// Encode the number of leaderboard entries
	leaderboardEntries := game.State.Leaderboard.GetEntries()
	buffer.WriteByte(byte(len(leaderboardEntries)))

	// Encode each leaderboard entry
	for _, entry := range leaderboardEntries {
		buffer.WriteByte(byte(entry.Player.ID))

		// Encode the score
		EncodeScore(buffer, entry.Score)
	}
	message.Payload = buffer.Bytes()

	var toRemove []*websocket.Conn

	if !player.IsMarkedForRemoval() {
		sendToClient(player.Conn, EncodeMessage(message), &toRemove)
	}

	for _, conn := range toRemove {
		removePlayerByConnection(conn)
	}
}

func sendGameNotReadyError(conn *websocket.Conn) {
	message := Message{
		Type: MessageTypeGameNotReady,
	}
	sendToClient(conn, EncodeMessage(message), nil)
}

func sendError(conn *websocket.Conn) {
	message := Message{
		Type: MessageTypeError,
	}
	sendToClient(conn, EncodeMessage(message), nil)
}

func sendRelocateCooldownError(conn *websocket.Conn, remainingSeconds uint16) {
	message := Message{
		Type: MessageTypeError,
	}

	buffer := new(bytes.Buffer)
	buffer.WriteByte(ErrorCodeRelocateCooldown)
	binary.Write(buffer, binary.BigEndian, remainingSeconds)
	message.Payload = buffer.Bytes()

	sendToClient(conn, EncodeMessage(message), nil)
}

func SendServerVersion(conn *websocket.Conn, version byte) {
	message := Message{
		Type: MessageTypeServerVersion,
	}
	buffer := new(bytes.Buffer)
	buffer.WriteByte(version)

	message.Payload = buffer.Bytes()

	sendToClient(conn, EncodeMessage(message), nil)
}

func sendGameState(player *game.Player, excludePlayer *game.ID) {
	message := Message{
		Type: MessageTypeGameState,
	}

	buffer := new(bytes.Buffer)
	game.State.RLock()
	err := PreparePlayerData(buffer, game.State.Players, excludePlayer)
	if err != nil {
		log.Printf("failed to prepare player data: %v", err)
		game.State.RUnlock()
		return
	}
	PrepareNeutralBaseData(buffer, game.State.NeutralBases)
	PrepareBushData(buffer, game.State.Bushes)
	PrepareRockData(buffer, game.State.Rocks)
	wildPortals := make([]game.WildPortalSnapshot, 0, len(game.State.WildPortals))
	for _, portal := range game.State.WildPortals {
		if portal == nil {
			continue
		}
		wildPortals = append(wildPortals, game.WildPortalSnapshot{
			ID:       portal.ID,
			Position: portal.Position,
		})
	}
	PrepareWildPortalData(buffer, wildPortals)

	game.State.RUnlock()
	message.Payload = buffer.Bytes()

	var toRemove []*websocket.Conn

	if !player.IsMarkedForRemoval() {
		sendToClient(player.Conn, EncodeMessage(message), &toRemove)
	}

	for _, conn := range toRemove {
		removePlayerByConnection(conn)
	}
}

func sendInitialPlayerData(player *game.Player) {

	message := Message{
		Type: MessageTypeInitalPlayerData,
	}

	buffer := new(bytes.Buffer)
	buffer.WriteByte(byte(player.ID))
	colorBytes := player.Base.Color
	buffer.Write(colorBytes)
	buffer.WriteByte(byte(player.SkinID))
	binary.Write(buffer, binary.BigEndian, player.Base.Position.X)
	binary.Write(buffer, binary.BigEndian, player.Base.Position.Y)
	buffer.Write(player.Name[:])

	message.Payload = buffer.Bytes()

	var toRemove []*websocket.Conn

	if !player.IsMarkedForRemoval() {
		sendToClient(player.Conn, EncodeMessage(message), &toRemove)
	}

	for _, conn := range toRemove {
		removePlayerByConnection(conn)
	}
}

func sendResourceUpdate(player *game.Player) {
	message := Message{
		Type: MessageTypeResourceUpdate,
	}

	buffer := new(bytes.Buffer)
	binary.Write(buffer, binary.BigEndian, player.Resources.Power.Current)
	binary.Write(buffer, binary.BigEndian, player.Generating.Power)
	message.Payload = buffer.Bytes()

	var toRemove []*websocket.Conn

	if !player.IsMarkedForRemoval() {
		sendToClient(player.Conn, EncodeMessage(message), &toRemove)
	}

	for _, conn := range toRemove {
		removePlayerByConnection(conn)
	}
}

func SendBuildingPlacementFailed(player *game.Player, buildingType game.BuildingType, reason byte, cooldownSeconds uint16) {
	message := Message{
		Type: MessageTypeBuildingPlacementFailed,
	}

	buffer := new(bytes.Buffer)
	buffer.WriteByte(byte(buildingType))
	buffer.WriteByte(reason)
	binary.Write(buffer, binary.BigEndian, cooldownSeconds)
	message.Payload = buffer.Bytes()

	var toRemove []*websocket.Conn

	if !player.IsMarkedForRemoval() {
		sendToClient(player.Conn, EncodeMessage(message), &toRemove)
	}

	for _, conn := range toRemove {
		removePlayerByConnection(conn)
	}
}

func SendPlayerInactiveWarning(player *game.Player) {
	message := Message{
		Type: MessageTypePlayerInactiveWarning,
	}
	// No payload needed
	sendToClient(player.Conn, EncodeMessage(message), nil)
}

func SendPlayerActive(player *game.Player) {
	message := Message{
		Type: MessageTypePlayerActive,
	}
	// No payload needed
	sendToClient(player.Conn, EncodeMessage(message), nil)
}
