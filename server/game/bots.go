package game

import (
	"fmt"
	"log"
	"math"
	"math/rand"
	"os"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultBotCount  = 5
	maxBotCount      = 32
	botNameReuseTTL  = 15 * time.Minute
	minBotPersistTTL = 70 * time.Second
	maxBotPersistTTL = 120 * time.Second
	minTargetLockTTL = 14 * time.Second
	maxTargetLockTTL = 34 * time.Second
)

type botArchetype byte

const (
	archetypeFortress botArchetype = iota
	archetypeSpearhead
	archetypePinwheel
	archetypeNomad
)

type botMoveMode byte

const (
	moveDefend botMoveMode = iota
	moveRegroup
	movePressure
	moveFlank
)

const (
	botMoveProgressMinDistance = float32(26)
	botMoveStuckTargetDistance = float32(120)
	botMoveStuckTimeout        = 9 * time.Second
	botMoveModeMinHold         = 4 * time.Second
	botMoveTargetMinHold       = 2500 * time.Millisecond
	botMoveTargetSwitchGrace   = 1800 * time.Millisecond
	botMoveTargetReachRadius   = float32(175)
	botMoveTargetRepathDelta   = float32(210)
)

type botRole byte

const (
	roleGuardian botRole = iota
	roleRaider
	roleSiege
	roleEco
	roleDuelist
)

type botBasePlan byte

const (
	basePlanAutogens botBasePlan = iota
	basePlanExternAtk
	basePlanPublicTurtle
	basePlanPublicHybrid
)

type botProfile byte

const (
	profileAttack botProfile = iota
	profileDefense
	profileHybrid
	profileEconomy
)

type botPersona byte

const (
	personaShotcaller botPersona = iota
	personaPredator
	personaArchitect
	personaSentinel
	personaWildcard
)

type botIdentityPreset struct {
	ID                 string
	Name               string
	Tag                string
	ArchetypeLabel     string
	Playstyle          string
	Personality        string
	PreferredMenu      string
	LoadBasePreference []string
	ChatStyle          string
	SystemPrompt       string
	SilentChat         bool
}

type botRelationshipState struct {
	Status string
	Reason string
}

type botRelationshipUpdate struct {
	PlayerID  string
	NewStatus string
	Reason    string
}

type botSocialChatEntry struct {
	From    string `json:"from"`
	IsHuman bool   `json:"is_human"`
	Tick    int    `json:"tick"`
	Message string `json:"message"`
	Context string `json:"context"`
}

type botObservedPlayer struct {
	ID                 string   `json:"id"`
	IsHuman            bool     `json:"is_human"`
	CurrentRank        int      `json:"current_rank"`
	BaseHealth         int      `json:"base_health"`
	ResourcesTier      string   `json:"resources_tier"`
	BuildingsVisible   []string `json:"buildings_visible"`
	LastAction         string   `json:"last_action"`
	LastActionTick     int      `json:"last_action_tick"`
	LayoutStyle        string   `json:"layout_style"`
	AggressionLevel    string   `json:"aggression_level"`
	ChatStyleTags      []string `json:"chat_style_tags"`
	RelationshipWithMe string   `json:"relationship_with_me"`
}

type botSocialFastestElimination struct {
	Attacker string `json:"attacker"`
	Target   string `json:"target"`
	Tick     int    `json:"tick"`
	Method   string `json:"method"`
}

type botSocialMatchMeta struct {
	WhoIsWinning                 string                       `json:"who_is_winning"`
	WinningStrategy              string                       `json:"winning_strategy"`
	MostEffectiveActionThisMatch string                       `json:"most_effective_action_this_match"`
	FastestEliminationThisMatch  *botSocialFastestElimination `json:"fastest_elimination_this_match,omitempty"`
	ChatVocabularyPool           []string                     `json:"chat_vocabulary_pool"`
}

type botSocialRelationships struct {
	Rivals   []string          `json:"rivals"`
	Friendly []string          `json:"friendly"`
	Neutral  []string          `json:"neutral"`
	Notes    map[string]string `json:"notes"`
}

type botSocialPayload struct {
	ChatLog              []botSocialChatEntry   `json:"chat_log"`
	ObservedPlayers      []botObservedPlayer    `json:"observed_players"`
	MatchMeta            botSocialMatchMeta     `json:"match_meta"`
	MyRelationships      botSocialRelationships `json:"my_relationships"`
	MyAbsorbedVocabulary []string               `json:"my_absorbed_vocabulary"`
}

type botRuntime struct {
	playerID ID

	language string
	identity botIdentityPreset

	archetype  botArchetype
	role       botRole
	basePlan   botBasePlan
	profile    botProfile
	persona    botPersona
	buildStyle byte // 0=econ, 1=balanced, 2=aggressive

	aggression float32 // How often it pushes.
	macroFocus float32 // How much it builds.
	chatter    float32 // Chat frequency.
	radialBias float32 // Base placement bias (inner/outer).
	teamplay   float32 // Willingness to coordinate attacks.
	patience   float32 // How long it sticks to same plan.
	layoutDNA  byte    // Base layout variation.

	anchorA float64
	anchorB float64
	cursor  float64
	phase   int

	legacyLayoutName   string
	legacyLayoutSlots  []botLegacySocketSlot
	legacyLayoutCursor int

	nextBuildAt time.Time
	nextMoveAt  time.Time
	nextChatAt  time.Time
	lastChatAt  time.Time

	lastMode           botMoveMode
	lastModeChangeAt   time.Time
	lastEnemyName      string
	lastDuelAt         time.Time
	lastCommanderAt    time.Time
	lastUpgradeAt      time.Time
	lastDefendAt       time.Time
	attackUnlockedAt   time.Time
	attackCommitUntil  time.Time
	targetPlayerID     ID
	targetLockedUntil  time.Time
	lastMoveCentroid   PositionFloat
	lastMoveSampleAt   time.Time
	lastMoveProgressAt time.Time
	lastMoveTarget     PositionFloat
	lastMoveTargetAt   time.Time
	lastMoveTargetMode botMoveMode
	unstuckUntil       time.Time
	unstuckBursts      int
	nextRecycleAt      time.Time

	nextThinkAt           time.Time
	nextPersistAt         time.Time
	thought               botThoughtPlan
	lastChatText          string
	chatHistory           []string
	baseSaved             bool
	absorbedVocabulary    []string
	relationships         map[string]botRelationshipState
	lastSocialObservation string

	externalThoughtReady bool
	externalFailStreak   int
	localBrain           *localBotBrain
	goChatMem            *ChatMemory
}

type botThoughtPlan struct {
	validUntil         time.Time
	buildHints         []BuildingType
	buildSequence      []BuildingType
	forceMode          *botMoveMode
	allowPush          *bool
	setGroupUnits      *bool
	tryCommander       bool
	tryUpgrade         bool
	useDefend          bool
	chat               string
	reactionChat       string
	menuUsed           string
	loadBaseQuery      string
	socialObservation  string
	vocabularyAbsorbed []string
	relationshipUpdate *botRelationshipUpdate
}

type botBuildingSummary struct {
	walls     int
	gens      int
	houses    int
	barracks  int
	turrets   int
	snipers   int
	buildings int
}

type botProfessionalTemplate struct {
	Name            string
	OpeningVariants [][]BuildingType
	MidCycle        []BuildingType
	UpgradePriority []BuildingType
	TargetGens      int
	TargetHouses    int
	TargetBarracks  int
	TargetWalls     int
	TargetDefense   int
}

var botNamesPreset = []string{
	"jao",
	"duda",
	"bia",
	"nina",
	"kadu",
	"biel",
	"teca",
	"lilo",
	"tata",
	"zeca",
	"nino",
	"caue",
	"luan",
	"rafa",
	"breno",
	"caio",
	"enzo",
	"davi",
	"jojo",
	"luca",
	"mika",
	"dani",
	"gabi",
	"yuri",
	"vini",
	"leo",
	"pedro",
	"mari",
	"lili",
	"naty",
	"pietro",
	"junin",
	"tutu",
	"babi",
	"kira",
	"loki",
	"zeze",
	"beto",
	"nando",
	"ceci",
	"maya",
	"biah",
	"rubi",
	"dora",
	"lola",
	"breno7",
	"joquinha",
	"maru",
	"guto",
	"tiago",
	"samu",
	"muris",
	"allan",
	"kaua",
	"nico",
	"digu",
	"renan",
	"pablo",
	"soso",
	"brisa",
}

var botIdentityPresets = []botIdentityPreset{
	{ID: "bot_01", Name: "BRUTO", Tag: "[BRUTO]", ArchetypeLabel: "Rusher Agressivo", Playstyle: "ExternAtk puro e pressão psicológica", Personality: "Provocador e direto", PreferredMenu: "ExternAtk", LoadBasePreference: []string{"rush", "atk", "ofensivo"}, ChatStyle: "curto e agressivo", SystemPrompt: "Voce e BRUTO. Priorize ExternAtk, ataque cedo e pressione sem recuar."},
	{ID: "bot_02", Name: "AEGIS", Tag: "[AEGIS]", ArchetypeLabel: "Defensor Calculista", Playstyle: "Autogen + Defend e contra-ataque no timing", Personality: "Frio e analitico", PreferredMenu: "Defend", LoadBasePreference: []string{"defend", "wall", "fortress"}, ChatStyle: "tecnico e curto", SystemPrompt: "Voce e AEGIS. Defenda com disciplina, escale economia e ataque apenas em janela favoravel."},
	{ID: "bot_03", Name: "NOVA", Tag: "[NOVA]", ArchetypeLabel: "Adaptativa", Playstyle: "Leitura de meta e troca de plano", Personality: "Observadora", PreferredMenu: "LoadBase", LoadBasePreference: []string{"popular", "high_winrate", "meta"}, ChatStyle: "observacional", SystemPrompt: "Voce e NOVA. Observe o meta atual e adapte taticas em tempo real."},
	{ID: "bot_04", Name: "REX", Tag: "[REX]", ArchetypeLabel: "Veterano", Playstyle: "Economia solida e late game", Personality: "Calmo e experiente", PreferredMenu: "Defend", LoadBasePreference: []string{"eco", "classic", "autogen"}, ChatStyle: "calmo", SystemPrompt: "Voce e REX. Jogue com paciencia, economia forte e execucao limpa no late."},
	{ID: "bot_05", Name: "GLITCH", Tag: "[GLITCH]", ArchetypeLabel: "Caotico", Playstyle: "Padrao imprevisivel", Personality: "Erratico", PreferredMenu: "LoadBase", LoadBasePreference: []string{"experimental", "unusual", "chaos"}, ChatStyle: "fragmentado", SystemPrompt: "Voce e GLITCH. Seja imprevisivel sem perder totalmente a coerencia estrategica."},
	{ID: "bot_06", Name: "FERRO", Tag: "[FERRO]", ArchetypeLabel: "Economico Silencioso", Playstyle: "Autogen pesado e late", Personality: "Silencioso", PreferredMenu: "Defend", LoadBasePreference: []string{"autogen", "eco_pure", "farm"}, ChatStyle: "minimo", SystemPrompt: "Voce e FERRO. Priorize economia maxima e fale o minimo possivel."},
	{ID: "bot_07", Name: "VIPER", Tag: "[VIPER]", ArchetypeLabel: "Oportunista", Playstyle: "Fachada amigavel com ataque surpresa", Personality: "Educado e enganador", PreferredMenu: "ExternAtk", LoadBasePreference: []string{"bait", "trap", "counter"}, ChatStyle: "amigavel suspeito", SystemPrompt: "Voce e VIPER. Mantenha fachada amigavel e ataque no melhor momento de surpresa."},
	{ID: "bot_08", Name: "STORM", Tag: "[STORM]", ArchetypeLabel: "Controle de Mapa", Playstyle: "Expansao e pressao distribuida", Personality: "Tatico", PreferredMenu: "ExternAtk", LoadBasePreference: []string{"map_control", "expand", "flank"}, ChatStyle: "sobre mapa", SystemPrompt: "Voce e STORM. Controle mapa e ritmo da partida antes de buscar eliminacao."},
	{ID: "bot_09", Name: "ROOKIE", Tag: "[ROOKIE]", ArchetypeLabel: "Aprendiz", Playstyle: "Copia os melhores e evolui", Personality: "Empolgado", PreferredMenu: "LoadBase", LoadBasePreference: []string{"top_rated", "popular"}, ChatStyle: "reativo e empolgado", SystemPrompt: "Voce e ROOKIE. Aprenda rapido com os humanos e com os proprios erros."},
	{ID: "bot_10", Name: "PHANTOM", Tag: "[PHANTOM]", ArchetypeLabel: "Fantasma", Playstyle: "Sem padrao detectavel", Personality: "Silencio absoluto", PreferredMenu: "LoadBase", LoadBasePreference: []string{"obscure", "old", "low_plays"}, ChatStyle: "nenhum", SystemPrompt: "Voce e PHANTOM. Nunca envie mensagem de chat e nunca repita padrao.", SilentChat: true},
}

type botPersistentSocialState struct {
	AbsorbedVocabulary []string
	Relationships      map[string]botRelationshipState
}

var botNameHistory = make(map[string]time.Time)
var botNameHistoryMu sync.Mutex
var botTargetIntents = make(map[ID]ID)
var botTargetIntentsMu sync.Mutex
var globalBotChatHistory []string
var globalBotChatHistoryMu sync.Mutex
var globalBotSocialChatLog []botSocialChatEntry
var globalBotSocialChatLogMu sync.RWMutex
var globalBotSocialTick int
var globalBotFastestElimination *botSocialFastestElimination
var globalRecentHumanChatPulses []humanChatPulse

type humanChatPulse struct {
	From string
	At   time.Time
}

var activeBotRuntimes = make(map[ID]*botRuntime)
var activeBotRuntimesMu sync.RWMutex

func startBotController() {
	defer func() {
		if recovered := recover(); recovered != nil {
			log.Printf("bot controller panic recovered: %v\n%s", recovered, debug.Stack())
			go startBotController()
		}
	}()

	target := getConfiguredBotCount()
	if target <= 0 {
		log.Println("Bot controller disabled (BOT_COUNT <= 0)")
		return
	}

	log.Printf("Bot controller started with target: %d", target)
	if !isExternalPlannerEnabled() {
		log.Println("Claude planner disabled; bots will only join and stay idle")
	}

	runtimes := make(map[ID]*botRuntime)
	globalNextChatAt := time.Now()
	nextRotationAt := time.Now().Add(randomDuration(5*time.Minute, 10*time.Minute))
	ticker := time.NewTicker(900 * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		if Status != Running {
			continue
		}

		syncBotPopulation(target, runtimes)

		now := time.Now()
		if now.After(nextRotationAt) {
			rotateOneBot(runtimes)
			nextRotationAt = now.Add(randomDuration(5*time.Minute, 10*time.Minute))
		}

		for botID, rt := range runtimes {
			func(botID ID, rt *botRuntime) {
				defer func() {
					if recovered := recover(); recovered != nil {
						log.Printf("bot runtime panic recovered (botID=%d): %v\n%s", botID, recovered, debug.Stack())
						ClearBotRuntimeIntent(botID)
						delete(runtimes, botID)
					}
				}()

				player := getBotByID(botID)
				if player == nil || player.IsMarkedForRemoval() {
					ClearBotRuntimeIntent(botID)
					delete(runtimes, botID)
					return
				}

				if rt.goChatMem != nil {
					chatFeed := chatFeedFromSocialEntries(getRecentSocialChatLog(30, 40))
					rt.goChatMem.ObserveChatFeed(chatFeed, rt.identity.ID, currentSocialTick())
				}
				if now.After(rt.nextPersistAt) {
					flushBotRuntimePersistence(rt)
					rt.nextPersistAt = now.Add(randomDuration(minBotPersistTTL, maxBotPersistTTL))
				}

				// Claude-only mode: without Claude planner enabled, bots only join and idle.
				if !isExternalPlannerEnabled() {
					return
				}

				if now.After(rt.nextThinkAt) {
					refreshBotThought(player, rt)
					rt.nextThinkAt = now.Add(nextThinkDelay(rt))
				}

				if now.After(rt.nextBuildAt) {
					if runBotBuild(player, rt) {
						rt.nextBuildAt = now.Add(nextBuildDelay(rt, true))
					} else {
						rt.nextBuildAt = now.Add(nextBuildDelay(rt, false))
					}
				}

				if now.After(rt.nextMoveAt) {
					runBotMovement(player, rt)
					rt.nextMoveAt = now.Add(nextMoveDelay(rt))
				}

				if now.After(rt.nextChatAt) && now.After(globalNextChatAt) {
					if runBotChat(player, rt) {
						globalNextChatAt = now.Add(randomDuration(18*time.Second, 40*time.Second))
					}
					rt.nextChatAt = now.Add(nextChatDelay(rt))
				}
			}(botID, rt)
		}
	}
}

func getConfiguredBotCount() int {
	raw := strings.TrimSpace(os.Getenv("BOT_COUNT"))
	if raw == "" {
		return defaultBotCount
	}

	n, err := strconv.Atoi(raw)
	if err != nil {
		log.Printf("Invalid BOT_COUNT value %q, using default %d", raw, defaultBotCount)
		return defaultBotCount
	}
	if n < 0 {
		return 0
	}
	if n > maxBotCount {
		return maxBotCount
	}
	return n
}

func syncBotPopulation(target int, runtimes map[ID]*botRuntime) {
	activeBots := make(map[ID]*Player)

	State.RLock()
	for id, player := range State.Players {
		if player == nil || player.IsMarkedForRemoval() || !player.IsBot {
			continue
		}
		activeBots[id] = player
	}
	State.RUnlock()

	for id := range runtimes {
		if _, ok := activeBots[id]; !ok {
			ClearBotRuntimeIntent(id)
			delete(runtimes, id)
		}
	}

	for id := range activeBots {
		if _, ok := runtimes[id]; !ok {
			p := activeBots[id]
			identity := fallbackIdentityForPlayerID(id)
			if cached := getActiveBotRuntime(id); cached != nil && strings.TrimSpace(cached.identity.ID) != "" {
				identity = cached.identity
			} else if p != nil {
				if detected, ok := findBotIdentityByName(getPlayerName(p)); ok {
					identity = detected
				}
			}
			runtimes[id] = newBotRuntime(id, "", identity)
		}
	}

	if len(activeBots) < target {
		missing := target - len(activeBots)
		for i := 0; i < missing; i++ {
			player, runtime, ok := spawnBot()
			if !ok {
				break
			}
			activeBots[player.ID] = player
			runtimes[player.ID] = runtime
		}
		return
	}

	if len(activeBots) > target {
		toRemove := len(activeBots) - target
		for id := range activeBots {
			if toRemove <= 0 {
				break
			}
			rememberBotName(getPlayerName(activeBots[id]), time.Now())
			_, _, _, _, removed := RemovePlayerByID(id)
			if removed {
				ClearBotRuntimeIntent(id)
				TriggerPlayerLeftEvent(id)
				delete(runtimes, id)
				toRemove--
			}
		}
	}
}

func rotateOneBot(runtimes map[ID]*botRuntime) {
	if len(runtimes) == 0 {
		return
	}

	ids := make([]ID, 0, len(runtimes))
	for id := range runtimes {
		ids = append(ids, id)
	}
	leavingID := ids[rand.Intn(len(ids))]
	if leaving := getBotByID(leavingID); leaving != nil {
		rememberBotName(getPlayerName(leaving), time.Now())
	}

	_, _, _, _, removed := RemovePlayerByID(leavingID)
	if removed {
		ClearBotRuntimeIntent(leavingID)
		TriggerPlayerLeftEvent(leavingID)
		delete(runtimes, leavingID)
	}

	player, runtime, ok := spawnBot()
	if ok {
		runtimes[player.ID] = runtime
	}
}

func nextThinkDelay(rt *botRuntime) time.Duration {
	if rt == nil {
		return randomDuration(1400*time.Millisecond, 3200*time.Millisecond)
	}
	min := 1600 * time.Millisecond
	max := 3400 * time.Millisecond
	switch rt.role {
	case roleGuardian:
		min = 1800 * time.Millisecond
		max = 3800 * time.Millisecond
	case roleRaider, roleDuelist:
		min = 1200 * time.Millisecond
		max = 2800 * time.Millisecond
	case roleEco:
		min = 2000 * time.Millisecond
		max = 4200 * time.Millisecond
	}
	return randomDuration(min, max)
}

func newBotRuntime(playerID ID, languageHint string, identity botIdentityPreset) *botRuntime {
	if identity.ID == "" {
		identity = defaultBotIdentity()
	}
	language := languageHint
	if language == "" {
		language = "pt"
	}

	profile := pickBotProfile(playerID)
	archetype := pickArchetypeForProfile(profile)
	persona := pickBotPersona(profile)
	aggression := 0.3 + rand.Float32()*0.6
	macro := 0.35 + rand.Float32()*0.55
	chatter := 0.18 + rand.Float32()*0.65
	radialBias := 0.2 + rand.Float32()*0.7
	teamplay := 0.25 + rand.Float32()*0.65
	patience := 0.2 + rand.Float32()*0.75
	layoutDNA := byte(rand.Intn(4))
	role := pickRoleForProfile(profile, archetype)
	basePlan := pickBotBasePlanForProfile(profile, role, archetype)

	style := byte(1)
	switch profile {
	case profileAttack:
		style = 2
		aggression = randRange32(0.78, 0.97)
		macro = randRange32(0.46, 0.68)
		radialBias = randRange32(0.62, 0.88)
		teamplay = randRange32(0.42, 0.82)
		patience = randRange32(0.36, 0.70)
	case profileDefense:
		style = 1
		aggression = randRange32(0.24, 0.52)
		macro = randRange32(0.66, 0.92)
		radialBias = randRange32(0.34, 0.56)
		teamplay = randRange32(0.50, 0.88)
		patience = randRange32(0.66, 0.95)
	case profileHybrid:
		style = 1
		aggression = randRange32(0.52, 0.80)
		macro = randRange32(0.52, 0.78)
		radialBias = randRange32(0.44, 0.70)
		teamplay = randRange32(0.45, 0.80)
		patience = randRange32(0.46, 0.78)
	case profileEconomy:
		style = 0
		aggression = randRange32(0.30, 0.58)
		macro = randRange32(0.74, 0.96)
		radialBias = randRange32(0.30, 0.58)
		teamplay = randRange32(0.42, 0.78)
		patience = randRange32(0.58, 0.90)
	}

	switch identity.ID {
	case "bot_01": // BRUTO
		profile, role, basePlan, persona, style = profileAttack, roleRaider, basePlanExternAtk, personaPredator, 2
		aggression = randRange32(0.84, 0.98)
		macro = randRange32(0.42, 0.62)
		chatter = randRange32(0.42, 0.76)
	case "bot_02": // AEGIS
		profile, role, basePlan, persona, style = profileDefense, roleGuardian, basePlanAutogens, personaSentinel, 1
		aggression = randRange32(0.18, 0.34)
		macro = randRange32(0.82, 0.97)
		chatter = randRange32(0.10, 0.24)
	case "bot_03": // NOVA
		profile, role, basePlan, persona, style = profileHybrid, roleSiege, basePlanPublicHybrid, personaShotcaller, 1
		aggression = randRange32(0.42, 0.68)
		macro = randRange32(0.56, 0.84)
		chatter = randRange32(0.24, 0.46)
	case "bot_04": // REX
		profile, role, basePlan, persona, style = profileEconomy, roleEco, basePlanAutogens, personaArchitect, 0
		aggression = randRange32(0.24, 0.46)
		macro = randRange32(0.80, 0.97)
		chatter = randRange32(0.12, 0.26)
	case "bot_05": // GLITCH
		profile, role, basePlan, persona, style = profileHybrid, roleDuelist, basePlanPublicHybrid, personaWildcard, 1
		aggression = randRange32(0.34, 0.92)
		macro = randRange32(0.34, 0.92)
		chatter = randRange32(0.28, 0.62)
	case "bot_06": // FERRO
		profile, role, basePlan, persona, style = profileEconomy, roleEco, basePlanAutogens, personaArchitect, 0
		aggression = randRange32(0.18, 0.32)
		macro = randRange32(0.88, 0.99)
		chatter = randRange32(0.02, 0.08)
	case "bot_07": // VIPER
		profile, role, basePlan, persona, style = profileHybrid, roleRaider, basePlanExternAtk, personaShotcaller, 2
		aggression = randRange32(0.62, 0.86)
		macro = randRange32(0.48, 0.72)
		chatter = randRange32(0.28, 0.52)
	case "bot_08": // STORM
		profile, role, basePlan, persona, style = profileHybrid, roleSiege, basePlanPublicHybrid, personaShotcaller, 1
		aggression = randRange32(0.48, 0.74)
		macro = randRange32(0.56, 0.82)
		chatter = randRange32(0.14, 0.32)
	case "bot_09": // ROOKIE
		profile, role, basePlan, persona, style = profileHybrid, roleGuardian, basePlanPublicHybrid, personaWildcard, 1
		aggression = randRange32(0.36, 0.72)
		macro = randRange32(0.44, 0.76)
		chatter = randRange32(0.32, 0.68)
	case "bot_10": // PHANTOM
		profile, role, basePlan, persona, style = profileAttack, roleDuelist, basePlanExternAtk, personaWildcard, 2
		aggression = randRange32(0.58, 0.88)
		macro = randRange32(0.44, 0.72)
		chatter = 0.0
	}

	anchorSeed := float64(int(playerID)%8) * (math.Pi / 4)
	anchorA := anchorSeed + (rand.Float64()-0.5)*(math.Pi/18)
	anchorB := anchorA + math.Pi/2
	unlockDelay := randomDuration(28*time.Second, 72*time.Second)
	if basePlan == basePlanExternAtk || profile == profileAttack || role == roleRaider {
		unlockDelay = randomDuration(16*time.Second, 44*time.Second)
	}
	if aggression > 0.75 && unlockDelay > 20*time.Second {
		unlockDelay -= randomDuration(6*time.Second, 12*time.Second)
	}
	absorbedVocabulary := []string{}
	relationships := make(map[string]botRelationshipState)
	absorbedVocabulary, relationships = loadBotPersistentSocialState(identity.ID)
	if absorbedVocabulary == nil {
		absorbedVocabulary = []string{}
	}
	if relationships == nil {
		relationships = make(map[string]botRelationshipState)
	}
	brain := getOrCreateLocalBrain(identity)
	if persistedBrain, err := loadBotPersonalityState(identity.ID); err == nil && persistedBrain != nil && brain != nil {
		brain.mu.Lock()
		brain.dynamicAggression = clampFloat64(persistedBrain.dynamicAggression, 0.0, 1.0)
		brain.dynamicPatience = clampFloat64(persistedBrain.dynamicPatience, 0.0, 1.0)
		if persistedBrain.learnedAttackTick > 0 {
			brain.learnedAttackTick = persistedBrain.learnedAttackTick
		}
		if persistedBrain.learnedEcoTarget > 0 {
			brain.learnedEcoTarget = persistedBrain.learnedEcoTarget
		}
		brain.winStreak = maxInt(0, persistedBrain.winStreak)
		brain.lossStreak = maxInt(0, persistedBrain.lossStreak)
		brain.partiesPlayed = maxInt(0, persistedBrain.partiesPlayed)
		brain.mu.Unlock()
	} else if err != nil {
		log.Printf("bot personality load failed for %s: %v", identity.ID, err)
	}
	chatMem := loadChatMemoryForBot(identity.ID)

	rt := &botRuntime{
		playerID:           playerID,
		language:           language,
		identity:           identity,
		archetype:          archetype,
		role:               role,
		basePlan:           basePlan,
		profile:            profile,
		persona:            persona,
		buildStyle:         style,
		aggression:         aggression,
		macroFocus:         macro,
		chatter:            chatter,
		radialBias:         radialBias,
		teamplay:           teamplay,
		patience:           patience,
		layoutDNA:          layoutDNA,
		anchorA:            anchorA,
		anchorB:            anchorB,
		cursor:             rand.Float64() * 2 * math.Pi,
		phase:              0,
		nextBuildAt:        time.Now().Add(randomDuration(900*time.Millisecond, 2600*time.Millisecond)),
		nextMoveAt:         time.Now().Add(randomDuration(700*time.Millisecond, 2*time.Second)),
		nextChatAt:         time.Now().Add(randomDuration(18*time.Second, 36*time.Second)),
		nextThinkAt:        time.Now().Add(randomDuration(1200*time.Millisecond, 2400*time.Millisecond)),
		nextPersistAt:      time.Now().Add(randomDuration(minBotPersistTTL, maxBotPersistTTL)),
		lastMode:           moveRegroup,
		attackUnlockedAt:   time.Now().Add(unlockDelay),
		absorbedVocabulary: absorbedVocabulary,
		relationships:      relationships,
		localBrain:         brain,
		goChatMem:          chatMem,
	}
	refreshBotLegacyLayout(rt)
	registerActiveLocalBrain(playerID, rt.localBrain)
	registerActiveChatMemory(playerID, identity.ID, rt.goChatMem)
	registerActiveBotRuntime(playerID, rt)
	return rt
}

