package game

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"math/rand"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
)

type ChatMemory struct {
	LearnedPhrases      map[string][]LearnedPhrase
	LearnedWords        []string
	LearnedComebacks    []string
	LearnedCelebrations []string
	RecentlySaid        []string
	LastChatTick        int
	PhraseCounts        map[string]int
	mu                  sync.Mutex
}

type LearnedPhrase struct {
	Text          string
	Context       string
	TimesHeard    int
	TimesUsed     int
	LastHeardTick int
	FromPlayer    string
	Sentiment     string
}

func newEmptyChatMemory() *ChatMemory {
	return &ChatMemory{
		LearnedPhrases:      make(map[string][]LearnedPhrase),
		LearnedWords:        []string{},
		LearnedComebacks:    []string{},
		LearnedCelebrations: []string{},
		RecentlySaid:        make([]string, 0, 20),
		PhraseCounts:        make(map[string]int),
	}
}

func NewChatMemory(botID string) *ChatMemory {
	mem, err := loadChatMemoryFromDB(botID)
	if err == nil && mem != nil {
		return mem
	}
	if err != nil {
		if errors.Is(err, errBotDBUnavailable) {
			logBotDBUnavailable("loadChatMemoryFromDB")
		} else {
			log.Printf("chat memory db load failed for %s: %v", strings.TrimSpace(botID), err)
		}
	}
	return newEmptyChatMemory()
}

type ChatPersonalityFilter struct {
	AbsorptionRate  float64
	LikesAggressive bool
	LikesFriendly   bool
	LikesNeutral    bool
	LikesFunny      bool
	MaxPhraseLength int
	UsageRate       float64
	AdaptsPhrase    bool
	UsageDelay      int
}

var ChatFilters = map[string]ChatPersonalityFilter{
	"bot_01": {AbsorptionRate: 0.25, LikesAggressive: true, LikesFriendly: false, LikesNeutral: false, LikesFunny: true, MaxPhraseLength: 20, UsageRate: 0.20, AdaptsPhrase: true, UsageDelay: 5},
	"bot_02": {AbsorptionRate: 0.15, LikesAggressive: false, LikesFriendly: false, LikesNeutral: true, LikesFunny: false, MaxPhraseLength: 15, UsageRate: 0.10, AdaptsPhrase: true, UsageDelay: 10},
	"bot_03": {AbsorptionRate: 0.85, LikesAggressive: true, LikesFriendly: true, LikesNeutral: true, LikesFunny: true, MaxPhraseLength: 50, UsageRate: 0.25, AdaptsPhrase: false, UsageDelay: 3},
	"bot_04": {AbsorptionRate: 0.20, LikesAggressive: false, LikesFriendly: true, LikesNeutral: true, LikesFunny: false, MaxPhraseLength: 25, UsageRate: 0.15, AdaptsPhrase: true, UsageDelay: 15},
	"bot_05": {AbsorptionRate: 0.60, LikesAggressive: true, LikesFriendly: true, LikesNeutral: true, LikesFunny: true, MaxPhraseLength: 30, UsageRate: 0.28, AdaptsPhrase: true, UsageDelay: 2},
	"bot_06": {AbsorptionRate: 0.02, LikesAggressive: false, LikesFriendly: false, LikesNeutral: true, LikesFunny: false, MaxPhraseLength: 8, UsageRate: 0.04, AdaptsPhrase: false, UsageDelay: 30},
	"bot_07": {AbsorptionRate: 0.70, LikesAggressive: false, LikesFriendly: true, LikesNeutral: true, LikesFunny: false, MaxPhraseLength: 40, UsageRate: 0.32, AdaptsPhrase: false, UsageDelay: 8},
	"bot_08": {AbsorptionRate: 0.35, LikesAggressive: false, LikesFriendly: false, LikesNeutral: true, LikesFunny: false, MaxPhraseLength: 30, UsageRate: 0.20, AdaptsPhrase: true, UsageDelay: 5},
	"bot_09": {AbsorptionRate: 0.95, LikesAggressive: true, LikesFriendly: true, LikesNeutral: true, LikesFunny: true, MaxPhraseLength: 60, UsageRate: 0.38, AdaptsPhrase: false, UsageDelay: 1},
	"bot_10": {AbsorptionRate: 0.00, LikesAggressive: false, LikesFriendly: false, LikesNeutral: false, LikesFunny: false, MaxPhraseLength: 0, UsageRate: 0.00, AdaptsPhrase: false, UsageDelay: 999999},
}

