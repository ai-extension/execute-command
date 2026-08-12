package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/user/csm-backend/internal/domain"
	"github.com/user/csm-backend/internal/lib/utils"
	"github.com/user/csm-backend/internal/service"
)

type PageHandler struct {
	service         *service.PageService
	workflowService *service.WorkflowService
	executor        *service.WorkflowExecutor
	terminalService *service.TerminalService
	datasetService  *service.DatasetService
	scheduleService *service.ScheduleService
	auditLog        domain.AuditLogService
}

func NewPageHandler(s *service.PageService, ws *service.WorkflowService, e *service.WorkflowExecutor, ts *service.TerminalService, ds *service.DatasetService, ss *service.ScheduleService, auditLog domain.AuditLogService) *PageHandler {
	return &PageHandler{
		service:         s,
		workflowService: ws,
		executor:        e,
		terminalService: ts,
		datasetService:  ds,
		scheduleService: ss,
		auditLog:        auditLog,
	}
}

func (h *PageHandler) ListPages(c *gin.Context) {
	nsIDStr := c.Param("ns_id")
	nsID, err := uuid.Parse(nsIDStr)
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
	var isPublic *bool
	if pStr := c.Query("is_public"); pStr != "" {
		p := pStr == "true"
		isPublic = &p
	}

	var createdBy *uuid.UUID
	if cb := c.Query("created_by"); cb != "" {
		if id, err := uuid.Parse(cb); err == nil {
			createdBy = &id
		}
	}

	var tagIDs []uuid.UUID
	for _, idStr := range c.QueryArray("tag_ids") {
		if id, err := uuid.Parse(idStr); err == nil {
			tagIDs = append(tagIDs, id)
		}
	}

	user, _ := c.Get("user")
	pages, total, err := h.service.ListPagesPaginated(nsID, limit, offset, searchTerm, isPublic, createdBy, tagIDs, user.(*domain.User))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"items":  pages,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *PageHandler) CreatePage(c *gin.Context) {
	nsIDStr := c.Param("ns_id")
	nsID, err := uuid.Parse(nsIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid namespace id"})
		return
	}

	var page domain.Page
	if err := c.ShouldBindJSON(&page); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	page.NamespaceID = nsID

	authUser, _ := c.Get("user")
	userObj := authUser.(*domain.User)
	nsIDStr = nsID.String()
	if !domain.HasPermission(userObj, "pages", "WRITE", &nsIDStr, nil, nil) {
		c.JSON(http.StatusForbidden, gin.H{"error": "permission denied to create page in this namespace"})
		return
	}

	if err := h.service.CreatePage(&page, userObj); err != nil {
		h.auditLog.LogAction(c, "CREATE", "PAGE", "", map[string]string{"title": page.Title, "error": err.Error()}, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.auditLog.LogAction(c, "CREATE", "PAGE", page.ID.String(), map[string]string{"title": page.Title}, "SUCCESS")
	c.JSON(http.StatusCreated, page)
}

func (h *PageHandler) GetPage(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	user, _ := c.Get("user")
	page, err := h.service.GetPage(id, user.(*domain.User))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "page not found"})
		return
	}
	c.JSON(http.StatusOK, page)
}

