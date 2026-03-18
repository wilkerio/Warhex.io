package game

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

var (
	openAIInitOnce sync.Once
	openAIEnabled  bool
	openAIAPIKey   string
	openAIModel    string
	openAILastLog  time.Time

	claudeInitOnce sync.Once
	claudeEnabled  bool
	claudeAPIKey   string
	claudeModel    string
	claudeLastLog  time.Time

	plannerHTTPClient = &http.Client{Timeout: 9 * time.Second}
)

type aiBotDecision struct {
	Reasoning          string   `json:"reasoning"`
	Priority           string   `json:"priority"`
	Action             string   `json:"action"`
	Target             string   `json:"target"`
	NextIntention      string   `json:"next_intention"`
	MoveMode           string   `json:"move_mode"`
	BuildHints         []string `json:"build_hints"`
	BuildSequence      []string `json:"build_sequence"`
	AllowPush          *bool    `json:"allow_push"`
	SetGroupUnits      *bool    `json:"set_group_units"`
	TryCommander       bool     `json:"try_commander"`
	TryUpgrade         bool     `json:"try_upgrade"`
	UseDefend          bool     `json:"use_defend"`
	Chat               string   `json:"chat"`
	ChatMessage        string   `json:"chat_message"`
	MenuUsed           string   `json:"menu_used"`
	LoadBaseQuery      string   `json:"load_base_query"`
	SocialObservation  string   `json:"social_observation"`
	VocabularyAbsorbed []string `json:"vocabulary_absorbed"`
	RelationshipUpdate *struct {
		PlayerID  string `json:"player_id"`
		NewStatus string `json:"new_status"`
		Reason    string `json:"reason"`
	} `json:"relationship_update"`
	ReactionTo *struct {
		PlayerID     string `json:"player_id"`
		TheirMessage string `json:"their_message"`
		ChatMessage  string `json:"chat_message"`
	} `json:"reaction_to"`
}

func refreshBotThought(player *Player, rt *botRuntime) {
	if player == nil || rt == nil {
		return
	}

	now := time.Now()
	previousThought := rt.thought
	previousReady := rt.externalThoughtReady
	plan := makeHeuristicThoughtPlan(player, rt, now)

	if aiPlan, ok := requestExternalThoughtPlan(player, rt, now); ok {
		mergeThoughtPlan(&plan, aiPlan)
		rt.externalThoughtReady = true
		rt.externalFailStreak = 0
	} else {
		rt.externalFailStreak++
		// Keep last Claude plan if still valid so bots don't freeze.
		if previousReady && previousThought.validUntil.After(now) {
			rt.thought = previousThought
			rt.externalThoughtReady = true
			return
		}
		// After repeated failures, allow a safe local fallback to avoid idle bots.
		if rt.externalFailStreak < 1 {
			plan.chat = ""
			plan.reactionChat = ""
			rt.externalThoughtReady = false
		} else {
			rt.externalThoughtReady = true
		}
	}
	if rt.identity.SilentChat {
		plan.chat = ""
		plan.reactionChat = ""
	}
	applyBotSocialDecision(rt, plan.socialObservation, plan.vocabularyAbsorbed, plan.relationshipUpdate)

	rt.thought = plan
}

