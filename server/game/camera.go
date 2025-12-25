package game

import (
	"time"
)

type Camera struct {
	Position         PositionInt
	ZoomLevel        float32
	MaxZoom          float32
	MinZoom          float32
	ScreenWidth      int
	ScreenHeight     int
	Bounds           CameraBounds
	LastUpdateTime   time.Time     // Last time the camera was updated
	CooldownDuration time.Duration // Duration of cooldown between updates
}

// CameraBounds holds the coordinates of the camera's bounding box
type CameraBounds struct {
	Left   int
	Top    int
	Right  int
	Bottom int
}

// NewCamera initializes a new Camera instance with default values
func NewCamera() Camera {
	camera := Camera{
		Position:         PositionInt{X: 0, Y: 0}, // Default position at origin
		ZoomLevel:        0.75,                    // Default zoom level
		MaxZoom:          1.5,                     // Maximum zoom level
		MinZoom:          0.5,                     // Minimum zoom level
		ScreenWidth:      1920,                    // Default screen width
		ScreenHeight:     1080,                    // Default screen height
		CooldownDuration: time.Second / 4,         // Example cooldown of 0.5 seconds
	}
	camera.UpdateBounds()              // Initialize the bounds
	camera.LastUpdateTime = time.Now() // Set the initial update time
	return camera
}

// SetZoom sets the zoom level and clamps it between MinZoom and MaxZoom
func (c *Camera) SetZoom(newZoom float32) {
	if newZoom < c.MinZoom {
		newZoom = c.MinZoom
	} else if newZoom > c.MaxZoom {
		newZoom = c.MaxZoom
	}

	c.ZoomLevel = newZoom
}

// UpdateBounds calculates and updates the bounds (bounding box) of the camera view
func (c *Camera) UpdateBounds() {
	// Calculate the width and height of the camera view based on zoom level
	zoomedWidth := float32(c.ScreenWidth) / c.ZoomLevel
	zoomedHeight := float32(c.ScreenHeight) / c.ZoomLevel

	// Calculate half of the zoomed dimensions
	halfWidth := zoomedWidth / 2
	halfHeight := zoomedHeight / 2

	// Update the bounds coordinates based on the camera's center position
	c.Bounds.Left = int(float32(c.Position.X) - halfWidth)
	c.Bounds.Top = int(float32(c.Position.Y) - halfHeight)
	c.Bounds.Right = int(float32(c.Position.X) + halfWidth)
	c.Bounds.Bottom = int(float32(c.Position.Y) + halfHeight)
}

// UpdateLastTime updates the last update time
func (c *Camera) UpdateLastTime() {
	c.LastUpdateTime = time.Now()
}

// CanUpdate checks if enough time has passed since the last update
func (c *Camera) CanUpdate() bool {
	return time.Since(c.LastUpdateTime) >= c.CooldownDuration
}
