package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/flosch/pongo2/v6"
	"github.com/google/uuid"
	"github.com/user/csm-backend/internal/domain"
)

var (
	// We allow backslash (\) to support literal \n and other escaped characters.
	SecurityRegex = regexp.MustCompile(`(?s)^[\pL0-9_\-\.\ \/\\:\[\]{}"',@#%!+=?;&|\(\)\$\n\r\*]*$`)
)

type WorkflowExecutor struct {
	wfRepo        domain.WorkflowRepository
	groupRepo     domain.WorkflowGroupRepository
	stepRepo      domain.WorkflowStepRepository
	inputRepo     domain.WorkflowInputRepository
	execRepo      domain.WorkflowExecutionRepository
	globalVarRepo domain.GlobalVariableRepository
	datasetRepo   domain.DatasetRepository
	serverService *ServerService
	hub           *Hub
	activeExecs   sync.Map // map[uuid.UUID]context.CancelFunc
	execDoneChans sync.Map // map[uuid.UUID]chan struct{}
	childExecs    sync.Map // map[uuid.UUID]*sync.Map  parent execID -> set of child execIDs (for stopping the whole subtree)
	sessionUploads sync.Map // map[uuid.UUID]*sync.Map // execID -> serverID+sessionID string -> bool
}

func NewWorkflowExecutor(
	wfRepo domain.WorkflowRepository,
	groupRepo domain.WorkflowGroupRepository,
	stepRepo domain.WorkflowStepRepository,
	inputRepo domain.WorkflowInputRepository,
	execRepo domain.WorkflowExecutionRepository,
	serverService *ServerService,
	hub *Hub,
	globalVarRepo domain.GlobalVariableRepository,
	datasetRepo domain.DatasetRepository,
) *WorkflowExecutor {
	// Register custom pongo2 filters
	pongo2.RegisterFilter("json", func(in *pongo2.Value, param *pongo2.Value) (*pongo2.Value, *pongo2.Error) {
		b, err := json.Marshal(in.Interface())
		if err != nil {
			return nil, &pongo2.Error{
				Sender:    "filter:json",
				OrigError: err,
			}
		}
		return pongo2.AsSafeValue(string(b)), nil
	})

	pongo2.RegisterFilter("shellquote", func(in *pongo2.Value, param *pongo2.Value) (*pongo2.Value, *pongo2.Error) {
		s := in.String()
		// Basic POSIX shell quoting: wrap in single quotes, escape single quotes
		quoted := "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
		return pongo2.AsSafeValue(quoted), nil
	})

	pongo2.RegisterFilter("filter_by", func(in *pongo2.Value, param *pongo2.Value) (*pongo2.Value, *pongo2.Error) {
		arr := in.Interface()
		query := param.Interface()

		var list []map[string]interface{}
		if l, ok := arr.([]map[string]interface{}); ok {
			list = l
		} else if l, ok := arr.([]interface{}); ok {
			for _, item := range l {
				if m, ok := item.(map[string]interface{}); ok {
					list = append(list, m)
				}
			}
		} else {
			return pongo2.AsValue(nil), nil
		}

		// Handle Map param: {"key": "value", ...} (legacy/explicit support)
		if q, ok := query.(map[string]interface{}); ok {
			var matches []map[string]interface{}
			for _, item := range list {
				match := true
				for k, v := range q {
					if fmt.Sprintf("%v", item[k]) != fmt.Sprintf("%v", v) {
						match = false
						break
					}
				}
				if match {
					matches = append(matches, item)
				}
			}
			return pongo2.AsValue(matches), nil
		}

		// Handle String param: "key=value" or "key!=value" or "k>=10"
		queryStr := param.String()
		if queryStr == "" {
			return pongo2.AsValue(list), nil
		}

		var matches []map[string]interface{}
		pairs := strings.Split(queryStr, ",")

		for _, item := range list {
			if matchConditions(item, pairs) {
				matches = append(matches, item)
			}
		}

		return pongo2.AsValue(matches), nil
	})

	pongo2.RegisterFilter("pluck", func(in *pongo2.Value, param *pongo2.Value) (*pongo2.Value, *pongo2.Error) {
		arr := in.Interface()
		key := param.String()

		var list []map[string]interface{}
		if l, ok := arr.([]map[string]interface{}); ok {
			list = l
		} else if l, ok := arr.([]interface{}); ok {
			for _, item := range l {
				if m, ok := item.(map[string]interface{}); ok {
					list = append(list, m)
				}
			}
		} else {
			return pongo2.AsValue(nil), nil
		}

		var values []interface{}
		for _, item := range list {
			if v, ok := item[key]; ok {
				values = append(values, v)
			}
		}
		return pongo2.AsValue(values), nil
	})

	pongo2.RegisterFilter("attr", func(in *pongo2.Value, param *pongo2.Value) (*pongo2.Value, *pongo2.Error) {
		obj := in.Interface()
		key := param.String()
		if m, ok := obj.(map[string]interface{}); ok {
			return pongo2.AsValue(m[key]), nil
		}
		return pongo2.AsValue(nil), nil
	})

	pongo2.RegisterFilter("find", func(in *pongo2.Value, param *pongo2.Value) (*pongo2.Value, *pongo2.Error) {
		arr := in.Interface()
		query := param.Interface()

		var list []map[string]interface{}
		if l, ok := arr.([]map[string]interface{}); ok {
			list = l
		} else if l, ok := arr.([]interface{}); ok {
			for _, item := range l {
				if m, ok := item.(map[string]interface{}); ok {
					list = append(list, m)
				}
			}
		} else {
			return pongo2.AsValue(nil), nil
		}

		// Handle Map param: {"key": "value", ...}
		if q, ok := query.(map[string]interface{}); ok {
			for _, item := range list {
				match := true
				for k, v := range q {
					if fmt.Sprintf("%v", item[k]) != fmt.Sprintf("%v", v) {
						match = false
						break
					}
				}
				if match {
					return pongo2.AsValue(item), nil
				}
			}
			return pongo2.AsValue(nil), nil
		}

		// Handle String param: "key=value" or "key!=value"
		queryStr := param.String()
		if queryStr == "" {
			return pongo2.AsValue(nil), nil
		}

		pairs := strings.Split(queryStr, ",")
		for _, item := range list {
			if matchConditions(item, pairs) {
				return pongo2.AsValue(item), nil
			}
		}

		return pongo2.AsValue(nil), nil
	})

	pongo2.RegisterFilter("get", func(in *pongo2.Value, param *pongo2.Value) (*pongo2.Value, *pongo2.Error) {
		if !in.CanSlice() {
			return pongo2.AsValue(nil), nil
		}
		idx := param.Integer()
		if idx < 0 || idx >= in.Len() {
			return pongo2.AsValue(nil), nil
		}
		return in.Index(idx), nil
	})

	return &WorkflowExecutor{
		wfRepo:        wfRepo,
		groupRepo:     groupRepo,
		stepRepo:      stepRepo,
		inputRepo:     inputRepo,
		execRepo:      execRepo,
		globalVarRepo: globalVarRepo,
		datasetRepo:   datasetRepo,
		serverService: serverService,
		hub:           hub,
		execDoneChans: sync.Map{},
	}
}

func (e *WorkflowExecutor) Run(ctx context.Context, workflowID uuid.UUID, execID uuid.UUID, inputs map[string]string, scheduledID *uuid.UUID, pageID *uuid.UUID, triggerSource string, user *domain.User, startGroupID, startStepID, fromExecutionID *uuid.UUID) error {
	// Create a signal channel to notify waiters that this execution is finished
	done := make(chan struct{})
	e.execDoneChans.Store(execID, done)
	defer func() {
		close(done)
		e.execDoneChans.Delete(execID)
	}()

	// Note: the cancellable context + activeExecs registration is handled inside
	// RunWithDepth, so that nested executions (hooks, sub-workflow steps) are also
	// registered and can be stopped as part of the subtree.
	return e.RunWithDepth(ctx, workflowID, execID, inputs, scheduledID, pageID, triggerSource, 0, user, startGroupID, startStepID, fromExecutionID)
}

// GetWaitChan returns a channel that will be closed when the execution finishes.
// If the execution is not currently active, it returns a nil channel.
func (e *WorkflowExecutor) GetWaitChan(execID uuid.UUID) chan struct{} {
	if val, ok := e.execDoneChans.Load(execID); ok {
		return val.(chan struct{})
	}
	return nil
}

// StopExecution cancels the given execution AND every nested execution it spawned
// (BEFORE/AFTER hooks and sub-workflow steps), so a stop request halts the whole
// subtree instead of leaving detached children running.
func (e *WorkflowExecutor) StopExecution(execID uuid.UUID) error {
	found := false

	if cancelVal, ok := e.activeExecs.Load(execID); ok {
		cancelVal.(context.CancelFunc)()
		found = true
	}

	// Recurse into children. Safe from infinite loops: ParentExecutionID forms a
	// tree bounded by the depth cap (<= 4 levels).
	if setVal, ok := e.childExecs.Load(execID); ok {
		setVal.(*sync.Map).Range(func(k, _ interface{}) bool {
			if childID, ok := k.(uuid.UUID); ok {
				_ = e.StopExecution(childID)
				found = true
			}
			return true
		})
		// Subtree is being torn down; drop the set so the map doesn't retain an
		// empty shell. Any child spawned after this point sees the parent ctx as
		// cancelled (see the ctx.Err() guards in the hook / async-step goroutines)
		// and returns without running.
		e.childExecs.Delete(execID)
	}

	if !found {
		return fmt.Errorf("execution %s not found or already finished", execID)
	}
	return nil
}

// registerChild records a parent -> child execution edge so StopExecution can
// reach nested executions that run on a detached (context.Background) context.
func (e *WorkflowExecutor) registerChild(parent, child uuid.UUID) {
	setVal, _ := e.childExecs.LoadOrStore(parent, &sync.Map{})
	setVal.(*sync.Map).Store(child, struct{}{})
}

// unregisterChild removes a finished child from its parent's set.
func (e *WorkflowExecutor) unregisterChild(parent, child uuid.UUID) {
	if setVal, ok := e.childExecs.Load(parent); ok {
		setVal.(*sync.Map).Delete(child)
	}
}

func (e *WorkflowExecutor) RunWithDepth(ctx context.Context, workflowID uuid.UUID, execID uuid.UUID, inputs map[string]string, scheduledID *uuid.UUID, pageID *uuid.UUID, triggerSource string, depth int, user *domain.User, startGroupID, startStepID, fromExecutionID *uuid.UUID) error {
	if depth > 3 {
		return fmt.Errorf("maximum hook depth exceeded (circular dependency?)")
	}

	// Register this execution so it — and its whole subtree — can be stopped.
	// Every execution (top-level, hook, or sub-workflow step) gets its own
	// cancellable context and an entry in activeExecs keyed by execID.
	execCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	e.activeExecs.Store(execID, cancel)
	defer e.activeExecs.Delete(execID)
	// depth > 0 means this is a nested execution spawned by a hook or a
	// WORKFLOW step; record the parent edge so StopExecution can reach it even
	// though such children run on a detached (context.Background) base context.
	// (At depth 0, fromExecutionID is a prior execution for partial-rerun state,
	// not a live parent, so it must not be linked here.)
	if depth > 0 && fromExecutionID != nil {
		parent := *fromExecutionID
		e.registerChild(parent, execID)
		defer e.unregisterChild(parent, execID)
	}
	ctx = execCtx

	var scope *domain.PermissionScope
	if depth == 0 {
		if user == nil {
			scope = &domain.PermissionScope{IsGlobal: true}
		} else {
			s := domain.GetPermissionScope(user, "workflows", "EXECUTE")
			scope = &s
		}
	}

	wf, err := e.wfRepo.GetByID(workflowID, scope)
	if err != nil {
		return err
	}

	// Validate inputs against definitions for security
	if err := e.validateInputs(wf, inputs); err != nil {
		return err
	}

	// Setup log directory
	baseDir, _ := os.Getwd()
	execLogDir := filepath.Join(baseDir, "data", "logs", "executions", execID.String())
	if err := os.MkdirAll(execLogDir, 0755); err != nil {
		return fmt.Errorf("failed to create log directory: %w", err)
	}
	mainLogPath := filepath.Join(execLogDir, "workflow.log")

	// Get existing execution record (created by handler to avoid race condition)
	execution, err := e.execRepo.GetByID(execID, nil)
	if err != nil {
		// Fallback if not found
		inputsJSON, _ := json.Marshal(inputs)
		execution = &domain.WorkflowExecution{
			ID:            execID,
			WorkflowID:    workflowID,
			Status:        domain.StatusRunning,
			Inputs:        string(inputsJSON),
			StartedAt:     time.Now(),
			ScheduledID:   scheduledID,
			PageID:        pageID,
			TriggerSource: triggerSource,
		}
		if user != nil {
			execution.ExecutedBy = &user.ID
			execution.User = user
		} else if execution.User == nil && execution.ExecutedBy != nil {
			// If we have an ID but still no user object (repo fallback/missing preload),
			// and we were passed a user, use it.
			execution.User = user
		}
		if fromExecutionID != nil {
			execution.ParentExecutionID = fromExecutionID
		}
		e.execRepo.Create(execution)
	} else {
		// Even if record exists, update with trigger info if missing
		execution.PageID = pageID
		execution.TriggerSource = triggerSource
		if scheduledID != nil {
			execution.ScheduledID = scheduledID
		}
		if fromExecutionID != nil {
			execution.ParentExecutionID = fromExecutionID
		}
	}

	// Update with log path
	execution.LogPath = mainLogPath
	e.execRepo.Update(execution)

	// Apply Timeout if configured (> 0)
	if wf.TimeoutMinutes > 0 {
		timeoutCtx, cancelTimeout := context.WithTimeout(ctx, time.Duration(wf.TimeoutMinutes)*time.Minute)
		defer cancelTimeout()
		return e.Execute(timeoutCtx, workflowID, execution, depth, startGroupID, startStepID, fromExecutionID)
	}

	return e.Execute(ctx, workflowID, execution, depth, startGroupID, startStepID, fromExecutionID)
}

