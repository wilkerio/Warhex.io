package game

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

// ============================================================
// RL Core Types
// ============================================================

type GameSnapshot struct {
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
	Enemies         []EnemyInfo
	ChatFeed        []ChatEntry
	PlayerActions   []PlayerAction
	Leaderboard     []RLLeaderboardEntry
}

type EnemyInfo struct {
	ID         string
	Distance   float64
	BaseHP     float64
	Aggression float64
	IsNemesis  bool
	IsFriend   bool
}

type ChatEntry struct {
	PlayerName string
	Message    string
	Tick       int
	IsHuman    bool
}

type PlayerAction struct {
	PlayerName string
	Action     string
	Result     string
	Outcome    string
	Tick       int
}

type RLLeaderboardEntry struct {
	Rank      int
	Name      string
	MapCtrl   float64
	BaseHP    float64
	Strategy  string
	IsWinning bool
}

type StateKey struct {
	GamePhase     int8
	BaseHPBucket  int8
	GoldBucket    int8
	AutogenBucket int8
	TroopsBucket  int8
	ThreatBucket  int8
	MapBucket     int8
	UnderAttack   int8
}

func DiscretizeState(snap GameSnapshot) StateKey {
	phase := int8(0)
	if snap.Tick > 400 {
		phase = 2
	} else if snap.Tick > 150 {
		phase = 1
	}

	hpBucket := int8(math.Min(3, math.Floor(clamp01(snap.BaseHP)*4)))
	goldBucket := int8(math.Min(4, math.Floor(math.Max(0, snap.Gold)/200)))
	autogenBucket := int8(math.Min(4, float64(maxInt(0, snap.BuildingCount["GENERATOR"]))))

	troopsBucket := int8(0)
	if snap.TroopsAvailable >= 15 {
		troopsBucket = 3
	} else if snap.TroopsAvailable >= 5 {
		troopsBucket = 2
	} else if snap.TroopsAvailable > 0 {
		troopsBucket = 1
	}

	threatBucket := int8(math.Min(3, math.Floor(clamp01(snap.ThreatLevel)*4)))
	mapBucket := int8(math.Min(3, math.Floor(clamp01(snap.MapControl)*4)))
	underAttack := int8(0)
	if snap.UnderAttack {
		underAttack = 1
	}

	return StateKey{
		GamePhase:     phase,
		BaseHPBucket:  hpBucket,
		GoldBucket:    goldBucket,
		AutogenBucket: autogenBucket,
		TroopsBucket:  troopsBucket,
		ThreatBucket:  threatBucket,
		MapBucket:     mapBucket,
		UnderAttack:   underAttack,
	}
}

type ActionID int

const (
	ActionBuildAutogen ActionID = iota
	ActionBuildWall
	ActionBuildBarracks
	ActionBuildTurret
	ActionTrainTroops
	ActionAttackEnemy
	ActionExpandTerritory
	ActionReinforceDefense
	ActionRepairBase
	ActionCount
)

var ActionNames = map[ActionID]string{
	ActionBuildAutogen:     "build_autogen",
	ActionBuildWall:        "build_wall",
	ActionBuildBarracks:    "build_barracks",
	ActionBuildTurret:      "build_turret",
	ActionTrainTroops:      "train_troops",
	ActionAttackEnemy:      "attack_enemy",
	ActionExpandTerritory:  "expand_territory",
	ActionReinforceDefense: "reinforce_defense",
	ActionRepairBase:       "repair_base",
}

func actionIDByName(name string) ActionID {
	normalized := strings.ToLower(strings.TrimSpace(name))
	for id, actionName := range ActionNames {
		if actionName == normalized {
			return id
		}
	}
	return ActionBuildAutogen
}

type qEntry [ActionCount]float64

type QTable struct {
	mu     sync.RWMutex
	Values map[StateKey]qEntry
	Visits map[StateKey]int
}

func NewQTable() *QTable {
	return &QTable{
		Values: make(map[StateKey]qEntry),
		Visits: make(map[StateKey]int),
	}
}

func (qt *QTable) Get(state StateKey, action ActionID) float64 {
	qt.mu.RLock()
	defer qt.mu.RUnlock()
	if vals, ok := qt.Values[state]; ok {
		return vals[action]
	}
	return 0
}

func (qt *QTable) GetMax(state StateKey) float64 {
	qt.mu.RLock()
	defer qt.mu.RUnlock()
	vals, ok := qt.Values[state]
	if !ok {
		return 0
	}
	maxValue := vals[0]
	for i := 1; i < int(ActionCount); i++ {
		if vals[i] > maxValue {
			maxValue = vals[i]
		}
	}
	return maxValue
}

func (qt *QTable) GetBestAction(state StateKey) ActionID {
	qt.mu.RLock()
	defer qt.mu.RUnlock()
	vals, ok := qt.Values[state]
	if !ok {
		return ActionBuildAutogen
	}
	best := ActionID(0)
	for i := ActionID(1); i < ActionCount; i++ {
		if vals[i] > vals[best] {
			best = i
		}
	}
	return best
}

func (qt *QTable) Update(state StateKey, action ActionID, reward float64, nextState StateKey, alpha, gamma float64) {
	qt.mu.Lock()
	defer qt.mu.Unlock()

	vals := qt.Values[state]
	currentQ := vals[action]

	maxNextQ := 0.0
	if nextVals, ok := qt.Values[nextState]; ok {
		maxNextQ = nextVals[0]
		for i := 1; i < int(ActionCount); i++ {
			if nextVals[i] > maxNextQ {
				maxNextQ = nextVals[i]
			}
		}
	}

	newQ := currentQ + alpha*(reward+gamma*maxNextQ-currentQ)
	vals[action] = newQ
	qt.Values[state] = vals
	qt.Visits[state]++
}

