package game

import (
	"fmt"
	"log"
	"math"
	"math/rand"
	"sort"
	"strings"
	"sync"
	"time"
)

type localBotPersonality struct {
	ID   string
	Name string
	Tag  string

	AggressionBias float64
	EconomyBias    float64
	DefenseBias    float64
	MapControlBias float64
	Patience       float64

	AttackHPThreshold       float64
	AttackResourceThreshold float64
	AttackTickMinimum       int
	EcoPhaseEndTick         int
	DefenseActivationHP     float64

	ChatFrequency   float64
	ChatStyle       string
	ChatVocabAbsorb float64

	LearningRate       float64
	ImitationThreshold int
	Noise              float64

	PreferDefendMenu float64
	PreferExternATK  float64
	PreferLoadBase   float64
	LoadBaseQuery    string
}

type localPlayerMemory struct {
	Name         string
	Relationship string
	WinsVsMe     int
	LossesVsMe   int
	Seen         int
}

type localBotBrain struct {
	personality localBotPersonality

	learnedAttackTick int
	learnedEcoTarget  float64
	winStreak         int
	lossStreak        int
	partiesPlayed     int

	dynamicAggression float64
	dynamicPatience   float64

	knownPlayers map[string]*localPlayerMemory
	learnedVocab []string

	lastAttackTick int
	lastChatTick   int
	currentNemesis string

	lastObservation string
	lastAbsorbed    []string

	mu  sync.Mutex
	rng *rand.Rand
}

// BotBrain is the persisted-learning view used by DB helpers.
type BotBrain = localBotBrain

type localEnemyInfo struct {
	ID         string
	Distance   float64
	BaseHP     float64
	Aggression float64
	IsNemesis  bool
	IsFriend   bool
}

type localSnapshot struct {
	Tick            int
	Gold            float64
	Food            float64
	BaseHP          float64
	MapControl      float64
	TroopsAvailable int
	TroopsDeployed  int
	BuildingCount   map[string]int
	UnderAttack     bool
	ThreatLevel     float64
	Enemies         []localEnemyInfo
	Social          botSocialPayload
	IdentityID      string
	SilentChat      bool
	BaseReady       bool
}

type localActionScore struct {
	Action string
	Score  float64
}

var (
	localBrainsByIdentity   = make(map[string]*localBotBrain)
	localBrainsByIdentityMu sync.RWMutex

	activeLocalBrainsByID   = make(map[ID]*localBotBrain)
	activeLocalBrainsByIDMu sync.RWMutex
)

func getOrCreateLocalBrain(identity botIdentityPreset) *localBotBrain {
	key := strings.TrimSpace(identity.ID)
	if key == "" {
		key = strings.ToLower(strings.TrimSpace(identity.Name))
	}
	if key == "" {
		key = "default"
	}

	localBrainsByIdentityMu.RLock()
	if existing, ok := localBrainsByIdentity[key]; ok {
		localBrainsByIdentityMu.RUnlock()
		return existing
	}
	localBrainsByIdentityMu.RUnlock()

	personality := localPersonalityForIdentity(identity)
	brain := &localBotBrain{
		personality:       personality,
		learnedAttackTick: personality.AttackTickMinimum,
		learnedEcoTarget:  3.0,
		dynamicAggression: personality.AggressionBias,
		dynamicPatience:   personality.Patience,
		knownPlayers:      make(map[string]*localPlayerMemory),
		learnedVocab:      make([]string, 0, 32),
		lastAbsorbed:      make([]string, 0, 8),
		rng:               rand.New(rand.NewSource(time.Now().UnixNano() + int64(len(key))*97)),
	}
	if persisted, err := loadBotPersonalityState(key); err == nil && persisted != nil {
		brain.dynamicAggression = clamp01(persisted.dynamicAggression)
		brain.dynamicPatience = clamp01(persisted.dynamicPatience)
		if persisted.learnedAttackTick > 0 {
			brain.learnedAttackTick = persisted.learnedAttackTick
		}
		if persisted.learnedEcoTarget > 0 {
			brain.learnedEcoTarget = persisted.learnedEcoTarget
		}
		brain.winStreak = maxInt(0, persisted.winStreak)
		brain.lossStreak = maxInt(0, persisted.lossStreak)
		brain.partiesPlayed = maxInt(0, persisted.partiesPlayed)
	} else if err != nil {
		log.Printf("bot personality load failed for %s: %v", key, err)
	}

	localBrainsByIdentityMu.Lock()
	if existing, ok := localBrainsByIdentity[key]; ok {
		localBrainsByIdentityMu.Unlock()
		return existing
	}
	localBrainsByIdentity[key] = brain
	localBrainsByIdentityMu.Unlock()
	return brain
}

func registerActiveLocalBrain(playerID ID, brain *localBotBrain) {
	if playerID == 0 || brain == nil {
		return
	}
	activeLocalBrainsByIDMu.Lock()
	activeLocalBrainsByID[playerID] = brain
	activeLocalBrainsByIDMu.Unlock()
}

func unregisterActiveLocalBrain(playerID ID) {
	if playerID == 0 {
		return
	}
	activeLocalBrainsByIDMu.Lock()
	delete(activeLocalBrainsByID, playerID)
	activeLocalBrainsByIDMu.Unlock()
}