func (e *WorkflowExecutor) Execute(ctx context.Context, workflowID uuid.UUID, execution *domain.WorkflowExecution, depth int, startGroupID, startStepID, fromExecutionID *uuid.UUID) error {
	var runErr error
	var serverIDs []uuid.UUID
	var transferServerIDs []uuid.UUID
	var cleanupPaths []string
	serverSet := make(map[uuid.UUID]bool)

	wf, err := e.wfRepo.GetByID(workflowID, nil)
	if err != nil {
		return fmt.Errorf("failed to get workflow: %w", err)
	}

	// Create a log stream for this execution
	e.hub.CreateStream(execution.ID.String(), execution.PageID)
	defer e.hub.CloseStream(execution.ID.String())

	logFile, err := os.OpenFile(execution.LogPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("failed to open log file: %w", err)
	}
	defer logFile.Close()

	// Determine who is running the workflow
	executedBy := "System"
	if execution.User != nil {
		if execution.User.FullName != "" {
			executedBy = execution.User.FullName
		} else {
			executedBy = execution.User.Username
		}
	} else if execution.ExecutedBy != nil {
		// Fallback to ID string if user object is still missing despite having an ID
		executedBy = execution.ExecutedBy.String()
	}

	header := fmt.Sprintf("\033[1;36m▶ WORKFLOW: %s\033[0m\n", wf.Name)
	header += fmt.Sprintf("\033[36mUser: %s | Started: %s\033[0m\n", executedBy, execution.StartedAt.Format("2006-01-02 15:04:05"))

	// Log Inputs if available
	if execution.Inputs != "" && execution.Inputs != "{}" {
		var inputs map[string]string
		if err := json.Unmarshal([]byte(execution.Inputs), &inputs); err == nil && len(inputs) > 0 {
			header += "\033[36mInputs:\033[0m\n"
			for k, v := range inputs {
				header += fmt.Sprintf("  \033[90m- %s:\033[0m %s\n", k, v)
			}
		}
	}
	header += "\n"

	// Write to file
	fmt.Fprint(logFile, header)
	logFile.Sync()
	// Broadcast to hub (using workflow ID as target for global view)
	e.hub.BroadcastLog(workflowID.String(), execution.ID.String(), header)

	wf.Status = domain.StatusRunning
	e.wfRepo.UpdateStatus(wf.ID, domain.StatusRunning)
	e.hub.BroadcastStatus(wf.ID.String(), execution.ID.String(), "workflow", string(domain.StatusRunning))

	// Reset groups and steps to PENDING for new execution visualization
	for i := range wf.Groups {
		wf.Groups[i].Status = domain.StatusRunning
		e.groupRepo.UpdateStatus(wf.Groups[i].ID, domain.StatusRunning)
		e.hub.BroadcastStatus(wf.Groups[i].ID.String(), execution.ID.String(), "group", string(domain.StatusRunning))
		for j := range wf.Groups[i].Steps {
			e.hub.BroadcastStatus(wf.Groups[i].Steps[j].ID.String(), execution.ID.String(), "step", string(domain.StatusPending))
		}
	}

	// Get old step working directories for partial reruns
	oldStepDirs := make(map[uuid.UUID]string)
	if fromExecutionID != nil {
		oldExec, err := e.execRepo.GetByID(*fromExecutionID, nil)
		if err == nil {
			for _, step := range oldExec.Steps {
				if step.WorkingDir != "" {
					oldStepDirs[step.StepID] = step.WorkingDir
				}
			}
		}
	}

	// Initialize containers for interpolation
	flowData := make(map[string]interface{})
	var inputsMap map[string]string
	if execution.Inputs != "" {
		json.Unmarshal([]byte(execution.Inputs), &inputsMap)
	}

	// 0. Execute BEFORE hooks
	if err := e.RunHooks(ctx, wf.Hooks, domain.HookTypeBefore, wf.NamespaceID, logFile, depth, execution.User, execution.ID, fromExecutionID, inputsMap, wf.Variables, flowData); err != nil {
		runErr = fmt.Errorf("before hook failed: %w", err)
		e.hub.BroadcastLog(workflowID.String(), execution.ID.String(), fmt.Sprintf("Error: %v", runErr))
		goto finalize
	}

	// 1. Transfer files to servers
	// Per user request: ONLY upload to the primary Workflow Default Server to avoid unintentional "local Mac" targeting
	if wf.DefaultServerID != nil {
		transferServerIDs = []uuid.UUID{*wf.DefaultServerID}
	} else {
		runErr = fmt.Errorf("no target server specified for workflow files")
		goto finalize
	}

	if len(wf.Files) > 0 {
		fmt.Fprintf(logFile, "\033[1;34m📁 FILE OPERATION (%d files)\033[0m\n", len(wf.Files))
		for _, f := range wf.Files {
			targetPath := f.TargetPath
			if wf.TargetFolder != "" {
				targetPath = filepath.Join(wf.TargetFolder, f.FileName)
			}
			cleanupPaths = append(cleanupPaths, targetPath)

			fmt.Fprintf(logFile, "\033[34m→ %s: \033[0m", f.FileName)
			e.hub.BroadcastLog(workflowID.String(), execution.ID.String(), fmt.Sprintf("\033[34m→ Transferring %s\033[0m", f.FileName))

			sourcePath := f.LocalPath
			if f.UseVariableSubstitution {
				fmt.Fprintf(logFile, "\033[90m(Substitutions enabled)\033[0m ")
				// 1. Read file
				content, err := os.ReadFile(f.LocalPath)
				if err != nil {
					runErr = fmt.Errorf("failed to read file for substitution %s: %w", f.FileName, err)
					break
				}

				// 2. Render
				pcontext := e.getInterpolationContext(inputsMap, wf.Variables, flowData, wf.NamespaceID, execution.User, nil, -1, uuid.Nil, execution.ID)
				rendered, err := e.renderTemplate(string(content), pcontext)
				if err != nil {
					runErr = fmt.Errorf("failed to substitute variables in %s: %w", f.FileName, err)
					break
				}

				// 3. Create temp file
				tmpDir := filepath.Join("data", "tmp", "substitutions")
				os.MkdirAll(tmpDir, 0755)
				tmpPath := filepath.Join(tmpDir, f.ID.String()+"_"+f.FileName)
				if err := os.WriteFile(tmpPath, []byte(rendered), 0644); err != nil {
					runErr = fmt.Errorf("failed to write substituted content for %s: %w", f.FileName, err)
					break
				}
				sourcePath = tmpPath
				defer os.Remove(tmpPath)
			}

			err := e.serverService.UploadFileToServers(ctx, transferServerIDs, sourcePath, targetPath, nil)
			if err != nil {
				runErr = fmt.Errorf("failed to transfer file %s: %w", f.FileName, err)
				fmt.Fprintf(logFile, "\033[1;31m✖ FAILED\033[0m\n")
				e.hub.BroadcastLog(workflowID.String(), execution.ID.String(), fmt.Sprintf("\033[1;31m✖ Transfer failed: %s\033[0m", f.FileName))
				break
			} else {
				fmt.Fprintf(logFile, "\033[1;32mDONE\033[0m\n")
			}
		}
		fmt.Fprintf(logFile, "\n")
	}

	// Get all unique servers in this workflow for execution
	if wf.DefaultServerID != nil {
		serverSet[*wf.DefaultServerID] = true
	}
	for _, g := range wf.Groups {
		if g.DefaultServerID != nil {
			serverSet[*g.DefaultServerID] = true
		}
		for _, s := range g.Steps {
			if s.ServerID != uuid.Nil {
				serverSet[s.ServerID] = true
			}
		}
	}

	for id := range serverSet {
		serverIDs = append(serverIDs, id)
	}

	// 2. Execute workflow groups
	if runErr == nil {
		workingDirs := &sync.Map{}

		// Initialize baseline directories to prevent parallel race conditions in the first group
		// Baseline for local server (Nil UUID)
		if homeDir, err := os.UserHomeDir(); err == nil {
			workingDirs.Store(uuid.Nil, homeDir)
		}
		// Baseline for remote servers
		for id := range serverSet {
			// Get initial physical directory (resolving symlinks) on remote server without logging it
			out, err := e.serverService.ExecuteCommand(ctx, id, "pwd -P", nil)
			if err == nil {
				workingDirs.Store(id, filepath.Clean(strings.TrimSpace(out)))
			}
		}

		// Inputs already parsed as inputsMap above
		isSkipping := startGroupID != nil

		for i := range wf.Groups {
			g := wf.Groups[i]

			// Check if we reached the starting group
			if isSkipping && startGroupID != nil && g.ID == *startGroupID {
				isSkipping = false
				msg := fmt.Sprintf("\033[1;33m▶ RERUN STARTING FROM GROUP: %s\033[0m\n", g.Name)
				fmt.Fprint(logFile, msg)
				logFile.Sync()
				e.hub.BroadcastLog(workflowID.String(), execution.ID.String(), msg)
			}

			// Check for cancellation before starting each group
			if err := ctx.Err(); err != nil {
				runErr = err
				goto finalize
			}

			if isSkipping {
				msg := fmt.Sprintf("\033[90m⏭ SKIPPING GROUP (Partial Rerun): %s\033[0m\n", g.Name)
				fmt.Fprint(logFile, msg)
				e.hub.BroadcastLog(workflowID.String(), execution.ID.String(), msg)
				wf.Groups[i].Status = "SKIPPED"
				e.groupRepo.UpdateStatus(wf.Groups[i].ID, "SKIPPED")
				e.hub.BroadcastStatus(wf.Groups[i].ID.String(), execution.ID.String(), "group", "SKIPPED")

				// Simulate directory updates for skipped steps
				for _, step := range g.Steps {
					if dir, ok := oldStepDirs[step.ID]; ok {
						effID := step.ServerID
						if effID == uuid.Nil {
							if g.DefaultServerID != nil {
								effID = *g.DefaultServerID
							} else if wf.DefaultServerID != nil {
								effID = *wf.DefaultServerID
							}
						}
						workingDirs.Store(effID, dir)
					}
				}

				continue
			}

			// Default server ID fallback:
			// 1. Group default server
			// 2. Workflow default server
			var groupDefaultServerID uuid.UUID
			if g.DefaultServerID != nil {
				groupDefaultServerID = *g.DefaultServerID
			} else if wf.DefaultServerID != nil {
				groupDefaultServerID = *wf.DefaultServerID
			}

			var groupStartStepID *uuid.UUID
			if startStepID != nil && !isSkipping && g.ID == *startGroupID {
				groupStartStepID = startStepID
			}

			err := e.runGroup(ctx, &g, inputsMap, wf.Variables, flowData, groupDefaultServerID, logFile, workflowID, execution.ID, wf.NamespaceID, execution.User, workingDirs, groupStartStepID, fromExecutionID, oldStepDirs)
			_, ok := flowData[wf.Groups[i].Key]
			if !ok {
				flowData[wf.Groups[i].Key] = make(map[string]interface{})
			}
			if gm, ok := flowData[wf.Groups[i].Key].(map[string]interface{}); ok {
				gm["status"] = string(wf.Groups[i].Status)
			}
			if err != nil {
				runErr = err
				break
			}
			// Strict Group Boundary: Small gap to let SSH connections and buffers settle,
			// and ensures clear log separation.
			time.Sleep(300 * time.Millisecond)
		}
	}

	if wf.CleanupFiles && len(cleanupPaths) > 0 && len(serverIDs) > 0 {
		fmt.Fprintf(logFile, "\n\033[1;34m🗑 CLEANUP OPERATION\033[0m\n")
		for _, path := range cleanupPaths {
			cmdStr := fmt.Sprintf("rm -f %s", path)
			for _, serverID := range serverIDs {
				_, err := e.serverService.ExecuteCommand(ctx, serverID, cmdStr, nil) // Trusted: pass nil user
				if err != nil {
					fmt.Fprintf(logFile, "\033[1;31m✖ Failed: %s (%v)\033[0m\n", path, err)
				}
			}
			fmt.Fprintf(logFile, "\033[34m✔ Cleaned: %s\033[0m\n", path)
		}
	}

	e.hub.BroadcastStatus(wf.ID.String(), execution.ID.String(), "workflow", string(wf.Status))

finalize:
	finishedAt := time.Now()
	execution.FinishedAt = &finishedAt

	if runErr != nil {
		if ctx.Err() == context.Canceled {
			// Cancelled explicitly by user
			wf.Status = domain.StatusCancelled
			execution.Status = domain.StatusCancelled
			fmt.Fprintf(logFile, "\n\033[1;33m⏹ WORKFLOW CANCELLED: %v\033[0m\n", runErr)
			e.hub.BroadcastLog(wf.ID.String(), execution.ID.String(), "\n\033[1;33m⏹ WORKFLOW CANCELLED\033[0m")
			// We intentionally skip AFTER_FAILED hooks on cancellation as per requirements
		} else if ctx.Err() == context.DeadlineExceeded {
			// Timeout
			wf.Status = domain.StatusFailed
			execution.Status = domain.StatusFailed
			fmt.Fprintf(logFile, "\n\033[1;31m✖ WORKFLOW TIMED OUT (Exceeded %d minutes)\033[0m\n", wf.TimeoutMinutes)
			e.hub.BroadcastLog(wf.ID.String(), execution.ID.String(), fmt.Sprintf("\n\033[1;31m✖ WORKFLOW TIMED OUT (Exceeded %d minutes)\033[0m", wf.TimeoutMinutes))

			// Execute AFTER_FAILED hooks
			e.RunHooks(context.Background(), wf.Hooks, domain.HookTypeAfterFailed, wf.NamespaceID, logFile, depth, execution.User, execution.ID, fromExecutionID, inputsMap, wf.Variables, flowData)
		} else {
			// Actual failure
			wf.Status = domain.StatusFailed
			execution.Status = domain.StatusFailed
			fmt.Fprintf(logFile, "\n\033[1;31m✖ WORKFLOW FAILED: %v\033[0m\n", runErr)
			e.hub.BroadcastLog(wf.ID.String(), execution.ID.String(), fmt.Sprintf("\n\033[1;31m✖ WORKFLOW FAILED: %v\033[0m", runErr))

			// Execute AFTER_FAILED hooks
			e.RunHooks(ctx, wf.Hooks, domain.HookTypeAfterFailed, wf.NamespaceID, logFile, depth, execution.User, execution.ID, fromExecutionID, inputsMap, wf.Variables, flowData)
		}
	} else {
		wf.Status = domain.StatusSuccess
		execution.Status = domain.StatusSuccess
		fmt.Fprintf(logFile, "\n\033[1;32m✔ WORKFLOW SUCCESS\033[0m\n")
		e.hub.BroadcastLog(wf.ID.String(), execution.ID.String(), "\n\033[1;32m✔ WORKFLOW SUCCESS\033[0m")

		// Execute AFTER_SUCCESS hooks
		e.RunHooks(ctx, wf.Hooks, domain.HookTypeAfterSuccess, wf.NamespaceID, logFile, depth, execution.User, execution.ID, fromExecutionID, inputsMap, wf.Variables, flowData)
	}

	// Build the Result envelope from the workflow's declared outputs (opt-in: only
	// when at least one output is declared). Rendered against the final flow-data.
	if len(wf.Outputs) > 0 {
		execution.Result = e.buildWorkflowResult(wf, flowData, execution.Status, inputsMap, execution)
	}

	e.execRepo.Update(execution)
	wf.Status = execution.Status
	e.wfRepo.UpdateStatus(wf.ID, execution.Status)
	e.hub.BroadcastStatus(wf.ID.String(), execution.ID.String(), "workflow", string(execution.Status))

	// Clean up remote uploaded inputs
	if val, ok := e.sessionUploads.Load(execution.ID); ok {
		tracker := val.(*sync.Map)
		tracker.Range(func(key, _ interface{}) bool {
			// key is serverID_sessionID
			parts := strings.Split(key.(string), "_")
			if len(parts) == 2 {
				srvID, _ := uuid.Parse(parts[0])
				sid := parts[1]
				remoteDir := fmt.Sprintf("/tmp/csm_inputs/%s", sid)
				e.serverService.ExecuteCommand(context.Background(), srvID, fmt.Sprintf("rm -rf %s", remoteDir), nil)
			}
			return true
		})
		e.sessionUploads.Delete(execution.ID)
	}

	// Clean up user-uploaded input files
	sessionRegex := regexp.MustCompile(`data/uploads/inputs/([a-z0-9-]+)`)
	cleanedSessions := make(map[string]bool)
	for _, val := range inputsMap {
		matches := sessionRegex.FindAllStringSubmatch(val, -1)
		for _, m := range matches {
			if len(m) > 1 {
				sessionID := m[1]
				if !cleanedSessions[sessionID] {
					sessionDir := filepath.Join("data", "uploads", "inputs", sessionID)
					os.RemoveAll(sessionDir)
					cleanedSessions[sessionID] = true
				}
			}
		}
	}

	return runErr
}

