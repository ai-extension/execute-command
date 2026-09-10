package service

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/user/csm-backend/internal/domain"
	"google.golang.org/api/idtoken"
)

var errNotFound = errors.New("record not found")

type fakeUserRepo struct {
	bySocialID map[string]*domain.User
	byEmail    map[string]*domain.User
	created    []*domain.User
	setRoles   map[uuid.UUID][]domain.Role
	updated    []*domain.User
}

func newFakeUserRepo() *fakeUserRepo {
	return &fakeUserRepo{
		bySocialID: map[string]*domain.User{},
		byEmail:    map[string]*domain.User{},
		setRoles:   map[uuid.UUID][]domain.Role{},
	}
}

func (f *fakeUserRepo) Create(user *domain.User) error {
	f.created = append(f.created, user)
	f.bySocialID[user.SocialProvider+"|"+user.SocialID] = user
	f.byEmail[user.Email] = user
	return nil
}
func (f *fakeUserRepo) GetByID(id uuid.UUID) (*domain.User, error) {
	for _, u := range f.byEmail {
		if u.ID == id {
			return u, nil
		}
	}
	return nil, errNotFound
}
func (f *fakeUserRepo) GetByUsername(string) (*domain.User, error) { return nil, errNotFound }
func (f *fakeUserRepo) GetByEmail(email string) (*domain.User, error) {
	if u, ok := f.byEmail[email]; ok {
		return u, nil
	}
	return nil, errNotFound
}
func (f *fakeUserRepo) GetBySocialID(provider, socialID string) (*domain.User, error) {
	if u, ok := f.bySocialID[provider+"|"+socialID]; ok {
		return u, nil
	}
	return nil, errNotFound
}
func (f *fakeUserRepo) List() ([]domain.User, error) { return nil, nil }
func (f *fakeUserRepo) ListPaginated(int, int, string, *uuid.UUID) ([]domain.User, int64, error) {
	return nil, 0, nil
}
func (f *fakeUserRepo) Update(user *domain.User) error {
	f.updated = append(f.updated, user)
	return nil
}
func (f *fakeUserRepo) Delete(uuid.UUID) error { return nil }
func (f *fakeUserRepo) SetRoles(userID uuid.UUID, roles []domain.Role) error {
	f.setRoles[userID] = roles
	return nil
}

type fakeMappingRepo struct {
	byDomain map[string]*domain.DomainRoleMapping
}

func (f *fakeMappingRepo) Create(*domain.DomainRoleMapping) error { return nil }
func (f *fakeMappingRepo) GetByID(uuid.UUID) (*domain.DomainRoleMapping, error) {
	return nil, errNotFound
}
func (f *fakeMappingRepo) GetByDomain(d string) (*domain.DomainRoleMapping, error) {
	if m, ok := f.byDomain[d]; ok {
		return m, nil
	}
	return nil, errNotFound
}
func (f *fakeMappingRepo) List() ([]domain.DomainRoleMapping, error) { return nil, nil }
func (f *fakeMappingRepo) Update(*domain.DomainRoleMapping) error    { return nil }
func (f *fakeMappingRepo) Delete(uuid.UUID) error                    { return nil }

type fakeSettingsRepo struct {
	values map[string]string
}

func (f *fakeSettingsRepo) GetByKey(key string) (*domain.SystemSetting, error) {
	if v, ok := f.values[key]; ok {
		return &domain.SystemSetting{Key: key, Value: v}, nil
	}
	return nil, errNotFound
}
func (f *fakeSettingsRepo) Upsert(*domain.SystemSetting) error    { return nil }
func (f *fakeSettingsRepo) List() ([]domain.SystemSetting, error) { return nil, nil }

type serviceFixture struct {
	svc      *GoogleAuthService
	users    *fakeUserRepo
	mappings *fakeMappingRepo
	role     domain.Role
}

