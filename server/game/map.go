package game

import (
	"math"
	"math/rand"
)

func generateHexagon(center PositionInt, size float64) []PositionInt {
	vertices := make([]PositionInt, 6)

	for i := 0; i < 6; i++ {
		angle := math.Pi / 3.0 * float64(i)
		x := center.X + int16(math.Round(size*math.Cos(angle)))
		y := center.Y + int16(math.Round(size*math.Sin(angle)))
		vertices[i] = PositionInt{X: x, Y: y}
	}

	return vertices
}

// Function to determine if two positions are within a given range
func isTooClose(p1, p2 PositionInt, rangeX, rangeY int16) bool {
	return abs(p1.X-p2.X) <= rangeX && abs(p1.Y-p2.Y) <= rangeY
}

// Absolute value function for int16
func abs(x int16) int16 {
	if x < 0 {
		return -x
	}
	return x
}

func generateBushes(centers []PositionInt, neutralBases []PositionInt, radius float64, numBushes int, minDistance int16) []PositionInt {
	bushes := make([]PositionInt, 0, numBushes)

	// Function to check if a bush position is too close to any center, neutral base, or other bushes
	isFarEnough := func(bushPos PositionInt) bool {
		for _, center := range centers {
			if isTooClose(bushPos, center, minDistance, minDistance) {
				return false
			}
		}
		for _, base := range neutralBases {
			if isTooClose(bushPos, base, minDistance, minDistance) {
				return false
			}
		}
		for _, bush := range bushes {
			if isTooClose(bushPos, bush, minDistance, minDistance) {
				return false
			}
		}
		return true
	}

	for len(bushes) < numBushes {
		// Generate random position within a rectangle
		bushX := int16(rand.Float64()*2*radius - radius) // -radius to +radius
		bushY := int16(rand.Float64()*2*radius - radius)
		bushPos := PositionInt{X: bushX, Y: bushY}

		// Check if the bush position is far enough from all centers, neutral bases, and existing bushes
		if isFarEnough(bushPos) {
			bushes = append(bushes, bushPos)
		}
	}

	return bushes
}

type Rock struct {
	Polygon Polygon
	Size    int
}

func generateRocks(centers []PositionInt, neutralBases []PositionInt, radius float64, numRocks int, minDistance int16, polygonType PolygonType) []Rock {
	rocks := make([]Rock, 0, numRocks) // Store Rock structs

	// Function to check if a rock position is too close to any neutral or player base
	isFarEnough := func(rockPos PositionInt) bool {
		for _, base := range append(neutralBases, centers...) {
			// Check distance between rock position and the base
			if isTooClose(rockPos, base, minDistance, minDistance) {
				return false
			}
		}
		return true
	}

	// Generate large rocks first
	for len(rocks) < numRocks/2 { // Generate half as large rocks
		// Generate random position within a rectangle
		rockX := int16(rand.Float64()*2*radius - radius)
		rockY := int16(rand.Float64()*2*radius - radius)
		rockPos := PositionInt{X: rockX, Y: rockY}

		// Check if the large rock is far enough from neutral/player bases
		if isFarEnough(rockPos) {
			// Generate a large size rock between 60 and 80
			size := rand.Intn(40) + 60 // Generates a number between 60 and 80

			// Generate polygon for large rock
			polygon := GeneratePolygon(polygonType, size, 0)
			polygon.SetRotation(rand.Float64() * 2 * math.Pi)
			polygon.Center = PositionFloat{X: float32(rockX), Y: float32(rockY)}

			// Create large rock
			rock := Rock{
				Polygon: polygon,
				Size:    size,
			}
			rocks = append(rocks, rock)

			// Generate smaller rocks around this large rock
			// Make sure small rocks are randomly scattered close to the large rock
			numSmallRocks := rand.Intn(2) + 2
			for i := 0; i < numSmallRocks; i++ {
				// Randomly generate smaller rocks close to the large rock
				angle := rand.Float64() * 2 * math.Pi
				// Vary distance randomly between 0.5 and 1.5 times the size of the large rock
				distance := rand.Float64()*1.0 + 2 // Random distance factor

				// Calculate the position of the small rock around the large rock with random offset
				smallRockX := int16(float64(rockX) + distance*float64(size)*math.Cos(angle))
				smallRockY := int16(float64(rockY) + distance*float64(size)*math.Sin(angle))

				// Generate a small size rock between 40 and 60
				smallSize := rand.Intn(40) + 20 // Generates a number between 40 and 60

				// Generate polygon for small rock
				smallPolygon := GeneratePolygon(polygonType, smallSize, 0)
				smallPolygon.SetRotation(rand.Float64() * 2 * math.Pi)
				smallPolygon.Center = PositionFloat{X: float32(smallRockX), Y: float32(smallRockY)}

				// Create small rock
				smallRock := Rock{
					Polygon: smallPolygon,
					Size:    smallSize,
				}
				rocks = append(rocks, smallRock)
			}
		}
	}

	// Generate remaining small rocks
	for len(rocks) < numRocks {
		// Generate random position within a rectangle
		rockX := int16(rand.Float64()*2*radius - radius)
		rockY := int16(rand.Float64()*2*radius - radius)
		rockPos := PositionInt{X: rockX, Y: rockY}

		// Check if the small rock is far enough from neutral/player bases
		if isFarEnough(rockPos) {
			// Generate a small size rock between 40 and 60
			size := rand.Intn(40) + 60

			// Generate polygon for small rock
			polygon := GeneratePolygon(polygonType, size, 0)
			polygon.SetRotation(rand.Float64() * 2 * math.Pi)
			polygon.Center = PositionFloat{X: float32(rockX), Y: float32(rockY)}

			// Create small rock
			rock := Rock{
				Polygon: polygon,
				Size:    size,
			}
			rocks = append(rocks, rock)
		}
	}

	return rocks
}

