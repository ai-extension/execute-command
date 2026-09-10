package service

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/user/csm-backend/internal/domain"
	"google.golang.org/api/idtoken"
)

// googleProvider is the value stored in User.SocialProvider for Google identities.
const googleProvider = "google"

var (
	ErrGoogleLoginDisabled  = errors.New("google login is disabled")
	ErrGoogleNotConfigured  = errors.New("google client id is not configured")
	ErrInvalidGoogleToken   = errors.New("invalid google token")
	ErrEmailNotVerified     = errors.New("google account email is not verified")
	ErrDomainNotAllowed     = errors.New("this google domain is not allowed to sign in")
	ErrProvisioningDisabled = errors.New("no account exists for this google user")
	ErrMappingRoleMissing   = errors.New("the role mapped to this domain no longer exists")
	ErrAccountLinkedToOther = errors.New("this account is already linked to a different google identity")
)

// googleTokenValidator matches idtoken.Validate so tests can inject a stub payload.
type googleTokenValidator func(ctx context.Context, token, audience string) (*idtoken.Payload, error)

type GoogleAuthService struct {
	userRepo    domain.UserRepository
	mappingRepo domain.DomainRoleMappingRepository
	settings    *SettingsService
	auth        *AuthService
	validate    googleTokenValidator
}

func NewGoogleAuthService(
	userRepo domain.UserRepository,
	mappingRepo domain.DomainRoleMappingRepository,
	settings *SettingsService,
	auth *AuthService,
) *GoogleAuthService {
	return &GoogleAuthService{
		userRepo:    userRepo,
		mappingRepo: mappingRepo,
		settings:    settings,
		auth:        auth,
		validate:    idtoken.Validate,
	}
}

// LoginWithGoogle verifies a Google ID token issued to this application, resolves the
// signing-in domain to a role, and returns a CSM session token. It never trusts any
// identity attribute that is not carried inside the verified token.
func (s *GoogleAuthService) LoginWithGoogle(ctx context.Context, rawIDToken string) (string, *domain.User, error) {
	if enabled, _ := s.settings.GetSetting("google_auth_enabled"); enabled != "true" {
		return "", nil, ErrGoogleLoginDisabled
	}

	clientID, _ := s.settings.GetSetting("google_client_id")
	clientID = strings.TrimSpace(clientID)
	if clientID == "" {
		return "", nil, ErrGoogleNotConfigured
	}

	// Validate checks the signature against Google's keys, the issuer, the expiry and
	// that `aud` is exactly our client id.
	payload, err := s.validate(ctx, rawIDToken, clientID)
	if err != nil {
		return "", nil, ErrInvalidGoogleToken
	}

	email := strings.ToLower(strings.TrimSpace(claimString(payload, "email")))
	if email == "" || !claimBool(payload, "email_verified") {
		return "", nil, ErrEmailNotVerified
	}

	mapping, err := s.resolveMapping(payload, email)
	if err != nil {
		return "", nil, err
	}

	user, isNew, err := s.resolveUser(payload, email, mapping)
	if err != nil {
		return "", nil, err
	}

	if isNew || mapping.SyncOnLogin {
		if err := s.userRepo.SetRoles(user.ID, []domain.Role{*mapping.Role}); err != nil {
			return "", nil, err
		}
		// Reload so the returned user carries the roles and permissions the UI renders from.
		if refreshed, err := s.userRepo.GetByID(user.ID); err == nil {
			user = refreshed
		}
	}

	token, err := s.auth.GenerateToken(user)
	if err != nil {
		return "", nil, err
	}
	return token, user, nil
}

// resolveMapping picks the domain the account belongs to and looks up its mapping.
// `hd` is the Google Workspace hosted-domain claim and is the only proof that the
// account is managed by that company; an account without it is a consumer account
// that merely uses a company address, so it is accepted only when the mapping opts in.
func (s *GoogleAuthService) resolveMapping(payload *idtoken.Payload, email string) (*domain.DomainRoleMapping, error) {
	hostedDomain := strings.ToLower(strings.TrimSpace(claimString(payload, "hd")))
	emailDomain := ""
	if at := strings.LastIndex(email, "@"); at >= 0 {
		emailDomain = email[at+1:]
	}

	lookup := hostedDomain
	if lookup == "" {
		lookup = emailDomain
	}
	if lookup == "" {
		return nil, ErrDomainNotAllowed
	}

	mapping, err := s.mappingRepo.GetByDomain(lookup)
	if err != nil || mapping == nil || !mapping.Enabled {
		return nil, ErrDomainNotAllowed
	}
	if hostedDomain == "" && !mapping.AllowNonWorkspace {
		return nil, ErrDomainNotAllowed
	}
	// Roles are soft-deleted, so a mapping outlives the role it points at. Signing in
	// then would hand out a session with no permissions at all: refuse instead.
	if mapping.Role == nil {
		return nil, ErrMappingRoleMissing
	}
	return mapping, nil
}

// resolveUser finds the account this Google identity belongs to, linking by the stable
// Google subject first and falling back to the address so an existing password account
// is adopted instead of duplicated.
func (s *GoogleAuthService) resolveUser(payload *idtoken.Payload, email string, mapping *domain.DomainRoleMapping) (*domain.User, bool, error) {
	fullName := claimString(payload, "name")
	avatarURL := claimString(payload, "picture")

	if user, err := s.userRepo.GetBySocialID(googleProvider, payload.Subject); err == nil && user != nil {
		s.refreshProfile(user, avatarURL)
		return user, false, nil
	}

	if user, err := s.userRepo.GetByEmail(email); err == nil && user != nil {
		// A different Google subject already owns this account — most likely the address
		// was reassigned to a new person. Inheriting the previous holder's account and
		// roles must be a deliberate administrative act, not a side effect of signing in.
		if user.SocialID != "" && user.SocialID != payload.Subject {
			return nil, false, ErrAccountLinkedToOther
		}

		// Adopt the existing local account: record the Google identity but leave the
		// name and address an administrator curated untouched.
		user.SocialProvider = googleProvider
		user.SocialID = payload.Subject
		if user.AvatarURL == "" {
			user.AvatarURL = avatarURL
		}
		if err := s.userRepo.Update(user); err != nil {
			return nil, false, err
		}
		return user, false, nil
	}

	if !mapping.AutoProvision {
		return nil, false, ErrProvisioningDisabled
	}

	user := &domain.User{
		ID:             uuid.New(),
		Username:       email,
		Email:          email,
		FullName:       fullName,
		SocialProvider: googleProvider,
		SocialID:       payload.Subject,
		AvatarURL:      avatarURL,
	}
	if err := s.userRepo.Create(user); err != nil {
		return nil, false, err
	}
	return user, true, nil
}

func (s *GoogleAuthService) refreshProfile(user *domain.User, avatarURL string) {
	if avatarURL == "" || user.AvatarURL == avatarURL {
		return
	}
	user.AvatarURL = avatarURL
	_ = s.userRepo.Update(user)
}

func claimString(payload *idtoken.Payload, key string) string {
	if v, ok := payload.Claims[key].(string); ok {
		return v
	}
	return ""
}

func claimBool(payload *idtoken.Payload, key string) bool {
	v, ok := payload.Claims[key].(bool)
	return ok && v
}
