package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/user/csm-backend/internal/domain"
	"github.com/user/csm-backend/internal/handler"
	"github.com/user/csm-backend/internal/middleware"
	"github.com/user/csm-backend/internal/repository"
	"github.com/user/csm-backend/internal/service"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	// Environment variables are now loaded in the crypto package init

	// Database connection string from environment variables
	dbHost := os.Getenv("DB_HOST")
	dbUser := os.Getenv("DB_USER")
	dbPassword := os.Getenv("DB_PASSWORD")
	dbName := os.Getenv("DB_NAME")
	dbPort := os.Getenv("DB_PORT")
	dbSSLMode := os.Getenv("DB_SSLMODE")
	dbTimeZone := os.Getenv("DB_TIMEZONE")

	dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=%s TimeZone=%s",
		dbHost, dbUser, dbPassword, dbName, dbPort, dbSSLMode, dbTimeZone)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		DisableForeignKeyConstraintWhenMigrating: false,
	})
	if err != nil {
		log.Fatalf("Failed to connect to database (DSN: host=%s user=%s dbname=%s port=%s): %v", dbHost, dbUser, dbName, dbPort, err)
	}

	// Optimize connection pooling
	sqlDB, err := db.DB()
	if err == nil {
		sqlDB.SetMaxIdleConns(10)
		sqlDB.SetMaxOpenConns(100)
		sqlDB.SetConnMaxLifetime(time.Hour)
	}

	// Auto-migration

	if err := db.AutoMigrate(
		&domain.Namespace{},
		&domain.User{},
		&domain.Role{},
		&domain.DomainRoleMapping{},
		&domain.Permission{},
		&domain.RolePermission{},
		&domain.Server{},

		&domain.Workflow{},
		&domain.WorkflowGroup{},
		&domain.WorkflowStep{},
		&domain.WorkflowInput{},
		&domain.WorkflowVariable{},
		&domain.WorkflowOutput{},
		&domain.WorkflowExecution{},
		&domain.WorkflowExecutionStep{},
		&domain.GlobalVariable{},
		&domain.Dataset{},
		&domain.DatasetRecord{},
		&domain.Schedule{},
		&domain.ScheduleWorkflow{},
		&domain.Tag{},
		&domain.WorkflowFile{},
		&domain.WorkflowHook{},
		&domain.VpnConfig{},
		&domain.Page{},
		&domain.PageWorkflow{},
		&domain.APIKey{},
		&domain.SystemSetting{},
		&domain.AuditLog{},
	); err != nil {
		log.Fatal("Failed to migrate database:", err)
	}

	// Initialize Repositories
	namespaceRepo := repository.NewPostgresNamespaceRepo(db)
	userRepo := repository.NewPostgresUserRepo(db)
	roleRepo := repository.NewPostgresRoleRepo(db)
	domainRoleMappingRepo := repository.NewPostgresDomainRoleMappingRepo(db)
	permRepo := repository.NewPostgresPermissionRepo(db)
	serverRepo := repository.NewPostgresServerRepo(db)
	workflowRepo := repository.NewPostgresWorkflowRepo(db)
	workflowGroupRepo := repository.NewPostgresWorkflowGroupRepo(db)
	workflowStepRepo := repository.NewPostgresWorkflowStepRepo(db)
	workflowInputRepo := repository.NewPostgresWorkflowInputRepo(db)
	workflowVariableRepo := repository.NewPostgresWorkflowVariableRepo(db)
	execRepo := repository.NewPostgresWorkflowExecutionRepo(db)
	globalVarRepo := repository.NewPostgresGlobalVariableRepo(db)
	datasetRepo := repository.NewPostgresDatasetRepo(db)
	scheduleRepo := repository.NewPostgresScheduleRepo(db)
	tagRepo := repository.NewPostgresTagRepo(db)
	workflowFileRepo := repository.NewPostgresWorkflowFileRepo(db)
	vpnRepo := repository.NewPostgresVpnConfigRepo(db)
	pageRepo := repository.NewPostgresPageRepo(db)
	apiKeyRepo := repository.NewPostgresAPIKeyRepo(db)
	settingRepo := repository.NewPostgresSystemSettingRepo(db)
	auditLogRepo := repository.NewPostgresAuditLogRepo(db)

	// Seed Admin User and Default Namespace
	seedAdmin(db)
	seedDefaultNamespace(db)
	seedLocalServer(db)
	seedSystemSettings(db)
	migrateAssignDefaultNamespace(db)
	migrateFlagBootstrapSuperadmin(db)

	// Initialize Hub
	hub := service.NewHub()
	go hub.Run()

	// Initialize Services
	sshPool := service.NewSSHPool()
	vpnConnector := service.NewVpnConnector()
	auditLogService := service.NewAuditLogService(auditLogRepo)
	authService := service.NewAuthService(userRepo, settingRepo, domainRoleMappingRepo)
	serverService := service.NewServerService(serverRepo, hub, vpnConnector, sshPool)
	terminalService := service.NewTerminalService(serverRepo, hub, vpnConnector, sshPool)
	workflowService := service.NewWorkflowService(workflowRepo, workflowGroupRepo, workflowStepRepo, workflowInputRepo, workflowVariableRepo, execRepo)
	globalVarService := service.NewGlobalVariableService(globalVarRepo)
	datasetService := service.NewDatasetService(datasetRepo)
	workflowExecutor := service.NewWorkflowExecutor(workflowRepo, workflowGroupRepo, workflowStepRepo, workflowInputRepo, execRepo, serverService, hub, globalVarRepo, datasetRepo)
	scheduleService := service.NewScheduleService(scheduleRepo, execRepo, workflowExecutor)
	tagService := service.NewTagService(tagRepo)
	vpnService := service.NewVpnConfigService(vpnRepo)
	pageService := service.NewPageService(pageRepo)
	settingsService := service.NewSettingsService(settingRepo)
	googleAuthService := service.NewGoogleAuthService(userRepo, domainRoleMappingRepo, settingsService, authService)
	dashboardService := service.NewDashboardService(workflowRepo, execRepo, scheduleRepo, serverRepo, vpnRepo, userRepo)

	mcpService := service.NewMCPService(workflowService, workflowExecutor, scheduleService, tagService)

	// Initialize scheduling engine
	scheduleService.Init()

	// Cleanup zombie executions from previous crashes/restarts
	if err := workflowService.CleanupZombieExecutions(); err != nil {
		log.Printf("[Main] Failed to cleanup zombie executions: %v", err)
	}

	// Start log retention cleanup (execution + audit logs). No-op unless the
	// corresponding retention-days settings are configured to a positive value.
	service.NewRetentionService(settingsService, execRepo, auditLogService).Start()

	// Initialize Handlers
	namespaceHandler := handler.NewNamespaceHandler(namespaceRepo, auditLogService)
	authHandler := handler.NewAuthHandler(authService, googleAuthService, auditLogService)
	domainRoleMappingHandler := handler.NewDomainRoleMappingHandler(domainRoleMappingRepo, roleRepo, auditLogService)
	userHandler := handler.NewUserHandler(userRepo, roleRepo, apiKeyRepo, domainRoleMappingRepo, auditLogService)
	roleHandler := handler.NewRoleHandler(roleRepo, permRepo, auditLogService)
	permHandler := handler.NewPermissionHandler(permRepo, workflowRepo, globalVarRepo, scheduleRepo, pageRepo, tagRepo, serverRepo, namespaceRepo, execRepo, userRepo, roleRepo, vpnRepo, datasetRepo, auditLogService)
	serverHandler := handler.NewServerHandler(serverService, terminalService, auditLogService)
	wsHandler := handler.NewWSHandler(hub, terminalService, authService, pageService, workflowService)
	workflowHandler := handler.NewWorkflowHandler(workflowService, workflowExecutor, serverService, auditLogService)
	globalVarHandler := handler.NewGlobalVariableHandler(globalVarService, auditLogService)
	datasetHandler := handler.NewDatasetHandler(datasetService, auditLogService)
	scheduleHandler := handler.NewScheduleHandler(scheduleService, auditLogService)
	tagHandler := handler.NewTagHandler(tagService, auditLogService)
	workflowFileService := service.NewWorkflowFileService(workflowFileRepo)
	workflowFileHandler := handler.NewWorkflowFileHandler(workflowFileService, auditLogService)
	vpnHandler := handler.NewVpnConfigHandler(vpnService, auditLogService)
	pageHandler := handler.NewPageHandler(pageService, workflowService, workflowExecutor, terminalService, datasetService, scheduleService, auditLogService)
	settingsHandler := handler.NewSettingsHandler(settingsService, auditLogService)
	auditLogHandler := handler.NewAuditLogHandler(auditLogService)
	dashboardHandler := handler.NewDashboardHandler(dashboardService)
	mcpHandler := handler.NewMCPHandler(mcpService)

	// Initialize Router
	r := gin.Default()

	// CORS Middleware
	r.Use(func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		allowedOrigin := os.Getenv("ALLOWED_ORIGIN")
		if allowedOrigin == "" {
			allowedOrigin = "http://localhost:5173" // Default for local dev
		}

		if origin == allowedOrigin {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
		}

		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, X-Page-Password, X-Page-Token, X-API-Key")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	api := r.Group("/api")
	{
		api.POST("/login", middleware.LoginRateLimiter(), authHandler.Login)
		api.POST("/register", middleware.LoginRateLimiter(), authHandler.Register)
		api.POST("/auth/google", middleware.LoginRateLimiter(), authHandler.GoogleLogin)
		api.POST("/logout", authHandler.Logout)
		api.GET("/ws", wsHandler.HandleWS)

		// Public Settings (e.g. for registration status)
		api.GET("/settings/public", settingsHandler.GetPublicSettings)
		api.GET("/settings/logo", settingsHandler.GetSiteLogo)

		// Protected routes
		protected := api.Group("")
		protected.Use(middleware.AuthMiddleware(authService, userRepo, apiKeyRepo))
		{
			// Namespaces
			protected.GET("/namespaces", middleware.RBACMiddleware(db, userRepo, "namespaces", "READ"), namespaceHandler.ListNamespaces)
			protected.POST("/namespaces", middleware.RBACMiddleware(db, userRepo, "namespaces", "WRITE"), namespaceHandler.CreateNamespace)
			protected.PUT("/namespaces/:id", middleware.RBACMiddleware(db, userRepo, "namespaces", "WRITE"), namespaceHandler.UpdateNamespace)
			protected.DELETE("/namespaces/:id", middleware.RBACMiddleware(db, userRepo, "namespaces", "DELETE"), namespaceHandler.DeleteNamespace)

			// User & Role Management
			protected.GET("/me", userHandler.GetMe)
			protected.PUT("/me/profile", userHandler.UpdateProfile)
			protected.PUT("/me/password", userHandler.UpdatePassword)
			protected.GET("/me/api-keys", userHandler.ListAPIKeys)
			protected.POST("/me/api-keys", userHandler.GenerateAPIKey)
			protected.DELETE("/me/api-keys/:id", userHandler.DeleteAPIKey)
			protected.GET("/users", middleware.RBACMiddleware(db, userRepo, "users", "READ"), userHandler.ListUsers)
			protected.POST("/users", middleware.RBACMiddleware(db, userRepo, "users", "WRITE"), userHandler.CreateUser)
			protected.PUT("/users/:id", middleware.RBACMiddleware(db, userRepo, "users", "WRITE"), userHandler.UpdateUser)
			protected.DELETE("/users/:id", middleware.RBACMiddleware(db, userRepo, "users", "DELETE"), userHandler.DeleteUser)
			protected.POST("/users/:id/roles", middleware.RBACMiddleware(db, userRepo, "users", "WRITE"), userHandler.UpdateUserRoles)
			protected.PUT("/users/:id/password", middleware.RBACMiddleware(db, userRepo, "users", "WRITE"), userHandler.ResetPassword)
			protected.GET("/roles", middleware.RBACMiddleware(db, userRepo, "roles", "READ"), roleHandler.ListRoles)
			protected.POST("/roles", middleware.RBACMiddleware(db, userRepo, "roles", "WRITE"), roleHandler.CreateRole)
			protected.PUT("/roles/:id", middleware.RBACMiddleware(db, userRepo, "roles", "WRITE"), roleHandler.UpdateRole)
			protected.DELETE("/roles/:id", middleware.RBACMiddleware(db, userRepo, "roles", "DELETE"), roleHandler.DeleteRole)
			protected.POST("/roles/:id/permissions", middleware.RBACMiddleware(db, userRepo, "roles", "WRITE"), roleHandler.UpdateRolePermissions)
			protected.GET("/permissions", middleware.RBACMiddleware(db, userRepo, "roles", "READ"), permHandler.ListPermissions)
			protected.GET("/permissions/resource-items", middleware.RBACMiddleware(db, userRepo, "roles", "READ"), permHandler.ListResourceItems)
			protected.DELETE("/permissions/:id", middleware.RBACMiddleware(db, userRepo, "roles", "DELETE"), permHandler.DeletePermission)

			protected.GET("/namespaces/:ns_id/servers", middleware.RBACMiddleware(db, userRepo, "servers", "READ"), serverHandler.ListServers)
			protected.POST("/namespaces/:ns_id/servers", middleware.RBACMiddleware(db, userRepo, "servers", "WRITE"), serverHandler.CreateServer)
			protected.PUT("/servers/:id", middleware.RBACMiddleware(db, userRepo, "servers", "WRITE"), serverHandler.UpdateServer)
			protected.DELETE("/servers/:id", middleware.RBACMiddleware(db, userRepo, "servers", "DELETE"), serverHandler.DeleteServer)
			protected.POST("/servers/:id/execute", middleware.RBACMiddleware(db, userRepo, "servers", "EXECUTE"), serverHandler.ExecuteCommand)
			// Deprecated: use /api/workflows/:id/test-http
			// protected.POST("/servers/:id/test-http", middleware.RBACMiddleware(db, userRepo, "servers", "EXECUTE"), serverHandler.TestHttp)
			protected.POST("/servers/:id/terminal", middleware.RBACMiddleware(db, userRepo, "servers", "EXECUTE"), serverHandler.StartTerminalSession)
			protected.GET("/servers/:id/metrics", middleware.RBACMiddleware(db, userRepo, "servers", "READ"), serverHandler.GetServerMetrics)

			protected.GET("/namespaces/:ns_id/workflows", middleware.RBACMiddleware(db, userRepo, "workflows", "READ"), workflowHandler.ListWorkflows)
			protected.POST("/namespaces/:ns_id/workflows", middleware.RBACMiddleware(db, userRepo, "workflows", "WRITE"), workflowHandler.CreateWorkflow)
			protected.POST("/namespaces/:ns_id/workflows/import", middleware.RBACMiddleware(db, userRepo, "workflows", "WRITE"), workflowHandler.ImportWorkflow)
			protected.GET("/namespaces/:ns_id/analytics/executions", middleware.RBACMiddleware(db, userRepo, "workflows", "READ"), workflowHandler.GetExecutionAnalytics)
			protected.GET("/namespaces/:ns_id/executions", middleware.RBACMiddleware(db, userRepo, "history", "READ"), workflowHandler.ListAllExecutions)
			protected.GET("/namespaces/:ns_id/dashboard-stats", middleware.RBACMiddleware(db, userRepo, "dashboard", "READ"), dashboardHandler.GetStats)

			protected.GET("/workflows/:id", middleware.RBACMiddleware(db, userRepo, "workflows", "READ"), workflowHandler.GetWorkflow)
			protected.PUT("/workflows/:id", middleware.RBACMiddleware(db, userRepo, "workflows", "WRITE"), workflowHandler.UpdateWorkflow)
			protected.PUT("/workflows/:id/import", middleware.RBACMiddleware(db, userRepo, "workflows", "WRITE"), workflowHandler.ImportUpdateWorkflow)
			protected.POST("/workflows/:id/test-http", middleware.RBACMiddleware(db, userRepo, "workflows", "WRITE"), middleware.RBACMiddleware(db, userRepo, "workflows", "EXECUTE"), workflowHandler.TestHttp)
			protected.POST("/workflows/upload-input", middleware.RBACMiddleware(db, userRepo, "workflows", "EXECUTE"), workflowHandler.UploadInputFile)
			protected.POST("/workflows/:id/run", middleware.RBACMiddleware(db, userRepo, "workflows", "EXECUTE"), workflowHandler.RunWorkflow)
			protected.POST("/workflows/:id/clone", middleware.RBACMiddleware(db, userRepo, "workflows", "WRITE"), workflowHandler.CloneWorkflow)
			protected.DELETE("/workflows/:id", middleware.RBACMiddleware(db, userRepo, "workflows", "DELETE"), workflowHandler.DeleteWorkflow)
			protected.POST("/workflow-groups", middleware.RBACMiddleware(db, userRepo, "workflows", "WRITE"), workflowHandler.CreateGroup)
			protected.POST("/workflow-steps", middleware.RBACMiddleware(db, userRepo, "workflows", "WRITE"), workflowHandler.CreateStep)

			protected.GET("/workflows/:id/files", middleware.RBACMiddleware(db, userRepo, "workflows", "READ"), workflowFileHandler.List)
			protected.POST("/workflows/:id/files", middleware.RBACMiddleware(db, userRepo, "workflows", "WRITE"), workflowFileHandler.Upload)
			protected.PUT("/workflow-files/:file_id/target-path", middleware.RBACMiddleware(db, userRepo, "workflows", "WRITE"), workflowFileHandler.UpdateTargetPath)
			protected.PUT("/workflow-files/:file_id/substitution", middleware.RBACMiddleware(db, userRepo, "workflows", "WRITE"), workflowFileHandler.UpdateSubstitution)
			protected.DELETE("/workflow-files/:file_id", middleware.RBACMiddleware(db, userRepo, "workflows", "DELETE"), workflowFileHandler.Delete)
			protected.GET("/workflow-files/:file_id/download", middleware.RBACMiddleware(db, userRepo, "workflows", "READ"), workflowFileHandler.Download)

			protected.GET("/workflows/:id/executions", middleware.RBACMiddleware(db, userRepo, "workflows", "READ"), workflowHandler.ListExecutions)
			protected.GET("/workflows/:id/latest-result", middleware.RBACMiddleware(db, userRepo, "workflows", "READ"), workflowHandler.GetLatestResult)
			protected.GET("/executions/:exec_id", middleware.RBACMiddleware(db, userRepo, "workflows", "READ"), workflowHandler.GetExecution)
			protected.POST("/executions/:exec_id/stop", middleware.RBACMiddleware(db, userRepo, "workflows", "EXECUTE"), workflowHandler.StopExecution)
			protected.GET("/executions/:exec_id/logs", middleware.RBACMiddleware(db, userRepo, "workflows", "READ"), workflowHandler.GetExecutionLogs)

			// Global Variables
			protected.GET("/namespaces/:ns_id/global-variables", middleware.RBACMiddleware(db, userRepo, "variables", "READ"), globalVarHandler.List)
			protected.POST("/namespaces/:ns_id/global-variables", middleware.RBACMiddleware(db, userRepo, "variables", "WRITE"), globalVarHandler.Create)
			protected.PUT("/global-variables/:id", middleware.RBACMiddleware(db, userRepo, "variables", "WRITE"), globalVarHandler.Update)
			protected.DELETE("/global-variables/:id", middleware.RBACMiddleware(db, userRepo, "variables", "DELETE"), globalVarHandler.Delete)

			// Datasets
			protected.GET("/namespaces/:ns_id/datasets", middleware.RBACMiddleware(db, userRepo, "datasets", "READ"), datasetHandler.List)
			protected.POST("/namespaces/:ns_id/datasets", middleware.RBACMiddleware(db, userRepo, "datasets", "WRITE"), datasetHandler.Create)
			protected.GET("/datasets/:id", middleware.RBACMiddleware(db, userRepo, "datasets", "READ"), datasetHandler.Get)
			protected.PUT("/datasets/:id", middleware.RBACMiddleware(db, userRepo, "datasets", "WRITE"), datasetHandler.Update)
			protected.DELETE("/datasets/:id", middleware.RBACMiddleware(db, userRepo, "datasets", "DELETE"), datasetHandler.Delete)
			protected.GET("/datasets/:id/records", middleware.RBACMiddleware(db, userRepo, "datasets", "READ"), datasetHandler.ListRecords)
			protected.POST("/datasets/:id/aggregate", middleware.RBACMiddleware(db, userRepo, "datasets", "READ"), datasetHandler.Aggregate)
			protected.POST("/datasets/:id/records", middleware.RBACMiddleware(db, userRepo, "datasets", "WRITE"), datasetHandler.CreateRecord)
			protected.PUT("/dataset-records/:id", middleware.RBACMiddleware(db, userRepo, "datasets", "WRITE"), datasetHandler.UpdateRecord)
			protected.DELETE("/dataset-records/:id", middleware.RBACMiddleware(db, userRepo, "datasets", "DELETE"), datasetHandler.DeleteRecord)

			// Schedules
			protected.GET("/namespaces/:ns_id/schedules", middleware.RBACMiddleware(db, userRepo, "schedules", "READ"), scheduleHandler.List)
			protected.POST("/namespaces/:ns_id/schedules", middleware.RBACMiddleware(db, userRepo, "schedules", "WRITE"), scheduleHandler.Create)
			protected.GET("/schedules/:id", middleware.RBACMiddleware(db, userRepo, "schedules", "READ"), scheduleHandler.GetByID)
			protected.GET("/schedules/:id/executions", middleware.RBACMiddleware(db, userRepo, "schedules", "READ"), scheduleHandler.GetExecutions)
			protected.PUT("/schedules/:id", middleware.RBACMiddleware(db, userRepo, "schedules", "WRITE"), scheduleHandler.Update)
			protected.DELETE("/schedules/:id", middleware.RBACMiddleware(db, userRepo, "schedules", "DELETE"), scheduleHandler.Delete)
			protected.POST("/schedules/:id/toggle", middleware.RBACMiddleware(db, userRepo, "schedules", "WRITE"), scheduleHandler.ToggleStatus)

			// Tags
			protected.GET("/namespaces/:ns_id/tags", middleware.RBACMiddleware(db, userRepo, "tags", "READ"), tagHandler.List)
			protected.POST("/namespaces/:ns_id/tags", middleware.RBACMiddleware(db, userRepo, "tags", "WRITE"), tagHandler.Create)
			protected.PUT("/tags/:id", middleware.RBACMiddleware(db, userRepo, "tags", "WRITE"), tagHandler.Update)
			protected.DELETE("/tags/:id", middleware.RBACMiddleware(db, userRepo, "tags", "DELETE"), tagHandler.Delete)

			// VPNs
			protected.GET("/namespaces/:ns_id/vpns", middleware.RBACMiddleware(db, userRepo, "vpns", "READ"), vpnHandler.List)
			protected.POST("/namespaces/:ns_id/vpns", middleware.RBACMiddleware(db, userRepo, "vpns", "WRITE"), vpnHandler.Create)
			protected.PUT("/vpns/:id", middleware.RBACMiddleware(db, userRepo, "vpns", "WRITE"), vpnHandler.Update)
			protected.DELETE("/vpns/:id", middleware.RBACMiddleware(db, userRepo, "vpns", "DELETE"), vpnHandler.Delete)

			// Pages
			protected.GET("/namespaces/:ns_id/pages", middleware.RBACMiddleware(db, userRepo, "pages", "READ"), pageHandler.ListPages)
			protected.POST("/namespaces/:ns_id/pages", middleware.RBACMiddleware(db, userRepo, "pages", "WRITE"), pageHandler.CreatePage)
			protected.GET("/pages/:id", middleware.RBACMiddleware(db, userRepo, "pages", "READ"), pageHandler.GetPage)
			protected.PUT("/pages/:id", middleware.RBACMiddleware(db, userRepo, "pages", "WRITE"), pageHandler.UpdatePage)
			protected.DELETE("/pages/:id", middleware.RBACMiddleware(db, userRepo, "pages", "DELETE"), pageHandler.DeletePage)

			// System Settings
			protected.GET("/settings", middleware.RBACMiddleware(db, userRepo, "settings", "READ"), settingsHandler.GetSettings)
			protected.PUT("/settings", middleware.RBACMiddleware(db, userRepo, "settings", "WRITE"), settingsHandler.UpdateSetting)

			// Google domain -> role mappings (guarded by the settings permission)
			protected.GET("/domain-role-mappings", middleware.RBACMiddleware(db, userRepo, "settings", "READ"), domainRoleMappingHandler.List)
			protected.POST("/domain-role-mappings", middleware.RBACMiddleware(db, userRepo, "settings", "WRITE"), domainRoleMappingHandler.Create)
			protected.PUT("/domain-role-mappings/:id", middleware.RBACMiddleware(db, userRepo, "settings", "WRITE"), domainRoleMappingHandler.Update)
			protected.DELETE("/domain-role-mappings/:id", middleware.RBACMiddleware(db, userRepo, "settings", "WRITE"), domainRoleMappingHandler.Delete)

			// Audit Logs
			protected.GET("/audit-logs", middleware.RBACMiddleware(db, userRepo, "audit_logs", "READ"), auditLogHandler.ListAuditLogs)
			protected.GET("/audit-logs/resource/:type/:id", middleware.RBACMiddleware(db, userRepo, "audit_logs", "READ"), auditLogHandler.ListResourceLogs)
		}

		mcpRoutes := api.Group("/mcp", middleware.AuthMiddleware(authService, userRepo, apiKeyRepo), func(c *gin.Context) {
			if isMCP, exists := c.Get("api_key_is_mcp"); !exists || !isMCP.(bool) {
				c.JSON(http.StatusForbidden, gin.H{"error": "API Key is not authorized for MCP. Please enable MCP for this key in the settings."})
				c.Abort()
				return
			}
			c.Next()
		})
		{
			mcpRoutes.Any("", mcpHandler.HandleMCP)
		}

		// Public Page access (optional auth for private pages)
		optionalAuth := middleware.OptionalAuthMiddleware(authService, userRepo, apiKeyRepo)
		api.GET("/public/pages/:slug", optionalAuth, pageHandler.GetPublicPage)
		api.POST("/public/pages/:slug/verify", middleware.LoginRateLimiter(), optionalAuth, pageHandler.VerifyPublicPage)
		api.POST("/public/pages/:slug/run/:workflow_id", middleware.LoginRateLimiter(), optionalAuth, pageHandler.RunPublicWorkflow)
		api.POST("/public/pages/:slug/executions/:exec_id/stop", middleware.LoginRateLimiter(), optionalAuth, pageHandler.StopPublicExecution)
		api.GET("/public/pages/:slug/executions/:exec_id/logs", optionalAuth, pageHandler.GetPublicExecutionLog)
		api.POST("/public/pages/:slug/execution-statuses", optionalAuth, pageHandler.GetPublicExecutionStatuses)
		api.POST("/public/pages/:slug/schedule/:workflow_id", middleware.LoginRateLimiter(), optionalAuth, pageHandler.CreatePublicSchedule)
		api.GET("/public/pages/:slug/schedules", optionalAuth, pageHandler.ListPublicSchedules)
		api.POST("/public/pages/:slug/schedules/:schedule_id/cancel", middleware.LoginRateLimiter(), optionalAuth, pageHandler.CancelPublicSchedule)
		api.POST("/public/pages/:slug/upload-input", middleware.LoginRateLimiter(), optionalAuth, pageHandler.UploadPublicInputFile)
		api.POST("/public/pages/:slug/datasets/:id/aggregate", optionalAuth, pageHandler.AggregatePublicDataset)
		api.GET("/public/pages/:slug/datasets/:id/records", optionalAuth, pageHandler.ListPublicDatasetRecords)
	}

	// Serve static files from Vite build output
	r.Static("/assets", "./frontend/dist/assets")
	r.StaticFile("/favicon.ico", "./frontend/dist/favicon.ico")
	r.StaticFile("/", "./frontend/dist/index.html")

	// Fallback for SPA routing - serve index.html for any route not starting with /api or /assets
	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		// If the request is for an API or assets, return 404
		// Otherwise, serve the frontend app's index.html for SPA support
		if !strings.HasPrefix(path, "/api") && !strings.HasPrefix(path, "/assets") {
			c.File("./frontend/dist/index.html")
		}
	})

	serverPort := os.Getenv("SERVER_PORT")
	if serverPort == "" {
		serverPort = "8080"
	}

	log.Printf("Server starting on :%s", serverPort)
	// Debug: Print all registered routes
	log.Println("Registered Routes:")
	for _, route := range r.Routes() {
		log.Printf("Route: %s %s", route.Method, route.Path)
	}

	if err := r.Run(":" + serverPort); err != nil {
		log.Fatal(err)
	}
}