func RecordBotMatchOutcome(victim *Player, killer *Player) {
	if victim == nil {
		return
	}

	victimName := strings.TrimSpace(getPlayerName(victim))
	killerName := ""
	if killer != nil {
		killerName = strings.TrimSpace(getPlayerName(killer))
	}

	if victim.IsBot {
		activeLocalBrainsByIDMu.RLock()
		brain := activeLocalBrainsByID[victim.ID]
		activeLocalBrainsByIDMu.RUnlock()
		if brain != nil {
			brain.learnFromElimination(getActiveBotRuntime(victim.ID), false, killerName, victimName)
		}
	}

	if killer != nil && killer.IsBot {
		activeLocalBrainsByIDMu.RLock()
		brain := activeLocalBrainsByID[killer.ID]
		activeLocalBrainsByIDMu.RUnlock()
		if brain != nil {
			brain.learnFromElimination(getActiveBotRuntime(killer.ID), true, killerName, victimName)
		}
	}
}

func localDecisionForRuntime(player *Player, rt *botRuntime, now time.Time) (aiBotDecision, bool) {
	if player == nil || rt == nil || player.Base == nil {
		return aiBotDecision{}, false
	}

	brain := rt.localBrain
	if brain == nil {
		brain = getOrCreateLocalBrain(rt.identity)
		rt.localBrain = brain
		registerActiveLocalBrain(player.ID, brain)
	}

	snap := buildLocalSnapshot(player, rt, now)
	decision := brain.decide(snap)
	if prod := getOrCreateProductionAgent(rt.identity, brain); prod != nil {
		decision = prod.Decide(gameSnapshotFromLocalSnapshot(snap), decision)
	}
	return decision, true
}

func buildLocalSnapshot(player *Player, rt *botRuntime, now time.Time) localSnapshot {
	summary := summarizeBotBuildings(player.Base)
	powerU16 := readCurrentPower(player)
	power := float64(powerU16)
	freePop := float64(readFreePopulation(player))
	units := readUnitCount(player)
	underAttack := player.WasBaseDamagedWithin(12 * time.Second)
	social := buildBotSocialPayload(player, rt)
	baseReady := isBotBaseReadyForPush(player, rt, summary, powerU16)

	tick := int(now.Sub(player.StartTime).Seconds())
	if tick < 0 {
		tick = rt.phase * 2
	}

	baseHP := 1.0
	if player.Base != nil {
		player.Base.Health.RLock()
		if player.Base.Health.Max > 0 {
			baseHP = float64(player.Base.Health.Current) / float64(player.Base.Health.Max)
		}
		player.Base.Health.RUnlock()
	}
	baseHP = clamp01(baseHP)

	mapControl := estimateMapControl(player)
	enemies := gatherLocalEnemies(player, rt)
	threat := estimateThreatLevel(underAttack, enemies, units, power)

	buildingCount := map[string]int{
		"WALL":      summary.walls,
		"GENERATOR": summary.gens,
		"HOUSE":     summary.houses,
		"BARRACKS":  summary.barracks,
		"TURRETS":   summary.turrets + summary.snipers,
	}

	return localSnapshot{
		Tick:            tick,
		Gold:            power,
		Food:            freePop,
		BaseHP:          baseHP,
		MapControl:      mapControl,
		TroopsAvailable: units,
		TroopsDeployed:  0,
		BuildingCount:   buildingCount,
		UnderAttack:     underAttack,
		ThreatLevel:     threat,
		Enemies:         enemies,
		Social:          social,
		IdentityID:      rt.identity.ID,
		SilentChat:      rt.identity.SilentChat,
		BaseReady:       baseReady,
	}
}

func estimateMapControl(player *Player) float64 {
	if player == nil {
		return 0.0
	}
	rankMap := buildLeaderboardRankMap()
	totalPlayers := len(rankMap)
	if totalPlayers <= 0 {
		totalPlayers = 1
	}
	rank := rankMap[player.ID]
	if rank <= 0 {
		rank = totalPlayers
	}
	rankScore := 1.0
	if totalPlayers > 1 {
		rankScore = 1.0 - (float64(rank-1) / float64(totalPlayers-1))
	}
	player.RLock()
	neutralCount := len(player.CapturedNeutralBases)
	player.RUnlock()
	neutralScore := math.Min(float64(neutralCount)*0.08, 0.32)
	return clamp01(0.15 + rankScore*0.6 + neutralScore)
}

func gatherLocalEnemies(player *Player, rt *botRuntime) []localEnemyInfo {
	if player == nil || player.Base == nil {
		return nil
	}
	selfPos := IntToFloat(player.Base.GetPosition())
	type candidate struct {
		enemy localEnemyInfo
		dist  float64
	}
	candidates := make([]candidate, 0, 12)

	State.RLock()
	for _, other := range State.Players {
		if other == nil || other.ID == player.ID || other.IsMarkedForRemoval() || other.Base == nil {
			continue
		}
		dist := float64(selfPos.DistanceTo(IntToFloat(other.Base.GetPosition())))

		other.RLock()
		units := len(other.Units)
		other.RUnlock()

		baseHP := 1.0
		other.Base.Health.RLock()
		if other.Base.Health.Max > 0 {
			baseHP = float64(other.Base.Health.Current) / float64(other.Base.Health.Max)
		}
		other.Base.Health.RUnlock()

		name := strings.TrimSpace(getPlayerName(other))
		if name == "" {
			name = fmt.Sprintf("player_%d", other.ID)
		}
		rel := strings.ToLower(strings.TrimSpace(rt.relationshipStatus(name)))
		isFriend := rel == "friendly"
		isNemesis := rel == "rival" || strings.EqualFold(name, rt.lastEnemyName)
		if rt.localBrain != nil && strings.EqualFold(rt.localBrain.currentNemesisName(), name) {
			isNemesis = true
		}

		aggression := 0.35
		if units >= 10 {
			aggression = 0.85
		} else if units >= 6 {
			aggression = 0.55
		}

		candidates = append(candidates, candidate{
			enemy: localEnemyInfo{
				ID:         name,
				Distance:   clamp01(dist / 5500.0),
				BaseHP:     clamp01(baseHP),
				Aggression: aggression,
				IsNemesis:  isNemesis,
				IsFriend:   isFriend,
			},
			dist: dist,
		})
	}
	State.RUnlock()

	sort.Slice(candidates, func(i, j int) bool { return candidates[i].dist < candidates[j].dist })
	if len(candidates) > 6 {
		candidates = candidates[:6]
	}
	out := make([]localEnemyInfo, 0, len(candidates))
	for _, c := range candidates {
		out = append(out, c.enemy)
	}
	return out
}