func (h *PageHandler) UpdatePage(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var page domain.Page
	if err := c.ShouldBindJSON(&page); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	page.ID = id

	userVal, _ := c.Get("user")
	user := userVal.(*domain.User)

	// Fetch existing to verify permission and get NamespaceID
	existing, err := h.service.GetPageWithAction(id, user, "WRITE")
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "page not found or permission denied"})
		return
	}
	c.Set("namespace_id", existing.NamespaceID)

	diff := utils.CalculateDiff(existing, &page)

	if err := h.service.UpdatePage(&page, user); err != nil {
		meta := diff
		if meta == nil {
			meta = make(map[string]interface{})
		}
		meta["error"] = err.Error()
		h.auditLog.LogAction(c, "UPDATE", "PAGE", page.ID.String(), meta, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.auditLog.LogAction(c, "UPDATE", "PAGE", page.ID.String(), diff, "SUCCESS")
	c.JSON(http.StatusOK, page)
}

func (h *PageHandler) DeletePage(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	userVal, _ := c.Get("user")
	user := userVal.(*domain.User)

	// Fetch existing to verify permission and get metadata
	existing, err := h.service.GetPageWithAction(id, user, "DELETE")
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "page not found or permission denied"})
		return
	}
	c.Set("namespace_id", existing.NamespaceID)
	metadata := map[string]string{"title": existing.Title}

	if err := h.service.DeletePage(id, user); err != nil {
		metadata["error"] = err.Error()
		h.auditLog.LogAction(c, "DELETE", "PAGE", id.String(), metadata, "FAILED")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.auditLog.LogAction(c, "DELETE", "PAGE", id.String(), metadata, "SUCCESS")
	c.JSON(http.StatusOK, gin.H{"message": "page deleted"})
}

func (h *PageHandler) GetPublicPage(c *gin.Context) {
	slug := c.Param("slug")
	page, err := h.service.GetPageBySlug(slug)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "page not found"})
		return
	}

	if !h.checkPublicAccess(c, page) {
		c.JSON(http.StatusForbidden, gin.H{"error": "page is not public"})
		return
	}

	// Check expiration
	if page.ExpiresAt != nil && page.ExpiresAt.Before(time.Now()) {
		c.JSON(http.StatusGone, gin.H{"error": "page has expired"})
		return
	}

	requiresPassword := page.Password != ""
	if requiresPassword {
		if userObj, exists := c.Get("user"); exists {
			user := userObj.(*domain.User)
			nsIDStr := page.NamespaceID.String()
			pageIDStr := page.ID.String()
			if domain.HasPermission(user, "pages", "EXECUTE", &nsIDStr, &pageIDStr, nil) {
				requiresPassword = false
			}
		}
	}

	// If page requires a password, don't return the full content yet
	if requiresPassword {
		c.JSON(http.StatusOK, gin.H{
			"id":                page.ID,
			"title":             page.Title,
			"description":       page.Description,
			"is_public":         page.IsPublic,
			"requires_password": true,
		})
		return
	}

	h.sanitizePage(page)
	c.JSON(http.StatusOK, page)
}

func (h *PageHandler) VerifyPublicPage(c *gin.Context) {
	slug := c.Param("slug")
	var req struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	page, err := h.service.GetPageBySlug(slug)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "page not found"})
		return
	}

	if !h.checkPublicAccess(c, page) {
		c.JSON(http.StatusForbidden, gin.H{"error": "page is not public"})
		return
	}

	if err := h.service.ValidatePagePassword(page, req.Password); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid password"})
		return
	}

	// Issue short-lived session token
	token, expiresAt, err := h.service.IssuePageToken(page)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue token"})
		return
	}

	h.sanitizePage(page)
	c.JSON(http.StatusOK, gin.H{
		"page":       page,
		"token":      token,
		"expires_at": expiresAt,
	})
}

// verifyPageToken checks the X-Page-Token header for password-protected pages.
// Returns false and writes the error response if invalid.
func (h *PageHandler) verifyPageToken(c *gin.Context, page *domain.Page) bool {
	if page.Password == "" {
		return true // No password → no token required
	}

	// Bypass password/token if user has RBAC permissions
	if userObj, exists := c.Get("user"); exists {
		user := userObj.(*domain.User)
		nsIDStr := page.NamespaceID.String()
		pageIDStr := page.ID.String()
		if domain.HasPermission(user, "pages", "EXECUTE", &nsIDStr, &pageIDStr, nil) {
			return true
		}
	}

	token := c.GetHeader("X-Page-Token")
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required", "token_required": true})
		return false
	}
	if err := h.service.ValidatePageToken(page, token); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error(), "token_required": true})
		return false
	}
	return true
}