func pickBotRole(archetype botArchetype, aggression float32, macro float32) botRole {
	switch {
	case aggression >= 0.78:
		if rand.Float32() < 0.35 {
			return roleDuelist
		}
		return roleRaider
	case macro >= 0.72:
		return roleEco
	case archetype == archetypeFortress:
		return roleGuardian
	case archetype == archetypeSpearhead:
		return roleSiege
	default:
		if rand.Float32() < 0.5 {
			return roleRaider
		}
		return roleGuardian
	}
}

func botRoleName(role botRole) string {
	switch role {
	case roleGuardian:
		return "guardian"
	case roleRaider:
		return "raider"
	case roleSiege:
		return "siege"
	case roleEco:
		return "eco"
	case roleDuelist:
		return "duelist"
	default:
		return "balanced"
	}
}

func pickBotBasePlan(role botRole, archetype botArchetype) botBasePlan {
	switch role {
	case roleEco:
		return basePlanAutogens
	case roleRaider:
		return basePlanExternAtk
	case roleGuardian:
		return basePlanPublicTurtle
	case roleSiege:
		if rand.Float32() < 0.5 {
			return basePlanExternAtk
		}
		return basePlanPublicHybrid
	case roleDuelist:
		return basePlanPublicHybrid
	default:
		if archetype == archetypePinwheel {
			return basePlanAutogens
		}
		return basePlanPublicHybrid
	}
}

func pickBotProfile(playerID ID) botProfile {
	// Stable profile mix across active bots.
	switch int(playerID) % 10 {
	case 0, 1, 2:
		return profileAttack
	case 3, 4, 5:
		return profileDefense
	case 6, 7:
		return profileHybrid
	default:
		return profileEconomy
	}
}

func pickArchetypeForProfile(profile botProfile) botArchetype {
	switch profile {
	case profileAttack:
		if rand.Float32() < 0.55 {
			return archetypeSpearhead
		}
		return archetypeNomad
	case profileDefense:
		if rand.Float32() < 0.7 {
			return archetypeFortress
		}
		return archetypePinwheel
	case profileHybrid:
		if rand.Float32() < 0.5 {
			return archetypePinwheel
		}
		return archetypeSpearhead
	case profileEconomy:
		if rand.Float32() < 0.58 {
			return archetypePinwheel
		}
		return archetypeFortress
	default:
		return botArchetype(rand.Intn(4))
	}
}

func pickRoleForProfile(profile botProfile, archetype botArchetype) botRole {
	switch profile {
	case profileAttack:
		switch rand.Intn(3) {
		case 0:
			return roleRaider
		case 1:
			return roleSiege
		default:
			return roleDuelist
		}
	case profileDefense:
		if rand.Float32() < 0.74 {
			return roleGuardian
		}
		return roleEco
	case profileHybrid:
		switch rand.Intn(3) {
		case 0:
			return roleSiege
		case 1:
			return roleRaider
		default:
			return roleGuardian
		}
	case profileEconomy:
		if rand.Float32() < 0.78 {
			return roleEco
		}
		return roleGuardian
	default:
		return pickBotRole(archetype, 0.5, 0.5)
	}
}

func pickBotBasePlanForProfile(profile botProfile, role botRole, archetype botArchetype) botBasePlan {
	switch profile {
	case profileAttack:
		if rand.Float32() < 0.93 {
			return basePlanExternAtk
		}
		return basePlanAutogens
	case profileDefense:
		if rand.Float32() < 0.9 {
			return basePlanAutogens
		}
		return basePlanExternAtk
	case profileHybrid:
		if rand.Float32() < 0.6 {
			return basePlanExternAtk
		}
		return basePlanAutogens
	case profileEconomy:
		if rand.Float32() < 0.94 {
			return basePlanAutogens
		}
		return basePlanExternAtk
	default:
		if role == roleRaider || archetype == archetypeSpearhead {
			return basePlanExternAtk
		}
		return basePlanAutogens
	}
}

func botProfileName(profile botProfile) string {
	switch profile {
	case profileAttack:
		return "attack"
	case profileDefense:
		return "defense"
	case profileHybrid:
		return "hybrid"
	case profileEconomy:
		return "economy"
	default:
		return "mixed"
	}
}

func pickBotPersona(profile botProfile) botPersona {
	switch profile {
	case profileAttack:
		if rand.Float32() < 0.55 {
			return personaPredator
		}
		return personaShotcaller
	case profileDefense:
		if rand.Float32() < 0.58 {
			return personaSentinel
		}
		return personaArchitect
	case profileHybrid:
		switch rand.Intn(3) {
		case 0:
			return personaShotcaller
		case 1:
			return personaArchitect
		default:
			return personaWildcard
		}
	case profileEconomy:
		if rand.Float32() < 0.7 {
			return personaArchitect
		}
		return personaSentinel
	default:
		return botPersona(rand.Intn(5))
	}
}

func botPersonaName(persona botPersona) string {
	switch persona {
	case personaShotcaller:
		return "shotcaller"
	case personaPredator:
		return "predator"
	case personaArchitect:
		return "architect"
	case personaSentinel:
		return "sentinel"
	case personaWildcard:
		return "wildcard"
	default:
		return "balanced"
	}
}

func botPersonaDirective(persona botPersona) string {
	switch persona {
	case personaShotcaller:
		return "Coordinate tempo, call rotations, and create synchronized pressure windows."
	case personaPredator:
		return "Exploit weak enemies quickly, punish overextension, and force short decisive fights."
	case personaArchitect:
		return "Prioritize clean structure, layered defenses, and long-term economic scaling."
	case personaSentinel:
		return "Protect core territory first, absorb pressure, and counterattack only after stabilization."
	case personaWildcard:
		return "Mix tempo shifts and flanks to stay unpredictable while preserving strategic coherence."
	default:
		return "Balance economy, defense, and pressure based on the current game state."
	}
}

func botBasePlanName(plan botBasePlan) string {
	switch plan {
	case basePlanAutogens:
		return "autogens"
	case basePlanExternAtk:
		return "extern_atk"
	case basePlanPublicTurtle:
		return "public_turtle"
	case basePlanPublicHybrid:
		return "public_hybrid"
	default:
		return "mixed"
	}
}

func defaultBotIdentity() botIdentityPreset {
	if len(botIdentityPresets) == 0 {
		return botIdentityPreset{
			ID:            "bot_default",
			Name:          "BOT",
			Tag:           "BOT",
			PreferredMenu: "Defend",
		}
	}
	return botIdentityPresets[0]
}

func fallbackIdentityForPlayerID(playerID ID) botIdentityPreset {
	if len(botIdentityPresets) == 0 {
		return defaultBotIdentity()
	}
	idx := int(playerID) % len(botIdentityPresets)
	if idx < 0 {
		idx = -idx
	}
	return botIdentityPresets[idx]
}

func findBotIdentityByName(name string) (botIdentityPreset, bool) {
	normalized := normalizeBotName(strings.TrimSpace(name))
	if normalized == "" {
		return botIdentityPreset{}, false
	}
	for _, preset := range botIdentityPresets {
		if normalizeBotName(preset.Name) == normalized || normalizeBotName(preset.Tag) == normalized {
			return preset, true
		}
	}
	// Support runtime aliases like "BRUTO42" while keeping the same personality profile.
	for _, preset := range botIdentityPresets {
		base := normalizeBotName(strings.TrimSpace(preset.Name))
		if base == "" || !strings.HasPrefix(normalized, base) {
			continue
		}
		suffix := strings.TrimPrefix(normalized, base)
		if isAllDigits(suffix) {
			return preset, true
		}
	}
	return botIdentityPreset{}, false
}

func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func presetAliasBase(preset botIdentityPreset) string {
	base := strings.TrimSpace(preset.Name)
	if base == "" {
		base = strings.TrimSpace(preset.Tag)
	}
	if base == "" {
		return ""
	}

	// Keep only letters/digits to avoid symbols from tags like "[BRUTO]".
	clean := make([]rune, 0, len(base))
	for _, r := range base {
		isLetter := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
		isDigit := r >= '0' && r <= '9'
		if isLetter || isDigit {
			clean = append(clean, r)
		}
	}
	if len(clean) == 0 {
		return ""
	}
	return trimTo12(string(clean))
}

func loadBotPersistentSocialState(identityID string) ([]string, map[string]botRelationshipState) {
	if strings.TrimSpace(identityID) == "" {
		return []string{}, make(map[string]botRelationshipState)
	}

	sanitize := func(source *botPersistentSocialState) ([]string, map[string]botRelationshipState) {
		if source == nil {
			return []string{}, make(map[string]botRelationshipState)
		}
		vocabulary := make([]string, 0, len(source.AbsorbedVocabulary))
		seenVocab := make(map[string]struct{})
		for _, w := range source.AbsorbedVocabulary {
			word := strings.TrimSpace(strings.ToLower(w))
			if word == "" {
				continue
			}
			if _, exists := seenVocab[word]; exists {
				continue
			}
			seenVocab[word] = struct{}{}
			vocabulary = append(vocabulary, word)
			if len(vocabulary) >= 60 {
				break
			}
		}

		relationships := make(map[string]botRelationshipState, len(source.Relationships))
		for k, v := range source.Relationships {
			key := strings.TrimSpace(k)
			if key == "" {
				continue
			}
			relationships[key] = v
		}
		return vocabulary, relationships
	}

	if mem, err := loadBotMemoryFromDB(identityID); err == nil && mem != nil {
		vocabulary, relationships := sanitize(mem)
		return vocabulary, relationships
	} else if err != nil {
		log.Printf("bot social memory load failed for %s: %v", identityID, err)
	}

	return []string{}, make(map[string]botRelationshipState)
}

func saveBotPersistentSocialState(rt *botRuntime) {
	if rt == nil || strings.TrimSpace(rt.identity.ID) == "" {
		return
	}

	vocabulary := make([]string, 0, len(rt.absorbedVocabulary))
	seenVocab := make(map[string]struct{})
	for _, w := range rt.absorbedVocabulary {
		word := strings.TrimSpace(strings.ToLower(w))
		if word == "" {
			continue
		}
		if _, exists := seenVocab[word]; exists {
			continue
		}
		seenVocab[word] = struct{}{}
		vocabulary = append(vocabulary, word)
		if len(vocabulary) >= 60 {
			break
		}
	}

	relationships := make(map[string]botRelationshipState, len(rt.relationships))
	for k, v := range rt.relationships {
		key := strings.TrimSpace(k)
		if key == "" {
			continue
		}
		relationships[key] = v
	}

	_ = upsertBotVocabBatch(rt.identity.ID, vocabulary)
	for playerName, rel := range relationships {
		_ = upsertBotRelationship(rt.identity.ID, playerName, rel.Status, rel.Reason)
	}
}

func spawnBot() (*Player, *botRuntime, bool) {
	name, language, identity := randomBotIdentity()
	player, ok := AddPlayer(nil, PERMISSION_NONE, []byte(name), randomBotColor(), 0, "")
	if !ok || player == nil {
		return nil, nil, false
	}
	rememberBotName(name, time.Now())

	runtime := newBotRuntime(player.ID, language, identity)
	player.SetGroupUnits(runtime.aggression >= 0.4)
	if isExternalPlannerEnabled() {
		refreshBotThought(player, runtime)
		runtime.nextThinkAt = time.Now().Add(nextThinkDelay(runtime))
	}

	TriggerPlayerJoinedEvent(player)
	log.Printf(
		"Bot joined: %s (id=%d, lang=%s, profile=%s, role=%s, persona=%s, bot=%s, menu=%s, plan=%s, arch=%d, aggr=%.2f, macro=%.2f)",
		getPlayerName(player),
		player.ID,
		language,
		botProfileName(runtime.profile),
		botRoleName(runtime.role),
		botPersonaName(runtime.persona),
		runtime.identity.Name,
		runtime.identity.PreferredMenu,
		botBasePlanName(runtime.basePlan),
		runtime.archetype,
		runtime.aggression,
		runtime.macroFocus,
	)
	return player, runtime, true
}

func randomBotIdentity() (string, string, botIdentityPreset) {
	active := activeBotNames()
	now := time.Now()
	identity := defaultBotIdentity()
	if len(botIdentityPresets) > 0 {
		identity = botIdentityPresets[rand.Intn(len(botIdentityPresets))]
	}

	if name, ok := pickUniqueBotName(botNamesPreset, active, now); ok {
		return name, randomBotLanguage(), identity
	}

	for attempts := 0; attempts < 64; attempts++ {
		name := trimTo12(generateProceduralBotName())
		if name == "" {
			continue
		}
		normalized := normalizeBotName(name)
		if _, taken := active[normalized]; taken {
			continue
		}
		if isBotNameCoolingDown(name, now) {
			continue
		}
		return name, randomBotLanguage(), identity
	}

	if base := presetAliasBase(identity); base != "" {
		for attempts := 0; attempts < 36; attempts++ {
			suffix := strconv.Itoa(rand.Intn(90) + 10)
			limit := 12 - len(suffix)
			if limit < 1 {
				limit = 1
			}
			stem := base
			if len(stem) > limit {
				stem = stem[:limit]
			}
			candidate := trimTo12(stem + suffix)
			normalized := normalizeBotName(candidate)
			if _, taken := active[normalized]; taken {
				continue
			}
			if isBotNameCoolingDown(candidate, now) {
				continue
			}
			return candidate, randomBotLanguage(), identity
		}
	}

	for attempts := 0; attempts < 48; attempts++ {
		name := trimTo12("Bot" + strconv.Itoa(100+rand.Intn(900)))
		normalized := normalizeBotName(name)
		if _, taken := active[normalized]; taken {
			continue
		}
		if isBotNameCoolingDown(name, now) {
			continue
		}
		return name, randomBotLanguage(), identity
	}

	return trimTo12("Bot" + strconv.Itoa(100+rand.Intn(900))), randomBotLanguage(), identity
}

func randomBotLanguage() string {
	if rand.Float32() < 0.18 {
		return "en"
	}
	return "pt"
}

func generateProceduralBotName() string {
	shortNames := []string{
		"jao", "duda", "biel", "nina", "kadu", "luca", "teca", "lolo", "mika", "guto",
		"naty", "babi", "jojo", "tutu", "zeca", "vini", "ceci", "maya", "lila", "rubi",
	}
	if rand.Float32() < 0.55 {
		base := shortNames[rand.Intn(len(shortNames))]
		if rand.Float32() < 0.35 {
			base += strconv.Itoa(rand.Intn(99))
		}
		return trimTo12(base)
	}

	start := []string{"ja", "lu", "ka", "ra", "vi", "no", "be", "ma", "ze", "ta", "di", "go"}
	mid := []string{"", "r", "n", "l", "v", "z", "d", "x"}
	end := []string{"o", "a", "e", "u", "ao", "in", "el", "is", "us"}
	name := start[rand.Intn(len(start))] + mid[rand.Intn(len(mid))] + end[rand.Intn(len(end))]
	if rand.Float32() < 0.22 {
		name += strconv.Itoa(rand.Intn(10))
	}
	return trimTo12(name)
}

func RememberBotNameForCooldown(player *Player) {
	if player == nil || !player.IsBot {
		return
	}
	rememberBotName(getPlayerName(player), time.Now())
}

func rememberBotName(name string, at time.Time) {
	normalized := normalizeBotName(name)
	if normalized == "" {
		return
	}
	botNameHistoryMu.Lock()
	botNameHistory[normalized] = at
	botNameHistoryMu.Unlock()
}

func isBotNameCoolingDown(name string, now time.Time) bool {
	normalized := normalizeBotName(name)
	if normalized == "" {
		return false
	}
	botNameHistoryMu.Lock()
	lastSeen, ok := botNameHistory[normalized]
	botNameHistoryMu.Unlock()
	if !ok {
		return false
	}
	return now.Sub(lastSeen) < botNameReuseTTL
}

func normalizeBotName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func activeBotNames() map[string]struct{} {
	active := make(map[string]struct{})
	State.RLock()
	for _, p := range State.Players {
		if p == nil || !p.IsBot || p.IsMarkedForRemoval() {
			continue
		}
		normalized := normalizeBotName(getPlayerName(p))
		if normalized != "" {
			active[normalized] = struct{}{}
		}
	}
	State.RUnlock()
	return active
}

func pickUniqueBotName(pool []string, active map[string]struct{}, now time.Time) (string, bool) {
	if len(pool) == 0 {
		return "", false
	}

	for _, idx := range rand.Perm(len(pool)) {
		candidate := trimTo12(strings.TrimSpace(pool[idx]))
		if candidate == "" {
			continue
		}
		normalized := normalizeBotName(candidate)
		if _, taken := active[normalized]; taken {
			continue
		}
		if isBotNameCoolingDown(candidate, now) {
			continue
		}
		return candidate, true
	}

	for attempts := 0; attempts < 36; attempts++ {
		base := strings.TrimSpace(pool[rand.Intn(len(pool))])
		if base == "" {
			continue
		}
		suffix := strconv.Itoa(rand.Intn(100))
		limit := 12 - len(suffix)
		if limit < 1 {
			limit = 1
		}
		if len(base) > limit {
			base = base[:limit]
		}
		candidate := trimTo12(base + suffix)
		normalized := normalizeBotName(candidate)
		if _, taken := active[normalized]; taken {
			continue
		}
		if isBotNameCoolingDown(candidate, now) {
			continue
		}
		return candidate, true
	}

	return "", false
}

func trimTo12(s string) string {
	if len(s) <= 12 {
		return s
	}
	return s[:12]
}

func randomBotColor() []byte {
	if len(NonSkinColors) == 0 {
		return []byte{255, 255, 255}
	}
	color := NonSkinColors[rand.Intn(len(NonSkinColors))]
	c := make([]byte, len(color))
	copy(c, color)
	return c
}

func getPlayerName(player *Player) string {
	if player == nil {
		return ""
	}
	return strings.TrimRight(string(player.Name[:]), "\x00")
}

func getBotByID(playerID ID) *Player {
	State.RLock()
	defer State.RUnlock()
	player, ok := State.Players[playerID]
	if !ok {
		return nil
	}
	return player
}

func registerActiveBotRuntime(playerID ID, rt *botRuntime) {
	if playerID == 0 || rt == nil {
		return
	}
	activeBotRuntimesMu.Lock()
	activeBotRuntimes[playerID] = rt
	activeBotRuntimesMu.Unlock()
}

func unregisterActiveBotRuntime(playerID ID) {
	if playerID == 0 {
		return
	}
	activeBotRuntimesMu.Lock()
	delete(activeBotRuntimes, playerID)
	activeBotRuntimesMu.Unlock()
}

func getActiveBotRuntime(playerID ID) *botRuntime {
	if playerID == 0 {
		return nil
	}
	activeBotRuntimesMu.RLock()
	rt := activeBotRuntimes[playerID]
	activeBotRuntimesMu.RUnlock()
	return rt
}

func flushBotRuntimePersistence(rt *botRuntime) {
	if rt == nil || strings.TrimSpace(rt.identity.ID) == "" {
		return
	}
	saveBotPersistentSocialState(rt)
	saveChatMemoryForBot(rt.identity.ID, rt.goChatMem)
	if rt.localBrain != nil {
		_ = upsertBotPersonalityState(rt.identity.ID, rt.localBrain)
	}
}

func setBotTargetIntent(botID ID, targetID ID) {
	botTargetIntentsMu.Lock()
	if targetID == 0 {
		delete(botTargetIntents, botID)
	} else {
		botTargetIntents[botID] = targetID
	}
	botTargetIntentsMu.Unlock()
}

func clearBotTargetIntent(botID ID) {
	setBotTargetIntent(botID, 0)
}

func ClearBotRuntimeIntent(playerID ID) {
	if rt := getActiveBotRuntime(playerID); rt != nil {
		flushBotRuntimePersistence(rt)
	}
	unregisterActiveChatMemory(playerID)
	unregisterActiveLocalBrain(playerID)
	unregisterActiveBotRuntime(playerID)
	clearBotTargetIntent(playerID)
}

func countBotsTargeting(targetID ID) int {
	if targetID == 0 {
		return 0
	}
	botTargetIntentsMu.Lock()
	defer botTargetIntentsMu.Unlock()
	count := 0
	for _, t := range botTargetIntents {
		if t == targetID {
			count++
		}
	}
	return count
}

func nextBuildDelay(rt *botRuntime, success bool) time.Duration {
	baseMin := 1800 * time.Millisecond
	baseMax := 4200 * time.Millisecond

	if !success {
		baseMin = 2500 * time.Millisecond
		baseMax = 5200 * time.Millisecond
	}

	// High macro bots build a bit faster.
	speedup := time.Duration(rt.macroFocus*900) * time.Millisecond
	if speedup > baseMin/2 {
		speedup = baseMin / 2
	}

	min := baseMin - speedup
	max := baseMax - speedup/2
	switch rt.role {
	case roleEco:
		min -= 180 * time.Millisecond
		max -= 120 * time.Millisecond
	case roleGuardian:
		min += 160 * time.Millisecond
		max += 260 * time.Millisecond
	case roleRaider, roleDuelist:
		min += 80 * time.Millisecond
	}
	if max <= min {
		max = min + 400*time.Millisecond
	}
	return randomDuration(min, max)
}

func nextMoveDelay(rt *botRuntime) time.Duration {
	min := 800*time.Millisecond - time.Duration(rt.aggression*220)*time.Millisecond
	max := 2200*time.Millisecond - time.Duration(rt.aggression*380)*time.Millisecond
	switch rt.role {
	case roleRaider, roleDuelist:
		min -= 110 * time.Millisecond
		max -= 180 * time.Millisecond
	case roleGuardian:
		min += 120 * time.Millisecond
		max += 160 * time.Millisecond
	case roleEco:
		min += 70 * time.Millisecond
		max += 110 * time.Millisecond
	}
	if min < 450*time.Millisecond {
		min = 450 * time.Millisecond
	}
	if max < min+250*time.Millisecond {
		max = min + 250*time.Millisecond
	}
	return randomDuration(min, max)
}

func nextChatDelay(rt *botRuntime) time.Duration {
	// Keep chat sparse so bots don't dominate chat flow.
	baseMin := 75 * time.Second
	baseMax := 180 * time.Second
	reduction := time.Duration(rt.chatter*22) * time.Second

	min := baseMin - reduction
	max := baseMax - reduction/2
	if min < 35*time.Second {
		min = 35 * time.Second
	}
	if max < min+15*time.Second {
		max = min + 15*time.Second
	}
	return randomDuration(min, max)
}