func newFixture(t *testing.T, mapping *domain.DomainRoleMapping, payload *idtoken.Payload, validateErr error) *serviceFixture {
	t.Helper()

	role := domain.Role{ID: uuid.New(), Name: "Operator"}
	if mapping != nil && mapping.Role == nil {
		mapping.Role = &role
		mapping.RoleID = role.ID
	}

	mappings := &fakeMappingRepo{byDomain: map[string]*domain.DomainRoleMapping{}}
	if mapping != nil {
		mappings.byDomain[mapping.Domain] = mapping
	}

	users := newFakeUserRepo()
	settingsRepo := &fakeSettingsRepo{values: map[string]string{
		"google_auth_enabled": "true",
		"google_client_id":    "client-id.apps.googleusercontent.com",
		"token_expiration":    "24",
	}}
	settings := NewSettingsService(settingsRepo)
	auth := NewAuthService(users, settingsRepo, mappings)

	svc := NewGoogleAuthService(users, mappings, settings, auth)
	svc.validate = func(context.Context, string, string) (*idtoken.Payload, error) {
		return payload, validateErr
	}

	return &serviceFixture{svc: svc, users: users, mappings: mappings, role: role}
}

func workspacePayload(sub, email, hd string, verified bool) *idtoken.Payload {
	return &idtoken.Payload{
		Subject: sub,
		Claims: map[string]interface{}{
			"email":          email,
			"email_verified": verified,
			"hd":             hd,
			"name":           "Test User",
			"picture":        "https://example.com/a.png",
		},
	}
}

func enabledMapping(domainName string) *domain.DomainRoleMapping {
	return &domain.DomainRoleMapping{
		ID:            uuid.New(),
		Domain:        domainName,
		AutoProvision: true,
		Enabled:       true,
	}
}

func TestLoginWithGoogleProvisionsUserAndAssignsMappedRole(t *testing.T) {
	f := newFixture(t, enabledMapping("air-closet.com"),
		workspacePayload("sub-1", "dee@air-closet.com", "air-closet.com", true), nil)

	_, user, err := f.svc.LoginWithGoogle(context.Background(), "token")
	if err != nil {
		t.Fatalf("expected sign-in to succeed, got %v", err)
	}
	if len(f.users.created) != 1 {
		t.Fatalf("expected 1 user created, got %d", len(f.users.created))
	}
	roles := f.users.setRoles[user.ID]
	if len(roles) != 1 || roles[0].ID != f.role.ID {
		t.Fatalf("expected mapped role assigned, got %+v", roles)
	}
}

func TestLoginWithGoogleRejectsUnmappedDomain(t *testing.T) {
	f := newFixture(t, enabledMapping("air-closet.com"),
		workspacePayload("sub-2", "someone@other.com", "other.com", true), nil)

	if _, _, err := f.svc.LoginWithGoogle(context.Background(), "token"); !errors.Is(err, ErrDomainNotAllowed) {
		t.Fatalf("expected ErrDomainNotAllowed, got %v", err)
	}
	if len(f.users.created) != 0 {
		t.Fatal("a rejected domain must not provision a user")
	}
}

func TestLoginWithGoogleRejectsConsumerAccountWithoutHostedDomain(t *testing.T) {
	// A consumer Google account registered with a company address carries no `hd`
	// claim and is not managed by the company.
	f := newFixture(t, enabledMapping("air-closet.com"),
		workspacePayload("sub-3", "dee@air-closet.com", "", true), nil)

	if _, _, err := f.svc.LoginWithGoogle(context.Background(), "token"); !errors.Is(err, ErrDomainNotAllowed) {
		t.Fatalf("expected ErrDomainNotAllowed, got %v", err)
	}
}

func TestLoginWithGoogleAllowsConsumerAccountWhenMappingOptsIn(t *testing.T) {
	mapping := enabledMapping("air-closet.com")
	mapping.AllowNonWorkspace = true
	f := newFixture(t, mapping, workspacePayload("sub-4", "dee@air-closet.com", "", true), nil)

	if _, _, err := f.svc.LoginWithGoogle(context.Background(), "token"); err != nil {
		t.Fatalf("expected sign-in to succeed, got %v", err)
	}
}

