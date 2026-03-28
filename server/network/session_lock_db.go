package network

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	_ "github.com/lib/pq"
)

const (
	sessionLockDBTimeout      = 4 * time.Second
	sessionLockCleanupEvery   = 2 * time.Minute
	sessionLockDefaultTTLSecs = 90
)

type sessionLockState struct {
	lockKey      string
	sessionToken string
}

var (
	sessionLockDB      *sql.DB
	sessionLockMu      sync.Mutex
	sessionLockByConn  = make(map[*websocket.Conn]sessionLockState)
	sessionLockEnabled = envBoolDefaultTrue("ENABLE_DB_SESSION_LOCK")
	sessionLockTTL     = resolveDBSessionLockTTL()
)

func resolveDBSessionLockTTL() time.Duration {
	raw := strings.TrimSpace(os.Getenv("DB_SESSION_LOCK_TTL_SECONDS"))
	if raw == "" {
		return time.Duration(sessionLockDefaultTTLSecs) * time.Second
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds < 30 {
		return time.Duration(sessionLockDefaultTTLSecs) * time.Second
	}
	if seconds > 600 {
		seconds = 600
	}
	return time.Duration(seconds) * time.Second
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

func initSessionLockStore() {
	if !sessionLockEnabled {
		log.Println("db session lock disabled (ENABLE_DB_SESSION_LOCK=false)")
		return
	}

	dsn := firstNonEmptyEnv(
		"SUPABASE_DB_URL",
		"DATABASE_URL",
		"BOT_DB_URL",
		"POSTGRES_URL",
		"PG_DSN",
	)
	if dsn == "" {
		log.Println("db session lock disabled (missing Postgres DSN env)")
		return
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Printf("db session lock disabled (open failed): %v", err)
		return
	}
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), sessionLockDBTimeout)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		log.Printf("db session lock disabled (ping failed): %v", err)
		return
	}
	if err := ensureSessionLockSchema(db); err != nil {
		_ = db.Close()
		log.Printf("db session lock disabled (schema failed): %v", err)
		return
	}

	sessionLockDB = db
	log.Printf("db session lock enabled (ttl=%s)", sessionLockTTL)
	startSessionLockCleanupLoop()
}

func ensureSessionLockSchema(db *sql.DB) error {
	if db == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), sessionLockDBTimeout)
	defer cancel()

	statements := []string{
		`
		CREATE TABLE IF NOT EXISTS public.active_session_locks (
			lock_key text PRIMARY KEY,
			session_token text NOT NULL,
			progress_user_id text NOT NULL DEFAULT '',
			discord_id text NOT NULL DEFAULT '',
			device_id text NOT NULL DEFAULT '',
			client_ip text NOT NULL DEFAULT '',
			fingerprint bigint NOT NULL DEFAULT 0,
			created_at timestamptz NOT NULL DEFAULT now(),
			updated_at timestamptz NOT NULL DEFAULT now(),
			expires_at timestamptz NOT NULL
		)
		`,
		`
		CREATE INDEX IF NOT EXISTS active_session_locks_expires_idx
		ON public.active_session_locks (expires_at)
		`,
		`
		ALTER TABLE public.active_session_locks
		ADD COLUMN IF NOT EXISTS device_id text NOT NULL DEFAULT ''
		`,
	}
	for _, stmt := range statements {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}

	// Best effort: keep running even when role cannot alter RLS.
	if _, err := db.ExecContext(ctx, `ALTER TABLE public.active_session_locks DISABLE ROW LEVEL SECURITY`); err != nil {
		log.Printf("db session lock schema warning (disable RLS): %v", err)
	}

	return nil
}

func startSessionLockCleanupLoop() {
	if sessionLockDB == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(sessionLockCleanupEvery)
		defer ticker.Stop()
		for range ticker.C {
			ctx, cancel := context.WithTimeout(context.Background(), sessionLockDBTimeout)
			_, err := sessionLockDB.ExecContext(ctx, `DELETE FROM public.active_session_locks WHERE expires_at <= now()`)
			cancel()
			if err != nil {
				log.Printf("db session lock cleanup failed: %v", err)
			}
		}
	}()
}

func normalizeClientIP(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	parts := strings.Split(value, ",")
	value = strings.TrimSpace(parts[0])
	if value == "" {
		return ""
	}

	if host, _, err := net.SplitHostPort(value); err == nil {
		value = host
	}
	value = strings.Trim(value, "[]")
	return strings.TrimSpace(value)
}

