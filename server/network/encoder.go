package network

import (
	"bytes"
	"encoding/binary"
	"log"
	"server/game"
)

// EncodeMessage encodes a message into a binary representation.
func EncodeMessage(msg Message) []byte {
	buffer := new(bytes.Buffer)

	// Write the message type to the buffer
	if err := binary.Write(buffer, binary.BigEndian, msg.Type); err != nil {
		log.Println("encode:", err)
		return nil
	}

	// Write the payload to the buffer
	if _, err := buffer.Write(msg.Payload); err != nil {
		log.Println("encode:", err)
		return nil
	}

	return buffer.Bytes()
}

// PreparePlayerData prepares player data for transmission.
func PreparePlayerData(buffer *bytes.Buffer, players map[game.ID]*game.Player, excludePlayerID *game.ID) error {
	numPlayers := len(players)

	// If we are excluding a player, reduce the count by 1
	if excludePlayerID != nil {
		numPlayers--
	}

	buffer.WriteByte(byte(numPlayers))

	for _, otherPlayer := range players {
		// If excludePlayerID is not nil, skip the player with that ID
		if excludePlayerID != nil && otherPlayer.ID == *excludePlayerID {
			continue
		}

		if err := writePlayerData(buffer, otherPlayer); err != nil {
			return err
		}
	}
	return nil
}

// PrepareNeutralBaseData prepares neutral base data for transmission.
func PrepareNeutralBaseData(buffer *bytes.Buffer, neutralBases []*game.NeutralBase) {
	buffer.WriteByte(byte(len(neutralBases))) // Write number of neutral bases

	for _, neutral := range neutralBases {
		// Write neutral base data
		buffer.WriteByte(byte(neutral.ID))
		if neutral.CapturedBy != nil {
			buffer.WriteByte(byte(neutral.CapturedBy.ID)) // Write capturing player ID
		} else {
			buffer.WriteByte(255) // Write 255 if CapturedBy is nil
		}
		writeBasePosition(buffer, neutral.Base.GetPosition())

		// Write current health of the base
		binary.Write(buffer, binary.BigEndian, neutral.Base.Health.Get())

		// Write buildings data
		buffer.WriteByte(byte(len(neutral.Base.Buildings))) // Write number of buildings
		for _, building := range neutral.Base.Buildings {
			writeBuildingData(buffer, building, neutral.CapturedBy)
		}
	}
}

// PrepareBushData prepares bush positions for transmission.
func PrepareBushData(buffer *bytes.Buffer, bushes []game.PositionInt) {
	buffer.WriteByte(byte(len(bushes))) // Write number of bushes

	for _, bush := range bushes {
		writeBasePosition(buffer, bush)
	}
}

func PrepareRockData(buffer *bytes.Buffer, rocks []game.Rock) {
	buffer.WriteByte(byte(len(rocks))) // Write number of rocks

	// Iterate through each rock and write its data
	for _, rock := range rocks {
		// Write the position (center of the polygon)
		writeBasePosition(buffer, game.FloatToInt(rock.Polygon.Center)) 

		// Write the size (random size between 40 and 80)
		buffer.WriteByte(byte(rock.Size)) // Write the size (since it is an integer between 40 and 80)

		// Write the rotation
		binary.Write(buffer, binary.BigEndian, float32(rock.Polygon.Rotation))
	}
}

func PrepareWildPortalData(buffer *bytes.Buffer, portals []game.WildPortalSnapshot) {
	buffer.WriteByte(byte(len(portals)))
	for _, portal := range portals {
		buffer.WriteByte(byte(portal.ID))
		writePosition(buffer, portal.Position)
	}
}

func writePlayerData(buffer *bytes.Buffer, player *game.Player) error {
	// Write player ID
	buffer.WriteByte(byte(player.ID))

	// Write spawn protection status
	if player.HasProtection() {
		buffer.WriteByte(byte(1))
	} else {
		buffer.WriteByte(byte(0))
	}

	// Write current health of the base
	binary.Write(buffer, binary.BigEndian, player.Base.Health.Get())

	// Write color of the base
	colorBytes := player.Base.Color
	buffer.Write(colorBytes)

	buffer.WriteByte(byte(player.SkinID))

	// Write base position
	writeBasePosition(buffer, player.Base.GetPosition())

	// Write player name (fixed-size array)
	buffer.Write(player.Name[:]) // This writes 12 bytes, regardless of name length

	// Write the number of buildings for the player
	numBuildings := len(player.Base.Buildings)
	buffer.WriteByte(byte(numBuildings))

	// Write each building's data
	for _, building := range player.Base.Buildings {
		if err := writeBuildingData(buffer, building, player); err != nil {
			return err
		}
	}

	// Write the number of units for the player
	numUnits := len(player.Units)
	buffer.WriteByte(byte(numUnits))

	// Write each unit's data
	for _, unit := range player.Units {
		if err := writeUnitData(buffer, unit); err != nil {
			return err
		}
	}

	return nil
}

func writeUnitData(buffer *bytes.Buffer, unit *game.Unit) error {
	buffer.WriteByte(byte(unit.ID))
	buffer.WriteByte(byte(unit.Type))
	buffer.WriteByte(byte(unit.Variant))
	writePosition(buffer, unit.Position)
	return nil
}