func (e *WorkflowExecutor) RunHooks(ctx context.Context, hooks []domain.WorkflowHook, hookType domain.HookType, namespaceID uuid.UUID, logFile *os.File, depth int, user *domain.User, executionID uuid.UUID, fromExecutionID *uuid.UUID, inputs map[string]string, variables []domain.WorkflowVariable, flowData map[string]interface{}) error {
	for _, hook := range hooks {
		if err := ctx.Err(); err != nil {
			return err
		}
		if hook.HookType != hookType {
			continue
		}

		if logFile != nil {
			fmt.Fprintf(logFile, "\n\033[1;34m↪ TRIGGER HOOK: %s\033[0m\n", hookType)
		}
		if hook.WorkflowID != nil {
			e.hub.BroadcastLog(hook.WorkflowID.String(), executionID.String(), fmt.Sprintf("\033[1;34m↪ Hook: %s (Running in background)\033[0m", hookType))
		}

		var hookInputs map[string]string
		if hook.Inputs != "" {
			json.Unmarshal([]byte(hook.Inputs), &hookInputs)
		}

		// Substitute variables in hook inputs
		pcontext := e.getInterpolationContext(inputs, variables, flowData, namespaceID, user, nil, -1, uuid.Nil, executionID)

		resolvedInputs := make(map[string]string)
		for k, v := range hookInputs {
			rendered, err := e.renderTemplate(v, pcontext)
			if err != nil {
				rendered = v // fallback to raw
			}
			resolvedInputs[k] = rendered
		}

		hookExecID := uuid.New()

		// Run hook asynchronously so it doesn't block the progress of the workflow/schedule
		go func(h domain.WorkflowHook, execID uuid.UUID, resolvedInputs map[string]string) {
			// If the parent execution was already stopped, don't start the hook.
			// Closes the race where a stop lands between spawning this goroutine
			// and the child registering itself in the stop tree.
			if ctx.Err() != nil {
				return
			}
			bgCtx := context.Background()
			err := e.RunWithDepth(bgCtx, h.TargetWorkflowID, execID, resolvedInputs, nil, nil, "HOOK", depth+1, user, nil, nil, &executionID)
			if err != nil {
				errMsg := fmt.Sprintf("\033[1;33m⚠ Warning: %s hook failed (%v)\033[0m", hookType, err)
				if h.WorkflowID != nil {
					e.hub.BroadcastLog(h.WorkflowID.String(), executionID.String(), errMsg)
				}
			} else {
				if h.WorkflowID != nil {
					e.hub.BroadcastLog(h.WorkflowID.String(), executionID.String(), fmt.Sprintf("\033[1;32m✔ %s HOOK SUCCESS\033[0m", hookType))
				}
			}
		}(hook, hookExecID, resolvedInputs)
	}
	return nil
}

func (e *WorkflowExecutor) validateInputs(wf *domain.Workflow, provided map[string]string) error {
	for _, input := range wf.Inputs {
		val, ok := provided[input.Key]
		if !ok {
			val = input.DefaultValue
		}

		if input.Required && strings.TrimSpace(val) == "" {
			return fmt.Errorf("field %s is required", input.Label)
		}

		if val == "" {
			continue // Allow empty if not required and no default
		}

		switch input.Type {
		case "number":
			// Simple numeric check using strconv
			if _, err := strconv.ParseFloat(val, 64); err != nil {
				return fmt.Errorf("field %s must be a number", input.Label)
			}
		case "select":
			// Value must be one of the comma-separated options in DefaultValue
			options := strings.Split(input.DefaultValue, ",")
			valid := false
			for _, opt := range options {
				if strings.TrimSpace(opt) == val {
					valid = true
					break
				}
			}
			if !valid {
				return fmt.Errorf("field %s has invalid option: %s", input.Label, val)
			}
		case "multi-select":
			// Try JSON first, fallback to comma separated
			var selected []string
			decoder := json.NewDecoder(strings.NewReader(val))
			decoder.UseNumber()
			if err := decoder.Decode(&selected); err != nil {
				// Fallback
				parts := strings.Split(val, ",")
				for _, p := range parts {
					selected = append(selected, strings.TrimSpace(p))
				}
			}

			options := strings.Split(input.DefaultValue, ",")
			trimmedOptions := make([]string, 0, len(options))
			for _, opt := range options {
				trimmedOptions = append(trimmedOptions, strings.TrimSpace(opt))
			}

			for _, s := range selected {
				if s == "" {
					continue
				}
				valid := false
				for _, opt := range trimmedOptions {
					if opt == s {
						valid = true
						break
					}
				}
				if !valid {
					return fmt.Errorf("field %s has invalid option: %s", input.Label, s)
				}
			}
		case "multi-input":
			var rows []map[string]interface{}
			decoder := json.NewDecoder(strings.NewReader(val))
			decoder.UseNumber()
			if err := decoder.Decode(&rows); err != nil {
				// Fallback for simple comma-separated (non-multi-key)
				values := strings.Split(val, ",")
				for _, v := range values {
					v = strings.TrimSpace(v)
					if v == "" {
						continue
					}
					if !SecurityRegex.MatchString(v) {
						return fmt.Errorf("field %s contains invalid characters in value '%s'", input.Label, v)
					}
				}
			} else {
				// A row field declared as date/time is format-checked like a top-level
				// date/time input; every other field keeps the character check.
				dateTimeFields := multiInputDateTimeFields(input.DefaultValue)
				for _, row := range rows {
					for k, v := range row {
						strV := fmt.Sprintf("%v", v)
						if strV == "" {
							continue
						}
						if cfg, ok := dateTimeFields[k]; ok {
							if _, err := ParseInputDateTime(cfg.Type, cfg.IncludeTime, strV); err != nil {
								return fmt.Errorf("field %s: '%s' must be %s (got: %s)", input.Label, k, InputDateTimeFormatHint(cfg.Type, cfg.IncludeTime), strV)
							}
							continue
						}
						if !SecurityRegex.MatchString(strV) {
							return fmt.Errorf("field %s contains invalid characters in field '%s': '%s'", input.Label, k, strV)
						}
					}
				}
			}
		case "date", "time":
			// Values come from a native picker or are typed by hand, so the format is
			// checked here. An input's own value is never re-rendered as a template
			// (a parent workflow resolves the values it maps before the child runs —
			// see runWorkflowStep/triggerHooks), so a literal format is the only thing
			// that can reach a command: reject anything else instead of passing it on.
			if _, err := ParseInputDateTime(input.Type, input.IncludeTime, val); err != nil {
				return fmt.Errorf("field %s must be %s (got: %s)", input.Label, InputDateTimeFormatHint(input.Type, input.IncludeTime), val)
			}
		case "file":
			continue // the backend generated path is inherently safe (absolute path)
		default: // "input"
			if !SecurityRegex.MatchString(val) {
				return fmt.Errorf("field %s contains invalid characters", input.Label)
			}
		}
	}
	return nil
}

// Layouts accepted for a date/time input value. The native pickers emit the first
// layout of each set; the extra ones cover values typed by hand (seconds, or a space
// instead of the ISO "T" separator).
var (
	inputDateLayouts     = []string{"2006-01-02"}
	inputDateTimeLayouts = []string{"2006-01-02T15:04", "2006-01-02T15:04:05", "2006-01-02 15:04", "2006-01-02 15:04:05"}
	inputTimeLayouts     = []string{"15:04", "15:04:05"}
)

func inputDateTimeLayoutsFor(inputType string, includeTime bool) []string {
	if inputType == "time" {
		return inputTimeLayouts
	}
	if includeTime {
		return inputDateTimeLayouts
	}
	return inputDateLayouts
}

// ParseInputDateTime validates a date/time input value against the layouts allowed for
// its type, and returns the parsed value.
func ParseInputDateTime(inputType string, includeTime bool, val string) (time.Time, error) {
	trimmed := strings.TrimSpace(val)
	var lastErr error
	for _, layout := range inputDateTimeLayoutsFor(inputType, includeTime) {
		t, err := time.Parse(layout, trimmed)
		if err != nil {
			lastErr = err
			continue
		}
		// time.Parse accepts a non-padded number where the layout has a padded one
		// ("7:30" for "15:04"), which the frontend rejects. Round-trip the parsed value
		// so both sides agree on one exact format.
		if t.Format(layout) != trimmed {
			lastErr = fmt.Errorf("value %q does not match layout %q", trimmed, layout)
			continue
		}
		return t, nil
	}
	return time.Time{}, lastErr
}

// MultiInputFieldConfig is one row-field definition of a multi-input, stored as JSON in
// the input's DefaultValue by the workflow designer.
type MultiInputFieldConfig struct {
	Key         string `json:"key"`
	Type        string `json:"type"`
	IncludeTime bool   `json:"include_time"`
}

// multiInputDateTimeFields returns the date/time row fields of a multi-input, keyed by
// field key. A DefaultValue that is not the JSON field list (legacy comma-separated
// keys) has no typed fields, so it yields an empty map.
func multiInputDateTimeFields(defaultValue string) map[string]MultiInputFieldConfig {
	result := map[string]MultiInputFieldConfig{}
	var fields []MultiInputFieldConfig
	if err := json.Unmarshal([]byte(defaultValue), &fields); err != nil {
		return result
	}
	for _, f := range fields {
		if f.Key == "" {
			continue
		}
		if f.Type == "date" || f.Type == "time" {
			result[f.Key] = f
		}
	}
	return result
}

// InputDateTimeFormatHint is the human/AI readable format of a date/time input.
func InputDateTimeFormatHint(inputType string, includeTime bool) string {
	switch {
	case inputType == "time":
		return "HH:MM"
	case includeTime:
		return "YYYY-MM-DDTHH:MM"
	default:
		return "YYYY-MM-DD"
	}
}

func (e *WorkflowExecutor) evaluateCondition(condition string, inputs map[string]string, variables []domain.WorkflowVariable, flowData map[string]interface{}, namespaceID uuid.UUID, user *domain.User, execID uuid.UUID) (bool, error) {
	if strings.TrimSpace(condition) == "" {
		return true, nil // Empty condition = always run
	}

	pcontext := e.getInterpolationContext(inputs, variables, flowData, namespaceID, user, nil, -1, uuid.Nil, execID)

	// Wrap the condition in an if block to evaluate it as a boolean expression
	// We use a unique marker to detect if the block was executed and the result
	tmpl := fmt.Sprintf("{%% if %s %%}TRUE{%% else %%}FALSE{%% endif %%}", condition)

	rendered, err := e.renderTemplate(tmpl, pcontext)
	if err != nil {
		return false, fmt.Errorf("failed to evaluate condition logic: %w", err)
	}

	return strings.TrimSpace(rendered) == "TRUE", nil
}

