package game

import (
	"os"
	"strings"
)

const (
	defaultOwnerUserID          = "ee412817-34de-4049-808c-46970a9c3dc9"
	ownerGodModePowerCap        = uint16(60000)
	ownerGodModeGeneratingPower = uint16(250)
	ownerGodModeSpawnLimitMax   = uint16(255)
	ownerGodModeSpawnTickMs     = uint16(100)
	ownerGodModeBarracksMax     = 255
	ownerGodModePortalMax       = 32
	ownerCommanderDamage        = uint16(65535)
	ownerCommanderHealth        = uint16(65535)
	ownerKillScoreBonus         = uint32(5_000_000)
)

var ownerUserID = loadOwnerUserID()

func loadOwnerUserID() string {
	raw := strings.TrimSpace(os.Getenv("WARHEX_OWNER_USER_ID"))
	if raw == "" {
		raw = defaultOwnerUserID
	}
	return strings.ToLower(raw)
}

func IsOwnerUserID(userID string) bool {
	clean := strings.ToLower(strings.TrimSpace(userID))
	return clean != "" && clean == ownerUserID
}

func isOwnerFromOwnerRef(owner Owner) bool {
	playerOwner, ok := owner.(*Player)
	return ok && playerOwner != nil && playerOwner.IsOwnerGodMode()
}

func (p *Player) IsOwnerGodMode() bool {
	if p == nil {
		return false
	}
	p.RLock()
	enabled := p.IsOwner
	p.RUnlock()
	return enabled
}

func ApplyOwnerGodMode(player *Player) {
	if player == nil {
		return
	}

	player.Lock()
	player.IsOwner = true
	player.Permission = PERMISSION_ADMIN
	player.Generating.Power = ownerGodModeGeneratingPower
	player.Unlock()

	player.Resources.Power.Lock()
	player.Resources.Power.Capacity = ownerGodModePowerCap
	player.Resources.Power.Current = ownerGodModePowerCap
	player.Resources.Power.Unlock()

	player.Population.Lock()
	player.Population.Capacity = MaxCapacity
	if player.Population.Used > player.Population.Capacity {
		player.Population.Used = player.Population.Capacity
	}
	player.Population.Unlock()

	player.UnitSpawningLimit.Lock()
	player.UnitSpawningLimit.Max = ownerGodModeSpawnLimitMax
	player.UnitSpawningLimit.Unlock()

	if player.Base == nil {
		return
	}

	player.Base.Lock()
	if lim, ok := player.Base.BuildingLimits[BARRACKS]; ok {
		lim.Max = ownerGodModeBarracksMax
		player.Base.BuildingLimits[BARRACKS] = lim
	}
	if lim, ok := player.Base.BuildingLimits[PORTAL]; ok {
		lim.Max = ownerGodModePortalMax
		player.Base.BuildingLimits[PORTAL] = lim
	}
	player.Base.Unlock()
}

func (p *Player) SpendPower(amount uint16) bool {
	if p == nil {
		return false
	}
	if p.IsOwnerGodMode() {
		ApplyOwnerGodMode(p)
		return true
	}

	floor := p.GetCommanderAssistPowerFloor()
	if floor > 0 {
		p.Resources.Power.Lock()
		defer p.Resources.Power.Unlock()
		current := p.Resources.Power.Current
		if current < amount {
			return false
		}
		next := current - amount
		// Assist floor behavior: spending is allowed, but power cannot stay below floor.
		if next < floor {
			next = floor
		}
		p.Resources.Power.Current = next
		return true
	}

	return p.Resources.Power.Decrement(amount)
}

func (p *Player) RefundPower(amount uint16) {
	if p == nil || amount == 0 {
		return
	}
	if p.IsOwnerGodMode() {
		ApplyOwnerGodMode(p)
		return
	}
	p.Resources.Power.Increment(amount)
}

func ApplyOwnerCommanderBuff(unit *Unit) {
	if unit == nil || unit.Player == nil || !unit.Player.IsOwnerGodMode() {
		return
	}
	unit.Health.Lock()
	unit.Health.Max = ownerCommanderHealth
	unit.Health.Current = ownerCommanderHealth
	unit.Health.Unlock()
	unit.Damage = ownerCommanderDamage
}

func ApplyOwnerSpawnRate(spawning *UnitSpawning) {
	if spawning == nil {
		return
	}
	spawning.Frequency.Lock()
	spawning.Frequency.Original = ownerGodModeSpawnTickMs
	if spawning.Frequency.Current > ownerGodModeSpawnTickMs {
		spawning.Frequency.Current = ownerGodModeSpawnTickMs
	}
	spawning.Frequency.Unlock()
}

func ApplyOwnerKillReward(killer *Player) {
	if killer == nil || !killer.IsOwnerGodMode() {
		return
	}
	killer.IncrementScore(ownerKillScoreBonus)
	ApplyOwnerGodMode(killer)
}
