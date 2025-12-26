package game

import "sync"

type Population struct {
	Used     uint16 // Number of units currently using population capacity
	Capacity uint16 // Total population capacity
	sync.RWMutex
}

const MaxCapacity uint16 = 2048

// IncrementCapacity increases the Capacity by the specified amount.
func (p *Population) IncrementCapacity(amount uint16) {
	p.Lock()
	defer p.Unlock()
	// Prevent overflow if amount is too large
	if p.Capacity > MaxCapacity-amount {
		p.Capacity = MaxCapacity
	} else {
		p.Capacity += amount
	}
}

// DecrementCapacity decreases the Capacity by the specified amount if there is enough Capacity.
func (p *Population) DecrementCapacity(amount uint16) bool {
	p.Lock()
	defer p.Unlock()
	if p.Capacity >= amount {
		p.Capacity -= amount
		return true
	}
	return false
}

// IncrementUsed increases the Usewd population by the specified amount if there is enough Capacity.
func (p *Population) IncrementUsed(amount uint16) bool {
	p.Lock()
	defer p.Unlock()
	// Check for overflow and available capacity
	if p.Used+amount > p.Capacity {
		return false
	}
	p.Used += amount
	return true
}

// DecrementUsed decreases the Used population by the specified amount if there are enough units.
func (p *Population) DecrementUsed(amount uint16) bool {
	p.Lock()
	defer p.Unlock()
	if p.Used >= amount {
		p.Used -= amount
		return true
	}
	return false
}
