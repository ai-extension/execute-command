package service

import (
	"testing"

	"github.com/user/csm-backend/internal/domain"
)

func TestParseInputDateTime(t *testing.T) {
	cases := []struct {
		name        string
		inputType   string
		includeTime bool
		val         string
		wantErr     bool
	}{
		{"date ok", "date", false, "2026-08-19", false},
		{"date with time not allowed", "date", false, "2026-08-19T14:30", true},
		{"date invalid day", "date", false, "2026-02-30", true},
		{"datetime native format", "date", true, "2026-08-19T14:30", false},
		{"datetime with seconds", "date", true, "2026-08-19T14:30:05", false},
		{"datetime space separator", "date", true, "2026-08-19 14:30", false},
		{"datetime missing time", "date", true, "2026-08-19", true},
		{"datetime bad hour", "date", true, "2026-08-19T25:30", true},
		{"time ok", "time", false, "14:30", false},
		{"time with seconds", "time", false, "14:30:05", false},
		{"time bad minute", "time", false, "14:60", true},
		{"time empty", "time", false, "", true},
		{"time needs zero padding", "time", false, "7:30", true},
		{"date needs zero padding", "date", false, "2026-8-19", true},
		{"date year below 100 accepted", "date", false, "0050-01-01", false},
		{"templated value rejected", "date", false, "{{ my_var }}", true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := ParseInputDateTime(c.inputType, c.includeTime, c.val)
			if (err != nil) != c.wantErr {
				t.Fatalf("ParseInputDateTime(%q, %v, %q) error = %v, wantErr = %v", c.inputType, c.includeTime, c.val, err, c.wantErr)
			}
		})
	}
}

func TestInputDateTimeFormatHint(t *testing.T) {
	if got := InputDateTimeFormatHint("date", false); got != "YYYY-MM-DD" {
		t.Fatalf("date hint = %q", got)
	}
	if got := InputDateTimeFormatHint("date", true); got != "YYYY-MM-DDTHH:MM" {
		t.Fatalf("datetime hint = %q", got)
	}
	if got := InputDateTimeFormatHint("time", false); got != "HH:MM" {
		t.Fatalf("time hint = %q", got)
	}
}

func TestValidateInputsMultiInputDateTime(t *testing.T) {
	config := `[{"id":"1","key":"day","label":"Day","type":"date"},{"id":"2","key":"at","label":"At","type":"date","include_time":true},{"id":"3","key":"note","label":"Note","type":"input"}]`
	wf := &domain.Workflow{
		Inputs: []domain.WorkflowInput{
			{Key: "rows", Label: "Rows", Type: "multi-input", DefaultValue: config},
		},
	}
	e := &WorkflowExecutor{}

	cases := []struct {
		name    string
		rows    string
		wantErr bool
	}{
		{"valid row", `[{"day":"2026-08-19","at":"2026-08-19T14:30","note":"hello"}]`, false},
		{"empty date field skipped", `[{"day":"","note":"hello"}]`, false},
		{"bad date", `[{"day":"19/08/2026"}]`, true},
		{"date field given a datetime", `[{"day":"2026-08-19T14:30"}]`, true},
		{"datetime field missing time", `[{"at":"2026-08-19"}]`, true},
		{"second row invalid", `[{"day":"2026-08-19"},{"day":"2026-02-30"}]`, true},
		{"untyped field keeps char check", `[{"note":"still fine 2026"}]`, false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := e.validateInputs(wf, map[string]string{"rows": c.rows})
			if (err != nil) != c.wantErr {
				t.Fatalf("validateInputs(%s) error = %v, wantErr = %v", c.rows, err, c.wantErr)
			}
		})
	}
}

func TestValidateInputsMultiInputLegacyConfig(t *testing.T) {
	// Legacy comma-separated field list: no field is typed, so a date-looking value is
	// only character-checked (no format error).
	wf := &domain.Workflow{
		Inputs: []domain.WorkflowInput{
			{Key: "rows", Label: "Rows", Type: "multi-input", DefaultValue: "day,note"},
		},
	}
	if err := (&WorkflowExecutor{}).validateInputs(wf, map[string]string{"rows": `[{"day":"19/08/2026"}]`}); err != nil {
		t.Fatalf("legacy multi-input config should not be format-checked, got %v", err)
	}
}