func makeHeuristicThoughtPlan(player *Player, rt *botRuntime, now time.Time) botThoughtPlan {
	plan := botThoughtPlan{
		validUntil: now.Add(70 * time.Second),
	}

	underAttack := player.WasBaseDamagedWithin(12 * time.Second)
	if underAttack {
		mode := moveDefend
		plan.forceMode = &mode
		plan.useDefend = true
		plan.buildHints = []BuildingType{WALL, SIMPLE_TURRET}
	}

	units := readUnitCount(player)
	power := readCurrentPower(player)

	if !player.HasCommander && power >= uint16(COMMANDER_COST*2) {
		if rt.aggression > 0.55 || rt.buildStyle == 2 {
			plan.tryCommander = true
		}
	}

	if power >= 350 && (rt.macroFocus > 0.5 || rt.buildStyle == 0) {
		plan.tryUpgrade = true
	}

	if units >= 10 && rt.aggression > 0.6 {
		mode := movePressure
		plan.forceMode = &mode
	}

	if rt.buildStyle == 0 {
		plan.buildHints = append(plan.buildHints, GENERATOR, HOUSE)
	}
	if rt.buildStyle == 2 {
		plan.buildHints = append(plan.buildHints, BARRACKS, SIMPLE_TURRET)
	}

	if units <= 5 {
		set := false
		plan.setGroupUnits = &set
	}

	switch rt.role {
	case roleGuardian:
		plan.buildHints = append(plan.buildHints, WALL, SIMPLE_TURRET)
		if units >= 8 && randBoolByWeight(0.25+rt.teamplay*0.15) {
			mode := movePressure
			plan.forceMode = &mode
		}
	case roleRaider:
		plan.buildHints = append(plan.buildHints, BARRACKS, SIMPLE_TURRET)
		if units >= 7 && randBoolByWeight(0.42+rt.aggression*0.18) {
			mode := moveFlank
			plan.forceMode = &mode
		}
	case roleSiege:
		plan.buildHints = append(plan.buildHints, BARRACKS, SNIPER_TURRET)
		if units >= 9 {
			mode := movePressure
			plan.forceMode = &mode
		}
	case roleEco:
		plan.buildHints = append(plan.buildHints, GENERATOR, HOUSE)
		if units < 11 {
			mode := moveRegroup
			plan.forceMode = &mode
		}
	case roleDuelist:
		plan.buildHints = append(plan.buildHints, BARRACKS, HOUSE)
		if units >= 8 && randBoolByWeight(0.34+rt.aggression*0.2) {
			mode := moveFlank
			plan.forceMode = &mode
		}
	}

	summary := botBuildingSummary{}
	baseReady := false
	if player.Base != nil {
		summary = summarizeBotBuildings(player.Base)
		baseReady = isBotBaseReadyForPush(player, rt, summary, power)
	}
	plan.chat = generateHeuristicBotChat(player, rt, now, summary, units, power, baseReady, underAttack)

	return plan
}

func mergeThoughtPlan(base *botThoughtPlan, incoming botThoughtPlan) {
	if base == nil {
		return
	}
	if incoming.validUntil.After(base.validUntil) {
		base.validUntil = incoming.validUntil
	}
	if incoming.forceMode != nil {
		base.forceMode = incoming.forceMode
	}
	if len(incoming.buildHints) > 0 {
		base.buildHints = incoming.buildHints
	}
	if len(incoming.buildSequence) > 0 {
		base.buildSequence = incoming.buildSequence
	}
	if incoming.allowPush != nil {
		base.allowPush = incoming.allowPush
	}
	if incoming.setGroupUnits != nil {
		base.setGroupUnits = incoming.setGroupUnits
	}
	base.tryCommander = base.tryCommander || incoming.tryCommander
	base.tryUpgrade = base.tryUpgrade || incoming.tryUpgrade
	base.useDefend = base.useDefend || incoming.useDefend
	if strings.TrimSpace(incoming.chat) != "" {
		base.chat = incoming.chat
	}
	if strings.TrimSpace(incoming.reactionChat) != "" {
		base.reactionChat = incoming.reactionChat
	}
	if strings.TrimSpace(incoming.menuUsed) != "" {
		base.menuUsed = incoming.menuUsed
	}
	if strings.TrimSpace(incoming.loadBaseQuery) != "" {
		base.loadBaseQuery = incoming.loadBaseQuery
	}
	if strings.TrimSpace(incoming.socialObservation) != "" {
		base.socialObservation = incoming.socialObservation
	}
	if len(incoming.vocabularyAbsorbed) > 0 {
		base.vocabularyAbsorbed = append(base.vocabularyAbsorbed, incoming.vocabularyAbsorbed...)
	}
	if incoming.relationshipUpdate != nil {
		base.relationshipUpdate = incoming.relationshipUpdate
	}
}

