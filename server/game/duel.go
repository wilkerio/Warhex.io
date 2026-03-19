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
	defer second.Unlock()
	defer first.Unlock()

	p1.InDuel = true
	p1.DuelOpponentID = p2.ID
	p1.DuelArena = arena
	p1.DuelPrepEndsAt = prepEndsAt

	p2.InDuel = true
	p2.DuelOpponentID = p1.ID
	p2.DuelArena = arena
	p2.DuelPrepEndsAt = prepEndsAt

	return arena
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
