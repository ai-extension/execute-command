package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
	"github.com/google/uuid"
	"github.com/user/csm-backend/internal/domain"
	"github.com/user/csm-backend/internal/lib/utils"
	"github.com/user/csm-backend/internal/service"
)

type GlobalVariableHandler struct {
	service  *service.GlobalVariableService
	auditLog domain.AuditLogService
}

func NewGlobalVariableHandler(service *service.GlobalVariableService, auditLog domain.AuditLogService) *GlobalVariableHandler {
	return &GlobalVariableHandler{
		service:  service,
		auditLog: auditLog,
	}
}

func (h *GlobalVariableHandler) List(c *gin.Context) {
	nsID, err := uuid.Parse(c.Param("ns_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid namespace id"})
		return
	}

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

	var createdBy *uuid.UUID
	if cb := c.Query("created_by"); cb != "" {
		if id, err := uuid.Parse(cb); err == nil {
			createdBy = &id
		}
	}

	user, _ := c.Get("user")
	gvs, total, err := h.service.ListPaginated(nsID, limit, offset, searchTerm, createdBy, user.(*domain.User))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items":  gvs,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *GlobalVariableHandler) Create(c *gin.Context) {
	nsID, err := uuid.Parse(c.Param("ns_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid namespace id"})
		return
	}

	var gv domain.GlobalVariable
	if err := c.ShouldBindJSON(&gv); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	gv.NamespaceID = nsID
	currentUser, _ := c.Get("user")
	user, _ := currentUser.(*domain.User)
	nsIDStr := nsID.String()
	if !domain.HasPermission(user, "namespaces", "WRITE", &nsIDStr, nil, nil) {
		c.JSON(http.StatusForbidden, gin.H{"error": "permission denied to create variable in this namespace"})
		return
	}

	if err := h.service.Create(&gv, user); err != nil {
		h.auditLog.LogAction(c, "CREATE", "VARIABLE", "", map[string]string{"key": gv.Key, "error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.auditLog.LogAction(c, "CREATE", "VARIABLE", gv.ID.String(), map[string]string{"key": gv.Key}, "SUCCESS")
	c.JSON(http.StatusCreated, gv)
}

func (h *GlobalVariableHandler) Update(c *gin.Context) {
	var gv domain.GlobalVariable
	if err := c.ShouldBindBodyWith(&gv, binding.JSON); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// A plain bool cannot tell "is_secret": false from an omitted field, and treating an
	// omission as false would un-secret the variable and expose its value.
	var probe struct {
		IsSecret *bool `json:"is_secret"`
	}
	_ = c.ShouldBindBodyWith(&probe, binding.JSON)

	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	gv.ID = id

	userVal, _ := c.Get("user")
	user := userVal.(*domain.User)

	// Fetch to verify permission and get NamespaceID
	existing, err := h.service.GetByIDWithAction(id, user, "WRITE")
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "variable not found or permission denied"})
		return
	}
	c.Set("namespace_id", existing.NamespaceID)

	if probe.IsSecret == nil {
		gv.IsSecret = existing.IsSecret
	}

	diff := utils.CalculateDiff(existing, &gv)
	// A secret value is redacted on both sides of the diff, so record the rotation itself.
	diff = markCredentialChange(diff, "value", gv.IsSecret && gv.Value != "")

	if err := h.service.Update(&gv, user); err != nil {
		meta := diff
		if meta == nil {
			meta = make(map[string]interface{})
		}
		meta["error"] = err.Error()
		h.auditLog.LogAction(c, "UPDATE", "VARIABLE", gv.ID.String(), meta, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.auditLog.LogAction(c, "UPDATE", "VARIABLE", gv.ID.String(), diff, "SUCCESS")
	c.JSON(http.StatusOK, gv)
}

func (h *GlobalVariableHandler) Delete(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	userVal, _ := c.Get("user")
	user := userVal.(*domain.User)

	// Fetch to verify permission and get NamespaceID
	existing, err := h.service.GetByIDWithAction(id, user, "WRITE") // Variables use WRITE for delete in original service?
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "variable not found or permission denied"})
		return
	}
	c.Set("namespace_id", existing.NamespaceID)
	metadata := map[string]string{"key": existing.Key}

	resID := id.String()
	if err := h.service.Delete(id, user); err != nil {
		metadata["error"] = err.Error()
		h.auditLog.LogAction(c, "DELETE", "VARIABLE", resID, metadata, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.auditLog.LogAction(c, "DELETE", "VARIABLE", resID, metadata, "SUCCESS")
	c.JSON(http.StatusOK, gin.H{"message": "variable deleted"})
}