func isOpenAIEnabled() bool {
	openAIInitOnce.Do(func() {
		openAIAPIKey = strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
		if openAIAPIKey == "" {
			return
		}
		openAIModel = strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
		if openAIModel == "" {
			openAIModel = "gpt-5"
		}
		openAIEnabled = true
		log.Printf("OpenAI bot planner enabled with model: %s", openAIModel)
	})
	return openAIEnabled
}

func isClaudeEnabled() bool {
	claudeInitOnce.Do(func() {
		claudeAPIKey = strings.TrimSpace(os.Getenv("CLAUDE_API_KEY"))
		if claudeAPIKey == "" {
			claudeAPIKey = strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY"))
		}
		if claudeAPIKey == "" {
			return
		}
		claudeModel = strings.TrimSpace(os.Getenv("CLAUDE_MODEL"))
		if claudeModel == "" {
			claudeModel = strings.TrimSpace(os.Getenv("ANTHROPIC_MODEL"))
		}
		if claudeModel == "" {
			claudeModel = "claude-3-5-sonnet-latest"
		}
		claudeEnabled = true
		log.Printf("Claude bot planner enabled with model: %s", claudeModel)
	})
	return claudeEnabled
}

func requestExternalThoughtPlan(player *Player, rt *botRuntime, now time.Time) (botThoughtPlan, bool) {
	decision, ok := localDecisionForRuntime(player, rt, now)
	if !ok {
		return botThoughtPlan{}, false
	}
	return buildThoughtPlanFromDecision(decision, now)
}

func isExternalPlannerEnabled() bool {
	return true
}

func requestOpenAIThoughtPlan(player *Player, rt *botRuntime, now time.Time) (botThoughtPlan, bool) {
	if !isOpenAIEnabled() {
		return botThoughtPlan{}, false
	}
	prompt := buildAIPrompt(player, rt, now)
	decision, ok := queryOpenAIDecision(prompt)
	if !ok {
		return botThoughtPlan{}, false
	}
	return buildThoughtPlanFromDecision(decision, now)
}

func requestClaudeThoughtPlan(player *Player, rt *botRuntime, now time.Time) (botThoughtPlan, bool) {
	if !isClaudeEnabled() {
		return botThoughtPlan{}, false
	}
	prompt := buildAIPrompt(player, rt, now)
	decision, ok := queryClaudeDecision(prompt)
	if !ok {
		return botThoughtPlan{}, false
	}
	return buildThoughtPlanFromDecision(decision, now)
}

func buildThoughtPlanFromDecision(decision aiBotDecision, now time.Time) (botThoughtPlan, bool) {
	primaryChat := strings.TrimSpace(decision.ChatMessage)
	if primaryChat == "" {
		primaryChat = strings.TrimSpace(decision.Chat)
	}
	var relationshipUpdate *botRelationshipUpdate
	if decision.RelationshipUpdate != nil {
		relationshipUpdate = &botRelationshipUpdate{
			PlayerID:  strings.TrimSpace(decision.RelationshipUpdate.PlayerID),
			NewStatus: strings.TrimSpace(decision.RelationshipUpdate.NewStatus),
			Reason:    strings.TrimSpace(decision.RelationshipUpdate.Reason),
		}
	}
	reactionChat := ""
	if decision.ReactionTo != nil {
		reactionChat = strings.TrimSpace(decision.ReactionTo.ChatMessage)
	}

	plan := botThoughtPlan{
		validUntil:         now.Add(80 * time.Second),
		buildHints:         mapBuildHints(decision.BuildHints),
		buildSequence:      mapBuildHints(decision.BuildSequence),
		allowPush:          decision.AllowPush,
		setGroupUnits:      decision.SetGroupUnits,
		tryCommander:       decision.TryCommander,
		tryUpgrade:         decision.TryUpgrade,
		useDefend:          decision.UseDefend,
		chat:               sanitizeBotChat(primaryChat),
		reactionChat:       sanitizeBotChat(reactionChat),
		menuUsed:           strings.TrimSpace(decision.MenuUsed),
		loadBaseQuery:      strings.TrimSpace(decision.LoadBaseQuery),
		socialObservation:  strings.TrimSpace(decision.SocialObservation),
		vocabularyAbsorbed: decision.VocabularyAbsorbed,
		relationshipUpdate: relationshipUpdate,
	}
	applyActionStyleDecision(&plan, decision)
	if mode, ok := parseMoveMode(decision.MoveMode); ok {
		plan.forceMode = &mode
	}
	return plan, true
}