func generateRectangularGameMap() (playerPositions, neutralPositions []PositionInt) {
	// Pre-generated player positions are no longer needed with dynamic map size.
	return nil, nil
}

func AddDynamicBushesForPlayerCount(playerCount int) {
	if playerCount < 1 {
		playerCount = 1
	}

	const baseBushCount = 6
	const bushesPerPlayer = 2
	const baseMinDistance int16 = 800
	const maxAttemptsPerBush = 250

	targetBushCount := baseBushCount + playerCount*bushesPerPlayer
	if len(State.Bushes) >= targetBushCount {
		return
	}

	mapRadius := float64(calculateMapRadius(playerCount))

	occupied := make([]PositionInt, 0, len(State.Players)+len(State.NeutralBases))
	for _, p := range State.Players {
		occupied = append(occupied, p.Base.Position)
	}
	for _, n := range State.NeutralBases {
		occupied = append(occupied, n.Base.Position)
	}

	isFarEnough := func(pos PositionInt) bool {
		if isPointInsideAnyActiveDuelArenaUnsafe(PositionFloat{X: float32(pos.X), Y: float32(pos.Y)}, 64) {
			return false
		}
		for _, basePos := range occupied {
			if isTooClose(pos, basePos, baseMinDistance, baseMinDistance) {
				return false
			}
		}
		for _, bush := range State.Bushes {
			if isTooClose(pos, bush, baseMinDistance/2, baseMinDistance/2) {
				return false
			}
		}
		return true
	}

	toAdd := targetBushCount - len(State.Bushes)
	for i := 0; i < toAdd; i++ {
		added := false
		for attempt := 0; attempt < maxAttemptsPerBush; attempt++ {
			x := int16(rand.Float64()*2*mapRadius - mapRadius)
			y := int16(rand.Float64()*2*mapRadius - mapRadius)
			pos := PositionInt{X: x, Y: y}
			if isFarEnough(pos) {
				State.Bushes = append(State.Bushes, pos)
				added = true
				break
			}
		}

		if !added {
			break
		}
	}
}

// Helper function to initialize the game state with predefined positions
func InitializeGameMap() {
	_, neutralPositions := generateRectangularGameMap()
	// Initialize the map with all positions as available
	State.AvailablePositions = make(map[PositionInt]bool)

	// Populate NeutralBases with NeutralBase instances
	State.NeutralBases = make([]*NeutralBase, len(neutralPositions))
	for i, pos := range neutralPositions {
		// Initialize the neutral base
		neutralBase := &NeutralBase{
			ID: ID(i), // IDs are assigned based on position index
		}

		neutralBase.Base = &Base{
			Owner:                neutralBase,
			Position:             pos,
			Health:               Health{Current: NEUTRAL_BASE_INITIAL_HEALTH, Max: NEUTRAL_BASE_INITIAL_HEALTH},
			Buildings:            make(map[ID]*Building),
			Bullets:              make(map[ID]*Bullet),
			AvailableBuildingIDs: InitAvailableIDs(256),
			AvailableBulletIDs:   InitAvailableIDs(256),
		}

		// Add the neutral base to the GameState
		State.NeutralBases[i] = neutralBase
	}

	// Populate each neutral base with walls
	for _, base := range State.NeutralBases {
		PopulateNeutralBase(base)
	}

	// Generate bushes and rocks within the initial map radius
	initialRadius := float64(calculateMapRadius(1))
	State.Bushes = generateBushes(nil, neutralPositions, initialRadius, 6, 800)
	State.Rocks = make([]Rock, 0)
}