func applyBotAdvancedActions(player *Player, rt *botRuntime) {
	if player == nil || rt == nil {
		return
	}

	underAttack := player.WasBaseDamagedWithin(12 * time.Second)
	if underAttack {
		maybeRepairBase(player)
	}

	if rt.thought.tryCommander || (!player.HasCommander && rand.Float32() < 0.05+rt.aggression*0.08) {
		maybeBuyCommander(player, rt)
	}
	rt.thought.tryCommander = false

	powerNow := readCurrentPower(player)
	upgradeChance := float32(0.24) + rt.macroFocus*0.26
	if powerNow >= 420 {
		upgradeChance += 0.14
	} else if powerNow >= 300 {
		upgradeChance += 0.08
	}
	if underAttack {
		upgradeChance -= 0.04
	}
	if rt.profile == profileEconomy {
		upgradeChance += 0.06
	} else if rt.profile == profileAttack {
		upgradeChance += 0.03
	}
	if upgradeChance < 0.12 {
		upgradeChance = 0.12
	}
	if upgradeChance > 0.78 {
		upgradeChance = 0.78
	}
	if rt.thought.tryUpgrade || rand.Float32() < upgradeChance {
		maybeUpgradeBuilding(player, rt)
	}
	rt.thought.tryUpgrade = false

	if underAttack || rt.thought.useDefend {
		maybeDefendBurst(player, rt)
	}
	rt.thought.useDefend = false
}

func applyBotGroupPreference(player *Player, rt *botRuntime, mode botMoveMode) {
	if player == nil || rt == nil {
		return
	}

	if rt.thought.setGroupUnits != nil {
		player.SetGroupUnits(*rt.thought.setGroupUnits)
		rt.thought.setGroupUnits = nil
		return
	}

	// Natural toggle: pressure/flank generally grouped, defend/regroup more spread.
	switch mode {
	case movePressure, moveFlank:
		player.SetGroupUnits(true)
	default:
		player.SetGroupUnits(rand.Float32() < 0.45)
	}
}

func maybeStartBotDuel(player *Player, rt *botRuntime) {
	// Bot duels (x1) intentionally disabled to keep bots in normal macro gameplay.
	return
}

func findDuelTarget(challenger *Player) *Player {
	if challenger == nil || challenger.Base == nil {
		return nil
	}
	if challenger.WasBaseDamagedWithin(2 * time.Minute) {
		return nil
	}

	challengerPos := IntToFloat(challenger.Base.GetPosition())
	var best *Player
	var bestHuman *Player
	bestDistance := float32(math.MaxFloat32)
	bestHumanDistance := float32(math.MaxFloat32)

	State.RLock()
	candidates := make([]*Player, 0, len(State.Players))
	for _, p := range State.Players {
		candidates = append(candidates, p)
	}
	State.RUnlock()

	for _, target := range candidates {
		if target == nil || target.ID == challenger.ID || target.IsMarkedForRemoval() || target.Base == nil {
			continue
		}
		if !isLateralNeighbor(challenger, target) {
			continue
		}
		if target.WasBaseDamagedWithin(2 * time.Minute) {
			continue
		}

		target.RLock()
		targetInDuel := target.InDuel
		target.RUnlock()
		if targetInDuel {
			continue
		}

		targetPos := IntToFloat(target.Base.GetPosition())
		dist := challengerPos.DistanceTo(targetPos)
		if dist < 900 || dist > 9000 {
			continue
		}
		if !target.IsBot && dist < bestHumanDistance {
			bestHumanDistance = dist
			bestHuman = target
		}
		if dist < bestDistance {
			bestDistance = dist
			best = target
		}
	}

	if bestHuman != nil {
		return bestHuman
	}
	return best
}

func countActiveDuelPairs() int {
	State.RLock()
	defer State.RUnlock()

	pairs := 0
	for _, p := range State.Players {
		if p == nil || p.IsMarkedForRemoval() {
			continue
		}
		p.RLock()
		inDuel := p.InDuel
		opponentID := p.DuelOpponentID
		playerID := p.ID
		p.RUnlock()
		if !inDuel || opponentID == 0 {
			continue
		}
		if playerID < opponentID {
			pairs++
		}
	}
	return pairs
}

func isLateralNeighbor(a *Player, b *Player) bool {
	if a == nil || b == nil || a.Base == nil || b.Base == nil {
		return false
	}
	aPos := a.Base.GetPosition()
	bPos := b.Base.GetPosition()

	dx := float64(bPos.X - aPos.X)
	dy := math.Abs(float64(bPos.Y - aPos.Y))
	const axisTolerance = 250.0
	return dy <= axisTolerance && math.Abs(dx) > axisTolerance
}

func maybeBuyCommander(player *Player, rt *botRuntime) bool {
	if player == nil || rt == nil {
		return false
	}
	if player.HasCommander {
		return false
	}
	if time.Since(rt.lastCommanderAt) < 35*time.Second {
		return false
	}

	if readCurrentPower(player) < uint16(COMMANDER_COST) {
		return false
	}
	if !player.Resources.Power.Decrement(uint16(COMMANDER_COST)) {
		return false
	}

	unit, ok := player.AddCommander()
	if !ok || unit == nil {
		player.Resources.Power.Increment(uint16(COMMANDER_COST))
		return false
	}

	TriggerCommanderSpawnEvent(player.Base.Owner, unit)
	rt.lastCommanderAt = time.Now()
	return true
}

func maybeRepairBase(player *Player) bool {
	if player == nil || player.Base == nil {
		return false
	}

	player.Base.Health.RLock()
	current := player.Base.Health.Current
	max := player.Base.Health.Max
	player.Base.Health.RUnlock()
	if max == 0 {
		return false
	}

	healthRatio := float32(current) / float32(max)
	if healthRatio > 0.48 {
		return false
	}

	const repairCost = uint16(6000)
	if readCurrentPower(player) < repairCost {
		return false
	}
	if !player.Resources.Power.Decrement(repairCost) {
		return false
	}

	player.Base.Repair()
	TriggerBaseHealthUpdateEvent(player.Base)
	return true
}

func maybeDefendBurst(player *Player, rt *botRuntime) {
	if player == nil || rt == nil {
		return
	}
	if time.Since(rt.lastDefendAt) < 9*time.Second {
		return
	}

	_, hasEnemy, enemyAngle, _ := findEnemyForRuntime(player, rt)
	if !hasEnemy {
		enemyAngle = rt.anchorA
	}

	attempts := 1
	if player.WasBaseDamagedWithin(10 * time.Second) {
		attempts = 2
	}

	for i := 0; i < attempts; i++ {
		t := WALL
		if rand.Float32() < 0.55 {
			t = SIMPLE_TURRET
		}
		tryBuildBotBuilding(player, rt, t, enemyAngle)
	}
	rt.lastDefendAt = time.Now()
}

func canSpendForUpgradeBudget(buildingType BuildingType, power uint16, reserve uint16, cost uint16, underAttack bool) bool {
	if power < cost {
		return false
	}
	requiredReserve := int(reserve) * 3 / 4
	if requiredReserve < 60 {
		requiredReserve = 60
	}
	if underAttack && (buildingType == WALL || buildingType == SIMPLE_TURRET || buildingType == SNIPER_TURRET) {
		return int(power)-int(cost) >= requiredReserve/2
	}
	return int(power)-int(cost) >= requiredReserve
}

func scoreBotUpgradeOption(rt *botRuntime, buildingType BuildingType, currentVariant BuildingVariant, candidate BuildingVariant, cost uint16, power uint16, freePop int, underAttack bool, summary botBuildingSummary) float64 {
	currentGen, _ := GetResourceGeneration(buildingType, currentVariant)
	targetGen, _ := GetResourceGeneration(buildingType, candidate)
	genGain := float64(int(targetGen.Power) - int(currentGen.Power))

	currentCap, _ := GetPopulationCapacity(buildingType, currentVariant)
	targetCap, _ := GetPopulationCapacity(buildingType, candidate)
	capacityGain := float64(int(targetCap) - int(currentCap))

	score := 0.35 + genGain*1.7 + capacityGain*0.24
	switch buildingType {
	case GENERATOR:
		score += 1.05
		if power < 240 {
			score += 0.85
		}
	case HOUSE:
		score += 0.75
		if freePop <= 2 {
			score += 0.75
		}
	case BARRACKS:
		score += 0.95
		if summary.barracks < 3 {
			score += 0.55
		}
	case SIMPLE_TURRET:
		score += 0.85
		if underAttack {
			score += 1.35
		}
	case SNIPER_TURRET:
		score += 0.78
		if underAttack {
			score += 1.25
		}
	case WALL:
		score += 0.62
		if underAttack {
			score += 1.40
		}
	case ARMORY:
		score += 1.12
	}
	if currentVariant == BASIC_BUILDING {
		switch buildingType {
		case GENERATOR, HOUSE, BARRACKS:
			score += 0.75
		case SIMPLE_TURRET, SNIPER_TURRET:
			score += 0.55
		}
	}

	if rt != nil {
		switch rt.profile {
		case profileAttack:
			if buildingType == BARRACKS || buildingType == ARMORY {
				score += 0.65
			}
		case profileDefense:
			if buildingType == WALL || buildingType == SIMPLE_TURRET || buildingType == SNIPER_TURRET {
				score += 0.75
			}
		case profileEconomy:
			if buildingType == GENERATOR || buildingType == HOUSE {
				score += 0.68
			}
		}
		template := getProfessionalTemplate(rt)
		for idx, bt := range template.UpgradePriority {
			if bt != buildingType {
				continue
			}
			score += 0.85 - float64(idx)*0.08
			break
		}
	}

	costNorm := 1.0 + float64(cost)/540.0
	score /= costNorm
	if score < 0 {
		return 0
	}
	return score
}

func maybeUpgradeBuilding(player *Player, rt *botRuntime) bool {
	if player == nil || player.Base == nil || rt == nil {
		return false
	}
	if time.Since(rt.lastUpgradeAt) < 16*time.Second {
		return false
	}

	power := readCurrentPower(player)
	freePop := readFreePopulation(player)
	underAttack := player.WasBaseDamagedWithin(12 * time.Second)
	summary := summarizeBotBuildings(player.Base)
	reserve := botPowerReserve(rt, summary, power, freePop, underAttack)

	base := player.Base
	base.RLock()
	buildings := make([]*Building, 0, len(base.Buildings))
	for _, b := range base.Buildings {
		if b != nil && !b.IsMarkedForRemoval() {
			buildings = append(buildings, b)
		}
	}
	base.RUnlock()

	if len(buildings) == 0 {
		return false
	}

	var bestBuilding *Building
	var bestVariant BuildingVariant
	var bestCost uint16
	bestScore := 0.0

	for _, building := range buildings {
		nextVariants := getBuildingNextVariants(building)
		if len(nextVariants) == 0 {
			continue
		}

		for _, candidate := range nextVariants {
			if building.Type == ARMORY && !isArmoryUpgradeAllowed(player, candidate) {
				continue
			}
			cost, ok := GetBuildingCost(building.Type, candidate)
			if !ok {
				continue
			}
			if !canSpendForUpgradeBudget(building.Type, power, reserve, cost, underAttack) {
				continue
			}

			score := scoreBotUpgradeOption(rt, building.Type, building.Variant, candidate, cost, power, freePop, underAttack, summary)
			if score > bestScore {
				bestScore = score
				bestBuilding = building
				bestVariant = candidate
				bestCost = cost
			}
		}
	}

	if bestBuilding == nil {
		return false
	}
	if !player.Resources.Power.Decrement(bestCost) {
		return false
	}

	// Mirror server-side upgrade flow used by player handlers.
	if generating, ok := GetResourceGeneration(bestBuilding.Type, bestBuilding.Variant); ok {
		player.Lock()
		player.Generating.Power -= generating.Power
		player.Unlock()
	}
	if generating, ok := GetResourceGeneration(bestBuilding.Type, bestVariant); ok {
		player.Lock()
		player.Generating.Power += generating.Power
		player.Unlock()
	}

	if capacity, ok := GetPopulationCapacity(bestBuilding.Type, bestBuilding.Variant); ok {
		player.Population.DecrementCapacity(capacity)
	}
	if capacity, ok := GetPopulationCapacity(bestBuilding.Type, bestVariant); ok {
		player.Population.IncrementCapacity(capacity)
	}

	wasUnitSpawningActive := true
	switch bestBuilding.Type {
	case BARRACKS:
		unitSpawning := player.GetUnitSpawningForBarrack(bestBuilding)
		if unitSpawning != nil {
			wasUnitSpawningActive = unitSpawning.Activated
		}
		player.RemoveUnitSpawning(bestBuilding)
	case SIMPLE_TURRET, SNIPER_TURRET:
		base.RemoveBulletSpawning(bestBuilding)
	}

	if !base.UpgradeBuilding(bestBuilding.ID, bestVariant) {
		player.Resources.Power.Increment(bestCost)
		return false
	}

	switch bestBuilding.Type {
	case BARRACKS:
		player.AddUnitSpawning(bestBuilding, wasUnitSpawningActive)
	case SIMPLE_TURRET, SNIPER_TURRET:
		base.AddBulletSpawning(bestBuilding)
	case ARMORY:
		applyArmoryUpgradeEffects(player, bestVariant)
	}

	TriggerBuildingsUpgradedEvent(base, []ID{bestBuilding.ID})
	rt.lastUpgradeAt = time.Now()
	return true
}

func getBuildingNextVariants(building *Building) []BuildingVariant {
	if building == nil {
		return nil
	}
	typeMap, ok := buildingTypes[building.Type]
	if !ok {
		return nil
	}
	current, ok := typeMap[building.Variant]
	if !ok {
		return nil
	}
	if len(current.Next) == 0 {
		return nil
	}

	next := make([]BuildingVariant, 0, len(current.Next))
	for _, candidate := range current.Next {
		if ValidateUpgradePath(building.Type, building.Variant, candidate) {
			next = append(next, candidate)
		}
	}
	return next
}

func applyArmoryUpgradeEffects(player *Player, buildingVariant BuildingVariant) {
	if player == nil {
		return
	}

	if buildingVariant == BuildingVariant(1) {
		player.ApplySoldierArmorUpgrade(true)
	}
	if buildingVariant == BuildingVariant(2) ||
		buildingVariant == BuildingVariant(4) ||
		buildingVariant == BuildingVariant(6) ||
		buildingVariant == BuildingVariant(8) {
		player.ApplyTankBoosterUpgrade(true)
	}
	if buildingVariant == BuildingVariant(3) ||
		buildingVariant == BuildingVariant(4) ||
		buildingVariant == BuildingVariant(7) ||
		buildingVariant == BuildingVariant(8) {
		player.ApplyTankCannonUpgrade(true)
	}
	if buildingVariant == BuildingVariant(5) ||
		buildingVariant == BuildingVariant(6) ||
		buildingVariant == BuildingVariant(7) ||
		buildingVariant == BuildingVariant(8) {
		player.ApplyTankCloakUpgrade(true)
	}
}

func isArmoryUpgradeAllowed(player *Player, buildingVariant BuildingVariant) bool {
	if player == nil {
		return false
	}

	if buildingVariant == BuildingVariant(2) ||
		buildingVariant == BuildingVariant(3) ||
		buildingVariant == BuildingVariant(4) ||
		buildingVariant == BuildingVariant(5) ||
		buildingVariant == BuildingVariant(6) ||
		buildingVariant == BuildingVariant(7) ||
		buildingVariant == BuildingVariant(8) {
		return player.HasBarracksVariant(TANK_FACTORY)
	}
	return true
}

func runBotBuild(player *Player, rt *botRuntime) bool {
	if player == nil || player.Base == nil {
		return false
	}
	if isExternalPlannerEnabled() && !rt.externalThoughtReady {
		return false
	}
	applyThoughtMenuStrategy(rt)
	refreshBotLegacyLayout(rt)

	applyBotAdvancedActions(player, rt)

	summary := summarizeBotBuildings(player.Base)
	power := readCurrentPower(player)
	freePop := readFreePopulation(player)
	underAttack := player.WasBaseDamagedWithin(12 * time.Second)
	if tryRecycleExcessGenerators(player, rt, summary, power, freePop, underAttack) {
		rt.phase++
		rt.cursor += math.Pi / 18
		return true
	}
	baseReady := isBotBaseReadyForPush(player, rt, summary, power)
	llmMode := isExternalPlannerEnabled()
	if baseReady && !rt.baseSaved {
		rt.baseSaved = true
		if strings.TrimSpace(rt.thought.chat) == "" {
			rt.thought.chat = pickBaseReadyChat(rt)
		}
	} else if !baseReady {
		rt.baseSaved = false
	}

	_, hasEnemy, enemyAngle, _ := findEnemyForRuntime(player, rt)
	if !hasEnemy {
		enemyAngle = rt.anchorA
	}
	if tryBuildLegacyLayoutSlot(player, rt, summary, power, freePop, underAttack) {
		rt.phase++
		rt.cursor += math.Pi / 13
		return true
	}
	if hasPendingLegacyLayout(rt) && !underAttack {
		// Keep bots locked on the configured standard base instead of drifting to fallback builders.
		return false
	}

	if llmMode {
		if !baseReady {
			if foundationType, ok := chooseFoundationBuildType(rt, summary, power, freePop, underAttack); ok {
				if tryBuildBotBuilding(player, rt, foundationType, enemyAngle) {
					rt.phase++
					rt.cursor += math.Pi / 12
					return true
				}
			}
		}
		if buildType, ok := chooseAIBuildType(rt, summary, power, freePop, underAttack); ok {
			if tryBuildBotBuilding(player, rt, buildType, enemyAngle) {
				rt.phase++
				rt.cursor += math.Pi / 12
				return true
			}
		}
		if fallbackType, ok := chooseBuildType(rt, summary, power, freePop, underAttack, rt.thought.buildHints); ok {
			if tryBuildBotBuilding(player, rt, fallbackType, enemyAngle) {
				rt.phase++
				rt.cursor += math.Pi / 12
				return true
			}
		}
		return false
	}

	if !baseReady {
		if foundationType, ok := chooseFoundationBuildType(rt, summary, power, freePop, underAttack); ok {
			if tryBuildBotBuilding(player, rt, foundationType, enemyAngle) {
				rt.phase++
				rt.cursor += math.Pi / 12
				return true
			}
		}
	}

	buildType, ok := chooseBuildType(rt, summary, power, freePop, underAttack, rt.thought.buildHints)
	if !ok {
		return false
	}

	if tryBuildBotBuilding(player, rt, buildType, enemyAngle) {
		rt.phase++
		rt.cursor += math.Pi / 11
		return true
	}

	return false
}

func applyThoughtMenuStrategy(rt *botRuntime) {
	if rt == nil {
		return
	}
	menu := strings.ToLower(strings.TrimSpace(rt.thought.menuUsed))
	switch menu {
	case "defend":
		rt.basePlan = basePlanAutogens
		rt.profile = profileDefense
	case "externatk":
		rt.basePlan = basePlanExternAtk
		rt.profile = profileAttack
	case "loadbase":
		query := strings.ToLower(strings.TrimSpace(rt.thought.loadBaseQuery))
		switch {
		case strings.Contains(query, "defend"), strings.Contains(query, "wall"), strings.Contains(query, "fortress"), strings.Contains(query, "autogen"), strings.Contains(query, "eco"):
			rt.basePlan = basePlanAutogens
			rt.profile = profileDefense
		case strings.Contains(query, "rush"), strings.Contains(query, "atk"), strings.Contains(query, "pressure"), strings.Contains(query, "extern"), strings.Contains(query, "offens"):
			rt.basePlan = basePlanExternAtk
			rt.profile = profileAttack
		default:
			rt.basePlan = basePlanPublicHybrid
			rt.profile = profileHybrid
		}
	}
}

func summarizeBotBuildings(base *Base) botBuildingSummary {
	var s botBuildingSummary
	base.RLock()
	defer base.RUnlock()

	for _, b := range base.Buildings {
		if b == nil || b.IsMarkedForRemoval() {
			continue
		}

		s.buildings++
		switch b.Type {
		case WALL:
			s.walls++
		case GENERATOR:
			s.gens++
		case HOUSE:
			s.houses++
		case BARRACKS:
			s.barracks++
		case SIMPLE_TURRET:
			s.turrets++
		case SNIPER_TURRET:
			s.snipers++
		}
	}
	return s
}

func readCurrentPower(player *Player) uint16 {
	player.Resources.Power.RLock()
	defer player.Resources.Power.RUnlock()
	return player.Resources.Power.Current
}

func readFreePopulation(player *Player) int {
	player.Population.RLock()
	defer player.Population.RUnlock()
	return int(player.Population.Capacity) - int(player.Population.Used)
}

func getFoundationTargets(rt *botRuntime) (gens int, houses int, barracks int, defense int, walls int, units int) {
	if rt == nil {
		return 5, 3, 2, 4, 8, 9
	}

	gens, houses, barracks, defense, walls, units = 5, 3, 2, 4, 8, 9
	switch rt.profile {
	case profileAttack:
		gens, houses, barracks, defense, walls, units = 4, 3, 4, 4, 8, 12
	case profileDefense:
		gens, houses, barracks, defense, walls, units = 6, 4, 2, 7, 16, 10
	case profileHybrid:
		gens, houses, barracks, defense, walls, units = 6, 4, 3, 5, 11, 10
	case profileEconomy:
		gens, houses, barracks, defense, walls, units = 9, 6, 2, 5, 11, 10
	}
	switch rt.basePlan {
	case basePlanAutogens:
		gens = maxInt(gens, 8)
		houses = maxInt(houses, 5)
		defense = maxInt(defense, 4)
		walls = maxInt(walls, 10)
		units = maxInt(units, 10)
	case basePlanExternAtk:
		barracks = maxInt(barracks, 4)
		defense = maxInt(defense, 4)
		walls = maxInt(walls, 8)
		units = maxInt(units, 10)
	case basePlanPublicTurtle:
		gens = maxInt(gens, 6)
		houses = maxInt(houses, 4)
		defense = maxInt(defense, 6)
		walls = maxInt(walls, 14)
		units = maxInt(units, 10)
	case basePlanPublicHybrid:
		gens = maxInt(gens, 6)
		houses = maxInt(houses, 4)
		barracks = maxInt(barracks, 3)
		defense = maxInt(defense, 5)
		walls = maxInt(walls, 10)
		units = maxInt(units, 10)
	}
	switch rt.role {
	case roleGuardian:
		defense = maxInt(defense, 6)
		walls = maxInt(walls, 14)
	case roleRaider:
		barracks = maxInt(barracks, 4)
		defense = maxInt(defense, 4)
		units = maxInt(units, 11)
	case roleSiege:
		barracks = maxInt(barracks, 4)
		defense = maxInt(defense, 5)
		units = maxInt(units, 11)
	case roleEco:
		gens = maxInt(gens, 9)
		houses = maxInt(houses, 6)
		walls = maxInt(walls, 11)
	case roleDuelist:
		barracks = maxInt(barracks, 4)
		defense = maxInt(defense, 4)
		units = maxInt(units, 10)
	}

	template := getProfessionalTemplate(rt)
	if template.TargetGens > 0 {
		gens = maxInt(gens, template.TargetGens-2)
	}
	if template.TargetHouses > 0 {
		houses = maxInt(houses, template.TargetHouses-2)
	}
	if template.TargetBarracks > 0 {
		barracks = maxInt(barracks, template.TargetBarracks-1)
	}
	if template.TargetDefense > 0 {
		defense = maxInt(defense, template.TargetDefense-2)
	}
	if template.TargetWalls > 0 {
		walls = maxInt(walls, template.TargetWalls-3)
	}

	if barracks > 4 {
		barracks = 4
	}
	return gens, houses, barracks, defense, walls, units
}

func isBotBaseReadyForPush(player *Player, rt *botRuntime, summary botBuildingSummary, power uint16) bool {
	if player == nil || rt == nil {
		return false
	}
	if player.HasProtection() {
		return false
	}

	targetGens, targetHouses, targetBarracks, targetDefense, targetWalls, targetUnits := getFoundationTargets(rt)
	defenseCount := summary.turrets + summary.snipers
	unitCount := readUnitCount(player)

	minGens := targetGens - 2
	if minGens < 3 {
		minGens = 3
	}
	minHouses := targetHouses - 1
	if minHouses < 2 {
		minHouses = 2
	}
	minBarracks := targetBarracks - 1
	if minBarracks < 1 {
		minBarracks = 1
	}
	minDefense := targetDefense - 2
	if minDefense < 2 {
		minDefense = 2
	}
	minWalls := targetWalls - 3
	if minWalls < 4 {
		minWalls = 4
	}
	minUnits := targetUnits - 2
	if minUnits < 6 {
		minUnits = 6
	}

	if summary.gens < minGens ||
		summary.houses < minHouses ||
		summary.barracks < minBarracks ||
		defenseCount < minDefense ||
		summary.walls < minWalls ||
		unitCount < minUnits {
		// Fast lane for aggressive templates to avoid perma-turtle.
		if (rt.basePlan == basePlanExternAtk || rt.profile == profileAttack || rt.role == roleRaider) &&
			summary.barracks >= 2 &&
			defenseCount >= 2 &&
			summary.walls >= 5 &&
			unitCount >= 7 &&
			power >= 260 {
			return true
		}
		return false
	}
	return power >= 260
}