func applyActionStyleDecision(plan *botThoughtPlan, decision aiBotDecision) {
	if plan == nil {
		return
	}

	priority := strings.ToUpper(strings.TrimSpace(decision.Priority))
	switch priority {
	case "EMERGENCIA":
		mode := moveDefend
		plan.forceMode = &mode
		plan.useDefend = true
		b := false
		plan.allowPush = &b
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, WALL, SIMPLE_TURRET)
	case "ECONOMICA":
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, GENERATOR, HOUSE)
	case "DEFENSIVA":
		mode := moveDefend
		plan.forceMode = &mode
		plan.useDefend = true
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, WALL, SIMPLE_TURRET)
	case "EXPANSAO":
		mode := moveFlank
		plan.forceMode = &mode
		b := true
		plan.allowPush = &b
	case "OFENSIVA":
		mode := movePressure
		plan.forceMode = &mode
		b := true
		plan.allowPush = &b
	}

	switch strings.ToLower(strings.TrimSpace(decision.Action)) {
	case "build_autogen":
		plan.buildSequence = prependBuildSequence(plan.buildSequence, GENERATOR)
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, GENERATOR, HOUSE)
	case "build_wall":
		plan.buildSequence = prependBuildSequence(plan.buildSequence, WALL)
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, WALL)
	case "build_barracks":
		plan.buildSequence = prependBuildSequence(plan.buildSequence, BARRACKS)
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, BARRACKS)
	case "build_turret":
		plan.buildSequence = prependBuildSequence(plan.buildSequence, SIMPLE_TURRET)
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, SIMPLE_TURRET, SNIPER_TURRET)
	case "train_troops":
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, BARRACKS)
		set := true
		plan.setGroupUnits = &set
	case "attack_enemy":
		mode := movePressure
		plan.forceMode = &mode
		b := true
		plan.allowPush = &b
		set := true
		plan.setGroupUnits = &set
	case "expand_territory":
		mode := moveFlank
		plan.forceMode = &mode
		b := true
		plan.allowPush = &b
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, BARRACKS, SIMPLE_TURRET)
	case "reinforce_defense":
		mode := moveDefend
		plan.forceMode = &mode
		plan.useDefend = true
		b := false
		plan.allowPush = &b
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, WALL, SIMPLE_TURRET, SNIPER_TURRET)
	case "repair_base":
		mode := moveDefend
		plan.forceMode = &mode
		plan.useDefend = true
		b := false
		plan.allowPush = &b
	}

	switch strings.ToLower(strings.TrimSpace(decision.MenuUsed)) {
	case "defend":
		plan.useDefend = true
		mode := moveDefend
		plan.forceMode = &mode
		b := false
		plan.allowPush = &b
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, GENERATOR, WALL, SIMPLE_TURRET)
	case "externatk":
		mode := movePressure
		plan.forceMode = &mode
		b := true
		plan.allowPush = &b
		plan.buildHints = appendUniqueBuildHint(plan.buildHints, BARRACKS, SIMPLE_TURRET)
	case "loadbase":
		query := strings.ToLower(strings.TrimSpace(decision.LoadBaseQuery))
		switch {
		case strings.Contains(query, "defend"), strings.Contains(query, "wall"), strings.Contains(query, "fortress"), strings.Contains(query, "autogen"), strings.Contains(query, "eco"):
			plan.useDefend = true
			plan.buildHints = appendUniqueBuildHint(plan.buildHints, GENERATOR, HOUSE, WALL)
		case strings.Contains(query, "rush"), strings.Contains(query, "atk"), strings.Contains(query, "pressure"), strings.Contains(query, "extern"):
			mode := movePressure
			plan.forceMode = &mode
			b := true
			plan.allowPush = &b
			plan.buildHints = appendUniqueBuildHint(plan.buildHints, BARRACKS, SIMPLE_TURRET)
		}
	}
}

