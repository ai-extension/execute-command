package service

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/user/csm-backend/internal/domain"
)

type fakeVpnRepo struct {
	stored *domain.VpnConfig
	saved  *domain.VpnConfig
}

func (f *fakeVpnRepo) Create(*domain.VpnConfig) error { return nil }
func (f *fakeVpnRepo) GetByID(uuid.UUID, *domain.PermissionScope) (*domain.VpnConfig, error) {
	if f.stored == nil {
		return nil, errors.New("not found")
	}
	clone := *f.stored
	return &clone, nil
}
func (f *fakeVpnRepo) List(*uuid.UUID, *domain.PermissionScope) ([]domain.VpnConfig, error) {
	return nil, nil
}
func (f *fakeVpnRepo) ListPaginated(*uuid.UUID, int, int, string, string, string, *uuid.UUID, *domain.PermissionScope) ([]domain.VpnConfig, int64, error) {
	return nil, 0, nil
}
func (f *fakeVpnRepo) Update(vpn *domain.VpnConfig) error {
	f.saved = vpn
	return nil
}
func (f *fakeVpnRepo) Delete(uuid.UUID) error { return nil }

func storedVpn() *domain.VpnConfig {
	return &domain.VpnConfig{
		ID: uuid.New(), Name: "vpn-1", Host: "vpn.example.com", VpnType: "OPENVPN",
		Password: "STORED_PW", PrivateKey: "STORED_KEY", ConfigFile: "STORED_OVPN", SharedKey: "STORED_SHARED",
	}
}

func TestVpnUpdateKeepsSecretsThatWereNotResubmitted(t *testing.T) {
	// Clients no longer receive credentials, so an omitted field means "unchanged".
	existing := storedVpn()
	repo := &fakeVpnRepo{stored: existing}
	svc := NewVpnConfigService(repo)

	incoming := &domain.VpnConfig{ID: existing.ID, Name: "vpn-renamed", Host: "vpn2.example.com", VpnType: "OPENVPN"}
	if err := svc.Update(incoming, nil); err != nil {
		t.Fatalf("update: %v", err)
	}

	if repo.saved.Password != "STORED_PW" || repo.saved.PrivateKey != "STORED_KEY" ||
		repo.saved.ConfigFile != "STORED_OVPN" || repo.saved.SharedKey != "STORED_SHARED" {
		t.Fatalf("credentials must survive an update that omits them, got %+v", repo.saved)
	}
	if repo.saved.Name != "vpn-renamed" || repo.saved.Host != "vpn2.example.com" {
		t.Fatalf("editable fields must still be applied, got %+v", repo.saved)
	}
}

func TestVpnUpdateAppliesSecretsThatWereSubmitted(t *testing.T) {
	existing := storedVpn()
	repo := &fakeVpnRepo{stored: existing}
	svc := NewVpnConfigService(repo)

	incoming := &domain.VpnConfig{ID: existing.ID, Name: "vpn-1", Password: "NEW_PW", ConfigFile: "NEW_OVPN"}
	if err := svc.Update(incoming, nil); err != nil {
		t.Fatalf("update: %v", err)
	}

	if repo.saved.Password != "NEW_PW" || repo.saved.ConfigFile != "NEW_OVPN" {
		t.Fatalf("submitted credentials must replace the stored ones, got %+v", repo.saved)
	}
	if repo.saved.PrivateKey != "STORED_KEY" || repo.saved.SharedKey != "STORED_SHARED" {
		t.Fatalf("untouched credentials must survive, got %+v", repo.saved)
	}
}
