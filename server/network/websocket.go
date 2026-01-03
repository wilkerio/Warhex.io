package network

import (
	"log"
	"net/http"
	"server/game"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/time/rate"
)

var SERVER_VERSION byte = 6
var SERVER_REBOOTING bool = false

var (
	upgrader = websocket.Upgrader{
		ReadBufferSize:  8192,
		WriteBufferSize: 16192,
	}
	limiter = rate.NewLimiter(rate.Every(time.Second), 5) // Global rate limiter for the server
)

func init() {
	workerPool = NewWorkerPool(4)
	// Start listening for events from the game package
	go listenForEvents()
}

var workerPool *WorkerPool

func handleEvent(event game.Event) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Recovered from panic in handleEvent: %v", r)
		}
	}()
	// Handle the event based on its type
	switch event.Type {
	case game.ResourceUpdate:
		player := event.Payload.(*game.Player)
		sendResourceUpdate(player)
	case game.UnitSpawn:
		e := event.Payload.(*game.UnitSpawnEvent)
		unit := e.Unit
		barracks := e.Barracks
		broadcastUnitSpawn(barracks.Owner, barracks.ID, unit)
	case game.UnitPositionUpdates:
		e := event.Payload.(*game.UnitPositionUpdatesEvent)
		player := e.Player
		units := e.Units
		broadcastUnitPositionUpdates(player.ID, units)
	case game.UnitsRotationUpdate:
		e := event.Payload.(*game.UnitsTargetPointUpdateEvent)
		player := e.Player
		units := e.Units
		BroadcastUnitsRotationUpdate(player.ID, units)
	case game.UnitRemove:
		e := event.Payload.(*game.UnitRemoveEvent)
		player := e.Player
		unitID := e.UnitID
		broadcastRemoveUnit(player.ID, unitID)
	case game.TurretRotationUpdate:
		e := event.Payload.(*game.TurretRotationUpdateEvent)
		owner := e.Owner
		turret := e.Turret
		targetPosition := e.TargetPosition
		broadcastTurretRotationUpdate(owner, turret, targetPosition)
	case game.BuildingRemoved:
		/*
			Only gets called when a builing got destroyed trough an enemy,
			so sending destroyed buildings one by one here is still okay...

			If nothing else todo, try packaging all destroyed buildings in one package.
		*/
		e := event.Payload.(*game.BuildingRemovedEvent)
		base := e.Base
		building := e.Building
		broadcastBuildingsDestroyed(base, []game.ID{building.ID})
	case game.BuildingPlaced:
		e := event.Payload.(*game.BuildingPlacedEvent)
		base := e.Base
		building := e.Building
		broadcastBuildingPlaced(base, building.ID)
	case game.BaseHealthUpdate:
		base := event.Payload.(*game.Base)
		broadcastBaseHealthUpdate(base)
	case game.UnitHealthUpdate:
		e := event.Payload.(*game.UnitHealthUpdateEvent)
		player := e.Player
		unit := e.Unit
		broadcastUnitHealthUpdate(player.ID, unit)
	case game.PlayerKilled:
		e := event.Payload.(*game.PlayerKilledEvent)
		player := e.Player
		killer := e.Killer

		sendKilledNotification(player, killer.ID)
		broadcastPlayerLeft(player.ID)

		userData, userOk := GetUserDataByConn(player.Conn)
		_, playerScore, kills, playtime, _ := game.RemovePlayer(player.Conn)

		if userOk {
			if userData.Discord.ID != "" {
				go func() {
					newUnlockedSkins, ok := UpdateUserStats(userData.Discord.ID, playerScore, kills, playtime)
					if ok {
						AddUnlockedSkinsLocally(player.Conn, newUnlockedSkins)
					}
				}()
				RemovePlayingDiscordAccount(userData.Discord.ID)
			}
		}

		ClearFingerprintForConn(player.Conn)

		removePlayerMessageState(player.ID)
	case game.Kick:
		e := event.Payload.(*game.KickEvent)
		player := e.Player
		reason := e.Reason

		sendKickNotification(player, reason)
		broadcastPlayerLeft(player.ID)

		userData, userOk := GetUserDataByConn(player.Conn)
		_, playerScore, kills, playtime, _ := game.RemovePlayer(player.Conn)

		if userOk {
			if userData.Discord.ID != "" {
				go func() {
					newUnlockedSkins, ok := UpdateUserStats(userData.Discord.ID, playerScore, kills, playtime)
					if ok {
						AddUnlockedSkinsLocally(player.Conn, newUnlockedSkins)
					}
				}()

				RemovePlayingDiscordAccount(userData.Discord.ID)
			}
		}

		ClearFingerprintForConn(player.Conn)

		removePlayerMessageState(player.ID)
	case game.PlayerInactiveWarning:
		e := event.Payload.(*game.PlayerInactiveWarningEvent)
		player := e.Player
		SendPlayerInactiveWarning(player)
	case game.UnitBulletSpawn:
		e := event.Payload.(*game.UnitBulletSpawnEvent)
		player := e.Player
		bullet := e.Bullet
		unit := e.Unit
		broadcastUnitBulletSpawn(player.ID, unit.ID, bullet)
	case game.BulletSpawn:
		e := event.Payload.(*game.BulletSpawnEvent)
		owner := e.Owner
		bullet := e.Bullet
		turret := e.Turret
		broadcastBulletSpawn(owner, turret.ID, bullet)
	case game.BulletRemove:
		e := event.Payload.(*game.BulletRemoveEvent)
		owner := e.Owner
		bulletID := e.BulletID
		broadcastBulletRemove(owner, bulletID)
	case game.BulletPositionUpdate:
		e := event.Payload.(*game.BulletPositionUpdateEvent)
		owner := e.Owner
		bullet := e.Bullet
		broadcastBulletPositionUpdate(owner, bullet)
	case game.LeaderboardUpdate:
		e := event.Payload.(*game.LeaderboardUpdateEvent)
		changes := e.Changes
		broadcastLeaderboardUpdate(changes)
	case game.RemoveSpawnProtection:
		e := event.Payload.(*game.RemoveSpawnProtectionEvent)
		player := e.Player
		broadcastRemoveSpawnProtection(player.ID)
	case game.NeutralBaseCaptured:
		e := event.Payload.(*game.NeutralBaseCapturedEvent)
		neutral := e.NeutralBase
		broadcastNeutralBaseCaptured(neutral)
	}
}