func (e *WorkflowExecutor) runGroup(ctx context.Context, group *domain.WorkflowGroup, inputs map[string]string, variables []domain.WorkflowVariable, flowData map[string]interface{}, defaultServerID uuid.UUID, logFile *os.File, workflowID uuid.UUID, executionID uuid.UUID, namespaceID uuid.UUID, user *domain.User, workingDirs *sync.Map, startStepID, fromExecutionID *uuid.UUID, oldStepDirs map[uuid.UUID]string) error {
	// Build terminal execution config from group settings
	execCfg := GroupExecConfig{UseTTY: group.UseTTY}
	if group.AutoInputs != "" {
		var rules []AutoInputRule
		if err := json.Unmarshal([]byte(group.AutoInputs), &rules); err == nil {
			execCfg.AutoInputs = rules
		}
	}
	// Directly check if group should be skipped
	if group.Skip {
		msg := fmt.Sprintf("\n\033[1;33m⏭ GROUP SKIPPED: %s\033[0m \033[90m(Manually skipped)\033[0m\n", group.Name)
		fmt.Fprint(logFile, msg)
		e.hub.BroadcastLog(workflowID.String(), executionID.String(), msg)
		group.Status = "SKIPPED"
		e.groupRepo.UpdateStatus(group.ID, "SKIPPED")
		e.hub.BroadcastStatus(group.ID.String(), executionID.String(), "group", "SKIPPED")
		return nil
	}

	// Evaluate condition before running
	if shouldRun, err := e.evaluateCondition(group.Condition, inputs, variables, flowData, namespaceID, user, executionID); err != nil {
		errStr := fmt.Sprintf("\n\033[1;31m✖ GROUP CONDITION ERROR: %s\033[0m\n\033[31mCondition: %s\nError: %v\033[0m\n", group.Name, group.Condition, err)
		fmt.Fprint(logFile, errStr)
		e.hub.BroadcastLog(workflowID.String(), executionID.String(), errStr)
		return fmt.Errorf("group %q condition error: %w", group.Name, err)
	} else if !shouldRun {
		msg := fmt.Sprintf("\n\033[1;33m⏭ GROUP SKIPPED: %s\033[0m \033[90m(Condition returned false)\033[0m\n", group.Name)
		fmt.Fprint(logFile, msg)
		e.hub.BroadcastLog(workflowID.String(), executionID.String(), msg)
		group.Status = "SKIPPED"
		e.groupRepo.UpdateStatus(group.ID, "SKIPPED")
		e.hub.BroadcastStatus(group.ID.String(), executionID.String(), "group", "SKIPPED")
		return nil
	}

	groupHeader := fmt.Sprintf("\n\n\033[1;35m❖ GROUP START: %s\033[0m \033[90m[Parallel: %v]\033[0m\n", group.Name, group.IsParallel)
	fmt.Fprint(logFile, groupHeader)
	logFile.Sync()
	e.hub.BroadcastLog(group.WorkflowID.String(), executionID.String(), groupHeader)

	effectiveServerID := defaultServerID
	if group.DefaultServerID != nil {
		effectiveServerID = *group.DefaultServerID
	}

	maxAttempts := 1
	if group.RetryEnabled && group.RetryLimit > 0 {
		maxAttempts = group.RetryLimit + 1
	}

	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		// Check for cancellation before each attempt
		if err := ctx.Err(); err != nil {
			return err
		}

		if attempt > 1 {
			msg := fmt.Sprintf("\n\033[1;33m↻ GROUP RETRY ATTEMPT %d/%d (Delay: %ds): %s\033[0m\n", attempt-1, group.RetryLimit, group.RetryDelay, group.Name)
			fmt.Fprint(logFile, msg)
			e.hub.BroadcastLog(group.WorkflowID.String(), executionID.String(), msg)

			if group.RetryDelay > 0 {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(time.Duration(group.RetryDelay) * time.Second):
				}
			}

		// Reset step statuses for visual clarity in UI
			for i := range group.Steps {
				e.hub.BroadcastStatus(group.Steps[i].ID.String(), executionID.String(), "step", string(domain.StatusPending))
			}
		}

		group.Status = domain.StatusRunning
		e.groupRepo.UpdateStatus(group.ID, domain.StatusRunning)
		e.hub.BroadcastStatus(group.ID.String(), executionID.String(), "group", string(domain.StatusRunning))

		group.Status = domain.StatusRunning
		e.groupRepo.UpdateStatus(group.ID, domain.StatusRunning)
		e.hub.BroadcastStatus(group.ID.String(), executionID.String(), "group", string(domain.StatusRunning))

		// Evaluate loop items
		items := []interface{}{nil}
		isLoop := false
		if group.LoopEnabled && group.For != "" {
			pcontext := e.getInterpolationContext(inputs, variables, flowData, namespaceID, user, nil, -1, uuid.Nil, executionID)

			renderSource := group.For
			if strings.HasPrefix(strings.TrimSpace(renderSource), "{{") && strings.HasSuffix(strings.TrimSpace(renderSource), "}}") && !strings.Contains(renderSource, "|json") {
				inner := strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(renderSource), "{{"), "}}")
				renderSource = fmt.Sprintf("{{ %s | json }}", strings.TrimSpace(inner))
			}

			sourceJson, _ := e.renderTemplate(renderSource, pcontext)

			var list []interface{}
			if err := json.Unmarshal([]byte(sourceJson), &list); err == nil {
				items = list
			} else {
				if strings.Contains(sourceJson, ",") {
					parts := strings.Split(sourceJson, ",")
					list = make([]interface{}, len(parts))
					for i, p := range parts {
						list[i] = strings.TrimSpace(p)
					}
					items = list
				} else if strings.TrimSpace(sourceJson) != "" {
					items = []interface{}{strings.TrimSpace(sourceJson)}
				} else {
					items = []interface{}{} // Empty array case
				}
			}
			isLoop = true

			loopMsg := fmt.Sprintf("\033[90m⚙ Group Loop: iterating over %d items\033[0m\n", len(items))
			fmt.Fprint(logFile, loopMsg)
			e.hub.BroadcastLog(workflowID.String(), executionID.String(), loopMsg)
		}

		if isLoop {
			for i, item := range items {
				lastErr = e.runGroupAttempt(ctx, group, execCfg, inputs, variables, flowData, effectiveServerID, logFile, workflowID, executionID, namespaceID, user, workingDirs, startStepID, fromExecutionID, oldStepDirs, item, i, true, false)
				if lastErr != nil {
					break
				}
			}
			if lastErr == nil {
				// Run post-ops once after successful loop
				lastErr = e.runGroupAttempt(ctx, group, execCfg, inputs, variables, flowData, effectiveServerID, logFile, workflowID, executionID, namespaceID, user, workingDirs, nil, fromExecutionID, nil, nil, -1, false, true)
			}
		} else {
			lastErr = e.runGroupAttempt(ctx, group, execCfg, inputs, variables, flowData, effectiveServerID, logFile, workflowID, executionID, namespaceID, user, workingDirs, startStepID, fromExecutionID, oldStepDirs, nil, -1, true, true)
		}

		if lastErr == nil {
			group.Status = domain.StatusSuccess
			e.hub.BroadcastStatus(group.ID.String(), executionID.String(), "group", string(domain.StatusSuccess))
			return e.groupRepo.UpdateStatus(group.ID, domain.StatusSuccess)
		}

		// Handle cancellation immediately
		if ctx.Err() != nil {
			group.Status = domain.StatusCancelled
			e.groupRepo.UpdateStatus(group.ID, domain.StatusCancelled)
			e.hub.BroadcastStatus(group.ID.String(), executionID.String(), "group", string(domain.StatusCancelled))
			msg := fmt.Sprintf("\n\033[1;33m⏹ GROUP CANCELLED: %s\033[0m\n", group.Name)
			fmt.Fprint(logFile, msg)
			e.hub.BroadcastLog(workflowID.String(), executionID.String(), msg)
			return lastErr
		}

		if attempt < maxAttempts {
			continue
		}

		// Final failure after all retries
		group.Status = domain.StatusFailed
		e.groupRepo.UpdateStatus(group.ID, domain.StatusFailed)
		e.hub.BroadcastStatus(group.ID.String(), executionID.String(), "group", string(domain.StatusFailed))

		if group.ContinueOnFailure {
			msg := fmt.Sprintf("\n\033[1;33m⚠ GROUP FAILED AFTER %d ATTEMPTS BUT CONTINUING:\033[0m %s (Continue on Failure enabled)\n", attempt, group.Name)
			fmt.Fprint(logFile, msg)
			e.hub.BroadcastLog(workflowID.String(), executionID.String(), msg)
			return nil
		}
		return fmt.Errorf("group %q failed after %d attempts: %w", group.Name, attempt, lastErr)
	}

	return nil
}

func (e *WorkflowExecutor) runGroupAttempt(ctx context.Context, group *domain.WorkflowGroup, execCfg GroupExecConfig, inputs map[string]string, variables []domain.WorkflowVariable, flowData map[string]interface{}, effectiveServerID uuid.UUID, logFile *os.File, workflowID uuid.UUID, executionID uuid.UUID, namespaceID uuid.UUID, user *domain.User, workingDirs *sync.Map, startStepID, fromExecutionID *uuid.UUID, oldStepDirs map[uuid.UUID]string, item interface{}, index int, runSteps, runPostOps bool) error {
	if runSteps {
	if group.IsParallel {
		// Parralel groups don't support partial reruns from steps as easily, usually it's better to rerun the whole group
		// For simplicity, if a startStepID is provided in a parallel group, we just run all steps (or we could filter, but let's stick to simple logic)
		var wg sync.WaitGroup
		errs := make(chan error, len(group.Steps))

		for i := range group.Steps {
			wg.Add(1)
			go func(step *domain.WorkflowStep) {
				defer wg.Done()
				if err := e.runStep(ctx, step, execCfg, inputs, variables, flowData, effectiveServerID, logFile, workflowID, executionID, namespaceID, user, workingDirs, fromExecutionID, group.ID, group.Name, group.Key, item, index); err != nil {
					errs <- err
				}
			}(&group.Steps[i])
		}

		wg.Wait()
		close(errs)

		for err := range errs {
			if err != nil {
				return err
			}
		}
	} else {
		isSkippingStep := startStepID != nil
		for i := range group.Steps {
			step := &group.Steps[i]

			// Check if we reached the starting step
			if isSkippingStep && startStepID != nil && step.ID == *startStepID {
				isSkippingStep = false
				msg := fmt.Sprintf("\033[1;33m▶ RERUN STARTING FROM STEP: %s\033[0m\n", step.Name)
				fmt.Fprint(logFile, msg)
				e.hub.BroadcastLog(workflowID.String(), executionID.String(), msg)
			}

			// Check for cancellation before each step
			if err := ctx.Err(); err != nil {
				return err
			}

			if isSkippingStep {
				msg := fmt.Sprintf("\033[90m⏭ SKIPPING STEP (Partial Rerun): %s\033[0m\n", step.Name)
				fmt.Fprint(logFile, msg)
				e.hub.BroadcastLog(workflowID.String(), executionID.String(), msg)
				e.hub.BroadcastStatus(step.ID.String(), executionID.String(), "step", "SKIPPED")

				// Update working directory state from skipped step
				if dir, ok := oldStepDirs[step.ID]; ok {
					targetServerID := step.ServerID
					if targetServerID == uuid.Nil {
						targetServerID = effectiveServerID
					}
					workingDirs.Store(targetServerID, dir)
				}

				continue
			}

			if err := e.runStep(ctx, step, execCfg, inputs, variables, flowData, effectiveServerID, logFile, workflowID, executionID, namespaceID, user, workingDirs, fromExecutionID, group.ID, group.Name, group.Key, item, index); err != nil {
				return err
			}
			// Sequential Step Delay: 200ms gap between steps to prevent race conditions
			if i < len(group.Steps)-1 {
				time.Sleep(200 * time.Millisecond)
			}
		}
	}
	}

	if !runPostOps {
		return nil
	}

	// Perform relay copy if configured
	if group.IsCopyEnabled {
		msg := fmt.Sprintf("\033[90m⚙ Relay copy enabled for group %q\033[0m\n", group.Name)
		fmt.Fprint(logFile, msg)
		e.hub.BroadcastLog(workflowID.String(), executionID.String(), msg)

		if group.CopySourcePath != "" && group.CopyTargetPath != "" {
			if err := e.relayCopy(ctx, group, inputs, variables, flowData, namespaceID, effectiveServerID, logFile, workflowID, executionID, user); err != nil {
				return fmt.Errorf("relay copy failed: %w", err)
			}
		} else {
			msg := "\033[90m⚙ Relay copy skipped: missing paths\033[0m\n"
			fmt.Fprint(logFile, msg)
			e.hub.BroadcastLog(workflowID.String(), executionID.String(), msg)
		}
	} else {
		msg := fmt.Sprintf("\033[90m⚙ Relay copy disabled for group %q\033[0m\n", group.Name)
		fmt.Fprint(logFile, msg)
		e.hub.BroadcastLog(workflowID.String(), executionID.String(), msg)
	}

	return nil
}

func (e *WorkflowExecutor) relayCopy(ctx context.Context, group *domain.WorkflowGroup, inputs map[string]string, variables []domain.WorkflowVariable, flowData map[string]interface{}, namespaceID uuid.UUID, sourceServerID uuid.UUID, logFile *os.File, workflowID uuid.UUID, executionID uuid.UUID, user *domain.User) error {
	sourcePath := filepath.Clean(group.CopySourcePath)
	targetPath := filepath.Clean(group.CopyTargetPath)

	// Perform variable substitution
	substitute := func(val string) (string, error) {
		pcontext := e.getInterpolationContext(inputs, variables, flowData, namespaceID, user, nil, -1, sourceServerID, executionID)
		return e.renderTemplate(val, pcontext)
	}

	var err error
	sourcePath, err = substitute(sourcePath)
	if err != nil {
		return err
	}
	targetPath, err = substitute(targetPath)
	if err != nil {
		return err
	}

	msgRef := fmt.Sprintf("\033[1;34m📦 RELAY COPY: %s -> Server(%s):%s\033[0m\n", sourcePath, group.CopyTargetServerID, targetPath)
	fmt.Fprint(logFile, msgRef)
	e.hub.BroadcastLog(workflowID.String(), executionID.String(), msgRef)
	fmt.Fprintf(logFile, "\033[34mStarting relay copy...\033[0m\n")
	e.hub.BroadcastLog(workflowID.String(), executionID.String(), "\033[34mStarting relay copy...\033[0m\n")

	// 1. Create tarball on source server
	tmpTarName := fmt.Sprintf("relay_%s.tar.gz", uuid.New().String())
	sourceDir := filepath.Dir(sourcePath)
	sourceBase := filepath.Base(sourcePath)

	// Use tar -czf to create a compressed archive. Use -C to change directory so the path in tar is relative.
	tarCmd := fmt.Sprintf("tar -czf /tmp/%s -C %s %s", tmpTarName, strconv.Quote(sourceDir), strconv.Quote(sourceBase))
	_, err = e.serverService.ExecuteCommand(ctx, sourceServerID, tarCmd, nil) // Trusted: pass nil user
	if err != nil {
		return fmt.Errorf("failed to create tarball on source: %w", err)
	}
	defer e.serverService.ExecuteCommand(context.Background(), sourceServerID, fmt.Sprintf("rm -f /tmp/%s", tmpTarName), nil) // Trusted: pass nil user

	// 2. Download tarball to backend
	localTmpDir := filepath.Join("data", "tmp", "relay")
	if err := os.MkdirAll(localTmpDir, 0755); err != nil {
		return fmt.Errorf("failed to create local relay directory: %w", err)
	}
	localTarPath := filepath.Join(localTmpDir, tmpTarName)
	err = e.serverService.DownloadFileFromServer(ctx, sourceServerID, "/tmp/"+tmpTarName, localTarPath, nil) // Trusted: pass nil user
	if err != nil {
		return fmt.Errorf("failed to download tarball to backend: %w", err)
	}
	defer os.Remove(localTarPath)

	// 3. Upload tarball to target server
	err = e.serverService.UploadFileToServers(ctx, []uuid.UUID{*group.CopyTargetServerID}, localTarPath, "/tmp/"+tmpTarName, nil) // Trusted: pass nil user
	if err != nil {
		return fmt.Errorf("failed to upload tarball to target: %w", err)
	}
	defer e.serverService.ExecuteCommand(context.Background(), *group.CopyTargetServerID, fmt.Sprintf("rm -f /tmp/%s", tmpTarName), nil) // Trusted: pass nil user

	// 4. Extract tarball on target server
	mkdirCmd := fmt.Sprintf("mkdir -p %s", strconv.Quote(targetPath))
	e.serverService.ExecuteCommand(ctx, *group.CopyTargetServerID, mkdirCmd, nil) // Trusted: pass nil user

	extractCmd := fmt.Sprintf("tar -xzf /tmp/%s -C %s", tmpTarName, strconv.Quote(targetPath))
	_, err = e.serverService.ExecuteCommand(ctx, *group.CopyTargetServerID, extractCmd, nil) // Trusted: pass nil user
	if err != nil {
		return fmt.Errorf("failed to extract tarball on target: %w", err)
	}

	successMsg := "\033[1;32m✔ RELAY COPY SUCCESS\033[0m\n"
	fmt.Fprint(logFile, successMsg)
	e.hub.BroadcastLog(workflowID.String(), executionID.String(), successMsg)
	return nil
}

