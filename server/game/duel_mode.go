package game

type X1DuelMode byte

const (
	X1DuelModeCurrentBase     X1DuelMode = 0
	X1DuelModeTraditionalBase X1DuelMode = 1
)

func NormalizeX1DuelMode(raw byte) X1DuelMode {
	if X1DuelMode(raw) == X1DuelModeTraditionalBase {
		return X1DuelModeTraditionalBase
	}
	return X1DuelModeCurrentBase
}

func ResolveX1DuelMode(challengerMode X1DuelMode, targetMode X1DuelMode) X1DuelMode {
	if challengerMode == X1DuelModeTraditionalBase && targetMode == X1DuelModeTraditionalBase {
		return X1DuelModeTraditionalBase
	}
	return X1DuelModeCurrentBase
}