func TestLoginWithGoogleRejectsUnverifiedEmail(t *testing.T) {
	f := newFixture(t, enabledMapping("air-closet.com"),
		workspacePayload("sub-5", "dee@air-closet.com", "air-closet.com", false), nil)

	if _, _, err := f.svc.LoginWithGoogle(context.Background(), "token"); !errors.Is(err, ErrEmailNotVerified) {
		t.Fatalf("expected ErrEmailNotVerified, got %v", err)
	}
}

func TestLoginWithGoogleRejectsInvalidToken(t *testing.T) {
	f := newFixture(t, enabledMapping("air-closet.com"), nil, errors.New("bad signature"))

	if _, _, err := f.svc.LoginWithGoogle(context.Background(), "token"); !errors.Is(err, ErrInvalidGoogleToken) {
		t.Fatalf("expected ErrInvalidGoogleToken, got %v", err)
	}
}

func TestLoginWithGoogleLinksExistingLocalAccountInsteadOfDuplicating(t *testing.T) {
	f := newFixture(t, enabledMapping("air-closet.com"),
		workspacePayload("sub-6", "dee@air-closet.com", "air-closet.com", true), nil)

	existing := &domain.User{ID: uuid.New(), Username: "dee", Email: "dee@air-closet.com", PasswordHash: "hash"}
	f.users.byEmail[existing.Email] = existing

	_, user, err := f.svc.LoginWithGoogle(context.Background(), "token")
	if err != nil {
		t.Fatalf("expected sign-in to succeed, got %v", err)
	}
	if user.ID != existing.ID {
		t.Fatalf("expected the existing account to be adopted, got a different user")
	}
	if len(f.users.created) != 0 {
		t.Fatal("linking must not create a second account")
	}
	if user.Username != "dee" || user.PasswordHash != "hash" {
		t.Fatal("linking must not overwrite the local credentials")
	}
	if _, assigned := f.users.setRoles[user.ID]; assigned {
		t.Fatal("an existing account must keep its roles when sync_on_login is off")
	}
}

func TestLoginWithGoogleSyncsRolesWhenMappingRequestsIt(t *testing.T) {
	mapping := enabledMapping("air-closet.com")
	mapping.SyncOnLogin = true
	f := newFixture(t, mapping, workspacePayload("sub-7", "dee@air-closet.com", "air-closet.com", true), nil)

	existing := &domain.User{ID: uuid.New(), Username: "dee", Email: "dee@air-closet.com"}
	f.users.byEmail[existing.Email] = existing

	if _, _, err := f.svc.LoginWithGoogle(context.Background(), "token"); err != nil {
		t.Fatalf("expected sign-in to succeed, got %v", err)
	}
	if roles := f.users.setRoles[existing.ID]; len(roles) != 1 {
		t.Fatalf("expected the mapped role re-applied, got %+v", roles)
	}
}

func TestLoginWithGoogleRefusesWhenProvisioningIsDisabled(t *testing.T) {
	mapping := enabledMapping("air-closet.com")
	mapping.AutoProvision = false
	f := newFixture(t, mapping, workspacePayload("sub-8", "new@air-closet.com", "air-closet.com", true), nil)

	if _, _, err := f.svc.LoginWithGoogle(context.Background(), "token"); !errors.Is(err, ErrProvisioningDisabled) {
		t.Fatalf("expected ErrProvisioningDisabled, got %v", err)
	}
}

