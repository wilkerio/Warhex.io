package network

import (
	"log"
	"net/http"
	"os"
	"server/game"
	"strconv"
	"strings"
	"sync"
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
	wsConnectionLimiter = initWsConnectionLimiter()
	connectionAttemptLimiter = initConnectionAttemptLimiter()
)

type connectionAttemptLimiterConfig struct {
	maxAttempts int
	window      time.Duration
}

type connectionAttemptState struct {
	windowStart time.Time
	count       int
}

var connectionAttemptMutex sync.Mutex
var connectionAttemptByIP = make(map[string]*connectionAttemptState)

func initConnectionAttemptLimiter() connectionAttemptLimiterConfig {
	rawAttempts := strings.TrimSpace(os.Getenv("WS_CONNECT_ATTEMPTS_PER_WINDOW"))
	if rawAttempts == "" {
		return connectionAttemptLimiterConfig{}
	}

	attempts, err := strconv.Atoi(rawAttempts)
	if err != nil || attempts <= 0 {
		log.Printf("invalid WS_CONNECT_ATTEMPTS_PER_WINDOW=%q, keeping unlimited", rawAttempts)
		return connectionAttemptLimiterConfig{}
	}

	rawWindow := strings.TrimSpace(os.Getenv("WS_CONNECT_ATTEMPT_WINDOW_SECONDS"))
	windowSeconds := 10
	if rawWindow != "" {
		if parsedWindow, parseErr := strconv.Atoi(rawWindow); parseErr == nil && parsedWindow > 0 {
			windowSeconds = parsedWindow
		}
	}

	return connectionAttemptLimiterConfig{
		maxAttempts: attempts,
		window:      time.Duration(windowSeconds) * time.Second,
	}
}

func allowConnectionAttemptForIP(clientIP string) bool {
	if connectionAttemptLimiter.maxAttempts <= 0 {
		return true
	}
	window := connectionAttemptLimiter.window
	if window <= 0 {
		window = 10 * time.Second
	}

	clientIP = strings.TrimSpace(clientIP)
	if clientIP == "" {
		return true
	}

	now := time.Now()
	connectionAttemptMutex.Lock()
	defer connectionAttemptMutex.Unlock()

	state, exists := connectionAttemptByIP[clientIP]
	if !exists || now.Sub(state.windowStart) >= window {
		connectionAttemptByIP[clientIP] = &connectionAttemptState{windowStart: now, count: 1}
		return true
	}

	if state.count >= connectionAttemptLimiter.maxAttempts {
		return false
	}

	state.count++
	return true
}

func initWsConnectionLimiter() *rate.Limiter {
	// Default is unlimited. Set WS_CONNECT_LIMIT_PER_SEC>0 to enforce a cap.
	rawPerSec := strings.TrimSpace(os.Getenv("WS_CONNECT_LIMIT_PER_SEC"))
	if rawPerSec == "" {
		return nil
	}

	perSec, err := strconv.Atoi(rawPerSec)
	if err != nil || perSec <= 0 {
		log.Printf("invalid WS_CONNECT_LIMIT_PER_SEC=%q, keeping unlimited", rawPerSec)
		return nil
	}

	burst := perSec
	rawBurst := strings.TrimSpace(os.Getenv("WS_CONNECT_LIMIT_BURST"))
	if rawBurst != "" {
		if parsedBurst, parseErr := strconv.Atoi(rawBurst); parseErr == nil && parsedBurst > 0 {
			burst = parsedBurst
		}
	}

	return rate.NewLimiter(rate.Limit(perSec), burst)
}

