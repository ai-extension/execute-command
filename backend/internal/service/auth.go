package service

import (
	"errors"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/user/csm-backend/internal/domain"
	"golang.org/x/crypto/bcrypt"
)

var jwtKey []byte

func init() {
	secret := os.Getenv("JWT_SECRET")
	if secret != "" {
		jwtKey = []byte(secret)
		log.Println("JWT schema loaded from environment variable")
	} else {
		// Use a hardcoded default key if no secret is provided in the environment
		// This prevents tokens from invalidating on every restart during development
		defaultSecret := "default-insecure-jwt-secret-key-for-local-development"
		jwtKey = []byte(defaultSecret)
		log.Println("WARNING: JWT_SECRET environment variable not set. Using default insecure secret. Do NOT use this in production!")
	}
}

type AuthService struct {
	userRepo     domain.UserRepository
	settingsRepo domain.SystemSettingRepository
	mappingRepo  domain.DomainRoleMappingRepository
}

func NewAuthService(userRepo domain.UserRepository, settingsRepo domain.SystemSettingRepository, mappingRepo domain.DomainRoleMappingRepository) *AuthService {
	return &AuthService{userRepo: userRepo, settingsRepo: settingsRepo, mappingRepo: mappingRepo}
}

func (s *AuthService) Register(username, password, email string) (*domain.User, error) {
	// Check if registration is allowed
	allowReg, err := s.settingsRepo.GetByKey("allow_registration")
	if err != nil || allowReg.Value != "true" {
		return nil, errors.New("registration is currently disabled")
	}

	// Check if user already exists
	if _, err := s.userRepo.GetByUsername(username); err == nil {
		return nil, errors.New("username already exists")
	}

	// Registering with an address in a Google-mapped domain would pre-claim the account
	// that domain's first Google sign-in links to.
	if managedDomain, managed := domain.IsManagedEmailDomain(s.mappingRepo, email); managed {
		return nil, errors.New("addresses at " + managedDomain + " must sign in with Google")
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	user := &domain.User{
		ID:           uuid.New(),
		Username:     username,
		PasswordHash: string(hashedPassword),
		Email:        email,
	}

	if err := s.userRepo.Create(user); err != nil {
		return nil, err
	}

	return user, nil
}

func (s *AuthService) GetTokenExpirationHours() int {
	expirationHours := 24
	if setting, err := s.settingsRepo.GetByKey("token_expiration"); err == nil {
		if val, err := strconv.Atoi(setting.Value); err == nil && val > 0 {
			expirationHours = val
		}
	}
	return expirationHours
}

func (s *AuthService) Login(username, password string) (string, *domain.User, error) {
	user, err := s.userRepo.GetByUsername(username)
	if err != nil {
		return "", nil, errors.New("invalid credentials")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return "", nil, errors.New("invalid credentials")
	}

	expirationHours := s.GetTokenExpirationHours()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":  user.ID,
		"username": user.Username,
		"exp":      time.Now().Add(time.Hour * time.Duration(expirationHours)).Unix(),
	})

	tokenString, err := token.SignedString(jwtKey)
	if err != nil {
		return "", nil, err
	}

	return tokenString, user, nil
}

// GenerateToken issues a session token for an already-authenticated user. The claim
// shape must stay identical to Login's, as AuthMiddleware reads user_id from it.
func (s *AuthService) GenerateToken(user *domain.User) (string, error) {
	expirationHours := s.GetTokenExpirationHours()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":  user.ID,
		"username": user.Username,
		"exp":      time.Now().Add(time.Hour * time.Duration(expirationHours)).Unix(),
	})

	return token.SignedString(jwtKey)
}

func (s *AuthService) ValidateToken(tokenString string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return jwtKey, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, errors.New("invalid token")
}

func (s *AuthService) GetUserByUsername(username string) (*domain.User, error) {
	return s.userRepo.GetByUsername(username)
}