func (e *WorkflowExecutor) runStep(ctx context.Context, step *domain.WorkflowStep, execCfg GroupExecConfig, inputs map[string]string, variables []domain.WorkflowVariable, flowData map[string]interface{}, defaultServerID uuid.UUID, mainLogFile *os.File, workflowID uuid.UUID, executionID uuid.UUID, namespaceID uuid.UUID, user *domain.User, workingDirs *sync.Map, fromExecutionID *uuid.UUID, groupID uuid.UUID, groupName string, groupKey string, item interface{}, index int) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	e.hub.BroadcastStatus(step.ID.String(), executionID.String(), "step", string(domain.StatusRunning))

	// Create execution step record
	stepExec := &domain.WorkflowExecutionStep{
		ID:          uuid.New(),
		ExecutionID: executionID,
		StepID:      step.ID,
		GroupID:     groupID,
		GroupName:   groupName,
		Name:        step.Name,
		Status:      domain.StatusRunning,
		StartedAt:   time.Now(),
	}
	e.execRepo.CreateStepResult(stepExec)

	// Create step-specific log file
	baseDir, _ := os.Getwd()
	stepLogPath := filepath.Join(baseDir, "data", "logs", "executions", executionID.String(), step.ID.String()+".log")
	stepLogFile, _ := os.OpenFile(stepLogPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	defer stepLogFile.Close()

	msg := fmt.Sprintf("\033[1;36m>> STEP: %s\033[0m\n", step.Name)
	fmt.Fprint(mainLogFile, msg)
	fmt.Fprint(stepLogFile, msg)

	// Broadcast to the master log buffer ONLY, to prevent duplicating entries under the same execution ID
	e.hub.BroadcastLog(workflowID.String(), executionID.String(), msg)

	var output string
	var err error

	// Dispatch based on action type
	if step.ActionType == "WORKFLOW" {
		output, err = e.runWorkflowStep(ctx, step, inputs, variables, flowData, namespaceID, mainLogFile, stepLogFile, workflowID, executionID, user, fromExecutionID, item, index)
	} else if step.ActionType == "DATASET" {
		output, err = e.runDatasetStep(step, inputs, variables, flowData, namespaceID, user, item, index, mainLogFile, stepLogFile, workflowID, executionID)
		if err != nil {
			errMsg := fmt.Sprintf("\033[1;31m✖ Dataset step error: %v\033[0m\n", err)
			fmt.Fprint(mainLogFile, errMsg)
			fmt.Fprint(stepLogFile, errMsg)
		}
	} else if step.ActionType == "CONVERT" {
		output, err = e.runConvertStep(step, inputs, variables, flowData, namespaceID, user, item, index, mainLogFile, stepLogFile, workflowID, executionID)
		if err != nil {
			errMsg := fmt.Sprintf("\033[1;31m✖ Convert step error: %v\033[0m\n", err)
			fmt.Fprint(mainLogFile, errMsg)
			fmt.Fprint(stepLogFile, errMsg)
		}
	} else {
		targetServerID := step.ServerID
		if targetServerID == uuid.Nil {
			targetServerID = defaultServerID
		}

		// Check if target server is actually remote
		isRemote := false
		if targetServerID != uuid.Nil {
			srv, _ := e.serverService.GetServer(targetServerID, nil)
			if srv != nil && srv.ConnectionType == domain.ConnectionTypeSSH {
				isRemote = true
			}
		}

		// Auto-upload session files if target is remote
		if isRemote {
			if err := e.uploadSessionFilesIfNeeded(ctx, executionID, targetServerID, inputs, variables, item, mainLogFile, stepLogFile, user); err != nil {
				fmt.Fprintf(mainLogFile, "\033[1;31m✖ Failed to upload input files: %v\033[0m\n", err)
				return err
			}
		}

		// Use uuid.Nil for local interpolation to keep original paths
		interpServerID := uuid.Nil
		if isRemote {
			interpServerID = targetServerID
		}

		if step.ActionType == "HTTP" {
			pcontext := e.getInterpolationContext(inputs, variables, flowData, namespaceID, user, item, index, interpServerID, executionID)

			url, _ := e.renderTemplate(step.HttpUrl, pcontext)
			method, _ := e.renderTemplate(step.HttpMethod, pcontext)
			body, _ := e.renderTemplate(step.HttpBody, pcontext)
			headersStr, _ := e.renderTemplate(step.HttpHeaders, pcontext)

			var headers map[string]string
			if headersStr != "" {
				json.Unmarshal([]byte(headersStr), &headers)
			}

			targetServerID := step.ServerID
			if targetServerID == uuid.Nil {
				targetServerID = defaultServerID
			}

			httpMsg := fmt.Sprintf("\033[90m$ %s %s\033[0m\n", method, url)
			fmt.Fprint(mainLogFile, httpMsg)
			fmt.Fprint(stepLogFile, httpMsg)
			e.hub.BroadcastLog(workflowID.String(), executionID.String(), httpMsg)

			output, err = e.serverService.ExecuteHttp(ctx, targetServerID, method, url, body, headersStr, nil, stepLogFile)
			if err == nil {
				fmt.Fprint(mainLogFile, output)
				e.hub.BroadcastLog(workflowID.String(), executionID.String(), output)
			}
			step.CommandText = "" // Command was already executed via ExecuteHttp
			if err != nil {
				return err
			}
		}

		// 1. COMMAND action type - only execute if it's actually a COMMAND step
		// Treat empty as COMMAND for backward compatibility
		if step.ActionType == "COMMAND" || step.ActionType == "" {
			if step.CommandText == "" {
				emptyMsg := "\033[90m(No command to execute)\033[0m\n"
				fmt.Fprint(mainLogFile, emptyMsg)
				fmt.Fprint(stepLogFile, emptyMsg)
				e.hub.BroadcastStatus(step.ID.String(), executionID.String(), "step", string(domain.StatusSuccess))
				return nil
			}

			// 1. Resolve variables using Pongo2
			pcontext := e.getInterpolationContext(inputs, variables, flowData, namespaceID, user, item, index, interpServerID, executionID)

			command, renderErr := e.renderTemplate(step.CommandText, pcontext)
			if renderErr != nil {
				errMsg := fmt.Sprintf("\033[1;31m✖ Interpolation error: %v\033[0m\n", renderErr)
				fmt.Fprint(mainLogFile, errMsg)
				fmt.Fprint(stepLogFile, errMsg)
				return fmt.Errorf("interpolation error: %w", renderErr)
			}

			// Command echo intentionally suppressed: only the command's output is
			// logged, not the rendered command source.

			// Resolve AutoInputs variables for this step iteration
			if len(execCfg.AutoInputs) > 0 {
				var resolvedAutoInputs []AutoInputRule
				for _, r := range execCfg.AutoInputs {
					rp, _ := e.renderTemplate(r.Pattern, pcontext)
					ri, _ := e.renderTemplate(r.Input, pcontext)
					resolvedAutoInputs = append(resolvedAutoInputs, AutoInputRule{
						Pattern: rp,
						Input:   ri,
						IsRegex: r.IsRegex,
					})
				}
				execCfg.AutoInputs = resolvedAutoInputs
			}

			targetServerID := step.ServerID
			if targetServerID == uuid.Nil {
				targetServerID = defaultServerID
			}

			// Persist CWD: Prepend directory restoration and append directory capture
			cwdMarker := "::CWD::"
			var startingDir string // Track where this step started
			if targetServerID != uuid.Nil {
				if val, ok := workingDirs.Load(targetServerID); ok {
					startingDir = val.(string)
					if startingDir != "" {
						command = fmt.Sprintf("cd %s && { %s; }", strconv.Quote(startingDir), strings.TrimSpace(command))
					}
				}
				command = fmt.Sprintf("%s; printf '%s' && pwd -P", strings.TrimSpace(command), cwdMarker)
			}

			if targetServerID != uuid.Nil {
				var out bytes.Buffer
				outWriter := io.Writer(&out) // capture output without broadcasting
				mw := io.MultiWriter(
					&wsWriter{hub: e.hub, targetID: workflowID.String(), executionID: executionID.String(), buffer: mainLogFile},
					&wsWriter{hub: e.hub, targetID: step.ID.String(), executionID: executionID.String(), buffer: nil}, // Broadcast to step trace
					&fileWriter{file: stepLogFile},
					outWriter,
				)
				filter := &cwdFilteredWriter{
					underlying: mw,
					marker:     cwdMarker,
				}

				if execCfg.UseTTY {
					// TTY mode: stdinCh ← auto-input watcher (dispatch writer theo dõi output)
					stdinCh, dispatchWriter := makeAutoInputCh(ctx, execCfg.AutoInputs)
					if dispatchWriter != nil && dispatchWriter != io.Discard {
						// Thêm dispatchWriter vào pipeline: output đi qua cả filter và dispatcher
						filter.underlying = io.MultiWriter(mw, dispatchWriter)
					}
					_, err = e.serverService.ExecuteCommandWithTTY(ctx, targetServerID, command, stdinCh, nil, filter)
				} else {
					_, err = e.serverService.ExecuteCommand(ctx, targetServerID, command, nil, filter)
				}
				filter.Finalize()
				output = out.String()
				if filter.found {
					newDir := filepath.Clean(strings.TrimSpace(filter.cwdBuffer.String()))
					if newDir != "" {
						workingDirs.Store(targetServerID, newDir)
						stepExec.WorkingDir = newDir // Persist for reruns
					}
				}
			} else {
				var localNewDir string
				output, localNewDir, err = e.runLocalStep(ctx, step, execCfg, command, mainLogFile, stepLogFile, workflowID, executionID, workingDirs)
				if localNewDir != "" {
					stepExec.WorkingDir = localNewDir
				}
			}

		}
	}

	if err == nil && step.ActionKey != "" && groupKey != "" {
		if _, ok := flowData[groupKey]; !ok {
			flowData[groupKey] = make(map[string]interface{})
		}
		if gm, ok := flowData[groupKey].(map[string]interface{}); ok {
			if _, ok := gm["step"]; !ok {
				gm["step"] = make(map[string]interface{})
			}
			if sm, ok := gm["step"].(map[string]interface{}); ok {
				var parsed interface{}
				if step.OutputFormat == "json" {
					decoder := json.NewDecoder(strings.NewReader(output))
					decoder.UseNumber()
					if uerr := decoder.Decode(&parsed); uerr != nil {
						parsed = output
					}
				} else {
					parsed = output
				}
				key := step.ActionKey
				if index >= 0 {
					key = fmt.Sprintf("%s_%d", step.ActionKey, index)
				}
				sm[key] = parsed
			}
		}
	}

	if err != nil {
		if ctx.Err() != nil {
			e.hub.BroadcastStatus(step.ID.String(), executionID.String(), "step", string(domain.StatusCancelled))

			stepExec.Status = domain.StatusCancelled
			stepExec.Output = output
			finishedAt := time.Now()
			stepExec.FinishedAt = &finishedAt
			e.execRepo.CreateStepResult(stepExec)
			return err
		}
		e.hub.BroadcastStatus(step.ID.String(), executionID.String(), "step", string(domain.StatusFailed))

		stepExec.Status = domain.StatusFailed
		stepExec.Output = output
		finishedAt := time.Now()
		stepExec.FinishedAt = &finishedAt
		e.execRepo.CreateStepResult(stepExec)
		return err
	}

	e.hub.BroadcastStatus(step.ID.String(), executionID.String(), "step", string(domain.StatusSuccess))

	// Finalize execution step record
	stepExec.Status = domain.StatusSuccess
	stepExec.Output = output
	finishedAt := time.Now()
	stepExec.FinishedAt = &finishedAt
	e.execRepo.CreateStepResult(stepExec)

	return nil
}

// convertField is one field extractor for a CONVERT step in field-extract mode.
type convertField struct {
	Name    string `json:"name"`
	Start   string `json:"start"`
	EndMode string `json:"end_mode"` // "delimiter" | "eol" | "eof"
	End     string `json:"end"`      // only used when EndMode == "delimiter"
	Format  string `json:"format"`   // "string" | "number"
	Default string `json:"default"`
}

// asJSONNumber reports whether s is a valid JSON number literal and returns it as a
// json.Number. Unlike strconv.ParseFloat it rejects NaN/Inf/hex-floats/leading-zeros, which
// ParseFloat accepts but json.Marshal later refuses ("invalid number literal") — a mismatch
// that would otherwise fail the whole CONVERT step on one odd token.
func asJSONNumber(s string) (json.Number, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", false
	}
	var n json.Number
	dec := json.NewDecoder(strings.NewReader(s))
	if err := dec.Decode(&n); err != nil || dec.More() {
		return "", false
	}
	return n, true
}

// extractField greps a single value out of source per the field's start/end rules.
// Capture begins right AFTER the first occurrence of start (empty start = source beginning).
// It ends at the next delimiter / newline / end-of-source depending on EndMode; a missing
// delimiter or newline falls back to end-of-source. The captured text is trimmed, then
// coerced to the requested format. Default is used when start is not found, the capture is
// empty, or a number fails to parse.
func extractField(source string, f convertField) interface{} {
	def := func() interface{} {
		if f.Format == "number" {
			if n, ok := asJSONNumber(f.Default); ok {
				return n
			}
			return nil // non-numeric default in number mode → null
		}
		return f.Default
	}

	begin := 0
	if f.Start != "" {
		idx := strings.Index(source, f.Start)
		if idx < 0 {
			return def()
		}
		begin = idx + len(f.Start)
	}

	rest := source[begin:]
	endIdx := len(rest)
	switch f.EndMode {
	case "delimiter":
		if f.End != "" {
			if i := strings.Index(rest, f.End); i >= 0 {
				endIdx = i
			}
		}
	case "eol":
		if i := strings.IndexByte(rest, '\n'); i >= 0 {
			endIdx = i
		}
	}
	captured := strings.TrimSpace(rest[:endIdx])

	if captured == "" {
		return def()
	}

	if f.Format == "number" {
		if n, ok := asJSONNumber(captured); ok {
			return n
		}
		return def()
	}
	return captured
}