func (qt *QTable) VisitCount(state StateKey) int {
	qt.mu.RLock()
	defer qt.mu.RUnlock()
	return qt.Visits[state]
}

type PersonalityBias struct {
	WinWeight      float64
	MapWeight      float64
	KillWeight     float64
	EcoWeight      float64
	SurvivalWeight float64
}

var PersonalityBiases = map[string]PersonalityBias{
	"bot_01": {WinWeight: 1.5, MapWeight: 0.5, KillWeight: 2.0, EcoWeight: 0.3, SurvivalWeight: 0.5},
	"bot_02": {WinWeight: 1.2, MapWeight: 0.8, KillWeight: 0.8, EcoWeight: 1.5, SurvivalWeight: 1.5},
	"bot_03": {WinWeight: 1.0, MapWeight: 1.5, KillWeight: 1.0, EcoWeight: 1.0, SurvivalWeight: 1.0},
	"bot_04": {WinWeight: 1.0, MapWeight: 1.0, KillWeight: 0.8, EcoWeight: 2.0, SurvivalWeight: 1.5},
	"bot_05": {WinWeight: 0.8, MapWeight: 0.8, KillWeight: 1.2, EcoWeight: 0.8, SurvivalWeight: 0.8},
	"bot_06": {WinWeight: 1.0, MapWeight: 0.5, KillWeight: 0.5, EcoWeight: 3.0, SurvivalWeight: 1.0},
	"bot_07": {WinWeight: 1.5, MapWeight: 0.8, KillWeight: 1.5, EcoWeight: 0.8, SurvivalWeight: 0.8},
	"bot_08": {WinWeight: 1.0, MapWeight: 3.0, KillWeight: 0.8, EcoWeight: 0.8, SurvivalWeight: 1.0},
	"bot_09": {WinWeight: 1.0, MapWeight: 1.0, KillWeight: 1.0, EcoWeight: 1.0, SurvivalWeight: 1.0},
	"bot_10": {WinWeight: 1.2, MapWeight: 1.2, KillWeight: 1.2, EcoWeight: 1.2, SurvivalWeight: 1.2},
}

type RLAgent struct {
	BotID string
	Name  string

	QTable *QTable

	Alpha        float64
	Gamma        float64
	Epsilon      float64
	EpsilonMin   float64
	EpsilonDecay float64

	LastState  *StateKey
	LastAction ActionID

	EpisodesPlayed int
	TotalReward    float64
	WinRate        float64
	RewardHistory  []float64

	PersonalityBias PersonalityBias

	rng *rand.Rand
	mu  sync.Mutex
}

