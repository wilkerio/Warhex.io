package game

import "sync"

type ID byte

// AvailableIDs manages a slice of available IDs
type AvailableIDs struct {
	IDs []ID
	sync.Mutex
}

// Initializes an AvailableIDs struct with a specified number of IDs
func InitAvailableIDs(numIDs int) *AvailableIDs {
	ids := make([]ID, numIDs)
	for i := 0; i < numIDs; i++ {
		ids[i] = ID(i)
	}
	return &AvailableIDs{IDs: ids}
}

// getNextAvailableID returns the next available ID
func (a *AvailableIDs) getNextAvailableID() (ID, bool) {
	a.Lock()
	defer a.Unlock()

	if len(a.IDs) == 0 {
		return 0, false // No available IDs
	}
	id := a.IDs[0]
	a.IDs = a.IDs[1:] // Remove the first element
	return id, true
}

// ReturnID returns an ID to the available pool
func (a *AvailableIDs) returnID(id ID) {
	a.Lock()
	defer a.Unlock()

	a.IDs = append(a.IDs, id)
}