func (h *PageHandler) RunPublicWorkflow(c *gin.Context) {
	slug := c.Param("slug")
	workflowIDStr := c.Param("workflow_id")
	workflowID, err := uuid.Parse(workflowIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid workflow id"})
		return
	}

	page, err := h.service.GetPageBySlug(slug)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "page not found"})
		return
	}

	if !h.checkPublicAccess(c, page) {
		c.JSON(http.StatusForbidden, gin.H{"error": "page is not public"})
		return
	}

	// Check expiration
	if page.ExpiresAt != nil && page.ExpiresAt.Before(time.Now()) {
		c.JSON(http.StatusGone, gin.H{"error": "page has expired"})
		return
	}

	// Token verification (replaces raw password passing)
	if !h.verifyPageToken(c, page) {
		return
	}

	var inputReq struct {
		Inputs map[string]string `json:"inputs"`
	}
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&inputReq); err != nil {
			// Ignore bind error, inputs are optional
		}
	}

	// Verify workflow exists on page
	found := false
	for _, pw := range page.Workflows {
		if pw.WorkflowID == workflowID {
			found = true
			break
		}
	}
	if !found {
		c.JSON(http.StatusBadRequest, gin.H{"error": "workflow not part of this page"})
		return
	}

	execID := uuid.New()
	go func() {
		// Public run uses background context
		h.executor.Run(context.Background(), workflowID, execID, inputReq.Inputs, nil, &page.ID, "PAGE", nil, nil, nil, nil)
	}()

	h.auditLog.LogAction(c, "RUN_WORKFLOW", "PAGE", page.ID.String(), map[string]string{"workflow_id": workflowID.String(), "execution_id": execID.String()}, "SUCCESS")

	c.JSON(http.StatusAccepted, gin.H{
		"message":      "Workflow started",
		"execution_id": execID,
	})
}

func (h *PageHandler) StopPublicExecution(c *gin.Context) {
	slug := c.Param("slug")
	execIDStr := c.Param("exec_id")
	execID, err := uuid.Parse(execIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid execution id"})
		return
	}

	page, err := h.service.GetPageBySlug(slug)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "page not found"})
		return
	}

	if !h.checkPublicAccess(c, page) {
		c.JSON(http.StatusForbidden, gin.H{"error": "page is not public"})
		return
	}

	if page.ExpiresAt != nil && page.ExpiresAt.Before(time.Now()) {
		c.JSON(http.StatusGone, gin.H{"error": "page has expired"})
		return
	}

	if !h.verifyPageToken(c, page) {
		return
	}

	execution, err := h.workflowService.GetExecution(execID, nil)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "execution not found"})
		return
	}

	// Verify workflow belongs to this page
	found := false
	for _, pw := range page.Workflows {
		if pw.WorkflowID == execution.WorkflowID {
			found = true
			break
		}
	}
	if !found {
		c.JSON(http.StatusForbidden, gin.H{"error": "execution does not belong to this page"})
		return
	}

	if err := h.executor.StopExecution(execID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Execution stop signal sent"})
}