func appendUniqueBuildHint(base []BuildingType, additions ...BuildingType) []BuildingType {
	seen := make(map[BuildingType]struct{}, len(base))
	out := make([]BuildingType, 0, len(base)+len(additions))
	for _, bt := range base {
		if _, ok := seen[bt]; ok {
			continue
		}
		seen[bt] = struct{}{}
		out = append(out, bt)
	}
	for _, bt := range additions {
		if _, ok := seen[bt]; ok {
			continue
		}
		seen[bt] = struct{}{}
		out = append(out, bt)
	}
	if len(out) > 4 {
		out = out[:4]
	}
	return out
}

func prependBuildSequence(base []BuildingType, bt BuildingType) []BuildingType {
	if bt == 0 {
		return base
	}
	out := make([]BuildingType, 0, len(base)+1)
	out = append(out, bt)
	for _, existing := range base {
		if existing == bt {
			continue
		}
		out = append(out, existing)
		if len(out) >= 4 {
			break
		}
	}
	return out
}

func buildAIPrompt(player *Player, rt *botRuntime, now time.Time) string {
	if player == nil || rt == nil || player.Base == nil {
		return ""
	}

	if rt.identity.ID == "" {
		rt.identity = defaultBotIdentity()
	}

	summary := summarizeBotBuildings(player.Base)
	power := readCurrentPower(player)
	freePop := readFreePopulation(player)
	baseReady := isBotBaseReadyForPush(player, rt, summary, power)
	units := readUnitCount(player)
	social := buildBotSocialPayload(player, rt)
	socialJSON := "{}"
	if raw, err := json.Marshal(social); err == nil {
		socialJSON = string(raw)
	}
	personaName := botPersonaName(rt.persona)
	personaDirective := botPersonaDirective(rt.persona)

	baseHealth := uint16(0)
	baseHealthMax := uint16(1)
	player.Base.Health.RLock()
	baseHealth = player.Base.Health.Current
	baseHealthMax = player.Base.Health.Max
	player.Base.Health.RUnlock()

	_, hasEnemy, _, enemyName := findEnemyForRuntime(player, rt)
	if !hasEnemy {
		enemyName = "none"
	}
	enemyMention := mentionFromEnemy(enemyName)
	underAttack := player.WasBaseDamagedWithin(12 * time.Second)

	lang := "english"
	if rt.language == "pt" {
		lang = "portuguese"
	}

	phaseHint := "early"
	progressScore := summary.buildings + units
	if progressScore >= 28 {
		phaseHint = "late"
	} else if progressScore >= 14 {
		phaseHint = "mid"
	}

	layoutStyle := "HYBRID"
	switch rt.basePlan {
	case basePlanAutogens:
		layoutStyle = "AUTOGEN"
	case basePlanExternAtk:
		layoutStyle = "EXTERNATK"
	case basePlanPublicTurtle:
		layoutStyle = "TURTLE"
	case basePlanPublicHybrid:
		layoutStyle = "HYBRID"
	}

	threatLevel := "low"
	if underAttack {
		threatLevel = "high"
	} else if hasEnemy && (units < 8 || power < 280 || rt.lastMode == moveDefend) {
		threatLevel = "medium"
	}

	mapControlHint := "low"
	if baseReady && units >= 8 {
		mapControlHint = "medium"
	}
	if baseReady && units >= 12 && power >= 360 {
		mapControlHint = "high"
	}

	baseHealthPct := float64(0)
	if baseHealthMax > 0 {
		baseHealthPct = (float64(baseHealth) / float64(baseHealthMax)) * 100
	}
	attackReady := baseHealthPct > 70 && units > 8 && power > 300 && !underAttack

	return fmt.Sprintf(
		`You are a high-level bot player in Warhex.io.
You must think strategically and socially, never randomly.

BOT IDENTITY:
- id=%s
- name=%s
- tag=%s
- archetype=%s
- playstyle=%s
- personality=%s
- preferred_menu=%s
- load_base_preference=%s
- chat_style=%s
- persona_name=%s
- persona_directive=%s
- special_prompt=%s

RUNTIME SNAPSHOT:
- tick_hint=%d phase_hint=%s now=%s
- resources: gold=%d food=%d
- base: hp=%d/%d (%.1f%%) ready_for_push=%t layout=%s buildings_total=%d walls=%d gens=%d houses=%d barracks=%d turrets=%d snipers=%d
- troops: available=%d has_commander=%t
- map_control=%s threat_level=%s attack_ready=%t under_attack=%t
- enemy: nearest=%s mention=%s
- profile: profile=%s role=%s archetype=%d build_style=%d aggression=%.2f macro=%.2f teamplay=%.2f patience=%.2f chatter=%.2f dna=%d
- last_mode=%d

SOCIAL INPUT (JSON):
%s

SOCIAL LEARNING LAYER RULES:
1) Learn vocabulary from social.chat_log and social.match_meta.chat_vocabulary_pool.
2) Observe who is winning and adapt strategy while preserving your identity.
3) React to current match meta (most effective action, fast elimination pattern).
4) Use rivals/friendly relationships to influence target and chat naturally.
5) React to direct chat when relevant, but at most 2 messages per turn.
6) If this bot is PHANTOM, never send chat_message and never reaction chat.

DECISION RULES:
- Priority order: EMERGENCIA > ECONOMICA > DEFENSIVA > EXPANSAO > OFENSIVA.
- Never attack with unstable economy.
- Defend if under_attack=true.
- Prefer ExternAtk logic for pressure identities and Defend logic for defensive identities.
- If uncertain, choose stable macro over reckless push.

Return ONLY valid compact JSON with keys:
reasoning, priority, action, target, next_intention, move_mode, build_hints, build_sequence, allow_push, set_group_units, try_commander, try_upgrade, use_defend, menu_used, load_base_query, chat_message, social_observation, vocabulary_absorbed, relationship_update, reaction_to

Allowed values:
- priority: EMERGENCIA|ECONOMICA|DEFENSIVA|EXPANSAO|OFENSIVA
- action: build_autogen|build_wall|build_barracks|build_turret|train_troops|attack_enemy|expand_territory|reinforce_defense|repair_base
- move_mode: defend|regroup|pressure|flank
- menu_used: ExternAtk|Defend|LoadBase|null
- chat_message: max 58 chars, natural %s, no emoji
- relationship_update.new_status: rival|friendly|neutral
`,
		rt.identity.ID,
		rt.identity.Name,
		rt.identity.Tag,
		rt.identity.ArchetypeLabel,
		rt.identity.Playstyle,
		rt.identity.Personality,
		rt.identity.PreferredMenu,
		strings.Join(rt.identity.LoadBasePreference, ", "),
		rt.identity.ChatStyle,
		personaName,
		personaDirective,
		rt.identity.SystemPrompt,
		rt.phase,
		phaseHint,
		now.Format(time.RFC3339),
		power,
		freePop,
		baseHealth,
		baseHealthMax,
		baseHealthPct,
		baseReady,
		layoutStyle,
		summary.buildings,
		summary.walls,
		summary.gens,
		summary.houses,
		summary.barracks,
		summary.turrets,
		summary.snipers,
		units,
		player.HasCommander,
		mapControlHint,
		threatLevel,
		attackReady,
		underAttack,
		enemyName,
		enemyMention,
		botProfileName(rt.profile),
		botRoleName(rt.role),
		rt.archetype,
		rt.buildStyle,
		rt.aggression,
		rt.macroFocus,
		rt.teamplay,
		rt.patience,
		rt.chatter,
		rt.layoutDNA,
		rt.lastMode,
		socialJSON,
		lang,
	)
}