func (rt *botRuntime) relationshipStatus(playerName string) string {
	if rt == nil {
		return ""
	}
	if rel, ok := rt.relationships[playerName]; ok {
		return rel.Status
	}
	return ""
}

func estimateThreatLevel(underAttack bool, enemies []localEnemyInfo, units int, power float64) float64 {
	if underAttack {
		return 0.9
	}
	threat := 0.15
	for _, enemy := range enemies {
		proximity := 1.0 - enemy.Distance
		threat += proximity*0.18 + enemy.Aggression*0.12
	}
	if units < 6 {
		threat += 0.12
	}
	if power < 180 {
		threat += 0.08
	}
	return clamp01(threat)
}

func (b *localBotBrain) decide(snap localSnapshot) aiBotDecision {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.observe(snap)
	scores := b.calculateActionScores(snap)
	b.applyNoise(scores)
	action, score := b.selectBestAction(scores)
	target := b.selectTarget(snap, action)
	menu, query := b.selectMenu(snap, action)
	priority := b.determinePriority(snap, action)
	moveMode := actionToMoveMode(priority, action)
	chat := b.generateChat(snap, action, target)
	buildHints, buildSequence := actionToBuildHints(action, priority)
	observation := b.lastObservation
	vocab := append([]string(nil), b.lastAbsorbed...)
	if len(vocab) > 4 {
		vocab = vocab[:4]
	}
	reasoning := b.buildReasoning(snap, action, score)
	nextIntention := b.nextIntention(action, snap)

	useDefend := menu == "Defend" || priority == "DEFENSIVA" || priority == "EMERGENCIA"
	var allowPush *bool
	var setGroupUnits *bool
	if priority == "OFENSIVA" || action == "attack_enemy" || action == "expand_territory" {
		v := true
		allowPush = &v
		g := true
		setGroupUnits = &g
	}
	if priority == "EMERGENCIA" || priority == "DEFENSIVA" {
		v := false
		allowPush = &v
	}

	decision := aiBotDecision{
		Reasoning:          reasoning,
		Priority:           priority,
		Action:             action,
		Target:             target,
		NextIntention:      nextIntention,
		MoveMode:           moveMode,
		BuildHints:         buildHints,
		BuildSequence:      buildSequence,
		AllowPush:          allowPush,
		SetGroupUnits:      setGroupUnits,
		TryCommander:       snap.Gold >= float64(COMMANDER_COST*2) && snap.TroopsAvailable >= 7,
		TryUpgrade:         snap.Gold >= 330 && snap.BuildingCount["GENERATOR"] >= 2,
		UseDefend:          useDefend,
		ChatMessage:        chat,
		MenuUsed:           menu,
		LoadBaseQuery:      query,
		SocialObservation:  observation,
		VocabularyAbsorbed: vocab,
	}
	return decision
}

func (b *localBotBrain) observe(snap localSnapshot) {
	b.lastAbsorbed = b.lastAbsorbed[:0]
	b.observeVocab(snap.Social.ChatLog)
	b.observeLeader(snap.Social)
	b.observeRelationships(snap.Social)
}

func (b *localBotBrain) observeVocab(chat []botSocialChatEntry) {
	if len(chat) == 0 || b.personality.ChatVocabAbsorb <= 0 {
		return
	}
	for _, entry := range chat {
		if !entry.IsHuman {
			continue
		}
		if b.rng.Float64() > b.personality.ChatVocabAbsorb {
			continue
		}
		words := strings.Fields(strings.ToLower(entry.Message))
		for _, w := range words {
			w = strings.Trim(w, ".,!?;:\"'()[]{}")
			if len(w) < 3 || len(w) > 14 {
				continue
			}
			if !containsStringFold(b.learnedVocab, w) {
				b.learnedVocab = append(b.learnedVocab, w)
				b.lastAbsorbed = append(b.lastAbsorbed, w)
				if len(b.learnedVocab) > 60 {
					b.learnedVocab = b.learnedVocab[len(b.learnedVocab)-60:]
				}
			}
			if len(b.lastAbsorbed) >= 5 {
				return
			}
		}
	}
}

func (b *localBotBrain) observeLeader(social botSocialPayload) {
	leader := strings.TrimSpace(social.MatchMeta.WhoIsWinning)
	if leader == "" {
		b.lastObservation = "sem lider claro; plano proprio mantido"
		return
	}
	winning := strings.ToLower(strings.TrimSpace(social.MatchMeta.WinningStrategy))
	effective := strings.ToLower(strings.TrimSpace(social.MatchMeta.MostEffectiveActionThisMatch))
	b.lastObservation = fmt.Sprintf("lider=%s estrategia=%s acao=%s", leader, winning, effective)

	if strings.Contains(winning, "defend") || strings.Contains(winning, "autogen") || effective == "build_autogen" {
		b.learnedEcoTarget = math.Min(6.0, b.learnedEcoTarget+b.personality.LearningRate*0.45)
		b.dynamicAggression = lerpF(b.dynamicAggression, b.personality.AggressionBias*0.85, b.personality.LearningRate*0.18)
	}
	if strings.Contains(winning, "extern") || strings.Contains(winning, "rush") || effective == "attack_enemy" {
		b.learnedAttackTick = int(lerpF(float64(b.learnedAttackTick), float64(maxInt(100, b.learnedAttackTick-50)), b.personality.LearningRate*0.15))
		b.dynamicAggression = math.Min(1.0, b.dynamicAggression+b.personality.LearningRate*0.08)
	}
}

