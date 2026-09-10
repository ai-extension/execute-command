package domain

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestServerJSONNeverCarriesCredentials(t *testing.T) {
	server := Server{
		ID:         uuid.New(),
		Name:       "prod-1",
		Host:       "10.0.0.1",
		User:       "root",
		AuthType:   "PASSWORD",
		Password:   "SUPER_SECRET_PW",
		PrivateKey: "SUPER_SECRET_KEY",
	}

	raw, err := json.Marshal(server)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	body := string(raw)

	for _, secret := range []string{"SUPER_SECRET_PW", "SUPER_SECRET_KEY"} {
		if strings.Contains(body, secret) {
			t.Fatalf("credential leaked into JSON: %s", body)
		}
	}

	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, present := decoded["password"]; present {
		t.Fatal("password key must be absent")
	}
	if _, present := decoded["private_key"]; present {
		t.Fatal("private_key key must be absent")
	}
	if decoded["has_password"] != true || decoded["has_private_key"] != true {
		t.Fatalf("expected has_* flags to report stored credentials, got %v", decoded)
	}
	if decoded["host"] != "10.0.0.1" {
		t.Fatalf("non-sensitive fields must survive, got %v", decoded["host"])
	}
}

func TestServerJSONFlagsAreFalseWithoutCredentials(t *testing.T) {
	raw, err := json.Marshal(Server{Name: "local", AuthType: "NONE"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded map[string]any
	_ = json.Unmarshal(raw, &decoded)
	if decoded["has_password"] != false || decoded["has_private_key"] != false {
		t.Fatalf("expected both flags false, got %v", decoded)
	}
}

func TestServerPointerAndNestedVpnAreAlsoRedacted(t *testing.T) {
	// The nested VPN is the path that leaked through the server list endpoint.
	server := &Server{
		Name:     "prod-1",
		Password: "SRV_PW",
		Vpn: &VpnConfig{
			Name:       "vpn-1",
			Password:   "VPN_PW",
			PrivateKey: "VPN_KEY",
			ConfigFile: "VPN_OVPN",
			SharedKey:  "VPN_SHARED",
			PublicKey:  "wg-public-key",
		},
	}

	raw, err := json.Marshal(server)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	body := string(raw)

	for _, secret := range []string{"SRV_PW", "VPN_PW", "VPN_KEY", "VPN_OVPN", "VPN_SHARED"} {
		if strings.Contains(body, secret) {
			t.Fatalf("credential leaked into JSON: %s", body)
		}
	}
	// A WireGuard public key is not a secret and must stay readable.
	if !strings.Contains(body, "wg-public-key") {
		t.Fatalf("public key should stay visible: %s", body)
	}
}

func TestVpnConfigJSONReportsWhichSecretsExist(t *testing.T) {
	raw, err := json.Marshal(VpnConfig{Name: "vpn-1", ConfigFile: "VPN_OVPN"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded map[string]any
	_ = json.Unmarshal(raw, &decoded)
	if _, present := decoded["config_file"]; present {
		t.Fatal("config_file must be absent")
	}
	if decoded["has_config_file"] != true {
		t.Fatalf("expected has_config_file true, got %v", decoded)
	}
	if decoded["has_password"] != false || decoded["has_shared_key"] != false {
		t.Fatalf("expected the other flags false, got %v", decoded)
	}
}

func TestCredentialsStillUnmarshalFromClientPayloads(t *testing.T) {
	// Hiding the fields on the way out must not stop create/update from accepting them.
	var server Server
	if err := json.Unmarshal([]byte(`{"name":"s","password":"pw","private_key":"key"}`), &server); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if server.Password != "pw" || server.PrivateKey != "key" {
		t.Fatalf("expected credentials to bind, got %+v", server)
	}

	var vpn VpnConfig
	if err := json.Unmarshal([]byte(`{"name":"v","config_file":"body","shared_key":"sk"}`), &vpn); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if vpn.ConfigFile != "body" || vpn.SharedKey != "sk" {
		t.Fatalf("expected credentials to bind, got %+v", vpn)
	}
}

func TestPageJSONHidesThePasswordHash(t *testing.T) {
	// The hash doubles as the page-token HMAC key when PAGE_TOKEN_SECRET is unset, so
	// leaking it to anyone with pages:READ would let them mint page tokens.
	raw, err := json.Marshal(Page{Title: "p1", Slug: "p1", IsPublic: true, Password: "$2a$10$abcdefghijklmnop"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(raw), "$2a$10$") {
		t.Fatalf("password hash leaked into JSON: %s", raw)
	}

	var decoded map[string]any
	_ = json.Unmarshal(raw, &decoded)
	if _, present := decoded["password"]; present {
		t.Fatal("password key must be absent")
	}
	if decoded["has_password"] != true {
		t.Fatalf("expected has_password true, got %v", decoded)
	}
}

func TestPagePasswordStillUnmarshalsForWrites(t *testing.T) {
	// The designer sends the sentinel to clear a password; writes must keep working.
	var page Page
	if err := json.Unmarshal([]byte(`{"title":"p","password":"__CLEAR_PASSWORD__"}`), &page); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if page.Password != "__CLEAR_PASSWORD__" {
		t.Fatalf("expected the sentinel to bind, got %q", page.Password)
	}
}

func TestSecretGlobalVariableHidesItsValue(t *testing.T) {
	raw, err := json.Marshal(GlobalVariable{Key: "DB_PW", Value: "GLOBALVAR_SECRET", IsSecret: true})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(raw), "GLOBALVAR_SECRET") {
		t.Fatalf("secret value leaked into JSON: %s", raw)
	}

	var decoded map[string]any
	_ = json.Unmarshal(raw, &decoded)
	if decoded["value"] != "" {
		t.Fatalf("expected an empty value, got %v", decoded["value"])
	}
	if decoded["has_value"] != true || decoded["is_secret"] != true {
		t.Fatalf("expected has_value and is_secret true, got %v", decoded)
	}
}

func TestOrdinaryGlobalVariableKeepsItsValue(t *testing.T) {
	// Seeing the value is the whole point of the variables screen; only secrets hide it.
	raw, err := json.Marshal(GlobalVariable{Key: "REGION", Value: "ap-northeast-1"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded map[string]any
	_ = json.Unmarshal(raw, &decoded)
	if decoded["value"] != "ap-northeast-1" {
		t.Fatalf("expected the value to stay readable, got %v", decoded["value"])
	}
	if decoded["is_secret"] != false || decoded["has_value"] != true {
		t.Fatalf("unexpected flags: %v", decoded)
	}
}
