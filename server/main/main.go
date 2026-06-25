package main

import (
	"bufio"
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	_ "net/http/pprof"
	"os"
	"path/filepath"
	"server/game"
	"server/network"
	"strconv"
	"strings"
	"sync"
	"time"
)

var PORT string
var bindAddress string
var authAPIBaseURL string
var allowedOrigins map[string]struct{}
var deviceIDSigningSecret []byte
var deviceIDSecretOnce sync.Once

const deviceCookieName = "warhex_device_id"

func parseCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func splitEnvLine(line string) (string, string, bool) {
	parts := strings.SplitN(line, "=", 2)
	if len(parts) != 2 {
		return "", "", false
	}

	key := strings.TrimSpace(parts[0])
	if key == "" {
		return "", "", false
	}

	value := strings.TrimSpace(parts[1])
	if len(value) >= 2 {
		quotedWithDouble := value[0] == '"' && value[len(value)-1] == '"'
		quotedWithSingle := value[0] == '\'' && value[len(value)-1] == '\''
		if quotedWithDouble || quotedWithSingle {
			value = value[1 : len(value)-1]
		}
	}

	return key, value, true
}

func loadEnvFile(path string) int {
	file, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer file.Close()

	loadedCount := 0
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}

		key, value, ok := splitEnvLine(line)
		if !ok {
			continue
		}
		if current, exists := os.LookupEnv(key); exists && strings.TrimSpace(current) != "" {
			continue
		}

		_ = os.Setenv(key, value)
		loadedCount++
	}

	return loadedCount
}

func loadEnvFromCandidates(candidates []string) int {
	totalLoaded := 0
	for _, path := range candidates {
		totalLoaded += loadEnvFile(path)
	}
	return totalLoaded
}

func buildAllowedOrigins() map[string]struct{} {
	configured := parseCSV(os.Getenv("CORS_ALLOWED_ORIGINS"))
	if len(configured) == 0 {
		configured = []string{
			"http://localhost",
			"http://127.0.0.1",
			"http://localhost:5502",
			"http://127.0.0.1:5502",
			"http://localhost:3000",
			"http://127.0.0.1:3000",
		}
	}

	allowed := make(map[string]struct{}, len(configured))
	for _, origin := range configured {
		allowed[origin] = struct{}{}
	}

	return allowed
}

func isOriginAllowed(origin string) bool {
	if origin == "" {
		return false
	}

	if _, ok := allowedOrigins[origin]; ok {
		return true
	}

	return strings.HasPrefix(origin, "http://localhost:") || strings.HasPrefix(origin, "http://127.0.0.1:")
}

func playerCountHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
		return
	}

	response := map[string]int{"player_count": len(game.State.Players)}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

func serverRebootHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
		return
	}

	query := r.URL.Query()
	minutesLeftStr := query.Get("minutesLeft")
	if minutesLeftStr == "" {
		http.Error(w, "Missing 'minutesLeft' query parameter", http.StatusBadRequest)
		return
	}

	minutesLeft, err := strconv.Atoi(minutesLeftStr)
	if err != nil || minutesLeft <= 0 {
		http.Error(w, "Invalid 'minutesLeft' query parameter", http.StatusBadRequest)
		return
	}

	network.BroadcastRebootAlert(byte(minutesLeft))
	network.SERVER_REBOOTING = true
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if isOriginAllowed(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
		}

		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func getClientIP(r *http.Request) string {
	clientIP := r.Header.Get("X-Real-IP")
	if clientIP == "" {
		clientIP = r.Header.Get("X-Forwarded-For")
	}
	if clientIP == "" {
		clientIP = r.RemoteAddr
	}
	return clientIP
}