func (b *localBotBrain) observeRelationships(social botSocialPayload) {
	if len(social.MyRelationships.Rivals) > 0 {
		b.currentNemesis = strings.TrimSpace(social.MyRelationships.Rivals[0])
	}
	for _, p := range social.ObservedPlayers {
		name := strings.TrimSpace(p.ID)
		if name == "" {
			continue
		}
		mem, ok := b.knownPlayers[name]
		if !ok {
			mem = &localPlayerMemory{Name: name, Relationship: "neutral"}
			b.knownPlayers[name] = mem
		}
		mem.Seen++
		switch strings.ToLower(strings.TrimSpace(p.RelationshipWithMe)) {
		case "rival":
			mem.Relationship = "rival"
		case "friendly":
			mem.Relationship = "friend"
		}
	}
}

func (b *localBotBrain) calculateActionScores(snap localSnapshot) []localActionScore {
	p := b.personality
	autogens := float64(snap.BuildingCount["GENERATOR"])
	walls := float64(snap.BuildingCount["WALL"])
	barracks := float64(snap.BuildingCount["BARRACKS"])
	turrets := float64(snap.BuildingCount["TURRETS"])

	ecoScore := p.EconomyBias*100 + math.Max(0, (b.learnedEcoTarget-autogens)*15) - math.Max(0, (autogens-b.learnedEcoTarget)*7)
	if snap.Tick < p.EcoPhaseEndTick {
		ecoScore *= 1.35
	}
	ecoScore *= (1 - snap.ThreatLevel*0.30)

	wallScore := p.DefenseBias*80 + snap.ThreatLevel*40 - math.Min(walls*5, 26) + (1-snap.BaseHP)*36
	if snap.UnderAttack {
		wallScore *= 1.45
	}

	barracksScore := (p.AggressionBias*0.58 + p.EconomyBias*0.42) * 70
	barracksScore -= barracks * 11
	if autogens < 2 {
		barracksScore *= 0.32
	}
	if snap.Tick > b.learnedAttackTick-80 {
		barracksScore *= 1.2
	}

	turretScore := p.DefenseBias*62 + snap.ThreatLevel*48 - turrets*10
	if snap.UnderAttack {
		turretScore *= 1.7
	}

	troopScore := p.AggressionBias * 66
	if snap.TroopsAvailable > 8 {
		troopScore -= float64(snap.TroopsAvailable-8) * 2.5
	}
	if snap.Tick > b.learnedAttackTick-65 {
		troopScore *= 1.34
	}
	troopScore *= math.Min(snap.Gold/320, 1.0)

	attackScore := 0.0
	if b.canAttack(snap) {
		attackScore = p.AggressionBias*88 + b.dynamicAggression*22 - (1-snap.BaseHP)*30 + snap.MapControl*16 + float64(snap.TroopsAvailable)*2.1
		for _, e := range snap.Enemies {
			if e.IsNemesis {
				attackScore += 22
			}
		}
	}

	expandScore := p.MapControlBias*72 - snap.ThreatLevel*24 + (0.50-snap.MapControl)*42
	if snap.Tick < 140 {
		expandScore *= 0.62
	}

	reinforceScore := 0.0
	if snap.UnderAttack || snap.BaseHP < p.DefenseActivationHP {
		reinforceScore = p.DefenseBias*100 + (1-snap.BaseHP)*60 + snap.ThreatLevel*38
	}

	repairScore := 0.0
	if snap.BaseHP < 0.72 {
		repairScore = (1-snap.BaseHP)*84 + p.DefenseBias*22
		if snap.BaseHP < 0.30 {
			repairScore *= 1.9
		}
	}

	return []localActionScore{
		{Action: "build_autogen", Score: clampScore(ecoScore)},
		{Action: "build_wall", Score: clampScore(wallScore)},
		{Action: "build_barracks", Score: clampScore(barracksScore)},
		{Action: "build_turret", Score: clampScore(turretScore)},
		{Action: "train_troops", Score: clampScore(troopScore)},
		{Action: "attack_enemy", Score: clampScore(attackScore)},
		{Action: "expand_territory", Score: clampScore(expandScore)},
		{Action: "reinforce_defense", Score: clampScore(reinforceScore)},
		{Action: "repair_base", Score: clampScore(repairScore)},
	}
}

func (b *localBotBrain) canAttack(snap localSnapshot) bool {
	p := b.personality
	return snap.BaseHP >= p.AttackHPThreshold &&
		snap.Gold >= p.AttackResourceThreshold &&
		snap.Tick >= b.learnedAttackTick &&
		snap.TroopsAvailable >= 6 &&
		!snap.UnderAttack
}

func (b *localBotBrain) applyNoise(scores []localActionScore) {
	noise := b.personality.Noise
	for i := range scores {
		delta := b.rng.NormFloat64() * noise * 15
		scores[i].Score = clampScore(scores[i].Score + delta)
	}
	if b.personality.ID == "bot_05" && b.rng.Float64() < 0.14 && len(scores) > 0 {
		i := b.rng.Intn(len(scores))
		scores[i].Score = 100 - scores[i].Score
	}
}

