package game

import (
	"sort"
	"sync"
)

type LeaderboardScore struct {
	FullValue      uint32
	IntegerPart    uint16 // Integer part before the decimal point
	FractionalPart byte   // Fractional part after the decimal point
	Unit           byte   // Unit identifier ('k' for thousands, 'M' for millions)
}

type LeaderboardEntry struct {
	Player *Player
	Score  LeaderboardScore
}

type Leaderboard struct {
	Entries []LeaderboardEntry
	mu      sync.RWMutex // Mutex to protect concurrent access to the leaderboard
}

func (l *Leaderboard) GetEntries() []LeaderboardEntry {
	l.mu.RLock()
	defer l.mu.RUnlock()

	// Return a copy of the entries to prevent external modification
	entriesCopy := make([]LeaderboardEntry, len(l.Entries))
	copy(entriesCopy, l.Entries)
	return entriesCopy
}

func (l *Leaderboard) Update(players map[ID]*Player) ([]LeaderboardEntry, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()

	// Capture previous entries before updating
	previousEntries := make([]LeaderboardEntry, len(l.Entries))
	copy(previousEntries, l.Entries)

	// Create a list of updated entries from the current players
	updatedEntries := make([]LeaderboardEntry, 0, len(players))
	for _, player := range players {
		updatedEntries = append(updatedEntries, LeaderboardEntry{
			Player: player,
			Score:  ConvertToLeaderboardScore(player.GetScore()),
		})
	}

	// Sort the entries by score in descending order
	sort.Slice(updatedEntries, func(i, j int) bool {
		return updatedEntries[i].Score.FullValue > updatedEntries[j].Score.FullValue
	})

	// Trim the list to the top 10 players
	if len(updatedEntries) > 10 {
		updatedEntries = updatedEntries[:10]
	}

	// Determine changes compared to the previous state
	var changes []LeaderboardEntry
	changed := false

	// Create a map of previous entries for quick lookup
	previousMap := make(map[ID]LeaderboardEntry)
	for _, entry := range previousEntries {
		previousMap[entry.Player.ID] = entry
	}

	// Compare the updated entries with the previous ones
	for _, entry := range updatedEntries {
		prevEntry, exists := previousMap[entry.Player.ID]

		// Detect changes in the score or if the entry is new
		if !exists ||
			entry.Score.IntegerPart != prevEntry.Score.IntegerPart ||
			entry.Score.FractionalPart != prevEntry.Score.FractionalPart ||
			entry.Score.Unit != prevEntry.Score.Unit {

			changes = append(changes, entry)
			changed = true
		}
	}

	// Update the leaderboard entries with the new top 10 entries
	l.Entries = updatedEntries

	return changes, changed
}

func ConvertToLeaderboardScore(score uint32) LeaderboardScore {
	var unit byte
	var integerPart uint16
	var fractionalPart byte

	if score >= 1e6 { // Score is in millions
		unit = 'M'
		integerPart = uint16(score / 1e6)
		// Compute fractional part as two digits (00-99)
		fractionalPart = byte((score % 1e6) / 1e4) // Equivalent to (score % 1e6) / 10^4
	} else if score >= 1e3 { // Score is in thousands
		unit = 'k'
		integerPart = uint16(score / 1e3)
		// Compute fractional part as a single digit (0-9)
		fractionalPart = byte((score % 1e3) / 1e2) // Equivalent to (score % 1e3) / 10^2
	} else {
		unit = 0 // No unit needed for scores below 1000
		integerPart = uint16(score)
		fractionalPart = 0 // No fractional part for integer scores below 1000
	}

	return LeaderboardScore{
		FullValue:      uint32(score),
		IntegerPart:    integerPart,
		FractionalPart: fractionalPart,
		Unit:           unit,
	}
}