func NewRLAgent(botID, name string) *RLAgent {
	bias, ok := PersonalityBiases[botID]
	if !ok {
		bias = PersonalityBias{1, 1, 1, 1, 1}
	}
	return &RLAgent{
		BotID:           botID,
		Name:            name,
		QTable:          NewQTable(),
		Alpha:           0.15,
		Gamma:           0.95,
		Epsilon:         1.0,
		EpsilonMin:      0.05,
		EpsilonDecay:    0.995,
		PersonalityBias: bias,
		RewardHistory:   make([]float64, 0, 100),
		rng:             rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

func (agent *RLAgent) SelectAction(snap GameSnapshot) ActionID {
	state := DiscretizeState(snap)

	agent.mu.Lock()
	agent.LastState = &state
	agent.mu.Unlock()

	if agent.rng.Float64() < agent.Epsilon {
		action := agent.randomActionWithBias(snap)
		action = agent.filterInvalidAction(action, snap)
		agent.mu.Lock()
		agent.LastAction = action
		agent.mu.Unlock()
		return action
	}

	best := agent.QTable.GetBestAction(state)
	best = agent.filterInvalidAction(best, snap)
	agent.mu.Lock()
	agent.LastAction = best
	agent.mu.Unlock()
	return best
}

func (agent *RLAgent) randomActionWithBias(snap GameSnapshot) ActionID {
	b := agent.PersonalityBias
	weights := [ActionCount]float64{
		ActionBuildAutogen:     b.EcoWeight,
		ActionBuildWall:        b.SurvivalWeight,
		ActionBuildBarracks:    b.KillWeight * 0.5,
		ActionBuildTurret:      b.SurvivalWeight * 0.7,
		ActionTrainTroops:      b.KillWeight,
		ActionAttackEnemy:      b.KillWeight * b.WinWeight,
		ActionExpandTerritory:  b.MapWeight,
		ActionReinforceDefense: b.SurvivalWeight,
		ActionRepairBase:       b.SurvivalWeight * (1 - clamp01(snap.BaseHP)),
	}
	total := 0.0
	for _, w := range weights {
		total += math.Max(0.01, w)
	}
	r := agent.rng.Float64() * total
	cumulative := 0.0
	for action := ActionID(0); action < ActionCount; action++ {
		cumulative += math.Max(0.01, weights[action])
		if r <= cumulative {
			return action
		}
	}
	return ActionBuildAutogen
}

func (agent *RLAgent) filterInvalidAction(action ActionID, snap GameSnapshot) ActionID {
	switch action {
	case ActionAttackEnemy:
		if snap.TroopsAvailable < 3 || snap.BaseHP < 0.2 {
			return ActionBuildAutogen
		}
	case ActionRepairBase:
		if snap.BaseHP > 0.9 {
			return ActionBuildAutogen
		}
	case ActionReinforceDefense:
		if !snap.UnderAttack && snap.ThreatLevel < 0.3 {
			return agent.QTable.GetBestAction(DiscretizeState(snap))
		}
	}
	return action
}

type MatchOutcome struct {
	Won             bool
	Rank            int
	TotalPlayers    int
	TicksSurvived   int
	EnemiesKilled   int
	FinalMapControl float64
	FinalGold       float64
	PeakMapControl  float64
	AutogensBuilt   int
	DamageDealt     float64
	DamageTaken     float64
}

type StepReward struct {
	Tick            int
	MapControlDelta float64
	GoldDelta       float64
	HPDelta         float64
	KilledEnemy     bool
	GotEliminated   bool
}

func (agent *RLAgent) CalculateStepReward(step StepReward) float64 {
	b := agent.PersonalityBias
	reward := 0.0
	reward += step.MapControlDelta * 10.0 * b.MapWeight
	if step.GoldDelta > 0 {
		reward += (step.GoldDelta / 100.0) * b.EcoWeight
	}
	if step.HPDelta < 0 {
		reward += step.HPDelta * 5.0 * b.SurvivalWeight
	}
	if step.KilledEnemy {
		reward += 20.0 * b.KillWeight
	}
	if step.GotEliminated {
		reward -= 50.0 * b.SurvivalWeight
	}
	return reward
}

func (agent *RLAgent) CalculateFinalReward(outcome MatchOutcome) float64 {
	b := agent.PersonalityBias
	reward := 0.0
	if outcome.Won {
		reward += 100.0 * b.WinWeight
	} else {
		denom := maxInt(1, outcome.TotalPlayers-1)
		rankPenalty := float64(maxInt(0, outcome.Rank-1)) / float64(denom)
		reward -= rankPenalty * 30.0 * b.WinWeight
	}

	reward += clamp01(outcome.FinalMapControl) * 50.0 * b.MapWeight
	reward += clamp01(outcome.PeakMapControl) * 20.0 * b.MapWeight
	reward += float64(maxInt(0, outcome.EnemiesKilled)) * 15.0 * b.KillWeight
	reward += float64(maxInt(0, outcome.AutogensBuilt)) * 5.0 * b.EcoWeight
	if outcome.FinalGold > 800 && !outcome.Won {
		reward -= (outcome.FinalGold - 800) / 100.0 * b.EcoWeight
	}
	reward += float64(maxInt(0, outcome.TicksSurvived/100)) * 5.0 * b.SurvivalWeight
	if outcome.DamageTaken > 0 {
		combatEfficiency := outcome.DamageDealt / outcome.DamageTaken
		reward += math.Min(combatEfficiency*5.0, 20.0) * b.KillWeight
	}
	return reward
}

func (agent *RLAgent) Learn(nextSnap GameSnapshot, stepReward float64) {
	agent.mu.Lock()
	lastState := agent.LastState
	lastAction := agent.LastAction
	agent.mu.Unlock()
	if lastState == nil {
		return
	}
	nextState := DiscretizeState(nextSnap)
	agent.QTable.Update(*lastState, lastAction, stepReward, nextState, agent.Alpha, agent.Gamma)
}

func (agent *RLAgent) EndEpisode(outcome MatchOutcome) {
	finalReward := agent.CalculateFinalReward(outcome)

	agent.mu.Lock()
	if agent.LastState != nil {
		agent.QTable.Update(*agent.LastState, agent.LastAction, finalReward, *agent.LastState, agent.Alpha, 0)
	}

	agent.EpisodesPlayed++
	agent.TotalReward += finalReward
	agent.RewardHistory = append(agent.RewardHistory, finalReward)
	if len(agent.RewardHistory) > 100 {
		agent.RewardHistory = agent.RewardHistory[1:]
	}

	wins := 0
	for _, r := range agent.RewardHistory {
		if r > 50 {
			wins++
		}
	}
	if len(agent.RewardHistory) > 0 {
		agent.WinRate = float64(wins) / float64(len(agent.RewardHistory))
	}

	if agent.Epsilon > agent.EpsilonMin {
		agent.Epsilon *= agent.EpsilonDecay
		if agent.Epsilon < agent.EpsilonMin {
			agent.Epsilon = agent.EpsilonMin
		}
	}
	agent.LastState = nil
	episodes := agent.EpisodesPlayed
	winRate := agent.WinRate
	epsilon := agent.Epsilon
	agent.mu.Unlock()

	if save, ok := agent.exportSave(); ok {
		if qtableJSON, err := json.Marshal(save.Values); err == nil {
			_ = upsertBotQTable(agent.BotID, episodes, winRate, epsilon, qtableJSON)
		}
	}
}

// ============================================================
// Trainer & Environment
// ============================================================

type TrainingConfig struct {
	Episodes        int
	MaxTicksPerGame int
	NumBots         int
	SpeedMultiplier float64
	SaveEvery       int
	LogEvery        int
	OutputDir       string
}

type AgentStats struct {
	BotID      string
	Name       string
	Episodes   int
	WinRate    float64
	AvgReward  float64
	Epsilon    float64
	QTableSize int
	BestReward float64
}

type TrainingStats struct {
	Episode     int
	AgentStats  map[string]AgentStats
	ElapsedTime time.Duration
	ETA         time.Duration
}

type GameEnvironment interface {
	Reset(numBots int)
	GetSnapshot(botID string) GameSnapshot
	ExecuteAction(botID string, action string)
	IsEliminated(botID string) bool
	IsGameOver() bool
	KilledEnemyThisTick(botID string) bool
	GetOutcome(botID string) MatchOutcome
}

// HeadlessEnv implementa GameEnvironment usando o State global do jogo.
// Nao requer injecao de estado: acessa State diretamente no mesmo package.
type HeadlessEnv struct {
	killsThisTick map[string]bool
	eliminated    map[string]bool
	snapshots     map[string]GameSnapshot
	outcomes      map[string]MatchOutcome
	actions       map[string]string
	lastKills     map[string]uint32
	peakMapCtrl   map[string]float64
	trainingBots  []string
	gameOver      bool
	episodeStart  time.Time
	mu            sync.Mutex
}

func NewHeadlessEnv() *HeadlessEnv {
	return &HeadlessEnv{
		killsThisTick: make(map[string]bool),
		eliminated:    make(map[string]bool),
		snapshots:     make(map[string]GameSnapshot),
		outcomes:      make(map[string]MatchOutcome),
		actions:       make(map[string]string),
		lastKills:     make(map[string]uint32),
		peakMapCtrl:   make(map[string]float64),
		episodeStart:  time.Now(),
	}
}

func (h *HeadlessEnv) Reset(numBots int) {
	h.mu.Lock()
	h.killsThisTick = make(map[string]bool)
	h.eliminated = make(map[string]bool)
	h.snapshots = make(map[string]GameSnapshot)
	h.outcomes = make(map[string]MatchOutcome)
	h.actions = make(map[string]string)
	h.lastKills = make(map[string]uint32)
	h.peakMapCtrl = make(map[string]float64)
	h.trainingBots = h.discoverTrainingBots(numBots)
	h.episodeStart = time.Now()
	h.gameOver = false
	h.mu.Unlock()
}

func (h *HeadlessEnv) GetSnapshot(botID string) GameSnapshot {
	player, rt := h.resolveBot(botID)
	if player == nil {
		h.mu.Lock()
		h.eliminated[botID] = true
		last := h.snapshots[botID]
		h.mu.Unlock()
		if last.BuildingCount == nil {
			last.BuildingCount = map[string]int{}
		}
		return last
	}

	snap := buildRLSnapshotFromRuntime(player, rt)
	kills := player.GetKills()

	h.mu.Lock()
	prevKills := h.lastKills[botID]
	h.killsThisTick[botID] = kills > prevKills
	h.lastKills[botID] = kills
	if snap.MapControl > h.peakMapCtrl[botID] {
		h.peakMapCtrl[botID] = snap.MapControl
	}
	h.snapshots[botID] = snap
	h.eliminated[botID] = false
	h.mu.Unlock()

	return snap
}

func buildRLSnapshotFromRuntime(player *Player, rt *botRuntime) GameSnapshot {
	if player == nil || player.Base == nil {
		return GameSnapshot{BuildingCount: map[string]int{}}
	}
	if rt != nil {
		return gameSnapshotFromLocalSnapshot(buildLocalSnapshot(player, rt, time.Now()))
	}

	summary := summarizeBotBuildings(player.Base)
	power := float64(readCurrentPower(player))
	freePop := float64(readFreePopulation(player))
	units := readUnitCount(player)
	underAttack := player.WasBaseDamagedWithin(12 * time.Second)
	baseHP := 1.0
	player.Base.Health.RLock()
	if player.Base.Health.Max > 0 {
		baseHP = float64(player.Base.Health.Current) / float64(player.Base.Health.Max)
	}
	player.Base.Health.RUnlock()
	return GameSnapshot{
		Tick:            int(time.Since(player.StartTime).Seconds()),
		Gold:            power,
		Food:            freePop,
		BaseHP:          clamp01(baseHP),
		MapControl:      estimateMapControl(player),
		TroopsAvailable: units,
		TroopsDeployed:  0,
		BuildingCount: map[string]int{
			"GENERATOR": summary.gens,
			"HOUSE":     summary.houses,
			"BARRACKS":  summary.barracks,
			"WALL":      summary.walls,
			"TURRETS":   summary.turrets + summary.snipers,
		},
		UnderAttack: underAttack,
		ThreatLevel: clamp01(float64(len(buildRLEnemies(player, nil)))*0.15 + map[bool]float64{true: 0.6, false: 0.2}[underAttack]),
		Enemies:     buildRLEnemies(player, nil),
		ChatFeed:    chatFeedFromSocialEntries(getRecentSocialChatLog(30, 40)),
		Leaderboard: buildRLLeaderboard(),
	}
}

func (h *HeadlessEnv) ExecuteAction(botID string, action string) {
	player, rt := h.resolveBot(botID)
	if player == nil || rt == nil {
		return
	}
	action = strings.ToLower(strings.TrimSpace(action))

	h.mu.Lock()
	h.actions[botID] = action
	h.mu.Unlock()

	plan := rt.thought
	plan.validUntil = time.Now().Add(12 * time.Second)

	switch action {
	case "build_autogen":
		plan.buildSequence = prependBuildSequence(plan.buildSequence, GENERATOR)
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, GENERATOR, HOUSE)
	case "build_wall":
		plan.buildSequence = prependBuildSequence(plan.buildSequence, WALL)
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, WALL, SIMPLE_TURRET)
	case "build_barracks":
		plan.buildSequence = prependBuildSequence(plan.buildSequence, BARRACKS)
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, BARRACKS)
	case "build_turret":
		plan.buildSequence = prependBuildSequence(plan.buildSequence, SIMPLE_TURRET)
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, SIMPLE_TURRET, SNIPER_TURRET)
	case "train_troops":
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, BARRACKS)
		grouped := true
		plan.setGroupUnits = &grouped
	case "attack_enemy":
		mode := movePressure
		plan.forceMode = &mode
		push := true
		grouped := true
		plan.allowPush = &push
		plan.setGroupUnits = &grouped
	case "expand_territory":
		mode := moveFlank
		plan.forceMode = &mode
		push := true
		plan.allowPush = &push
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, BARRACKS, SIMPLE_TURRET)
	case "reinforce_defense":
		mode := moveDefend
		plan.forceMode = &mode
		plan.useDefend = true
		push := false
		plan.allowPush = &push
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, WALL, SIMPLE_TURRET, SNIPER_TURRET)
	case "repair_base":
		mode := moveDefend
		plan.forceMode = &mode
		plan.useDefend = true
		push := false
		plan.allowPush = &push
	}
	rt.thought = plan
}

