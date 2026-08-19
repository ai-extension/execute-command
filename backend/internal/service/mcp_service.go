package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
	"github.com/user/csm-backend/internal/domain"
)

type MCPService struct {
	server          *server.MCPServer
	workflowService *WorkflowService
	executor        *WorkflowExecutor
	scheduleService *ScheduleService
	tagService      *TagService
}

func NewMCPService(wfService *WorkflowService, exec *WorkflowExecutor, schedService *ScheduleService, tagService *TagService) *MCPService {
	s := server.NewMCPServer(
		"CSM-Execute-MCP",
		"1.0.0",
	)

	mcpSvc := &MCPService{
		server:          s,
		workflowService: wfService,
		executor:        exec,
		scheduleService: schedService,
		tagService:      tagService,
	}

	mcpSvc.registerTools()
	return mcpSvc
}

func (s *MCPService) GetServer() *server.MCPServer {
	return s.server
}

func (s *MCPService) registerTools() {
	// 1. list_workflows
	listWorkflowsTool := mcp.NewTool("list_workflows",
		mcp.WithDescription("Lấy danh sách các workflow có thể chạy. Trả về metadata và hướng dẫn AI (AIGuide). QUY TẮC: AI không được tự ý chạy lại hoặc tự động chọn workflow thay thế khi không có sự đồng ý từ User."),
		mcp.WithString("tags", mcp.Description("Lọc workflow theo tag ID (phân tách bằng dấu phẩy). QUY TẮC: Bắt buộc gửi lên ID của tag (lấy từ get_tags), không gửi tên.")),
	)
	s.server.AddTool(listWorkflowsTool, s.handleListWorkflows)

	// 2. run_workflow
	runWorkflowTool := mcp.NewTool("run_workflow",
		mcp.WithDescription("Chạy một workflow dựa theo ID. QUY TẮC: AI tuyệt đối không được tự ý chạy lại hoặc tự động chọn workflow thay thế khi chưa có sự đồng ý từ user."),
		mcp.WithString("workflow_id", mcp.Required(), mcp.Description("UUID của workflow cần chạy")),
		mcp.WithString("inputs", mcp.Description("Các biến đầu vào định dạng JSON string. Ví dụ: '{\"branch\": \"main\"}'")),
	)
	s.server.AddTool(runWorkflowTool, s.handleRunWorkflow)

	// 3. get_execution_log
	getLogTool := mcp.NewTool("get_execution_log",
		mcp.WithDescription("Xem trạng thái và log của execution. QUY TẮC: AI không được tự ý chạy lại hoặc tự động chọn workflow thay thế khi không có sự đồng ý từ User."),
		mcp.WithString("execution_id", mcp.Required(), mcp.Description("UUID của execution")),
		mcp.WithBoolean("wait", mcp.Description("Nếu true, tool sẽ đợi cho đến khi workflow kết thúc (tối đa 30 giây) trước khi trả về kết quả.")),
	)
	s.server.AddTool(getLogTool, s.handleGetExecutionLog)

	// 4. schedule_workflow
	scheduleTool := mcp.NewTool("schedule_workflow",
		mcp.WithDescription("Đặt lịch chạy cho workflow. QUY TẮC: AI không được tự ý chạy lại hoặc tự động chọn workflow thay thế khi không có sự đồng ý từ User."),
		mcp.WithString("workflow_id", mcp.Required(), mcp.Description("UUID của workflow cần đặt lịch")),
		mcp.WithString("name", mcp.Required(), mcp.Description("Tên của lịch trình (ví dụ: 'Daily Backup')")),
		mcp.WithString("type", mcp.Required(), mcp.Description("Loại lịch: 'ONE_TIME' hoặc 'RECURRING'")),
		mcp.WithString("cron_expression", mcp.Description("Biểu thức Cron (nếu type = RECURRING, ví dụ: '0 0 * * *' cho hàng ngày lúc 00:00)")),
		mcp.WithString("next_run_at", mcp.Description("Thời gian chạy (nếu type = ONE_TIME, chuẩn RFC3339)")),
		mcp.WithString("inputs", mcp.Description("Biến đầu vào định dạng JSON string. Ví dụ: '{\"branch\": \"main\"}'")),
	)
	s.server.AddTool(scheduleTool, s.handleScheduleWorkflow)

	// 5. get_tags
	getTagsTool := mcp.NewTool("get_tags",
		mcp.WithDescription("Lấy danh sách các tags hiện có và mô tả của chúng. Sử dụng ID của tag từ danh sách này để filter workflow trong list_workflows."),
	)
	s.server.AddTool(getTagsTool, s.handleGetTags)
}

