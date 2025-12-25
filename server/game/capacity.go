package game

import (
	"sync"
)

type Capacity struct {
	Current uint16
	Max     uint16
	sync.RWMutex
}

// Increment increases the Current value by the given amount, capping it at Max.
func (c *Capacity) Increment(amount uint16) {
	c.Lock() // Lock for write access to modify Current
	defer c.Unlock()
	// Prevent overflow and cap Current at Max
	if c.Current+amount > c.Max {
		c.Current = c.Max
	} else {
		c.Current += amount
	}
}

// Decrement decreases the Current value by the given amount, ensuring it doesn't go below 0.
func (c *Capacity) Decrement(amount uint16) {
	c.Lock() // Lock for write access to modify Current
	defer c.Unlock()
	// Ensure Current doesn't go below zero
	if c.Current <= amount {
		c.Current = 0
	} else {
		c.Current -= amount
	}
}

// Reset resets Current to Max value.
func (c *Capacity) Reset() {
	c.Lock() // Lock for write access to modify Current
	defer c.Unlock()
	c.Current = c.Max
}

// Get returns the current value of the Capacity.
func (c *Capacity) Get() uint16 {
	c.RLock() // Read lock for accessing Current value
	defer c.RUnlock()
	return c.Current
}

// hasMaxCapacity checks if the Current value is equal to Max value.
func (c *Capacity) HasMaxCapacity() bool {
	c.RLock() // Read lock for checking if Current is equal to Max
	defer c.RUnlock()
	return c.Current == c.Max
}