func queryOpenAIDecision(prompt string) (aiBotDecision, bool) {
	if !openAIEnabled || prompt == "" {
		return aiBotDecision{}, false
	}

	payload := map[string]interface{}{
		"model":             openAIModel,
		"input":             prompt,
		"temperature":       0.7,
		"max_output_tokens": 320,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return aiBotDecision{}, false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.openai.com/v1/responses", bytes.NewReader(body))
	if err != nil {
		return aiBotDecision{}, false
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+openAIAPIKey)

	resp, err := plannerHTTPClient.Do(req)
	if err != nil {
		logOpenAIIssue("request failed: " + err.Error())
		return aiBotDecision{}, false
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		logOpenAIIssue(fmt.Sprintf("unexpected status: %d", resp.StatusCode))
		return aiBotDecision{}, false
	}

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		logOpenAIIssue("read body failed")
		return aiBotDecision{}, false
	}

	text, ok := extractOpenAIText(raw)
	if !ok {
		logOpenAIIssue("could not extract output text")
		return aiBotDecision{}, false
	}
	text = strings.TrimSpace(text)
	jsonChunk := extractJSONObject(text)
	if jsonChunk == "" {
		jsonChunk = text
	}

	var decision aiBotDecision
	if err := json.Unmarshal([]byte(jsonChunk), &decision); err != nil {
		logOpenAIIssue("invalid json decision")
		return aiBotDecision{}, false
	}
	return decision, true
}