func chooseFoundationBuildType(rt *botRuntime, s botBuildingSummary, power uint16, freePop int, underAttack bool) (BuildingType, bool) {
	targetGens, targetHouses, targetBarracks, targetDefense, targetWalls, _ := getFoundationTargets(rt)
	defenseCount := s.turrets + s.snipers
	minEcoCore := minInt(targetGens, maxInt(4, targetGens-2))

	if rt != nil {
		switch rt.profile {
		case profileAttack:
			if s.barracks < targetBarracks && power >= 260 {
				return BARRACKS, true
			}
		case profileDefense:
			if s.walls < targetWalls {
				return WALL, true
			}
			if defenseCount < targetDefense {
				if s.snipers < 2 && rand.Float32() < 0.4 {
					return SNIPER_TURRET, true
				}
				return SIMPLE_TURRET, true
			}
		}
	}

	if s.gens < minEcoCore && (s.gens <= s.houses+2 || power < 320) {
		return GENERATOR, true
	}

	if underAttack {
		if s.walls < targetWalls+2 {
			return WALL, true
		}
		if defenseCount < targetDefense+1 {
			if s.snipers < 2 && rand.Float32() < 0.45 {
				return SNIPER_TURRET, true
			}
			return SIMPLE_TURRET, true
		}
	}

	if power < 240 {
		return GENERATOR, true
	}
	if freePop <= 1 {
		return HOUSE, true
	}
	if s.gens < targetGens {
		return GENERATOR, true
	}
	if s.houses < targetHouses {
		return HOUSE, true
	}
	if s.barracks < targetBarracks {
		return BARRACKS, true
	}
	if defenseCount < targetDefense {
		if s.snipers < 2 && rand.Float32() < 0.33 {
			return SNIPER_TURRET, true
		}
		return SIMPLE_TURRET, true
	}
	if s.walls < targetWalls {
		return WALL, true
	}
	return 0, false
}

func canAffordBuilding(buildingType BuildingType, power uint16) bool {
	cost, ok := GetBuildingCost(buildingType, BASIC_BUILDING)
	if !ok {
		return false
	}
	return power >= cost
}

func botPowerReserve(rt *botRuntime, s botBuildingSummary, power uint16, freePop int, underAttack bool) uint16 {
	reserve := 80 + int(float64(power)*0.11)
	if underAttack {
		reserve += 110
	}
	if freePop <= 1 {
		reserve += 65
	}
	if power < 260 {
		reserve += 40
	}
	if s.barracks == 0 {
		reserve -= 70
	}
	if rt != nil {
		switch rt.role {
		case roleEco, roleGuardian:
			reserve += 90
		case roleRaider, roleDuelist:
			reserve -= 35
		}
		if rt.profile == profileAttack && !underAttack {
			reserve -= 20
		}
		if rt.profile == profileDefense {
			reserve += 30
		}
	}
	if reserve < 50 {
		reserve = 50
	}
	maxReserve := int(power) - 40
	if maxReserve < 0 {
		maxReserve = 0
	}
	if reserve > maxReserve {
		reserve = maxReserve
	}
	return uint16(reserve)
}

func canAffordBuildingWithBudget(buildingType BuildingType, power uint16, reserve uint16, underAttack bool, freePop int) bool {
	cost, ok := GetBuildingCost(buildingType, BASIC_BUILDING)
	if !ok || power < cost {
		return false
	}

	critical := (freePop <= 0 && buildingType == HOUSE) ||
		(underAttack && (buildingType == WALL || buildingType == SIMPLE_TURRET || buildingType == SNIPER_TURRET))
	if critical {
		return true
	}
	requiredReserve := int(reserve) * 85 / 100
	if requiredReserve < 50 {
		requiredReserve = 50
	}
	return int(power)-int(cost) >= requiredReserve
}

func botBuildEconomicUrgency(buildingType BuildingType, rt *botRuntime, s botBuildingSummary, power uint16, freePop int, underAttack bool) float64 {
	urgency := 1.0
	defenseCount := s.turrets + s.snipers

	switch buildingType {
	case GENERATOR:
		urgency += 0.55
		if power < 220 {
			urgency += 0.75
		}
		if s.gens <= s.houses {
			urgency += 0.35
		}
		if rt != nil && (rt.profile == profileEconomy || rt.role == roleEco) {
			urgency += 0.30
		}
	case HOUSE:
		urgency += 0.45
		if freePop <= 0 {
			urgency += 1.50
		} else if freePop <= 2 {
			urgency += 0.70
		}
		if s.houses < 3 {
			urgency += 0.30
		}
	case BARRACKS:
		urgency += 0.55
		if s.barracks == 0 {
			urgency += 1.15
		}
		if rt != nil && (rt.profile == profileAttack || rt.role == roleRaider || rt.role == roleSiege) {
			urgency += 0.35
		}
		if underAttack {
			urgency -= 0.15
		}
	case SIMPLE_TURRET:
		urgency += 0.55
		if defenseCount < 2 {
			urgency += 0.60
		}
		if underAttack {
			urgency += 0.90
		}
	case SNIPER_TURRET:
		urgency += 0.35
		if defenseCount < 2 {
			urgency += 0.45
		}
		if underAttack {
			urgency += 0.75
		}
	case WALL:
		urgency += 0.50
		if s.walls < 7 {
			urgency += 0.45
		}
		if underAttack {
			urgency += 1.10
		}
	}

	if rt != nil && rt.basePlan == basePlanExternAtk && buildingType == BARRACKS {
		urgency += 0.35
	}
	if rt != nil && rt.basePlan == basePlanAutogens && buildingType == GENERATOR {
		urgency += 0.35
	}

	if urgency < 0.1 {
		urgency = 0.1
	}
	return urgency
}

func applyProfessionalTemplateCountWeights(weights map[BuildingType]float64, rt *botRuntime, s botBuildingSummary, underAttack bool) {
	template := getProfessionalTemplate(rt)
	if template.TargetGens <= 0 && template.TargetHouses <= 0 && template.TargetBarracks <= 0 && template.TargetWalls <= 0 && template.TargetDefense <= 0 {
		return
	}

	defenseCount := s.turrets + s.snipers

	gensGap := template.TargetGens - s.gens
	housesGap := template.TargetHouses - s.houses
	barracksGap := template.TargetBarracks - s.barracks
	wallsGap := template.TargetWalls - s.walls
	defenseGap := template.TargetDefense - defenseCount

	if gensGap > 0 {
		weights[GENERATOR] += float64(gensGap) * 0.9
	} else if gensGap < -2 {
		weights[GENERATOR] -= 0.35
	}
	if housesGap > 0 {
		weights[HOUSE] += float64(housesGap) * 0.75
	}
	if barracksGap > 0 {
		weights[BARRACKS] += float64(barracksGap) * 0.95
	} else if barracksGap < -1 {
		weights[BARRACKS] -= 0.3
	}
	if wallsGap > 0 {
		weights[WALL] += float64(wallsGap) * 0.55
	}
	if defenseGap > 0 {
		weights[SIMPLE_TURRET] += float64(defenseGap) * 0.82
		weights[SNIPER_TURRET] += float64(defenseGap) * 0.58
	}

	if underAttack {
		weights[WALL] += 1.0
		weights[SIMPLE_TURRET] += 0.9
		weights[SNIPER_TURRET] += 0.7
	}
}

func applyBotMathEconomyWeights(weights map[BuildingType]float64, rt *botRuntime, s botBuildingSummary, power uint16, freePop int, underAttack bool) {
	reserve := botPowerReserve(rt, s, power, freePop, underAttack)

	for bt, w := range weights {
		if w <= 0 {
			continue
		}

		cost, ok := GetBuildingCost(bt, BASIC_BUILDING)
		if !ok {
			weights[bt] = 0
			continue
		}
		if power < cost {
			weights[bt] = 0
			continue
		}

		if !canAffordBuildingWithBudget(bt, power, reserve, underAttack, freePop) {
			weights[bt] = w * 0.28
			continue
		}

		urgency := botBuildEconomicUrgency(bt, rt, s, power, freePop, underAttack)
		costNorm := 1.0 + math.Sqrt(float64(cost))/19.0
		budgetHeadroom := float64(int(power)-int(cost)-int(reserve)) / float64(int(cost)+120)
		budgetHeadroom = clampFloat64(budgetHeadroom, -0.45, 1.4)
		liquidityMul := 0.86 + budgetHeadroom*0.34
		if liquidityMul < 0.35 {
			liquidityMul = 0.35
		}

		adjusted := w * urgency * liquidityMul / costNorm
		if adjusted < 0.03 {
			adjusted = 0.03
		}
		weights[bt] = adjusted
	}
}

func chooseAIBuildType(rt *botRuntime, s botBuildingSummary, power uint16, freePop int, underAttack bool) (BuildingType, bool) {
	if rt == nil {
		return 0, false
	}

	reserve := botPowerReserve(rt, s, power, freePop, underAttack)
	if freePop <= 0 && canAffordBuilding(HOUSE, power) {
		return HOUSE, true
	}
	if power < 180 && canAffordBuildingWithBudget(GENERATOR, power, reserve, underAttack, freePop) {
		return GENERATOR, true
	}

	for i := 0; i < len(rt.thought.buildSequence); i++ {
		bt := rt.thought.buildSequence[i]
		if !canAffordBuildingWithBudget(bt, power, reserve, underAttack, freePop) {
			continue
		}
		rt.thought.buildSequence = append(rt.thought.buildSequence[:i], rt.thought.buildSequence[i+1:]...)
		return bt, true
	}

	bestHint := BuildingType(0)
	bestHintScore := -1.0
	for _, bt := range rt.thought.buildHints {
		if !canAffordBuildingWithBudget(bt, power, reserve, underAttack, freePop) {
			continue
		}
		cost, ok := GetBuildingCost(bt, BASIC_BUILDING)
		if !ok {
			continue
		}
		urgency := botBuildEconomicUrgency(bt, rt, s, power, freePop, underAttack)
		score := urgency / (1.0 + float64(cost)/300.0)
		if score > bestHintScore {
			bestHintScore = score
			bestHint = bt
		}
	}
	if bestHintScore >= 0 {
		return bestHint, true
	}

	// Safety fallback if model output is temporarily empty.
	if underAttack {
		if canAffordBuildingWithBudget(WALL, power, reserve, underAttack, freePop) {
			return WALL, true
		}
		if canAffordBuildingWithBudget(SIMPLE_TURRET, power, reserve, underAttack, freePop) {
			return SIMPLE_TURRET, true
		}
	}
	if s.gens <= s.houses && canAffordBuildingWithBudget(GENERATOR, power, reserve, underAttack, freePop) {
		return GENERATOR, true
	}
	if s.houses < 4 && canAffordBuildingWithBudget(HOUSE, power, reserve, underAttack, freePop) {
		return HOUSE, true
	}
	if s.barracks < 3 && canAffordBuildingWithBudget(BARRACKS, power, reserve, underAttack, freePop) {
		return BARRACKS, true
	}
	if canAffordBuildingWithBudget(SIMPLE_TURRET, power, reserve, underAttack, freePop) {
		return SIMPLE_TURRET, true
	}
	return 0, false
}

func chooseBuildType(rt *botRuntime, s botBuildingSummary, power uint16, freePop int, underAttack bool, hints []BuildingType) (BuildingType, bool) {
	if bt, ok := chooseScriptedOpening(rt, s); ok {
		reserve := botPowerReserve(rt, s, power, freePop, underAttack)
		if canAffordBuildingWithBudget(bt, power, reserve, underAttack, freePop) {
			return bt, true
		}
	}

	weights := map[BuildingType]float64{
		GENERATOR:     1.2,
		HOUSE:         1.0,
		BARRACKS:      1.0,
		SIMPLE_TURRET: 0.9,
		SNIPER_TURRET: 0.5,
		WALL:          0.8,
	}

	// Style influence.
	switch rt.buildStyle {
	case 0: // economy
		weights[GENERATOR] += 2.1
		weights[HOUSE] += 1.8
		weights[BARRACKS] += 0.4
		weights[WALL] -= 0.3
	case 2: // aggressive
		weights[BARRACKS] += 2.4
		weights[SIMPLE_TURRET] += 0.8
		weights[SNIPER_TURRET] += 0.8
		weights[GENERATOR] += 0.2
	default: // balanced
		weights[GENERATOR] += 1.0
		weights[HOUSE] += 1.0
		weights[BARRACKS] += 1.2
		weights[SIMPLE_TURRET] += 0.7
	}

	// Role influence creates distinct long-term base identities.
	switch rt.role {
	case roleGuardian:
		weights[WALL] += 1.9
		weights[SIMPLE_TURRET] += 1.1
		weights[SNIPER_TURRET] += 0.5
		weights[BARRACKS] -= 0.2
	case roleRaider:
		weights[BARRACKS] += 2.0
		weights[SIMPLE_TURRET] += 0.7
		weights[GENERATOR] += 0.2
		weights[WALL] -= 0.2
	case roleSiege:
		weights[BARRACKS] += 1.3
		weights[SNIPER_TURRET] += 1.1
		weights[SIMPLE_TURRET] += 0.5
	case roleEco:
		weights[GENERATOR] += 2.4
		weights[HOUSE] += 2.2
		weights[WALL] += 0.6
		weights[BARRACKS] -= 0.1
	case roleDuelist:
		weights[BARRACKS] += 1.7
		weights[HOUSE] += 0.4
		weights[SIMPLE_TURRET] += 0.6
	}

	switch rt.profile {
	case profileAttack:
		weights[BARRACKS] += 2.2
		weights[SIMPLE_TURRET] += 0.9
		weights[SNIPER_TURRET] += 0.6
		weights[WALL] -= 0.15
		weights[GENERATOR] += 0.25
	case profileDefense:
		weights[WALL] += 2.4
		weights[SIMPLE_TURRET] += 1.6
		weights[SNIPER_TURRET] += 1.0
		weights[HOUSE] += 0.6
		weights[BARRACKS] -= 0.2
	case profileHybrid:
		weights[BARRACKS] += 1.0
		weights[SIMPLE_TURRET] += 0.8
		weights[WALL] += 0.7
		weights[GENERATOR] += 0.6
	case profileEconomy:
		weights[GENERATOR] += 2.8
		weights[HOUSE] += 1.9
		weights[WALL] += 0.9
		weights[BARRACKS] -= 0.25
	}

	// Keep long-term identity aligned with player-like base plans.
	switch rt.basePlan {
	case basePlanAutogens:
		weights[GENERATOR] += 1.9
		weights[HOUSE] += 1.5
		weights[WALL] += 0.6
		weights[BARRACKS] -= 0.2
	case basePlanExternAtk:
		weights[BARRACKS] += 2.1
		weights[SIMPLE_TURRET] += 1.0
		weights[SNIPER_TURRET] += 0.6
		weights[WALL] += 0.5
		weights[GENERATOR] -= 0.15
	case basePlanPublicTurtle:
		weights[WALL] += 2.0
		weights[SIMPLE_TURRET] += 1.4
		weights[SNIPER_TURRET] += 0.8
	case basePlanPublicHybrid:
		weights[BARRACKS] += 0.9
		weights[WALL] += 0.8
		weights[SIMPLE_TURRET] += 0.7
	}

	if underAttack {
		weights[WALL] += 2.2
		weights[SIMPLE_TURRET] += 1.6
		weights[SNIPER_TURRET] += 1.2
	}

	// Deficits.
	if s.gens < 2 {
		weights[GENERATOR] += 4.0
	}
	if s.houses < 2 {
		weights[HOUSE] += 2.4
	}
	if s.barracks == 0 {
		weights[BARRACKS] += 5.0
	}
	if s.turrets+s.snipers == 0 && s.buildings >= 4 {
		weights[SIMPLE_TURRET] += 2.2
	}
	if s.walls < 6 && s.buildings >= 5 {
		weights[WALL] += 1.5
	}

	targetGens, targetHouses, targetBarracks, targetDefense, _, _ := getFoundationTargets(rt)
	defenseCount := s.turrets + s.snipers
	if s.gens < targetGens {
		gap := targetGens - s.gens
		weights[GENERATOR] += 1.6 + float64(gap)*0.55
		if s.gens <= s.houses+1 {
			weights[GENERATOR] += 1.1
		}
	}
	if s.gens > targetGens+2 {
		excess := s.gens - (targetGens + 2)
		weights[GENERATOR] -= float64(excess) * 1.45
		if s.houses < targetHouses {
			weights[HOUSE] += float64(excess) * 0.8
		}
		if s.barracks < targetBarracks {
			weights[BARRACKS] += float64(excess) * 1.25
		}
		if defenseCount < targetDefense {
			weights[SIMPLE_TURRET] += float64(excess) * 1.0
			weights[SNIPER_TURRET] += float64(excess) * 0.65
			weights[WALL] += float64(excess) * 0.45
		}
	}

	// Economy emergency.
	if power < 180 {
		weights[GENERATOR] += 3.0
		weights[HOUSE] -= 0.6
		weights[SNIPER_TURRET] -= 0.5
	}
	if freePop <= 1 {
		weights[HOUSE] += 2.2
	}

	// Soft caps for natural diversity.
	if s.barracks >= 4 {
		weights[BARRACKS] = 0.1
	}
	if s.walls >= 16 {
		weights[WALL] = 0.15
	}
	if s.gens >= 12 {
		weights[GENERATOR] = 0.15
	}

	for _, hint := range hints {
		if _, exists := weights[hint]; exists {
			weights[hint] += 3.2
		}
	}

	applyProfessionalTemplateCountWeights(weights, rt, s, underAttack)
	applyBotMathEconomyWeights(weights, rt, s, power, freePop, underAttack)

	return weightedPickBuilding(weights)
}

func tryRecycleExcessGenerators(player *Player, rt *botRuntime, s botBuildingSummary, power uint16, freePop int, underAttack bool) bool {
	if player == nil || player.Base == nil || rt == nil || underAttack {
		return false
	}
	now := time.Now()
	if now.Before(rt.nextRecycleAt) {
		return false
	}

	targetGens, targetHouses, targetBarracks, targetDefense, _, _ := getFoundationTargets(rt)
	defenseCount := s.turrets + s.snipers

	maxDesiredGens := targetGens + 2
	if rt.basePlan == basePlanAutogens || rt.profile == profileEconomy || rt.role == roleEco {
		maxDesiredGens = targetGens + 3
	}
	if s.gens <= maxDesiredGens {
		return false
	}
	if power < 360 {
		return false
	}

	infraLagging := s.houses < targetHouses || s.barracks < targetBarracks || defenseCount < targetDefense || freePop <= 1
	if !infraLagging && s.gens <= maxDesiredGens+1 {
		return false
	}

	candidate := pickGeneratorRecycleCandidate(player.Base)
	if candidate == nil {
		return false
	}

	if ok := player.Base.RemoveBuilding(candidate.ID); !ok {
		rt.nextRecycleAt = now.Add(randomDuration(4*time.Second, 7*time.Second))
		return false
	}
	TriggerBuildingRemovedEvent(player.Base, candidate)
	rt.nextRecycleAt = now.Add(randomDuration(12*time.Second, 20*time.Second))
	return true
}

func pickGeneratorRecycleCandidate(base *Base) *Building {
	if base == nil {
		return nil
	}

	var oldestBasic *Building
	var oldestAny *Building
	now := time.Now()

	base.RLock()
	for _, b := range base.Buildings {
		if b == nil || b.IsMarkedForRemoval() || b.Type != GENERATOR {
			continue
		}
		// Avoid removing freshly placed generators to reduce oscillation.
		if now.Sub(b.PlacedAt) < 30*time.Second {
			continue
		}
		if oldestAny == nil || b.PlacedAt.Before(oldestAny.PlacedAt) {
			oldestAny = b
		}
		if b.Variant == BASIC_BUILDING && (oldestBasic == nil || b.PlacedAt.Before(oldestBasic.PlacedAt)) {
			oldestBasic = b
		}
	}
	base.RUnlock()

	if oldestBasic != nil {
		return oldestBasic
	}
	return oldestAny
}

func getProfessionalTemplate(rt *botRuntime) botProfessionalTemplate {
	if rt == nil {
		return botProfessionalTemplate{}
	}

	switch rt.basePlan {
	case basePlanAutogens:
		return botProfessionalTemplate{
			Name: "Autogen Fortress",
			OpeningVariants: [][]BuildingType{
				{
					GENERATOR, HOUSE, GENERATOR, HOUSE, WALL, GENERATOR, HOUSE, SIMPLE_TURRET,
					GENERATOR, HOUSE, BARRACKS, WALL, SIMPLE_TURRET, GENERATOR, HOUSE, SNIPER_TURRET,
					WALL, BARRACKS, GENERATOR, HOUSE, SIMPLE_TURRET, WALL,
				},
				{
					GENERATOR, HOUSE, WALL, GENERATOR, HOUSE, SIMPLE_TURRET, GENERATOR, HOUSE,
					WALL, SNIPER_TURRET, GENERATOR, BARRACKS, HOUSE, WALL, SIMPLE_TURRET, GENERATOR,
					HOUSE, BARRACKS, WALL, SNIPER_TURRET, GENERATOR, HOUSE,
				},
				{
					GENERATOR, HOUSE, GENERATOR, HOUSE, WALL, SIMPLE_TURRET, GENERATOR, HOUSE,
					WALL, SNIPER_TURRET, GENERATOR, HOUSE, WALL, SIMPLE_TURRET, BARRACKS, GENERATOR,
					HOUSE, WALL, SNIPER_TURRET, BARRACKS, GENERATOR, HOUSE, WALL, SIMPLE_TURRET,
				},
			},
			MidCycle:        []BuildingType{GENERATOR, HOUSE, WALL, SIMPLE_TURRET, BARRACKS, SNIPER_TURRET},
			UpgradePriority: []BuildingType{GENERATOR, HOUSE, BARRACKS, SIMPLE_TURRET, SNIPER_TURRET, WALL},
			TargetGens:      11,
			TargetHouses:    8,
			TargetBarracks:  3,
			TargetWalls:     15,
			TargetDefense:   8,
		}
	case basePlanExternAtk:
		return botProfessionalTemplate{
			Name: "Extern Spearhead",
			OpeningVariants: [][]BuildingType{
				{
					BARRACKS, GENERATOR, HOUSE, BARRACKS, SIMPLE_TURRET, WALL, BARRACKS, HOUSE,
					SIMPLE_TURRET, BARRACKS, GENERATOR, WALL, SNIPER_TURRET, BARRACKS, HOUSE, SIMPLE_TURRET,
					WALL, BARRACKS, GENERATOR, SNIPER_TURRET, SIMPLE_TURRET,
				},
				{
					GENERATOR, BARRACKS, HOUSE, BARRACKS, SIMPLE_TURRET, BARRACKS, WALL, HOUSE,
					SIMPLE_TURRET, GENERATOR, BARRACKS, WALL, SNIPER_TURRET, BARRACKS, HOUSE, SIMPLE_TURRET,
					WALL, BARRACKS, GENERATOR, SNIPER_TURRET, SIMPLE_TURRET,
				},
				{
					BARRACKS, BARRACKS, HOUSE, GENERATOR, SIMPLE_TURRET, WALL, BARRACKS, HOUSE,
					SIMPLE_TURRET, BARRACKS, WALL, SNIPER_TURRET, BARRACKS, HOUSE, SIMPLE_TURRET, GENERATOR,
					WALL, BARRACKS, SNIPER_TURRET, SIMPLE_TURRET, HOUSE, GENERATOR, WALL,
				},
			},
			MidCycle:        []BuildingType{BARRACKS, SIMPLE_TURRET, WALL, BARRACKS, SNIPER_TURRET, HOUSE, GENERATOR},
			UpgradePriority: []BuildingType{BARRACKS, SIMPLE_TURRET, SNIPER_TURRET, GENERATOR, HOUSE, WALL, ARMORY},
			TargetGens:      7,
			TargetHouses:    6,
			TargetBarracks:  4,
			TargetWalls:     11,
			TargetDefense:   7,
		}
	case basePlanPublicTurtle:
		return botProfessionalTemplate{
			Name: "Turtle Citadel",
			OpeningVariants: [][]BuildingType{
				{
					GENERATOR, HOUSE, WALL, WALL, SIMPLE_TURRET, GENERATOR, HOUSE, SNIPER_TURRET,
					WALL, SIMPLE_TURRET, WALL, BARRACKS, HOUSE, GENERATOR, WALL, SNIPER_TURRET,
					BARRACKS, WALL, SIMPLE_TURRET, HOUSE, WALL, GENERATOR,
				},
				{
					GENERATOR, HOUSE, WALL, SIMPLE_TURRET, WALL, GENERATOR, HOUSE, SNIPER_TURRET,
					WALL, WALL, SIMPLE_TURRET, BARRACKS, GENERATOR, HOUSE, WALL, SNIPER_TURRET,
					BARRACKS, WALL, SIMPLE_TURRET, HOUSE, WALL, GENERATOR,
				},
				{
					GENERATOR, HOUSE, WALL, WALL, SIMPLE_TURRET, WALL, GENERATOR, HOUSE,
					SNIPER_TURRET, WALL, SIMPLE_TURRET, WALL, BARRACKS, GENERATOR, HOUSE, WALL,
					SNIPER_TURRET, WALL, SIMPLE_TURRET, BARRACKS, WALL, GENERATOR, HOUSE, WALL, SIMPLE_TURRET,
				},
			},
			MidCycle:        []BuildingType{WALL, SIMPLE_TURRET, WALL, SNIPER_TURRET, GENERATOR, HOUSE, BARRACKS},
			UpgradePriority: []BuildingType{WALL, SIMPLE_TURRET, SNIPER_TURRET, GENERATOR, HOUSE, BARRACKS},
			TargetGens:      10,
			TargetHouses:    6,
			TargetBarracks:  3,
			TargetWalls:     20,
			TargetDefense:   10,
		}
	default:
		return botProfessionalTemplate{
			Name: "Hybrid Control",
			OpeningVariants: [][]BuildingType{
				{
					GENERATOR, HOUSE, BARRACKS, SIMPLE_TURRET, WALL, GENERATOR, HOUSE, BARRACKS,
					SNIPER_TURRET, WALL, SIMPLE_TURRET, GENERATOR, HOUSE, BARRACKS, WALL, SIMPLE_TURRET,
					GENERATOR, HOUSE, SNIPER_TURRET, BARRACKS, WALL,
				},
				{
					GENERATOR, BARRACKS, HOUSE, SIMPLE_TURRET, WALL, GENERATOR, HOUSE, BARRACKS,
					SIMPLE_TURRET, WALL, SNIPER_TURRET, GENERATOR, HOUSE, BARRACKS, WALL, SIMPLE_TURRET,
					GENERATOR, HOUSE, SNIPER_TURRET, BARRACKS, WALL,
				},
				{
					GENERATOR, HOUSE, BARRACKS, SIMPLE_TURRET, WALL, GENERATOR, HOUSE, BARRACKS,
					SIMPLE_TURRET, SNIPER_TURRET, WALL, BARRACKS, GENERATOR, HOUSE, WALL, SIMPLE_TURRET,
					BARRACKS, GENERATOR, HOUSE, SNIPER_TURRET, WALL, SIMPLE_TURRET, BARRACKS,
				},
			},
			MidCycle:        []BuildingType{BARRACKS, WALL, SIMPLE_TURRET, GENERATOR, HOUSE, SNIPER_TURRET},
			UpgradePriority: []BuildingType{BARRACKS, GENERATOR, HOUSE, SIMPLE_TURRET, SNIPER_TURRET, WALL},
			TargetGens:      9,
			TargetHouses:    7,
			TargetBarracks:  4,
			TargetWalls:     13,
			TargetDefense:   8,
		}
	}
}