// runConvertStep converts a templated text source into JSON.
//
// Field-extract mode (step.ConvertFields is a non-empty JSON array): each field greps a value
// out of the rendered source and the step returns a JSON object {name: value, ...}. Later steps
// can then read a single field via {{ flow.<group>.step.<action_key>.<name> }} or the whole
// object via {{ flow.<group>.step.<action_key>|json }} (set an action_key + Output Format = JSON).
//
// Legacy mode (step.ConvertFields empty): if the rendered text is valid JSON it is normalized;
// otherwise it is wrapped as a JSON string so the result is always valid JSON.
func (e *WorkflowExecutor) runConvertStep(step *domain.WorkflowStep, inputs map[string]string, variables []domain.WorkflowVariable, flowData map[string]interface{}, namespaceID uuid.UUID, user *domain.User, item interface{}, index int, mainLogFile *os.File, stepLogFile *os.File, workflowID uuid.UUID, executionID uuid.UUID) (string, error) {
	pcontext := e.getInterpolationContext(inputs, variables, flowData, namespaceID, user, item, index, uuid.Nil, executionID)
	rendered, err := e.renderTemplate(step.ConvertSource, pcontext)
	if err != nil {
		return "", fmt.Errorf("source render error: %w", err)
	}

	logf := func(format string, a ...interface{}) {
		msg := fmt.Sprintf(format, a...)
		fmt.Fprint(mainLogFile, msg)
		fmt.Fprint(stepLogFile, msg)
		e.hub.BroadcastLog(workflowID.String(), executionID.String(), msg)
	}

	// Field-extract mode
	if fieldsStr := strings.TrimSpace(step.ConvertFields); fieldsStr != "" && fieldsStr != "[]" {
		var fields []convertField
		if uerr := json.Unmarshal([]byte(fieldsStr), &fields); uerr != nil {
			return "", fmt.Errorf("convert_fields is not valid JSON: %w", uerr)
		}
		if len(fields) > 0 {
			// Output is a JSON object keyed by field name (json.Marshal emits keys sorted, which
			// is fine — later steps read fields by name, not by position). A later field with a
			// duplicate name overwrites an earlier one.
			result := make(map[string]interface{}, len(fields))
			for _, f := range fields {
				if f.Name == "" {
					continue
				}
				val := extractField(rendered, f)
				result[f.Name] = val
				logf("\033[90m$ CONVERT field %s → %v\033[0m\n", f.Name, val)
			}
			b, merr := json.Marshal(result)
			if merr != nil {
				return "", fmt.Errorf("convert result marshal error: %w", merr)
			}
			return string(b), nil
		}
	}

	trimmed := strings.TrimSpace(rendered)
	if trimmed == "" {
		logf("\033[90m$ CONVERT → null (empty source)\033[0m\n")
		return "null", nil
	}

	// Parse only if the WHOLE source is one JSON value (dec.More() guards against
	// trailing junk like "5 hello" being silently truncated to 5).
	var v interface{}
	dec := json.NewDecoder(strings.NewReader(trimmed))
	dec.UseNumber()
	if derr := dec.Decode(&v); derr == nil && !dec.More() {
		b, _ := json.Marshal(v)
		logf("\033[90m$ CONVERT → JSON (parsed)\033[0m\n")
		return string(b), nil
	}

	// Not valid JSON → wrap the trimmed text as a JSON string.
	b, _ := json.Marshal(trimmed)
	logf("\033[90m$ CONVERT → JSON string (text wrapped)\033[0m\n")
	return string(b), nil
}

// defaultDatasetQueryCap bounds how many records a QUERY loads when DatasetLimit is 0.
const defaultDatasetQueryCap = 10000

// runDatasetStep handles a step of action_type=DATASET. It runs in the orchestrator (no shell),
// performing QUERY / INSERT / UPDATE / DELETE against a dataset's records. The returned string is
// JSON and — when the step has an action_key and output_format=json — is captured into flowData
// so later steps can read it via {{ flow.<group>.step.<action_key> }}.
func (e *WorkflowExecutor) runDatasetStep(step *domain.WorkflowStep, inputs map[string]string, variables []domain.WorkflowVariable, flowData map[string]interface{}, namespaceID uuid.UUID, user *domain.User, item interface{}, index int, mainLogFile *os.File, stepLogFile *os.File, workflowID uuid.UUID, executionID uuid.UUID) (string, error) {
	if e.datasetRepo == nil {
		return "", fmt.Errorf("dataset repository not configured")
	}
	if step.DatasetID == nil {
		return "", fmt.Errorf("dataset step has no dataset selected")
	}

	scope := domain.PermissionScope{IsGlobal: true}
	ds, err := e.datasetRepo.GetByID(*step.DatasetID, &scope)
	if err != nil {
		return "", fmt.Errorf("dataset not found: %w", err)
	}

	pcontext := e.getInterpolationContext(inputs, variables, flowData, namespaceID, user, item, index, uuid.Nil, executionID)

	// Render filter and payload templates so they can reference inputs / prior step output.
	renderedFilter, _ := e.renderTemplate(step.DatasetFilter, pcontext)
	renderedFilter = strings.TrimSpace(renderedFilter)
	renderedPayload, _ := e.renderTemplate(step.DatasetPayload, pcontext)

	op := strings.ToUpper(strings.TrimSpace(step.DatasetOperation))

	logf := func(format string, a ...interface{}) {
		msg := fmt.Sprintf(format, a...)
		fmt.Fprint(mainLogFile, msg)
		fmt.Fprint(stepLogFile, msg)
		e.hub.BroadcastLog(workflowID.String(), executionID.String(), msg)
	}

	logf("\033[90m$ DATASET %s on \"%s\" (key=%s)\033[0m\n", op, ds.Name, ds.Key)

	recordToMap := func(r domain.DatasetRecord) map[string]interface{} {
		m := map[string]interface{}{}
		if r.Data != "" {
			dec := json.NewDecoder(strings.NewReader(r.Data))
			dec.UseNumber()
			_ = dec.Decode(&m)
		}
		m["_id"] = r.ID.String()
		return m
	}

	switch op {
	case "QUERY":
		recs, err := e.datasetRepo.AllRecords(*step.DatasetID)
		if err != nil {
			return "", err
		}
		limit := step.DatasetLimit
		if limit <= 0 {
			limit = defaultDatasetQueryCap
		}
		out := []map[string]interface{}{}
		for _, r := range recs {
			m := recordToMap(r)
			if evalFilterString(m, renderedFilter) {
				out = append(out, m)
				if len(out) >= limit {
					break
				}
			}
		}
		logf("\033[90m→ %d record(s) matched\033[0m\n", len(out))
		b, _ := json.Marshal(out)
		return string(b), nil

	case "FIND_ONE":
		recs, err := e.datasetRepo.AllRecords(*step.DatasetID)
		if err != nil {
			return "", err
		}
		for _, r := range recs {
			m := recordToMap(r)
			if evalFilterString(m, renderedFilter) {
				logf("\033[90m→ 1 record matched\033[0m\n")
				b, _ := json.Marshal(m)
				return string(b), nil
			}
		}
		logf("\033[90m→ no record matched\033[0m\n")
		return "null", nil

	case "INSERT":
		objs, err := parseDatasetPayload(renderedPayload)
		if err != nil {
			return "", err
		}
		if len(objs) == 0 {
			return "", fmt.Errorf("INSERT requires a payload")
		}
		for _, obj := range objs {
			if f := operatorField(obj); f != "" {
				return "", fmt.Errorf("field %q: update operators ($inc) are only supported in UPDATE, not INSERT", f)
			}
		}
		created := []map[string]interface{}{}
		for _, obj := range objs {
			b, _ := json.Marshal(obj)
			rec := &domain.DatasetRecord{ID: uuid.New(), DatasetID: *step.DatasetID, Data: string(b)}
			if err := e.datasetRepo.CreateRecord(rec); err != nil {
				return "", err
			}
			obj["_id"] = rec.ID.String()
			created = append(created, obj)
		}
		logf("\033[90m→ inserted %d record(s)\033[0m\n", len(created))
		b, _ := json.Marshal(created)
		return string(b), nil

	case "UPDATE":
		if filterIsEmpty(renderedFilter) {
			return "", fmt.Errorf("UPDATE requires a non-empty filter")
		}
		objs, err := parseDatasetPayload(renderedPayload)
		if err != nil {
			return "", err
		}
		if len(objs) != 1 {
			return "", fmt.Errorf("UPDATE payload must be a single JSON object")
		}
		setFields, deltas, err := splitUpdatePatch(objs[0])
		if err != nil {
			return "", err
		}
		recs, err := e.datasetRepo.AllRecords(*step.DatasetID)
		if err != nil {
			return "", err
		}
		matched := []domain.DatasetRecord{}
		for _, r := range recs {
			if evalFilterString(recordToMap(r), renderedFilter) {
				matched = append(matched, r)
			}
		}
		ids := make([]string, 0, len(matched))
		if len(deltas) > 0 {
			// Atomic path: merge set-fields and apply numeric deltas in one statement,
			// recomputing each field from the current DB value (race-free).
			matchedIDs := make([]uuid.UUID, 0, len(matched))
			for _, r := range matched {
				matchedIDs = append(matchedIDs, r.ID)
			}
			if _, err := e.datasetRepo.IncrementAndSet(*step.DatasetID, matchedIDs, setFields, deltas); err != nil {
				return "", err
			}
			for _, r := range matched {
				ids = append(ids, r.ID.String())
			}
		} else {
			// Plain merge: overwrite set-fields into each matched record.
			for _, r := range matched {
				m := recordToMap(r)
				delete(m, "_id")
				for k, v := range setFields {
					m[k] = v
				}
				b, _ := json.Marshal(m)
				r.Data = string(b)
				if err := e.datasetRepo.UpdateRecord(&r); err != nil {
					return "", err
				}
				ids = append(ids, r.ID.String())
			}
		}
		logf("\033[90m→ updated %d record(s)\033[0m\n", len(ids))
		b, _ := json.Marshal(map[string]interface{}{"affected": len(ids), "ids": ids})
		return string(b), nil

	case "DELETE":
		if filterIsEmpty(renderedFilter) {
			return "", fmt.Errorf("DELETE requires a non-empty filter")
		}
		recs, err := e.datasetRepo.AllRecords(*step.DatasetID)
		if err != nil {
			return "", err
		}
		ids := []string{}
		for _, r := range recs {
			m := recordToMap(r)
			if !evalFilterString(m, renderedFilter) {
				continue
			}
			if err := e.datasetRepo.DeleteRecord(r.ID); err != nil {
				return "", err
			}
			ids = append(ids, r.ID.String())
		}
		logf("\033[90m→ deleted %d record(s)\033[0m\n", len(ids))
		b, _ := json.Marshal(map[string]interface{}{"affected": len(ids), "ids": ids})
		return string(b), nil

	default:
		return "", fmt.Errorf("unknown dataset operation: %q", step.DatasetOperation)
	}
}

// operatorField returns the first key in obj whose value is an update-operator object
// (currently {"$inc": ...}), or "" if none. Used to reject operators where they make no
// sense (INSERT).
func operatorField(obj map[string]interface{}) string {
	for k, v := range obj {
		if m, ok := v.(map[string]interface{}); ok {
			if _, has := m["$inc"]; has {
				return k
			}
		}
	}
	return ""
}

// splitUpdatePatch separates a rendered UPDATE payload into plain set-fields (overwritten)
// and numeric increment deltas. A field whose value is an object {"$inc": <number>} is an
// increment operator; any other value is a literal set. Errors on a malformed operator
// (extra keys, non-numeric value, or applied to _id).
func splitUpdatePatch(patch map[string]interface{}) (map[string]interface{}, map[string]float64, error) {
	setFields := map[string]interface{}{}
	deltas := map[string]float64{}
	for k, v := range patch {
		if obj, ok := v.(map[string]interface{}); ok {
			if incVal, hasInc := obj["$inc"]; hasInc {
				if len(obj) != 1 {
					return nil, nil, fmt.Errorf("field %q: $inc cannot be combined with other keys", k)
				}
				if k == "_id" {
					return nil, nil, fmt.Errorf("$inc cannot target _id")
				}
				f, ok := toFloat(incVal)
				if !ok {
					return nil, nil, fmt.Errorf("field %q: $inc value must be numeric, got %v", k, incVal)
				}
				deltas[k] = f
				continue
			}
		}
		setFields[k] = v
	}
	return setFields, deltas, nil
}

// parseDatasetPayload accepts a JSON object or array of objects and returns a slice of maps.
func parseDatasetPayload(raw string) ([]map[string]interface{}, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.UseNumber()
	var v interface{}
	if err := dec.Decode(&v); err != nil {
		return nil, fmt.Errorf("payload is not valid JSON: %w", err)
	}
	switch t := v.(type) {
	case map[string]interface{}:
		return []map[string]interface{}{t}, nil
	case []interface{}:
		out := []map[string]interface{}{}
		for _, e := range t {
			if m, ok := e.(map[string]interface{}); ok {
				out = append(out, m)
			} else {
				return nil, fmt.Errorf("payload array must contain only JSON objects")
			}
		}
		return out, nil
	default:
		return nil, fmt.Errorf("payload must be a JSON object or array of objects")
	}
}

