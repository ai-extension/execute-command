package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/user/csm-backend/internal/domain"
	"github.com/user/csm-backend/internal/service"
)

// secretSettingKeys are settings whose value is a credential: writable, never readable.
var secretSettingKeys = map[string]bool{
	"google_client_secret":   true,
	"facebook_client_secret": true,
}

type SettingsHandler struct {
	settingsService *service.SettingsService
	auditLog        domain.AuditLogService
}

func NewSettingsHandler(settingsService *service.SettingsService, auditLog domain.AuditLogService) *SettingsHandler {
	return &SettingsHandler{settingsService: settingsService, auditLog: auditLog}
}

func (h *SettingsHandler) GetSettings(c *gin.Context) {
	settings, err := h.settingsService.GetAll()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	result := make(map[string]string)
	for _, s := range settings {
		if secretSettingKeys[s.Key] {
			// Never hand a stored secret back; the UI only needs to know one exists.
			result["has_"+s.Key] = strconv.FormatBool(s.Value != "")
			continue
		}
		result[s.Key] = s.Value
	}

	c.JSON(http.StatusOK, result)
}

func (h *SettingsHandler) UpdateSetting(c *gin.Context) {
	var req struct {
		Key   string `json:"key" binding:"required"`
		Value string `json:"value" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.settingsService.SetSetting(req.Key, req.Value); err != nil {
		h.auditLog.LogAction(c, "UPDATE_SETTING", "SETTINGS", "", map[string]string{"key": req.Key, "value": req.Value, "error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.auditLog.LogAction(c, "UPDATE_SETTING", "SETTINGS", "", map[string]string{"key": req.Key, "value": req.Value}, "SUCCESS")
	c.JSON(http.StatusOK, gin.H{"message": "Setting updated successfully"})
}

func (h *SettingsHandler) GetPublicSettings(c *gin.Context) {
	allowReg, _ := h.settingsService.GetSetting("allow_registration")
	if allowReg == "" {
		allowReg = "false"
	}

	googleEnabled, _ := h.settingsService.GetSetting("google_auth_enabled")
	if googleEnabled == "" {
		googleEnabled = "false"
	}

	facebookEnabled, _ := h.settingsService.GetSetting("facebook_auth_enabled")
	if facebookEnabled == "" {
		facebookEnabled = "false"
	}

	// The OAuth client id is public by design; the client secret must never be exposed here.
	googleClientID := ""
	if googleEnabled == "true" {
		googleClientID, _ = h.settingsService.GetSetting("google_client_id")
	}

	// Branding is what every screen shows before anyone signs in — the login page, the
	// register page and the public pages all need it.
	siteTitle, _ := h.settingsService.GetSetting("site_title")
	siteLogo, _ := h.settingsService.GetSetting("site_logo")

	c.JSON(http.StatusOK, gin.H{
		"allow_registration":    allowReg == "true",
		"google_auth_enabled":   googleEnabled == "true",
		"google_client_id":      googleClientID,
		"facebook_auth_enabled": facebookEnabled == "true",
		"site_title":            siteTitle,
		"site_logo":             siteLogo,
	})
}