func stableBotBuildSignature(rt *botRuntime) uint32 {
	if rt == nil {
		return 0
	}

	hash := uint32(2166136261)
	mixByte := func(v byte) {
		hash ^= uint32(v)
		hash *= 16777619
	}
	mixUint32 := func(v uint32) {
		mixByte(byte(v))
		mixByte(byte(v >> 8))
		mixByte(byte(v >> 16))
		mixByte(byte(v >> 24))
	}
	mixString := func(v string) {
		for _, r := range v {
			mixByte(byte(r))
		}
	}

	mixUint32(uint32(rt.playerID))
	mixByte(rt.layoutDNA)
	mixByte(byte(rt.basePlan))
	mixByte(byte(rt.profile))
	mixByte(byte(rt.role))
	mixByte(byte(rt.persona))
	mixByte(byte(rt.archetype))
	mixString(strings.ToLower(strings.TrimSpace(rt.identity.ID)))

	return hash
}

func buildScriptedOpeningSequence(rt *botRuntime) []BuildingType {
	template := getProfessionalTemplate(rt)
	if len(template.OpeningVariants) == 0 {
		return nil
	}

	idx := 0
	if rt != nil && len(template.OpeningVariants) > 1 {
		idx = int(stableBotBuildSignature(rt) % uint32(len(template.OpeningVariants)))
	}
	if idx < 0 {
		idx = -idx
	}
	return template.OpeningVariants[idx]
}

func applyOpeningPersonaTail(rt *botRuntime, sequence []BuildingType) []BuildingType {
	if rt == nil || len(sequence) == 0 {
		return sequence
	}
	switch rt.persona {
	case personaArchitect:
		sequence = append(sequence, WALL, SIMPLE_TURRET, GENERATOR, HOUSE)
	case personaPredator:
		sequence = append(sequence, BARRACKS, SIMPLE_TURRET, BARRACKS, WALL)
	case personaSentinel:
		sequence = append(sequence, WALL, SNIPER_TURRET, WALL, SIMPLE_TURRET)
	case personaShotcaller:
		sequence = append(sequence, BARRACKS, SIMPLE_TURRET, WALL, GENERATOR)
	case personaWildcard:
		if rt.layoutDNA%2 == 0 {
			sequence = append(sequence, SIMPLE_TURRET, HOUSE, WALL, BARRACKS)
		} else {
			sequence = append(sequence, BARRACKS, WALL, GENERATOR, SNIPER_TURRET)
		}
	}
	return sequence
}

func chooseScriptedOpeningExtension(rt *botRuntime, s botBuildingSummary, phase int) (BuildingType, bool) {
	if rt == nil || phase < 0 {
		return 0, false
	}

	template := getProfessionalTemplate(rt)
	cycle := template.MidCycle
	if len(cycle) == 0 {
		return 0, false
	}

	offset := 0
	if len(cycle) > 1 {
		offset = int(stableBotBuildSignature(rt) % uint32(len(cycle)))
	}
	bt := cycle[(phase+offset)%len(cycle)]
	if bt == BARRACKS && s.barracks >= 4 {
		if rt.profile == profileAttack {
			bt = SIMPLE_TURRET
		} else {
			bt = GENERATOR
		}
	}
	if bt == WALL && s.walls >= 22 {
		bt = SIMPLE_TURRET
	}
	if bt == GENERATOR && s.gens >= 14 {
		bt = HOUSE
	}
	if bt == HOUSE && s.houses >= 10 {
		bt = SIMPLE_TURRET
	}
	if bt == SNIPER_TURRET && s.snipers >= 4 {
		bt = SIMPLE_TURRET
	}
	return bt, true
}

func chooseScriptedOpening(rt *botRuntime, s botBuildingSummary) (BuildingType, bool) {
	if rt == nil {
		return 0, false
	}

	sequence := buildScriptedOpeningSequence(rt)
	sequence = applyOpeningPersonaTail(rt, sequence)
	if len(sequence) == 0 {
		return 0, false
	}

	if rt.phase < len(sequence) {
		bt := sequence[rt.phase]
		if bt == BARRACKS && s.barracks >= 4 {
			return GENERATOR, true
		}
		if bt == GENERATOR && s.gens >= 14 {
			return HOUSE, true
		}
		if bt == HOUSE && s.houses >= 10 {
			return SIMPLE_TURRET, true
		}
		if bt == WALL && s.walls >= 22 {
			return SIMPLE_TURRET, true
		}
		return bt, true
	}

	extensionPhase := rt.phase - len(sequence)
	if extensionPhase < 12 {
		return chooseScriptedOpeningExtension(rt, s, extensionPhase)
	}
	return 0, false
}

func weightedPickBuilding(weights map[BuildingType]float64) (BuildingType, bool) {
	total := 0.0
	for _, w := range weights {
		if w > 0 {
			total += w
		}
	}
	if total <= 0 {
		return 0, false
	}

	r := rand.Float64() * total
	acc := 0.0
	for t, w := range weights {
		if w <= 0 {
			continue
		}
		acc += w
		if r <= acc {
			return t, true
		}
	}
	return GENERATOR, true
}

func tryBuildBotBuilding(player *Player, rt *botRuntime, buildingType BuildingType, enemyAngle float64) bool {
	cost, ok := GetBuildingCost(buildingType, BASIC_BUILDING)
	if !ok {
		return false
	}

	if readCurrentPower(player) < cost {
		return false
	}

	base := player.Base
	if base == nil {
		return false
	}

	basePos := IntToFloat(base.GetPosition())
	angles := preferredBuildAngles(rt, buildingType, enemyAngle)
	minRadius, maxRadius := botPlacementRadius(rt, buildingType)
	sizePadding := float32(GetBuildingSize(buildingType) + 24)
	angleJitter := botAngleJitter(rt, buildingType)

	for _, centerAngle := range angles {
		for attempt := 0; attempt < 6; attempt++ {
			angle := centerAngle
			if angleJitter > 0 {
				offsetStep := ((rt.phase + attempt) % 3) - 1
				angle += float64(offsetStep) * angleJitter
			}
			radius := pickBotPlacementRadius(rt, buildingType, minRadius, maxRadius, attempt)

			pos := PositionFloat{
				X: basePos.X + radius*float32(math.Cos(angle)),
				Y: basePos.Y + radius*float32(math.Sin(angle)),
			}
			pos = ClampPositionFloatToMap(pos, sizePadding)

			rotationStep := uint8(0)
			if buildingType == GENERATOR {
				rotationStep = uint8((rt.phase + attempt + int(rt.layoutDNA)) % 6)
			} else if buildingType == HOUSE {
				rotationStep = uint8((rt.phase + 2*attempt + int(rt.layoutDNA)) % 5)
			}

			if !base.CheckBuildingCollision(buildingType, pos, rotationStep) {
				continue
			}

			if placeBotBuildingAtPosition(player, buildingType, pos, rotationStep, cost) {
				return true
			}
		}
	}

	return false
}

func tryBuildLegacyLayoutSlot(player *Player, rt *botRuntime, summary botBuildingSummary, power uint16, freePop int, underAttack bool) bool {
	if player == nil || player.Base == nil || rt == nil {
		return false
	}
	if len(rt.legacyLayoutSlots) == 0 || rt.legacyLayoutCursor >= len(rt.legacyLayoutSlots) {
		return false
	}
	if player.WasBaseDamagedWithin(8*time.Second) && underAttack {
		return false
	}

	const maxScanPerTick = 8
	scanned := 0
	start := rt.legacyLayoutCursor
	end := start + maxScanPerTick
	if end > len(rt.legacyLayoutSlots) {
		end = len(rt.legacyLayoutSlots)
	}

	for idx := start; idx < end; idx++ {
		slot := rt.legacyLayoutSlots[idx]
		scanned++

		if !isLegacySlotTypeStillUseful(slot.BuildingType, summary, freePop) {
			if idx == rt.legacyLayoutCursor {
				rt.legacyLayoutCursor++
			}
			continue
		}
		cost, ok := GetBuildingCost(slot.BuildingType, BASIC_BUILDING)
		if !ok {
			if idx == rt.legacyLayoutCursor {
				rt.legacyLayoutCursor++
			}
			continue
		}
		if power < cost {
			// Don't let expensive first slots (e.g. early armory) block the whole scripted base.
			if idx == rt.legacyLayoutCursor && (slot.BuildingType == ARMORY || slot.BuildingType == BARRACKS) {
				rt.legacyLayoutCursor++
				continue
			}
			return false
		}
		if !tryBuildBotLegacySocket(player, rt, slot, cost) {
			if idx == rt.legacyLayoutCursor {
				rt.legacyLayoutCursor++
			}
			continue
		}
		rt.legacyLayoutCursor = idx + 1
		return true
	}
	_ = scanned
	return false
}

func hasPendingLegacyLayout(rt *botRuntime) bool {
	if rt == nil {
		return false
	}
	return rt.legacyLayoutName != "" && rt.legacyLayoutCursor < len(rt.legacyLayoutSlots)
}

func isLegacySlotTypeStillUseful(buildingType BuildingType, summary botBuildingSummary, freePop int) bool {
	switch buildingType {
	case BARRACKS:
		return summary.barracks < 4
	case GENERATOR:
		return summary.gens < 15
	case HOUSE:
		return freePop <= 12 || summary.houses < 11
	case WALL:
		return summary.walls < 30
	case SIMPLE_TURRET:
		return summary.turrets < 10
	case SNIPER_TURRET:
		return summary.snipers < 8
	default:
		return true
	}
}

func tryBuildBotLegacySocket(player *Player, rt *botRuntime, slot botLegacySocketSlot, cost uint16) bool {
	if player == nil || player.Base == nil {
		return false
	}
	basePos := IntToFloat(player.Base.GetPosition())
	pos := PositionFloat{
		X: basePos.X + slot.Radius*float32(math.Cos(slot.Angle)),
		Y: basePos.Y + slot.Radius*float32(math.Sin(slot.Angle)),
	}
	sizePadding := float32(GetBuildingSize(slot.BuildingType) + 24)
	pos = ClampPositionFloatToMap(pos, sizePadding)

	rotationStep := uint8(0)
	if slot.BuildingType == GENERATOR {
		rotationStep = uint8((rt.phase + int(rt.layoutDNA)) % 6)
	} else if slot.BuildingType == HOUSE {
		rotationStep = uint8((rt.phase + int(rt.layoutDNA)) % 5)
	}

	if !player.Base.CheckBuildingCollision(slot.BuildingType, pos, rotationStep) {
		return false
	}
	return placeBotBuildingAtPosition(player, slot.BuildingType, pos, rotationStep, cost)
}

func placeBotBuildingAtPosition(player *Player, buildingType BuildingType, pos PositionFloat, rotationStep uint8, cost uint16) bool {
	if player == nil || player.Base == nil {
		return false
	}
	if !player.Resources.Power.Decrement(cost) {
		return false
	}

	building, placed := player.Base.AddBuilding(buildingType, pos, rotationStep)
	if !placed || building == nil {
		player.Resources.Power.Increment(cost)
		return false
	}

	if generating, ok := GetResourceGeneration(buildingType, BASIC_BUILDING); ok {
		player.Lock()
		player.Generating.Power += generating.Power
		player.Unlock()
	}

	if capacity, ok := GetPopulationCapacity(buildingType, BASIC_BUILDING); ok {
		player.Population.IncrementCapacity(capacity)
	}

	player.SetLastActivity()
	TriggerBuildingPlacedEvent(player.Base, building)
	return true
}

func botAngleJitter(rt *botRuntime, buildingType BuildingType) float64 {
	if rt == nil {
		return 0.06
	}
	jitter := 0.05
	switch rt.basePlan {
	case basePlanPublicTurtle:
		jitter = 0.028
	case basePlanExternAtk:
		jitter = 0.042
	case basePlanPublicHybrid:
		jitter = 0.038
	case basePlanAutogens:
		jitter = 0.032
	}
	switch buildingType {
	case WALL:
		jitter *= 0.55
	case SIMPLE_TURRET, SNIPER_TURRET:
		jitter *= 0.8
	case BARRACKS:
		jitter *= 1.1
	case GENERATOR, HOUSE:
		jitter *= 0.35
	}
	if rt.profile == profileDefense {
		jitter *= 0.72
	}
	return jitter
}

func pickBotPlacementRadius(rt *botRuntime, buildingType BuildingType, minRadius float32, maxRadius float32, attempt int) float32 {
	if rt == nil {
		if maxRadius <= minRadius {
			return minRadius
		}
		return minRadius + (maxRadius-minRadius)*0.5
	}
	if maxRadius <= minRadius {
		return minRadius
	}
	span := maxRadius - minRadius
	baseT := float32(0.5)
	switch rt.basePlan {
	case basePlanExternAtk:
		switch buildingType {
		case BARRACKS, WALL:
			baseT = 0.86
		case SIMPLE_TURRET, SNIPER_TURRET:
			baseT = 0.72
		case GENERATOR, HOUSE:
			baseT = 0.30
		}
	case basePlanPublicTurtle:
		switch buildingType {
		case WALL:
			baseT = 0.92
		case SIMPLE_TURRET, SNIPER_TURRET:
			baseT = 0.70
		case BARRACKS:
			baseT = 0.58
		case GENERATOR, HOUSE:
			baseT = 0.26
		}
	case basePlanPublicHybrid:
		switch buildingType {
		case WALL:
			baseT = 0.84
		case SIMPLE_TURRET, SNIPER_TURRET:
			baseT = 0.66
		case BARRACKS:
			baseT = 0.74
		case GENERATOR, HOUSE:
			baseT = 0.34
		}
	case basePlanAutogens:
		switch buildingType {
		case GENERATOR, HOUSE:
			baseT = 0.30
		case WALL:
			baseT = 0.86
		case SIMPLE_TURRET, SNIPER_TURRET:
			baseT = 0.62
		case BARRACKS:
			baseT = 0.70
		}
	}
	waveScale := float32(0.07)
	switch buildingType {
	case GENERATOR, HOUSE:
		waveScale = 0.03
	case WALL, SIMPLE_TURRET, SNIPER_TURRET:
		waveScale = 0.05
	}
	wave := (float32((rt.phase+attempt)%4) - 1.5) * waveScale
	t := clampFloat32(baseT+wave, 0.06, 0.95)
	return minRadius + span*t
}

func preferredBuildAngles(rt *botRuntime, buildingType BuildingType, enemyAngle float64) []float64 {
	angles := make([]float64, 0, 18)
	push := func(base []float64) {
		for _, a := range base {
			angles = append(angles, normalizeAngle(a))
		}
	}
	ring := func(start float64, count int) []float64 {
		out := make([]float64, 0, count)
		if count <= 0 {
			return out
		}
		step := 2 * math.Pi / float64(count)
		for i := 0; i < count; i++ {
			out = append(out, start+float64(i)*step)
		}
		return out
	}

	cardinal := []float64{0, math.Pi / 2, math.Pi, -math.Pi / 2}
	diagonal := []float64{math.Pi / 4, 3 * math.Pi / 4, -3 * math.Pi / 4, -math.Pi / 4}
	fullRing := ring(rt.anchorA, 12)
	tightRing := ring(rt.anchorA+math.Pi/12, 16)
	frontArc := []float64{enemyAngle - 0.62, enemyAngle - 0.32, enemyAngle, enemyAngle + 0.32, enemyAngle + 0.62}
	rearArc := []float64{enemyAngle + math.Pi - 0.55, enemyAngle + math.Pi - 0.22, enemyAngle + math.Pi, enemyAngle + math.Pi + 0.22, enemyAngle + math.Pi + 0.55}

	// Base-playbook priorities to simulate common public builds.
	switch rt.basePlan {
	case basePlanAutogens:
		switch buildingType {
		case GENERATOR, HOUSE:
			push([]float64{rt.anchorA, rt.anchorA + math.Pi/2, rt.anchorA + math.Pi, rt.anchorA + 3*math.Pi/2})
			push(diagonal)
		case BARRACKS:
			push(rearArc)
		case WALL, SIMPLE_TURRET, SNIPER_TURRET:
			push(fullRing)
			push([]float64{enemyAngle, enemyAngle + math.Pi, rt.anchorA, rt.anchorB})
		}
	case basePlanExternAtk:
		switch buildingType {
		case BARRACKS:
			push(frontArc)
			push([]float64{enemyAngle + math.Pi})
		case SIMPLE_TURRET:
			push([]float64{enemyAngle - 0.34, enemyAngle - 0.14, enemyAngle + 0.14, enemyAngle + 0.34})
		case SNIPER_TURRET:
			push([]float64{enemyAngle + math.Pi/2, enemyAngle - math.Pi/2, enemyAngle + math.Pi})
		case WALL:
			push(frontArc)
			push(rearArc)
			push([]float64{enemyAngle + math.Pi/2, enemyAngle - math.Pi/2})
		case GENERATOR, HOUSE:
			push(rearArc)
			push(diagonal)
		}
	case basePlanPublicTurtle:
		switch buildingType {
		case WALL:
			push(tightRing)
			push(cardinal)
		case SIMPLE_TURRET, SNIPER_TURRET:
			push(cardinal)
			push(diagonal)
		case BARRACKS:
			push(rearArc)
			push([]float64{rt.anchorA, rt.anchorB})
		case GENERATOR, HOUSE:
			push(diagonal)
			push([]float64{rt.anchorA, rt.anchorB})
		}
	case basePlanPublicHybrid:
		switch buildingType {
		case BARRACKS:
			push([]float64{enemyAngle - 0.24, enemyAngle + 0.24, enemyAngle + math.Pi, rt.anchorA})
		case SIMPLE_TURRET:
			push([]float64{enemyAngle, enemyAngle + math.Pi/2, enemyAngle - math.Pi/2, enemyAngle + math.Pi})
		case WALL:
			push(fullRing)
			push([]float64{enemyAngle, enemyAngle + math.Pi, rt.anchorB})
		case GENERATOR, HOUSE:
			push(diagonal)
			push([]float64{rt.anchorA + math.Pi/3, rt.anchorB - math.Pi/3})
		}
	}

	switch buildingType {
	case WALL:
		push(fullRing)
		push([]float64{enemyAngle, enemyAngle + math.Pi})
	case SIMPLE_TURRET:
		if rt.archetype == archetypeSpearhead {
			push([]float64{enemyAngle, enemyAngle + 0.35, enemyAngle - 0.35, enemyAngle + math.Pi})
		} else {
			push(cardinal)
			push([]float64{enemyAngle, enemyAngle + math.Pi})
		}
	case SNIPER_TURRET:
		push([]float64{enemyAngle + math.Pi/2, enemyAngle - math.Pi/2, enemyAngle + math.Pi})
		push(cardinal)
	case BARRACKS:
		switch rt.archetype {
		case archetypeFortress:
			push([]float64{enemyAngle + math.Pi, enemyAngle, rt.anchorA})
		case archetypeSpearhead:
			push([]float64{enemyAngle, enemyAngle + 0.22, enemyAngle - 0.22, enemyAngle + math.Pi})
		default:
			push([]float64{enemyAngle, enemyAngle + math.Pi, rt.anchorA, rt.anchorB})
		}
	case GENERATOR, HOUSE:
		switch rt.archetype {
		case archetypePinwheel:
			push([]float64{rt.anchorA, rt.anchorA + math.Pi/2, rt.anchorA + math.Pi, rt.anchorA + 3*math.Pi/2})
			push(diagonal)
		default:
			push(diagonal)
			push([]float64{rt.anchorA, rt.anchorB})
			push(cardinal)
		}
	default:
		push(cardinal)
		push(diagonal)
	}

	// Fallback slots.
	push([]float64{rt.anchorA, rt.anchorB, enemyAngle, enemyAngle + math.Pi/2})

	rotation := 0.0
	switch rt.layoutDNA {
	case 1:
		rotation = math.Pi / 12
	case 2:
		rotation = -math.Pi / 14
	case 3:
		rotation = math.Pi / 16
	}
	if rt.profile == profileAttack {
		rotation *= 0.85
	}
	if rt.profile == profileDefense {
		rotation *= 0.6
	}
	for i := range angles {
		angles[i] = normalizeAngle(angles[i] + rotation)
	}
	return uniqueAngles(angles)
}

func uniqueAngles(input []float64) []float64 {
	if len(input) == 0 {
		return input
	}
	out := make([]float64, 0, len(input))
	seen := make(map[int]struct{}, len(input))
	for _, a := range input {
		n := normalizeAngle(a)
		key := int(math.Round(n * 1000))
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, n)
	}
	return out
}

func botPlacementRadius(rt *botRuntime, buildingType BuildingType) (float32, float32) {
	if rt == nil {
		return 120, 260
	}
	dnaOffset := float32(0)
	switch rt.layoutDNA {
	case 1:
		dnaOffset = 8
	case 2:
		dnaOffset = -6
	case 3:
		dnaOffset = 4
	}

	switch buildingType {
	case BARRACKS:
		r := float32(PLAYER_MAX_BUILDING_RADIUS + BARRACKS_OUTER_RING_OFFSET)
		switch rt.basePlan {
		case basePlanExternAtk:
			return r - 5 + dnaOffset*0.25, r + 1 + dnaOffset*0.25
		case basePlanPublicTurtle:
			return r - 14 + dnaOffset*0.25, r - 7 + dnaOffset*0.25
		default:
			return r - 10 + dnaOffset*0.3, r - 2 + dnaOffset*0.3
		}
	case WALL:
		r := float32(PLAYER_MAX_BUILDING_RADIUS + WALL_OUTER_RING_OFFSET - 2)
		switch rt.basePlan {
		case basePlanPublicTurtle:
			return r - 6 + dnaOffset*0.25, r + 1 + dnaOffset*0.25
		case basePlanExternAtk:
			return r - 9 + dnaOffset*0.28, r - 2 + dnaOffset*0.28
		default:
			return r - 8 + dnaOffset*0.3, r + 1 + dnaOffset*0.3
		}
	case SIMPLE_TURRET, SNIPER_TURRET:
		size := float32(GetBuildingSize(buildingType))
		outer := float32(PLAYER_MAX_BUILDING_RADIUS) - size - 18
		inner := outer - 34
		if inner < float32(PLAYER_MIN_BUILDING_RADIUS)+size+12 {
			inner = float32(PLAYER_MIN_BUILDING_RADIUS) + size + 12
		}
		if rt.basePlan == basePlanPublicTurtle {
			inner += 8
		}
		inner += dnaOffset * 0.2
		outer += dnaOffset * 0.2
		if outer < inner {
			outer = inner
		}
		return inner, outer
	case GENERATOR, HOUSE:
		size := float32(GetBuildingSize(buildingType))
		inner := float32(PLAYER_MIN_BUILDING_RADIUS) + size + 10
		outer := inner + 66
		maxAllowed := float32(PLAYER_MAX_BUILDING_RADIUS) - size - 24
		if outer > maxAllowed {
			outer = maxAllowed
		}
		if outer < inner {
			outer = inner
		}
		if rt.basePlan == basePlanExternAtk {
			outer -= 8
		}
		inner += dnaOffset * 0.2
		outer += dnaOffset * 0.2
		if outer > maxAllowed {
			outer = maxAllowed
		}
		if inner < float32(PLAYER_MIN_BUILDING_RADIUS)+size+8 {
			inner = float32(PLAYER_MIN_BUILDING_RADIUS) + size + 8
		}
		if outer < inner {
			outer = inner
		}
		return inner, outer
	default:
		size := float32(GetBuildingSize(buildingType))
		minR := float32(PLAYER_MIN_BUILDING_RADIUS) + size + 8
		maxR := float32(PLAYER_MAX_BUILDING_RADIUS) - size - 16
		if maxR < minR {
			maxR = minR
		}

		span := maxR - minR
		center := minR + span*rt.radialBias
		halfWidth := float32(36)
		if span < 90 {
			halfWidth = span / 2
		}
		lower := center - halfWidth
		upper := center + halfWidth
		if lower < minR {
			lower = minR
		}
		if upper > maxR {
			upper = maxR
		}
		if upper < lower {
			upper = lower
		}
		return lower, upper
	}
}