func resolveDeviceIDSigningSecret() []byte {
	deviceIDSecretOnce.Do(func() {
		raw := strings.TrimSpace(os.Getenv("DEVICE_ID_SIGNING_SECRET"))
		if raw == "" {
			raw = strings.TrimSpace(os.Getenv("AUTH_API_SECRET"))
		}
		if raw == "" {
			buf := make([]byte, 32)
			if _, err := rand.Read(buf); err == nil {
				deviceIDSigningSecret = []byte(base64.RawURLEncoding.EncodeToString(buf))
				log.Println("DEVICE_ID_SIGNING_SECRET missing; using ephemeral in-memory secret for this process")
				return
			}
			raw = fmt.Sprintf("fallback_%d", time.Now().UnixNano())
			log.Println("DEVICE_ID_SIGNING_SECRET missing and random seed failed; using weak fallback secret")
		}
		deviceIDSigningSecret = []byte(raw)
	})
	return deviceIDSigningSecret
}

func signDeviceID(deviceID string, secret []byte) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(deviceID))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return deviceID + "." + signature
}

func verifySignedDeviceID(value string, secret []byte) (string, bool) {
	parts := strings.SplitN(strings.TrimSpace(value), ".", 2)
	if len(parts) != 2 {
		return "", false
	}
	deviceID := strings.TrimSpace(parts[0])
	signature := strings.TrimSpace(parts[1])
	if len(deviceID) < 16 || len(signature) < 16 {
		return "", false
	}
	if _, err := base64.RawURLEncoding.DecodeString(signature); err != nil {
		return "", false
	}
	expected := signDeviceID(deviceID, secret)
	expectedSig := strings.SplitN(expected, ".", 2)[1]
	if !hmac.Equal([]byte(signature), []byte(expectedSig)) {
		return "", false
	}
	return deviceID, true
}

func generateDeviceID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("dev_%d", time.Now().UnixNano())
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

func isSecureRequest(r *http.Request) bool {
	if r == nil {
		return false
	}
	if r.TLS != nil {
		return true
	}
	proto := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")))
	return proto == "https"
}

func ensureDeviceIDCookie(w http.ResponseWriter, r *http.Request) string {
	secret := resolveDeviceIDSigningSecret()
	if len(secret) == 0 {
		return ""
	}

	if existingCookie, err := r.Cookie(deviceCookieName); err == nil {
		if deviceID, ok := verifySignedDeviceID(existingCookie.Value, secret); ok {
			return deviceID
		}
	}

	deviceID := generateDeviceID()
	signedValue := signDeviceID(deviceID, secret)
	http.SetCookie(w, &http.Cookie{
		Name:     deviceCookieName,
		Value:    signedValue,
		Path:     "/",
		MaxAge:   60 * 60 * 24 * 365 * 2,
		HttpOnly: true,
		Secure:   isSecureRequest(r),
		SameSite: http.SameSiteLaxMode,
	})
	return deviceID
}

func buildUserAgentHash(r *http.Request) string {
	if r == nil {
		return ""
	}
	userAgent := strings.TrimSpace(strings.ToLower(r.UserAgent()))
	acceptLanguage := strings.TrimSpace(strings.ToLower(r.Header.Get("Accept-Language")))
	if userAgent == "" && acceptLanguage == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(userAgent + "||" + acceptLanguage))
	// 64-bit prefix keeps payload short while still useful as a backend signal.
	return hex.EncodeToString(sum[:8])
}