func listenForEvents() {
	listener := make(chan game.Event, 10000)
	game.AddListener(listener)

	for {
		select {
		case event := <-listener:
			workerPool.JobQueue <- event
		}
	}
}

func WsEndpoint(w http.ResponseWriter, r *http.Request, userData UserData) {
	// Apply rate limiting
	if !limiter.Allow() {
		log.Println("Rate limit exceeded for", r.RemoteAddr)
		http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
		return
	}

	upgrader.CheckOrigin = func(r *http.Request) bool { return true }

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade error:", err)
		return
	}

	defer conn.Close()

	StoreUserData(conn, userData)

	onConnect(conn)

	for {
		_, p, err := conn.ReadMessage()
		if err != nil {
			// Handle WebSocket closure or error
			if websocket.IsCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("Client %s disconnected normally", conn.RemoteAddr().String())
			} else {
				log.Printf("Read error from client %s: %v", conn.RemoteAddr().String(), err)
			}
			removePlayerByConnection(conn)
			break
		}
		handleMessage(conn, p)
	}
}

func onConnect(conn *websocket.Conn) {
	SendServerVersion(conn, SERVER_VERSION)
}

func removePlayerByConnection(conn *websocket.Conn) {

	userData, userOk := GetUserDataByConn(conn)

	playerID, playerScore, kills, playtime, ok := game.RemovePlayer(conn)

	if ok {
		broadcastPlayerLeft(playerID)
		removePlayerMessageState(playerID)
		// Update user stats in a non-blocking way if a Discord ID exists
		if userOk && userData.Discord.ID != "" {
			go UpdateUserStats(userData.Discord.ID, playerScore, kills, playtime)
			RemovePlayingDiscordAccount(userData.Discord.ID)
		}
	} else {
		log.Println("Client disconnected but was not an player in the game.")
	}

	if userOk {
		RemoveUserConnection(conn)
	}
}

func CloseConnection(conn *websocket.Conn) {
	if conn == nil {
		return
	}

	// Attempt to close the connection
	if err := conn.Close(); err != nil {
		log.Printf("Error closing connection: %v", err)
	}

	// Remove the player after closing the connection
	removePlayerByConnection(conn)
}