func runBotMovement(player *Player, rt *botRuntime) {
	if player == nil || player.IsMarkedForRemoval() {
		return
	}
	if isExternalPlannerEnabled() && !rt.externalThoughtReady {
		return
	}

	units := collectMovableUnits(player)
	if len(units) == 0 {
		return
	}
	now := time.Now()
	forceUnstuck := updateBotStuckState(rt, units, now)

	enemyPos, hasEnemy, _, enemyName := findEnemyForRuntime(player, rt)
	if hasEnemy {
		rt.lastEnemyName = enemyName
	}

	summary := summarizeBotBuildings(player.Base)
	power := readCurrentPower(player)
	baseReady := isBotBaseReadyForPush(player, rt, summary, power)
	pushUnlocked := baseReady
	if rt.thought.allowPush != nil {
		if *rt.thought.allowPush {
			pushUnlocked = true
		} else if !baseReady {
			pushUnlocked = false
		}
	}
	if !pushUnlocked {
		rt.attackCommitUntil = time.Time{}
		softLock := now.Add(randomDuration(6*time.Second, 12*time.Second))
		if rt.attackUnlockedAt.Before(softLock) {
			rt.attackUnlockedAt = softLock
		}
	}

	attackConfidence := computeBotAttackConfidence(player, rt, enemyPos, hasEnemy, len(units), power, pushUnlocked)
	mode := chooseMoveMode(player, rt, len(units), hasEnemy, pushUnlocked, attackConfidence, rt.thought.forceMode)
	if forceUnstuck {
		if player.WasBaseDamagedWithin(10 * time.Second) {
			mode = moveDefend
		} else {
			mode = moveRegroup
		}
	}
	mode = stabilizeBotMoveMode(player, rt, mode, forceUnstuck)
	rt.lastMode = mode
	if forceUnstuck {
		rt.attackCommitUntil = time.Time{}
	} else {
		updateAttackCommit(player, rt, mode, hasEnemy)
	}

	applyBotGroupPreference(player, rt, mode)

	target, ok := pickMoveTarget(player, rt, mode, enemyPos, hasEnemy, pushUnlocked, len(units), attackConfidence)
	if forceUnstuck {
		target = pickUnstuckMoveTarget(player, rt, enemyPos, hasEnemy)
		ok = true
	}
	if !ok {
		return
	}
	target = stabilizeBotMoveTarget(rt, units, mode, target, forceUnstuck)

	selected := selectUnitsForMove(units, rt, mode)
	if forceUnstuck {
		selected = units
	}
	if len(selected) == 0 {
		return
	}

	if forceUnstuck {
		applyScatterFormation(selected, target, 320)
	} else {
		applyFormationTargets(selected, target, rt, mode)
	}
	player.SetLastActivity()
	TriggerUnitsRotationUpdateEvent(player, selected)
}

func collectMovableUnits(player *Player) []*Unit {
	player.RLock()
	defer player.RUnlock()

	units := make([]*Unit, 0, len(player.Units))
	for _, unit := range player.Units {
		if unit == nil || unit.IsMarkedForRemoval() {
			continue
		}
		units = append(units, unit)
	}
	return units
}

func unitsCentroid(units []*Unit) (PositionFloat, bool) {
	if len(units) == 0 {
		return PositionFloat{}, false
	}
	var sumX float32
	var sumY float32
	count := 0
	for _, unit := range units {
		if unit == nil || unit.IsMarkedForRemoval() {
			continue
		}
		pos := unit.GetPosition()
		sumX += pos.X
		sumY += pos.Y
		count++
	}
	if count == 0 {
		return PositionFloat{}, false
	}
	return PositionFloat{
		X: sumX / float32(count),
		Y: sumY / float32(count),
	}, true
}

func averageUnitTargetDistance(units []*Unit) float32 {
	if len(units) == 0 {
		return 0
	}
	var total float32
	count := 0
	for _, unit := range units {
		if unit == nil || unit.IsMarkedForRemoval() {
			continue
		}
		total += unit.GetPosition().DistanceTo(unit.TargetPosition)
		count++
	}
	if count == 0 {
		return 0
	}
	return total / float32(count)
}

func updateBotStuckState(rt *botRuntime, units []*Unit, now time.Time) bool {
	if rt == nil {
		return false
	}
	centroid, ok := unitsCentroid(units)
	if !ok {
		return false
	}

	if rt.lastMoveSampleAt.IsZero() {
		rt.lastMoveCentroid = centroid
		rt.lastMoveSampleAt = now
		rt.lastMoveProgressAt = now
		return false
	}

	moved := centroid.DistanceTo(rt.lastMoveCentroid)
	rt.lastMoveCentroid = centroid
	rt.lastMoveSampleAt = now
	if moved >= botMoveProgressMinDistance {
		rt.lastMoveProgressAt = now
		if rt.unstuckBursts > 0 {
			rt.unstuckBursts--
		}
	}

	if now.Before(rt.unstuckUntil) {
		return true
	}

	if len(units) < 4 {
		return false
	}
	if averageUnitTargetDistance(units) < botMoveStuckTargetDistance {
		return false
	}
	if now.Sub(rt.lastMoveProgressAt) < botMoveStuckTimeout {
		return false
	}

	burst := rt.unstuckBursts
	if burst > 3 {
		burst = 3
	}
	boost := time.Duration(burst) * time.Second
	rt.unstuckUntil = now.Add(randomDuration(4*time.Second+boost, 7*time.Second+boost))
	rt.unstuckBursts++
	rt.lastMoveProgressAt = now
	return true
}

func stabilizeBotMoveMode(player *Player, rt *botRuntime, candidate botMoveMode, forceUnstuck bool) botMoveMode {
	if rt == nil {
		return candidate
	}
	now := time.Now()
	if rt.lastModeChangeAt.IsZero() {
		rt.lastModeChangeAt = now
		return candidate
	}
	if forceUnstuck {
		rt.lastModeChangeAt = now
		return candidate
	}
	if candidate == rt.lastMode {
		return candidate
	}

	urgentDefend := player != nil && candidate == moveDefend && player.WasBaseDamagedWithin(8*time.Second)
	if urgentDefend {
		rt.lastModeChangeAt = now
		return candidate
	}

	// Hold the previous mode briefly to avoid pressure/regroup ping-pong.
	if now.Sub(rt.lastModeChangeAt) < botMoveModeMinHold {
		return rt.lastMode
	}
	rt.lastModeChangeAt = now
	return candidate
}

func stabilizeBotMoveTarget(rt *botRuntime, units []*Unit, mode botMoveMode, candidate PositionFloat, forceUnstuck bool) PositionFloat {
	if rt == nil {
		return candidate
	}

	now := time.Now()
	if forceUnstuck || rt.lastMoveTargetAt.IsZero() {
		rt.lastMoveTarget = candidate
		rt.lastMoveTargetAt = now
		rt.lastMoveTargetMode = mode
		return candidate
	}

	prev := rt.lastMoveTarget
	sinceLast := now.Sub(rt.lastMoveTargetAt)
	centroid, hasCentroid := unitsCentroid(units)

	if mode == rt.lastMoveTargetMode && sinceLast < botMoveTargetMinHold {
		if hasCentroid && centroid.DistanceTo(prev) > botMoveTargetReachRadius {
			return prev
		}
		if candidate.DistanceTo(prev) < botMoveTargetRepathDelta {
			return prev
		}
	}

	if mode != rt.lastMoveTargetMode && sinceLast < botMoveTargetSwitchGrace {
		if hasCentroid && centroid.DistanceTo(prev) > botMoveTargetReachRadius*0.85 {
			return prev
		}
	}

	chosen := candidate
	delta := candidate.DistanceTo(prev)
	// Smooth small path corrections to prevent visible back-and-forth.
	if delta > 0 && delta < 900 {
		newWeight := float32(0.68)
		if mode != rt.lastMoveTargetMode {
			newWeight = 0.55
		}
		oldWeight := 1 - newWeight
		chosen = PositionFloat{
			X: prev.X*oldWeight + candidate.X*newWeight,
			Y: prev.Y*oldWeight + candidate.Y*newWeight,
		}
	}

	rt.lastMoveTarget = chosen
	rt.lastMoveTargetAt = now
	rt.lastMoveTargetMode = mode
	return chosen
}

func pickUnstuckMoveTarget(player *Player, rt *botRuntime, enemyPos PositionFloat, hasEnemy bool) PositionFloat {
	if player == nil || player.Base == nil {
		return PositionFloat{}
	}
	self := IntToFloat(player.Base.GetPosition())
	angle := rand.Float64() * 2 * math.Pi
	radius := float32(460 + rand.Intn(260))

	target := PositionFloat{
		X: self.X + radius*float32(math.Cos(angle)),
		Y: self.Y + radius*float32(math.Sin(angle)),
	}

	if hasEnemy && rand.Float64() < 0.45 {
		advance := float32(0.24)
		if rt != nil {
			advance += rt.aggression * 0.12
		}
		target = PositionFloat{
			X: self.X + (enemyPos.X-self.X)*advance + float32(rand.Intn(580)-290),
			Y: self.Y + (enemyPos.Y-self.Y)*advance + float32(rand.Intn(580)-290),
		}
	}

	return ClampPositionFloatToMap(target, 120)
}

func findEnemyForRuntime(player *Player, rt *botRuntime) (PositionFloat, bool, float64, string) {
	if player == nil || player.Base == nil {
		return PositionFloat{}, false, 0, ""
	}
	if rt == nil {
		return findNearestEnemy(player)
	}

	now := time.Now()
	if rt.targetPlayerID != 0 && now.Before(rt.targetLockedUntil) {
		if target := getEnemyByID(player, rt.targetPlayerID); target != nil {
			// Human players are only valid attack targets after they leave their base zone.
			if !target.IsBot && !isHumanTargetExposedOutsideBase(target) {
				rt.targetPlayerID = 0
				rt.targetLockedUntil = time.Time{}
				clearBotTargetIntent(player.ID)
			} else {
				setBotTargetIntent(player.ID, target.ID)
				return enemySnapshotFromTarget(player, target)
			}
		}
		rt.targetPlayerID = 0
		rt.targetLockedUntil = time.Time{}
	}

	target := chooseStrategicEnemyTarget(player, rt)
	if target == nil {
		rt.targetPlayerID = 0
		rt.targetLockedUntil = time.Time{}
		clearBotTargetIntent(player.ID)
		return PositionFloat{}, false, 0, ""
	}

	lockDuration := randomDuration(minTargetLockTTL, maxTargetLockTTL)
	stickiness := time.Duration(float32(lockDuration) * (0.55 + rt.patience*0.55))
	if stickiness > 42*time.Second {
		stickiness = 42 * time.Second
	}
	if stickiness < 8*time.Second {
		stickiness = 8 * time.Second
	}

	rt.targetPlayerID = target.ID
	rt.targetLockedUntil = now.Add(stickiness)
	setBotTargetIntent(player.ID, target.ID)
	return enemySnapshotFromTarget(player, target)
}

func getEnemyByID(player *Player, enemyID ID) *Player {
	if player == nil || enemyID == 0 {
		return nil
	}
	State.RLock()
	target := State.Players[enemyID]
	State.RUnlock()
	if target == nil || target.ID == player.ID || target.IsMarkedForRemoval() || target.Base == nil {
		return nil
	}
	return target
}

func enemySnapshotFromTarget(player *Player, target *Player) (PositionFloat, bool, float64, string) {
	if player == nil || player.Base == nil || target == nil || target.Base == nil {
		return PositionFloat{}, false, 0, ""
	}
	selfPos := IntToFloat(player.Base.GetPosition())
	targetPos := IntToFloat(target.Base.GetPosition())
	angle := math.Atan2(float64(targetPos.Y-selfPos.Y), float64(targetPos.X-selfPos.X))
	return targetPos, true, angle, getPlayerName(target)
}

func findAttackSnapshotEnemy(player *Player, rt *botRuntime, enemyPos PositionFloat) *Player {
	if player == nil {
		return nil
	}
	if rt != nil && rt.targetPlayerID != 0 {
		if target := getEnemyByID(player, rt.targetPlayerID); target != nil {
			return target
		}
	}

	var best *Player
	bestDist := float32(math.MaxFloat32)

	State.RLock()
	for _, other := range State.Players {
		if other == nil || other.ID == player.ID || other.IsMarkedForRemoval() || other.Base == nil {
			continue
		}
		pos := IntToFloat(other.Base.GetPosition())
		dist := enemyPos.DistanceTo(pos)
		if dist < bestDist {
			bestDist = dist
			best = other
		}
	}
	State.RUnlock()

	return best
}

func computeBotAttackConfidence(player *Player, rt *botRuntime, enemyPos PositionFloat, hasEnemy bool, unitCount int, power uint16, baseReady bool) float64 {
	if player == nil || rt == nil {
		return 0
	}

	score := 0.0
	if hasEnemy {
		score += 0.22
	} else {
		score -= 0.55
	}
	if baseReady {
		score += 0.2
	} else {
		score -= 0.16
	}

	score += float64(rt.aggression) * 0.28
	score += float64(rt.teamplay) * 0.12

	switch {
	case unitCount >= 12:
		score += 0.28
	case unitCount >= 9:
		score += 0.18
	case unitCount >= 7:
		score += 0.08
	default:
		score -= 0.24
	}

	switch {
	case power >= 420:
		score += 0.17
	case power >= 260:
		score += 0.09
	case power < 160:
		score -= 0.14
	}

	if player.WasBaseDamagedWithin(10 * time.Second) {
		score -= 0.42
	}

	target := findAttackSnapshotEnemy(player, rt, enemyPos)
	if target != nil {
		targetUnits := 0
		target.RLock()
		targetUnits = len(target.Units)
		target.RUnlock()

		targetPower := readCurrentPower(target)
		targetHP := 1.0
		if target.Base != nil {
			target.Base.Health.RLock()
			if target.Base.Health.Max > 0 {
				targetHP = float64(target.Base.Health.Current) / float64(target.Base.Health.Max)
			}
			target.Base.Health.RUnlock()
		}

		score += clampFloat64(float64(unitCount-targetUnits)/8.0, -0.30, 0.28)
		score += clampFloat64(float64(int(power)-int(targetPower))/500.0, -0.22, 0.20)
		if targetHP < 0.45 {
			score += 0.15
		}
		if targetHP > 0.85 && !baseReady {
			score -= 0.12
		}
	}

	switch rt.role {
	case roleGuardian, roleEco:
		if !baseReady {
			score -= 0.1
		}
	case roleRaider, roleDuelist:
		score += 0.08
	}

	return clampFloat64(score, 0.0, 1.0)
}

func chooseStrategicEnemyTarget(player *Player, rt *botRuntime) *Player {
	if player == nil || player.Base == nil || rt == nil {
		return nil
	}

	selfPos := IntToFloat(player.Base.GetPosition())
	preferredHuman := closestHumanTargetForBot(player)
	isPreferredHunter := preferredHuman != nil && isBotAmongClosestToTarget(player, preferredHuman, 2)
	var best *Player
	bestScore := -1e9

	State.RLock()
	candidates := make([]*Player, 0, len(State.Players))
	for _, other := range State.Players {
		candidates = append(candidates, other)
	}
	State.RUnlock()

	for _, target := range candidates {
		if target == nil || target.ID == player.ID || target.IsMarkedForRemoval() || target.Base == nil {
			continue
		}
		if !target.IsBot && !isHumanTargetExposedOutsideBase(target) {
			continue
		}

		targetPos := IntToFloat(target.Base.GetPosition())
		dist := selfPos.DistanceTo(targetPos)
		if dist > 13000 {
			continue
		}

		targetScore := 0.0
		if target.IsBot {
			targetScore -= 0.9
		} else {
			targetScore += 1.4
		}
		if preferredHuman != nil && target.ID == preferredHuman.ID {
			if isPreferredHunter {
				// Force the two closest bots to pressure the closest human target.
				targetScore += 3.1
				targetScore += clampFloat64(1.3-float64(dist)/2400.0, -0.5, 1.3)
			} else {
				// Keep the rest from dogpiling the same player.
				targetScore -= 2.0
			}
		}

		// Distance preference differs by role.
		switch rt.role {
		case roleGuardian:
			targetScore += clampFloat64(1.4-float64(dist)/2200.0, -1.2, 1.4)
		case roleRaider:
			targetScore += clampFloat64(1.0-float64(math.Abs(float64(dist-2600)))/2200.0, -0.9, 1.2)
		case roleSiege:
			targetScore += clampFloat64(1.0-float64(dist)/3200.0, -1.0, 1.0)
		case roleEco:
			targetScore += clampFloat64(0.8-float64(dist)/2600.0, -1.2, 0.8)
		case roleDuelist:
			targetScore += clampFloat64(1.1-float64(math.Abs(float64(dist-1900)))/1800.0, -1.2, 1.2)
		}

		target.Base.Health.RLock()
		hpCurrent := target.Base.Health.Current
		hpMax := target.Base.Health.Max
		target.Base.Health.RUnlock()
		hpRatio := 1.0
		if hpMax > 0 {
			hpRatio = float64(hpCurrent) / float64(hpMax)
		}
		weakness := 1.0 - hpRatio
		targetScore += weakness * (0.45 + float64(rt.aggression)*0.95)
		if rt.role == roleSiege || rt.role == roleRaider {
			targetScore += weakness * 0.6
		}

		if target.WasBaseDamagedWithin(20 * time.Second) {
			targetScore += 0.2 + float64(rt.teamplay)*0.65
		}
		if rt.role == roleDuelist && isLateralNeighbor(player, target) {
			targetScore += 0.85
		}

		crowd := countBotsTargeting(target.ID)
		desiredTeammates := 1
		if !target.IsBot && (rt.teamplay > 0.58 || rt.role == roleSiege || rt.role == roleRaider) {
			desiredTeammates = 2
		}
		if preferredHuman != nil && target.ID == preferredHuman.ID && isPreferredHunter {
			desiredTeammates = 2
		}
		if crowd >= desiredTeammates {
			targetScore -= float64(crowd-desiredTeammates+1) * (0.95 + float64(1-rt.teamplay)*0.5)
		} else if crowd == desiredTeammates-1 && desiredTeammates >= 2 {
			targetScore += 0.28 + float64(rt.teamplay)*0.38
		}

		if rt.targetPlayerID == target.ID {
			targetScore += 0.24 + float64(rt.patience)*0.55
		}

		// Deterministic small noise per bot-target pair to avoid clones.
		signature := float64((int(player.ID)*97 + int(target.ID)*37 + int(rt.layoutDNA)*19 + rt.phase*11) % 101)
		targetScore += (signature/100.0 - 0.5) * 0.7

		if targetScore > bestScore {
			bestScore = targetScore
			best = target
		}
	}

	return best
}

func closestHumanTargetForBot(player *Player) *Player {
	if player == nil || player.Base == nil {
		return nil
	}
	selfPos := IntToFloat(player.Base.GetPosition())
	bestDist := float32(math.MaxFloat32)
	var best *Player

	State.RLock()
	for _, other := range State.Players {
		if other == nil || other.ID == player.ID || other.IsMarkedForRemoval() || other.Base == nil || other.IsBot {
			continue
		}
		if !isHumanTargetExposedOutsideBase(other) {
			continue
		}
		dist := selfPos.DistanceTo(IntToFloat(other.Base.GetPosition()))
		if dist < bestDist {
			bestDist = dist
			best = other
		}
	}
	State.RUnlock()

	return best
}

func isHumanTargetExposedOutsideBase(target *Player) bool {
	if target == nil || target.IsBot || target.Base == nil {
		return false
	}

	basePos := IntToFloat(target.Base.GetPosition())
	// Treat the spawn-protection ring as the "base zone" for bot targeting.
	baseZoneRadius := float32(PLAYER_SPAWN_PROTECTION_RADIUS)

	target.RLock()
	defer target.RUnlock()

	for _, unit := range target.Units {
		if unit == nil || unit.IsMarkedForRemoval() {
			continue
		}
		if !unit.IsWithinRadius(basePos, baseZoneRadius+float32(unit.Size)) {
			return true
		}
	}
	return false
}

func isBotAmongClosestToTarget(bot *Player, target *Player, limit int) bool {
	if bot == nil || target == nil || bot.Base == nil || target.Base == nil || limit <= 0 {
		return false
	}

	type botDist struct {
		id   ID
		dist float32
	}
	targetPos := IntToFloat(target.Base.GetPosition())
	candidates := make([]botDist, 0, 16)

	State.RLock()
	for _, other := range State.Players {
		if other == nil || other.IsMarkedForRemoval() || !other.IsBot || other.Base == nil {
			continue
		}
		if other.ID == target.ID {
			continue
		}
		dist := targetPos.DistanceTo(IntToFloat(other.Base.GetPosition()))
		candidates = append(candidates, botDist{id: other.ID, dist: dist})
	}
	State.RUnlock()

	if len(candidates) == 0 {
		return false
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].dist < candidates[j].dist })
	if limit > len(candidates) {
		limit = len(candidates)
	}
	for i := 0; i < limit; i++ {
		if candidates[i].id == bot.ID {
			return true
		}
	}
	return false
}

func clampFloat64(v float64, low float64, high float64) float64 {
	if v < low {
		return low
	}
	if v > high {
		return high
	}
	return v
}

func clampFloat32(v float32, low float32, high float32) float32 {
	if v < low {
		return low
	}
	if v > high {
		return high
	}
	return v
}

func randRange32(min float32, max float32) float32 {
	if max <= min {
		return min
	}
	return min + rand.Float32()*(max-min)
}

func findNearestEnemy(player *Player) (PositionFloat, bool, float64, string) {
	if player == nil || player.Base == nil {
		return PositionFloat{}, false, 0, ""
	}

	selfPos := IntToFloat(player.Base.GetPosition())
	bestHumanDistance := float32(math.MaxFloat32)
	bestBotDistance := float32(math.MaxFloat32)
	bestHumanPos := PositionFloat{}
	bestBotPos := PositionFloat{}
	bestHumanName := ""
	bestBotName := ""
	humanFound := false
	botFound := false

	State.RLock()
	for _, other := range State.Players {
		if other == nil || other.IsMarkedForRemoval() || other.ID == player.ID || other.Base == nil {
			continue
		}
		pos := IntToFloat(other.Base.GetPosition())
		dist := selfPos.DistanceTo(pos)
		if other.IsBot {
			if dist < bestBotDistance {
				bestBotDistance = dist
				bestBotPos = pos
				bestBotName = getPlayerName(other)
				botFound = true
			}
			continue
		}
		if dist < bestHumanDistance {
			bestHumanDistance = dist
			bestHumanPos = pos
			bestHumanName = getPlayerName(other)
			humanFound = true
		}
	}
	State.RUnlock()

	bestPos := PositionFloat{}
	bestName := ""
	found := false
	if humanFound {
		bestPos = bestHumanPos
		bestName = bestHumanName
		found = true
	} else if botFound {
		bestPos = bestBotPos
		bestName = bestBotName
		found = true
	}

	if !found {
		return PositionFloat{}, false, 0, ""
	}

	angle := math.Atan2(float64(bestPos.Y-selfPos.Y), float64(bestPos.X-selfPos.X))
	return bestPos, true, angle, bestName
}

func updateAttackCommit(player *Player, rt *botRuntime, mode botMoveMode, hasEnemy bool) {
	if rt == nil {
		return
	}
	now := time.Now()

	if player != nil && player.WasBaseDamagedWithin(10*time.Second) {
		rt.attackCommitUntil = time.Time{}
		return
	}
	if !hasEnemy {
		rt.attackCommitUntil = time.Time{}
		return
	}

	if mode != movePressure && mode != moveFlank {
		return
	}

	if now.Before(rt.attackCommitUntil) {
		extend := randomDuration(3*time.Second, 8*time.Second)
		newUntil := rt.attackCommitUntil.Add(extend / 2)
		maxUntil := now.Add(42 * time.Second)
		if newUntil.After(maxUntil) {
			newUntil = maxUntil
		}
		rt.attackCommitUntil = newUntil
		return
	}

	base := randomDuration(18*time.Second, 34*time.Second)
	scaled := time.Duration(float32(base) * (0.75 + rt.patience*0.55))
	if scaled < 12*time.Second {
		scaled = 12 * time.Second
	}
	if scaled > 48*time.Second {
		scaled = 48 * time.Second
	}
	rt.attackCommitUntil = now.Add(scaled)
}