func wsEndpoint(w http.ResponseWriter, r *http.Request) {
	deviceID := ensureDeviceIDCookie(w, r)
	userAgentHash := buildUserAgentHash(r)
	var userData network.UserData
	userData.ClientIP = getClientIP(r)
	userData.DeviceID = deviceID
	userData.UserAgentHash = userAgentHash

	refreshTokenCookie, err := r.Cookie("refreshToken")
	if err != nil {
		network.WsEndpoint(w, r, userData)
		return
	}

	refreshToken := refreshTokenCookie.Value
	body := map[string]string{"refreshToken": refreshToken}
	jsonBody, err := json.Marshal(body)
	if err != nil {
		log.Printf("Failed to marshal JSON body: %v", err)
		http.Error(w, "Failed to retrieve user data", http.StatusInternalServerError)
		return
	}

	requestURL := fmt.Sprintf("%s/api/user", authAPIBaseURL)
	req, err := http.NewRequest(http.MethodPost, requestURL, bytes.NewBuffer(jsonBody))
	if err != nil {
		log.Printf("Failed to create request: %v", err)
		http.Error(w, "Failed to retrieve user data", http.StatusInternalServerError)
		return
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", fmt.Sprintf("http://%s:%s", bindAddress, PORT))

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Failed to send request to user API: %v", err)
		http.Error(w, "Failed to retrieve user data", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("Invalid or expired refresh token: %s", resp.Status)
		http.Error(w, "Invalid or expired refresh token.", http.StatusForbidden)
		return
	}

	if err := json.NewDecoder(resp.Body).Decode(&userData); err != nil {
		log.Printf("Failed to parse user data: %v", err)
		http.Error(w, "Failed to parse user data", http.StatusInternalServerError)
		return
	}
	userData.ClientIP = getClientIP(r)
	userData.DeviceID = deviceID
	userData.UserAgentHash = userAgentHash

	network.WsEndpoint(w, r, userData)
}

func registerGameModeRoutes(mux *http.ServeMux, prefix string, aliasCount int) {
	mux.HandleFunc(fmt.Sprintf("/%s", prefix), wsEndpoint)
	for i := 1; i <= aliasCount; i++ {
		mux.HandleFunc(fmt.Sprintf("/%s%d", prefix, i), wsEndpoint)
	}
}

func main() {
	loaded := loadEnvFromCandidates([]string{
		".env.local",
		".env",
		filepath.Join("..", ".env.local"),
		filepath.Join("..", ".env"),
		filepath.Join("..", "..", ".env.local"),
		filepath.Join("..", "..", ".env"),
	})
	if loaded > 0 {
		log.Printf("Loaded %d environment value(s) from .env files", loaded)
	}

	PORT = os.Getenv("PORT")
	if PORT == "" {
		PORT = "9090"
		log.Printf("Port not specified. Defaulting to port %s\n", PORT)
	}

	bindAddress = os.Getenv("BIND_ADDRESS")
	if bindAddress == "" {
		bindAddress = "127.0.0.1"
	}

	authAPIBaseURL = strings.TrimRight(os.Getenv("AUTH_API_BASE_URL"), "/")
	if authAPIBaseURL == "" {
		authAPIBaseURL = "http://127.0.0.1:3001"
	}

	allowedOrigins = buildAllowedOrigins()
	if err := os.MkdirAll(filepath.Join("models", "chat_memory"), 0o755); err != nil {
		log.Printf("Failed to create models/chat_memory directory: %v", err)
	}
	if err := os.MkdirAll(filepath.Join("models", "rl"), 0o755); err != nil {
		log.Printf("Failed to create models/rl directory: %v", err)
	}

	go game.Start()
	if strings.EqualFold(strings.TrimSpace(os.Getenv("RUN_TRAINING")), "true") {
		go func() {
			log.Println("RL training started in background")
			game.RunTraining()
		}()
	}

	routeAliasCount := 16
	if rawAliasCount := strings.TrimSpace(os.Getenv("GAME_ROUTE_ALIAS_COUNT")); rawAliasCount != "" {
		if parsedAliasCount, err := strconv.Atoi(rawAliasCount); err == nil && parsedAliasCount > 0 {
			routeAliasCount = parsedAliasCount
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", wsEndpoint)
	registerGameModeRoutes(mux, "ffa", routeAliasCount)
	registerGameModeRoutes(mux, "overdrive", routeAliasCount)
	mux.HandleFunc("/playercount", playerCountHandler)
	mux.HandleFunc("/reboot", serverRebootHandler)

	listenAddress := fmt.Sprintf("%s:%s", bindAddress, PORT)
	log.Printf("Warhex Server starting on %s\n", listenAddress)

	if err := http.ListenAndServe(listenAddress, corsMiddleware(mux)); err != nil {
		log.Fatal(err)
	}
}
