package game

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	_ "github.com/lib/pq"
)

const botDBTimeout = 5 * time.Second

var (
	botDB               *sql.DB
	errBotDBUnavailable = errors.New("bot db unavailable")
	botDBUnavailableMu  sync.Mutex
	botDBUnavailableOps = make(map[string]bool)
)

func initBotDB() error {
	dsn := firstNonEmptyEnv(
		"SUPABASE_DB_URL",
		"DATABASE_URL",
		"BOT_DB_URL",
		"POSTGRES_URL",
		"PG_DSN",
	)
	if dsn == "" {
		return nil
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), botDBTimeout)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return err
	}
	if err := ensureBotDBSchema(db); err != nil {
		// Keep DB online even when schema migration is partially restricted.
		log.Printf("bot db schema bootstrap warning: %v", err)
	}
	botDB = db
	return nil
}

func firstNonEmptyEnv(keys ...string) string {
	for _, key := range keys {
		value := strings.TrimSpace(os.Getenv(key))
		if value != "" {
			return value
		}
	}
	return ""
}

func ensureBotDBSchema(db *sql.DB) error {
	if db == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), botDBTimeout)
	defer cancel()

	statements := []string{
		`
		CREATE TABLE IF NOT EXISTS public.bot_personality_state (
			bot_id text PRIMARY KEY,
			dynamic_aggression double precision NOT NULL DEFAULT 0.5,
			dynamic_patience double precision NOT NULL DEFAULT 0.5,
			learned_attack_tick integer NOT NULL DEFAULT 200,
			learned_eco_target double precision NOT NULL DEFAULT 3.0,
			win_streak integer NOT NULL DEFAULT 0,
			loss_streak integer NOT NULL DEFAULT 0,
			parties_played integer NOT NULL DEFAULT 0,
			updated_at timestamptz NOT NULL DEFAULT now()
		)
		`,
		`
		CREATE TABLE IF NOT EXISTS public.bot_vocab (
			bot_id text NOT NULL,
			word text NOT NULL,
			times_heard integer NOT NULL DEFAULT 1,
			times_used integer NOT NULL DEFAULT 0,
			absorbed_at timestamptz NOT NULL DEFAULT now(),
			last_used_at timestamptz
		)
		`,
		`
		CREATE TABLE IF NOT EXISTS public.bot_relationships (
			bot_id text NOT NULL,
			player_name text NOT NULL,
			status text NOT NULL DEFAULT 'neutral',
			reason text NOT NULL DEFAULT '',
			updated_at timestamptz NOT NULL DEFAULT now()
		)
		`,
		`
		CREATE TABLE IF NOT EXISTS public.bot_learned_phrases (
			bot_id text NOT NULL,
			phrase text NOT NULL,
			context text NOT NULL DEFAULT 'idle',
			sentiment text NOT NULL DEFAULT 'neutral',
			from_player text NOT NULL DEFAULT '',
			times_heard integer NOT NULL DEFAULT 1,
			times_used integer NOT NULL DEFAULT 0,
			last_heard_at timestamptz NOT NULL DEFAULT now(),
			last_used_at timestamptz,
			updated_at timestamptz NOT NULL DEFAULT now()
		)
		`,
		`
		CREATE TABLE IF NOT EXISTS public.bot_qtable (
			bot_id text PRIMARY KEY,
			episodes integer NOT NULL DEFAULT 0,
			win_rate double precision NOT NULL DEFAULT 0,
			epsilon double precision NOT NULL DEFAULT 1,
			qtable_json jsonb NOT NULL DEFAULT '{}'::jsonb,
			updated_at timestamptz NOT NULL DEFAULT now()
		)
		`,
		`
		CREATE TABLE IF NOT EXISTS public.bot_match_history (
			id bigserial PRIMARY KEY,
			bot_id text NOT NULL,
			result text NOT NULL,
			rank integer NOT NULL DEFAULT 0,
			ticks_survived integer NOT NULL DEFAULT 0,
			kills integer NOT NULL DEFAULT 0,
			map_control double precision NOT NULL DEFAULT 0,
			gold double precision NOT NULL DEFAULT 0,
			strategy text NOT NULL DEFAULT '',
			eliminated_by text NOT NULL DEFAULT '',
			created_at timestamptz NOT NULL DEFAULT now()
		)
		`,
		`
		ALTER TABLE public.bot_vocab
			ADD COLUMN IF NOT EXISTS bot_id text,
			ADD COLUMN IF NOT EXISTS word text,
			ADD COLUMN IF NOT EXISTS times_heard integer NOT NULL DEFAULT 1,
			ADD COLUMN IF NOT EXISTS times_used integer NOT NULL DEFAULT 0,
			ADD COLUMN IF NOT EXISTS absorbed_at timestamptz NOT NULL DEFAULT now(),
			ADD COLUMN IF NOT EXISTS last_used_at timestamptz
		`,
		`
		ALTER TABLE public.bot_relationships
			ADD COLUMN IF NOT EXISTS bot_id text,
			ADD COLUMN IF NOT EXISTS player_name text,
			ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'neutral',
			ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT '',
			ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
		`,
		`
		ALTER TABLE public.bot_learned_phrases
			ADD COLUMN IF NOT EXISTS bot_id text,
			ADD COLUMN IF NOT EXISTS phrase text,
			ADD COLUMN IF NOT EXISTS context text NOT NULL DEFAULT 'idle',
			ADD COLUMN IF NOT EXISTS sentiment text NOT NULL DEFAULT 'neutral',
			ADD COLUMN IF NOT EXISTS from_player text NOT NULL DEFAULT '',
			ADD COLUMN IF NOT EXISTS times_heard integer NOT NULL DEFAULT 1,
			ADD COLUMN IF NOT EXISTS times_used integer NOT NULL DEFAULT 0,
			ADD COLUMN IF NOT EXISTS last_heard_at timestamptz NOT NULL DEFAULT now(),
			ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
			ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
		`,
		`
		ALTER TABLE public.bot_qtable
			ADD COLUMN IF NOT EXISTS bot_id text,
			ADD COLUMN IF NOT EXISTS episodes integer NOT NULL DEFAULT 0,
			ADD COLUMN IF NOT EXISTS win_rate double precision NOT NULL DEFAULT 0,
			ADD COLUMN IF NOT EXISTS epsilon double precision NOT NULL DEFAULT 1,
			ADD COLUMN IF NOT EXISTS qtable_json jsonb NOT NULL DEFAULT '{}'::jsonb,
			ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
		`,
		`
		ALTER TABLE public.bot_match_history
			ADD COLUMN IF NOT EXISTS bot_id text,
			ADD COLUMN IF NOT EXISTS result text,
			ADD COLUMN IF NOT EXISTS rank integer NOT NULL DEFAULT 0,
			ADD COLUMN IF NOT EXISTS ticks_survived integer NOT NULL DEFAULT 0,
			ADD COLUMN IF NOT EXISTS kills integer NOT NULL DEFAULT 0,
			ADD COLUMN IF NOT EXISTS map_control double precision NOT NULL DEFAULT 0,
			ADD COLUMN IF NOT EXISTS gold double precision NOT NULL DEFAULT 0,
			ADD COLUMN IF NOT EXISTS strategy text NOT NULL DEFAULT '',
			ADD COLUMN IF NOT EXISTS eliminated_by text NOT NULL DEFAULT '',
			ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()
		`,
		`
		CREATE UNIQUE INDEX IF NOT EXISTS bot_vocab_bot_word_uq
			ON public.bot_vocab (bot_id, word)
		`,
		`
		CREATE UNIQUE INDEX IF NOT EXISTS bot_relationships_bot_player_uq
			ON public.bot_relationships (bot_id, player_name)
		`,
		`
		CREATE UNIQUE INDEX IF NOT EXISTS bot_learned_phrases_bot_phrase_uq
			ON public.bot_learned_phrases (bot_id, phrase)
		`,
		`
		CREATE UNIQUE INDEX IF NOT EXISTS bot_qtable_bot_id_uq
			ON public.bot_qtable (bot_id)
		`,
	}

	for _, stmt := range statements {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}

	// Best effort: if the role cannot alter RLS we keep running.
	rlsStatements := []string{
		`ALTER TABLE public.bot_personality_state DISABLE ROW LEVEL SECURITY`,
		`ALTER TABLE public.bot_vocab DISABLE ROW LEVEL SECURITY`,
		`ALTER TABLE public.bot_relationships DISABLE ROW LEVEL SECURITY`,
		`ALTER TABLE public.bot_learned_phrases DISABLE ROW LEVEL SECURITY`,
		`ALTER TABLE public.bot_qtable DISABLE ROW LEVEL SECURITY`,
		`ALTER TABLE public.bot_match_history DISABLE ROW LEVEL SECURITY`,
	}
	for _, stmt := range rlsStatements {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			log.Printf("bot db schema warning (disable RLS): %v", err)
		}
	}
	return nil
}

