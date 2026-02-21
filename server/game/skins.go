package game

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"strings"
)

// NonSkinColors is a list of colors for players without skins
var NonSkinColors [][]byte

func InitializeNonSkinColors() {
	rawColors := []string{
		"#60eaff",
		"#c0d7f6",
		"#61b0ff",
		"#ae97f6",
		"#61ffb0",
		"#a6ff60",
		"#a1cd84",
		"#3fc6a8",
		"#fff070",
		"#ffb061",
		"#d88166",
		"#ff794f",
		"#ff605f",
		"#f697b0",
		"#ff6ef1",
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

	return []byte{r, g, b}
}