// runWorkflowStep handles a step of action_type=WORKFLOW, running a target workflow either
// synchronously (WaitToFinish=true) or asynchronously as a spawned goroutine.
func (e *WorkflowExecutor) runWorkflowStep(ctx context.Context, step *domain.WorkflowStep, inputs map[string]string, variables []domain.WorkflowVariable, flowData map[string]interface{}, namespaceID uuid.UUID, mainLogFile *os.File, stepLogFile *os.File, workflowID uuid.UUID, executionID uuid.UUID, user *domain.User, fromExecutionID *uuid.UUID, item interface{}, index int) (string, error) {
	if step.TargetWorkflowID == nil {
		return "", fmt.Errorf("step %q has action_type=WORKFLOW but no target_workflow_id set", step.Name)
	}

	// Interpolate the target workflow inputs
	var rawInputs map[string]interface{}
	if step.TargetWorkflowInputs != "" {
		if err := json.Unmarshal([]byte(step.TargetWorkflowInputs), &rawInputs); err != nil {
			fmt.Fprintf(mainLogFile, "\033[1;31m✖ Failed to unmarshal TargetWorkflowInputs: %v\033[0m\n", err)
		}
	}

	// NEW: Fetch target workflow to get its default inputs
	targetWf, err := e.wfRepo.GetByID(*step.TargetWorkflowID, nil)
	if err != nil {
		fmt.Fprintf(mainLogFile, "\033[1;31m✖ Failed to fetch target workflow %s for defaults: %v\033[0m\n", step.TargetWorkflowID, err)
	}

	// Interpolate each input value through the current workflow context
	pcontext := e.getInterpolationContext(inputs, variables, flowData, namespaceID, user, item, index, uuid.Nil, executionID)
	resolvedInputs := make(map[string]string)

	// 1. First, populate with target workflow default values
	if targetWf != nil {
		for _, in := range targetWf.Inputs {
			resolvedInputs[in.Key] = in.DefaultValue
		}
	}

	// 2. Then, apply overrides from step inputs
	for k, vRaw := range rawInputs {
		v := ""
		if s, ok := vRaw.(string); ok {
			v = s
		} else {
			// If it's already an object/array, stringify it so the Foreach/Render logic can handle it
			b, _ := json.Marshal(vRaw)
			v = string(b)
		}
		isForeach := false
		// New JSON-based Foreach logic
		var foreachData struct {
			Type     string      `json:"_type"`
			Source   string      `json:"source"`
			Template interface{} `json:"template"`
		}
		trimmedV := strings.TrimSpace(v)
		if strings.HasPrefix(trimmedV, "{") {
			unmarshalErr := json.Unmarshal([]byte(v), &foreachData)
			if unmarshalErr == nil && foreachData.Type == "foreach" {
				isForeach = true
			} else {
				limit := 15
				if len(trimmedV) < limit {
					limit = len(trimmedV)
				}
			}
		}

		if isForeach {
			// 1. Render source variable to get the array
			// If the source is a simple template like {{...}}, wrap it in |json filter to ensure valid JSON representation of maps/slices
			renderSource := foreachData.Source
			if strings.HasPrefix(strings.TrimSpace(renderSource), "{{") && strings.HasSuffix(strings.TrimSpace(renderSource), "}}") && !strings.Contains(renderSource, "|json") {
				inner := strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(renderSource), "{{"), "}}")
				renderSource = fmt.Sprintf("{{ %s | json }}", strings.TrimSpace(inner))
			}

			sourceJson, err := e.renderTemplate(renderSource, pcontext)
			if err != nil {
				fmt.Fprintf(mainLogFile, "\033[1;31m✖ Failed to render source [%s] with template [%s]: %v\033[0m\n", k, renderSource, err)
				resolvedInputs[k] = "[]"
				continue
			}

			// 2. Parse sourceJson as array or single item (robustly)
			var items []interface{}
			var parseJsonItems func(string) []interface{}
			parseJsonItems = func(js string) []interface{} {
				js = strings.TrimSpace(js)
				if js == "" {
					return nil
				}
				// Try straight array unmarshal
				var list []interface{}
				if err := json.Unmarshal([]byte(js), &list); err == nil {
					return list
				}
				// Try as a single value (could be a double-encoded JSON string)
				var single interface{}
				if err := json.Unmarshal([]byte(js), &single); err == nil {
					if s, ok := single.(string); ok {
						// If the string itself is a JSON array/object, recurse
						trimmedS := strings.TrimSpace(s)
						if strings.HasPrefix(trimmedS, "[") || strings.HasPrefix(trimmedS, "{") {
							return parseJsonItems(s)
						}
						// Comma separated fallback
						if strings.Contains(s, ",") {
							parts := strings.Split(s, ",")
							var res []interface{}
							for _, p := range parts {
								res = append(res, strings.TrimSpace(p))
							}
							return res
						}
						return []interface{}{s}
					}
					return []interface{}{single}
				}
				// Final raw fallback for non-JSON strings
				if strings.Contains(js, ",") {
					parts := strings.Split(js, ",")
					var res []interface{}
					for _, p := range parts {
						res = append(res, strings.TrimSpace(p))
					}
					return res
				}
				return []interface{}{js}
			}

			items = parseJsonItems(sourceJson)

			// 3. Render template for each item
			var results []interface{}
			for i, item := range items {
				// Create sub-context
				subContext := make(pongo2.Context)
				for pk, pv := range pcontext {
					subContext[pk] = pv
				}
				subContext["item"] = item

				// Determine template string based on type (string for multi-select, map for multi-input)
				switch t := foreachData.Template.(type) {
				case string:
					rendered, err := e.renderTemplate(t, subContext)
					if err != nil {
						fmt.Fprintf(mainLogFile, "\033[1;31m✖ Failed to render template for input key [%s], item index [%d]: %v\033[0m\n", k, i, err)
						results = append(results, item) // Fallback to original item on error
					} else if strings.TrimSpace(rendered) == "" {
						results = append(results, item)
					} else {
						results = append(results, strings.TrimSpace(rendered))
					}
				case map[string]interface{}:
					// For multi-input, we iterate over keys and render each
					row := make(map[string]interface{})
					for tk, tv := range t {
						if tvStr, ok := tv.(string); ok {
							rendered, err := e.renderTemplate(tvStr, subContext)
							if err != nil {
								fmt.Fprintf(mainLogFile, "\033[1;31m✖ Failed to render template for row key [%s], item [%d]: %v\033[0m\n", tk, i, err)
								row[tk] = tvStr
							} else {
								row[tk] = strings.TrimSpace(rendered)
							}
						} else {
							row[tk] = tv
						}
					}
					results = append(results, row)
				default:
					results = append(results, item)
				}
			}
			finalJson, _ := json.Marshal(results)
			resolvedInputs[k] = string(finalJson)
		} else {
			rendered, err := e.renderTemplate(v, pcontext)
			if err != nil {
				fmt.Fprintf(mainLogFile, "\033[1;31m✖ Failed to render input [%s]: %v\033[0m\n", k, err)
				rendered = v // fallback to raw value on error
			}
			resolvedInputs[k] = rendered
		}
	}

	hookExecID := uuid.New()
	logMsg := fmt.Sprintf("\033[1;34m↪ RUN WORKFLOW: %s\033[0m\n", step.TargetWorkflowID)
	fmt.Fprint(mainLogFile, logMsg)
	fmt.Fprint(stepLogFile, logMsg)
	e.hub.BroadcastLog(workflowID.String(), executionID.String(), logMsg)

	if step.WaitToFinish != nil && !*step.WaitToFinish {
		// Async: spawn the workflow and immediately return success
		go func(targetID uuid.UUID, execID uuid.UUID, in map[string]string) {
			// If the parent execution was already stopped, don't start the child.
			// Closes the race between spawning this goroutine and the child
			// registering itself in the stop tree.
			if ctx.Err() != nil {
				return
			}
			bgCtx := context.Background()
			err := e.RunWithDepth(bgCtx, targetID, execID, in, nil, nil, "STEP", 1, user, nil, nil, &executionID)
			if err != nil {
				e.hub.BroadcastLog(workflowID.String(), executionID.String(), fmt.Sprintf("\033[1;33m⚠ Async workflow %s failed: %v\033[0m", targetID, err))
			} else {
				e.hub.BroadcastLog(workflowID.String(), executionID.String(), fmt.Sprintf("\033[1;32m✔ Async workflow %s succeeded\033[0m", targetID))
			}
		}(*step.TargetWorkflowID, hookExecID, resolvedInputs)
		asyncMsg := "\033[90m⚡ Workflow spawned asynchronously, continuing...\033[0m\n"
		fmt.Fprint(mainLogFile, asyncMsg)
		fmt.Fprint(stepLogFile, asyncMsg)
		return "async", nil
	}

	// Mirror the child execution's main log stream onto this parent step AND the
	// parent's global/aggregated terminal, so the child's output shows inline
	// without selecting the step — live, on reconnect, and in the historical
	// view — matching how LOCAL/REMOTE steps already surface in the global view.
	// Only active while we synchronously wait for the child; removed before
	// stepLogFile is closed by the caller. mainLogFile stays open longer (closed
	// by Execute), so appending to it after this returns is safe.
	e.hub.AddLogMirror(hookExecID.String(), step.TargetWorkflowID.String(), step.ID.String(), executionID.String(), workflowID.String(), stepLogFile, mainLogFile)
	defer e.hub.RemoveLogMirror(hookExecID.String())

	err = e.RunWithDepth(ctx, *step.TargetWorkflowID, hookExecID, resolvedInputs, nil, nil, "STEP", 1, user, nil, nil, &executionID)
	if err != nil {
		return "", fmt.Errorf("target workflow %s failed: %w", step.TargetWorkflowID, err)
	}
	successMsg := "\033[1;32m✔ Workflow step completed successfully\033[0m\n"
	fmt.Fprint(mainLogFile, successMsg)
	fmt.Fprint(stepLogFile, successMsg)

	// Surface the child workflow's Result envelope as this step's output so parent steps
	// can reuse it via templating (e.g. {{ flow.groupKey.step.actionKey.result.foo }}).
	// Falls back to "success" when the child declares no outputs.
	if child, gerr := e.execRepo.GetByID(hookExecID, nil); gerr == nil && child != nil && strings.TrimSpace(child.Result) != "" {
		return child.Result, nil
	}
	return "success", nil
}

func (e *WorkflowExecutor) runLocalStep(ctx context.Context, step *domain.WorkflowStep, execCfg GroupExecConfig, command string, mainLogFile *os.File, stepLogFile *os.File, workflowID uuid.UUID, executionID uuid.UUID, workingDirs *sync.Map) (string, string, error) {
	// Persist CWD for local execution
	localID := uuid.Nil // Use Nil UUID as key for local server
	cwdMarker := "::CWD::"
	var startingDir string
	if val, ok := workingDirs.Load(localID); ok {
		startingDir = val.(string)
		if startingDir != "" {
			// Use curly braces for grouping in the same shell context
			command = fmt.Sprintf("cd %s && { %s; }", strconv.Quote(startingDir), strings.TrimSpace(command))
		}
	}
	// Use -P for local consistency as well
	command = fmt.Sprintf("%s; printf '%s' && pwd -P", strings.TrimSpace(command), cwdMarker)

	var out bytes.Buffer

	// Multi-writer for all destinations we want cleaned
	outWriter := io.Writer(&out) // capture output without broadcasting
	mw := io.MultiWriter(
		&wsWriter{hub: e.hub, targetID: workflowID.String(), executionID: executionID.String(), buffer: mainLogFile},
		&wsWriter{hub: e.hub, targetID: step.ID.String(), executionID: executionID.String(), buffer: nil}, // Broadcast to step trace
		&fileWriter{file: stepLogFile},
		outWriter,
	)

	// Filter out the CWD marker and capture the directory
	filter := &cwdFilteredWriter{
		underlying: mw,
		marker:     cwdMarker,
	}

	var err error
	localConn := NewLocalConnection(nil) // LocalConnection hiện tại không dùng field server bên trong Execute/ExecuteWithTTY trừ khi thật cần
	if execCfg.UseTTY {
		stdinCh, dispatchWriter := makeAutoInputCh(ctx, execCfg.AutoInputs)
		if dispatchWriter != nil && dispatchWriter != io.Discard {
			filter.underlying = io.MultiWriter(mw, dispatchWriter)
		}
		_, err = localConn.ExecuteWithTTY(ctx, command, stdinCh, filter)
	} else {
		_, err = localConn.Execute(ctx, command, filter)
	}

	filter.Finalize()
	if filter.found {
		newDir := filepath.Clean(strings.TrimSpace(filter.cwdBuffer.String()))
		if newDir != "" {
			workingDirs.Store(localID, newDir)
			return out.String(), newDir, err
		}
	}
	return out.String(), "", err
}

// Helper for io.MultiWriter with os.File
type fileWriter struct {
	file *os.File
}

func (w *fileWriter) Write(p []byte) (n int, err error) {
	return w.file.Write(p)
}

type wsWriter struct {
	hub         *Hub
	targetID    string
	executionID string
	buffer      io.Writer
}

func (w *wsWriter) Write(p []byte) (n int, err error) {
	if w.buffer != nil {
		n, err = w.buffer.Write(p)
	} else {
		n = len(p)
	}
	w.hub.BroadcastLog(w.targetID, w.executionID, string(p))
	return n, err
}

type cwdFilteredWriter struct {
	underlying io.Writer
	marker     string
	buffer     bytes.Buffer
	found      bool
	cwdBuffer  strings.Builder
	mu         sync.Mutex
}

func (w *cwdFilteredWriter) Write(p []byte) (n int, err error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.found {
		w.cwdBuffer.Write(p)
		return len(p), nil
	}

	w.buffer.Write(p)
	content := w.buffer.Bytes()
	idx := bytes.Index(content, []byte(w.marker))

	if idx != -1 {
		// Output everything before the marker
		if _, err := w.underlying.Write(content[:idx]); err != nil {
			return 0, err
		}
		w.found = true
		// Capture anything after the marker in this chunk
		w.cwdBuffer.Write(content[idx+len(w.marker):])
		w.buffer.Reset()
		return len(p), nil
	}

	// Line buffering: Only flush when we see a newline,
	// unless the buffer is getting very large.
	for {
		curr := w.buffer.Bytes()
		nlIdx := bytes.IndexByte(curr, '\n')
		if nlIdx == -1 {
			break
		}
		// Flush one line
		if _, err := w.underlying.Write(w.buffer.Next(nlIdx + 1)); err != nil {
			return 0, err
		}
	}

	return len(p), nil
}

func (w *cwdFilteredWriter) Finalize() {
	w.mu.Lock()
	defer w.mu.Unlock()

	if !w.found && w.buffer.Len() > 0 {
		w.underlying.Write(w.buffer.Bytes())
		w.buffer.Reset()
	}
}

func (e *WorkflowExecutor) renderTemplate(templateStr string, ctx pongo2.Context) (string, error) {
	// Pre-process for non-standard Pongo2 syntax
	// 1. Handle (expr).prop -> expr|attr:"prop"
	reGroupProp := regexp.MustCompile(`\(([^)]+)\)\.([a-zA-Z_][a-zA-Z0-9_]*)`)
	templateStr = reGroupProp.ReplaceAllString(templateStr, `$1|attr:"$2"`)

	// 2. Handle |find:{"key":"val"} -> |find:"key=val"
	reFindMap := regexp.MustCompile(`\|find:\{\s*"([^"]+)"\s*:\s*"([^"]+)"\s*\}`)
	templateStr = reFindMap.ReplaceAllString(templateStr, `|find:"$1=$2"`)

	tpl, err := pongo2.FromString(templateStr)
	if err != nil {
		return "", fmt.Errorf("template syntax error: %w", err)
	}
	return tpl.Execute(ctx)
}