func logBotDBUnavailable(op string) {
	botDBUnavailableMu.Lock()
	if botDBUnavailableOps[op] {
		botDBUnavailableMu.Unlock()
		return
	}
	botDBUnavailableOps[op] = true
	botDBUnavailableMu.Unlock()
	log.Printf("bot db unavailable: skipping %s", op)
}

func runBotDBAsync(op string, fn func(ctx context.Context) error) {
	if botDB == nil {
		logBotDBUnavailable(op)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), botDBTimeout)
	defer cancel()
	if err := fn(ctx); err != nil {
		log.Printf("bot db %s failed: %v", op, err)
	}
}

func upsertBotVocab(botID, word string) error {
	botID = strings.TrimSpace(botID)
	word = strings.TrimSpace(strings.ToLower(word))
	if botID == "" || word == "" {
		return nil
	}
	runBotDBAsync("upsertBotVocab", func(ctx context.Context) error {
		_, err := botDB.ExecContext(ctx, `
			INSERT INTO bot_vocab (bot_id, word)
			VALUES ($1, $2)
			ON CONFLICT (bot_id, word)
			DO UPDATE SET times_heard = bot_vocab.times_heard + 1
		`, botID, word)
		return err
	})
	return nil
}

func upsertBotVocabBatch(botID string, words []string) error {
	botID = strings.TrimSpace(botID)
	if botID == "" || len(words) == 0 {
		return nil
	}

	unique := make([]string, 0, len(words))
	seen := make(map[string]struct{}, len(words))
	for _, raw := range words {
		word := strings.TrimSpace(strings.ToLower(raw))
		if word == "" {
			continue
		}
		if _, ok := seen[word]; ok {
			continue
		}
		seen[word] = struct{}{}
		unique = append(unique, word)
	}
	if len(unique) == 0 {
		return nil
	}

	runBotDBAsync("upsertBotVocabBatch", func(ctx context.Context) error {
		tx, err := botDB.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		stmt, err := tx.PrepareContext(ctx, `
			INSERT INTO bot_vocab (bot_id, word)
			VALUES ($1, $2)
			ON CONFLICT (bot_id, word)
			DO UPDATE SET times_heard = bot_vocab.times_heard + 1
		`)
		if err != nil {
			_ = tx.Rollback()
			return err
		}
		defer stmt.Close()

		for _, word := range unique {
			if _, err := stmt.ExecContext(ctx, botID, word); err != nil {
				_ = tx.Rollback()
				return err
			}
		}
		return tx.Commit()
	})
	return nil
}