func AnalyzeMessage(msg string) (context string, sentiment string) {
	lower := strings.ToLower(msg)
	context = "idle"
	for _, w := range []string{"attack", "atack", "ataque", "indo", "chega", "corre", "acabou", "rush"} {
		if strings.Contains(lower, w) {
			context = "attack"
			break
		}
	}
	for _, w := range []string{"gg", "ggez", "eliminado", "morreu", "tchau", "bye", "facil", "ez"} {
		if strings.Contains(lower, w) {
			context = "kill"
			break
		}
	}
	for _, w := range []string{"cuidado", "defend", "defende", "ajuda", "flanc", "norte", "sul", "leste", "oeste"} {
		if strings.Contains(lower, w) {
			context = "defend"
			break
		}
	}
	for _, w := range []string{"kk", "haha", "lol", "noob", "fraco", "ruim", "pessimo", "nem"} {
		if strings.Contains(lower, w) {
			context = "taunt"
			break
		}
	}

	for _, w := range []string{"kkkk", "kkk", "hahaha", "lol", "ksks", "hauha"} {
		if strings.Contains(lower, w) {
			return context, "funny"
		}
	}
	for _, w := range []string{"noob", "ruim", "fraco", "lixo", "pessimo", "ggez", "ez", "sem chance"} {
		if strings.Contains(lower, w) {
			return context, "aggressive"
		}
	}
	for _, w := range []string{"boa", "bom", "otimo", "parabens", "bem jogado", "incrivel", "show"} {
		if strings.Contains(lower, w) {
			return context, "friendly"
		}
	}
	return context, "neutral"
}

func isMapTerm(msg string) bool {
	lower := strings.ToLower(msg)
	for _, t := range []string{"norte", "sul", "leste", "oeste", "flanco", "flanc", "mapa", "setor", "territorio", "expan"} {
		if strings.Contains(lower, t) {
			return true
		}
	}
	return false
}

func isTechnical(msg string) bool {
	lower := strings.ToLower(msg)
	for _, t := range []string{"autogen", "barracks", "turret", "wall", "timing", "tick", "rush", "eco", "build", "base", "hp", "recurso"} {
		if strings.Contains(lower, t) {
			return true
		}
	}
	return false
}

func cleanMessage(msg string) string {
	var cleaned strings.Builder
	for _, r := range msg {
		if unicode.IsPrint(r) {
			cleaned.WriteRune(r)
		}
	}
	result := strings.TrimSpace(cleaned.String())
	if len(result) > 60 {
		result = result[:60]
	}
	return result
}

func (cm *ChatMemory) ObserveChatFeed(feed []ChatEntry, botID string, currentTick int) {
	filter, ok := ChatFilters[botID]
	if !ok || filter.AbsorptionRate == 0 {
		return
	}
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))

	cm.mu.Lock()
	defer cm.mu.Unlock()

	for _, entry := range feed {
		if !entry.IsHuman {
			continue
		}
		msg := cleanMessage(entry.Message)
		if len(msg) == 0 || (filter.MaxPhraseLength > 0 && len(msg) > filter.MaxPhraseLength) {
			continue
		}
		if rng.Float64() > filter.AbsorptionRate {
			continue
		}
		context, sentiment := AnalyzeMessage(msg)
		switch sentiment {
		case "aggressive":
			if !filter.LikesAggressive {
				continue
			}
		case "friendly":
			if !filter.LikesFriendly {
				continue
			}
		case "funny":
			if !filter.LikesFunny {
				continue
			}
		case "neutral":
			if !filter.LikesNeutral {
				continue
			}
		}
		if botID == "bot_08" && !isMapTerm(msg) {
			continue
		}
		if botID == "bot_02" && !isTechnical(msg) {
			continue
		}

		found := false
		for i := range cm.LearnedPhrases[context] {
			if strings.EqualFold(cm.LearnedPhrases[context][i].Text, msg) {
				cm.LearnedPhrases[context][i].TimesHeard++
				cm.LearnedPhrases[context][i].LastHeardTick = currentTick
				found = true
				break
			}
		}
		if !found {
			cm.LearnedPhrases[context] = append(cm.LearnedPhrases[context], LearnedPhrase{
				Text:          msg,
				Context:       context,
				TimesHeard:    1,
				TimesUsed:     0,
				LastHeardTick: currentTick,
				FromPlayer:    entry.PlayerName,
				Sentiment:     sentiment,
			})
			cm.absorbWords(botID, msg)
			if len(cm.LearnedPhrases[context]) > 200 {
				cm.prunePhrases(context)
			}
		}
		// Persist every observation so DB times_heard reflects repeated phrases too.
		_ = upsertBotLearnedPhrase(botID, msg, context, sentiment, entry.PlayerName)
		cm.PhraseCounts[msg]++
	}
}