func (h *HeadlessEnv) IsEliminated(botID string) bool {
	player, _ := h.resolveBot(botID)
	eliminated := player == nil || player.IsMarkedForRemoval() || player.Base == nil
	h.mu.Lock()
	h.eliminated[botID] = eliminated
	h.mu.Unlock()
	return eliminated
}

func (h *HeadlessEnv) IsGameOver() bool {
	State.RLock()
	active := 0
	for _, p := range State.Players {
		if p == nil || p.IsMarkedForRemoval() || p.Base == nil {
			continue
		}
		active++
	}
	State.RUnlock()
	over := active <= 1
	h.mu.Lock()
	h.gameOver = over
	h.mu.Unlock()
	return over
}

func (h *HeadlessEnv) KilledEnemyThisTick(botID string) bool {
	h.mu.Lock()
	killed := h.killsThisTick[botID]
	h.killsThisTick[botID] = false
	h.mu.Unlock()
	return killed
}

func (h *HeadlessEnv) GetOutcome(botID string) MatchOutcome {
	player, _ := h.resolveBot(botID)
	if player == nil || player.Base == nil {
		h.mu.Lock()
		out, ok := h.outcomes[botID]
		h.mu.Unlock()
		if ok {
			return out
		}
		State.RLock()
		totalPlayers := len(State.Players)
		State.RUnlock()
		if totalPlayers < 1 {
			totalPlayers = 1
		}
		return MatchOutcome{
			Won:          false,
			Rank:         totalPlayers,
			TotalPlayers: totalPlayers,
		}
	}

	rankMap := buildLeaderboardRankMap()
	totalPlayers := len(rankMap)
	if totalPlayers < 1 {
		totalPlayers = 1
	}
	rank := rankMap[player.ID]
	if rank == 0 {
		rank = totalPlayers
	}
	summary := summarizeBotBuildings(player.Base)
	mapControl := estimateMapControl(player)
	kills := int(player.GetKills())
	power := float64(readCurrentPower(player))
	ticksSurvived := int(time.Since(player.StartTime).Seconds())
	h.mu.Lock()
	peak := h.peakMapCtrl[botID]
	if mapControl > peak {
		peak = mapControl
		h.peakMapCtrl[botID] = peak
	}
	out := MatchOutcome{
		Won:             rank == 1,
		Rank:            rank,
		TotalPlayers:    totalPlayers,
		TicksSurvived:   ticksSurvived,
		EnemiesKilled:   kills,
		FinalMapControl: mapControl,
		FinalGold:       power,
		PeakMapControl:  peak,
		AutogensBuilt:   summary.gens,
	}
	h.outcomes[botID] = out
	h.mu.Unlock()
	return out
}