func upsertBotRelationship(botID, playerName, status, reason string) error {
	botID = strings.TrimSpace(botID)
	playerName = strings.TrimSpace(playerName)
	status = strings.TrimSpace(strings.ToLower(status))
	reason = strings.TrimSpace(reason)
	if botID == "" || playerName == "" || status == "" {
		return nil
	}
	runBotDBAsync("upsertBotRelationship", func(ctx context.Context) error {
		_, err := botDB.ExecContext(ctx, `
			INSERT INTO bot_relationships (bot_id, player_name, status, reason, updated_at)
			VALUES ($1, $2, $3, $4, now())
			ON CONFLICT (bot_id, player_name)
			DO UPDATE SET status = $3, reason = $4, updated_at = now()
		`, botID, playerName, status, reason)
		return err
	})
	return nil
}

func insertBotMatchResult(botID, result string, rank, ticksSurvived, kills int, mapControl, gold float64, strategy, eliminatedBy string) error {
	botID = strings.TrimSpace(botID)
	result = strings.TrimSpace(strings.ToLower(result))
	strategy = strings.TrimSpace(strategy)
	eliminatedBy = strings.TrimSpace(eliminatedBy)
	if botID == "" || result == "" {
		return nil
	}
	runBotDBAsync("insertBotMatchResult", func(ctx context.Context) error {
		_, err := botDB.ExecContext(ctx, `
			INSERT INTO bot_match_history
				(bot_id, result, rank, ticks_survived, kills, map_control, gold, strategy, eliminated_by)
			VALUES
				($1, $2, $3, $4, $5, $6, $7, $8, $9)
		`, botID, result, rank, ticksSurvived, kills, mapControl, gold, strategy, eliminatedBy)
		return err
	})
	return nil
}