func (b *localBotBrain) selectBestAction(scores []localActionScore) (string, float64) {
	if len(scores) == 0 {
		return "build_autogen", 0
	}
	sort.Slice(scores, func(i, j int) bool {
		return scores[i].Score > scores[j].Score
	})
	if b.personality.ID == "bot_10" && len(scores) > 1 && b.rng.Float64() < 0.25 {
		return scores[1].Action, scores[1].Score
	}
	return scores[0].Action, scores[0].Score
}

func (b *localBotBrain) selectTarget(snap localSnapshot, action string) string {
	if action != "attack_enemy" || len(snap.Enemies) == 0 {
		return ""
	}
	type scored struct {
		id    string
		score float64
	}
	scoredEnemies := make([]scored, 0, len(snap.Enemies))
	for _, e := range snap.Enemies {
		score := (1-e.BaseHP)*50 + (1-e.Distance)*30
		if e.IsNemesis {
			score += 56
		}
		if e.IsFriend {
			score -= 35
		}
		if b.personality.ID == "bot_01" {
			score += (1 - e.Distance) * 20
		}
		if b.personality.ID == "bot_07" {
			score += e.BaseHP * 16
		}
		scoredEnemies = append(scoredEnemies, scored{id: e.ID, score: score})
	}
	sort.Slice(scoredEnemies, func(i, j int) bool { return scoredEnemies[i].score > scoredEnemies[j].score })
	if len(scoredEnemies) == 0 {
		return ""
	}
	return scoredEnemies[0].id
}

func (b *localBotBrain) selectMenu(snap localSnapshot, action string) (string, string) {
	p := b.personality
	if snap.Tick < 35 && p.PreferLoadBase > 0.55 && b.rng.Float64() < p.PreferLoadBase {
		return "LoadBase", b.loadBaseQueryForSnapshot(snap)
	}
	if action == "attack_enemy" || action == "expand_territory" {
		if b.rng.Float64() < p.PreferExternATK {
			return "ExternAtk", ""
		}
	}
	if action == "build_wall" || action == "build_turret" || action == "reinforce_defense" {
		if b.rng.Float64() < p.PreferDefendMenu {
			return "Defend", ""
		}
	}
	if action == "build_autogen" && b.rng.Float64() < p.PreferDefendMenu*0.82 {
		return "Defend", ""
	}
	return "", ""
}

func (b *localBotBrain) loadBaseQueryForSnapshot(snap localSnapshot) string {
	if b.personality.ID == "bot_03" {
		avgAgg := 0.0
		for _, e := range snap.Enemies {
			avgAgg += e.Aggression
		}
		if len(snap.Enemies) > 0 {
			avgAgg /= float64(len(snap.Enemies))
		}
		if avgAgg > 0.62 {
			return "counter rush anti rush fortress"
		}
		return "pressure expand eco rush"
	}
	if b.personality.ID == "bot_09" {
		return "top rated best popular"
	}
	return b.personality.LoadBaseQuery
}

func (b *localBotBrain) determinePriority(snap localSnapshot, action string) string {
	if snap.UnderAttack || snap.BaseHP < b.personality.DefenseActivationHP {
		return "EMERGENCIA"
	}
	switch action {
	case "attack_enemy":
		return "OFENSIVA"
	case "expand_territory":
		return "EXPANSAO"
	case "build_wall", "build_turret", "reinforce_defense":
		return "DEFENSIVA"
	case "repair_base":
		return "EMERGENCIA"
	default:
		return "ECONOMICA"
	}
}

func (b *localBotBrain) buildReasoning(snap localSnapshot, action string, score float64) string {
	return fmt.Sprintf("%s score=%.1f tick=%d hp=%.0f%% gold=%.0f threat=%.2f",
		action, score, snap.Tick, snap.BaseHP*100, snap.Gold, snap.ThreatLevel)
}

func (b *localBotBrain) nextIntention(action string, snap localSnapshot) string {
	switch action {
	case "build_autogen":
		return "completar economia e abrir espaco para tropa"
	case "build_wall", "build_turret", "reinforce_defense":
		return "segurar pressao e estabilizar base"
	case "attack_enemy":
		return "manter pressao no alvo fraco sem overcommit"
	case "expand_territory":
		return "conquistar mapa e pressionar flancos"
	case "repair_base":
		return "recuperar hp antes de retomar ofensiva"
	default:
		return "reavaliar estado e otimizar macro"
	}
}

func (b *localBotBrain) generateChat(snap localSnapshot, action string, target string) string {
	if snap.SilentChat || b.personality.ChatStyle == "silent" || b.personality.ChatFrequency <= 0 {
		return ""
	}
	if b.rng.Float64() > b.personality.ChatFrequency {
		return ""
	}
	if snap.Tick-b.lastChatTick < 12 {
		return ""
	}

	context := "taunt"
	switch {
	case action == "attack_enemy":
		context = "attack"
	case snap.UnderAttack:
		context = "attacked"
	case action == "repair_base":
		context = "attacked"
	}
	if b.currentNemesis != "" && b.rng.Float64() < 0.35 {
		context = "nemesis"
	}

	msg := pickStyleMessage(b.personality.ChatStyle, context, b.rng)
	if msg == "" {
		return ""
	}
	if strings.Contains(msg, "%s") {
		name := b.currentNemesis
		if name == "" {
			name = target
		}
		if name == "" {
			return ""
		}
		msg = fmt.Sprintf(msg, name)
	}
	if b.personality.ID == "bot_07" && action == "attack_enemy" {
		msg = "boa sorte a todos!"
	}
	if b.personality.ID == "bot_09" && len(b.learnedVocab) > 0 && b.rng.Float64() < 0.3 {
		msg = msg + " " + b.learnedVocab[b.rng.Intn(len(b.learnedVocab))]
	}
	msg = sanitizeBotChat(msg)
	if msg == "" {
		return ""
	}
	b.lastChatTick = snap.Tick
	return msg
}