func getUserFromContext(ctx context.Context) (*domain.User, *uuid.UUID, error) {
	val := ctx.Value("user")
	if val == nil {
		return nil, nil, fmt.Errorf("không tìm thấy thông tin xác thực")
	}
	user, ok := val.(*domain.User)
	if !ok {
		return nil, nil, fmt.Errorf("thông tin xác thực không hợp lệ")
	}

	var apiKeyID *uuid.UUID
	keyVal := ctx.Value("api_key_id")
	if keyVal != nil {
		if id, ok := keyVal.(uuid.UUID); ok {
			apiKeyID = &id
		}
	}
	return user, apiKeyID, nil
}

func (s *MCPService) handleListWorkflows(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	user, _, err := getUserFromContext(ctx)
	if err != nil {
		return mcp.NewToolResultError("Unauthorized"), nil
	}
	// Actually we should list workflows accessible by this user.
	// Since MCP needs the workflows the user can execute, we can iterate and check permission or just format the list.
	// For simplicity, we just use ListWorkflows Paginated or Global. But we need namespace.
	// If it's global, ListGlobalPaginated requires scope.
	// Let's just create a simplified version for MCP or just loop through using user scope.

	// Prepare permission scope
	scope := domain.GetPermissionScope(user, "workflows", "EXECUTE")

	var tagIDs []uuid.UUID
	tagsParam := request.GetString("tags", "")
	if tagsParam != "" {
		tagIDsStr := strings.Split(tagsParam, ",")
		for _, idStr := range tagIDsStr {
			idStr = strings.TrimSpace(idStr)
			if idStr == "" {
				continue
			}
			if parsedID, err := uuid.Parse(idStr); err == nil {
				tagIDs = append(tagIDs, parsedID)
			}
		}
	}

	// Getting workflows that user has EXECUTE access
	// To avoid complex DB queries here, we use ListGlobalPaginated with scope
	var isTemplate bool = false
	wfs, _, err := s.workflowService.ListGlobalPaginated(50, 0, "", tagIDs, &isTemplate, &scope)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("Lỗi khi lấy danh sách: %v", err)), nil
	}


	var result []map[string]interface{}
	for _, wf := range wfs {
		inputs := []map[string]interface{}{}
		for _, in := range wf.Inputs {
			inputMap := map[string]interface{}{
				"key":           in.Key,
				"label":         in.Label,
				"type":          in.Type,
				"required":      in.Required,
				"default_value": in.DefaultValue,
			}

			// Add additional info based on type to help AI understand the input
			if in.Type == "select" || in.Type == "multi-select" {
				rawOptions := strings.Split(in.DefaultValue, ",")
				options := []string{}
				for _, opt := range rawOptions {
					trimmed := strings.TrimSpace(opt)
					if trimmed != "" {
						options = append(options, trimmed)
					}
				}
				inputMap["options"] = options
			} else if in.Type == "date" || in.Type == "time" {
				// Tell the AI the exact string format a date/time input expects
				inputMap["format"] = InputDateTimeFormatHint(in.Type, in.IncludeTime)
			} else if in.Type == "multi-input" {
				// Multi-input stores field definitions in DefaultValue as JSON
				var fields []map[string]interface{}
				if err := json.Unmarshal([]byte(in.DefaultValue), &fields); err == nil {
					inputMap["multi_input_config"] = fields
				}
			}

			inputs = append(inputs, inputMap)
		}

		result = append(result, map[string]interface{}{
			"id":          wf.ID,
			"name":        wf.Name,
			"description": wf.Description,
			"ai_guide":    wf.AIGuide,
			"inputs":      inputs,
		})
	}

	bytes, _ := json.MarshalIndent(result, "", "  ")
	return mcp.NewToolResultText(string(bytes)), nil
}

