package game

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"math"
	"os"
	"strings"
)

// NonSkinColors is a list of colors for players without skins
var NonSkinColors [][]byte

func InitializeNonSkinColors() {
	rawColors := []string{
		"#00e5ff",
		"#00b8ff",
		"#2979ff",
		"#7c4dff",
		"#b388ff",
		"#00e676",
		"#00c853",
		"#64dd17",
		"#ffd600",
		"#ffab00",
		"#ff9100",
		"#ff6d00",
		"#ff5252",
		"#ff4081",
		"#f500ff",
	}

	NonSkinColors = make([][]byte, len(rawColors))
	for i, hex := range rawColors {
		color := ParseHexColor(hex)
		NonSkinColors[i] = color
	}

	log.Println("Non-skin colors parsed successfully")
}

// SkinData represents all the information required for each skin
type SkinData struct {
	ID            byte   `json:"id"`
	Name          string `json:"name"`
	BaseColor     []byte `json:"-"`          // Preparsed RGB values
	BaseColorHex  string `json:"base_color"` // Original Hex String
	RequiredLevel int    `json:"required_level,omitempty"`
	Cost          int    `json:"cost,omitempty"`
}

// SkinCategory contains all skins grouped by category
type SkinCategory struct {
	Default []SkinData `json:"default"`
	Veteran []SkinData `json:"veteran"`
	Premium []SkinData `json:"premium"`
}

// AllSkins holds all the skin data for all categories
var AllSkins SkinCategory

// GetSkinDataByID retrieves the SkinData for a given ID from AllSkins
func GetSkinDataByID(id byte) (SkinData, bool) {
	for _, category := range []struct {
		Name  string
		Skins []SkinData
	}{
		{"Default", AllSkins.Default},
		{"Veteran", AllSkins.Veteran},
		{"Premium", AllSkins.Premium},
	} {
		for _, skin := range category.Skins {
			if skin.ID == id {
				return skin, true
			}
		}
	}
	return SkinData{}, false
}

// LoadSkins reads the skin data from a JSON file and parses colors
func loadSkins() {
	possiblePaths := []string{
		"data/skins.json",
		"main/data/skins.json",
		"../main/data/skins.json",
		"../data/skins.json",
	}

	var file *os.File
	var err error

	for _, path := range possiblePaths {
		file, err = os.Open(path)
		if err == nil {
			break
		}
	}

	if err != nil {
		log.Fatal("Error opening skin data file, tried multiple paths: ", err)
	}
	defer file.Close()

	data, err := ioutil.ReadAll(file)
	if err != nil {
		log.Fatal("Error reading skin data file:", err)
	}

	err = json.Unmarshal(data, &AllSkins)
	if err != nil {
		log.Fatal("Error unmarshalling skin data:", err)
	}

	// Parse BaseColorHex into BaseColor for each skin
	for _, category := range []*[]SkinData{
		&AllSkins.Default,
		&AllSkins.Veteran,
		&AllSkins.Premium,
	} {
		for i, skin := range *category {
			color := ParseHexColor(skin.BaseColorHex)

			(*category)[i].BaseColor = color
		}
	}

	log.Println("Skins loaded into memory successfully with parsed colors")
}

func GetDefaultSkinByName(name string) (SkinData, bool) {
	nameLower := strings.ToLower(name) // Convert the input name to lowercase

	for _, skin := range AllSkins.Default {
		if strings.ToLower(skin.Name) == nameLower { // Compare names case-insensitively
			return skin, true
		}
	}

	return SkinData{}, false // Return false if no match is found
}

func GetDefaultSkinByID(id byte) (SkinData, bool) {
	for _, skin := range AllSkins.Default {
		if skin.ID == id {
			return skin, true
		}
	}
	return SkinData{}, false
}

func ParseHexColor(hexColor string) []byte {
	// If the color is transparent, return [0, 0, 0] or similar placeholder
	if hexColor == "transparent" {
		return []byte{0, 0, 0}
	}

	// Remove the hash if present
	if len(hexColor) > 0 && hexColor[0] == '#' {
		hexColor = hexColor[1:]
	}

	// Ensure the hexColor is exactly 6 characters (for RGB)
	if len(hexColor) != 6 {
		log.Println("Error: Invalid hex color length:", hexColor)
		return []byte{0, 0, 0} // Default to black if invalid
	}

	// Convert hex string to RGB values
	var r, g, b byte
	_, err := fmt.Sscanf(hexColor, "%02x%02x%02x", &r, &g, &b)
	if err != nil {
		log.Println("Error parsing color:", err)
		return []byte{0, 0, 0} // Default to black if error
	}

	return vividifyColor(r, g, b)
}

func vividifyColor(r, g, b byte) []byte {
	rf := float64(r) / 255.0
	gf := float64(g) / 255.0
	bf := float64(b) / 255.0

	maxv := math.Max(rf, math.Max(gf, bf))
	minv := math.Min(rf, math.Min(gf, bf))
	delta := maxv - minv

	l := (maxv + minv) / 2.0
	s := 0.0
	h := 0.0

	if delta > 0 {
		if l > 0.5 {
			s = delta / (2.0 - maxv - minv)
		} else {
			s = delta / (maxv + minv)
		}

		switch maxv {
		case rf:
			h = (gf - bf) / delta
			if gf < bf {
				h += 6.0
			}
		case gf:
			h = (bf-rf)/delta + 2.0
		default:
			h = (rf-gf)/delta + 4.0
		}
		h /= 6.0
	}

	// Keep all base colors vivid and avoid pastel/washed tones.
	if s < 0.90 {
		s = 0.90
	}
	if l < 0.52 {
		l = 0.52
	} else if l > 0.66 {
		l = 0.66
	}

	rOut, gOut, bOut := hslToRGB(h, s, l)
	return []byte{rOut, gOut, bOut}
}

func hslToRGB(h, s, l float64) (byte, byte, byte) {
	var rf, gf, bf float64
	if s == 0 {
		rf, gf, bf = l, l, l
	} else {
		q := l * (1 + s)
		if l >= 0.5 {
			q = l + s - l*s
		}
		p := 2*l - q
		rf = hueToRGB(p, q, h+1.0/3.0)
		gf = hueToRGB(p, q, h)
		bf = hueToRGB(p, q, h-1.0/3.0)
	}

	r := byte(math.Round(clampColor01(rf) * 255.0))
	g := byte(math.Round(clampColor01(gf) * 255.0))
	b := byte(math.Round(clampColor01(bf) * 255.0))
	return r, g, b
}

func hueToRGB(p, q, t float64) float64 {
	if t < 0 {
		t += 1
	}
	if t > 1 {
		t -= 1
	}
	if t < 1.0/6.0 {
		return p + (q-p)*6*t
	}
	if t < 1.0/2.0 {
		return q
	}
	if t < 2.0/3.0 {
		return p + (q-p)*(2.0/3.0-t)*6
	}
	return p
}

func clampColor01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}