func seedAdmin(db *gorm.DB) {
	log.Println("Ensuring system permissions...")

	// Default permissions definitions
	permDefs := []struct {
		Name   string
		Type   string
		Action string
	}{
		// Operational (Namespace-scoped)
		{Name: "View Dashboard", Type: "dashboard", Action: "READ"},

		{Name: "Read Workflows", Type: "workflows", Action: "READ"},
		{Name: "Manage Workflows", Type: "workflows", Action: "WRITE"},
		{Name: "Execute Workflows", Type: "workflows", Action: "EXECUTE"},
		{Name: "Delete Workflows", Type: "workflows", Action: "DELETE"},

		{Name: "Read History", Type: "history", Action: "READ"},

		{Name: "Read Variables", Type: "variables", Action: "READ"},
		{Name: "Manage Variables", Type: "variables", Action: "WRITE"},
		{Name: "Delete Variables", Type: "variables", Action: "DELETE"},

		{Name: "Read Datasets", Type: "datasets", Action: "READ"},
		{Name: "Manage Datasets", Type: "datasets", Action: "WRITE"},
		{Name: "Delete Datasets", Type: "datasets", Action: "DELETE"},

		{Name: "Read Tags", Type: "tags", Action: "READ"},
		{Name: "Manage Tags", Type: "tags", Action: "WRITE"},
		{Name: "Delete Tags", Type: "tags", Action: "DELETE"},
		{Name: "Read Resources in Tag", Type: "tags", Action: "RESOURCE_READ"},
		{Name: "Write Resources in Tag", Type: "tags", Action: "RESOURCE_WRITE"},
		{Name: "Execute Resources in Tag", Type: "tags", Action: "RESOURCE_EXECUTE"},
		{Name: "Delete Resources in Tag", Type: "tags", Action: "RESOURCE_DELETE"},

		{Name: "Read Schedules", Type: "schedules", Action: "READ"},
		{Name: "Manage Schedules", Type: "schedules", Action: "WRITE"},
		{Name: "Execute Schedules", Type: "schedules", Action: "EXECUTE"},
		{Name: "Delete Schedules", Type: "schedules", Action: "DELETE"},

		{Name: "Read Pages", Type: "pages", Action: "READ"},
		{Name: "Manage Pages", Type: "pages", Action: "WRITE"},
		{Name: "Execute Pages", Type: "pages", Action: "EXECUTE"},
		{Name: "Delete Pages", Type: "pages", Action: "DELETE"},

		// Global
		{Name: "Read Servers", Type: "servers", Action: "READ"},
		{Name: "Manage Servers", Type: "servers", Action: "WRITE"},
		{Name: "Execute Commands on Servers", Type: "servers", Action: "EXECUTE"},
		{Name: "Delete Servers", Type: "servers", Action: "DELETE"},

		{Name: "Read VPNs", Type: "vpns", Action: "READ"},
		{Name: "Manage VPNs", Type: "vpns", Action: "WRITE"},
		{Name: "Delete VPNs", Type: "vpns", Action: "DELETE"},

		// Identity
		{Name: "Read Users", Type: "users", Action: "READ"},
		{Name: "Manage Users", Type: "users", Action: "WRITE"},
		{Name: "Delete Users", Type: "users", Action: "DELETE"},

		{Name: "Read Roles", Type: "roles", Action: "READ"},
		{Name: "Manage Roles", Type: "roles", Action: "WRITE"},
		{Name: "Delete Roles", Type: "roles", Action: "DELETE"},

		// System
		{Name: "Read Settings", Type: "settings", Action: "READ"},
		{Name: "Manage Settings", Type: "settings", Action: "WRITE"},

		{Name: "Read Namespaces", Type: "namespaces", Action: "READ"},
		{Name: "Manage Namespaces", Type: "namespaces", Action: "WRITE"},
		{Name: "Delete Namespaces", Type: "namespaces", Action: "DELETE"},
		{Name: "Read Resources in Namespace", Type: "namespaces", Action: "RESOURCE_READ"},
		{Name: "Write Resources in Namespace", Type: "namespaces", Action: "RESOURCE_WRITE"},
		{Name: "Execute Resources in Namespace", Type: "namespaces", Action: "RESOURCE_EXECUTE"},
		{Name: "Delete Resources in Namespace", Type: "namespaces", Action: "RESOURCE_DELETE"},

		{Name: "Read Audit Logs", Type: "audit_logs", Action: "READ"},
	}

	var perms []domain.Permission
	for _, def := range permDefs {
		var p domain.Permission
		// Use Limit(1).Find to avoid scary "record not found" logs during seeding
		err := db.Where("name = ?", def.Name).Limit(1).Find(&p).Error
		if err != nil {
			log.Printf("Error checking permission %s: %v", def.Name, err)
			continue
		}

		if p.ID == uuid.Nil {
			p = domain.Permission{
				ID:     uuid.New(),
				Name:   def.Name,
				Type:   def.Type,
				Action: def.Action,
			}
			if err := db.Create(&p).Error; err != nil {
				log.Printf("Failed to create permission %s: %v", def.Name, err)
				continue
			}
		} else {
			// Update existing permission type/action just in case
			p.Type = def.Type
			p.Action = def.Action
			db.Save(&p)
		}
		perms = append(perms, p)
	}

	var adminRole domain.Role
	err := db.Where("name = ?", "admin").Limit(1).Find(&adminRole).Error
	if err == nil && adminRole.ID == uuid.Nil {
		adminRole = domain.Role{
			ID:          uuid.New(),
			Name:        "admin",
			Description: "Full access role",
		}
		db.Create(&adminRole)
	}

	// Update admin role permissions
	// Use a clean slate for admin role permissions to ensure it always has all seeded perms
	db.Exec("DELETE FROM role_permissions WHERE role_id = ?", adminRole.ID)
	for _, p := range perms {
		rp := domain.RolePermission{
			ID:           uuid.New(),
			RoleID:       adminRole.ID,
			PermissionID: p.ID,
			ResourceID:   nil,
		}
		db.Create(&rp)
	}

	var adminUser domain.User
	err = db.Where("username = ?", "admin").Limit(1).Find(&adminUser).Error
	if err == nil && adminUser.ID == uuid.Nil {
		log.Println("Seeding admin user...")
		adminPassword := os.Getenv("ADMIN_PASSWORD")
		if adminPassword == "" {
			adminPassword = "admin"
		}
		hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(adminPassword), bcrypt.DefaultCost)
		adminUser = domain.User{
			ID:           uuid.New(),
			Username:     "admin",
			PasswordHash: string(hashedPassword),
			Email:        "admin@example.com",
			IsSuperAdmin: true,
			Roles:        []domain.Role{adminRole},
		}
		if err := db.Create(&adminUser).Error; err != nil {
			log.Println("Failed to seed admin user:", err)
		} else {
			log.Println("Admin user seeded successfully (admin/admin)")
		}
	} else if err == nil {
		// Ensure admin user has admin role
		db.Model(&adminUser).Association("Roles").Append(&adminRole)
	}
}