func (cm *ChatMemory) absorbWords(botID string, msg string) {
	absorbed := make([]string, 0, 6)
	for _, word := range strings.Fields(msg) {
		word = strings.ToLower(strings.Trim(word, ".,!?"))
		if len(word) < 3 || len(word) > 12 {
			continue
		}
		exists := false
		for _, w := range cm.LearnedWords {
			if w == word {
				exists = true
				break
			}
		}
		if !exists {
			cm.LearnedWords = append(cm.LearnedWords, word)
			absorbed = append(absorbed, word)
			if len(cm.LearnedWords) > 100 {
				cm.LearnedWords = cm.LearnedWords[1:]
			}
		}
	}
	if len(absorbed) > 0 {
		_ = upsertBotVocabBatch(botID, absorbed)
	}
}

func (cm *ChatMemory) prunePhrases(context string) {
	phrases := cm.LearnedPhrases[context]
	if len(phrases) <= 150 {
		return
	}
	minIdx := 0
	minScore := phrases[0].TimesHeard + phrases[0].TimesUsed*2
	for i := 1; i < len(phrases); i++ {
		score := phrases[i].TimesHeard + phrases[i].TimesUsed*2
		if score < minScore {
			minScore = score
			minIdx = i
		}
	}
	cm.LearnedPhrases[context] = append(phrases[:minIdx], phrases[minIdx+1:]...)
}

func (cm *ChatMemory) GenerateChatMessage(botID string, gameContext string, currentTick int, nemesisName string, targetName string) string {
	filter, ok := ChatFilters[botID]
	if !ok || filter.UsageRate == 0 || botID == "bot_10" {
		return ""
	}

	cm.mu.Lock()
	defer cm.mu.Unlock()

	minCooldown := 12
	if filter.UsageDelay > minCooldown {
		minCooldown = filter.UsageDelay
	}
	if currentTick-cm.LastChatTick < minCooldown {
		return ""
	}

	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	if rng.Float64() > filter.UsageRate {
		return ""
	}

	msg := ""
	if rng.Float64() < 0.7 {
		msg = cm.selectLearnedPhrase(botID, gameContext, currentTick, rng)
	}
	if msg == "" {
		msg = cm.selectBaseTemplate(botID, gameContext, rng)
	}
	if msg == "" {
		return ""
	}

	msg = cm.adaptToPersonality(botID, msg, nemesisName, targetName, rng)
	if cm.saidRecently(msg) {
		alt := cm.selectLearnedPhrase(botID, gameContext, currentTick, rng)
		if alt == "" || cm.saidRecently(alt) {
			return ""
		}
		msg = alt
	}
	msg = cleanMessage(msg)
	if msg == "" {
		return ""
	}

	cm.LastChatTick = currentTick
	cm.RecentlySaid = append(cm.RecentlySaid, msg)
	if len(cm.RecentlySaid) > 20 {
		cm.RecentlySaid = cm.RecentlySaid[1:]
	}
	return msg
}

func (cm *ChatMemory) selectLearnedPhrase(botID, context string, currentTick int, rng *rand.Rand) string {
	phrases := cm.LearnedPhrases[context]
	if len(phrases) == 0 {
		phrases = cm.LearnedPhrases["idle"]
		if len(phrases) == 0 {
			return ""
		}
	}
	filter := ChatFilters[botID]
	minTimesHeard := 2
	if botID == "bot_09" {
		minTimesHeard = 1
	} else if botID == "bot_04" {
		minTimesHeard = 3
	}

	candidates := make([]LearnedPhrase, 0, len(phrases))
	for _, p := range phrases {
		if p.TimesHeard < minTimesHeard {
			continue
		}
		if currentTick-p.LastHeardTick < filter.UsageDelay {
			continue
		}
		candidates = append(candidates, p)
	}
	if len(candidates) == 0 {
		return ""
	}

	total := 0.0
	weights := make([]float64, len(candidates))
	for i, p := range candidates {
		w := float64(p.TimesHeard)*2 + 3.0/(float64(p.TimesUsed)+1.0)
		weights[i] = w
		total += w
	}
	r := rng.Float64() * total
	cumulative := 0.0
	selected := 0
	for i, w := range weights {
		cumulative += w
		if r <= cumulative {
			selected = i
			break
		}
	}

	for i := range cm.LearnedPhrases[context] {
		if cm.LearnedPhrases[context][i].Text == candidates[selected].Text {
			cm.LearnedPhrases[context][i].TimesUsed++
			break
		}
	}
	return candidates[selected].Text
}