func TestLoginWithGoogleRefusesWhenDisabledOrUnconfigured(t *testing.T) {
	f := newFixture(t, enabledMapping("air-closet.com"),
		workspacePayload("sub-9", "dee@air-closet.com", "air-closet.com", true), nil)

	settings := &fakeSettingsRepo{values: map[string]string{"google_auth_enabled": "false"}}
	f.svc.settings = NewSettingsService(settings)
	if _, _, err := f.svc.LoginWithGoogle(context.Background(), "token"); !errors.Is(err, ErrGoogleLoginDisabled) {
		t.Fatalf("expected ErrGoogleLoginDisabled, got %v", err)
	}

	settings.values = map[string]string{"google_auth_enabled": "true", "google_client_id": ""}
	if _, _, err := f.svc.LoginWithGoogle(context.Background(), "token"); !errors.Is(err, ErrGoogleNotConfigured) {
		t.Fatalf("expected ErrGoogleNotConfigured, got %v", err)
	}
}

func TestLoginWithGoogleRefusesWhenMappedRoleWasDeleted(t *testing.T) {
	// Roles are soft-deleted, so GetByDomain still returns the mapping but cannot
	// preload the role. Signing in would otherwise yield a session with no permissions.
	mapping := enabledMapping("air-closet.com")
	f := newFixture(t, mapping, workspacePayload("sub-11", "dee@air-closet.com", "air-closet.com", true), nil)
	mapping.Role = nil

	if _, _, err := f.svc.LoginWithGoogle(context.Background(), "token"); !errors.Is(err, ErrMappingRoleMissing) {
		t.Fatalf("expected ErrMappingRoleMissing, got %v", err)
	}
	if len(f.users.created) != 0 {
		t.Fatal("a mapping without a role must not provision a user")
	}
}

func TestLoginWithGoogleRefusesAccountOwnedByAnotherGoogleIdentity(t *testing.T) {
	// The address was reassigned to a new employee: inheriting the previous holder's
	// account and roles must be an administrative act, not a silent side effect.
	f := newFixture(t, enabledMapping("air-closet.com"),
		workspacePayload("new-sub", "shared@air-closet.com", "air-closet.com", true), nil)

	previous := &domain.User{
		ID: uuid.New(), Username: "shared@air-closet.com", Email: "shared@air-closet.com",
		SocialProvider: googleProvider, SocialID: "old-sub",
	}
	f.users.byEmail[previous.Email] = previous

	if _, _, err := f.svc.LoginWithGoogle(context.Background(), "token"); !errors.Is(err, ErrAccountLinkedToOther) {
		t.Fatalf("expected ErrAccountLinkedToOther, got %v", err)
	}
	if len(f.users.created) != 0 {
		t.Fatal("the sign-in must not fork a second account either")
	}
}

func TestLoginWithGoogleRejectsDisabledMapping(t *testing.T) {
	mapping := enabledMapping("air-closet.com")
	mapping.Enabled = false
	f := newFixture(t, mapping, workspacePayload("sub-10", "dee@air-closet.com", "air-closet.com", true), nil)

	if _, _, err := f.svc.LoginWithGoogle(context.Background(), "token"); !errors.Is(err, ErrDomainNotAllowed) {
		t.Fatalf("expected ErrDomainNotAllowed, got %v", err)
	}
}

func TestRegisterRefusesAddressInAGoogleMappedDomain(t *testing.T) {
	// Registering as boss@air-closet.com would pre-claim the account that the real
	// boss's first Google sign-in links to.
	mapping := enabledMapping("air-closet.com")
	mappings := &fakeMappingRepo{byDomain: map[string]*domain.DomainRoleMapping{mapping.Domain: mapping}}
	users := newFakeUserRepo()
	settings := &fakeSettingsRepo{values: map[string]string{"allow_registration": "true"}}
	auth := NewAuthService(users, settings, mappings)

	if _, err := auth.Register("mallory", "secret123", "boss@air-closet.com"); err == nil {
		t.Fatal("expected registration in a mapped domain to be refused")
	}
	if len(users.created) != 0 {
		t.Fatal("no account may be created for a managed address")
	}

	// An unmapped domain is still free to register.
	if _, err := auth.Register("mallory", "secret123", "mallory@personal.com"); err != nil {
		t.Fatalf("expected registration outside mapped domains to succeed, got %v", err)
	}
}