func seedDefaultNamespace(db *gorm.DB) {
	var count int64
	db.Model(&domain.Namespace{}).Where("name = ?", "Default").Count(&count)
	if count == 0 {
		log.Println("Seeding default namespace...")
		defaultNs := domain.Namespace{
			ID:          uuid.New(),
			Name:        "Default",
			Description: "The default system workspace for all operations.",
		}
		if err := db.Create(&defaultNs).Error; err != nil {
			log.Println("Failed to seed default namespace:", err)
		} else {
			log.Println("Default namespace seeded successfully.")
		}
	}
}

// getDefaultNamespaceID returns the ID of the "Default" namespace, or uuid.Nil if missing.
func getDefaultNamespaceID(db *gorm.DB) uuid.UUID {
	var ns domain.Namespace
	if err := db.Where("name = ?", "Default").Limit(1).Find(&ns).Error; err != nil {
		return uuid.Nil
	}
	return ns.ID
}

// migrateFlagBootstrapSuperadmin backfills is_super_admin onto the bootstrap administrator of
// installations created before the flag existed, where full access came from the "admin" role
// alone. Idempotent, and it only ever grants the account the seeder itself owns.
func migrateFlagBootstrapSuperadmin(db *gorm.DB) {
	res := db.Exec(
		"UPDATE users SET is_super_admin = true WHERE username = ? AND is_super_admin = false AND deleted_at IS NULL",
		"admin",
	)
	if res.Error != nil {
		log.Printf("[Migrate] flag bootstrap superadmin failed: %v", res.Error)
	} else if res.RowsAffected > 0 {
		log.Printf("[Migrate] flagged %d bootstrap superadmin account(s)", res.RowsAffected)
	}
}