func (s *MCPService) handleRunWorkflow(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	user, apiKeyID, err := getUserFromContext(ctx)
	if err != nil {
		return mcp.NewToolResultError("Unauthorized"), nil
	}

	wfIDStr, err := request.RequireString("workflow_id")
	if err != nil {
		return mcp.NewToolResultError("Thiếu workflow_id"), nil
	}
	wfID, err := uuid.Parse(wfIDStr)
	if err != nil {
		return mcp.NewToolResultError("workflow_id không hợp lệ"), nil
	}

	var inputs map[string]string
	if inputsStr := request.GetString("inputs", ""); inputsStr != "" {
		_ = json.Unmarshal([]byte(inputsStr), &inputs)
	}

	wf, err := s.workflowService.GetWorkflowWithAction(wfID, user, "EXECUTE")
	if err != nil {
		return mcp.NewToolResultError("Không tìm thấy workflow hoặc không có quyền EXECUTE"), nil
	}

	// Validate inputs before execution
	if err := s.executor.validateInputs(wf, inputs); err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("Input validation failed: %v", err)), nil
	}

	execID := uuid.New()
	execution := &domain.WorkflowExecution{
		ID:            execID,
		WorkflowID:    wf.ID,
		Status:        domain.StatusRunning,
		StartedAt:     time.Now(),
		ExecutedBy:    &user.ID,
		APIKeyID:      apiKeyID,
		TriggerSource: "MCP",
	}

	if len(inputs) > 0 {
		inputsBytes, _ := json.Marshal(inputs)
		execution.Inputs = string(inputsBytes)
	}

	if err := s.workflowService.CreateExecution(execution); err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("Không thể tạo execution: %v", err)), nil
	}

	// Chạy dưới dạng background (goroutine)
	go func() {
		// Dùng context.Background() để nó không bị ngắt khi request MCP kết thúc
		_ = s.executor.Run(context.Background(), wf.ID, execID, inputs, nil, nil, "MCP", user, nil, nil, nil)
	}()

	return mcp.NewToolResultText(fmt.Sprintf("Workflow %s đang chạy. execution_id: %s. Hãy sử dụng tool 'get_execution_log' với execution_id này (có thể truyền thêm wait=true) để theo dõi tiến độ và xem kết quả cuối cùng.", wf.Name, execID.String())), nil
}

func (s *MCPService) handleGetExecutionLog(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	user, _, err := getUserFromContext(ctx)
	if err != nil {
		return mcp.NewToolResultError("Unauthorized"), nil
	}

	execIDStr, err := request.RequireString("execution_id")
	if err != nil {
		return mcp.NewToolResultError("Thiếu execution_id"), nil
	}
	execID, err := uuid.Parse(execIDStr)
	if err != nil {
		return mcp.NewToolResultError("execution_id không hợp lệ"), nil
	}

	// Fetch execution with steps
	exec, err := s.workflowService.GetExecution(execID, user)
	if err != nil {
		return mcp.NewToolResultError("Không tìm thấy execution hoặc không có quyền"), nil
	}

	// Optional wait logic: Instant signal instead of 2s polling
	wait := request.GetBool("wait", false)
	if wait && (exec.Status == domain.StatusPending || exec.Status == domain.StatusRunning) {
		waitChan := s.executor.GetWaitChan(execID)
		if waitChan != nil {
			// Wait for either the execution to finish, a 30s timeout, or client cancellation
			select {
			case <-waitChan:
				// Execution finished! Re-fetch final state below
			case <-time.After(30 * time.Second):
				// Timeout reached
			case <-ctx.Done():
				// Client disconnected
			}
			// Re-fetch to get final status and full logs
			exec, _ = s.workflowService.GetExecution(execID, user)
		}
	}

	// Structured Metadata Result
	type StepResult struct {
		Name       string     `json:"name"`
		Status     string     `json:"status"`
		StartedAt  time.Time  `json:"started_at"`
		FinishedAt *time.Time `json:"finished_at,omitempty"`
		Output     string     `json:"output,omitempty"`
	}

	type GroupResult struct {
		Name       string       `json:"name"`
		Status     string       `json:"status"`
		Retries    int          `json:"retries"`
		Steps      []StepResult `json:"steps"`
	}

	type ExecutionSummary struct {
		ID         uuid.UUID     `json:"id"`
		Status     string        `json:"status"`
		StartedAt  time.Time     `json:"started_at"`
		FinishedAt *time.Time    `json:"finished_at,omitempty"`
		Groups     []GroupResult `json:"groups"`
	}

	summary := ExecutionSummary{
		ID:         exec.ID,
		Status:     string(exec.Status),
		StartedAt:  exec.StartedAt,
		FinishedAt: exec.FinishedAt,
		Groups:     []GroupResult{},
	}

	// Group steps by group ID to calculate retries and structure results
	groupMap := make(map[uuid.UUID]*GroupResult)
	stepCounts := make(map[uuid.UUID]int) // StepID -> count

	// Find the workflow to get group list in order and check log reporting options
	wf, _ := s.workflowService.GetWorkflow(exec.WorkflowID, user)
	groupLogOptions := make(map[uuid.UUID]bool)
	if wf != nil {
		for _, g := range wf.Groups {
			groupLogOptions[g.ID] = g.McpReportLog
		}
	}

	for _, stepExec := range exec.Steps {
		if _, exists := groupMap[stepExec.GroupID]; !exists {
			groupMap[stepExec.GroupID] = &GroupResult{
				Name:  stepExec.GroupName,
				Steps: []StepResult{},
			}
		}
		
		// Map status for group based on last step if needed, but executor updates group status in DB
		// We'll calculate retries by counting how many times the steps in this group were executed
		stepCounts[stepExec.StepID]++
		
		stepRes := StepResult{
			Name:       stepExec.Name,
			Status:     string(stepExec.Status),
			StartedAt:  stepExec.StartedAt,
			FinishedAt: stepExec.FinishedAt,
		}

		// Include output if group level option is enabled
		if groupLogOptions[stepExec.GroupID] {
			stepRes.Output = stepExec.Output
		}

		groupMap[stepExec.GroupID].Steps = append(groupMap[stepExec.GroupID].Steps, stepRes)
	}

	if wf != nil {
		for _, g := range wf.Groups {
			if res, ok := groupMap[g.ID]; ok {
				// Calculate retries: max attempts for any step in this group - 1
				maxAttempts := 0
				for _, step := range g.Steps {
					if count := stepCounts[step.ID]; count > maxAttempts {
						maxAttempts = count
					}
				}
				if maxAttempts > 1 {
					res.Retries = maxAttempts - 1
				}
				
				res.Status = string(g.Status) // This should be updated in DB by executor
				summary.Groups = append(summary.Groups, *res)
			}
		}
	} else {
		// Fallback if workflow deleted
		for _, g := range groupMap {
			summary.Groups = append(summary.Groups, *g)
		}
	}

	bytes, _ := json.MarshalIndent(summary, "", "  ")
	return mcp.NewToolResultText(string(bytes)), nil
}