func (h *PageHandler) GetPublicExecutionLog(c *gin.Context) {
	slug := c.Param("slug")
	execIDStr := c.Param("exec_id")
	execID, err := uuid.Parse(execIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid execution id"})
		return
	}

	page, err := h.service.GetPageBySlug(slug)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "page not found"})
		return
	}

	if !h.checkPublicAccess(c, page) {
		c.JSON(http.StatusForbidden, gin.H{"error": "page is not public"})
		return
	}

	if page.ExpiresAt != nil && page.ExpiresAt.Before(time.Now()) {
		c.JSON(http.StatusGone, gin.H{"error": "page has expired"})
		return
	}

	if !h.verifyPageToken(c, page) {
		return
	}

	execution, err := h.workflowService.GetExecution(execID, nil)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "execution not found"})
		return
	}

	found := false
	for _, pw := range page.Workflows {
		if pw.WorkflowID == execution.WorkflowID {
			found = true
			break
		}
	}
	if !found {
		c.JSON(http.StatusForbidden, gin.H{"error": "execution does not belong to this page"})
		return
	}

	cwd, _ := os.Getwd()
	execLogDir := filepath.Join(cwd, "data", "logs", "executions", execID.String())
	mainLogPath := filepath.Join(execLogDir, "workflow.log")
	if _, err := os.Stat(mainLogPath); err == nil {
		serveLogFile(c, mainLogPath)
		return
	}

	if execution.Status == domain.StatusRunning || execution.Status == domain.StatusPending {
		c.String(http.StatusOK, "")
		return
	}

	if execution.LogPath != "" {
		oldPath := execution.LogPath
		if !filepath.IsAbs(oldPath) {
			oldPath = filepath.Join(cwd, oldPath)
		}
		if _, err := os.Stat(oldPath); err == nil {
			serveLogFile(c, oldPath)
			return
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "log file not found"})
}