// migrateAssignDefaultNamespace backfills the Default namespace onto pre-existing servers and
// VPN configs that were created before namespace scoping (namespace_id NULL or zero). Idempotent.
func migrateAssignDefaultNamespace(db *gorm.DB) {
	defID := getDefaultNamespaceID(db)
	if defID == uuid.Nil {
		return
	}
	zero := uuid.Nil.String()
	for _, table := range []string{"servers", "vpn_configs"} {
		res := db.Exec(
			"UPDATE "+table+" SET namespace_id = ? WHERE namespace_id IS NULL OR namespace_id = ?",
			defID, zero,
		)
		if res.Error != nil {
			log.Printf("[Migrate] backfill namespace on %s failed: %v", table, res.Error)
		} else if res.RowsAffected > 0 {
			log.Printf("[Migrate] assigned Default namespace to %d %s row(s)", res.RowsAffected, table)
		}
	}
}

func seedLocalServer(db *gorm.DB) {
	var localServer domain.Server
	err := db.Where("name = ?", "Local Engine Orchestrator").Limit(1).Find(&localServer).Error
	if err == nil && localServer.ID == uuid.Nil {
		log.Println("Seeding local server...")
		localServer = domain.Server{
			ID:             uuid.New(),
			NamespaceID:    getDefaultNamespaceID(db),
			Name:           "Local Engine Orchestrator",
			Description:    "The local system where the engine is running.",
			ConnectionType: domain.ConnectionTypeLocal,
			Host:           "localhost",
			Port:           0,
			User:           "system",
			AuthType:       "NONE",
		}
		if err := db.Create(&localServer).Error; err != nil {
			log.Println("Failed to seed local server:", err)
		} else {
			log.Println("Local server seeded successfully.")
		}
	} else if err == nil {
		// Ensure connection type is correct even for existing seeded server
		if localServer.ConnectionType != domain.ConnectionTypeLocal {
			localServer.ConnectionType = domain.ConnectionTypeLocal
			db.Save(&localServer)
		}
	}
}

