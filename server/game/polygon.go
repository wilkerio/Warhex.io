package game

import (
	"math"
)

type PolygonType int

const (
	ShapeCircle PolygonType = iota
	ShapeHexagon
	ShapePentagon
	ShapeRectangle
	ShapeTriangle
)

type Polygon struct {
	Vertices       []PositionFloat // Local vertices of the polygon
	Center         PositionFloat   // Center position of the polygon
	Rotation       float64         // Rotation of the polygon in radians
	rotationOffset float64
}

func (p *Polygon) SetCenter(center PositionFloat) {
	p.Center = center
}

func (p *Polygon) SetRotation(angle float64) {
	p.Rotation = angle + p.rotationOffset
}

func (p *Polygon) GetGlobalVertices() []PositionFloat {
	globalVertices := make([]PositionFloat, len(p.Vertices))
	cos := math.Cos(p.Rotation)
	sin := math.Sin(p.Rotation)

	for i, vertex := range p.Vertices {
		x := float64(vertex.X)
		y := float64(vertex.Y)
		globalX := float32(x*cos - y*sin)
		globalY := float32(x*sin + y*cos)
		globalVertices[i] = PositionFloat{X: globalX + p.Center.X, Y: globalY + p.Center.Y}
	}

	return globalVertices
}

func DoPolygonsIntersect(polygon1, polygon2 Polygon) bool {
	// Get the global vertices for both polygons
	vertices1 := polygon1.GetGlobalVertices()
	vertices2 := polygon2.GetGlobalVertices()

	// Define a helper function to get the normal vector for an edge
	getNormal := func(p1, p2 PositionFloat) PositionFloat {
		return PositionFloat{X: p2.Y - p1.Y, Y: p1.X - p2.X}
	}

	// Define a helper function to check projection overlap
	checkOverlap := func(verticesA, verticesB []PositionFloat, axis PositionFloat) bool {
		minA, maxA := projectVertices(verticesA, axis)
		minB, maxB := projectVertices(verticesB, axis)
		return !(maxA < minB || maxB < minA)
	}

	// Function to check if polygons intersect using SAT
	checkPolygon := func(verticesA, verticesB []PositionFloat) bool {
		numVertices := len(verticesA)
		for i := 0; i < numVertices; i++ {
			// Get the edge vector
			p1 := verticesA[i]
			p2 := verticesA[(i+1)%numVertices]
			axis := getNormal(p1, p2)

			// Normalize the axis
			axisLength := math.Sqrt(float64(axis.X*axis.X + axis.Y*axis.Y))
			if axisLength == 0 {
				continue
			}
			axis.X /= float32(axisLength)
			axis.Y /= float32(axisLength)

			// Check if projections overlap on this axis
			if !checkOverlap(verticesA, verticesB, axis) {
				return false
			}
		}
		return true
	}

	// Check if polygons intersect by comparing projections along all axes
	return checkPolygon(vertices1, vertices2) && checkPolygon(vertices2, vertices1)
}

func projectVertices(vertices []PositionFloat, axis PositionFloat) (min, max float64) {
	min = math.Inf(1)
	max = math.Inf(-1)

	for _, vertex := range vertices {
		projected := float64(vertex.X*axis.X + vertex.Y*axis.Y)
		if projected < min {
			min = projected
		}
		if projected > max {
			max = projected
		}
	}
	return
}

func InitCirclePolygonWithOffset(size int, offset float64) Polygon {
	numSides := 16
	angleStep := (2 * math.Pi) / float64(numSides)
	points := make([]PositionFloat, numSides)

	for i := 0; i < numSides; i++ {
		angle := angleStep * float64(i)
		x := float32((float64(size) + offset) * math.Cos(angle))
		y := float32((float64(size) + offset) * math.Sin(angle))
		points[i] = PositionFloat{X: x, Y: y}
	}

	return Polygon{
		Vertices: points,
		Rotation: 0, // Initial rotation can be set to 0
	}
}

func InitCirclePolygon(size int) Polygon {
	// Keep historical +2 collision envelope for circular buildings by default.
	return InitCirclePolygonWithOffset(size, 2)
}

func InitHexagon(size int) Polygon {
	numSides := 6
	angleStep := (2 * math.Pi) / float64(numSides)
	points := make([]PositionFloat, numSides)

	for i := 0; i < numSides; i++ {
		angle := angleStep * float64(i)
		x := float32(float64(size) * math.Cos(angle))
		y := float32(float64(size) * math.Sin(angle))
		points[i] = PositionFloat{X: x, Y: y}
	}

	return Polygon{
		Vertices: points,
		Rotation: 0,
	}
}

func InitPentagon(size int) Polygon {
	numSides := 5
	angleStep := (2 * math.Pi) / float64(numSides)
	points := make([]PositionFloat, numSides)

	for i := 0; i < numSides; i++ {
		angle := angleStep * float64(i)
		x := float32(float64(size) * math.Cos(angle))
		y := float32(float64(size) * math.Sin(angle))
		points[i] = PositionFloat{X: x, Y: y}
	}

	return Polygon{
		Vertices: points,
		Rotation: 0,
	}
}

func InitRectangle(width, height int) Polygon {
	halfWidth := float32(width / 2)
	halfHeight := float32(height / 2)

	points := []PositionFloat{
		{X: -halfWidth, Y: -halfHeight},
		{X: halfWidth, Y: -halfHeight},
		{X: halfWidth, Y: halfHeight},
		{X: -halfWidth, Y: halfHeight},
	}

	return Polygon{
		Vertices: points,
		Rotation: 0,
	}
}

func InitTriangle(size int) Polygon {
	numSides := 3
	angleStep := (2 * math.Pi) / float64(numSides)
	points := make([]PositionFloat, numSides)

	for i := 0; i < numSides; i++ {
		angle := angleStep * float64(i)
		x := float32(float64(size) * math.Cos(angle))
		y := float32(float64(size) * math.Sin(angle))
		points[i] = PositionFloat{X: x, Y: y}
	}

	return Polygon{
		Vertices: points,
		Rotation: 0,
	}
}

// GeneratePolygon generates a polygon based on the specified type.
func GeneratePolygon(polygonType PolygonType, size int, rotationOffset float64) Polygon {
	var polygon Polygon
	switch polygonType {
	case ShapeCircle:
		polygon = InitCirclePolygon(size)
	case ShapeHexagon:
		polygon = InitHexagon(size)
	case ShapePentagon:
		polygon = InitPentagon(size)
	case ShapeRectangle:
		polygon = InitRectangle(size, size) // Size is width and height
	case ShapeTriangle:
		polygon = InitTriangle(size)
	default:
		// Optionally log an error or return an error
		return Polygon{}
	}
	polygon.rotationOffset = rotationOffset
	return polygon
}