func upsertBotLearnedPhrase(botID, phrase, contextName, sentiment, fromPlayer string) error {
	botID = strings.TrimSpace(botID)
	phrase = strings.TrimSpace(phrase)
	contextName = strings.TrimSpace(strings.ToLower(contextName))
	sentiment = strings.TrimSpace(strings.ToLower(sentiment))
	fromPlayer = strings.TrimSpace(fromPlayer)
	if botID == "" || phrase == "" {
		return nil
	}
	runBotDBAsync("upsertBotLearnedPhrase", func(ctx context.Context) error {
		_, err := botDB.ExecContext(ctx, `
			INSERT INTO bot_learned_phrases
				(bot_id, phrase, context, sentiment, from_player)
			VALUES
				($1, $2, $3, $4, $5)
			ON CONFLICT (bot_id, phrase)
			DO UPDATE SET times_heard = bot_learned_phrases.times_heard + 1
		`, botID, phrase, contextName, sentiment, fromPlayer)
		return err
	})
	return nil
}

func upsertBotLearnedPhraseSnapshot(botID, phrase, contextName, sentiment, fromPlayer string, timesHeard int) error {
	botID = strings.TrimSpace(botID)
	phrase = strings.TrimSpace(phrase)
	contextName = strings.TrimSpace(strings.ToLower(contextName))
	sentiment = strings.TrimSpace(strings.ToLower(sentiment))
	fromPlayer = strings.TrimSpace(fromPlayer)
	if botID == "" || phrase == "" {
		return nil
	}
	if timesHeard < 1 {
		timesHeard = 1
	}
	runBotDBAsync("upsertBotLearnedPhraseSnapshot", func(ctx context.Context) error {
		_, err := botDB.ExecContext(ctx, `
			INSERT INTO bot_learned_phrases
				(bot_id, phrase, context, sentiment, from_player, times_heard)
			VALUES
				($1, $2, $3, $4, $5, $6)
			ON CONFLICT (bot_id, phrase)
			DO UPDATE SET
				context = COALESCE(NULLIF(EXCLUDED.context, ''), bot_learned_phrases.context),
				sentiment = COALESCE(NULLIF(EXCLUDED.sentiment, ''), bot_learned_phrases.sentiment),
				from_player = COALESCE(NULLIF(EXCLUDED.from_player, ''), bot_learned_phrases.from_player),
				times_heard = GREATEST(bot_learned_phrases.times_heard, EXCLUDED.times_heard)
		`, botID, phrase, contextName, sentiment, fromPlayer, timesHeard)
		return err
	})
	return nil
}

func upsertBotQTable(botID string, episodes int, winRate, epsilon float64, qtableJSON []byte) error {
	botID = strings.TrimSpace(botID)
	if botID == "" {
		return nil
	}
	payload := strings.TrimSpace(string(qtableJSON))
	if payload == "" {
		payload = "{}"
	}
	runBotDBAsync("upsertBotQTable", func(ctx context.Context) error {
		_, err := botDB.ExecContext(ctx, `
			INSERT INTO bot_qtable (bot_id, episodes, win_rate, epsilon, qtable_json, updated_at)
			VALUES ($1, $2, $3, $4, $5::jsonb, now())
			ON CONFLICT (bot_id)
			DO UPDATE SET
				episodes = $2,
				win_rate = $3,
				epsilon = $4,
				qtable_json = $5::jsonb,
				updated_at = now()
		`, botID, episodes, winRate, epsilon, payload)
		return err
	})
	return nil
}