var baseTemplates = map[string]map[string][]string{
	"bot_01": {"attack": {"to indo", "ja era", "sem chance"}, "kill": {"GGEZ", "facil", "proximo"}, "taunt": {"nem defende", "base fraca"}, "defend": {"isso tudo?"}, "idle": {"..."}},
	"bot_02": {"attack": {"iniciando pressao.", "janela identificada."}, "kill": {"eliminacao concluida.", "eficiente."}, "taunt": {"ineficiente."}, "defend": {"dano irrelevante."}, "idle": {"analisando."}},
	"bot_03": {"attack": {"mudando de plano", "interessante"}, "kill": {"boa partida"}, "taunt": {"timing estranho ai"}, "defend": {"hmm"}, "idle": {"observando"}},
	"bot_04": {"attack": {"hora de encerrar"}, "kill": {"bem jogado"}, "taunt": {"autogen primeiro. sempre."}, "defend": {"vi isso vir"}, "idle": {"..."}},
	"bot_05": {"attack": {"o mapa sabe", "sim. nao. ataque."}, "kill": {"processo concluido. talvez."}, "taunt": {"erro 404"}, "defend": {"parametro inesperado"}, "idle": {"calculando..."}},
	"bot_06": {"kill": {"ok."}, "defend": {"..."}},
	"bot_07": {"attack": {"boa sorte a todos!"}, "kill": {"foi mal, era necessario"}, "taunt": {"que base linda"}, "defend": {"impressionante!"}, "idle": {"adorando essa partida"}},
	"bot_08": {"attack": {"circundando agora"}, "kill": {"setor eliminado"}, "taunt": {"norte ta aberto"}, "defend": {"flanco comprometido"}, "idle": {"controlando mapa"}},
	"bot_09": {"attack": {"VAMOS!!!", "hora h!"}, "kill": {"GANHEI!!!", "to melhorando!"}, "taunt": {"como fez isso?"}, "defend": {"que foi isso kkkk"}, "idle": {"to aprendendo ainda"}},
}

func (cm *ChatMemory) selectBaseTemplate(botID, context string, rng *rand.Rand) string {
	templates := baseTemplates[botID]
	if len(templates) == 0 {
		return ""
	}
	msgs := templates[context]
	if len(msgs) == 0 {
		return ""
	}
	return msgs[rng.Intn(len(msgs))]
}

func (cm *ChatMemory) adaptToPersonality(botID, msg, nemesisName, targetName string, rng *rand.Rand) string {
	filter := ChatFilters[botID]
	if !filter.AdaptsPhrase {
		return msg
	}
	lower := strings.ToLower(msg)
	switch botID {
	case "bot_01":
		if !strings.Contains(lower, "k") && rng.Float64() < 0.3 {
			msg += " kk"
		}
		if nemesisName != "" && rng.Float64() < 0.2 {
			msg = nemesisName + " " + msg
		}
	case "bot_02":
		if !strings.HasSuffix(msg, ".") {
			msg += "."
		}
		msg = strings.ReplaceAll(msg, "!", ".")
		msg = strings.ReplaceAll(msg, "kk", "")
		msg = strings.TrimSpace(msg)
	case "bot_04":
		words := strings.Fields(msg)
		if len(words) > 5 {
			msg = strings.Join(words[:5], " ")
		}
	case "bot_05":
		if rng.Float64() < 0.4 {
			words := strings.Fields(msg)
			if len(words) > 2 {
				i := rng.Intn(len(words))
				j := rng.Intn(len(words))
				words[i], words[j] = words[j], words[i]
				msg = strings.Join(words, " ")
			}
		}
	case "bot_07":
		if !strings.Contains(msg, "!") && rng.Float64() < 0.5 {
			msg += "!"
		}
	case "bot_09":
		if rng.Float64() < 0.4 {
			msg += " kk"
		} else if rng.Float64() < 0.3 {
			msg = strings.ToUpper(msg)
		}
	}
	if targetName != "" && strings.Contains(strings.ToLower(msg), "indo") && rng.Float64() < 0.15 {
		msg = msg + " " + targetName
	}
	if len(msg) > 60 {
		msg = msg[:60]
	}
	return msg
}

