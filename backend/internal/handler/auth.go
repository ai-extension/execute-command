package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/csm-backend/internal/domain"
	"github.com/user/csm-backend/internal/service"
)

type AuthHandler struct {
	authService   *service.AuthService
	googleService *service.GoogleAuthService
	auditLog      domain.AuditLogService
}

func NewAuthHandler(authService *service.AuthService, googleService *service.GoogleAuthService, auditLog domain.AuditLogService) *AuthHandler {
	return &AuthHandler{
		authService:   authService,
		googleService: googleService,
		auditLog:      auditLog,
	}
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req struct {
		Username string `json:"username" binding:"required"`
		Password string `json:"password" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	token, user, err := h.authService.Login(req.Username, req.Password)
	if err != nil {
		h.auditLog.LogAction(c, "LOGIN", "AUTH", "", map[string]string{"username": req.Username, "error": err.Error()}, "FAILED")
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	h.auditLog.LogAction(c, "LOGIN", "AUTH", "", nil, "SUCCESS")

	// MaxAge in seconds, mirrors JWT exp from token_expiration setting (hours).
	maxAge := h.authService.GetTokenExpirationHours() * 3600
	c.SetCookie("auth_token", token, maxAge, "/", "", false, false) // Secure: false for local dev, HttpOnly: false to let JS read it

	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user":  user,
	})
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req struct {
		Username string `json:"username" binding:"required"`
		Password string `json:"password" binding:"required,min=6"`
		Email    string `json:"email" binding:"required,email"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.authService.Register(req.Username, req.Password, req.Email)
	if err != nil {
		h.auditLog.LogAction(c, "REGISTER", "AUTH", "", map[string]string{"username": req.Username, "email": req.Email, "error": err.Error()}, "FAILED")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.auditLog.LogAction(c, "REGISTER", "AUTH", "", nil, "SUCCESS")

	c.JSON(http.StatusCreated, gin.H{
		"message": "User registered successfully",
		"user":    user,
	})
}

func (h *AuthHandler) GoogleLogin(c *gin.Context) {
	var req struct {
		IDToken string `json:"id_token" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	token, user, err := h.googleService.LoginWithGoogle(c.Request.Context(), req.IDToken)
	if err != nil {
		h.auditLog.LogAction(c, "LOGIN_GOOGLE", "AUTH", "", map[string]string{"error": err.Error()}, "FAILED")
		status := googleLoginStatus(err)
		message := err.Error()
		if status == http.StatusInternalServerError {
			// Never hand an unauthenticated caller the internal failure; the audit log has it.
			message = "google login failed"
		}
		c.JSON(status, gin.H{"error": message})
		return
	}

	h.auditLog.LogAction(c, "LOGIN_GOOGLE", "AUTH", user.ID.String(), map[string]string{"username": user.Username}, "SUCCESS")

	maxAge := h.authService.GetTokenExpirationHours() * 3600
	c.SetCookie("auth_token", token, maxAge, "/", "", false, false)

	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user":  user,
	})
}

// googleLoginStatus keeps an unusable configuration (503) distinguishable from a
// rejected identity (401) and from a domain that is simply not allowed (403).
func googleLoginStatus(err error) int {
	switch {
	case errors.Is(err, service.ErrGoogleLoginDisabled), errors.Is(err, service.ErrGoogleNotConfigured):
		return http.StatusServiceUnavailable
	case errors.Is(err, service.ErrDomainNotAllowed), errors.Is(err, service.ErrProvisioningDisabled),
		errors.Is(err, service.ErrMappingRoleMissing), errors.Is(err, service.ErrAccountLinkedToOther):
		return http.StatusForbidden
	case errors.Is(err, service.ErrInvalidGoogleToken), errors.Is(err, service.ErrEmailNotVerified):
		return http.StatusUnauthorized
	default:
		return http.StatusInternalServerError
	}
}

func (h *AuthHandler) Logout(c *gin.Context) {
	// Clear the auth_token cookie
	c.SetCookie("auth_token", "", -1, "/", "", false, false)

	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}