func queryClaudeDecision(prompt string) (aiBotDecision, bool) {
	if !claudeEnabled || prompt == "" {
		return aiBotDecision{}, false
	}

	payload := map[string]interface{}{
		"model":       claudeModel,
		"max_tokens":  480,
		"temperature": 0.7,
		"messages": []map[string]string{
			{
				"role":    "user",
				"content": prompt,
			},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return aiBotDecision{}, false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	if err != nil {
		return aiBotDecision{}, false
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", claudeAPIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := plannerHTTPClient.Do(req)
	if err != nil {
		logClaudeIssue("request failed: " + err.Error())
		return aiBotDecision{}, false
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		logClaudeIssue("read body failed")
		return aiBotDecision{}, false
	}

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		snippet := strings.TrimSpace(string(raw))
		if len(snippet) > 180 {
			snippet = snippet[:180]
		}
		logClaudeIssue(fmt.Sprintf("unexpected status: %d body=%s", resp.StatusCode, snippet))
		return aiBotDecision{}, false
	}

	text, ok := extractClaudeText(raw)
	if !ok {
		logClaudeIssue("could not extract output text")
		return aiBotDecision{}, false
	}
	text = strings.TrimSpace(text)
	jsonChunk := extractJSONObject(text)
	if jsonChunk == "" {
		jsonChunk = text
	}

	var decision aiBotDecision
	if err := json.Unmarshal([]byte(jsonChunk), &decision); err != nil {
		logClaudeIssue("invalid json decision")
		return aiBotDecision{}, false
	}
	return decision, true
}

func logOpenAIIssue(msg string) {
	now := time.Now()
	if now.Sub(openAILastLog) < 45*time.Second {
		return
	}
	openAILastLog = now
	log.Printf("OpenAI bot planner warning: %s", msg)
}

func logClaudeIssue(msg string) {
	now := time.Now()
	if now.Sub(claudeLastLog) < 45*time.Second {
		return
	}
	claudeLastLog = now
	log.Printf("Claude bot planner warning: %s", msg)
}

func extractOpenAIText(raw []byte) (string, bool) {
	type openAIContent struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	type openAIOutputItem struct {
		Type    string          `json:"type"`
		Content []openAIContent `json:"content"`
	}
	type openAIResponse struct {
		OutputText string             `json:"output_text"`
		Output     []openAIOutputItem `json:"output"`
	}

	var parsed openAIResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", false
	}
	if strings.TrimSpace(parsed.OutputText) != "" {
		return parsed.OutputText, true
	}
	for _, item := range parsed.Output {
		if item.Type != "message" {
			continue
		}
		for _, part := range item.Content {
			if part.Type == "output_text" || part.Type == "text" {
				if strings.TrimSpace(part.Text) != "" {
					return part.Text, true
				}
			}
		}
	}
	return "", false
}

func extractClaudeText(raw []byte) (string, bool) {
	type claudeContent struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	type claudeResponse struct {
		Content    []claudeContent `json:"content"`
		Completion string          `json:"completion"`
	}

	var parsed claudeResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", false
	}
	if strings.TrimSpace(parsed.Completion) != "" {
		return parsed.Completion, true
	}
	for _, part := range parsed.Content {
		if part.Type == "text" && strings.TrimSpace(part.Text) != "" {
			return part.Text, true
		}
	}
	return "", false
}

