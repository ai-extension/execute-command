package service

import (
	"github.com/google/uuid"
	"github.com/user/csm-backend/internal/domain"
)

type GlobalVariableService struct {
	repo domain.GlobalVariableRepository
}

func NewGlobalVariableService(repo domain.GlobalVariableRepository) *GlobalVariableService {
	return &GlobalVariableService{repo: repo}
}

func (s *GlobalVariableService) Create(gv *domain.GlobalVariable, user *domain.User) error {
	gv.ID = uuid.New()
	if user != nil {
		gv.CreatedBy = &user.ID
		gv.CreatedByUsername = user.Username
	}
	return s.repo.Create(gv)
}

func (s *GlobalVariableService) GetByID(id uuid.UUID, user *domain.User) (*domain.GlobalVariable, error) {
	return s.GetByIDWithAction(id, user, "READ")
}

func (s *GlobalVariableService) GetByIDWithAction(id uuid.UUID, user *domain.User, action string) (*domain.GlobalVariable, error) {
	scope := domain.GetPermissionScope(user, "variables", action)
	return s.repo.GetByID(id, &scope)
}

func (s *GlobalVariableService) List(namespaceID uuid.UUID, user *domain.User) ([]domain.GlobalVariable, error) {
	scope := domain.GetPermissionScope(user, "namespaces", "READ")
	return s.repo.List(namespaceID, &scope)
}

func (s *GlobalVariableService) ListPaginated(namespaceID uuid.UUID, limit, offset int, searchTerm string, createdBy *uuid.UUID, user *domain.User) ([]domain.GlobalVariable, int64, error) {
	scope := domain.GetPermissionScope(user, "namespaces", "READ")
	return s.repo.ListPaginated(namespaceID, limit, offset, searchTerm, createdBy, &scope)
}
func (s *GlobalVariableService) Update(gv *domain.GlobalVariable, user *domain.User) error {
	scope := domain.GetPermissionScope(user, "namespaces", "WRITE")
	existing, err := s.repo.GetByID(gv.ID, &scope)
	if err != nil {
		return err
	}

	// Merge fields from partial gv into existing record
	if gv.Key != "" {
		existing.Key = gv.Key
	}
	// A secret value is never sent back to the client, so an empty value means
	// "unchanged" rather than "clear it".
	if gv.Value != "" {
		existing.Value = gv.Value
	}
	if gv.Description != "" {
		existing.Description = gv.Description
	}
	existing.IsSecret = gv.IsSecret

	return s.repo.Update(existing)
}

func (s *GlobalVariableService) Delete(id uuid.UUID, user *domain.User) error {
	scope := domain.GetPermissionScope(user, "namespaces", "WRITE")
	_, err := s.repo.GetByID(id, &scope)
	if err != nil {
		return err
	}
	return s.repo.Delete(id)
}
