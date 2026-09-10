package handler

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/user/csm-backend/internal/domain"
	"golang.org/x/crypto/bcrypt"
)

// identityFieldRegex bounds the self-service identity fields. They surface in workflow
// commands as `{{ user.nickname }}` / `{{ user.chat_account_id }}`, and the executor's
// SecurityRegex still admits `;`, `&&`, `|` and `$(...)`, so anything beyond a name or a
// chat handle is rejected here — at the only place a non-admin can write these values.
var identityFieldRegex = regexp.MustCompile(`^[\pL0-9 ._@+-]*$`)

const identityFieldMaxLen = 100

// sanitizeIdentityField trims a nickname / chat account id and rejects unsafe content.
func sanitizeIdentityField(label, value string) (string, error) {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) > identityFieldMaxLen {
		return "", fmt.Errorf("%s must be at most %d characters", label, identityFieldMaxLen)
	}
	if !identityFieldRegex.MatchString(value) {
		return "", fmt.Errorf("%s may only contain letters, digits, spaces and . _ @ + -", label)
	}
	return value, nil
}

type UserHandler struct {
	userRepo    domain.UserRepository
	roleRepo    domain.RoleRepository
	apiKeyRepo  domain.APIKeyRepository
	mappingRepo domain.DomainRoleMappingRepository
	auditLog    domain.AuditLogService
}

func NewUserHandler(userRepo domain.UserRepository, roleRepo domain.RoleRepository, apiKeyRepo domain.APIKeyRepository, mappingRepo domain.DomainRoleMappingRepository, auditLog domain.AuditLogService) *UserHandler {
	return &UserHandler{
		userRepo:    userRepo,
		roleRepo:    roleRepo,
		apiKeyRepo:  apiKeyRepo,
		mappingRepo: mappingRepo,
		auditLog:    auditLog,
	}
}

func (h *UserHandler) GetMe(c *gin.Context) {
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, ok := userIDVal.(uuid.UUID)
	if !ok {
		// Fallback for string ID if needed, though middleware should set uuid.UUID
		idStr, ok := userIDVal.(string)
		if !ok {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid user id type"})
			return
		}
		var err error
		userID, err = uuid.Parse(idStr)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid user id format"})
			return
		}
	}

	user, err := h.userRepo.GetByID(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, user)
}

