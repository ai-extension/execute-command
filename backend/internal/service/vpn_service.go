package service

import (
	"github.com/google/uuid"
	"github.com/user/csm-backend/internal/domain"
)

type VpnConfigService struct {
	repo domain.VpnConfigRepository
}

func NewVpnConfigService(repo domain.VpnConfigRepository) *VpnConfigService {
	return &VpnConfigService{repo: repo}
}

func (s *VpnConfigService) Create(vpn *domain.VpnConfig, user *domain.User) error {
	if vpn.ID == uuid.Nil {
		vpn.ID = uuid.New()
	}
	if user != nil {
		vpn.CreatedBy = &user.ID
		vpn.CreatedByUsername = user.Username
	}
	return s.repo.Create(vpn)
}

func (s *VpnConfigService) GetByID(id uuid.UUID, user *domain.User) (*domain.VpnConfig, error) {
	if user == nil {
		scope := domain.PermissionScope{IsGlobal: true}
		return s.repo.GetByID(id, &scope)
	}
	scope := domain.GetPermissionScope(user, "vpns", "READ")
	return s.repo.GetByID(id, &scope)
}

func (s *VpnConfigService) List(namespaceID *uuid.UUID, user *domain.User) ([]domain.VpnConfig, error) {
	if user == nil {
		scope := domain.PermissionScope{IsGlobal: true}
		return s.repo.List(namespaceID, &scope)
	}
	scope := domain.GetPermissionScope(user, "vpns", "READ")
	return s.repo.List(namespaceID, &scope)
}

func (s *VpnConfigService) ListPaginated(namespaceID *uuid.UUID, limit, offset int, searchTerm string, vpnType string, authType string, createdBy *uuid.UUID, user *domain.User) ([]domain.VpnConfig, int64, error) {
	if user == nil {
		scope := domain.PermissionScope{IsGlobal: true}
		return s.repo.ListPaginated(namespaceID, limit, offset, searchTerm, vpnType, authType, createdBy, &scope)
	}
	scope := domain.GetPermissionScope(user, "vpns", "READ")
	return s.repo.ListPaginated(namespaceID, limit, offset, searchTerm, vpnType, authType, createdBy, &scope)
}

func (s *VpnConfigService) Update(vpn *domain.VpnConfig, user *domain.User) error {
	var scope domain.PermissionScope
	if user == nil {
		scope = domain.PermissionScope{IsGlobal: true}
	} else {
		scope = domain.GetPermissionScope(user, "vpns", "WRITE")
	}
	existing, err := s.repo.GetByID(vpn.ID, &scope)
	if err != nil {
		return err
	}

	vpn.CreatedBy = existing.CreatedBy
	vpn.CreatedByUsername = existing.CreatedByUsername
	vpn.CreatedAt = existing.CreatedAt
	vpn.NamespaceID = existing.NamespaceID // preserve namespace on update

	// Credentials are never sent back to clients, so an omitted secret means "unchanged"
	// rather than "clear it" — Save would otherwise wipe the stored value.
	if vpn.Password == "" {
		vpn.Password = existing.Password
	}
	if vpn.PrivateKey == "" {
		vpn.PrivateKey = existing.PrivateKey
	}
	if vpn.ConfigFile == "" {
		vpn.ConfigFile = existing.ConfigFile
	}
	if vpn.SharedKey == "" {
		vpn.SharedKey = existing.SharedKey
	}

	return s.repo.Update(vpn)
}

func (s *VpnConfigService) Delete(id uuid.UUID, user *domain.User) error {
	var scope domain.PermissionScope
	if user == nil {
		scope = domain.PermissionScope{IsGlobal: true}
	} else {
		scope = domain.GetPermissionScope(user, "vpns", "DELETE")
	}
	_, err := s.repo.GetByID(id, &scope)
	if err != nil {
		return err
	}
	return s.repo.Delete(id)
}