func (s *MCPService) handleScheduleWorkflow(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	user, _, err := getUserFromContext(ctx)
	if err != nil {
		return mcp.NewToolResultError("Unauthorized"), nil
	}

	wfIDStr, err := request.RequireString("workflow_id")
	if err != nil {
		return mcp.NewToolResultError("Thiếu workflow_id"), nil
	}
	name, err := request.RequireString("name")
	if err != nil {
		return mcp.NewToolResultError("Thiếu name"), nil
	}
	schedType, err := request.RequireString("type")
	if err != nil {
		return mcp.NewToolResultError("Thiếu type"), nil
	}
	wfID, err := uuid.Parse(wfIDStr)
	if err != nil {
		return mcp.NewToolResultError("workflow_id không hợp lệ"), nil
	}

	wf, err := s.workflowService.GetWorkflowWithAction(wfID, user, "EXECUTE")
	if err != nil {
		return mcp.NewToolResultError("Không tìm thấy workflow hoặc không có quyền"), nil
	}

	schedule := &domain.Schedule{
		ID:          uuid.New(),
		NamespaceID: wf.NamespaceID,
		Name:        name,
		Type:        domain.ScheduleType(schedType),
		Status:      "ACTIVE",
		CreatedBy:   &user.ID,
	}

	if schedType == string(domain.ScheduleTypeRecurring) {
		cronExpr := request.GetString("cron_expression", "")
		if cronExpr == "" {
			return mcp.NewToolResultError("Thiếu cron_expression cho Recurring schedule"), nil
		}
		schedule.CronExpression = cronExpr
	} else if schedType == string(domain.ScheduleTypeOneTime) {
		nextRunStr := request.GetString("next_run_at", "")
		if nextRunStr == "" {
			return mcp.NewToolResultError("Thiếu next_run_at cho One-time schedule"), nil
		}
		parsedTime, err := time.Parse(time.RFC3339, nextRunStr)
		if err != nil {
			return mcp.NewToolResultError("next_run_at không đúng định dạng RFC3339"), nil
		}
		schedule.NextRunAt = &parsedTime
	} else {
		return mcp.NewToolResultError("type không hợp lệ (phải là ONE_TIME hoặc RECURRING)"), nil
	}

	inputs := request.GetString("inputs", "")

	swConfigs := []domain.ScheduleWorkflow{
		{
			ID:         uuid.New(),
			ScheduleID: schedule.ID,
			WorkflowID: wf.ID,
			Inputs:     inputs,
		},
	}

	if err := s.scheduleService.Create(schedule, swConfigs, user); err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("Không thể tạo schedule: %v", err)), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("Đã tạo lịch %s thành công. Schedule ID: %s", schedule.Name, schedule.ID.String())), nil
}

func (s *MCPService) handleGetTags(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	user, _, err := getUserFromContext(ctx)
	if err != nil {
		return mcp.NewToolResultError("Unauthorized"), nil
	}

	tags, _, err := s.tagService.ListGlobalPaginated(1000, 0, "", user)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("Lỗi khi lấy danh sách tags: %v", err)), nil
	}

	var result []map[string]interface{}
	for _, t := range tags {
		result = append(result, map[string]interface{}{
			"id":          t.ID,
			"name":        t.Name,
			"description": t.Description,
			"color":       t.Color,
		})
	}

	bytes, _ := json.MarshalIndent(result, "", "  ")
	return mcp.NewToolResultText(string(bytes)), nil
}