func (h *HeadlessEnv) discoverTrainingBots(numBots int) []string {
	if numBots <= 0 {
		numBots = 6
	}
	activeByIdentity := make(map[string]struct{})
	State.RLock()
	for _, p := range State.Players {
		if p == nil || p.IsMarkedForRemoval() || !p.IsBot {
			continue
		}
		identity, ok := findBotIdentityByName(getPlayerName(p))
		if !ok || strings.TrimSpace(identity.ID) == "" {
			continue
		}
		activeByIdentity[identity.ID] = struct{}{}
	}
	State.RUnlock()

	bots := make([]string, 0, numBots)
	for _, preset := range botIdentityPresets {
		if len(bots) >= numBots {
			break
		}
		if _, ok := activeByIdentity[preset.ID]; ok {
			bots = append(bots, preset.ID)
		}
	}
	if len(bots) == 0 {
		for _, preset := range botIdentityPresets {
			if len(bots) >= numBots {
				break
			}
			bots = append(bots, preset.ID)
		}
	}
	return bots
}

func (h *HeadlessEnv) resolveBot(botID string) (*Player, *botRuntime) {
	target := strings.TrimSpace(strings.ToLower(botID))
	if target == "" {
		return nil, nil
	}
	var player *Player
	State.RLock()
	for _, p := range State.Players {
		if p == nil || p.IsMarkedForRemoval() || !p.IsBot {
			continue
		}
		identity, ok := findBotIdentityByName(getPlayerName(p))
		if !ok || strings.TrimSpace(identity.ID) == "" {
			continue
		}
		if strings.EqualFold(identity.ID, target) {
			player = p
			break
		}
	}
	State.RUnlock()
	if player == nil {
		return nil, nil
	}
	return player, getActiveBotRuntime(player.ID)
}

func buildRLEnemies(player *Player, rt *botRuntime) []EnemyInfo {
	if player == nil || player.Base == nil {
		return nil
	}
	selfPos := IntToFloat(player.Base.GetPosition())
	enemies := make([]EnemyInfo, 0, 6)
	State.RLock()
	for _, other := range State.Players {
		if other == nil || other.ID == player.ID || other.IsMarkedForRemoval() || other.Base == nil {
			continue
		}
		otherPos := IntToFloat(other.Base.GetPosition())
		dist := float64(selfPos.DistanceTo(otherPos))
		if dist > 9000 {
			continue
		}
		hp := 1.0
		other.Base.Health.RLock()
		if other.Base.Health.Max > 0 {
			hp = float64(other.Base.Health.Current) / float64(other.Base.Health.Max)
		}
		other.Base.Health.RUnlock()
		name := strings.TrimSpace(getPlayerName(other))
		rel := ""
		if rt != nil && name != "" {
			if st, ok := rt.relationships[name]; ok {
				rel = strings.ToLower(strings.TrimSpace(st.Status))
			}
		}
		enemies = append(enemies, EnemyInfo{
			ID:         name,
			Distance:   dist,
			BaseHP:     clamp01(hp),
			Aggression: map[bool]float64{true: 0.7, false: 0.4}[other.WasBaseDamagedWithin(10*time.Second)],
			IsNemesis:  rel == "nemesis",
			IsFriend:   rel == "friendly",
		})
	}
	State.RUnlock()
	sort.Slice(enemies, func(i, j int) bool { return enemies[i].Distance < enemies[j].Distance })
	if len(enemies) > 6 {
		enemies = enemies[:6]
	}
	return enemies
}