func seedSystemSettings(db *gorm.DB) {
	// Seed allow_registration
	var count int64
	db.Model(&domain.SystemSetting{}).Where("key = ?", "allow_registration").Count(&count)
	if count == 0 {
		log.Println("Seeding system setting: allow_registration...")
		db.Create(&domain.SystemSetting{
			ID:    uuid.New(),
			Key:   "allow_registration",
			Value: "false",
		})
	}

	// Seed social auth settings
	socialSettings := []string{
		"google_auth_enabled",
		"google_client_id",
		"google_client_secret",
		"facebook_auth_enabled",
		"facebook_client_id",
		"facebook_client_secret",
	}

	for _, key := range socialSettings {
		var c int64
		db.Model(&domain.SystemSetting{}).Where("key = ?", key).Count(&c)
		if c == 0 {
			log.Printf("Seeding system setting: %s...", key)
			db.Create(&domain.SystemSetting{
				ID:    uuid.New(),
				Key:   key,
				Value: "false", // Default to false for enabled flags, and dummy for IDs
			})
			// Adjusting default value for non-enabled keys to empty string
			if key != "google_auth_enabled" && key != "facebook_auth_enabled" {
				db.Model(&domain.SystemSetting{}).Where("key = ?", key).Update("value", "")
			}
		}
	}

	// Seed token_expiration
	var tokenExpCount int64
	db.Model(&domain.SystemSetting{}).Where("key = ?", "token_expiration").Count(&tokenExpCount)
	if tokenExpCount == 0 {
		log.Println("Seeding system setting: token_expiration...")
		db.Create(&domain.SystemSetting{
			ID:    uuid.New(),
			Key:   "token_expiration",
			Value: "24",
		})
	}
}
