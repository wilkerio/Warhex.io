package game

import "sync"

type Health struct {
	Current uint16
	Max     uint16
	sync.RWMutex
}

func (h *Health) Reset() {
	h.Lock()
	defer h.Unlock()
	h.Current = h.Max
}

func (h *Health) Increment(amount uint16) {
	h.Lock()
	defer h.Unlock()
	// Prevent overflow and cap Current at Max
	if h.Current > h.Max-amount {
		h.Current = h.Max
	} else {
		h.Current += amount
	}
}

func (h *Health) Decrement(amount uint16) {
	h.Lock()
	defer h.Unlock()
	if amount >= h.Current {
		h.Current = 0
	} else {
		h.Current -= amount
	}
}
func (h *Health) IsAlive() bool {
	h.RLock()
	defer h.RUnlock()
	return h.Current > 0
}

func (h *Health) hasMaxHealth() bool {
	h.RLock()
	defer h.RUnlock()
	return h.Current == h.Max
}

func (h *Health) Get() uint16 {
	h.RLock()
	defer h.RUnlock()
	return h.Current
}
