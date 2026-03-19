package game

import (
	"os"
	"strings"
)

type botLegacySocketSlot struct {
	Angle        float64
	Radius       float32
	BuildingType BuildingType
}

type legacySocketEntry struct {
	angle      float64
	radius     float64
	legacyType int
}

const (
	botLegacyLayoutNone     = ""
	botLegacyLayoutExterna  = "legacy_externa"
	botLegacyLayoutAutogens = "legacy_autogens"
)

// Legacy socket layout provided by user scripts (angle, radius, legacyType).
// Legacy types:
// 1->Wall, 3->Generator, 4->House, 7->Armory, 8->Barracks.
var legacyExternaSocketLayout = []legacySocketEntry{
	{4.725, 130, 7},
	{5.245, 130, 4}, {5.715, 130, 4}, {6.185, 130, 4}, {6.655, 130, 4}, {7.13, 130, 4}, {7.6, 130, 4},
	{1.85, 130, 4}, {2.32, 130, 4}, {2.79, 130, 4}, {3.265, 130, 4}, {3.735, 130, 4}, {4.205, 130, 4},
	{5.06, 185, 4}, {5.4, 185, 4}, {5.725, 190, 4}, {6.045, 186, 4}, {6.374, 185, 4}, {6.7215, 189.5, 4},
	{7.0425, 188.5, 4}, {7.365, 185, 4}, {7.712, 187.45, 4}, {8.035, 188.5, 4}, {8.36, 185, 4},
	{2.425, 188, 4}, {2.75, 190, 4}, {3.075, 184, 4}, {3.42, 186, 4}, {3.74, 190, 4}, {4.06, 186, 4}, {4.39, 185, 4},
	{4.8625, 245, 4}, {5.1125, 245, 4}, {5.3625, 245, 4}, {5.6125, 245, 4}, {5.8625, 245, 4}, {6.1125, 245, 4},
	{6.3625, 245, 4}, {6.6125, 245, 4}, {6.8625, 245, 4}, {7.14, 245, 4}, {7.39, 245, 4}, {7.64, 246, 4},
	{7.89, 246, 4}, {8.14, 246, 4}, {8.39, 246, 4}, {8.635, 246, 4}, {8.885, 246, 4}, {2.5825, 245, 4},
	{2.8625, 245, 4}, {3.1125, 245, 4}, {3.3625, 245, 4}, {3.6125, 245, 4}, {3.8625, 245, 4}, {4.1125, 245, 4},
	{4.3625, 245, 4}, {4.6125, 245, 4},
	{7.86, 311, 1}, {8.06, 311, 1}, {8.26, 311, 1}, {8.46, 311, 1}, {8.66, 311, 1}, {8.86, 311, 1}, {9.06, 311, 1},
	{9.26, 311, 1}, {9.46, 311, 1}, {9.66, 311, 1}, {9.86, 311, 1}, {10.28, 311, 1}, {10.7, 311, 1}, {10.9, 311, 1},
	{11.1, 311, 1}, {11.3, 311, 1}, {11.72, 311, 1}, {12.14, 311, 1}, {12.34, 311, 1}, {12.54, 311, 1}, {12.74, 311, 1},
	{12.94, 311, 1}, {13.14, 311, 1}, {13.34, 311, 1}, {13.54, 311, 1}, {13.74, 311, 1}, {13.94, 311, 1},
	{10.07, 311, 8}, {10.49, 311, 8}, {11.51, 311, 8}, {11.93, 311, 8},
}

// Legacy Autogens layout (angle, radius, legacyType=3 => Generator).
var legacyAutogensSocketLayout = []legacySocketEntry{
	{1.5700171594315573, 243.85007402090326, 3}, {2.4400100710526793, 196.79985467474305, 3},
	{2.2400039007898447, 243.85656849877958, 3}, {-2.7800023458624703, 194.6788252481507, 3},
	{1.9699911201667188, 243.85313366860794, 3}, {2.0999878201715214, 185.58517209087591, 3},
	{1.8700025978863808, 132.00487756139935, 3}, {1.2599938029024704, 132.00454272486235, 3},
	{1.3800278697318928, 194.13178049974198, 3}, {1.7600061169825598, 194.06341746965091, 3},
	{-2.4400027616849433, 185.75130282181078, 3}, {-2.1999936469647867, 131.99750300668575, 3},
	{-2.5899833434664847, 243.84680949317334, 3}, {3.0599865137335724, 131.9992848465475, 3},
	{2.3700155322992322, 132.00115908582003, 3}, {2.7699990995853443, 180.63860107961412, 3},
	{2.910001829109119, 243.8501927413633, 3}, {2.6399909192202835, 243.84888476267423, 3},
	{3.1100150743706907, 196.05774072961268, 3}, {-2.9699920613329622, 243.85151732150447, 3},
	{-2.690040409174835, 132.00027613607475, 3}, {-2.3099851374683826, 243.85151732150447, 3},
	{-2.0399825212769436, 243.85142525726602, 3}, {-1.7700175093099535, 243.85316996094184, 3},
	{0.7600044161827382, 132.00282572733062, 3}, {0.35996640663856383, 180.10304605974878, 3},
	{0.029980358323314006, 197.1585985951411, 3}, {-0.439963547142766, 132.00080795207285, 3},
	{0.0800082011395776, 132.0022685411125, 3}, {0.22998938484625386, 243.85088271318605, 3},
	{0.5000045603394669, 243.85230796529285, 3}, {0.7000201471114224, 196.1091423162112, 3},
	{0.8999878082444033, 243.84691201653544, 3}, {1.0399986494012126, 186.08457861950842, 3},
	{1.170002238251199, 243.8551629553904, 3}, {-0.170023102819992, 243.84605081895415, 3},
	{-0.36001357695289626, 194.92632916053194, 3}, {-0.7000068138510656, 183.7252296229344, 3},
	{-1.3600094643934062, 243.84717119540267, 3}, {-1.0899817628353876, 243.84783862072678, 3},
	{-0.5500054440958607, 243.85303709406625, 3}, {-0.8199991749608286, 243.85031002645857, 3},
	{-1.9300228177358634, 182.30682104627905, 3}, {-1.199997990229862, 183.82290662482725, 3},
	{-0.9500096278543927, 131.99805036438974, 3}, {-1.5699815385655684, 196.37006518306183, 3},
	{-1.5699629936544652, 132.00004583332537, 3},
}

