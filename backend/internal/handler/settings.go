package handler

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/user/csm-backend/internal/domain"
	"github.com/user/csm-backend/internal/service"
)

const (
	siteLogoKey = "site_logo"
	// 512KB of image becomes roughly 700K characters once base64-encoded; this leaves
	// headroom without letting a caller store megabytes.
	maxSiteLogoChars = 1 << 20
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

	// The upload screen caps the file at 512KB, but that is a client-side check and this
	// value is served to anonymous visitors, so the ceiling is enforced here too.
	if req.Key == siteLogoKey && len(req.Value) > maxSiteLogoChars {
		c.JSON(http.StatusBadRequest, gin.H{"error": "logo is too large; use an image under 512KB"})
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
	// register page and the public pages all need it. The logo itself is fetched from its
	// own endpoint: inlining the data URL here put the whole image on every anonymous
	// page load, uncacheable, just to render a 40px mark.
	siteTitle, _ := h.settingsService.GetSetting("site_title")
	siteLogo, _ := h.settingsService.GetSetting("site_logo")

	c.JSON(http.StatusOK, gin.H{
		"allow_registration":    allowReg == "true",
		"google_auth_enabled":   googleEnabled == "true",
		"google_client_id":      googleClientID,
		"facebook_auth_enabled": facebookEnabled == "true",
		"site_title":            siteTitle,
		"has_site_logo":         siteLogo != "",
	})
}

// GetSiteLogo serves the configured logo as an image so the browser can cache it,
// rather than shipping its data URL inside every settings payload. Public: the login
// screen shows it before anyone has a session.
func (h *SettingsHandler) GetSiteLogo(c *gin.Context) {
	stored, _ := h.settingsService.GetSetting(siteLogoKey)
	if stored == "" {
		c.Status(http.StatusNotFound)
		return
	}

	contentType, payload, err := decodeDataURL(stored)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}

	// The logo changes rarely but must not go stale after an admin replaces it, so the
	// browser revalidates and gets a 304 instead of the bytes.
	sum := sha256.Sum256([]byte(stored))
	etag := `"` + hex.EncodeToString(sum[:8]) + `"`
	if c.GetHeader("If-None-Match") == etag {
		c.Status(http.StatusNotModified)
		return
	}
	c.Header("ETag", etag)
	c.Header("Cache-Control", "public, max-age=0, must-revalidate")
	c.Data(http.StatusOK, contentType, payload)
}

// decodeDataURL splits a "data:<type>;base64,<payload>" string as produced by the
// settings upload.
func decodeDataURL(raw string) (string, []byte, error) {
	if !strings.HasPrefix(raw, "data:") {
		return "", nil, errors.New("not a data URL")
	}
	comma := strings.Index(raw, ",")
	if comma < 0 {
		return "", nil, errors.New("malformed data URL")
	}
	meta := raw[len("data:"):comma]
	if !strings.HasSuffix(meta, ";base64") {
		return "", nil, errors.New("unsupported data URL encoding")
	}
	contentType := strings.TrimSuffix(meta, ";base64")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	payload, err := base64.StdEncoding.DecodeString(raw[comma+1:])
	if err != nil {
		return "", nil, err
	}
	return contentType, payload, nil
}
