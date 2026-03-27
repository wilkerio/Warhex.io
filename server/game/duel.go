package game

import (
	"math"
	"time"
)

const DuelPreparationDuration = 0 * time.Second

func DuelPreparationSeconds() byte {
	return byte(DuelPreparationDuration / time.Second)
}

type DuelArena struct {
	MinX float32
	MinY float32
	MaxX float32
	MaxY float32
}

func buildDuelArena(p1 *Player, p2 *Player) DuelArena {
	p1Pos := p1.Base.Position
	p2Pos := p2.Base.Position

	x1 := float32(p1Pos.X)
	y1 := float32(p1Pos.Y)
	x2 := float32(p2Pos.X)
	y2 := float32(p2Pos.Y)

	// Fixed protection rectangle around both cores.
	// Includes full spawn-protection ring plus extra margin.
	const ringPadding float32 = PLAYER_SPAWN_PROTECTION_RADIUS + 90

	minX := float32(math.Min(float64(x1), float64(x2))) - ringPadding
	maxX := float32(math.Max(float64(x1), float64(x2))) + ringPadding
	minY := float32(math.Min(float64(y1), float64(y2))) - ringPadding
	maxY := float32(math.Max(float64(y1), float64(y2))) + ringPadding

	return DuelArena{
		MinX: minX,
		MaxX: maxX,
		MinY: minY,
		MaxY: maxY,
	}
}

func StartProtectedDuel(p1 *Player, p2 *Player) DuelArena {
	// X1 duel must allow direct combat between both players.
	// Ensure any remaining spawn protection is removed before duel state starts.
	p1.RemoveProtection()
	p2.RemoveProtection()

	arena := buildDuelArena(p1, p2)
	prepEndsAt := time.Time{}

	first := p1
	second := p2
	if first.ID > second.ID {
		first, second = second, first
	}

	first.Lock()
	second.Lock()
	p1.InDuel = true
	p1.DuelOpponentID = p2.ID
	p1.DuelArena = arena
	p1.DuelPrepEndsAt = prepEndsAt

	p2.InDuel = true
	p2.DuelOpponentID = p1.ID
	p2.DuelArena = arena
	p2.DuelPrepEndsAt = prepEndsAt

	second.Unlock()
	first.Unlock()

	// Keep X1 battlefield clean: no bushes/rocks inside active duel arena.
	ClearDuelArenaObstacles(arena)

	return arena
}

func isPointInsideDuelArena(arena DuelArena, point PositionFloat, padding float32) bool {
	minX := arena.MinX - padding
	maxX := arena.MaxX + padding
	minY := arena.MinY - padding
	maxY := arena.MaxY + padding
	return point.X >= minX && point.X <= maxX && point.Y >= minY && point.Y <= maxY
}

func isPointInsideAnyActiveDuelArenaUnsafe(point PositionFloat, padding float32) bool {
	seen := make(map[[2]ID]struct{})
	for _, player := range State.Players {
		if player == nil {
			continue
		}
		player.RLock()
		inDuel := player.InDuel
		arena := player.DuelArena
		ownerID := player.ID
		opponentID := player.DuelOpponentID
		player.RUnlock()
		if !inDuel || opponentID == 0 {
			continue
		}
		key := [2]ID{ownerID, opponentID}
		if key[0] > key[1] {
			key[0], key[1] = key[1], key[0]
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		if isPointInsideDuelArena(arena, point, padding) {
			return true
		}
	}
	return false
}

func IsPointInsideAnyActiveDuelArena(point PositionFloat, padding float32) bool {
	State.RLock()
	defer State.RUnlock()
	return isPointInsideAnyActiveDuelArenaUnsafe(point, padding)
}

func ClearDuelArenaObstacles(arena DuelArena) {
	State.Lock()
	defer State.Unlock()

	filteredBushes := make([]PositionInt, 0, len(State.Bushes))
	for _, bush := range State.Bushes {
		point := PositionFloat{X: float32(bush.X), Y: float32(bush.Y)}
		if isPointInsideDuelArena(arena, point, 36) {
			continue
		}
		filteredBushes = append(filteredBushes, bush)
	}
	State.Bushes = filteredBushes

	filteredRocks := make([]Rock, 0, len(State.Rocks))
	for _, rock := range State.Rocks {
		padding := float32(rock.Size) + 16
		if isPointInsideDuelArena(arena, rock.Polygon.Center, padding) {
			continue
		}
		filteredRocks = append(filteredRocks, rock)
	}
	State.Rocks = filteredRocks
}

func ClearProtectedDuel(p *Player) {
	p.RLock()
	inDuel := p.InDuel
	opponentID := p.DuelOpponentID
	p.RUnlock()

	if !inDuel {
		return
	}

	State.RLock()
	opponent := State.Players[opponentID]
	State.RUnlock()

	if opponent == nil {
		p.Lock()
		p.InDuel = false
		p.DuelOpponentID = 0
		p.DuelArena = DuelArena{}
		p.DuelPrepEndsAt = time.Time{}
		p.Unlock()
		return
	}

	first := p
	second := opponent
	if first.ID > second.ID {
		first, second = second, first
	}

	first.Lock()
	second.Lock()
	defer second.Unlock()
	defer first.Unlock()

	p.InDuel = false
	p.DuelOpponentID = 0
	p.DuelArena = DuelArena{}
	p.DuelPrepEndsAt = time.Time{}

	if opponent.DuelOpponentID == p.ID {
		opponent.InDuel = false
		opponent.DuelOpponentID = 0
		opponent.DuelArena = DuelArena{}
		opponent.DuelPrepEndsAt = time.Time{}
	}
}

func CanPlayersInteract(a *Player, b *Player) bool {
	if a == nil || b == nil {
		return true
	}
	if a.ID == b.ID {
		return false
	}

	first := a
	second := b
	if first.ID > second.ID {
		first, second = second, first
	}

	first.RLock()
	second.RLock()
	defer second.RUnlock()
	defer first.RUnlock()

	// Owner rule:
	// - non-owner cannot damage/affect owner
	// - owner can always affect non-owner
	if !a.IsOwner && b.IsOwner {
		return false
	}
	if a.IsOwner && !b.IsOwner {
		return true
	}

	areOpponents := a.InDuel && b.InDuel &&
		a.DuelOpponentID == b.ID &&
		b.DuelOpponentID == a.ID
	if areOpponents {
		// Duel opponents can always interact immediately once duel starts.
		return true
	}

	if a.InDuel || b.InDuel {
		return false
	}

	return true
}

func AreDuelOpponents(a *Player, b *Player) bool {
	if a == nil || b == nil {
		return false
	}
	if a.ID == b.ID {
		return false
	}

	first := a
	second := b
	if first.ID > second.ID {
		first, second = second, first
	}

	first.RLock()
	second.RLock()
	defer second.RUnlock()
	defer first.RUnlock()

	return a.InDuel && b.InDuel &&
		a.DuelOpponentID == b.ID &&
		b.DuelOpponentID == a.ID
}