// Helper function to write building data to buffer.
func writeBuildingData(buffer *bytes.Buffer, building *game.Building, player *game.Player) error {
	buffer.WriteByte(byte(building.ID))
	buffer.WriteByte(byte(building.Type))
	buffer.WriteByte(byte(building.Variant))

	writePosition(buffer, building.Position)

	// If the building is a barrack, check if it has an active UnitSpawning and append its details if active
	if building.Type == game.BARRACKS {
		var isActive byte = 0 // Default to inactive
		if player != nil {
			unitSpawning := player.GetUnitSpawningForBarrack(building)
			if unitSpawning != nil && unitSpawning.Activated {
				isActive = 1 // Indicate active spawning
			}
		}
		buffer.WriteByte(isActive)
	}

	return nil
}

func writePosition(buffer *bytes.Buffer, position game.PositionFloat) error {
	binary.Write(buffer, binary.BigEndian, position.X)
	binary.Write(buffer, binary.BigEndian, position.Y)
	return nil
}

func writeBasePosition(buffer *bytes.Buffer, position game.PositionInt) error {
	binary.Write(buffer, binary.BigEndian, position.X)
	binary.Write(buffer, binary.BigEndian, position.Y)
	return nil
}

// EncodeScore packs the score into a buffer, using 2 bytes if less than 1000 or packing integer and fractional parts into 2 bytes otherwise.
func EncodeScore(buffer *bytes.Buffer, score game.LeaderboardScore) {
	buffer.WriteByte(score.Unit)

	if score.FullValue >= 1_000_000 { // Handling million-scale scores
		var packedScore uint16

		// Ensure IntegerPart fits within 9 bits (max value 511)
		if score.IntegerPart > 0x1FF { // 9 bits max value (511)
			score.IntegerPart = 0x1FF
		}
		// Ensure FractionalPart fits within 7 bits (max value 99)
		if score.FractionalPart > 99 { // Only allow fractions up to 99
			score.FractionalPart = 99
		}

		// Pack IntegerPart (9 bits) and FractionalPart (7 bits) into uint16
		packedScore = (uint16(score.IntegerPart) << 7) | uint16(score.FractionalPart)

		// Write the packed score (2 bytes total)
		binary.Write(buffer, binary.BigEndian, packedScore)
	} else if score.FullValue >= 1000 { // Handling thousand-scale scores
		var packedScore uint16

		// Ensure IntegerPart fits within 10 bits (max value 1023)
		if score.IntegerPart > 0x3FF { // 10 bits max value (1023)
			score.IntegerPart = 0x3FF
		}
		// Ensure FractionalPart fits within 6 bits (max value 63)
		if score.FractionalPart > 0x3F { // 6 bits max value (63)
			score.FractionalPart = 0x3F
		}

		packedScore = (uint16(score.IntegerPart) << 6) | uint16(score.FractionalPart)

		// Write the packed score (2 bytes total)
		binary.Write(buffer, binary.BigEndian, packedScore)
	} else {
		// Encode the full value as a 16-bit integer (2 bytes)
		binary.Write(buffer, binary.BigEndian, uint16(score.FullValue))
	}
}

func EncodeSkinData(buffer *bytes.Buffer, skinCategory game.SkinCategory) {

	// Encode the default skins
	defaultSkinCount := len(skinCategory.Default)
	buffer.WriteByte(byte(defaultSkinCount)) // Number of default skins
	for _, skin := range skinCategory.Default {
		buffer.WriteByte(skin.ID)

		// Write the name (12 bytes)
		buffer.Write([]byte(skin.Name))
		if len(skin.Name) < 12 {
			// Pad name if less than 12 bytes
			buffer.Write(make([]byte, 12-len(skin.Name)))
		}
	}

	// Encode the veteran skins
	veteranSkinCount := len(skinCategory.Veteran)
	buffer.WriteByte(byte(veteranSkinCount)) // Number of veteran skins
	for _, skin := range skinCategory.Veteran {
		buffer.WriteByte(skin.ID)

		// Write the name (12 bytes)
		buffer.Write([]byte(skin.Name))
		if len(skin.Name) < 12 {
			// Pad name if less than 12 bytes
			buffer.Write(make([]byte, 12-len(skin.Name)))
		}

		// Write the required level (1 byte)
		buffer.WriteByte(byte(skin.RequiredLevel))
	}

	// Encode the premium skins
	premiumSkinCount := len(skinCategory.Premium)
	buffer.WriteByte(byte(premiumSkinCount)) // Number of premium skins
	for _, skin := range skinCategory.Premium {
		buffer.WriteByte(skin.ID)

		// Write the name (12 bytes)
		buffer.Write([]byte(skin.Name))
		if len(skin.Name) < 12 {
			// Pad name if less than 12 bytes
			buffer.Write(make([]byte, 12-len(skin.Name)))
		}

		// Write the cost (2 bytes)
		binary.Write(buffer, binary.BigEndian, uint16(skin.Cost))
	}
}
