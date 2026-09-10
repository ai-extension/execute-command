package handler

import "testing"

func TestMarkCredentialChangeRecordsOnlyThatItChanged(t *testing.T) {
	diff := markCredentialChange(nil, "password", true)
	if diff["password"] != "changed" {
		t.Fatalf("expected a value-free marker, got %v", diff)
	}
}

func TestMarkCredentialChangeLeavesUntouchedWritesAlone(t *testing.T) {
	if diff := markCredentialChange(nil, "password", false); diff != nil {
		t.Fatalf("expected no marker when nothing was submitted, got %v", diff)
	}

	existing := map[string]interface{}{"name": "s1"}
	diff := markCredentialChange(existing, "private_key", false)
	if _, present := diff["private_key"]; present {
		t.Fatalf("expected the diff to stay unchanged, got %v", diff)
	}
	if diff["name"] != "s1" {
		t.Fatalf("expected existing entries to survive, got %v", diff)
	}
}