// GetPublicExecutionStatuses resolves the current status of a batch of executions in a
// single request. Public history is persisted client-side as RUNNING; on reload (or
// after the live terminal is closed) those entries never reconcile, so they spin
// forever. The client sends every stale RUNNING id at once and we answer with their
// real status — one round-trip instead of one request per record.
func (h *PageHandler) GetPublicExecutionStatuses(c *gin.Context) {
	slug := c.Param("slug")

	page, err := h.service.GetPageBySlug(slug)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "page not found"})
		return
	}

	if !h.checkPublicAccess(c, page) {
		c.JSON(http.StatusForbidden, gin.H{"error": "page is not public"})
		return
	}

	if page.ExpiresAt != nil && page.ExpiresAt.Before(time.Now()) {
		c.JSON(http.StatusGone, gin.H{"error": "page has expired"})
		return
	}

	if !h.verifyPageToken(c, page) {
		return
	}

	var body struct {
		ExecutionIDs []string `json:"execution_ids"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	// Cap the batch so a public caller can't ask for an unbounded set.
	const maxIDs = 100
	if len(body.ExecutionIDs) > maxIDs {
		body.ExecutionIDs = body.ExecutionIDs[:maxIDs]
	}

	ids := make([]uuid.UUID, 0, len(body.ExecutionIDs))
	for _, raw := range body.ExecutionIDs {
		if id, err := uuid.Parse(raw); err == nil {
			ids = append(ids, id)
		}
	}

	type statusItem struct {
		ID         string     `json:"id"`
		Status     string     `json:"status"`
		FinishedAt *time.Time `json:"finished_at,omitempty"`
	}
	out := make([]statusItem, 0, len(ids))

	if len(ids) > 0 {
		// Only expose executions that actually belong to this page's workflows.
		allowed := make(map[uuid.UUID]bool, len(page.Workflows))
		for _, pw := range page.Workflows {
			allowed[pw.WorkflowID] = true
		}

		execs, err := h.workflowService.GetExecutionStatuses(ids)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load statuses"})
			return
		}
		for _, e := range execs {
			if allowed[e.WorkflowID] {
				out = append(out, statusItem{
					ID:         e.ID.String(),
					Status:     string(e.Status),
					FinishedAt: e.FinishedAt,
				})
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"statuses": out})
}

// pageReferencesDataset returns true when the page layout has at least one widget
// whose dataset.dataset_id matches datasetID. Layout is loose JSON; we tolerate parse
// failures by returning false (deny access).
func pageReferencesDataset(layout string, datasetID uuid.UUID) bool {
	if layout == "" {
		return false
	}
	var doc struct {
		Widgets []struct {
			Dataset struct {
				DatasetID string `json:"dataset_id"`
			} `json:"dataset"`
		} `json:"widgets"`
	}
	if err := json.Unmarshal([]byte(layout), &doc); err != nil {
		return false
	}
	target := datasetID.String()
	for _, w := range doc.Widgets {
		if w.Dataset.DatasetID == target {
			return true
		}
	}
	return false
}

// resolvePublicDataset runs all the access checks shared by the public dataset
// endpoints (slug → page → public/expiry/token → namespace → layout-reference). On
// failure it writes an HTTP error and returns nil; callers must abort.
func (h *PageHandler) resolvePublicDataset(c *gin.Context) (*domain.Dataset, *domain.Page) {
	slug := c.Param("slug")
	datasetID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid dataset id"})
		return nil, nil
	}
	page, err := h.service.GetPageBySlug(slug)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "page not found"})
		return nil, nil
	}
	if !h.checkPublicAccess(c, page) {
		c.JSON(http.StatusForbidden, gin.H{"error": "page is not public"})
		return nil, nil
	}
	if page.ExpiresAt != nil && page.ExpiresAt.Before(time.Now()) {
		c.JSON(http.StatusGone, gin.H{"error": "page has expired"})
		return nil, nil
	}
	if !h.verifyPageToken(c, page) {
		return nil, nil // verifyPageToken already wrote the error
	}
	ds, err := h.datasetService.GetDatasetForPublic(datasetID)
	if err != nil || ds == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "dataset not found"})
		return nil, nil
	}
	if ds.NamespaceID != page.NamespaceID {
		c.JSON(http.StatusForbidden, gin.H{"error": "dataset not in page namespace"})
		return nil, nil
	}
	// Reject datasets not referenced by any widget on this page. Without this,
	// the page slug+token would grant read access to every dataset in the namespace.
	if !pageReferencesDataset(page.Layout, datasetID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "dataset not used by this page"})
		return nil, nil
	}
	return ds, page
}

// AggregatePublicDataset proxies POST /public/pages/:slug/datasets/:id/aggregate.
func (h *PageHandler) AggregatePublicDataset(c *gin.Context) {
	ds, _ := h.resolvePublicDataset(c)
	if ds == nil {
		return
	}

	var body struct {
		Filter   string   `json:"filter"`
		GroupBys []string `json:"group_bys"`
		Selects  []struct {
			Field string `json:"field"`
			Fn    string `json:"fn"`
			Label string `json:"label"`
		} `json:"selects"`
		GroupBy string `json:"group_by"`
		Metric  string `json:"metric"`
		Fn      string `json:"fn"`
		Limit   int    `json:"limit"`
		Sort    string `json:"sort"`
	}
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	selects := make([]service.AggregateSelect, 0, len(body.Selects))
	for _, s := range body.Selects {
		selects = append(selects, service.AggregateSelect{Field: s.Field, Fn: s.Fn, Label: s.Label})
	}

	items, err := h.datasetService.AggregatePublic(ds.ID, service.AggregateRequest{
		Filter:   body.Filter,
		GroupBys: body.GroupBys,
		Selects:  selects,
		GroupBy:  body.GroupBy,
		Metric:   body.Metric,
		Fn:       body.Fn,
		Limit:    body.Limit,
		Sort:     body.Sort,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// ListPublicDatasetRecords proxies GET /public/pages/:slug/datasets/:id/records.
func (h *PageHandler) ListPublicDatasetRecords(c *gin.Context) {
	ds, _ := h.resolvePublicDataset(c)
	if ds == nil {
		return
	}

	limit := 50
	offset := 0
	if l := c.Query("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 {
			limit = v
		}
	}
	if limit > maxPageLimit {
		limit = maxPageLimit
	}
	if o := c.Query("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil && v >= 0 {
			offset = v
		}
	}
	items, total, err := h.datasetService.ListRecordsPublic(ds.ID, limit, offset, c.Query("search"), c.Query("filter"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "limit": limit, "offset": offset})
}

func (h *PageHandler) UploadPublicInputFile(c *gin.Context) {
	slug := c.Param("slug")
	page, err := h.service.GetPageBySlug(slug)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "page not found"})
		return
	}

	if !h.checkPublicAccess(c, page) {
		c.JSON(http.StatusForbidden, gin.H{"error": "page is not public"})
		return
	}

	if page.ExpiresAt != nil && page.ExpiresAt.Before(time.Now()) {
		c.JSON(http.StatusGone, gin.H{"error": "page has expired"})
		return
	}

	if !h.verifyPageToken(c, page) {
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}

	inputSessionID := c.PostForm("session_id")
	if inputSessionID == "" {
		inputSessionID = uuid.New().String()
	}

	baseDir := filepath.Join("data", "uploads", "inputs", inputSessionID)
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create directory"})
		return
	}

	absBaseDir, err := filepath.Abs(baseDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get absolute path"})
		return
	}

	ext := filepath.Ext(file.Filename)
	nameOnly := strings.TrimSuffix(file.Filename, ext)
	safeName := Slugify(nameOnly)
	if safeName == "" {
		safeName = "file"
	}

	finalFilename := fmt.Sprintf("%s_%d%s", safeName, time.Now().Unix(), ext)
	localPath := filepath.Join(absBaseDir, finalFilename)

	if err := c.SaveUploadedFile(file, localPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"path":       localPath,
		"session_id": inputSessionID,
	})
}

// Guardrails for public (page-originated) scheduling.
const (
	maxPublicScheduleRepeatDays = 10  // cap on the recurring window a visitor can request
	maxActiveSchedulesPerPage   = 20  // cap on concurrent active schedules per page
	maxTotalSchedulesPerPage    = 100 // cap on total retained schedule rows per page (prunes old terminal ones)
)

// resolvePublicPage runs the shared public-page access checks (slug → public/expiry → token)
// used by the scheduling endpoints. On failure it writes the HTTP error and returns nil.
func (h *PageHandler) resolvePublicPage(c *gin.Context) *domain.Page {
	slug := c.Param("slug")
	page, err := h.service.GetPageBySlug(slug)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "page not found"})
		return nil
	}
	if !h.checkPublicAccess(c, page) {
		c.JSON(http.StatusForbidden, gin.H{"error": "page is not public"})
		return nil
	}
	if page.ExpiresAt != nil && page.ExpiresAt.Before(time.Now()) {
		c.JSON(http.StatusGone, gin.H{"error": "page has expired"})
		return nil
	}
	if !h.verifyPageToken(c, page) {
		return nil // verifyPageToken already wrote the error
	}
	return page
}

// CreatePublicSchedule lets a public visitor schedule an ENDPOINT widget's workflow. The
// workflow must belong to the page and its widget must opt into scheduling. A one-time run
// (default) becomes ONE_TIME; opting into repeat turns it into a daily RECURRING schedule
// bounded to a [run_at, run_at + N days] window (N capped server-side).
func (h *PageHandler) CreatePublicSchedule(c *gin.Context) {
	workflowID, err := uuid.Parse(c.Param("workflow_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid workflow id"})
		return
	}
	page := h.resolvePublicPage(c)
	if page == nil {
		return
	}

	inPage := false
	for _, pw := range page.Workflows {
		if pw.WorkflowID == workflowID {
			inPage = true
			break
		}
	}
	if !inPage {
		c.JSON(http.StatusBadRequest, gin.H{"error": "workflow not part of this page"})
		return
	}
	if !page.WidgetAllowsSchedule(workflowID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "scheduling not enabled for this widget"})
		return
	}

	var req struct {
		RunAt      string            `json:"run_at" binding:"required"` // RFC3339 first-run time
		Repeat     bool              `json:"repeat"`
		RepeatDays int               `json:"repeat_days"`
		Inputs     map[string]string `json:"inputs"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	runAt, err := parseTimestamp(req.RunAt)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid run_at"})
		return
	}
	if !runAt.After(time.Now()) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "run_at must be in the future"})
		return
	}

	// Cap concurrent active schedules AND total retained rows per page. This is the real
	// creation ceiling: LoginRateLimiter only throttles failed (4xx) calls, so a stream of
	// successful (201) creations would otherwise be unbounded.
	if err := h.scheduleService.EnforcePageScheduleCaps(page.ID, maxActiveSchedulesPerPage, maxTotalSchedulesPerPage); err != nil {
		if errors.Is(err, service.ErrScheduleCapReached) {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": err.Error()})
		} else {
			// Infrastructure failure — fail closed and don't leak the internal error.
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to validate schedule limits"})
		}
		return
	}

	inputsJSON := "{}"
	if len(req.Inputs) > 0 {
		if b, mErr := json.Marshal(req.Inputs); mErr == nil {
			inputsJSON = string(b)
		}
	}

	runAtUTC := runAt.UTC()
	schedule := &domain.Schedule{
		NamespaceID:       page.NamespaceID,
		PageID:            &page.ID,
		Status:            "ACTIVE",
		CreatedBy:         page.CreatedBy,
		CreatedByUsername: page.CreatedByUsername,
	}

	if req.Repeat && req.RepeatDays > 0 {
		days := req.RepeatDays
		if days > maxPublicScheduleRepeatDays {
			days = maxPublicScheduleRepeatDays
		}
		start := runAtUTC
		end := runAtUTC.AddDate(0, 0, days)
		schedule.Type = domain.ScheduleTypeRecurring
		// The cron engine runs in the server's local timezone, so derive the daily H:M from
		// the local representation of the chosen instant — otherwise a non-UTC server would
		// fire at the wrong wall-clock time. StartDate/EndDate stay UTC instants (the window
		// checks compare against time.Now().UTC()).
		runAtLocal := runAtUTC.In(time.Local)
		schedule.CronExpression = fmt.Sprintf("%d %d * * *", runAtLocal.Minute(), runAtLocal.Hour())
		schedule.StartDate = &start
		schedule.EndDate = &end
		schedule.Name = fmt.Sprintf("%s — daily x%dd", page.Title, days)
	} else {
		schedule.Type = domain.ScheduleTypeOneTime
		schedule.NextRunAt = &runAtUTC
		schedule.Name = fmt.Sprintf("%s — one-time", page.Title)
	}

	workflowConfigs := []domain.ScheduleWorkflow{{WorkflowID: workflowID, Inputs: inputsJSON}}
	if err := h.scheduleService.CreateForPage(schedule, workflowConfigs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.auditLog.LogAction(c, "CREATE", "SCHEDULE", schedule.ID.String(), map[string]string{"page_id": page.ID.String(), "workflow_id": workflowID.String()}, "SUCCESS")
	// Don't echo the page owner's identity back to a public creator.
	schedule.CreatedBy = nil
	schedule.CreatedByUsername = ""
	c.JSON(http.StatusCreated, schedule)
}