// buildWorkflowResult renders each declared output's Source template against the final
// flow-data and assembles the Result envelope {"status":...,"result":{...}} as a JSON
// string. A value that renders to valid JSON is stored typed (number/object/bool);
// otherwise it is kept as the raw string. A render error yields an empty string for that
// key (never fails the workflow). Status is normalized to "success"/"failed".
func (e *WorkflowExecutor) buildWorkflowResult(wf *domain.Workflow, flowData map[string]interface{}, status domain.Status, inputsMap map[string]string, execution *domain.WorkflowExecution) string {
	result := make(map[string]interface{})
	pcontext := e.getInterpolationContext(inputsMap, wf.Variables, flowData, wf.NamespaceID, execution.User, nil, -1, uuid.Nil, execution.ID)
	for _, out := range wf.Outputs {
		if out.Key == "" {
			continue
		}
		rendered, err := e.renderTemplate(out.Source, pcontext)
		if err != nil {
			e.hub.BroadcastLog(wf.ID.String(), execution.ID.String(), fmt.Sprintf("\033[1;33m⚠ Output %q render error: %v\033[0m", out.Key, err))
			result[out.Key] = ""
			continue
		}
		trimmed := strings.TrimSpace(rendered)
		var parsed interface{}
		dec := json.NewDecoder(strings.NewReader(trimmed))
		dec.UseNumber()
		if trimmed != "" && dec.Decode(&parsed) == nil {
			result[out.Key] = parsed
		} else {
			result[out.Key] = rendered
		}
	}

	statusStr := "failed"
	if status == domain.StatusSuccess {
		statusStr = "success"
	}
	envelope := map[string]interface{}{"status": statusStr, "result": result}
	b, err := json.Marshal(envelope)
	if err != nil {
		return ""
	}
	return string(b)
}

func (e *WorkflowExecutor) getInterpolationContext(inputs map[string]string, variables []domain.WorkflowVariable, flowData map[string]interface{}, namespaceID uuid.UUID, user *domain.User, item interface{}, index int, targetServerID uuid.UUID, execID uuid.UUID) pongo2.Context {
	ctx := make(pongo2.Context)

	// Rewrite file paths if target is remote
	var finalInputs interface{} = inputs
	var finalVariables interface{} = variables
	var finalItem interface{} = item

	if targetServerID != uuid.Nil {
		targetPathPrefix := filepath.Join("data", "uploads", "inputs")
		re := regexp.MustCompile(fmt.Sprintf(`([^"'} ]*?)%s/([a-zA-Z0-9-]+)/([^"'} ]+)`, regexp.QuoteMeta(targetPathPrefix)))
		
		finalInputs = e.rewriteObjectPaths(inputs, re)
		finalVariables = e.rewriteObjectPaths(variables, re)
		finalItem = e.rewriteObjectPaths(item, re)
	}

	// 1. Inputs: input.key
	// We handle inputs by converting back to a map for pongo2 compatibility
	inMap := make(map[string]interface{})
	if m, ok := finalInputs.(map[string]string); ok {
		for k, v := range m {
			// Only try to parse as JSON for multi-select and multi-input (arrays or objects)
			trimmed := strings.TrimSpace(v)
			if strings.HasPrefix(trimmed, "[") || strings.HasPrefix(trimmed, "{") {
				var jsonVal interface{}
				decoder := json.NewDecoder(strings.NewReader(v))
				decoder.UseNumber()
				if err := decoder.Decode(&jsonVal); err == nil {
					inMap[k] = jsonVal
					continue
				}
			}

			if SecurityRegex.MatchString(v) {
				inMap[k] = strings.ReplaceAll(v, "\\n", "\n")
			} else {
				inMap[k] = v
			}
		}
	}
	ctx["input"] = inMap

	if finalItem != nil {
		ctx["item"] = finalItem
	}
	if index >= 0 {
		ctx["index"] = index
	}

	// 2. Global Variables: global.key
	global := make(map[string]string)
	if e.globalVarRepo != nil {
		scope := domain.PermissionScope{IsGlobal: true}
		gvs, _ := e.globalVarRepo.List(namespaceID, &scope)
		for _, v := range gvs {
			if v.Value == "" || SecurityRegex.MatchString(v.Value) {
				global[v.Key] = v.Value
			}
		}
	}
	ctx["global"] = global

	// 3. Variables: variable.key
	vars := make(map[string]string)
	if vList, ok := finalVariables.([]domain.WorkflowVariable); ok {
		for _, v := range vList {
			if v.Value == "" || SecurityRegex.MatchString(v.Value) {
				vars[v.Key] = v.Value
			}
		}
	}
	ctx["variable"] = vars

	// 4. Step/Group Status: flow.group_key.status and flow.group_key.step.action_key
	ctx["flow"] = flowData

	// 5. Runner identity: user.username, user.full_name, user.nickname, user.email, user.chat_account_id
	ctx["user"] = runnerContext(user)

	return ctx
}

// runnerContext exposes the identity of whoever triggered the run to templates. Keys are
// always present — a schedule run has no user, and a missing key would break `{{ user.x }}`
// rendering instead of rendering empty. Values pass the same SecurityRegex screen as global
// variables because they end up inside shell commands.
func runnerContext(user *domain.User) map[string]string {
	runner := map[string]string{
		"id":              "",
		"username":        "",
		"full_name":       "",
		"nickname":        "",
		"email":           "",
		"chat_account_id": "",
	}
	if user == nil {
		return runner
	}

	runner["id"] = user.ID.String()
	for key, value := range map[string]string{
		"username":        user.Username,
		"full_name":       user.FullName,
		"nickname":        user.Nickname,
		"email":           user.Email,
		"chat_account_id": user.ChatAccountID,
	} {
		if SecurityRegex.MatchString(value) {
			runner[key] = value
		}
	}
	return runner
}

func (e *WorkflowExecutor) rewriteObjectPaths(obj interface{}, re *regexp.Regexp) interface{} {
	if obj == nil {
		return nil
	}

	switch v := obj.(type) {
	case string:
		return re.ReplaceAllString(v, "/tmp/csm_inputs/$2/$3")
	case map[string]string:
		newMap := make(map[string]string)
		for k, val := range v {
			newMap[k] = re.ReplaceAllString(val, "/tmp/csm_inputs/$2/$3")
		}
		return newMap
	case []domain.WorkflowVariable:
		newVars := make([]domain.WorkflowVariable, len(v))
		for i, varItem := range v {
			newVars[i] = varItem
			newVars[i].Value = re.ReplaceAllString(varItem.Value, "/tmp/csm_inputs/$2/$3")
		}
		return newVars
	case map[string]interface{}:
		newMap := make(map[string]interface{})
		for k, val := range v {
			newMap[k] = e.rewriteObjectPaths(val, re)
		}
		return newMap
	case []interface{}:
		newSlice := make([]interface{}, len(v))
		for i, val := range v {
			newSlice[i] = e.rewriteObjectPaths(val, re)
		}
		return newSlice
	default:
		return obj
	}
}

func matchConditions(item map[string]interface{}, pairs []string) bool {
	for _, pair := range pairs {
		var op string
		var k, v string

		if strings.Contains(pair, ">=") {
			op = ">="
		} else if strings.Contains(pair, "<=") {
			op = "<="
		} else if strings.Contains(pair, "!=") {
			op = "!="
		} else if strings.Contains(pair, ">") {
			op = ">"
		} else if strings.Contains(pair, "<") {
			op = "<"
		} else if strings.Contains(pair, "~") {
			op = "~"
		} else if strings.Contains(pair, "=") {
			op = "="
		}

		if op == "" {
			continue
		}

		parts := strings.SplitN(pair, op, 2)
		if len(parts) != 2 {
			continue
		}

		k = strings.TrimSpace(parts[0])
		v = strings.TrimSpace(parts[1])

		if !matchOne(item, k, op, v) {
			return false
		}
	}
	return true
}

// matchOne evaluates a single condition against a record field. Operator and value are
// explicit (no re-parsing), so values may safely contain operator characters.
func matchOne(item map[string]interface{}, field, op, value string) bool {
	itemVal := fmt.Sprintf("%v", item[field])

	fItem, err1 := strconv.ParseFloat(itemVal, 64)
	fParam, err2 := strconv.ParseFloat(value, 64)
	isNumeric := err1 == nil && err2 == nil

	switch op {
	case "=":
		return itemVal == value
	case "!=":
		return itemVal != value
	case ">":
		if isNumeric {
			return fItem > fParam
		}
		return itemVal > value
	case "<":
		if isNumeric {
			return fItem < fParam
		}
		return itemVal < value
	case ">=":
		if isNumeric {
			return fItem >= fParam
		}
		return itemVal >= value
	case "<=":
		if isNumeric {
			return fItem <= fParam
		}
		return itemVal <= value
	case "~":
		return strings.Contains(itemVal, value)
	}
	return true
}

func (e *WorkflowExecutor) extractSessionID(path string) string {
	parts := strings.Split(filepath.ToSlash(path), "/")
	for i, part := range parts {
		if part == "inputs" && i+1 < len(parts) {
			// Basic UUID-like check or just return the next part
			return parts[i+1]
		}
	}
	return ""
}

func (e *WorkflowExecutor) uploadSessionFilesIfNeeded(ctx context.Context, execID uuid.UUID, serverID uuid.UUID, inputs map[string]string, variables []domain.WorkflowVariable, item interface{}, mainLogFile *os.File, stepLogFile *os.File, user *domain.User) error {
	if serverID == uuid.Nil {
		return nil
	}

	// Find all session IDs in inputs, variables and item
	sessions := make(map[string]bool)
	targetPathPrefix := filepath.Join("data", "uploads", "inputs")
	
	e.extractSessionIDsFromObject(inputs, targetPathPrefix, sessions)
	e.extractSessionIDsFromObject(variables, targetPathPrefix, sessions)
	e.extractSessionIDsFromObject(item, targetPathPrefix, sessions)

	if len(sessions) == 0 {
		return nil
	}

	// Get or create upload tracker for this execution
	var tracker *sync.Map
	if val, ok := e.sessionUploads.Load(execID); ok {
		tracker = val.(*sync.Map)
	} else {
		tracker = &sync.Map{}
		e.sessionUploads.Store(execID, tracker)
	}

	cwd, _ := os.Getwd()

	for sid := range sessions {
		// Only upload to remote servers (SSH)
		srv, err := e.serverService.GetServer(serverID, nil)
		if err != nil || srv == nil {
			fmt.Fprintf(mainLogFile, "\033[1;33m⚠ Warning: server not found or error: %v\033[0m\n", err)
			continue
		}
		if srv.ConnectionType != domain.ConnectionTypeSSH {
			// Local or other types don't need upload via this mechanism
			fmt.Fprintf(mainLogFile, "\033[90m(Skipping upload: server %s is not SSH)\033[0m\n", srv.Name)
			continue
		}

		key := serverID.String() + "_" + sid
		if _, uploaded := tracker.Load(key); uploaded {
			continue
		}

		// Perform upload
		localDir := filepath.Join(cwd, "data", "uploads", "inputs", sid)
		remoteDir := fmt.Sprintf("/tmp/csm_inputs/%s", sid)

		uploadMsg := fmt.Sprintf("\033[34m⬆ Uploading input files to remote server: %s...\033[0m\n", sid)
		fmt.Fprint(mainLogFile, uploadMsg)
		fmt.Fprint(stepLogFile, uploadMsg)

		// Create remote directory
		_, err = e.serverService.ExecuteCommand(ctx, serverID, fmt.Sprintf("mkdir -p %s", remoteDir), nil)
		if err != nil {
			return fmt.Errorf("failed to create remote input directory: %w", err)
		}

		// List files in local directory
		entries, err := os.ReadDir(localDir)
		if err != nil {
			// If directory doesn't exist, maybe it was already cleaned up or never created
			fmt.Fprintf(mainLogFile, "\033[1;33m⚠ Warning: local input directory not found: %s\033[0m\n", localDir)
			continue
		}

		for _, entry := range entries {
			localEntryPath := filepath.Join(localDir, entry.Name())
			remoteEntryPath := filepath.Join(remoteDir, entry.Name())

			if entry.IsDir() {
				// Folder input (allow_folder): upload the whole tree, structure preserved.
				if err = e.uploadDirToServer(ctx, serverID, localEntryPath, remoteEntryPath); err != nil {
					return fmt.Errorf("failed to upload input folder %s: %w", entry.Name(), err)
				}
				continue
			}

			err = e.serverService.UploadFileToServers(ctx, []uuid.UUID{serverID}, localEntryPath, remoteEntryPath, nil)
			if err != nil {
				return fmt.Errorf("failed to upload input file %s: %w", entry.Name(), err)
			}
		}

		tracker.Store(key, true)
		successMsg := fmt.Sprintf("\033[32m✔ Input files uploaded for session %s\033[0m\n", sid)
		fmt.Fprint(mainLogFile, successMsg)
		fmt.Fprint(stepLogFile, successMsg)
	}

	return nil
}

// uploadDirToServer recursively uploads a local directory to a remote server,
// preserving the directory tree. It reuses the existing per-file transfer and
// command primitives (which already create parent dirs on upload), and only
// issues an explicit mkdir for directories so empty folders are preserved too.
func (e *WorkflowExecutor) uploadDirToServer(ctx context.Context, serverID uuid.UUID, localDir, remoteDir string) error {
	return filepath.Walk(localDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(localDir, path)
		if err != nil {
			return err
		}
		remotePath := filepath.Join(remoteDir, rel)

		if info.IsDir() {
			_, err := e.serverService.ExecuteCommand(ctx, serverID, fmt.Sprintf("mkdir -p %s", strconv.Quote(remotePath)), nil)
			return err
		}
		return e.serverService.UploadFileToServers(ctx, []uuid.UUID{serverID}, path, remotePath, nil)
	})
}

func (e *WorkflowExecutor) extractSessionIDsFromObject(obj interface{}, prefix string, sessions map[string]bool) {
	if obj == nil {
		return
	}

	switch v := obj.(type) {
	case string:
		if strings.Contains(v, prefix) {
			sid := e.extractSessionID(v)
			if sid != "" {
				sessions[sid] = true
			}
		}
	case map[string]string:
		for _, val := range v {
			if strings.Contains(val, prefix) {
				sid := e.extractSessionID(val)
				if sid != "" {
					sessions[sid] = true
				}
			}
		}
	case []domain.WorkflowVariable:
		for _, varItem := range v {
			if strings.Contains(varItem.Key, prefix) || strings.Contains(varItem.Value, prefix) {
				sid := e.extractSessionID(varItem.Value)
				if sid == "" {
					sid = e.extractSessionID(varItem.Key)
				}
				if sid != "" {
					sessions[sid] = true
				}
			}
		}
	case map[string]interface{}:
		for _, val := range v {
			e.extractSessionIDsFromObject(val, prefix, sessions)
		}
	case []interface{}:
		for _, val := range v {
			e.extractSessionIDsFromObject(val, prefix, sessions)
		}
	}
}
