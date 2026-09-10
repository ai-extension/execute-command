package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/user/csm-backend/internal/domain"
	"github.com/user/csm-backend/internal/service"
)

type VpnConfigHandler struct {
	service  *service.VpnConfigService
	auditLog domain.AuditLogService
}

func NewVpnConfigHandler(service *service.VpnConfigService, auditLog domain.AuditLogService) *VpnConfigHandler {
	return &VpnConfigHandler{
		service:  service,
		auditLog: auditLog,
	}
}

func (h *VpnConfigHandler) List(c *gin.Context) {
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
	authType := c.Query("auth_type")
	vpnType := c.Query("vpn_type")

	var createdBy *uuid.UUID
	if cb := c.Query("created_by"); cb != "" {
		if id, err := uuid.Parse(cb); err == nil {
			createdBy = &id
		}
	}

	var namespaceID *uuid.UUID
	if nsStr := c.Param("ns_id"); nsStr != "" {
		if id, err := uuid.Parse(nsStr); err == nil {
			namespaceID = &id
		}
	}

	userVal, _ := c.Get("user")
	vpns, total, err := h.service.ListPaginated(namespaceID, limit, offset, searchTerm, vpnType, authType, createdBy, userVal.(*domain.User))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"items":  vpns,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *VpnConfigHandler) Create(c *gin.Context) {
	var vpn domain.VpnConfig
	if err := c.ShouldBindJSON(&vpn); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	nsStr := c.Param("ns_id")
	nsID, err := uuid.Parse(nsStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid namespace id"})
		return
	}
	vpn.NamespaceID = nsID

	userVal, _ := c.Get("user")
	user := userVal.(*domain.User)
	if !domain.HasPermission(user, "vpns", "WRITE", &nsStr, nil, nil) {
		c.JSON(http.StatusForbidden, gin.H{"error": "permission denied to create vpn"})
		return
	}

	if err := h.service.Create(&vpn, user); err != nil {
		h.auditLog.LogAction(c, "CREATE", "VPN", "", map[string]string{"name": vpn.Name, "error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	resID := vpn.ID.String()
	h.auditLog.LogAction(c, "CREATE", "VPN", resID, map[string]string{"name": vpn.Name}, "SUCCESS")
	c.JSON(http.StatusCreated, vpn)
}

func (h *VpnConfigHandler) Update(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var vpn domain.VpnConfig
	if err := c.ShouldBindJSON(&vpn); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	vpn.ID = id

	meta := map[string]interface{}{"name": vpn.Name}
	meta = markCredentialChange(meta, "password", vpn.Password != "")
	meta = markCredentialChange(meta, "private_key", vpn.PrivateKey != "")
	meta = markCredentialChange(meta, "config_file", vpn.ConfigFile != "")
	meta = markCredentialChange(meta, "shared_key", vpn.SharedKey != "")

	user, _ := c.Get("user")
	if err := h.service.Update(&vpn, user.(*domain.User)); err != nil {
		meta["error"] = err.Error()
		h.auditLog.LogAction(c, "UPDATE", "VPN", id.String(), meta, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.auditLog.LogAction(c, "UPDATE", "VPN", id.String(), meta, "SUCCESS")
	c.JSON(http.StatusOK, vpn)
}

func (h *VpnConfigHandler) Delete(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	user, _ := c.Get("user")
	resID := id.String()
	if err := h.service.Delete(id, user.(*domain.User)); err != nil {
		h.auditLog.LogAction(c, "DELETE", "VPN", resID, map[string]string{"error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.auditLog.LogAction(c, "DELETE", "VPN", resID, nil, "SUCCESS")
	c.JSON(http.StatusNoContent, nil)
}