func (b *localBotBrain) learnFromElimination(rt *botRuntime, won bool, killerName, victimName string) {
	var update *botRelationshipUpdate
	b.mu.Lock()

	b.partiesPlayed++
	if won {
		b.winStreak++
		b.lossStreak = 0
		b.dynamicAggression = math.Min(1.0, b.dynamicAggression+b.personality.LearningRate*0.05)
		if b.personality.ID == "bot_01" {
			b.learnedAttackTick = maxInt(90, b.learnedAttackTick-int(8*b.personality.LearningRate))
		}
		if victimName != "" {
			mem := b.ensurePlayerMemory(victimName)
			mem.LossesVsMe++
		}
		b.mu.Unlock()
		persistLocalBrainState(b)
		return
	}

	b.lossStreak++
	b.winStreak = 0
	b.learnedEcoTarget = math.Min(6.0, b.learnedEcoTarget+b.personality.LearningRate*0.6)
	b.learnedAttackTick = minInt(700, b.learnedAttackTick+int(24*b.personality.LearningRate))
	b.dynamicAggression = math.Max(0.05, b.dynamicAggression-b.personality.LearningRate*0.08)

	if killerName != "" {
		mem := b.ensurePlayerMemory(killerName)
		mem.WinsVsMe++
		mem.Relationship = "rival"
		status := "rival"
		if mem.WinsVsMe >= 2 {
			b.currentNemesis = killerName
			status = "nemesis"
		}
		update = &botRelationshipUpdate{
			PlayerID:  killerName,
			NewStatus: status,
			Reason:    "me eliminou em partida",
		}
	}

	if b.lossStreak >= 3 {
		b.dynamicAggression = lerpF(b.dynamicAggression, b.personality.AggressionBias, 0.45)
		b.lossStreak = 0
	}
	b.mu.Unlock()

	if rt != nil && update != nil {
		applyBotSocialDecision(rt, "", nil, update)
	}
	persistLocalBrainState(b)
}

func persistLocalBrainState(brain *localBotBrain) {
	if brain == nil {
		return
	}
	botID := strings.TrimSpace(brain.personality.ID)
	if botID == "" {
		return
	}
	_ = upsertBotPersonalityState(botID, brain)
}

func (b *localBotBrain) ensurePlayerMemory(name string) *localPlayerMemory {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "unknown"
	}
	mem, ok := b.knownPlayers[name]
	if !ok {
		mem = &localPlayerMemory{Name: name, Relationship: "neutral"}
		b.knownPlayers[name] = mem
	}
	mem.Seen++
	return mem
}

func (b *localBotBrain) currentNemesisName() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.currentNemesis
}

func localPersonalityForIdentity(identity botIdentityPreset) localBotPersonality {
	presets := localPersonalities()
	id := strings.TrimSpace(identity.ID)
	if p, ok := presets[id]; ok {
		return p
	}
	return localBotPersonality{
		ID:                      "default",
		Name:                    "DEFAULT",
		Tag:                     "[BOT]",
		AggressionBias:          0.55,
		EconomyBias:             0.55,
		DefenseBias:             0.55,
		MapControlBias:          0.55,
		Patience:                0.55,
		AttackHPThreshold:       0.62,
		AttackResourceThreshold: 340,
		AttackTickMinimum:       200,
		EcoPhaseEndTick:         150,
		DefenseActivationHP:     0.45,
		ChatFrequency:           0.18,
		ChatStyle:               "observer",
		ChatVocabAbsorb:         0.40,
		LearningRate:            0.55,
		ImitationThreshold:      3,
		Noise:                   0.15,
		PreferDefendMenu:        0.5,
		PreferExternATK:         0.5,
		PreferLoadBase:          0.5,
		LoadBaseQuery:           "hybrid popular",
	}
}

