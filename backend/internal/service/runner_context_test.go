package service

import (
	"testing"

	"github.com/google/uuid"
	"github.com/user/csm-backend/internal/domain"
)

func TestRunnerContextNilUser(t *testing.T) {
	ctx := runnerContext(nil)
	for _, key := range []string{"id", "username", "full_name", "nickname", "email", "chat_account_id"} {
		v, ok := ctx[key]
		if !ok {
			t.Fatalf("key %q missing for a run with no user", key)
		}
		if v != "" {
			t.Fatalf("key %q = %q, want empty", key, v)
		}
	}
}

func TestRunnerContextUserFields(t *testing.T) {
	id := uuid.New()
	ctx := runnerContext(&domain.User{
		ID:            id,
		Username:      "dee",
		FullName:      "Dee Nguyen",
		Nickname:      "Dee",
		Email:         "dee@example.com",
		ChatAccountID: "U01ABCDEF",
	})

	want := map[string]string{
		"id":              id.String(),
		"username":        "dee",
		"full_name":       "Dee Nguyen",
		"nickname":        "Dee",
		"email":           "dee@example.com",
		"chat_account_id": "U01ABCDEF",
	}
	for k, v := range want {
		if ctx[k] != v {
			t.Errorf("user.%s = %q, want %q", k, ctx[k], v)
		}
	}
}

func TestRunnerContextDropsUnsafeValue(t *testing.T) {
	ctx := runnerContext(&domain.User{Nickname: "dee`whoami`"})
	if ctx["nickname"] != "" {
		t.Errorf("nickname = %q, want empty for a value the sanitizer rejects", ctx["nickname"])
	}
}