func buildRLLeaderboard() []RLLeaderboardEntry {
	rankMap := buildLeaderboardRankMap()
	if len(rankMap) == 0 {
		return nil
	}
	rows := make([]RLLeaderboardEntry, 0, len(rankMap))
	State.RLock()
	for id, rank := range rankMap {
		p := State.Players[id]
		if p == nil || p.Base == nil {
			continue
		}
		name := strings.TrimSpace(getPlayerName(p))
		s := summarizeBotBuildings(p.Base)
		rows = append(rows, RLLeaderboardEntry{
			Rank:      rank,
			Name:      name,
			MapCtrl:   estimateMapControl(p),
			BaseHP:    clamp01(float64(p.Base.Health.Current) / float64(maxInt(1, int(p.Base.Health.Max)))),
			Strategy:  deriveLayoutStyle(s),
			IsWinning: rank == 1,
		})
	}
	State.RUnlock()
	sort.Slice(rows, func(i, j int) bool { return rows[i].Rank < rows[j].Rank })
	return rows
}

type Trainer struct {
	Config TrainingConfig
	Agents []*RLAgent
	Env    GameEnvironment
	Stats  []TrainingStats
	mu     sync.Mutex
}

func NewTrainer(config TrainingConfig, env GameEnvironment) *Trainer {
	agents := make([]*RLAgent, 0, len(botIdentityPresets))
	for _, preset := range botIdentityPresets {
		agents = append(agents, NewRLAgent(preset.ID, preset.Name))
	}
	return &Trainer{
		Config: config,
		Agents: agents,
		Env:    env,
	}
}

func (t *Trainer) Train() {
	if t.Env == nil {
		fmt.Println("trainer sem ambiente; abortando")
		return
	}
	fmt.Printf("iniciando treinamento: %d episodios, %d bots\n", t.Config.Episodes, t.Config.NumBots)
	start := time.Now()

	saveEvery := maxInt(1, t.Config.SaveEvery)
	logEvery := maxInt(1, t.Config.LogEvery)

	for episode := 0; episode < t.Config.Episodes; episode++ {
		t.runEpisode(episode)
		if episode%logEvery == 0 {
			t.logProgress(episode, start)
		}
		if episode%saveEvery == 0 && episode > 0 {
			t.saveCheckpoint(episode)
		}
	}
	t.saveCheckpoint(t.Config.Episodes)
	fmt.Printf("treinamento concluido em %v\n", time.Since(start).Round(time.Second))
}

func (t *Trainer) runEpisode(_ int) {
	t.Env.Reset(t.Config.NumBots)
	activeAgents := t.selectAgents()
	prevSnaps := make(map[string]GameSnapshot)

	for tick := 0; tick < t.Config.MaxTicksPerGame; tick++ {
		if t.Config.SpeedMultiplier > 0 && t.Config.SpeedMultiplier < 10 {
			sleep := time.Duration(float64(50*time.Millisecond) / t.Config.SpeedMultiplier)
			time.Sleep(sleep)
		}

		for _, agent := range activeAgents {
			if t.Env.IsEliminated(agent.BotID) {
				continue
			}
			snap := t.Env.GetSnapshot(agent.BotID)
			if prev, ok := prevSnaps[agent.BotID]; ok {
				stepReward := agent.CalculateStepReward(StepReward{
					Tick:            tick,
					MapControlDelta: snap.MapControl - prev.MapControl,
					GoldDelta:       snap.Gold - prev.Gold,
					HPDelta:         snap.BaseHP - prev.BaseHP,
					KilledEnemy:     t.Env.KilledEnemyThisTick(agent.BotID),
					GotEliminated:   false,
				})
				agent.Learn(snap, stepReward)
			}

			action := agent.SelectAction(snap)
			t.Env.ExecuteAction(agent.BotID, ActionNames[action])
			prevSnaps[agent.BotID] = snap
		}

		if t.Env.IsGameOver() {
			break
		}
	}

	for _, agent := range activeAgents {
		outcome := t.Env.GetOutcome(agent.BotID)
		agent.EndEpisode(outcome)
	}
}

func (t *Trainer) selectAgents() []*RLAgent {
	n := minInt(t.Config.NumBots, len(t.Agents))
	if n <= 0 {
		return nil
	}
	shuffled := make([]*RLAgent, len(t.Agents))
	copy(shuffled, t.Agents)
	rand.Shuffle(len(shuffled), func(i, j int) {
		shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
	})
	return shuffled[:n]
}

func (t *Trainer) logProgress(episode int, start time.Time) {
	elapsed := time.Since(start)
	pct := float64(episode) / math.Max(1, float64(t.Config.Episodes)) * 100
	fmt.Printf("\nepisodio %d/%d (%.1f%%)\n", episode, t.Config.Episodes, pct)
	fmt.Printf("tempo: %v\n", elapsed.Round(time.Second))

	type stat struct {
		name    string
		winRate float64
		epsilon float64
		reward  float64
		qtSize  int
	}
	stats := make([]stat, 0, len(t.Agents))
	for _, agent := range t.Agents {
		agent.mu.Lock()
		avg := 0.0
		for _, r := range agent.RewardHistory {
			avg += r
		}
		if len(agent.RewardHistory) > 0 {
			avg /= float64(len(agent.RewardHistory))
		}
		agent.mu.Unlock()
		agent.QTable.mu.RLock()
		qSize := len(agent.QTable.Values)
		agent.QTable.mu.RUnlock()
		stats = append(stats, stat{
			name:    agent.Name,
			winRate: agent.WinRate,
			epsilon: agent.Epsilon,
			reward:  avg,
			qtSize:  qSize,
		})
	}
	sort.Slice(stats, func(i, j int) bool { return stats[i].winRate > stats[j].winRate })
	for _, s := range stats {
		fmt.Printf("%-10s win=%.1f%% avg=%.2f eps=%.3f q=%d\n",
			s.name, s.winRate*100, s.reward, s.epsilon, s.qtSize)
	}
}

