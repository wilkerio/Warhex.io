package main

import (
	"bufio"
	"bytes"
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
	"time"
)

var PORT string
var bindAddress string
var authAPIBaseURL string
var allowedOrigins map[string]struct{}

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

func wsEndpoint(w http.ResponseWriter, r *http.Request) {
	var userData network.UserData
	userData.ClientIP = getClientIP(r)

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

	network.WsEndpoint(w, r, userData)
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

	mux := http.NewServeMux()
	mux.HandleFunc("/", wsEndpoint)
	mux.HandleFunc("/ffa1", wsEndpoint)
	mux.HandleFunc("/ffa2", wsEndpoint)
	mux.HandleFunc("/playercount", playerCountHandler)
	mux.HandleFunc("/reboot", serverRebootHandler)

	listenAddress := fmt.Sprintf("%s:%s", bindAddress, PORT)
	log.Printf("Warhex Server starting on %s\n", listenAddress)

	if err := http.ListenAndServe(listenAddress, corsMiddleware(mux)); err != nil {
		log.Fatal(err)
	}
}
