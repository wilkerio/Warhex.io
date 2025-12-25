package game

import "math"

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

// Helper function to find a free position for a player
func FindFreePosition() PositionInt {
	// If there are no players yet, return a random available position
	if len(State.Players) == 0 {
		// Select a random available position
		for pos, isAvailable := range State.AvailablePositions {
			if isAvailable {
				// Mark the position as occupied
				State.AvailablePositions[pos] = false
				return pos
			}
		}
		// If no available position is found, return an empty position
		return PositionInt{}
	}

	var nearestPosition PositionInt
	minDistance := float32(math.MaxFloat32)

	// Iterate over all available positions
	for pos, isAvailable := range State.AvailablePositions {
		if isAvailable {
			// Calculate the distance to the nearest player
			for _, player := range State.Players {
				playerPosition := player.Base.GetPosition()
				distance := pos.DistanceTo(playerPosition)
				if distance < minDistance {
					minDistance = distance
					nearestPosition = pos
				}
			}
		}
	}

	if minDistance == float32(math.MaxFloat32) {
		// No available position found
		return PositionInt{}
	}

	// Mark the chosen position as occupied
	State.AvailablePositions[nearestPosition] = false
	return nearestPosition
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
