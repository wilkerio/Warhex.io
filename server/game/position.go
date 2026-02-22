package game

import (
	"log"
	"math"
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

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func getSpawnRingPositions(r int) [][2]int {
	positions := make([][2]int, 0, 8*r)
	seen := make(map[[2]int]bool, 8*r)

	add := func(x, y int) {
		p := [2]int{x, y}
		if !seen[p] {
			seen[p] = true
			positions = append(positions, p)
		}
	}

	// Prioritize: left, up, top-left (matches requested order around center).
	add(-r, 0)
	add(0, r)
	add(-r, r)

	// Complete the square ring clockwise.
	for x := -r + 1; x <= r; x++ {
		add(x, r)
	}
	for y := r - 1; y >= -r; y-- {
		add(r, y)
	}
	for x := r - 1; x >= -r; x-- {
		add(x, -r)
	}
	for y := -r + 1; y <= r-1; y++ {
		add(-r, y)
	}

	return positions
}

func getSpawnGridCell(index int) (int, int) {
	if index <= 0 {
		return 0, 0
	}

	remaining := index - 1
	for r := 1; ; r++ {
		ringCount := 8 * r
		if remaining < ringCount {
			p := getSpawnRingPositions(r)[remaining]
			return p[0], p[1]
		}
		remaining -= ringCount
	}
}

func calculateMapRadius(numPlayers int) int16 {
	if numPlayers < 1 {
		numPlayers = 1
	}

	const minRadius = 1200
	const extraBorderPadding = 300
	gridX, gridY := getSpawnGridCell(numPlayers - 1)
	maxGrid := absInt(gridX)
	if absInt(gridY) > maxGrid {
		maxGrid = absInt(gridY)
	}

	requiredRadius := maxGrid*int(MIN_PLAYER_SPAWN_DISTANCE) + int(MIN_BORDER_DISTANCE) + extraBorderPadding
	if requiredRadius < minRadius {
		requiredRadius = minRadius
	}

	return int16(requiredRadius)
}

func calculateMapRadiusForActivePlayers(players map[ID]*Player) int16 {
	const minRadius = 1200
	const extraBorderPadding = 300

	maxAxis := 0
	for _, player := range players {
		if player == nil || player.IsMarkedForRemoval() {
			continue
		}

		pos := player.Base.GetPosition()
		absX := absInt(int(pos.X))
		absY := absInt(int(pos.Y))
		if absX > maxAxis {
			maxAxis = absX
		}
		if absY > maxAxis {
			maxAxis = absY
		}
	}

	requiredRadius := maxAxis + int(MIN_BORDER_DISTANCE) + extraBorderPadding
	if requiredRadius < minRadius {
		requiredRadius = minRadius
	}

	return int16(requiredRadius)
}

func GetCurrentMapRadius() int16 {
	State.RLock()
	players := State.Players
	State.RUnlock()
	return calculateMapRadiusForActivePlayers(players)
}

func ClampPositionIntToMap(pos PositionInt, padding int16) PositionInt {
	radius := GetCurrentMapRadius() - padding
	if radius < 0 {
		radius = 0
	}

	if pos.X > radius {
		pos.X = radius
	}
	if pos.X < -radius {
		pos.X = -radius
	}
	if pos.Y > radius {
		pos.Y = radius
	}
	if pos.Y < -radius {
		pos.Y = -radius
	}
	return pos
}

func ClampPositionFloatToMap(pos PositionFloat, padding float32) PositionFloat {
	radius := float32(GetCurrentMapRadius()) - padding
	if radius < 0 {
		radius = 0
	}

	if pos.X > radius {
		pos.X = radius
	}
	if pos.X < -radius {
		pos.X = -radius
	}
	if pos.Y > radius {
		pos.Y = radius
	}
	if pos.Y < -radius {
		pos.Y = -radius
	}
	return pos
}

func isWithinMapBounds(pos PositionInt, mapRadius int16) bool {
	minX := -mapRadius + MIN_BORDER_DISTANCE
	maxX := mapRadius - MIN_BORDER_DISTANCE
	minY := -mapRadius + MIN_BORDER_DISTANCE
	maxY := mapRadius - MIN_BORDER_DISTANCE

	return pos.X >= minX && pos.X <= maxX && pos.Y >= minY && pos.Y <= maxY
}

// Helper function to find a free position for a player with deterministic square-grid spawning
func FindFreePosition() PositionInt {
	occupiedPositions := make([]PositionInt, 0, len(State.Players))
	for _, player := range State.Players {
		occupiedPositions = append(occupiedPositions, player.Base.GetPosition())
	}

	for _, neutralBase := range State.NeutralBases {
		occupiedPositions = append(occupiedPositions, neutralBase.Base.GetPosition())
	}

	newPlayerIndex := len(State.Players)
	mapRadius := calculateMapRadius(newPlayerIndex + 1)

	gridX, gridY := getSpawnGridCell(newPlayerIndex)
	step := int(MIN_PLAYER_SPAWN_DISTANCE)
	spawnPos := PositionInt{
		X: int16(gridX * step),
		Y: int16(gridY * step),
	}

	if isWithinMapBounds(spawnPos, mapRadius) && isFarEnoughFromAll(spawnPos, occupiedPositions, MIN_PLAYER_SPAWN_DISTANCE) {
		log.Printf("Player spawned at grid position: X=%d, Y=%d (index %d)", spawnPos.X, spawnPos.Y, newPlayerIndex)
		return spawnPos
	}

	log.Printf("Grid spawn invalid (index %d), using center fallback", newPlayerIndex)
	return PositionInt{X: 0, Y: 0}
}

// FindFreeRelocationPosition finds an empty spawn-grid slot for relocating a player base.
// Callers should hold State lock when invoking this function.
func FindFreeRelocationPosition(excludePlayerID ID) (PositionInt, bool) {
	occupiedPositions := make([]PositionInt, 0, len(State.Players)+len(State.NeutralBases))
	for id, player := range State.Players {
		if id == excludePlayerID {
			continue
		}
		occupiedPositions = append(occupiedPositions, player.Base.GetPosition())
	}

	for _, neutralBase := range State.NeutralBases {
		occupiedPositions = append(occupiedPositions, neutralBase.Base.GetPosition())
	}

	mapRadius := calculateMapRadius(len(State.Players))
	step := int(MIN_PLAYER_SPAWN_DISTANCE)

	maxCandidates := len(State.Players) + len(State.NeutralBases) + 64
	for i := 0; i < maxCandidates; i++ {
		gridX, gridY := getSpawnGridCell(i)
		pos := PositionInt{
			X: int16(gridX * step),
			Y: int16(gridY * step),
		}

		if !isWithinMapBounds(pos, mapRadius) {
			continue
		}
		if isFarEnoughFromAll(pos, occupiedPositions, MIN_PLAYER_SPAWN_DISTANCE) {
			return pos, true
		}
	}

	return PositionInt{}, false
}

func IsRelocationSlotAvailable(pos PositionInt, excludePlayerID ID) bool {
	mapRadius := calculateMapRadius(len(State.Players))
	if !isWithinMapBounds(pos, mapRadius) {
		return false
	}

	step := int16(MIN_PLAYER_SPAWN_DISTANCE)
	if step <= 0 {
		return false
	}
	if pos.X%step != 0 || pos.Y%step != 0 {
		return false
	}

	occupiedPositions := make([]PositionInt, 0, len(State.Players)+len(State.NeutralBases))
	for id, player := range State.Players {
		if id == excludePlayerID {
			continue
		}
		occupiedPositions = append(occupiedPositions, player.Base.GetPosition())
	}

	for _, neutralBase := range State.NeutralBases {
		occupiedPositions = append(occupiedPositions, neutralBase.Base.GetPosition())
	}

	return isFarEnoughFromAll(pos, occupiedPositions, MIN_PLAYER_SPAWN_DISTANCE)
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