func buildSessionLockIdentity(userData UserData, fingerprint uint32) (lockKey, progressID, discordID, deviceID, clientIP string, fingerprint64 int64) {
	progressID = strings.TrimSpace(userData.ProgressUserID())
	discordID = strings.TrimSpace(userData.Discord.ID)
	deviceID = strings.TrimSpace(userData.DeviceID)
	clientIP = normalizeClientIP(userData.ClientIP)
	fingerprint64 = int64(fingerprint)

	switch {
	case progressID != "":
		lockKey = "progress:" + progressID
	case discordID != "":
		lockKey = "discord:" + discordID
	case deviceID != "":
		lockKey = "guest_device:" + deviceID
	case clientIP != "" && fingerprint != 0:
		lockKey = fmt.Sprintf("guest:%s:%d", clientIP, fingerprint)
	case clientIP != "":
		lockKey = "guest_ip:" + clientIP
	case fingerprint != 0:
		lockKey = fmt.Sprintf("guest_fp:%d", fingerprint)
	default:
		lockKey = ""
	}
	return
}

func generateSessionToken() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("fallback_%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}

func getSessionLockState(conn *websocket.Conn) (sessionLockState, bool) {
	sessionLockMu.Lock()
	defer sessionLockMu.Unlock()
	state, ok := sessionLockByConn[conn]
	return state, ok
}

func setSessionLockState(conn *websocket.Conn, state sessionLockState) {
	sessionLockMu.Lock()
	defer sessionLockMu.Unlock()
	sessionLockByConn[conn] = state
}

func popSessionLockState(conn *websocket.Conn) (sessionLockState, bool) {
	sessionLockMu.Lock()
	defer sessionLockMu.Unlock()
	state, ok := sessionLockByConn[conn]
	if ok {
		delete(sessionLockByConn, conn)
	}
	return state, ok
}

func acquireDBSessionLockForConn(conn *websocket.Conn, userData UserData, fingerprint uint32) bool {
	if sessionLockDB == nil || conn == nil {
		return true
	}

	lockKey, progressID, discordID, deviceID, clientIP, fingerprint64 := buildSessionLockIdentity(userData, fingerprint)
	if lockKey == "" {
		return true
	}

	sessionToken := generateSessionToken()
	if existing, ok := getSessionLockState(conn); ok && existing.lockKey == lockKey && existing.sessionToken != "" {
		sessionToken = existing.sessionToken
	}

	expiresAt := time.Now().UTC().Add(sessionLockTTL)
	ctx, cancel := context.WithTimeout(context.Background(), sessionLockDBTimeout)
	defer cancel()

	result, err := sessionLockDB.ExecContext(ctx, `
		INSERT INTO public.active_session_locks (
			lock_key, session_token, progress_user_id, discord_id, device_id, client_ip, fingerprint, created_at, updated_at, expires_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now(), $8)
		ON CONFLICT (lock_key) DO UPDATE
		SET
			session_token = EXCLUDED.session_token,
			progress_user_id = EXCLUDED.progress_user_id,
			discord_id = EXCLUDED.discord_id,
			device_id = EXCLUDED.device_id,
			client_ip = EXCLUDED.client_ip,
			fingerprint = EXCLUDED.fingerprint,
			updated_at = now(),
			expires_at = EXCLUDED.expires_at
		WHERE
			public.active_session_locks.expires_at <= now()
			OR public.active_session_locks.session_token = EXCLUDED.session_token
	`, lockKey, sessionToken, progressID, discordID, deviceID, clientIP, fingerprint64, expiresAt)
	if err != nil {
		log.Printf("db session lock acquire failed (allowing join): %v", err)
		return true
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		log.Printf("db session lock rowsAffected failed (allowing join): %v", err)
		return true
	}
	if rowsAffected == 0 {
		return false
	}

	setSessionLockState(conn, sessionLockState{
		lockKey:      lockKey,
		sessionToken: sessionToken,
	})
	return true
}

func touchDBSessionLockForConn(conn *websocket.Conn) {
	if sessionLockDB == nil || conn == nil {
		return
	}

	state, ok := getSessionLockState(conn)
	if !ok || state.lockKey == "" || state.sessionToken == "" {
		return
	}

	expiresAt := time.Now().UTC().Add(sessionLockTTL)
	ctx, cancel := context.WithTimeout(context.Background(), sessionLockDBTimeout)
	defer cancel()

	_, err := sessionLockDB.ExecContext(ctx, `
		UPDATE public.active_session_locks
		SET updated_at = now(), expires_at = $3
		WHERE lock_key = $1 AND session_token = $2
	`, state.lockKey, state.sessionToken, expiresAt)
	if err != nil {
		log.Printf("db session lock touch failed: %v", err)
	}
}

func releaseDBSessionLockForConn(conn *websocket.Conn) {
	if conn == nil {
		return
	}

	state, ok := popSessionLockState(conn)
	if !ok || state.lockKey == "" || state.sessionToken == "" || sessionLockDB == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), sessionLockDBTimeout)
	defer cancel()

	_, err := sessionLockDB.ExecContext(ctx, `
		DELETE FROM public.active_session_locks
		WHERE lock_key = $1 AND session_token = $2
	`, state.lockKey, state.sessionToken)
	if err != nil {
		log.Printf("db session lock release failed: %v", err)
	}
}