func (h *UserHandler) UpdateProfile(c *gin.Context) {
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, ok := userIDVal.(uuid.UUID)
	if !ok {
		idStr, _ := userIDVal.(string)
		userID, _ = uuid.Parse(idStr)
	}

	var input struct {
		FullName      string `json:"full_name"`
		Nickname      string `json:"nickname"`
		ChatAccountID string `json:"chat_account_id"`
		Email         string `json:"email" binding:"required,email"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.userRepo.GetByID(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "user not found"})
		return
	}

	// An address inside a Google-mapped domain decides which account a Google identity
	// links to, so it cannot be claimed here. Unmapped domains stay editable, and
	// re-saving the current address is always allowed.
	if !strings.EqualFold(strings.TrimSpace(input.Email), strings.TrimSpace(user.Email)) {
		if managedDomain, managed := domain.IsManagedEmailDomain(h.mappingRepo, input.Email); managed {
			h.auditLog.LogAction(c, "UPDATE_PROFILE", "USER", user.ID.String(), map[string]string{"email": input.Email, "error": "managed domain"}, "FAILED")
			c.JSON(http.StatusForbidden, gin.H{"error": "addresses at " + managedDomain + " are managed by Google sign-in; ask an administrator to change it"})
			return
		}
	}

	nickname, err := sanitizeIdentityField("nickname", input.Nickname)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	chatAccountID, err := sanitizeIdentityField("chat account id", input.ChatAccountID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user.FullName = input.FullName
	user.Nickname = nickname
	user.ChatAccountID = chatAccountID
	user.Email = input.Email

	if err := h.userRepo.Update(user); err != nil {
		h.auditLog.LogAction(c, "UPDATE_PROFILE", "USER", "", map[string]string{"error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.auditLog.LogAction(c, "UPDATE_PROFILE", "USER", "", nil, "SUCCESS")
	c.JSON(http.StatusOK, user)
}

func (h *UserHandler) UpdatePassword(c *gin.Context) {
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, ok := userIDVal.(uuid.UUID)
	if !ok {
		idStr, _ := userIDVal.(string)
		userID, _ = uuid.Parse(idStr)
	}

	var input struct {
		OldPassword string `json:"old_password" binding:"required"`
		NewPassword string `json:"new_password" binding:"required,min=6"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.userRepo.GetByID(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "user not found"})
		return
	}

	// Verify old password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.OldPassword)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "incorrect old password"})
		return
	}

	// Hash new password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	user.PasswordHash = string(hashedPassword)

	if err := h.userRepo.Update(user); err != nil {
		h.auditLog.LogAction(c, "UPDATE_PASSWORD", "USER", "", map[string]string{"error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.auditLog.LogAction(c, "UPDATE_PASSWORD", "USER", "", nil, "SUCCESS")
	c.JSON(http.StatusOK, gin.H{"message": "password updated successfully"})
}

func (h *UserHandler) ListUsers(c *gin.Context) {
	limit := 20
	offset := 0
	if l := c.Query("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 {
			limit = v
		}
	}
	if o := c.Query("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil && v >= 0 {
			offset = v
		}
	}

	searchTerm := c.Query("search")
	var roleID *uuid.UUID
	if rIDStr := c.Query("role_id"); rIDStr != "" {
		if id, err := uuid.Parse(rIDStr); err == nil {
			roleID = &id
		}
	}

	users, total, err := h.userRepo.ListPaginated(limit, offset, searchTerm, roleID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"items":  users,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *UserHandler) CreateUser(c *gin.Context) {
	var input struct {
		Username string `json:"username" binding:"required"`
		Password string `json:"password" binding:"required"`
		Email    string `json:"email"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	user := &domain.User{
		ID:           uuid.New(),
		Username:     input.Username,
		PasswordHash: string(hashedPassword),
		Email:        input.Email,
	}

	if err := h.userRepo.Create(user); err != nil {
		h.auditLog.LogAction(c, "CREATE_USER", "USER", "", map[string]string{"username": user.Username, "error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	resID := user.ID.String()
	h.auditLog.LogAction(c, "CREATE_USER", "USER", resID, map[string]string{"username": user.Username}, "SUCCESS")
	c.JSON(http.StatusCreated, user)
}

func (h *UserHandler) UpdateUserRoles(c *gin.Context) {
	idStr := c.Param("id")
	userID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	var input struct {
		RoleIDs []uuid.UUID `json:"role_ids" binding:"required"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	roles, err := h.roleRepo.GetByIDs(input.RoleIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch roles"})
		return
	}

	resID := userID.String()

	if err := h.userRepo.SetRoles(userID, roles); err != nil {
		h.auditLog.LogAction(c, "UPDATE_USER_ROLES", "USER", resID, map[string]string{"error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.auditLog.LogAction(c, "UPDATE_USER_ROLES", "USER", resID, nil, "SUCCESS")
	c.JSON(http.StatusOK, gin.H{"message": "user roles updated successfully"})
}

func (h *UserHandler) UpdateUser(c *gin.Context) {
	idStr := c.Param("id")
	userID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	var input struct {
		Username      string `json:"username" binding:"required"`
		FullName      string `json:"full_name"`
		Nickname      string `json:"nickname"`
		ChatAccountID string `json:"chat_account_id"`
		Email         string `json:"email"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.userRepo.GetByID(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	nickname, err := sanitizeIdentityField("nickname", input.Nickname)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	chatAccountID, err := sanitizeIdentityField("chat account id", input.ChatAccountID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user.Username = input.Username
	user.FullName = input.FullName
	user.Nickname = nickname
	user.ChatAccountID = chatAccountID
	user.Email = input.Email

	if err := h.userRepo.Update(user); err != nil {
		h.auditLog.LogAction(c, "UPDATE_USER", "USER", userID.String(), map[string]string{"username": user.Username, "error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.auditLog.LogAction(c, "UPDATE_USER", "USER", userID.String(), map[string]string{"username": user.Username}, "SUCCESS")
	c.JSON(http.StatusOK, user)
}

func (h *UserHandler) DeleteUser(c *gin.Context) {
	idStr := c.Param("id")
	userID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	resID := userID.String()

	if err := h.userRepo.Delete(userID); err != nil {
		h.auditLog.LogAction(c, "DELETE", "USER", resID, map[string]string{"error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.auditLog.LogAction(c, "DELETE", "USER", resID, nil, "SUCCESS")
	c.JSON(http.StatusOK, gin.H{"message": "user soft deleted successfully"})
}

func (h *UserHandler) ResetPassword(c *gin.Context) {
	idStr := c.Param("id")
	userID, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	var input struct {
		NewPassword string `json:"new_password" binding:"required,min=6"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.userRepo.GetByID(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	user.PasswordHash = string(hashedPassword)

	resID := userID.String()

	if err := h.userRepo.Update(user); err != nil {
		h.auditLog.LogAction(c, "RESET_PASSWORD", "USER", resID, map[string]string{"error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.auditLog.LogAction(c, "RESET_PASSWORD", "USER", resID, nil, "SUCCESS")
	c.JSON(http.StatusOK, gin.H{"message": "password reset successfully"})
}

func (h *UserHandler) ListAPIKeys(c *gin.Context) {
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var userID uuid.UUID
	switch v := userIDVal.(type) {
	case uuid.UUID:
		userID = v
	case string:
		userID, _ = uuid.Parse(v)
	}

	keys, err := h.apiKeyRepo.ListByUserID(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, keys)
}

func (h *UserHandler) GenerateAPIKey(c *gin.Context) {
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var userID uuid.UUID
	switch v := userIDVal.(type) {
	case uuid.UUID:
		userID = v
	case string:
		userID, _ = uuid.Parse(v)
	}

	var input struct {
		Name   string   `json:"name" binding:"required"`
		Scopes []string `json:"scopes"`
		IsMCP  bool     `json:"is_mcp"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Generate 32 bytes of random data
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate key"})
		return
	}
	rawKey := hex.EncodeToString(b)
	prefix := rawKey[:8]

	// Base64 or just hex? The plan mentions "hashed version of the key"
	// Let's use bcrypt to hash the raw key for secure storage
	hashedKey, err := bcrypt.GenerateFromPassword([]byte(rawKey), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash key"})
		return
	}

	// Convert scopes array to comma-separated string
	scopesStr := ""
	if len(input.Scopes) > 0 {
		scopesStr = strings.Join(input.Scopes, ",")
	}

	apiKey := &domain.APIKey{
		ID:        uuid.New(),
		UserID:    userID,
		Name:      input.Name,
		KeyPrefix: prefix,
		KeyHash:   string(hashedKey),
		Scopes:    scopesStr,
		IsMCP:     input.IsMCP,
		CreatedAt: time.Now(),
	}

	if err := h.apiKeyRepo.Create(apiKey); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Return the raw key ONLY once
	response := gin.H{
		"id":         apiKey.ID,
		"name":       apiKey.Name,
		"prefix":     apiKey.KeyPrefix,
		"key":        rawKey, // The raw key to show the user
		"is_mcp":     apiKey.IsMCP,
		"created_at": apiKey.CreatedAt,
	}

	if apiKey.IsMCP {
		scheme := "http"
		if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
			scheme = "https"
		}
		host := c.Request.Host
		if forwardedHost := c.GetHeader("X-Forwarded-Host"); forwardedHost != "" {
			host = forwardedHost
		}
		mcpURL := scheme + "://" + host + "/api/mcp"

		mcpConfig := map[string]interface{}{
			"mcpServers": map[string]interface{}{
				"csm-execute": map[string]interface{}{
					"type":      "sse",
					"url":       mcpURL,
					"serverURL": mcpURL, // Some versions of Cursor might look for this
					"headers": map[string]string{
						"X-API-Key": rawKey,
					},
				},
			},
		}

		configBytes, _ := json.MarshalIndent(mcpConfig, "", "  ")
		response["mcp_connection"] = string(configBytes)
	}

	c.JSON(http.StatusCreated, response)
}

func (h *UserHandler) DeleteAPIKey(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id film"})
		return
	}

	userIDVal, _ := c.Get("user_id")
	var userID uuid.UUID
	switch v := userIDVal.(type) {
	case uuid.UUID:
		userID = v
	case string:
		userID, _ = uuid.Parse(v)
	}

	// Security check: ensure key belongs to user
	key, err := h.apiKeyRepo.GetByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "api key not found"})
		return
	}

	if key.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	if err := h.apiKeyRepo.Delete(id); err != nil {
		h.auditLog.LogAction(c, "DELETE_API_KEY", "USER", id.String(), map[string]string{"name": key.Name, "error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.auditLog.LogAction(c, "DELETE_API_KEY", "USER", id.String(), map[string]string{"name": key.Name}, "SUCCESS")
	c.JSON(http.StatusOK, gin.H{"message": "api key deleted"})
}
