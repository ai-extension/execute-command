package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/user/csm-backend/internal/domain"
	"github.com/user/csm-backend/internal/lib/utils"
	"github.com/user/csm-backend/internal/service"
)

type ServerHandler struct {
	service         *service.ServerService
	terminalService *service.TerminalService
	auditLog        domain.AuditLogService
}

func NewServerHandler(service *service.ServerService, terminalService *service.TerminalService, auditLog domain.AuditLogService) *ServerHandler {
	return &ServerHandler{
		service:         service,
		terminalService: terminalService,
		auditLog:        auditLog,
	}
}

func (h *ServerHandler) ListServers(c *gin.Context) {
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
	var vpnID *uuid.UUID
	if vIDStr := c.Query("vpn_id"); vIDStr != "" {
		if id, err := uuid.Parse(vIDStr); err == nil {
			vpnID = &id
		}
	}

	var createdBy *uuid.UUID
	if cb := c.Query("user"); cb == "" {
		cb = c.Query("created_by") // Fallback
		if cb != "" {
			if id, err := uuid.Parse(cb); err == nil {
				createdBy = &id
			}
		}
	} else {
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
	servers, total, err := h.service.ListServersPaginated(namespaceID, limit, offset, searchTerm, authType, vpnID, createdBy, userVal.(*domain.User))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"items":  servers,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *ServerHandler) CreateServer(c *gin.Context) {
	var server domain.Server
	if err := c.ShouldBindJSON(&server); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	nsStr := c.Param("ns_id")
	nsID, err := uuid.Parse(nsStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid namespace id"})
		return
	}
	server.NamespaceID = nsID

	userVal, _ := c.Get("user")
	user := userVal.(*domain.User)
	if !domain.HasPermission(user, "servers", "WRITE", &nsStr, nil, nil) {
		c.JSON(http.StatusForbidden, gin.H{"error": "permission denied to create server"})
		return
	}

	if err := h.service.CreateServer(&server, user); err != nil {
		h.auditLog.LogAction(c, "CREATE", "SERVER", server.ID.String(), map[string]string{"name": server.Name, "error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	resID := server.ID.String()
	h.auditLog.LogAction(c, "CREATE", "SERVER", resID, map[string]string{"name": server.Name}, "SUCCESS")
	c.JSON(http.StatusCreated, server)
}

func (h *ServerHandler) UpdateServer(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var server domain.Server
	if err := c.ShouldBindJSON(&server); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	server.ID = id

	userVal, _ := c.Get("user")
	user := userVal.(*domain.User)

	// Fetch existing to calculate diff
	existing, err := h.service.GetServer(id, user)
	var diff map[string]interface{}
	if err == nil {
		diff = utils.CalculateDiff(existing, &server)
	}

	diff = markCredentialChange(diff, "password", server.Password != "")
	diff = markCredentialChange(diff, "private_key", server.PrivateKey != "")

	if err := h.service.UpdateServer(&server, user); err != nil {
		var meta map[string]interface{}
		if diff != nil {
			meta = diff
		}
		if meta == nil {
			meta = make(map[string]interface{})
		}
		meta["error"] = err.Error()
		h.auditLog.LogAction(c, "UPDATE", "SERVER", id.String(), meta, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.auditLog.LogAction(c, "UPDATE", "SERVER", id.String(), diff, "SUCCESS")
	c.JSON(http.StatusOK, server)
}

func (h *ServerHandler) DeleteServer(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	user, _ := c.Get("user")
	// Fetch existing for audit log context
	existing, _ := h.service.GetServer(id, user.(*domain.User))
	var metadata map[string]string
	if existing != nil {
		metadata = map[string]string{"name": existing.Name, "host": existing.Host}
	}

	resID := id.String()
	if err := h.service.DeleteServer(id, user.(*domain.User)); err != nil {
		if metadata == nil {
			metadata = make(map[string]string)
		}
		metadata["error"] = err.Error()
		h.auditLog.LogAction(c, "DELETE", "SERVER", resID, metadata, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.auditLog.LogAction(c, "DELETE", "SERVER", resID, metadata, "SUCCESS")
	c.Status(http.StatusNoContent)
}

func (h *ServerHandler) ExecuteCommand(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var req struct {
		CommandText string `json:"command_text"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, _ := c.Get("user")
	resID := id.String()
	output, err := h.service.ExecuteCommand(c.Request.Context(), id, req.CommandText, user.(*domain.User))
	if err != nil {
		h.auditLog.LogAction(c, "EXECUTE_COMMAND", "SERVER", resID, map[string]string{"command": req.CommandText, "error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error(), "output": output})
		return
	}

	h.auditLog.LogAction(c, "EXECUTE_COMMAND", "SERVER", resID, map[string]string{"command": req.CommandText}, "SUCCESS")
	c.JSON(http.StatusOK, gin.H{"output": output})
}

func (h *ServerHandler) TestHttp(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var req struct {
		HttpUrl     string            `json:"http_url"`
		HttpMethod  string            `json:"http_method"`
		HttpHeaders map[string]string `json:"http_headers"`
		HttpBody    string            `json:"http_body"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	method := req.HttpMethod
	if method == "" {
		method = "GET"
	}
	userVal, _ := c.Get("user")
	user := userVal.(*domain.User)
	resID := id.String()

	// Convert headers map to JSON string for ExecuteHttp
	headersJSON, _ := json.Marshal(req.HttpHeaders)

	output, err := h.service.ExecuteHttp(c.Request.Context(), id, method, req.HttpUrl, req.HttpBody, string(headersJSON), user, nil)
	if err != nil {
		h.auditLog.LogAction(c, "TEST_HTTP", "SERVER", resID, map[string]string{"url": req.HttpUrl, "error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error(), "output": output})
		return
	}

	h.auditLog.LogAction(c, "TEST_HTTP", "SERVER", resID, map[string]string{"url": req.HttpUrl}, "SUCCESS")
	c.JSON(http.StatusOK, gin.H{"output": output})
}

func (h *ServerHandler) StartTerminalSession(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	user, _ := c.Get("user")
	sessionID, err := h.terminalService.StartSession(id, user.(*domain.User))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"session_id": sessionID})
}

func (h *ServerHandler) GetServerMetrics(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	userVal, _ := c.Get("user")
	user := userVal.(*domain.User)

	metrics, err := h.service.GetServerMetrics(id, user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, metrics)
}