// ============================================================
// Persistence
// ============================================================

type QTableSave struct {
	BotID    string            `json:"bot_id"`
	Name     string            `json:"name"`
	Epsilon  float64           `json:"epsilon"`
	Episodes int               `json:"episodes"`
	WinRate  float64           `json:"win_rate"`
	Values   map[string]qEntry `json:"values"`
}

func (t *Trainer) saveCheckpoint(_ int) {
	for _, agent := range t.Agents {
		save, ok := agent.exportSave()
		if !ok {
			continue
		}
		payload, err := json.Marshal(save.Values)
		if err != nil {
			continue
		}
		_ = upsertBotQTable(agent.BotID, save.Episodes, save.WinRate, save.Epsilon, payload)
	}
}

func (agent *RLAgent) exportSave() (QTableSave, bool) {
	agent.mu.Lock()
	defer agent.mu.Unlock()
	agent.QTable.mu.RLock()
	defer agent.QTable.mu.RUnlock()

	values := make(map[string]qEntry, len(agent.QTable.Values))
	for k, v := range agent.QTable.Values {
		key := fmt.Sprintf("%d_%d_%d_%d_%d_%d_%d_%d",
			k.GamePhase, k.BaseHPBucket, k.GoldBucket,
			k.AutogenBucket, k.TroopsBucket, k.ThreatBucket,
			k.MapBucket, k.UnderAttack)
		values[key] = v
	}
	return QTableSave{
		BotID:    agent.BotID,
		Name:     agent.Name,
		Epsilon:  agent.Epsilon,
		Episodes: agent.EpisodesPlayed,
		WinRate:  agent.WinRate,
		Values:   values,
	}, true
}

func LoadModel(botID, filePath string) (*RLAgent, error) {
	_ = filePath
	return loadQTableFromDB(botID)
}

func loadQTableFromDB(botID string) (*RLAgent, error) {
	botID = strings.TrimSpace(botID)
	if botID == "" {
		return nil, fmt.Errorf("empty bot id")
	}
	if botDB == nil {
		return nil, errBotDBUnavailable
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var episodes int
	var winRate float64
	var epsilon float64
	var payload []byte
	err := botDB.QueryRowContext(ctx, `
		SELECT episodes, win_rate, epsilon, qtable_json
		FROM bot_qtable
		WHERE bot_id = $1
	`, botID).Scan(&episodes, &winRate, &epsilon, &payload)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}

	values := make(map[string]qEntry)
	if len(payload) == 0 {
		payload = []byte("{}")
	}
	if err := json.Unmarshal(payload, &values); err != nil {
		return nil, err
	}

	name := botID
	for _, preset := range botIdentityPresets {
		if strings.EqualFold(strings.TrimSpace(preset.ID), botID) {
			name = strings.TrimSpace(preset.Name)
			break
		}
	}
	agent := NewRLAgent(botID, name)
	agent.Epsilon = clamp01(epsilon)
	if agent.Epsilon < agent.EpsilonMin {
		agent.Epsilon = agent.EpsilonMin
	}
	agent.EpisodesPlayed = maxInt(0, episodes)
	agent.WinRate = clamp01(winRate)

	for keyStr, vals := range values {
		var k StateKey
		_, _ = fmt.Sscanf(keyStr, "%d_%d_%d_%d_%d_%d_%d_%d",
			&k.GamePhase, &k.BaseHPBucket, &k.GoldBucket,
			&k.AutogenBucket, &k.TroopsBucket, &k.ThreatBucket,
			&k.MapBucket, &k.UnderAttack)
		agent.QTable.Values[k] = vals
	}
	return agent, nil
}

// ============================================================
// Production Hybrid Agent
// ============================================================

type ProductionAgent struct {
	Agent               *RLAgent
	MathBrain           *localBotBrain
	ConfidenceThreshold float64
}

func NewProductionAgent(botID, name, modelPath string, mathBrain *localBotBrain) *ProductionAgent {
	rlAgent, err := LoadModel(botID, modelPath)
	if err != nil {
		rlAgent = NewRLAgent(botID, name)
		rlAgent.Epsilon = rlAgent.EpsilonMin
	}
	if mathBrain == nil {
		mathBrain = getOrCreateLocalBrain(botIdentityPreset{ID: botID, Name: name})
	}
	return &ProductionAgent{
		Agent:               rlAgent,
		MathBrain:           mathBrain,
		ConfidenceThreshold: 5.0,
	}
}

func (pa *ProductionAgent) Decide(snap GameSnapshot, fallback aiBotDecision) aiBotDecision {
	if pa == nil || pa.Agent == nil {
		return fallback
	}
	state := DiscretizeState(snap)
	maxQ := pa.Agent.QTable.GetMax(state)
	visits := pa.Agent.QTable.VisitCount(state)
	if visits < 10 || maxQ < pa.ConfidenceThreshold {
		return fallback
	}

	actionID := pa.Agent.QTable.GetBestAction(state)
	actionName := ActionNames[actionID]
	fallback.Action = actionName
	fallback.Reasoning = fmt.Sprintf("RL(Q=%.2f visits=%d) | %s", maxQ, visits, fallback.Reasoning)
	return fallback
}

