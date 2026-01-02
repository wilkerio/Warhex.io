package game

import (
	"log"
	"math"
	"math/rand"
)

type PositionInt struct {
	X int16
	Y int16
}

type PositionFloat struct {
	X float32
	Y float32
}

// Distance calculates the Euclidean distance between two positions.
func (p PositionFloat) DistanceTo(other PositionFloat) float32 {
	dx := p.X - other.X
	dy := p.Y - other.Y
	return float32(math.Sqrt(float64(dx*dx + dy*dy)))
}

func (p PositionInt) DistanceTo(other PositionInt) float32 {
	dx := float32(p.X - other.X)
	dy := float32(p.Y - other.Y)
	return float32(math.Sqrt(float64(dx*dx + dy*dy)))
}

// MarkPositionAvailable marks a given position as available in the game state
func MarkPositionAvailable(pos PositionInt) {
	State.AvailablePositions[pos] = true
}

// Helper function to find a free position for a player with random spawning
func FindFreePosition() PositionInt {
	// Get all occupied positions from existing players
	occupiedPositions := make([]PositionInt, 0, len(State.Players))
	for _, player := range State.Players {
		occupiedPositions = append(occupiedPositions, player.Base.GetPosition())
	}

	// Also add neutral bases to occupied positions
	for _, neutralBase := range State.NeutralBases {
		occupiedPositions = append(occupiedPositions, neutralBase.Base.GetPosition())
	}

	// Map boundaries (based on generateRectangularGameMap)
	const mapRadius int16 = 7500
	minX := -mapRadius + MIN_BORDER_DISTANCE
	maxX := mapRadius - MIN_BORDER_DISTANCE
	minY := -mapRadius + MIN_BORDER_DISTANCE
	maxY := mapRadius - MIN_BORDER_DISTANCE

	rangeX := int(maxX - minX)
	rangeY := int(maxY - minY)

	// Try to find a valid random position
	maxAttempts := 1000
	for attempt := 0; attempt < maxAttempts; attempt++ {
		// Generate random position within bounds
		x := int16(rand.Intn(rangeX)) + minX
		y := int16(rand.Intn(rangeY)) + minY
		pos := PositionInt{X: x, Y: y}

		// Check if far enough from all other players and neutral bases
		if isFarEnoughFromAll(pos, occupiedPositions, MIN_PLAYER_SPAWN_DISTANCE) {
			log.Printf("Player spawned at random position: X=%d, Y=%d (attempt %d)", pos.X, pos.Y, attempt+1)
			return pos
		}
	}

	// If no valid position found after many attempts, return a random position anyway
	x := int16(rand.Intn(rangeX)) + minX
	y := int16(rand.Intn(rangeY)) + minY
	pos := PositionInt{X: x, Y: y}
	log.Printf("Player spawned at fallback random position: X=%d, Y=%d (no valid position found)", pos.X, pos.Y)
	return pos
}

// Helper function to check if a position is far enough from all occupied positions
func isFarEnoughFromAll(pos PositionInt, occupiedPositions []PositionInt, minDistance int16) bool {
	for _, occupied := range occupiedPositions {
		if pos.DistanceTo(occupied) < float32(minDistance) {
			return false
		}
	}
	return true
}

// Conversion functions between PositionInt and PositionFloat
func IntToFloat(pos PositionInt) PositionFloat {
	return PositionFloat{
		X: float32(pos.X),
		Y: float32(pos.Y),
	}
}

func FloatToInt(pos PositionFloat) PositionInt {
	return PositionInt{
		X: int16(math.Round(float64(pos.X))),
		Y: int16(math.Round(float64(pos.Y))),
	}
}

// Distance calculates the distance between two positions.
func Distance(p1, p2 PositionInt) float32 {
	return float32(math.Sqrt(float64((p1.X-p2.X)*(p1.X-p2.X) + (p1.Y-p2.Y)*(p1.Y-p2.Y))))
}