// ListPublicSchedules returns the schedules a page created, optionally filtered to one
// workflow (the widget only shows its own). Internal server ids are stripped.
func (h *PageHandler) ListPublicSchedules(c *gin.Context) {
	page := h.resolvePublicPage(c)
	if page == nil {
		return
	}
	list, err := h.scheduleService.ListByPage(page.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	wfFilter := c.Query("workflow_id")
	out := make([]domain.Schedule, 0, len(list))
	for _, sc := range list {
		if wfFilter != "" {
			match := false
			for _, sw := range sc.ScheduledWorkflows {
				if sw.WorkflowID.String() == wfFilter {
					match = true
					break
				}
			}
			if !match {
				continue
			}
		}
		// Strip everything internal: the schedules tab only needs status/type/timing. Drop
		// the full workflow rows (name/description/ai_guide/creator) and the schedule's
		// creator identity rather than leak them to public (possibly anonymous) visitors.
		sc.CreatedBy = nil
		sc.CreatedByUsername = ""
		for i := range sc.ScheduledWorkflows {
			sc.ScheduledWorkflows[i].Workflow = nil
			// Inputs are supplied by whoever created the schedule and may hold values another
			// visitor typed (ids, emails, tokens). A public — possibly anonymous — list must
			// not echo them back to other visitors.
			sc.ScheduledWorkflows[i].Inputs = ""
		}
		out = append(out, sc)
	}
	c.JSON(http.StatusOK, gin.H{"schedules": out})
}

// CancelPublicSchedule cancels a page-owned schedule. The service verifies the schedule
// actually belongs to this page before deleting.
func (h *PageHandler) CancelPublicSchedule(c *gin.Context) {
	scheduleID, err := uuid.Parse(c.Param("schedule_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid schedule id"})
		return
	}
	page := h.resolvePublicPage(c)
	if page == nil {
		return
	}
	if err := h.scheduleService.CancelForPage(page.ID, scheduleID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	h.auditLog.LogAction(c, "DELETE", "SCHEDULE", scheduleID.String(), map[string]string{"page_id": page.ID.String()}, "SUCCESS")
	c.JSON(http.StatusOK, gin.H{"message": "schedule cancelled"})
}

func (h *PageHandler) sanitizePage(page *domain.Page) {
	if page == nil {
		return
	}
	page.Password = "" // Never return the hash to public users
	now := time.Now()
	page.ServerTime = &now // Reference clock for time-boxed widget badges
	for i := range page.Workflows {
		if page.Workflows[i].Workflow != nil {
			page.Workflows[i].Workflow.DefaultServerID = nil // Hide internal server IDs
		}
	}
	// Only expose the minimal parent info needed for the public breadcrumb link;
	// strip the parent's password/workflows so nothing internal leaks. The parent's
	// Layout is exposed only when this page opts into the parent sidebar — sidebar
	// widgets render read-only and deep-link back to the parent page, so the parent's
	// PageWorkflows (inputs/server config) are never needed here.
	if page.Parent != nil {
		trimmed := &domain.Page{
			ID:       page.Parent.ID,
			Title:    page.Parent.Title,
			Slug:     page.Parent.Slug,
			IsPublic: page.Parent.IsPublic,
		}
		// Expose the parent's layout only when opted in AND the parent is freely viewable
		// on its own: public, without a password, and not expired. This mirrors exactly what
		// GetPublicPage would return for the parent to an anonymous visitor, so the sidebar
		// can never bypass the parent's password gate or leak an expired/private layout.
		parentViewable := page.Parent.IsPublic &&
			page.Parent.Password == "" &&
			(page.Parent.ExpiresAt == nil || page.Parent.ExpiresAt.After(time.Now()))
		if page.ShowParentSidebar && parentViewable {
			trimmed.Layout = page.Parent.Layout
		}
		page.Parent = trimmed
	}
}

func (h *PageHandler) sanitizeExecution(execution *domain.WorkflowExecution) {
	if execution == nil {
		return
	}
	if execution.Workflow != nil {
		execution.Workflow.DefaultServerID = nil
	}
	if execution.User != nil {
		execution.User.PasswordHash = ""
		execution.User.Email = "" // Protect PII
	}
}

func (h *PageHandler) checkPublicAccess(c *gin.Context, page *domain.Page) bool {
	if page.IsPublic {
		return true
	}
	userVal, exists := c.Get("user")
	if !exists {
		return false
	}
	user := userVal.(*domain.User)
	nsIDStr := page.NamespaceID.String()
	pageIDStr := page.ID.String()
	return domain.HasPermission(user, "pages", "EXECUTE", &nsIDStr, &pageIDStr, nil)
}