func extractJSONObject(text string) string {
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start == -1 || end == -1 || end <= start {
		return ""
	}
	return text[start : end+1]
}

func mapBuildHints(hints []string) []BuildingType {
	out := make([]BuildingType, 0, len(hints))
	seen := make(map[BuildingType]bool)
	for _, hint := range hints {
		switch strings.ToUpper(strings.TrimSpace(hint)) {
		case "WALL":
			if !seen[WALL] {
				seen[WALL] = true
				out = append(out, WALL)
			}
		case "SIMPLE_TURRET":
			if !seen[SIMPLE_TURRET] {
				seen[SIMPLE_TURRET] = true
				out = append(out, SIMPLE_TURRET)
			}
		case "SNIPER_TURRET":
			if !seen[SNIPER_TURRET] {
				seen[SNIPER_TURRET] = true
				out = append(out, SNIPER_TURRET)
			}
		case "BARRACKS":
			if !seen[BARRACKS] {
				seen[BARRACKS] = true
				out = append(out, BARRACKS)
			}
		case "GENERATOR":
			if !seen[GENERATOR] {
				seen[GENERATOR] = true
				out = append(out, GENERATOR)
			}
		case "HOUSE":
			if !seen[HOUSE] {
				seen[HOUSE] = true
				out = append(out, HOUSE)
			}
		}
	}
	if len(out) > 4 {
		out = out[:4]
	}
	return out
}

func parseMoveMode(raw string) (botMoveMode, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "defend":
		return moveDefend, true
	case "regroup":
		return moveRegroup, true
	case "pressure":
		return movePressure, true
	case "flank":
		return moveFlank, true
	default:
		return moveRegroup, false
	}
}

func sanitizeBotChat(chat string) string {
	chat = strings.TrimSpace(chat)
	chat = strings.ReplaceAll(chat, "\n", " ")
	chat = strings.ReplaceAll(chat, "\r", " ")
	for strings.Contains(chat, "  ") {
		chat = strings.ReplaceAll(chat, "  ", " ")
	}
	chat = strings.Trim(chat, `"'`)
	if chat == "" {
		return ""
	}
	runes := []rune(chat)
	if len(runes) > 58 {
		chat = strings.TrimSpace(string(runes[:58]))
		chat = strings.TrimRight(chat, ",;:-")
	}
	if strings.HasSuffix(chat, "@") {
		chat = strings.TrimSpace(strings.TrimSuffix(chat, "@"))
	}
	return chat
}

func randBoolByWeight(weight float32) bool {
	if weight <= 0 {
		return false
	}
	if weight >= 1 {
		return true
	}
	return rand.Float32() < weight
}