func (cm *ChatMemory) saidRecently(msg string) bool {
	for _, said := range cm.RecentlySaid {
		if strings.EqualFold(said, msg) || similarity(said, msg) > 0.8 {
			return true
		}
	}
	return false
}

func similarity(a, b string) float64 {
	if a == b {
		return 1.0
	}
	if len(a) == 0 || len(b) == 0 {
		return 0.0
	}
	wordsA := strings.Fields(strings.ToLower(a))
	wordsB := strings.Fields(strings.ToLower(b))
	setA := make(map[string]bool, len(wordsA))
	for _, w := range wordsA {
		setA[w] = true
	}
	intersection := 0
	for _, w := range wordsB {
		if setA[w] {
			intersection++
		}
	}
	union := len(wordsA) + len(wordsB) - intersection
	if union == 0 {
		return 0
	}
	return float64(intersection) / float64(union)
}

type ChatStats struct {
	TotalPhrasesLearned int
	TotalWordsLearned   int
	PhrasesByContext    map[string]int
	MostHeardPhrase     string
	MostUsedPhrase      string
	TopContributors     []string
}

func (cm *ChatMemory) GetStats() ChatStats {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	stats := ChatStats{
		PhrasesByContext: make(map[string]int),
	}
	contributors := make(map[string]int)
	maxHeard := 0
	maxUsed := 0
	for context, phrases := range cm.LearnedPhrases {
		stats.TotalPhrasesLearned += len(phrases)
		stats.PhrasesByContext[context] = len(phrases)
		for _, p := range phrases {
			contributors[p.FromPlayer]++
			if p.TimesHeard > maxHeard {
				maxHeard = p.TimesHeard
				stats.MostHeardPhrase = p.Text
			}
			if p.TimesUsed > maxUsed {
				maxUsed = p.TimesUsed
				stats.MostUsedPhrase = p.Text
			}
		}
	}
	stats.TotalWordsLearned = len(cm.LearnedWords)
	type kv struct {
		k string
		v int
	}
	sorted := make([]kv, 0, len(contributors))
	for k, v := range contributors {
		sorted = append(sorted, kv{k: k, v: v})
	}
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].v > sorted[j].v })
	for i := 0; i < len(sorted) && i < 3; i++ {
		stats.TopContributors = append(stats.TopContributors, sorted[i].k)
	}
	return stats
}

func chatFeedFromSocialEntries(entries []botSocialChatEntry) []ChatEntry {
	out := make([]ChatEntry, 0, len(entries))
	for _, e := range entries {
		out = append(out, ChatEntry{
			PlayerName: e.From,
			Message:    e.Message,
			Tick:       e.Tick,
			IsHuman:    e.IsHuman,
		})
	}
	return out
}

func loadChatMemoryForBot(botID string) *ChatMemory {
	return NewChatMemory(botID)
}

func saveChatMemoryForBot(botID string, mem *ChatMemory) {
	if mem == nil {
		return
	}
	botID = strings.TrimSpace(botID)
	if botID == "" {
		return
	}

	mem.mu.Lock()
	words := append([]string(nil), mem.LearnedWords...)
	phrases := make([]LearnedPhrase, 0, 128)
	for context, items := range mem.LearnedPhrases {
		for _, p := range items {
			clone := p
			if strings.TrimSpace(clone.Context) == "" {
				clone.Context = context
			}
			phrases = append(phrases, clone)
		}
	}
	mem.mu.Unlock()

	_ = upsertBotVocabBatch(botID, words)
	for _, phrase := range phrases {
		text := strings.TrimSpace(phrase.Text)
		if text == "" {
			continue
		}
		contextName := strings.TrimSpace(strings.ToLower(phrase.Context))
		if contextName == "" {
			contextName = "idle"
		}
		_ = upsertBotLearnedPhraseSnapshot(botID, text, contextName, phrase.Sentiment, phrase.FromPlayer, phrase.TimesHeard)
	}
}

