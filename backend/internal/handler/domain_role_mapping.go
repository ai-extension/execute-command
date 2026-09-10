package handler

import (
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/user/csm-backend/internal/domain"
)

// domainPattern accepts a bare DNS name such as "air-closet.com"; anything with a
// scheme, path, "@" or wildcard would silently never match a Google `hd` claim.
var domainPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)

type DomainRoleMappingHandler struct {
	repo     domain.DomainRoleMappingRepository
	roleRepo domain.RoleRepository
	auditLog domain.AuditLogService
}

func NewDomainRoleMappingHandler(repo domain.DomainRoleMappingRepository, roleRepo domain.RoleRepository, auditLog domain.AuditLogService) *DomainRoleMappingHandler {
	return &DomainRoleMappingHandler{repo: repo, roleRepo: roleRepo, auditLog: auditLog}
}

type domainRoleMappingRequest struct {
	Domain string `json:"domain" binding:"required"`
	RoleID string `json:"role_id" binding:"required"`
	// Flags are pointers so an omitted field is distinguishable from an explicit false.
	AutoProvision     *bool `json:"auto_provision"`
	SyncOnLogin       *bool `json:"sync_on_login"`
	AllowNonWorkspace *bool `json:"allow_non_workspace"`
	Enabled           *bool `json:"enabled"`
}

func boolOr(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func (h *DomainRoleMappingHandler) List(c *gin.Context) {
	mappings, err := h.repo.List()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, mappings)
}

func (h *DomainRoleMappingHandler) Create(c *gin.Context) {
	req, roleID, ok := h.bind(c)
	if !ok {
		return
	}

	if existing, err := h.repo.GetByDomain(req.Domain); err == nil && existing != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "this domain is already mapped"})
		return
	}

	mapping := &domain.DomainRoleMapping{
		ID:                uuid.New(),
		Domain:            req.Domain,
		RoleID:            roleID,
		AutoProvision:     boolOr(req.AutoProvision, true),
		SyncOnLogin:       boolOr(req.SyncOnLogin, false),
		AllowNonWorkspace: boolOr(req.AllowNonWorkspace, false),
		Enabled:           boolOr(req.Enabled, true),
	}

	if err := h.repo.Create(mapping); err != nil {
		h.auditLog.LogAction(c, "CREATE", "DOMAIN_ROLE_MAPPING", mapping.ID.String(), gin.H{"domain": mapping.Domain, "error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.auditLog.LogAction(c, "CREATE", "DOMAIN_ROLE_MAPPING", mapping.ID.String(), gin.H{"domain": mapping.Domain, "role_id": mapping.RoleID.String()}, "SUCCESS")

	created, err := h.repo.GetByID(mapping.ID)
	if err != nil {
		c.JSON(http.StatusCreated, mapping)
		return
	}
	c.JSON(http.StatusCreated, created)
}

func (h *DomainRoleMappingHandler) Update(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	existing, err := h.repo.GetByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "mapping not found"})
		return
	}

	req, roleID, ok := h.bind(c)
	if !ok {
		return
	}

	if clash, err := h.repo.GetByDomain(req.Domain); err == nil && clash != nil && clash.ID != existing.ID {
		c.JSON(http.StatusConflict, gin.H{"error": "this domain is already mapped"})
		return
	}

	existing.Domain = req.Domain
	existing.RoleID = roleID
	existing.Role = nil
	existing.AutoProvision = boolOr(req.AutoProvision, existing.AutoProvision)
	existing.SyncOnLogin = boolOr(req.SyncOnLogin, existing.SyncOnLogin)
	existing.AllowNonWorkspace = boolOr(req.AllowNonWorkspace, existing.AllowNonWorkspace)
	existing.Enabled = boolOr(req.Enabled, existing.Enabled)

	if err := h.repo.Update(existing); err != nil {
		h.auditLog.LogAction(c, "UPDATE", "DOMAIN_ROLE_MAPPING", id.String(), gin.H{"domain": existing.Domain, "error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.auditLog.LogAction(c, "UPDATE", "DOMAIN_ROLE_MAPPING", id.String(), gin.H{"domain": existing.Domain, "role_id": existing.RoleID.String()}, "SUCCESS")

	updated, err := h.repo.GetByID(id)
	if err != nil {
		c.JSON(http.StatusOK, existing)
		return
	}
	c.JSON(http.StatusOK, updated)
}

func (h *DomainRoleMappingHandler) Delete(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	if err := h.repo.Delete(id); err != nil {
		h.auditLog.LogAction(c, "DELETE", "DOMAIN_ROLE_MAPPING", id.String(), gin.H{"error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.auditLog.LogAction(c, "DELETE", "DOMAIN_ROLE_MAPPING", id.String(), nil, "SUCCESS")
	c.JSON(http.StatusOK, gin.H{"message": "Mapping deleted successfully"})
}

func (h *DomainRoleMappingHandler) bind(c *gin.Context) (*domainRoleMappingRequest, uuid.UUID, bool) {
	var req domainRoleMappingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return nil, uuid.Nil, false
	}

	req.Domain = strings.ToLower(strings.TrimSpace(req.Domain))
	req.Domain = strings.TrimPrefix(req.Domain, "@")
	if !domainPattern.MatchString(req.Domain) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid domain, expected a bare domain such as example.com"})
		return nil, uuid.Nil, false
	}

	roleID, err := uuid.Parse(req.RoleID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role_id"})
		return nil, uuid.Nil, false
	}
	if _, err := h.roleRepo.GetByID(roleID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role not found"})
		return nil, uuid.Nil, false
	}

	return &req, roleID, true
}