func chooseMoveMode(player *Player, rt *botRuntime, unitCount int, hasEnemy bool, baseReady bool, attackConfidence float64, forced *botMoveMode) botMoveMode {
	now := time.Now()
	attackLocked := now.Before(rt.attackUnlockedAt)
	attackCommitted := hasEnemy && baseReady && now.Before(rt.attackCommitUntil)
	if attackCommitted && attackConfidence < 0.24 {
		rt.attackCommitUntil = time.Time{}
		attackCommitted = false
	}

	if attackCommitted && !player.WasBaseDamagedWithin(10*time.Second) {
		if rt.lastMode == moveFlank {
			return moveFlank
		}
		return movePressure
	}

	if forced != nil {
		if attackLocked && (*forced == movePressure || *forced == moveFlank) {
			forced = nil
		}
		if attackConfidence < 0.30 && (*forced == movePressure || *forced == moveFlank) {
			forced = nil
		}
	}
	if forced != nil {
		return *forced
	}
	if player.WasBaseDamagedWithin(10 * time.Second) {
		return moveDefend
	}
	if !baseReady {
		if !attackLocked && hasEnemy && unitCount >= 6 {
			aggressivePlan := rt.basePlan == basePlanExternAtk || rt.profile == profileAttack || rt.role == roleRaider
			if aggressivePlan && attackConfidence >= 0.62 {
				if rand.Float32() < float32(0.28+attackConfidence*0.35) {
					return movePressure
				}
			}
			if aggressivePlan && attackConfidence >= 0.78 && unitCount >= 8 && rand.Float32() < 0.22 {
				return moveFlank
			}
		}
		if attackConfidence < 0.22 {
			if rt.role == roleGuardian || rt.role == roleEco {
				return moveDefend
			}
			return moveRegroup
		}
		if unitCount <= 7 {
			return moveRegroup
		}
		if rt.role == roleGuardian || rt.role == roleEco {
			if rand.Float32() < 0.55 {
				return moveDefend
			}
		}
		return moveRegroup
	}
	if attackLocked {
		return moveRegroup
	}
	if unitCount <= 4 {
		return moveRegroup
	}
	if !hasEnemy {
		return moveRegroup
	}
	if attackConfidence < 0.26 {
		return moveDefend
	}
	if attackConfidence < 0.42 {
		return moveRegroup
	}

	r := rand.Float32()
	attackBias := float32(attackConfidence)
	if rt.aggression > 0.72 && unitCount >= 8 && rt.role != roleEco {
		pressureChance := float32(0.34) + attackBias*0.44 + rt.teamplay*0.18
		if pressureChance > 0.9 {
			pressureChance = 0.9
		}
		if r < pressureChance {
			return movePressure
		}
		return moveFlank
	}

	switch rt.role {
	case roleGuardian:
		if r < 0.42 {
			return moveDefend
		}
		if attackConfidence < 0.62 || unitCount < 8 {
			return moveRegroup
		}
		if r < 0.82 {
			return movePressure
		}
		return moveRegroup
	case roleRaider:
		if attackConfidence < 0.45 {
			if r < 0.25 {
				return moveDefend
			}
			return moveRegroup
		}
		if unitCount >= 8 && r < 0.48+attackBias*0.2 {
			return moveFlank
		}
		if unitCount >= 7 && r < 0.88 {
			return movePressure
		}
		return moveRegroup
	case roleSiege:
		if attackConfidence < 0.4 {
			return moveRegroup
		}
		if unitCount >= 9 && r < 0.55+attackBias*0.2 {
			return movePressure
		}
		if unitCount >= 8 && r < 0.84 {
			return moveFlank
		}
		if r < 0.92 {
			return moveRegroup
		}
		return moveDefend
	case roleEco:
		if attackConfidence < 0.52 {
			if r < 0.35 {
				return moveDefend
			}
			return moveRegroup
		}
		if unitCount < 9 {
			return moveRegroup
		}
		if r < 0.2 {
			return moveDefend
		}
		if r < 0.72 {
			return movePressure
		}
		return moveFlank
	case roleDuelist:
		if attackConfidence < 0.45 {
			if r < 0.2 {
				return moveDefend
			}
			return moveRegroup
		}
		if unitCount >= 8 && r < 0.52 {
			return moveFlank
		}
		if unitCount >= 7 && r < 0.86 {
			return movePressure
		}
		if r < 0.93 {
			return moveRegroup
		}
		return moveDefend
	default:
		if r < 0.3 {
			return moveDefend
		}
		if r < 0.65 {
			return moveRegroup
		}
		if r < 0.88 {
			return movePressure
		}
		return moveFlank
	}
}

func pickMoveTarget(player *Player, rt *botRuntime, mode botMoveMode, enemyPos PositionFloat, hasEnemy bool, baseReady bool, unitCount int, attackConfidence float64) (PositionFloat, bool) {
	if player == nil || player.Base == nil {
		return PositionFloat{}, false
	}

	self := IntToFloat(player.Base.GetPosition())
	target := self
	attackCommitted := time.Now().Before(rt.attackCommitUntil)
	inWarmup := player.HasProtection() && time.Now().Before(rt.attackUnlockedAt)
	if inWarmup || !baseReady {
		if hasEnemy {
			progress := float32(0.34 + rt.aggression*0.18)
			if !baseReady && attackConfidence >= 0.62 {
				progress += 0.14
			}
			if inWarmup {
				progress *= 0.72
			}
			if player.WasBaseDamagedWithin(10 * time.Second) {
				progress -= 0.14
			}
			progress = clampFloat32(progress, 0.2, 0.7)

			jitter := 190
			if attackConfidence >= 0.62 {
				jitter = 130
			}
			if inWarmup {
				jitter = 90
			}
			target = PositionFloat{
				X: self.X + (enemyPos.X-self.X)*progress + float32(rand.Intn(jitter*2)-jitter),
				Y: self.Y + (enemyPos.Y-self.Y)*progress + float32(rand.Intn(jitter*2)-jitter),
			}
			target = ClampPositionFloatToMap(target, 120)
			return target, true
		}
		spread := 180
		if !baseReady {
			spread = 260
		}
		target = PositionFloat{
			X: self.X + float32(rand.Intn(spread*2)-spread),
			Y: self.Y + float32(rand.Intn(spread*2)-spread),
		}
		target = ClampPositionFloatToMap(target, 120)
		return target, true
	}

	switch mode {
	case moveDefend:
		target = PositionFloat{
			X: self.X + float32(rand.Intn(420)-210),
			Y: self.Y + float32(rand.Intn(420)-210),
		}
	case moveRegroup:
		if hasEnemy {
			advance := float32(0.40 + rt.aggression*0.18)
			if attackConfidence > 0.68 {
				advance += 0.1
			}
			if unitCount <= 5 {
				advance -= 0.12
			}
			if player.WasBaseDamagedWithin(10 * time.Second) {
				advance -= 0.14
			}
			advance = clampFloat32(advance, 0.24, 0.72)
			jitter := 220
			if attackCommitted {
				jitter = 110
			}
			target = PositionFloat{
				X: self.X + (enemyPos.X-self.X)*advance + float32(rand.Intn(jitter*2)-jitter),
				Y: self.Y + (enemyPos.Y-self.Y)*advance + float32(rand.Intn(jitter*2)-jitter),
			}
		} else {
			target = PositionFloat{
				X: self.X + float32(rand.Intn(620)-310),
				Y: self.Y + float32(rand.Intn(620)-310),
			}
		}
	case movePressure:
		if !hasEnemy {
			return PositionFloat{}, false
		}
		jitter := 160
		if attackCommitted {
			jitter = 72
		}
		if attackConfidence < 0.45 {
			target = PositionFloat{
				X: self.X + (enemyPos.X-self.X)*0.72 + float32(rand.Intn(jitter*2)-jitter),
				Y: self.Y + (enemyPos.Y-self.Y)*0.72 + float32(rand.Intn(jitter*2)-jitter),
			}
		} else {
			target = PositionFloat{
				X: enemyPos.X + float32(rand.Intn(jitter*2)-jitter),
				Y: enemyPos.Y + float32(rand.Intn(jitter*2)-jitter),
			}
		}
	case moveFlank:
		if !hasEnemy {
			return PositionFloat{}, false
		}
		flankAngle := rt.anchorA + (rand.Float64()-0.5)*0.55
		flankRadius := float32(360 - attackConfidence*90)
		if attackCommitted {
			flankRadius -= 70
		}
		if flankRadius < 190 {
			flankRadius = 190
		}
		target = PositionFloat{
			X: enemyPos.X + flankRadius*float32(math.Cos(flankAngle)),
			Y: enemyPos.Y + flankRadius*float32(math.Sin(flankAngle)),
		}
	}

	target = ClampPositionFloatToMap(target, 120)
	return target, true
}

func selectUnitsForMove(units []*Unit, rt *botRuntime, mode botMoveMode) []*Unit {
	if len(units) <= 2 {
		return units
	}

	ratio := float32(0.7)
	switch mode {
	case moveDefend:
		ratio = 0.45 + (1-rt.aggression)*0.35
	case moveRegroup:
		ratio = 0.55 + rt.aggression*0.2
	case movePressure:
		ratio = 0.72 + rt.aggression*0.25
	case moveFlank:
		ratio = 0.6 + rt.aggression*0.25
	}

	if (mode == movePressure || mode == moveFlank) && time.Now().Before(rt.attackCommitUntil) {
		if ratio < 0.84 {
			ratio = 0.84
		}
	}

	if ratio > 1 {
		ratio = 1
	}
	count := int(math.Ceil(float64(ratio * float32(len(units)))))
	if count < 1 {
		count = 1
	}
	if count > len(units) {
		count = len(units)
	}

	perm := rand.Perm(len(units))
	selected := make([]*Unit, 0, count)
	for i := 0; i < count; i++ {
		selected = append(selected, units[perm[i]])
	}
	return selected
}

func applyFormationTargets(units []*Unit, target PositionFloat, rt *botRuntime, mode botMoveMode) {
	if len(units) == 0 {
		return
	}
	if len(units) == 1 {
		units[0].SetTargetPosition(target)
		return
	}

	switch rt.archetype {
	case archetypeSpearhead:
		applyWedgeFormation(units, target, 65)
	case archetypeFortress:
		if mode == moveDefend {
			applyArcFormation(units, target, 140)
		} else {
			applyGridFormation(units, target, 72)
		}
	case archetypePinwheel:
		applyRingFormation(units, target, 80)
	default:
		applyScatterFormation(units, target, 170)
	}
}

func applyWedgeFormation(units []*Unit, target PositionFloat, spacing float32) {
	for i, unit := range units {
		row := int(math.Sqrt(float64(i)))
		indexInRow := i - row*row
		xOff := float32(indexInRow-row/2) * spacing
		yOff := -float32(row) * spacing * 0.75
		unit.SetTargetPosition(ClampPositionFloatToMap(PositionFloat{
			X: target.X + xOff,
			Y: target.Y + yOff,
		}, 120))
	}
}

func applyGridFormation(units []*Unit, target PositionFloat, spacing float32) {
	side := int(math.Ceil(math.Sqrt(float64(len(units)))))
	if side < 1 {
		side = 1
	}

	for i, unit := range units {
		row := i / side
		col := i % side
		xOff := (float32(col) - float32(side-1)/2) * spacing
		yOff := (float32(row) - float32(side-1)/2) * spacing
		unit.SetTargetPosition(ClampPositionFloatToMap(PositionFloat{
			X: target.X + xOff,
			Y: target.Y + yOff,
		}, 120))
	}
}

func applyRingFormation(units []*Unit, target PositionFloat, radius float32) {
	n := len(units)
	for i, unit := range units {
		angle := 2 * math.Pi * float64(i) / float64(n)
		unit.SetTargetPosition(ClampPositionFloatToMap(PositionFloat{
			X: target.X + radius*float32(math.Cos(angle)),
			Y: target.Y + radius*float32(math.Sin(angle)),
		}, 120))
	}
}

func applyArcFormation(units []*Unit, target PositionFloat, radius float32) {
	n := len(units)
	start := -math.Pi / 2
	end := math.Pi / 2
	if n == 1 {
		n = 2
	}
	for i, unit := range units {
		t := float64(i) / float64(n-1)
		angle := start + (end-start)*t
		unit.SetTargetPosition(ClampPositionFloatToMap(PositionFloat{
			X: target.X + radius*float32(math.Cos(angle)),
			Y: target.Y + radius*float32(math.Sin(angle)),
		}, 120))
	}
}

func applyScatterFormation(units []*Unit, target PositionFloat, spread float32) {
	for _, unit := range units {
		x := target.X + (rand.Float32()*2-1)*spread
		y := target.Y + (rand.Float32()*2-1)*spread
		unit.SetTargetPosition(ClampPositionFloatToMap(PositionFloat{X: x, Y: y}, 120))
	}
}

func runBotChat(player *Player, rt *botRuntime) bool {
	if player == nil || player.IsMarkedForRemoval() {
		return false
	}
	if rt == nil {
		return false
	}
	if rt.identity.SilentChat {
		rt.thought.chat = ""
		rt.thought.reactionChat = ""
		return false
	}
	if isExternalPlannerEnabled() && !rt.externalThoughtReady {
		return false
	}

	now := time.Now()
	if hasActiveHumanConversation(now) {
		rt.thought.chat = ""
		rt.thought.reactionChat = ""
		return false
	}
	if !rt.lastChatAt.IsZero() && now.Sub(rt.lastChatAt) < 30*time.Second {
		return false
	}

	staleChat := rt.lastChatAt.IsZero() || now.Sub(rt.lastChatAt) > 180*time.Second
	shouldSpeak := 0.10 + float64(rt.chatter)*0.15
	if player.WasBaseDamagedWithin(12 * time.Second) {
		shouldSpeak += 0.09
	}
	if now.Before(rt.attackCommitUntil) {
		shouldSpeak += 0.06
	}
	if staleChat {
		shouldSpeak += 0.08
	}
	if shouldSpeak > 0.44 {
		shouldSpeak = 0.44
	}
	if rand.Float64() > shouldSpeak {
		return false
	}

	power := readCurrentPower(player)
	units := readUnitCount(player)
	underAttack := player.WasBaseDamagedWithin(12 * time.Second)
	summary := botBuildingSummary{}
	baseReady := false
	if player.Base != nil {
		summary = summarizeBotBuildings(player.Base)
		baseReady = isBotBaseReadyForPush(player, rt, summary, power)
	}

	messages := make([]string, 0, 2)
	currentTick := currentSocialTick()
	currentTarget := strings.TrimSpace(rt.lastEnemyName)
	currentGameContext := "idle"
	switch {
	case underAttack:
		currentGameContext = "defend"
	case now.Before(rt.attackCommitUntil) || rt.lastMode == movePressure || rt.lastMode == moveFlank:
		currentGameContext = "attack"
	case baseReady && units >= 10:
		currentGameContext = "taunt"
	}

	if rt.goChatMem != nil {
		nemesisName := ""
		if rt.localBrain != nil {
			nemesisName = rt.localBrain.currentNemesisName()
		}
		msg := rt.goChatMem.GenerateChatMessage(rt.identity.ID, currentGameContext, currentTick, nemesisName, currentTarget)
		if strings.TrimSpace(msg) != "" {
			messages = append(messages, msg)
		}
	}

	if len(messages) == 0 {
		plannedChat := strings.TrimSpace(rt.thought.chat)
		if plannedChat != "" {
			messages = append(messages, plannedChat)
		} else {
			heuristic := generateHeuristicBotChat(player, rt, now, summary, units, power, baseReady, underAttack)
			if strings.TrimSpace(heuristic) != "" {
				messages = append(messages, heuristic)
			}
		}
	}
	if reaction := strings.TrimSpace(rt.thought.reactionChat); reaction != "" {
		messages = append(messages, reaction)
	}

	cleaned := make([]string, 0, 1)
	for _, msg := range messages {
		text := sanitizeBotChat(msg)
		if text == "" {
			continue
		}
		if isRecentChatDuplicate(rt, text) {
			continue
		}
		cleaned = append(cleaned, text)
		if len(cleaned) >= 1 {
			break
		}
	}

	rt.thought.chat = ""
	rt.thought.reactionChat = ""
	if len(cleaned) == 0 {
		return false
	}

	for _, text := range cleaned {
		TriggerChatMessageEvent(player.ID, []byte(text))
		rt.lastChatAt = now
		rt.lastChatText = text
		appendBotChatHistory(rt, text)
	}
	return true
}

func pickBaseReadyChat(rt *botRuntime) string {
	if rt != nil && rt.language == "pt" {
		return pickRandomChatLine([]string{
			"base fechada, vou pressionar a frente",
			"estrutura ok, agora e hora de avancar",
			"base pronta, iniciando pressao na lane",
		})
	}
	return pickRandomChatLine([]string{
		"base is stable, rotating to pressure",
		"layout online, pushing front now",
		"core is set, time to pressure lane",
	})
}

func generateHeuristicBotChat(player *Player, rt *botRuntime, now time.Time, summary botBuildingSummary, units int, power uint16, baseReady bool, underAttack bool) string {
	if player == nil || rt == nil {
		return ""
	}

	langPT := rt.language == "pt"
	commitPush := now.Before(rt.attackCommitUntil)
	lowInfra := summary.gens+summary.houses+summary.barracks <= 5

	lines := make([]string, 0, 12)
	if learnedPhrase := maybeUseLearndPhrase(rt, langPT); learnedPhrase != "" {
		return learnedPhrase
	}

	switch {
	case underAttack:
		if langPT {
			lines = append(lines,
				"segura ai, to fechando defesa",
				"to segurando aqui, sem abrir base",
				"defesa ativa, nao passa facil",
			)
		} else {
			lines = append(lines,
				"holding here, tightening defense",
				"defense online, no free entry",
				"stabilizing base first, then push",
			)
		}
	case baseReady && commitPush:
		if langPT {
			lines = append(lines,
				"base pronta, vou pressionar agora",
				"abri a frente, bora manter pressao",
				"partiu push limpo nessa lane",
			)
		} else {
			lines = append(lines,
				"base ready, pressing now",
				"front is open, keep the pressure",
				"clean push timing on this lane",
			)
		}
	case baseReady:
		lines = append(lines, pickBaseReadyChat(rt))
	case power < 180:
		if langPT {
			lines = append(lines,
				"energia baixa, vou estabilizar",
				"segurando eco antes de avancar",
			)
		} else {
			lines = append(lines,
				"low power, stabilizing economy",
				"holding eco before next push",
			)
		}
	case lowInfra || units <= 5:
		if langPT {
			lines = append(lines,
				"to montando base com calma",
				"fechando eco e defesa primeiro",
				"base em ajuste, sem afobacao",
			)
		} else {
			lines = append(lines,
				"building core first, then pressure",
				"locking eco and defense now",
				"still shaping base before commit",
			)
		}
	default:
		if langPT {
			lines = append(lines,
				"ritmo bom, mantendo controle",
				"jogo estavel, seguindo plano",
				"to ajustando rotas e pressao",
			)
		} else {
			lines = append(lines,
				"good tempo, keeping control",
				"game is stable, following plan",
				"adjusting angles and pressure",
			)
		}
	}

	switch rt.basePlan {
	case basePlanAutogens:
		if langPT {
			lines = append(lines,
				"autogens encaixado, eco rodando liso",
				"nucleo autogens firme, abrindo mapa",
			)
		} else {
			lines = append(lines,
				"autogens core online, eco is stable",
				"autogens rhythm set, opening map",
			)
		}
	case basePlanExternAtk:
		if langPT {
			lines = append(lines,
				"extern atk montado, vou avancar",
				"lane externa pronta, mantendo pressao",
			)
		} else {
			lines = append(lines,
				"extern atk setup ready, moving up",
				"outer lane online, keeping pressure",
			)
		}
	case basePlanPublicTurtle:
		if langPT {
			lines = append(lines,
				"turtle firme, defesa bem fechada",
				"muralha pronta, segurando o ritmo",
			)
		} else {
			lines = append(lines,
				"turtle shell is solid, holding line",
				"defense ring set, playing patient",
			)
		}
	case basePlanPublicHybrid:
		if langPT {
			lines = append(lines,
				"hibrida pronta, equilibrando push e defesa",
				"core hibrido ok, pressionando sem abrir",
			)
		} else {
			lines = append(lines,
				"hybrid core online, balanced pressure",
				"hybrid setup ready, pushing safely",
			)
		}
	}

	if !underAttack {
		switch rt.profile {
		case profileAttack:
			if langPT {
				lines = append(lines, "vou focar pressao externa agora")
			} else {
				lines = append(lines, "focusing outer pressure now")
			}
		case profileDefense:
			if langPT {
				lines = append(lines, "vou manter linha defensiva firme")
			} else {
				lines = append(lines, "keeping a disciplined defense line")
			}
		case profileEconomy:
			if langPT {
				lines = append(lines, "eco seguro, sem forcar luta ruim")
			} else {
				lines = append(lines, "safe eco, no forced bad fights")
			}
		}
	}

	text := sanitizeBotChat(pickRandomChatLine(lines))
	if text == "" {
		return ""
	}
	if strings.TrimSpace(rt.lastEnemyName) != "" && rand.Float64() < 0.34 {
		mention := mentionFromEnemy(rt.lastEnemyName)
		if mention != "" && mention != "@mid" {
			withMention := sanitizeBotChat(text + " " + mention)
			if len([]rune(withMention)) <= 58 {
				text = withMention
			}
		}
	}
	if rt.lastMode == movePressure && rand.Float64() < 0.22 {
		if langPT {
			text = sanitizeBotChat(text + " sem recuar")
		} else {
			text = sanitizeBotChat(text + " no backing off")
		}
	}
	return injectAbsorbedVocab(text, rt)
}

func pickRandomChatLine(lines []string) string {
	if len(lines) == 0 {
		return ""
	}
	return strings.TrimSpace(lines[rand.Intn(len(lines))])
}

func appendBotChatHistory(rt *botRuntime, text string) {
	if rt == nil {
		return
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	rt.chatHistory = append(rt.chatHistory, text)
	if len(rt.chatHistory) > 8 {
		rt.chatHistory = rt.chatHistory[len(rt.chatHistory)-8:]
	}
}

func hasActiveHumanConversation(now time.Time) bool {
	const conversationWindow = 35 * time.Second
	const minMessages = 2
	const minParticipants = 2

	globalBotSocialChatLogMu.RLock()
	defer globalBotSocialChatLogMu.RUnlock()
	if len(globalRecentHumanChatPulses) < minMessages {
		return false
	}

	cutoff := now.Add(-conversationWindow)
	recentCount := 0
	participants := make(map[string]struct{}, 3)
	for i := len(globalRecentHumanChatPulses) - 1; i >= 0; i-- {
		pulse := globalRecentHumanChatPulses[i]
		if pulse.At.Before(cutoff) {
			break
		}
		recentCount++
		name := strings.TrimSpace(pulse.From)
		if name != "" {
			participants[name] = struct{}{}
		}
		if recentCount >= minMessages && len(participants) >= minParticipants {
			return true
		}
	}
	return false
}

func RecordBotObservedChatMessage(playerID ID, text string) {
	text = sanitizeBotChat(text)
	if text == "" {
		return
	}

	senderName := "unknown"
	isHuman := true
	State.RLock()
	if sender, ok := State.Players[playerID]; ok && sender != nil {
		sender.RLock()
		senderName = strings.TrimSpace(strings.TrimRight(string(sender.Name[:]), "\x00"))
		isHuman = !sender.IsBot
		sender.RUnlock()
	}
	State.RUnlock()
	if senderName == "" {
		senderName = "unknown"
	}

	line := senderName + ": " + text
	globalBotChatHistoryMu.Lock()
	globalBotChatHistory = append(globalBotChatHistory, line)
	if len(globalBotChatHistory) > 36 {
		globalBotChatHistory = globalBotChatHistory[len(globalBotChatHistory)-36:]
	}
	globalBotChatHistoryMu.Unlock()

	globalBotSocialChatLogMu.Lock()
	globalBotSocialTick++
	entry := botSocialChatEntry{
		From:    senderName,
		IsHuman: isHuman,
		Tick:    globalBotSocialTick,
		Message: text,
		Context: detectChatContextFromText(text),
	}
	globalBotSocialChatLog = append(globalBotSocialChatLog, entry)
	if len(globalBotSocialChatLog) > 140 {
		globalBotSocialChatLog = globalBotSocialChatLog[len(globalBotSocialChatLog)-140:]
	}
	if isHuman {
		globalRecentHumanChatPulses = append(globalRecentHumanChatPulses, humanChatPulse{
			From: senderName,
			At:   time.Now(),
		})
		cutoff := time.Now().Add(-2 * time.Minute)
		keepFrom := 0
		for keepFrom < len(globalRecentHumanChatPulses) && globalRecentHumanChatPulses[keepFrom].At.Before(cutoff) {
			keepFrom++
		}
		if keepFrom > 0 {
			globalRecentHumanChatPulses = append([]humanChatPulse(nil), globalRecentHumanChatPulses[keepFrom:]...)
		}
	}
	globalBotSocialChatLogMu.Unlock()
}

func detectChatContextFromText(text string) string {
	lower := strings.ToLower(strings.TrimSpace(text))
	switch {
	case strings.Contains(lower, "gg"), strings.Contains(lower, "ggez"):
		return "post_fight"
	case strings.Contains(lower, "kkkk"), strings.Contains(lower, "kkk"), strings.Contains(lower, "vai de base"), strings.Contains(lower, "sem chance"), strings.Contains(lower, "ez"):
		return "taunting"
	case strings.Contains(lower, "atac"), strings.Contains(lower, "rush"), strings.Contains(lower, "push"):
		return "after_attack"
	case strings.Contains(lower, "defend"), strings.Contains(lower, "defesa"), strings.Contains(lower, "segura"):
		return "defensive_call"
	default:
		return "general"
	}
}

func buildBotSocialPayload(player *Player, rt *botRuntime) botSocialPayload {
	chatLog := getRecentSocialChatLog(30, 40)
	observed := buildObservedPlayersForBot(player, rt, chatLog, 6, 4200)
	matchMeta := buildSocialMatchMeta(chatLog)
	relationships := buildSocialRelationshipsSnapshot(rt, observed)
	vocab := make([]string, len(rt.absorbedVocabulary))
	copy(vocab, rt.absorbedVocabulary)

	return botSocialPayload{
		ChatLog:              chatLog,
		ObservedPlayers:      observed,
		MatchMeta:            matchMeta,
		MyRelationships:      relationships,
		MyAbsorbedVocabulary: vocab,
	}
}

func getRecentSocialChatLog(tickWindow int, maxItems int) []botSocialChatEntry {
	globalBotSocialChatLogMu.RLock()
	defer globalBotSocialChatLogMu.RUnlock()
	if len(globalBotSocialChatLog) == 0 {
		return nil
	}
	lastTick := globalBotSocialChatLog[len(globalBotSocialChatLog)-1].Tick
	startTick := lastTick - tickWindow
	if startTick < 0 {
		startTick = 0
	}

	filtered := make([]botSocialChatEntry, 0, maxItems)
	for _, entry := range globalBotSocialChatLog {
		if entry.Tick < startTick {
			continue
		}
		filtered = append(filtered, entry)
	}
	if len(filtered) > maxItems {
		filtered = filtered[len(filtered)-maxItems:]
	}
	out := make([]botSocialChatEntry, len(filtered))
	copy(out, filtered)
	return out
}

func buildObservedPlayersForBot(player *Player, rt *botRuntime, chatLog []botSocialChatEntry, maxItems int, radius float32) []botObservedPlayer {
	if player == nil || player.Base == nil || maxItems <= 0 || radius <= 0 {
		return nil
	}
	rankMap := buildLeaderboardRankMap()
	selfPos := IntToFloat(player.Base.GetPosition())
	type candidate struct {
		player *Player
		dist   float64
	}
	candidates := make([]candidate, 0, 12)

	State.RLock()
	for _, other := range State.Players {
		if other == nil || other.ID == player.ID || other.IsMarkedForRemoval() || other.Base == nil {
			continue
		}
		dist := selfPos.DistanceTo(IntToFloat(other.Base.GetPosition()))
		if dist > radius {
			continue
		}
		candidates = append(candidates, candidate{player: other, dist: float64(dist)})
	}
	State.RUnlock()

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].dist < candidates[j].dist
	})
	if len(candidates) > maxItems {
		candidates = candidates[:maxItems]
	}

	out := make([]botObservedPlayer, 0, len(candidates))
	currentTick := currentSocialTick()
	for _, c := range candidates {
		other := c.player
		name := strings.TrimSpace(getPlayerName(other))
		if name == "" {
			name = fmt.Sprintf("player_%d", other.ID)
		}

		other.RLock()
		units := len(other.Units)
		currentPower := other.Resources.Power.Current
		other.RUnlock()

		summary := botBuildingSummary{}
		layout := "hybrid"
		buildingsVisible := []string{}
		if other.Base != nil {
			summary = summarizeBotBuildings(other.Base)
			layout = deriveLayoutStyle(summary)
			buildingsVisible = summarizeVisibleBuildings(summary)
		}
		baseHP := 100
		if other.Base != nil {
			other.Base.Health.RLock()
			if other.Base.Health.Max > 0 {
				baseHP = int((float64(other.Base.Health.Current) / float64(other.Base.Health.Max)) * 100)
			}
			other.Base.Health.RUnlock()
		}
		if baseHP < 0 {
			baseHP = 0
		}
		if baseHP > 100 {
			baseHP = 100
		}

		aggression := "medium"
		if units >= 12 || other.WasBaseDamagedWithin(8*time.Second) {
			aggression = "high"
		} else if units <= 4 {
			aggression = "low"
		}

		lastAction := "expand_territory"
		if summary.turrets+summary.snipers >= 4 {
			lastAction = "build_turret"
		}
		if units >= 10 {
			lastAction = "attack_enemy"
		}
		if summary.gens >= 3 && units <= 7 {
			lastAction = "build_autogen"
		}

		rank := rankMap[other.ID]
		if rank == 0 {
			rank = 99
		}

		relationship := "neutral"
		if rt != nil {
			if rel, ok := rt.relationships[name]; ok {
				switch strings.ToLower(strings.TrimSpace(rel.Status)) {
				case "rival", "nemesis":
					relationship = "rival"
				case "friendly":
					relationship = "friendly"
				}
			}
		}

		out = append(out, botObservedPlayer{
			ID:                 name,
			IsHuman:            !other.IsBot,
			CurrentRank:        rank,
			BaseHealth:         baseHP,
			ResourcesTier:      classifyPowerTier(currentPower),
			BuildingsVisible:   buildingsVisible,
			LastAction:         lastAction,
			LastActionTick:     currentTick,
			LayoutStyle:        layout,
			AggressionLevel:    aggression,
			ChatStyleTags:      extractChatStyleTagsForPlayer(name, chatLog),
			RelationshipWithMe: relationship,
		})
	}
	return out
}