func init() {
	workerPool = NewWorkerPool(4)
	initSessionLockStore()
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
		broadcastUnitHealthUpdate(e.PlayerID, e.UnitID, e.Health)
	case game.PlayerJoined:
		e := event.Payload.(*game.PlayerJoinedEvent)
		if e.Player != nil {
			broadcastPlayerJoined(e.Player)
		}
	case game.PlayerLeft:
		e := event.Payload.(*game.PlayerLeftEvent)
		broadcastPlayerLeft(e.PlayerID)
		removePlayerMessageState(e.PlayerID)
	case game.ChatMessage:
		e := event.Payload.(*game.ChatMessageEvent)
		game.RecordBotObservedChatMessage(e.PlayerID, string(e.Text))
		broadcastChatMessage(e.PlayerID, e.Text)
	case game.BuildingsUpgraded:
		e := event.Payload.(*game.BuildingsUpgradedEvent)
		broadcastBuildingsUpgraded(e.Base, e.BuildingIDs)
	case game.CommanderSpawn:
		e := event.Payload.(*game.CommanderSpawnEvent)
		broadcastUnitSpawn(e.Owner, 255, e.Unit)
	case game.DuelStarted:
		e := event.Payload.(*game.DuelStartedEvent)
		broadcastX1DuelArenaUpdate(e.PlayerAID, e.PlayerBID, e.Arena)
	case game.PlayerKilled:
		e := event.Payload.(*game.PlayerKilledEvent)
		player := e.Player
		killer := e.Killer
		game.RecordBotObservedElimination(killer, player)
		game.RecordBotMatchOutcome(player, killer)
		killerID := game.ID(0)
		if killer != nil {
			killerID = killer.ID
		}

		if player.Conn != nil {
			sendKilledNotification(player, killerID)
		}
		broadcastPlayerLeft(player.ID)

		if player.Conn == nil {
			game.RememberBotNameForCooldown(player)
			game.ClearBotRuntimeIntent(player.ID)
			game.RemovePlayerByID(player.ID)
			removePlayerMessageState(player.ID)
			break
		}

		userData, userOk := GetUserDataByConn(player.Conn)
		_, playerScore, kills, playtime, _ := game.RemovePlayer(player.Conn)

		if userOk {
			progressUserID := userData.ProgressUserID()
			if progressUserID != "" {
				go func() {
					newUnlockedSkins, ok := UpdateUserStats(progressUserID, playerScore, kills, playtime)
					if ok {
						AddUnlockedSkinsLocally(player.Conn, newUnlockedSkins)
					}
				}()
				RemovePlayingProgressAccount(progressUserID)
			}
			if userData.Discord.ID != "" {
				RemovePlayingDiscordAccount(userData.Discord.ID)
			}
		}

		ClearFingerprintForConn(player.Conn)
		releaseDBSessionLockForConn(player.Conn)

		removePlayerMessageState(player.ID)
	case game.Kick:
		e := event.Payload.(*game.KickEvent)
		player := e.Player
		reason := e.Reason

		if player.Conn != nil {
			sendKickNotification(player, reason)
		}
		broadcastPlayerLeft(player.ID)

		if player.Conn == nil {
			game.RememberBotNameForCooldown(player)
			game.ClearBotRuntimeIntent(player.ID)
			game.RemovePlayerByID(player.ID)
			removePlayerMessageState(player.ID)
			break
		}

		userData, userOk := GetUserDataByConn(player.Conn)
		_, playerScore, kills, playtime, _ := game.RemovePlayer(player.Conn)

		if userOk {
			progressUserID := userData.ProgressUserID()
			if progressUserID != "" {
				go func() {
					newUnlockedSkins, ok := UpdateUserStats(progressUserID, playerScore, kills, playtime)
					if ok {
						AddUnlockedSkinsLocally(player.Conn, newUnlockedSkins)
					}
				}()
				RemovePlayingProgressAccount(progressUserID)
			}
			if userData.Discord.ID != "" {
				RemovePlayingDiscordAccount(userData.Discord.ID)
			}
		}

		ClearFingerprintForConn(player.Conn)
		releaseDBSessionLockForConn(player.Conn)

		removePlayerMessageState(player.ID)
	case game.PlayerInactiveWarning:
		e := event.Payload.(*game.PlayerInactiveWarningEvent)
		player := e.Player
		SendPlayerInactiveWarning(player)
	case game.WildPortalsUpdate:
		e := event.Payload.(*game.WildPortalsUpdateEvent)
		broadcastWildPortalsUpdate(e.Portals)
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
	if wsConnectionLimiter != nil && !wsConnectionLimiter.Allow() {
		log.Println("Rate limit exceeded for", r.RemoteAddr)
		http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
		return
	}
	if !allowConnectionAttemptForIP(userData.ClientIP) {
		log.Printf("WS handshake attempt limit exceeded for %s", userData.ClientIP)
		http.Error(w, "Connection attempts limited", http.StatusTooManyRequests)
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
		// Update user stats in a non-blocking way if an authenticated user ID exists.
		if userOk {
			progressUserID := userData.ProgressUserID()
			if progressUserID != "" {
				go UpdateUserStats(progressUserID, playerScore, kills, playtime)
				RemovePlayingProgressAccount(progressUserID)
			}
			if userData.Discord.ID != "" {
				RemovePlayingDiscordAccount(userData.Discord.ID)
			}
		}
	}

	releaseDBSessionLockForConn(conn)

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