func loadBotMemoryFromDB(botID string) (*botPersistentSocialState, error) {
	botID = strings.TrimSpace(botID)
	if botID == "" {
		return &botPersistentSocialState{
			AbsorbedVocabulary: []string{},
			Relationships:      map[string]botRelationshipState{},
		}, nil
	}
	if botDB == nil {
		return nil, errBotDBUnavailable
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	vocabulary := make([]string, 0, 60)
	seenVocab := make(map[string]struct{}, 60)
	vocabRows, err := botDB.QueryContext(ctx, `
		SELECT word
		FROM bot_vocab
		WHERE bot_id = $1
		ORDER BY times_heard DESC, word ASC
		LIMIT 60
	`, botID)
	if err != nil {
		return nil, err
	}
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
		if _, ok := seenVocab[word]; ok {
			continue
		}
		seenVocab[word] = struct{}{}
		vocabulary = append(vocabulary, word)
	}
	if err = vocabRows.Err(); err != nil {
		_ = vocabRows.Close()
		return nil, err
	}
	_ = vocabRows.Close()

	relationships := make(map[string]botRelationshipState)
	relRows, err := botDB.QueryContext(ctx, `
		SELECT player_name, status, reason
		FROM bot_relationships
		WHERE bot_id = $1
	`, botID)
	if err != nil {
		return nil, err
	}
	for relRows.Next() {
		var playerName string
		var status string
		var reason sql.NullString
		if scanErr := relRows.Scan(&playerName, &status, &reason); scanErr != nil {
			_ = relRows.Close()
			return nil, scanErr
		}
		name := strings.TrimSpace(playerName)
		if name == "" {
			continue
		}
		rel := botRelationshipState{
			Status: strings.TrimSpace(strings.ToLower(status)),
		}
		if reason.Valid {
			rel.Reason = strings.TrimSpace(reason.String)
		}
		relationships[name] = rel
	}
	if err = relRows.Err(); err != nil {
		_ = relRows.Close()
		return nil, err
	}
	_ = relRows.Close()

	return &botPersistentSocialState{
		AbsorbedVocabulary: vocabulary,
		Relationships:      relationships,
	}, nil
}

func upsertBotPersonalityState(botID string, brain *BotBrain) error {
	botID = strings.TrimSpace(botID)
	if botID == "" || brain == nil {
		return nil
	}

	brain.mu.Lock()
	dynamicAggression := brain.dynamicAggression
	dynamicPatience := brain.dynamicPatience
	learnedAttackTick := brain.learnedAttackTick
	learnedEcoTarget := brain.learnedEcoTarget
	winStreak := brain.winStreak
	lossStreak := brain.lossStreak
	partiesPlayed := brain.partiesPlayed
	brain.mu.Unlock()

	runBotDBAsync("upsertBotPersonalityState", func(ctx context.Context) error {
		_, err := botDB.ExecContext(ctx, `
			INSERT INTO bot_personality_state (
				bot_id,
				dynamic_aggression,
				dynamic_patience,
				learned_attack_tick,
				learned_eco_target,
				win_streak,
				loss_streak,
				parties_played,
				updated_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
			ON CONFLICT (bot_id)
			DO UPDATE SET
				dynamic_aggression = $2,
				dynamic_patience = $3,
				learned_attack_tick = $4,
				learned_eco_target = $5,
				win_streak = $6,
				loss_streak = $7,
				parties_played = $8,
				updated_at = now()
		`, botID, dynamicAggression, dynamicPatience, learnedAttackTick, learnedEcoTarget, winStreak, lossStreak, partiesPlayed)
		return err
	})
	return nil
}

func loadBotPersonalityState(botID string) (*BotBrain, error) {
	botID = strings.TrimSpace(botID)
	if botID == "" {
		return nil, nil
	}
	if botDB == nil {
		logBotDBUnavailable("loadBotPersonalityState")
		return nil, errBotDBUnavailable
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	loaded := &localBotBrain{}
	err := botDB.QueryRowContext(ctx, `
		SELECT
			dynamic_aggression,
			dynamic_patience,
			learned_attack_tick,
			learned_eco_target,
			win_streak,
			loss_streak,
			parties_played
		FROM bot_personality_state
		WHERE bot_id = $1
	`, botID).Scan(
		&loaded.dynamicAggression,
		&loaded.dynamicPatience,
		&loaded.learnedAttackTick,
		&loaded.learnedEcoTarget,
		&loaded.winStreak,
		&loaded.lossStreak,
		&loaded.partiesPlayed,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return loaded, nil
}