func localPersonalities() map[string]localBotPersonality {
	return map[string]localBotPersonality{
		"bot_01": {ID: "bot_01", Name: "BRUTO", Tag: "[BRUTO]", AggressionBias: 0.92, EconomyBias: 0.25, DefenseBias: 0.15, MapControlBias: 0.30, Patience: 0.08, AttackHPThreshold: 0.45, AttackResourceThreshold: 200, AttackTickMinimum: 120, EcoPhaseEndTick: 100, DefenseActivationHP: 0.30, ChatFrequency: 0.20, ChatStyle: "aggressive", ChatVocabAbsorb: 0.20, LearningRate: 0.40, ImitationThreshold: 5, Noise: 0.16, PreferDefendMenu: 0.10, PreferExternATK: 0.86, PreferLoadBase: 0.26, LoadBaseQuery: "rush atk ofensivo pressure"},
		"bot_02": {ID: "bot_02", Name: "AEGIS", Tag: "[AEGIS]", AggressionBias: 0.35, EconomyBias: 0.65, DefenseBias: 0.90, MapControlBias: 0.50, Patience: 0.85, AttackHPThreshold: 0.82, AttackResourceThreshold: 500, AttackTickMinimum: 350, EcoPhaseEndTick: 200, DefenseActivationHP: 0.60, ChatFrequency: 0.10, ChatStyle: "technical", ChatVocabAbsorb: 0.15, LearningRate: 0.60, ImitationThreshold: 3, Noise: 0.05, PreferDefendMenu: 0.86, PreferExternATK: 0.20, PreferLoadBase: 0.45, LoadBaseQuery: "defend wall fortress camadas"},
		"bot_03": {ID: "bot_03", Name: "NOVA", Tag: "[NOVA]", AggressionBias: 0.55, EconomyBias: 0.55, DefenseBias: 0.55, MapControlBias: 0.65, Patience: 0.55, AttackHPThreshold: 0.60, AttackResourceThreshold: 350, AttackTickMinimum: 200, EcoPhaseEndTick: 150, DefenseActivationHP: 0.45, ChatFrequency: 0.22, ChatStyle: "observer", ChatVocabAbsorb: 0.85, LearningRate: 0.90, ImitationThreshold: 2, Noise: 0.20, PreferDefendMenu: 0.50, PreferExternATK: 0.50, PreferLoadBase: 0.90, LoadBaseQuery: "top rated popular"},
		"bot_04": {ID: "bot_04", Name: "REX", Tag: "[REX]", AggressionBias: 0.45, EconomyBias: 0.80, DefenseBias: 0.65, MapControlBias: 0.60, Patience: 0.90, AttackHPThreshold: 0.70, AttackResourceThreshold: 600, AttackTickMinimum: 400, EcoPhaseEndTick: 250, DefenseActivationHP: 0.50, ChatFrequency: 0.14, ChatStyle: "wise", ChatVocabAbsorb: 0.25, LearningRate: 0.45, ImitationThreshold: 3, Noise: 0.08, PreferDefendMenu: 0.75, PreferExternATK: 0.35, PreferLoadBase: 0.40, LoadBaseQuery: "eco autogen classic farm"},
		"bot_05": {ID: "bot_05", Name: "GLITCH", Tag: "[GLITCH]", AggressionBias: 0.50, EconomyBias: 0.50, DefenseBias: 0.50, MapControlBias: 0.40, Patience: 0.45, AttackHPThreshold: 0.50, AttackResourceThreshold: 300, AttackTickMinimum: 100, EcoPhaseEndTick: 120, DefenseActivationHP: 0.40, ChatFrequency: 0.28, ChatStyle: "chaotic", ChatVocabAbsorb: 0.60, LearningRate: 0.55, ImitationThreshold: 2, Noise: 0.80, PreferDefendMenu: 0.50, PreferExternATK: 0.50, PreferLoadBase: 0.50, LoadBaseQuery: "experimental unusual chaos"},
		"bot_06": {ID: "bot_06", Name: "FERRO", Tag: "[FERRO]", AggressionBias: 0.30, EconomyBias: 0.98, DefenseBias: 0.40, MapControlBias: 0.20, Patience: 0.95, AttackHPThreshold: 0.75, AttackResourceThreshold: 800, AttackTickMinimum: 500, EcoPhaseEndTick: 350, DefenseActivationHP: 0.35, ChatFrequency: 0.04, ChatStyle: "silent", ChatVocabAbsorb: 0.02, LearningRate: 0.30, ImitationThreshold: 6, Noise: 0.05, PreferDefendMenu: 0.80, PreferExternATK: 0.15, PreferLoadBase: 0.30, LoadBaseQuery: "autogen max eco pure farm"},
		"bot_07": {ID: "bot_07", Name: "VIPER", Tag: "[VIPER]", AggressionBias: 0.75, EconomyBias: 0.50, DefenseBias: 0.45, MapControlBias: 0.55, Patience: 0.65, AttackHPThreshold: 0.55, AttackResourceThreshold: 350, AttackTickMinimum: 250, EcoPhaseEndTick: 180, DefenseActivationHP: 0.40, ChatFrequency: 0.32, ChatStyle: "friendly", ChatVocabAbsorb: 0.70, LearningRate: 0.65, ImitationThreshold: 2, Noise: 0.25, PreferDefendMenu: 0.30, PreferExternATK: 0.75, PreferLoadBase: 0.50, LoadBaseQuery: "counter trap surprise bait"},
		"bot_08": {ID: "bot_08", Name: "STORM", Tag: "[STORM]", AggressionBias: 0.60, EconomyBias: 0.55, DefenseBias: 0.60, MapControlBias: 0.95, Patience: 0.70, AttackHPThreshold: 0.65, AttackResourceThreshold: 400, AttackTickMinimum: 280, EcoPhaseEndTick: 160, DefenseActivationHP: 0.45, ChatFrequency: 0.20, ChatStyle: "map", ChatVocabAbsorb: 0.35, LearningRate: 0.60, ImitationThreshold: 3, Noise: 0.12, PreferDefendMenu: 0.55, PreferExternATK: 0.65, PreferLoadBase: 0.45, LoadBaseQuery: "expand map control territory flank"},
		"bot_09": {ID: "bot_09", Name: "ROOKIE", Tag: "[ROOKIE]", AggressionBias: 0.50, EconomyBias: 0.50, DefenseBias: 0.50, MapControlBias: 0.50, Patience: 0.40, AttackHPThreshold: 0.55, AttackResourceThreshold: 280, AttackTickMinimum: 180, EcoPhaseEndTick: 130, DefenseActivationHP: 0.45, ChatFrequency: 0.38, ChatStyle: "rookie", ChatVocabAbsorb: 0.95, LearningRate: 0.95, ImitationThreshold: 1, Noise: 0.30, PreferDefendMenu: 0.40, PreferExternATK: 0.40, PreferLoadBase: 0.90, LoadBaseQuery: "top rated best popular"},
		"bot_10": {ID: "bot_10", Name: "PHANTOM", Tag: "[PHANTOM]", AggressionBias: 0.65, EconomyBias: 0.60, DefenseBias: 0.60, MapControlBias: 0.70, Patience: 0.75, AttackHPThreshold: 0.60, AttackResourceThreshold: 400, AttackTickMinimum: 200, EcoPhaseEndTick: 150, DefenseActivationHP: 0.45, ChatFrequency: 0.0, ChatStyle: "silent", ChatVocabAbsorb: 0.0, LearningRate: 0.70, ImitationThreshold: 3, Noise: 0.45, PreferDefendMenu: 0.50, PreferExternATK: 0.50, PreferLoadBase: 0.40, LoadBaseQuery: "obscure old unknown"},
	}
}