func refreshBotLegacyLayout(rt *botRuntime) {
	if rt == nil {
		return
	}
	name := desiredBotLegacyLayout(rt)
	if rt.legacyLayoutName == name {
		return
	}
	rt.legacyLayoutName = name
	rt.legacyLayoutCursor = 0
	rt.legacyLayoutSlots = buildLegacyLayoutByName(name, rt)
}

func desiredBotLegacyLayout(rt *botRuntime) string {
	if rt == nil {
		return botLegacyLayoutNone
	}
	if configured := configuredBotStandardLegacyLayout(); configured != "" {
		return configured
	}

	sig := stableBotBuildSignature(rt)
	switch rt.basePlan {
	case basePlanExternAtk:
		// Keep most attackers on externa while allowing some variation.
		if sig%11 == 0 {
			return botLegacyLayoutNone
		}
		if sig%7 == 0 {
			return botLegacyLayoutAutogens
		}
		return botLegacyLayoutExterna
	case basePlanAutogens:
		// Keep most eco bots on autogens while allowing some variation.
		if sig%10 == 0 {
			return botLegacyLayoutNone
		}
		if sig%6 == 0 {
			return botLegacyLayoutExterna
		}
		return botLegacyLayoutAutogens
	default:
		if rt.profile == profileAttack || rt.role == roleRaider {
			if sig%5 == 0 {
				return botLegacyLayoutNone
			}
			return botLegacyLayoutExterna
		}
		if rt.profile == profileEconomy || rt.role == roleEco {
			if sig%5 == 0 {
				return botLegacyLayoutNone
			}
			return botLegacyLayoutAutogens
		}
		return botLegacyLayoutNone
	}
}

func configuredBotStandardLegacyLayout() string {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("BOT_STANDARD_BASE")))
	switch raw {
	case "":
		// Default is adaptive: each bot can pick a different layout family.
		return botLegacyLayoutNone
	case "mixed", "adaptive", "auto", "default":
		return botLegacyLayoutNone
	case "off", "none", "disable":
		return botLegacyLayoutNone
	case "legacy_externa", "externa", "externatk", "extern_atk", "b03", "padrao", "standard":
		return botLegacyLayoutExterna
	case "legacy_autogens", "autogens", "autogen", "defend", "b05":
		return botLegacyLayoutAutogens
	default:
		return botLegacyLayoutNone
	}
}

func buildLegacyLayoutByName(name string, rt *botRuntime) []botLegacySocketSlot {
	angleOffset := 0.0
	radiusScale := 1.0
	if rt != nil {
		// Deterministic per-bot shape variation to avoid clone bases.
		sig := stableBotBuildSignature(rt)
		angleBucket := int(sig%9) - 4
		radiusBucket := int((sig/9)%7) - 3
		angleOffset += float64(angleBucket) * 0.018
		radiusScale += float64(radiusBucket) * 0.018
		if radiusScale < 0.90 {
			radiusScale = 0.90
		}
		if radiusScale > 1.10 {
			radiusScale = 1.10
		}
	}

	switch name {
	case botLegacyLayoutExterna:
		return convertLegacySocketLayout(legacyExternaSocketLayout, -0.055+angleOffset, radiusScale)
	case botLegacyLayoutAutogens:
		return convertLegacySocketLayout(legacyAutogensSocketLayout, angleOffset, radiusScale)
	default:
		return nil
	}
}

func convertLegacySocketLayout(source []legacySocketEntry, angleOffset float64, radiusScale float64) []botLegacySocketSlot {
	if len(source) == 0 {
		return nil
	}
	out := make([]botLegacySocketSlot, 0, len(source))
	for _, entry := range source {
		buildingType, ok := mapLegacySocketBuildingType(entry.legacyType)
		if !ok {
			continue
		}
		radius := float32(entry.radius * radiusScale)
		if radius <= 0 {
			continue
		}
		out = append(out, botLegacySocketSlot{
			Angle:        normalizeAngle(entry.angle + angleOffset),
			Radius:       radius,
			BuildingType: buildingType,
		})
	}
	return out
}

func mapLegacySocketBuildingType(legacyType int) (BuildingType, bool) {
	switch legacyType {
	case 1:
		return WALL, true
	case 2:
		return SIMPLE_TURRET, true
	case 3:
		return GENERATOR, true
	case 4:
		return HOUSE, true
	case 5:
		return SNIPER_TURRET, true
	case 7:
		return ARMORY, true
	case 8:
		return BARRACKS, true
	default:
		return 0, false
	}
}