func buildLeaderboardRankMap() map[ID]int {
	ranks := make(map[ID]int)
	if State.Leaderboard == nil {
		return ranks
	}
	entries := State.Leaderboard.GetEntries()
	for idx, entry := range entries {
		if entry.Player == nil {
			continue
		}
		ranks[entry.Player.ID] = idx + 1
	}
	return ranks
}

func deriveLayoutStyle(summary botBuildingSummary) string {
	if summary.gens >= summary.barracks+2 {
		return "defend"
	}
	if summary.barracks >= summary.gens+1 {
		return "externatk"
	}
	return "hybrid"
}

func summarizeVisibleBuildings(summary botBuildingSummary) []string {
	out := make([]string, 0, 6)
	if summary.gens > 0 {
		out = append(out, fmt.Sprintf("autogen_x%d", summary.gens))
	}
	if summary.walls > 0 {
		out = append(out, fmt.Sprintf("wall_x%d", summary.walls))
	}
	if summary.barracks > 0 {
		out = append(out, fmt.Sprintf("barracks_x%d", summary.barracks))
	}
	defenseCount := summary.turrets + summary.snipers
	if defenseCount > 0 {
		out = append(out, fmt.Sprintf("turret_x%d", defenseCount))
	}
	if len(out) == 0 {
		out = append(out, "hq")
	}
	return out
}

func classifyPowerTier(power uint16) string {
	switch {
	case power >= 500:
		return "high"
	case power >= 200:
		return "medium"
	default:
		return "low"
	}
}

func extractChatStyleTagsForPlayer(playerName string, chatLog []botSocialChatEntry) []string {
	tags := make([]string, 0, 4)
	seen := make(map[string]struct{})
	lowerName := strings.ToLower(strings.TrimSpace(playerName))
	for _, entry := range chatLog {
		if strings.ToLower(strings.TrimSpace(entry.From)) != lowerName {
			continue
		}
		msg := strings.ToLower(entry.Message)
		if strings.Contains(msg, "kkkk") || strings.Contains(msg, "kkk") {
			if _, ok := seen["kkkk"]; !ok {
				seen["kkkk"] = struct{}{}
				tags = append(tags, "kkkk")
			}
		}
		if entry.Context == "taunting" {
			if _, ok := seen["taunting"]; !ok {
				seen["taunting"] = struct{}{}
				tags = append(tags, "provoca")
			}
		}
		if msg == strings.ToUpper(msg) && len([]rune(msg)) >= 4 {
			if _, ok := seen["caps"]; !ok {
				seen["caps"] = struct{}{}
				tags = append(tags, "caps lock")
			}
		}
		if len(tags) >= 4 {
			break
		}
	}
	if len(tags) == 0 {
		tags = append(tags, "neutro")
	}
	return tags
}

func buildSocialMatchMeta(chatLog []botSocialChatEntry) botSocialMatchMeta {
	winner := ""
	winningStrategy := "balanced"
	action := "build_autogen"

	if State.Leaderboard != nil {
		entries := State.Leaderboard.GetEntries()
		if len(entries) > 0 && entries[0].Player != nil {
			winnerPlayer := entries[0].Player
			winner = strings.TrimSpace(getPlayerName(winnerPlayer))
			if winner == "" {
				winner = fmt.Sprintf("player_%d", winnerPlayer.ID)
			}
			if winnerPlayer.Base != nil {
				s := summarizeBotBuildings(winnerPlayer.Base)
				layout := deriveLayoutStyle(s)
				switch layout {
				case "defend":
					winningStrategy = "defend + late autogen rush"
					action = "build_autogen"
				case "externatk":
					winningStrategy = "externatk pressure"
					action = "attack_enemy"
				default:
					winningStrategy = "hybrid scaling"
					action = "expand_territory"
				}
			}
		}
	}

	var fastest *botSocialFastestElimination
	globalBotSocialChatLogMu.RLock()
	if globalBotFastestElimination != nil {
		copyValue := *globalBotFastestElimination
		fastest = &copyValue
	}
	globalBotSocialChatLogMu.RUnlock()

	return botSocialMatchMeta{
		WhoIsWinning:                 winner,
		WinningStrategy:              winningStrategy,
		MostEffectiveActionThisMatch: action,
		FastestEliminationThisMatch:  fastest,
		ChatVocabularyPool:           extractVocabularyPool(chatLog, 24),
	}
}

func extractVocabularyPool(chatLog []botSocialChatEntry, maxItems int) []string {
	pool := make([]string, 0, maxItems)
	seen := make(map[string]struct{})
	for i := len(chatLog) - 1; i >= 0; i-- {
		entry := chatLog[i]
		if !entry.IsHuman {
			continue
		}
		for _, raw := range strings.Fields(strings.ToLower(entry.Message)) {
			word := strings.Trim(raw, ".,;:!?\"'()[]{}")
			if len([]rune(word)) < 3 {
				continue
			}
			if _, exists := seen[word]; exists {
				continue
			}
			seen[word] = struct{}{}
			pool = append(pool, word)
			if len(pool) >= maxItems {
				return pool
			}
		}
	}
	return pool
}

func buildSocialRelationshipsSnapshot(rt *botRuntime, observed []botObservedPlayer) botSocialRelationships {
	result := botSocialRelationships{
		Rivals:   []string{},
		Friendly: []string{},
		Neutral:  []string{},
		Notes:    map[string]string{},
	}
	if rt == nil {
		return result
	}

	observedSet := make(map[string]struct{}, len(observed))
	for _, p := range observed {
		observedSet[p.ID] = struct{}{}
	}

	for name, rel := range rt.relationships {
		n := strings.TrimSpace(name)
		if n == "" {
			continue
		}
		status := strings.ToLower(strings.TrimSpace(rel.Status))
		switch status {
		case "rival", "nemesis":
			result.Rivals = append(result.Rivals, n)
		case "friendly":
			result.Friendly = append(result.Friendly, n)
		default:
			result.Neutral = append(result.Neutral, n)
		}
		if strings.TrimSpace(rel.Reason) != "" {
			result.Notes[n] = strings.TrimSpace(rel.Reason)
		}
		delete(observedSet, n)
	}
	for name := range observedSet {
		result.Neutral = append(result.Neutral, name)
	}
	sort.Strings(result.Rivals)
	sort.Strings(result.Friendly)
	sort.Strings(result.Neutral)
	return result
}

func currentSocialTick() int {
	globalBotSocialChatLogMu.RLock()
	tick := globalBotSocialTick
	globalBotSocialChatLogMu.RUnlock()
	return tick
}

func ResetBotSocialMatchData() {
	globalBotChatHistoryMu.Lock()
	globalBotChatHistory = nil
	globalBotChatHistoryMu.Unlock()

	globalBotSocialChatLogMu.Lock()
	globalBotSocialChatLog = nil
	globalBotSocialTick = 0
	globalBotFastestElimination = nil
	globalRecentHumanChatPulses = nil
	globalBotSocialChatLogMu.Unlock()
}

func RecordBotObservedElimination(killer *Player, target *Player) {
	if target == nil {
		return
	}
	attackerName := "unknown"
	method := "unknown"
	if killer != nil {
		attackerName = strings.TrimSpace(getPlayerName(killer))
		if attackerName == "" {
			attackerName = fmt.Sprintf("player_%d", killer.ID)
		}
		if killer.Base != nil {
			layout := deriveLayoutStyle(summarizeBotBuildings(killer.Base))
			switch layout {
			case "externatk":
				method = "externatk_rush"
			case "defend":
				method = "defend_scale"
			default:
				method = "hybrid_push"
			}
		}
	}
	targetName := strings.TrimSpace(getPlayerName(target))
	if targetName == "" {
		targetName = fmt.Sprintf("player_%d", target.ID)
	}
	if target.IsBot {
		rank := 0
		if rankMap := buildLeaderboardRankMap(); len(rankMap) > 0 {
			rank = rankMap[target.ID]
		}
		ticksSurvived := int(time.Since(target.StartTime).Seconds())
		kills := int(target.GetKills())
		mapControl := estimateMapControl(target)
		gold := float64(readCurrentPower(target))
		strategy := "hybrid"
		if target.Base != nil {
			strategy = deriveLayoutStyle(summarizeBotBuildings(target.Base))
		}
		botID := strings.TrimSpace(targetName)
		if rt := getActiveBotRuntime(target.ID); rt != nil {
			if id := strings.TrimSpace(rt.identity.ID); id != "" {
				botID = id
			}
		}
		_ = insertBotMatchResult(botID, "loss", rank, ticksSurvived, kills, mapControl, gold, strategy, attackerName)
	}

	tick := currentSocialTick()
	globalBotSocialChatLogMu.Lock()
	defer globalBotSocialChatLogMu.Unlock()
	if globalBotFastestElimination == nil || tick < globalBotFastestElimination.Tick {
		globalBotFastestElimination = &botSocialFastestElimination{
			Attacker: attackerName,
			Target:   targetName,
			Tick:     tick,
			Method:   method,
		}
	}
}

func applyBotSocialDecision(rt *botRuntime, observation string, vocabulary []string, update *botRelationshipUpdate) {
	if rt == nil {
		return
	}
	obs := strings.TrimSpace(observation)
	if obs != "" {
		rt.lastSocialObservation = obs
	}

	absorptionRate := botChatAbsorptionRate(rt.identity.ID)
	maxLen := botChatMaxPhraseLen(rt.identity.ID)
	if len(vocabulary) > 0 && absorptionRate > 0 {
		seen := make(map[string]struct{}, len(rt.absorbedVocabulary))
		for _, existing := range rt.absorbedVocabulary {
			seen[strings.TrimSpace(strings.ToLower(existing))] = struct{}{}
		}
		for _, raw := range vocabulary {
			if len([]rune(raw)) > maxLen {
				continue
			}
			if rand.Float64() > absorptionRate {
				continue
			}
			word := strings.TrimSpace(strings.ToLower(raw))
			word = strings.Trim(word, ".,;:!?\"'()[]{}")
			if len([]rune(word)) < 3 {
				continue
			}
			_ = upsertBotVocab(rt.identity.ID, word)
			if _, ok := seen[word]; ok {
				continue
			}
			seen[word] = struct{}{}
			rt.absorbedVocabulary = append(rt.absorbedVocabulary, word)
			if len(rt.absorbedVocabulary) > 60 {
				rt.absorbedVocabulary = rt.absorbedVocabulary[len(rt.absorbedVocabulary)-60:]
			}
		}
	}

	if update != nil {
		name := strings.TrimSpace(update.PlayerID)
		status := strings.ToLower(strings.TrimSpace(update.NewStatus))
		if name != "" && (status == "rival" || status == "nemesis" || status == "friendly" || status == "neutral") {
			setBotRelationship(rt, name, status, update.Reason)
		}
	}
	saveBotPersistentSocialState(rt)
}

func setBotRelationship(rt *botRuntime, playerName, status, reason string) {
	if rt == nil {
		return
	}
	name := strings.TrimSpace(playerName)
	normalizedStatus := strings.ToLower(strings.TrimSpace(status))
	if name == "" || normalizedStatus == "" {
		return
	}
	if rt.relationships == nil {
		rt.relationships = make(map[string]botRelationshipState)
	}
	rt.relationships[name] = botRelationshipState{
		Status: normalizedStatus,
		Reason: strings.TrimSpace(reason),
	}
	_ = upsertBotRelationship(rt.identity.ID, name, normalizedStatus, reason)
}

func botChatAbsorptionRate(identityID string) float64 {
	if f, ok := ChatFilters[identityID]; ok {
		return f.AbsorptionRate
	}
	return 0.30
}

func botChatMaxPhraseLen(identityID string) int {
	switch identityID {
	case "bot_01":
		return 20
	case "bot_02":
		return 15
	case "bot_03":
		return 50
	case "bot_04":
		return 25
	case "bot_05":
		return 30
	case "bot_06":
		return 8
	case "bot_07":
		return 40
	case "bot_08":
		return 30
	case "bot_09":
		return 60
	case "bot_10":
		return 0
	default:
		return 20
	}
}

func injectAbsorbedVocab(text string, rt *botRuntime) string {
	if rt == nil || len(rt.absorbedVocabulary) == 0 {
		return text
	}
	if rand.Float64() > 0.25 {
		return text
	}
	if rt.identity.ID == "bot_10" {
		return text
	}
	if rt.identity.ID == "bot_06" && rand.Float64() > 0.05 {
		return text
	}

	word := rt.absorbedVocabulary[rand.Intn(len(rt.absorbedVocabulary))]
	switch rt.identity.ID {
	case "bot_01":
		candidate := sanitizeBotChat(text + " " + word)
		if len([]rune(candidate)) <= 58 {
			return candidate
		}
	case "bot_02":
		candidate := sanitizeBotChat(text + ". " + word + ": registrado.")
		if len([]rune(candidate)) <= 58 {
			return candidate
		}
	case "bot_05":
		words := strings.Fields(text)
		if len(words) > 2 {
			mid := rand.Intn(len(words))
			words = append(words[:mid], append([]string{word}, words[mid:]...)...)
			candidate := sanitizeBotChat(strings.Join(words, " "))
			if len([]rune(candidate)) <= 58 {
				return candidate
			}
		}
	case "bot_07":
		candidate := sanitizeBotChat(word + "! " + text)
		if len([]rune(candidate)) <= 58 {
			return candidate
		}
	case "bot_09":
		candidate := sanitizeBotChat(text + " " + word + " kk")
		if len([]rune(candidate)) <= 58 {
			return candidate
		}
	default:
		candidate := sanitizeBotChat(text + " " + word)
		if len([]rune(candidate)) <= 58 {
			return candidate
		}
	}
	return text
}

func maybeUseLearndPhrase(rt *botRuntime, langPT bool) string {
	_ = langPT
	if rt == nil || len(rt.absorbedVocabulary) == 0 {
		return ""
	}
	if rand.Float64() > 0.30 {
		return ""
	}
	if rt.identity.SilentChat || rt.identity.ID == "bot_10" {
		return ""
	}
	if len(rt.absorbedVocabulary) < 5 {
		return ""
	}

	maxWords := 3
	if len(rt.absorbedVocabulary) < 3 {
		maxWords = len(rt.absorbedVocabulary)
	}
	count := 2 + rand.Intn(maxWords-1)
	if count > len(rt.absorbedVocabulary) {
		count = len(rt.absorbedVocabulary)
	}

	perm := rand.Perm(len(rt.absorbedVocabulary))
	words := make([]string, 0, count)
	for i := 0; i < count; i++ {
		words = append(words, rt.absorbedVocabulary[perm[i]])
	}

	var phrase string
	switch rt.identity.ID {
	case "bot_01":
		phrase = strings.Join(words, " ") + " kk"
	case "bot_02":
		phrase = strings.Join(words, " + ") + "."
	case "bot_09":
		phrase = strings.ToUpper(strings.Join(words, " ")) + "!!!"
		if len([]rune(phrase)) > 58 {
			phrase = strings.Join(words, " ") + "!"
		}
	case "bot_05":
		rand.Shuffle(len(words), func(i, j int) {
			words[i], words[j] = words[j], words[i]
		})
		phrase = strings.Join(words, ". ")
	default:
		phrase = strings.Join(words, " ")
	}

	result := sanitizeBotChat(phrase)
	if len([]rune(result)) < 3 || len([]rune(result)) > 58 {
		return ""
	}
	return result
}

func recentBotChatContext(rt *botRuntime, maxItems int) string {
	if rt == nil || len(rt.chatHistory) == 0 || maxItems <= 0 {
		return ""
	}
	start := len(rt.chatHistory) - maxItems
	if start < 0 {
		start = 0
	}
	recent := rt.chatHistory[start:]
	return strings.Join(recent, " || ")
}

func recentGlobalChatContextForBot(player *Player, maxItems int) string {
	if player == nil || maxItems <= 0 {
		return ""
	}

	playerName := strings.TrimSpace(getPlayerName(player))
	playerHandle := ""
	if playerName != "" {
		playerHandle = "@" + strings.ToLower(strings.ReplaceAll(playerName, " ", ""))
	}

	globalBotChatHistoryMu.Lock()
	if len(globalBotChatHistory) == 0 {
		globalBotChatHistoryMu.Unlock()
		return ""
	}
	history := make([]string, len(globalBotChatHistory))
	copy(history, globalBotChatHistory)
	globalBotChatHistoryMu.Unlock()

	priority := make([]string, 0, maxItems)
	regular := make([]string, 0, maxItems)
	for i := len(history) - 1; i >= 0; i-- {
		line := strings.TrimSpace(history[i])
		if line == "" {
			continue
		}
		normalized := strings.ToLower(line)
		if playerHandle != "" && strings.Contains(normalized, playerHandle) {
			priority = append(priority, line)
			continue
		}
		regular = append(regular, line)
	}

	out := make([]string, 0, maxItems)
	for _, line := range priority {
		out = append(out, line)
		if len(out) >= maxItems {
			break
		}
	}
	if len(out) < maxItems {
		for _, line := range regular {
			out = append(out, line)
			if len(out) >= maxItems {
				break
			}
		}
	}
	if len(out) == 0 {
		return ""
	}

	// out is newest->oldest; invert for natural reading order.
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return strings.Join(out, " || ")
}

func visiblePlayersContext(player *Player, maxItems int, radius float32) string {
	if player == nil || player.Base == nil || maxItems <= 0 || radius <= 0 {
		return "none"
	}

	type visibleSnapshot struct {
		name    string
		dist    float64
		isBot   bool
		units   int
		hpPct   int
		damaged bool
	}

	selfPos := IntToFloat(player.Base.GetPosition())
	snaps := make([]visibleSnapshot, 0, 8)

	State.RLock()
	for _, other := range State.Players {
		if other == nil || other.ID == player.ID || other.IsMarkedForRemoval() || other.Base == nil {
			continue
		}

		otherPos := IntToFloat(other.Base.GetPosition())
		dist := selfPos.DistanceTo(otherPos)
		if dist > radius {
			continue
		}

		otherName := strings.TrimSpace(getPlayerName(other))
		if otherName == "" {
			otherName = "unknown"
		}

		other.RLock()
		unitCount := len(other.Units)
		other.RUnlock()

		hpPct := 100
		other.Base.Health.RLock()
		if other.Base.Health.Max > 0 {
			hpPct = int((float64(other.Base.Health.Current) / float64(other.Base.Health.Max)) * 100)
		}
		other.Base.Health.RUnlock()
		if hpPct < 0 {
			hpPct = 0
		}
		if hpPct > 100 {
			hpPct = 100
		}

		snaps = append(snaps, visibleSnapshot{
			name:    otherName,
			dist:    float64(dist),
			isBot:   other.IsBot,
			units:   unitCount,
			hpPct:   hpPct,
			damaged: other.WasBaseDamagedWithin(20 * time.Second),
		})
	}
	State.RUnlock()

	if len(snaps) == 0 {
		return "none"
	}

	sort.Slice(snaps, func(i, j int) bool {
		return snaps[i].dist < snaps[j].dist
	})
	if len(snaps) > maxItems {
		snaps = snaps[:maxItems]
	}

	parts := make([]string, 0, len(snaps))
	for _, snap := range snaps {
		kind := "human"
		if snap.isBot {
			kind = "bot"
		}
		status := "stable"
		if snap.damaged {
			status = "under_fire"
		}
		parts = append(parts, fmt.Sprintf("%s(%s d=%dm hp=%d%% u=%d %s)", snap.name, kind, int(snap.dist), snap.hpPct, snap.units, status))
	}
	return strings.Join(parts, " | ")
}

func readUnitCount(player *Player) int {
	if player == nil {
		return 0
	}
	player.RLock()
	defer player.RUnlock()
	return len(player.Units)
}

func isRecentChatDuplicate(rt *botRuntime, text string) bool {
	if rt == nil {
		return false
	}
	target := normalizeChatForCompare(text)
	if target == "" {
		return true
	}
	for _, prev := range rt.chatHistory {
		if isChatSimilarNormalized(target, normalizeChatForCompare(prev)) {
			return true
		}
	}
	return isChatSimilarNormalized(target, normalizeChatForCompare(rt.lastChatText))
}

func normalizeChatForCompare(text string) string {
	text = strings.ToLower(strings.TrimSpace(text))
	text = strings.TrimRight(text, ".!? ")
	text = strings.ReplaceAll(text, "...", "")
	text = strings.ReplaceAll(text, ",", " ")
	text = strings.ReplaceAll(text, ";", " ")
	return text
}

func isChatSimilarNormalized(a string, b string) bool {
	if a == "" || b == "" {
		return false
	}
	if a == b {
		return true
	}
	aWords := strings.Fields(a)
	bWords := strings.Fields(b)
	if len(aWords) == 0 || len(bWords) == 0 {
		return false
	}
	setA := make(map[string]struct{}, len(aWords))
	for _, w := range aWords {
		setA[w] = struct{}{}
	}
	inter := 0
	for _, w := range bWords {
		if _, ok := setA[w]; ok {
			inter++
		}
	}
	smaller := len(aWords)
	if len(bWords) < smaller {
		smaller = len(bWords)
	}
	if smaller <= 2 {
		return inter == smaller
	}
	return float64(inter)/float64(smaller) >= 0.74
}

func mentionFromEnemy(enemy string) string {
	enemy = strings.TrimSpace(enemy)
	if enemy == "" || strings.EqualFold(enemy, "none") || strings.EqualFold(enemy, "mid") {
		return "@mid"
	}

	normalized := make([]rune, 0, len(enemy))
	for _, r := range enemy {
		isAlpha := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
		isNum := r >= '0' && r <= '9'
		if isAlpha || isNum || r == '_' {
			normalized = append(normalized, r)
		}
	}
	if len(normalized) == 0 {
		return "@mid"
	}
	if len(normalized) > 10 {
		normalized = normalized[:10]
	}
	return "@" + strings.ToLower(string(normalized))
}

func normalizeAngle(a float64) float64 {
	for a < -math.Pi {
		a += 2 * math.Pi
	}
	for a > math.Pi {
		a -= 2 * math.Pi
	}
	return a
}

func randomDuration(min, max time.Duration) time.Duration {
	if max <= min {
		return min
	}
	delta := max - min
	return min + time.Duration(rand.Int63n(int64(delta)))
}
