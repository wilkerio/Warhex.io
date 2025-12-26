package game

import "sync"

type Resource struct {
	Current  uint16
	Capacity uint16
	sync.RWMutex
}

func (r *Resource) Increment(amount uint16) {
	r.Lock()
	defer r.Unlock()
	r.Current += amount
	if r.Current > r.Capacity {
		r.Current = r.Capacity
	}
}

func (r *Resource) Decrement(amount uint16) bool {
	r.Lock()
	defer r.Unlock()
	if r.Current >= amount {
		r.Current -= amount
		return true
	}
	return false
}

type Resources struct {
	Power Resource
}

type Generating struct {
	Power uint16
}