func (pa *ProductionAgent) ObserveStep(prevSnap, nextSnap GameSnapshot, gotKill, gotEliminated bool) {
	if pa == nil || pa.Agent == nil {
		return
	}
	pa.Agent.SelectAction(prevSnap)
	stepReward := pa.Agent.CalculateStepReward(StepReward{
		MapControlDelta: nextSnap.MapControl - prevSnap.MapControl,
		GoldDelta:       nextSnap.Gold - prevSnap.Gold,
		HPDelta:         nextSnap.BaseHP - prevSnap.BaseHP,
		KilledEnemy:     gotKill,
		GotEliminated:   gotEliminated,
	})
	pa.Agent.Learn(nextSnap, stepReward)
}

func (pa *ProductionAgent) EndEpisode(outcome MatchOutcome) {
	if pa == nil || pa.Agent == nil {
		return
	}
	pa.Agent.EndEpisode(outcome)
}

// ============================================================
// Runtime helpers for existing bot system
// ============================================================

var (
	productionAgentsByIdentity   = make(map[string]*ProductionAgent)
	productionAgentsByIdentityMu sync.RWMutex
)

func getOrCreateProductionAgent(identity botIdentityPreset, mathBrain *localBotBrain) *ProductionAgent {
	if !isRLEnabled() {
		return nil
	}
	key := strings.TrimSpace(identity.ID)
	if key == "" {
		key = strings.ToLower(strings.TrimSpace(identity.Name))
	}
	if key == "" {
		return nil
	}

	productionAgentsByIdentityMu.RLock()
	if existing, ok := productionAgentsByIdentity[key]; ok {
		productionAgentsByIdentityMu.RUnlock()
		return existing
	}
	productionAgentsByIdentityMu.RUnlock()

	agent := NewProductionAgent(identity.ID, identity.Name, "", mathBrain)

	productionAgentsByIdentityMu.Lock()
	if existing, ok := productionAgentsByIdentity[key]; ok {
		productionAgentsByIdentityMu.Unlock()
		return existing
	}
	productionAgentsByIdentity[key] = agent
	productionAgentsByIdentityMu.Unlock()
	return agent
}

func isRLEnabled() bool {
	raw := strings.TrimSpace(os.Getenv("BOT_RL_ENABLED"))
	if raw == "" {
		return true
	}
	switch strings.ToLower(raw) {
	case "0", "false", "off", "no":
		return false
	default:
		return true
	}
}

func gameSnapshotFromLocalSnapshot(snap localSnapshot) GameSnapshot {
	enemies := make([]EnemyInfo, 0, len(snap.Enemies))
	for _, e := range snap.Enemies {
		enemies = append(enemies, EnemyInfo{
			ID:         e.ID,
			Distance:   e.Distance,
			BaseHP:     e.BaseHP,
			Aggression: e.Aggression,
			IsNemesis:  e.IsNemesis,
			IsFriend:   e.IsFriend,
		})
	}

	chatFeed := make([]ChatEntry, 0, len(snap.Social.ChatLog))
	for _, c := range snap.Social.ChatLog {
		chatFeed = append(chatFeed, ChatEntry{
			PlayerName: c.From,
			Message:    c.Message,
			Tick:       c.Tick,
			IsHuman:    c.IsHuman,
		})
	}

	actions := make([]PlayerAction, 0, len(snap.Social.ObservedPlayers))
	leaderboard := make([]RLLeaderboardEntry, 0, len(snap.Social.ObservedPlayers))
	winner := strings.TrimSpace(snap.Social.MatchMeta.WhoIsWinning)
	for _, p := range snap.Social.ObservedPlayers {
		actions = append(actions, PlayerAction{
			PlayerName: p.ID,
			Action:     p.LastAction,
			Result:     "success",
			Outcome:    p.LayoutStyle,
			Tick:       p.LastActionTick,
		})
		leaderboard = append(leaderboard, RLLeaderboardEntry{
			Rank:      p.CurrentRank,
			Name:      p.ID,
			MapCtrl:   snap.MapControl,
			BaseHP:    clamp01(float64(p.BaseHealth) / 100.0),
			Strategy:  p.LayoutStyle,
			IsWinning: strings.EqualFold(strings.TrimSpace(p.ID), winner),
		})
	}
	sort.Slice(leaderboard, func(i, j int) bool { return leaderboard[i].Rank < leaderboard[j].Rank })

	buildings := make(map[string]int, len(snap.BuildingCount))
	for k, v := range snap.BuildingCount {
		buildings[k] = v
	}
	return GameSnapshot{
		Tick:            snap.Tick,
		Gold:            snap.Gold,
		Food:            snap.Food,
		BaseHP:          snap.BaseHP,
		MapControl:      snap.MapControl,
		TroopsAvailable: snap.TroopsAvailable,
		TroopsDeployed:  snap.TroopsDeployed,
		BuildingCount:   buildings,
		UnderAttack:     snap.UnderAttack,
		ThreatLevel:     snap.ThreatLevel,
		Enemies:         enemies,
		ChatFeed:        chatFeed,
		PlayerActions:   actions,
		Leaderboard:     leaderboard,
	}
}

func RunTraining() {
	config := TrainingConfig{
		Episodes:        50000,
		MaxTicksPerGame: 1200,
		NumBots:         6,
		SpeedMultiplier: 0,
		SaveEvery:       1000,
		LogEvery:        500,
		OutputDir:       "",
	}
	fmt.Printf("config treinamento rl: %+v\n", config)
	env := NewHeadlessEnv()
	trainer := NewTrainer(config, env)
	trainer.Train()
}