func loadChatMemoryFromDB(botID string) (*ChatMemory, error) {
	botID = strings.TrimSpace(botID)
	mem := newEmptyChatMemory()
	if botID == "" {
		return mem, nil
	}
	if botDB == nil {
		return nil, errBotDBUnavailable
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	phraseRows, err := botDB.QueryContext(ctx, `
		SELECT phrase, context, sentiment, from_player, times_heard
		FROM bot_learned_phrases
		WHERE bot_id = $1
		ORDER BY times_heard DESC, phrase ASC
		LIMIT 1200
	`, botID)
	if err != nil {
		return nil, err
	}
	for phraseRows.Next() {
		var phrase string
		var contextName sql.NullString
		var sentiment sql.NullString
		var fromPlayer sql.NullString
		var timesHeard int
		if scanErr := phraseRows.Scan(&phrase, &contextName, &sentiment, &fromPlayer, &timesHeard); scanErr != nil {
			_ = phraseRows.Close()
			return nil, scanErr
		}
		text := strings.TrimSpace(phrase)
		if text == "" {
			continue
		}
		ctxName := strings.TrimSpace(strings.ToLower(contextName.String))
		if ctxName == "" {
			ctxName = "idle"
		}
		lp := LearnedPhrase{
			Text:       text,
			Context:    ctxName,
			TimesHeard: maxInt(1, timesHeard),
			TimesUsed:  0,
		}
		if sentiment.Valid {
			lp.Sentiment = strings.TrimSpace(strings.ToLower(sentiment.String))
		}
		if fromPlayer.Valid {
			lp.FromPlayer = strings.TrimSpace(fromPlayer.String)
		}
		mem.LearnedPhrases[ctxName] = append(mem.LearnedPhrases[ctxName], lp)
		mem.PhraseCounts[text] = lp.TimesHeard
	}
	if err = phraseRows.Err(); err != nil {
		_ = phraseRows.Close()
		return nil, err
	}
	_ = phraseRows.Close()

	vocabRows, err := botDB.QueryContext(ctx, `
		SELECT word
		FROM bot_vocab
		WHERE bot_id = $1
		ORDER BY times_heard DESC, word ASC
		LIMIT 100
	`, botID)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]struct{}, 100)
	for vocabRows.Next() {
		var raw string
		if scanErr := vocabRows.Scan(&raw); scanErr != nil {
			_ = vocabRows.Close()
			return nil, scanErr
		}
		word := strings.TrimSpace(strings.ToLower(raw))
		if word == "" {
			continue
		}
		if _, ok := seen[word]; ok {
			continue
		}
		seen[word] = struct{}{}
		mem.LearnedWords = append(mem.LearnedWords, word)
	}
	if err = vocabRows.Err(); err != nil {
		_ = vocabRows.Close()
		return nil, err
	}
	_ = vocabRows.Close()

	if mem.LearnedPhrases == nil {
		mem.LearnedPhrases = make(map[string][]LearnedPhrase)
	}
	if mem.PhraseCounts == nil {
		mem.PhraseCounts = make(map[string]int)
	}
	if mem.LearnedWords == nil {
		mem.LearnedWords = []string{}
	}
	return mem, nil
}

func SyncAllActiveChatMemoryToDB() {
	activeChatMemoryByPlayerMu.Lock()
	entries := make([]activeChatMemory, 0, len(activeChatMemoryByPlayer))
	for _, entry := range activeChatMemoryByPlayer {
		entries = append(entries, entry)
	}
	activeChatMemoryByPlayerMu.Unlock()
	for _, entry := range entries {
		saveChatMemoryForBot(entry.botIdentityID, entry.mem)
	}
}

type activeChatMemory struct {
	botIdentityID string
	mem           *ChatMemory
}

var (
	activeChatMemoryByPlayer   = make(map[ID]activeChatMemory)
	activeChatMemoryByPlayerMu sync.Mutex
)

func registerActiveChatMemory(playerID ID, botIdentityID string, mem *ChatMemory) {
	if playerID == 0 || mem == nil {
		return
	}
	activeChatMemoryByPlayerMu.Lock()
	activeChatMemoryByPlayer[playerID] = activeChatMemory{
		botIdentityID: strings.TrimSpace(botIdentityID),
		mem:           mem,
	}
	activeChatMemoryByPlayerMu.Unlock()
}

func unregisterActiveChatMemory(playerID ID) {
	if playerID == 0 {
		return
	}
	activeChatMemoryByPlayerMu.Lock()
	entry, ok := activeChatMemoryByPlayer[playerID]
	if ok {
		delete(activeChatMemoryByPlayer, playerID)
	}
	activeChatMemoryByPlayerMu.Unlock()
	if ok {
		saveChatMemoryForBot(entry.botIdentityID, entry.mem)
	}
}
