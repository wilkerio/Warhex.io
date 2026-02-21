package network

// Define error codes for communication errors
const (
	ErrorCodeServerFull       byte = 0
	ErrorCodeRelocateCooldown byte = 1
)

// Define message types for communication between client and server
const (
	MessageTypeJoin                   byte = 0 // Player joining message (PlayerID: 1 byte, Color: 1 byte)
	MessageTypeClientPlaceBuilding    byte = 1 // Place building message
	MessageTypeClientUpgradeBuildings byte = 2 // Upgrade building message
	MessageTypeClientDestroyBuildings byte = 3 // Destroy building message
	MessageTypeClientMoveUnits        byte = 4
	MessageTypePlayerJoined           byte = 5  // Player joined message (PlayerID: 1 byte, Color: 1 byte, Position: 4 bytes, PlayerName: variable bytes)
	MessageTypePlayerLeft             byte = 6  // Player left message (PlayerID: 1 byte)
	MessageTypeBaseHealthUpdate       byte = 7  // Player health message (PlayerID: 1 byte, Health: 1 byte)
	MessageTypeBuildingPlaced         byte = 8  // Building placed message (PlayerID: 1 byte, BuildingType: 1 byte, Position: 4 bytes)
	MessageTypeBuildingsDestroyed     byte = 9  // Building destroyed message (BuildingType: 1 byte, Position: 4 bytes)
	MessageTypeBuildingsUpgraded      byte = 10 // Building upgraded message (BuildingType: 1 byte, Position: 4 bytes)
	MessageTypeGameState              byte = 11 // Game state message (PlayerCount: 1 byte, PlayerData: variable bytes, NeutralBaseCount: 1 byte, NeutralBaseData: variable)
	MessageTypeInitalPlayerData       byte = 12 // Initial player data (Position: 4 bytes)
	MessageTypeResourceUpdate         byte = 13
	MessageTypeSpawnUnit              byte = 14
	MessageTypeUnitPositionUpdates    byte = 15
	MessageTypeRemoveUnit             byte = 16
	MessageTypeKilled                 byte = 17 // Player killed notification (sent only to the killed player)
	MessageTypeSpawnBullet            byte = 18
	MessageTypeBulletPositionUpdate   byte = 19
	MessageTypeRemoveBullet           byte = 20
	MessageTypeLeaderboardUpdate      byte = 21
	MessageTypeRemoveSpawnProtection  byte = 22
	MessageTypeKickNotification       byte = 23
	MessageTypeClientNewChatMessage   byte = 24
	MessageTypeChatMessage            byte = 25
	MessageTypeUnitHealthUpdate       byte = 26
	//? 27 is currently not used
	MessageTypeUnitSpawnBullet          byte = 28
	MessageTypeBuildingPlacementFailed  byte = 29
	MessageUnitsRotationUpdate          byte = 30
	MessageTypeClientCameraUpdate       byte = 31 //! Not used yet but already receiving updates from client
	MessageTypeInitialBulletStates      byte = 32
	MessageTypeClientRequestResync      byte = 33
	MessageTypeTurretRotationUpdate     byte = 34
	MessageTypeNeutralBaseCaptured      byte = 35
	MessageTypeClientToggleUnitSpawning byte = 36
	MessageTypeBarrackActivationUpdate  byte = 37
	MessageTypeClientBuyRepair          byte = 38
	MessageTypeClientBuyCommander       byte = 39
	MessageTypeClientRequestSkinData    byte = 40
	MessageTypeSkinData                 byte = 41
	MessageTypePlayerInactiveWarning    byte = 42
	MessageTypePlayerActive             byte = 43
	MessageTypeClientActivity           byte = 44
	MessageTypeToggleGroupUnits         byte = 45
	MessageTypeClientSendX1Challenge    byte = 46
	MessageTypeClientX1ChallengeReply   byte = 47
	MessageTypeX1ChallengeReceived      byte = 48
	MessageTypeX1ChallengeResult        byte = 49
	MessageTypeX1DuelArenaUpdate        byte = 50
	MessageTypeClientBuyRelocateBase    byte = 51
	MessageTypeHeartbeat                byte = 69
	MessageTypeServerVersion            byte = 98
	MessageTypeRebootAlertMessage       byte = 99
	MessageTypeError                    byte = 100 // Error message type (ErrorCode: 1 byte)
	MessageTypeGameNotReady             byte = 101 // Game not ready error
)

// Message represents a communication message.
type Message struct {
	Type    byte
	Payload []byte
}