func actionToBuildHints(action, priority string) ([]string, []string) {
	switch action {
	case "build_autogen":
		return []string{"GENERATOR", "HOUSE"}, []string{"GENERATOR"}
	case "build_wall":
		return []string{"WALL"}, []string{"WALL"}
	case "build_barracks":
		return []string{"BARRACKS"}, []string{"BARRACKS"}
	case "build_turret":
		return []string{"SIMPLE_TURRET", "SNIPER_TURRET"}, []string{"SIMPLE_TURRET"}
	case "train_troops":
		return []string{"BARRACKS"}, nil
	case "expand_territory":
		return []string{"BARRACKS", "SIMPLE_TURRET"}, nil
	case "reinforce_defense":
		return []string{"WALL", "SIMPLE_TURRET", "SNIPER_TURRET"}, []string{"WALL"}
	case "repair_base":
		return []string{"WALL", "SIMPLE_TURRET"}, nil
	case "attack_enemy":
		return []string{"BARRACKS", "SIMPLE_TURRET"}, nil
	default:
		if priority == "DEFENSIVA" || priority == "EMERGENCIA" {
			return []string{"WALL", "SIMPLE_TURRET"}, nil
		}
		return []string{"GENERATOR", "HOUSE"}, nil
	}
}

func actionToMoveMode(priority, action string) string {
	switch {
	case priority == "EMERGENCIA" || priority == "DEFENSIVA":
		return "defend"
	case action == "expand_territory":
		return "flank"
	case action == "attack_enemy":
		return "pressure"
	default:
		return "regroup"
	}
}

var localChatTemplates = map[string]map[string][]string{
	"aggressive": {
		"attack":   {"to indo", "ja era", "sem chance", "corre"},
		"attacked": {"isso tudo?", "erraste o timing", "foi mal kk"},
		"taunt":    {"nem defende", "base de papel", "to esperando"},
		"nemesis":  {"dessa vez nao escapa %s", "to vindo %s"},
	},
	"technical": {
		"attack":   {"janela identificada. iniciando pressao."},
		"attacked": {"ataque ineficiente detectado.", "dano insuficiente."},
		"taunt":    {"erro de timing detectado.", "sua taxa de sucesso caiu."},
		"nemesis":  {"alvo prioritario: %s.", "neutralizando %s."},
	},
	"friendly": {
		"attack":   {"boa sorte a todos!", "que ganhe o melhor!"},
		"attacked": {"jogada bonita essa sua", "impressionante timing"},
		"taunt":    {"que base bonita voce tem", "estrategia interessante"},
		"nemesis":  {"%s, respeito seu jogo", "admiro voce %s"},
	},
	"observer": {
		"attack":   {"mudando de plano", "testando essa abordagem"},
		"attacked": {"hmm timing estranho", "interessante"},
		"taunt":    {"ninguem expandiu ainda", "mapa quieto demais"},
		"nemesis":  {"de novo %s", "%s sempre aparece"},
	},
	"wise": {
		"attack":   {"hora de encerrar isso", "chegou a hora"},
		"attacked": {"vi isso vindo", "esperava isso"},
		"taunt":    {"paciencia vence partida", "autogen antes de parede"},
		"nemesis":  {"conheco seu jogo, %s", "voce e eu de novo, %s"},
	},
	"chaotic": {
		"attack":   {"o mapa sabe", "sim. nao. ataque.", "resultado: sim"},
		"attacked": {"erro 404 defesa", "parametro inesperado"},
		"taunt":    {"o hexagono lembra", "variavel indefinida"},
		"nemesis":  {"%s registrado atacado", "sequencia %s imprevisivel"},
	},
	"silent": {
		"attack":   {},
		"attacked": {},
		"taunt":    {},
		"nemesis":  {},
	},
	"map": {
		"attack":   {"circundando agora", "mais um setor"},
		"attacked": {"flanco comprometido"},
		"taunt":    {"norte ta aberto", "flanco exposto"},
		"nemesis":  {"cortando o mapa de %s", "%s sem flanco"},
	},
	"rookie": {
		"attack":   {"VAMOS!", "to indo kk", "hora h!"},
		"attacked": {"que foi isso kkk", "errei o timing"},
		"taunt":    {"to aprendendo ainda", "como fez isso?"},
		"nemesis":  {"NAO DESSA VEZ %s", "to pronto pra vc %s"},
	},
}

func pickStyleMessage(style, context string, rng *rand.Rand) string {
	style = strings.ToLower(strings.TrimSpace(style))
	ctxMap := localChatTemplates[style]
	if ctxMap == nil {
		return ""
	}
	msgs := ctxMap[context]
	if len(msgs) == 0 {
		return ""
	}
	return msgs[rng.Intn(len(msgs))]
}

func containsStringFold(list []string, value string) bool {
	for _, item := range list {
		if strings.EqualFold(strings.TrimSpace(item), strings.TrimSpace(value)) {
			return true
		}
	}
	return false
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func clampScore(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

func lerpF(a, b, t float64) float64 {
	return a + (b-a)*t
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
