package game

import "testing"

func TestAvailableIDsReuseLowestReturnedIDFirst(t *testing.T) {
	ids := InitAvailableIDs(4)

	first, ok := ids.getNextAvailableID()
	if !ok || first != 0 {
		t.Fatalf("first id = %d, ok = %t, want 0, true", first, ok)
	}

	second, ok := ids.getNextAvailableID()
	if !ok || second != 1 {
		t.Fatalf("second id = %d, ok = %t, want 1, true", second, ok)
	}

	ids.returnID(first)

	reused, ok := ids.getNextAvailableID()
	if !ok || reused != first {
		t.Fatalf("reused id = %d, ok = %t, want %d, true", reused, ok, first)
	}
}

func TestAvailableIDsIgnoreDuplicateReturns(t *testing.T) {
	ids := InitAvailableIDs(2)

	first, ok := ids.getNextAvailableID()
	if !ok || first != 0 {
		t.Fatalf("first id = %d, ok = %t, want 0, true", first, ok)
	}

	ids.returnID(first)
	ids.returnID(first)

	reused, ok := ids.getNextAvailableID()
	if !ok || reused != first {
		t.Fatalf("reused id = %d, ok = %t, want %d, true", reused, ok, first)
	}

	next, ok := ids.getNextAvailableID()
	if !ok || next != 1 {
		t.Fatalf("next id = %d, ok = %t, want 1, true", next, ok)
	}

	if _, ok := ids.getNextAvailableID(); ok {
		t.Fatal("expected allocator to be empty after consuming all ids")
	}
}
