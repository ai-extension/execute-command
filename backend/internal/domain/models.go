package domain

import (
	"context"
	"io"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Status string

const (
	StatusPending   Status = "PENDING"
	StatusRunning   Status = "RUNNING"
	StatusSuccess   Status = "SUCCESS"
	StatusFailed    Status = "FAILED"
	StatusCancelled Status = "CANCELLED"
)

type Namespace struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at" gorm:"<-:create"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type SystemSetting struct {
	ID        uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	Key       string    `json:"key" gorm:"uniqueIndex;not null"`
	Value     string    `json:"value" gorm:"not null"`
	CreatedAt time.Time `json:"created_at" gorm:"<-:create"`
	UpdatedAt time.Time `json:"updated_at"`
}

type User struct {
	ID             uuid.UUID      `json:"id" gorm:"type:uuid;primaryKey"`
	Username       string         `json:"username" gorm:"uniqueIndex;not null"`
	FullName       string         `json:"full_name"`
	PasswordHash   string         `json:"-" gorm:"default:null"`
	Email          string         `json:"email"`
	SocialProvider string         `json:"social_provider"` // google, facebook, etc.
	SocialID       string         `json:"social_id"`
	AvatarURL      string         `json:"avatar_url"`
	Roles          []Role         `json:"roles" gorm:"many2many:user_roles"`
	Permissions    []Permission   `json:"permissions" gorm:"many2many:user_permissions"`
	CreatedAt      time.Time      `json:"created_at" gorm:"<-:create"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `json:"-" gorm:"index"`
}

type Role struct {
	ID          uuid.UUID        `json:"id" gorm:"type:uuid;primaryKey"`
	Name        string           `json:"name" gorm:"uniqueIndex;not null"`
	Description string           `json:"description"`
	Permissions []RolePermission `json:"permissions" gorm:"foreignKey:RoleID;constraint:OnDelete:CASCADE;"`
	CreatedAt   time.Time        `json:"created_at" gorm:"<-:create"`
	UpdatedAt   time.Time        `json:"updated_at"`
	DeletedAt   gorm.DeletedAt   `json:"-" gorm:"index"`
}

type RolePermission struct {
	ID           uuid.UUID   `json:"id" gorm:"type:uuid;primaryKey"`
	RoleID       uuid.UUID   `json:"role_id" gorm:"type:uuid;index;not null"`
	PermissionID uuid.UUID   `json:"permission_id" gorm:"type:uuid;index;not null"`
	ResourceID   *string     `json:"resource_id,omitempty"` // nullable UUID string or identifier
	Permission   *Permission `json:"permission,omitempty" gorm:"foreignKey:PermissionID;constraint:OnDelete:CASCADE;"`
}

type Permission struct {
	ID        uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	Name      string    `json:"name" gorm:"uniqueIndex;not null"`
	Type      string    `json:"type" gorm:"not null"`   // FUNCTION or RESOURCE
	Action    string    `json:"action" gorm:"not null"` // READ, WRITE, EXECUTE
	CreatedAt time.Time `json:"created_at" gorm:"<-:create"`
	UpdatedAt time.Time `json:"updated_at"`
}

type APIKey struct {
	ID        uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	UserID    uuid.UUID  `json:"user_id" gorm:"type:uuid;index;not null;constraint:OnDelete:CASCADE;"`
	Name      string     `json:"name" gorm:"not null"`
	KeyPrefix string     `json:"key_prefix" gorm:"not null"`
	KeyHash   string     `json:"-" gorm:"not null"`
	LastUsed  *time.Time `json:"last_used"`
	Scopes    string     `json:"scopes" gorm:"default:''"`
	IsMCP     bool       `json:"is_mcp" gorm:"default:false"`
	CreatedAt time.Time  `json:"created_at" gorm:"<-:create"`
}

type PermissionScope struct {
	IsGlobal            bool
	AllowedItemIDs      []string
	AllowedNamespaceIDs []string
	AllowedTagIDs       []string
}

type UserRepository interface {
	Create(user *User) error
	GetByID(id uuid.UUID) (*User, error)
	GetByUsername(username string) (*User, error)
	List() ([]User, error)
	ListPaginated(limit, offset int, searchTerm string, roleID *uuid.UUID) ([]User, int64, error)
	Update(user *User) error
	Delete(id uuid.UUID) error
	SetRoles(userID uuid.UUID, roles []Role) error
}

type RoleRepository interface {
	Create(role *Role) error
	GetByID(id uuid.UUID) (*Role, error)
	List() ([]Role, error)
	ListPaginated(limit, offset int, searchTerm string) ([]Role, int64, error)
	Update(role *Role) error
	Delete(id uuid.UUID) error
	GetByIDs(ids []uuid.UUID) ([]Role, error)
	SetPermissions(roleID uuid.UUID, rolePerms []RolePermission) error
}

type PermissionRepository interface {
	Create(perm *Permission) error
	List() ([]Permission, error)
	GetByIDs(ids []uuid.UUID) ([]Permission, error)
	Delete(id uuid.UUID) error
}

type APIKeyRepository interface {
	Create(apiKey *APIKey) error
	GetByID(id uuid.UUID) (*APIKey, error)
	GetByHash(hash string) (*APIKey, error)
	ListByUserID(userID uuid.UUID) ([]APIKey, error)
	ListByPrefix(prefix string) ([]APIKey, error)
	Delete(id uuid.UUID) error
	UpdateLastUsed(id uuid.UUID) error
}

type NamespaceRepository interface {
	Create(ns *Namespace) error
	GetByID(id uuid.UUID, scope *PermissionScope) (*Namespace, error)
	List(scope *PermissionScope) ([]Namespace, error)
	Update(ns *Namespace) error
	Delete(id uuid.UUID) error
}

type ConnectionType string

const (
	ConnectionTypeSSH   ConnectionType = "SSH"
	ConnectionTypeLocal ConnectionType = "LOCAL"
)

type ServerConnection interface {
	Execute(ctx context.Context, command string, writers ...io.Writer) (string, error)
	// ExecuteWithTTY chạy lệnh trong PTY session và hỗ trợ auto-input.
	// stdinPipe: goroutine caller có thể ghi vào đây để mô phỏng keystrokes.
	ExecuteWithTTY(ctx context.Context, command string, stdinCh <-chan string, writers ...io.Writer) (string, error)
	Upload(ctx context.Context, localPath, remotePath string) error
	Download(ctx context.Context, remotePath, localPath string) error
	StartTerminal(ctx context.Context) (io.WriteCloser, io.Reader, io.Reader, error)
	Close() error
}

type Server struct {
	ID                 uuid.UUID      `json:"id" gorm:"type:uuid;primaryKey"`
	NamespaceID        uuid.UUID      `json:"namespace_id" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	Name               string         `json:"name" gorm:"not null"`
	Description        string         `json:"description"`
	ConnectionType     ConnectionType `json:"connection_type" gorm:"not null;default:'SSH'"`
	Host               string         `json:"host" gorm:"not null"`
	Port               int            `json:"port" gorm:"default:22"`
	User               string         `json:"user" gorm:"not null"`
	AuthType           string         `json:"auth_type" gorm:"not null"` // PASSWORD, PUBLIC_KEY, or NONE
	Password           string         `json:"password,omitempty"`
	PrivateKey         string         `json:"private_key,omitempty"`
	VpnID              *uuid.UUID     `json:"vpn_id,omitempty" gorm:"type:uuid;index"`
	Vpn                *VpnConfig     `json:"vpn,omitempty" gorm:"foreignKey:VpnID;"`
	HostKeyFingerprint string         `json:"host_key_fingerprint,omitempty"` // For strict host key checking (TOFU or manual)
	CreatedBy          *uuid.UUID     `json:"created_by,omitempty" gorm:"type:uuid;<-:create"`
	CreatedByUsername  string         `json:"created_by_username,omitempty" gorm:"<-:create"`
	CreatedAt          time.Time      `json:"created_at" gorm:"<-:create"`
	UpdatedAt          time.Time      `json:"updated_at"`
	DeletedAt          gorm.DeletedAt `json:"-" gorm:"index"`
}

type ServerMetrics struct {
	CPUUsage  float64 `json:"cpu_usage"`
	RAMUsage  float64 `json:"ram_usage"`
	DiskUsage float64 `json:"disk_usage"`
	Uptime    string  `json:"uptime"`
}

type ServerRepository interface {
	Create(server *Server) error
	GetByID(id uuid.UUID, scope *PermissionScope) (*Server, error)
	List(namespaceID *uuid.UUID, scope *PermissionScope) ([]Server, error)
	ListPaginated(namespaceID *uuid.UUID, limit, offset int, searchTerm string, authType string, vpnID *uuid.UUID, createdBy *uuid.UUID, scope *PermissionScope) ([]Server, int64, error)
	Update(server *Server) error
	Delete(id uuid.UUID) error
}

type VpnConfig struct {
	ID                 uuid.UUID      `json:"id" gorm:"type:uuid;primaryKey"`
	NamespaceID        uuid.UUID      `json:"namespace_id" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	Name               string         `json:"name" gorm:"not null"`
	Description        string         `json:"description"`
	VpnType            string         `json:"vpn_type" gorm:"not null;default:'SSH'"` // SSH, OPENVPN, WIREGUARD
	Host               string         `json:"host" gorm:"not null"`
	Port               int            `json:"port" gorm:"default:22"`
	User               string         `json:"user"`
	AuthType           string         `json:"auth_type"` // PASSWORD or PUBLIC_KEY
	Password           string         `json:"password,omitempty"`
	PrivateKey         string         `json:"private_key,omitempty"`
	ConfigFile         string         `json:"config_file,omitempty"`          // For OpenVPN (.ovpn) or WireGuard (.conf)
	PublicKey          string         `json:"public_key,omitempty"`           // For WireGuard
	SharedKey          string         `json:"shared_key,omitempty"`           // For WireGuard
	HostKeyFingerprint string         `json:"host_key_fingerprint,omitempty"` // For strict host key checking (TOFU or manual)
	CreatedBy          *uuid.UUID     `json:"created_by,omitempty" gorm:"type:uuid;<-:create"`
	CreatedByUsername  string         `json:"created_by_username,omitempty" gorm:"<-:create"`
	CreatedAt          time.Time      `json:"created_at" gorm:"<-:create"`
	UpdatedAt          time.Time      `json:"updated_at"`
	DeletedAt          gorm.DeletedAt `json:"-" gorm:"index"`
}

type VpnConfigRepository interface {
	Create(vpn *VpnConfig) error
	GetByID(id uuid.UUID, scope *PermissionScope) (*VpnConfig, error)
	List(namespaceID *uuid.UUID, scope *PermissionScope) ([]VpnConfig, error)
	ListPaginated(namespaceID *uuid.UUID, limit, offset int, searchTerm string, vpnType string, authType string, createdBy *uuid.UUID, scope *PermissionScope) ([]VpnConfig, int64, error)
	Update(vpn *VpnConfig) error
	Delete(id uuid.UUID) error
}

// Workflow Management Models

type HookType string

const (
	HookTypeBefore       HookType = "BEFORE"
	HookTypeAfterSuccess HookType = "AFTER_SUCCESS"
	HookTypeAfterFailed  HookType = "AFTER_FAILED"
)

type WorkflowHook struct {
	ID               uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	WorkflowID       *uuid.UUID `json:"workflow_id,omitempty" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	ScheduleID       *uuid.UUID `json:"schedule_id,omitempty" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	TargetWorkflowID uuid.UUID  `json:"target_workflow_id" gorm:"type:uuid;not null;index;constraint:OnDelete:CASCADE;"`
	HookType         HookType   `json:"hook_type" gorm:"not null"`
	Inputs           string     `json:"inputs"` // JSON string
	Order            int        `json:"order"`
	TargetWorkflow   *Workflow  `json:"target_workflow,omitempty" gorm:"foreignKey:TargetWorkflowID"`
}

type Workflow struct {
	ID                uuid.UUID          `json:"id" gorm:"type:uuid;primaryKey"`
	NamespaceID       uuid.UUID          `json:"namespace_id" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	Name              string             `json:"name" gorm:"not null"`
	Description       string             `json:"description"`
	DefaultServerID   *uuid.UUID         `json:"default_server_id,omitempty" gorm:"type:uuid;index"`
	DefaultServer     *Server            `json:"default_server,omitempty" gorm:"foreignKey:DefaultServerID;"`
	Status            Status             `json:"status"`
	TimeoutMinutes    int                `json:"timeout_minutes" gorm:"default:15"`
	IsTemplate        bool               `json:"is_template" gorm:"default:false"`
	AIGuide           string             `json:"ai_guide" gorm:"type:text"`
	GroupCount        int                `json:"group_count" gorm:"-:migration;->"`
	StepCount         int                `json:"step_count" gorm:"-:migration;->"`
	TriggerSource     string             `json:"trigger_source,omitempty" gorm:"size:50"` // For templates or specific defaults
	Inputs            []WorkflowInput    `json:"inputs,omitempty" gorm:"foreignKey:WorkflowID;constraint:OnDelete:CASCADE;"`
	Variables         []WorkflowVariable `json:"variables,omitempty" gorm:"foreignKey:WorkflowID;constraint:OnDelete:CASCADE;"`
	Outputs           []WorkflowOutput   `json:"outputs,omitempty" gorm:"foreignKey:WorkflowID;constraint:OnDelete:CASCADE;"`
	Groups            []WorkflowGroup    `json:"groups,omitempty" gorm:"foreignKey:WorkflowID;constraint:OnDelete:CASCADE;"`
	Tags              []Tag              `json:"tags,omitempty" gorm:"many2many:workflow_tags;constraint:OnDelete:CASCADE;"`
	Files             []WorkflowFile     `json:"files,omitempty" gorm:"foreignKey:WorkflowID;constraint:OnDelete:CASCADE;"`
	TargetFolder      string             `json:"target_folder,omitempty" gorm:"default:''"`
	CleanupFiles      bool               `json:"cleanup_files,omitempty" gorm:"default:false"`
	Hooks             []WorkflowHook     `json:"hooks,omitempty" gorm:"foreignKey:WorkflowID;constraint:OnDelete:CASCADE;"`
	CreatedBy         *uuid.UUID         `json:"created_by,omitempty" gorm:"type:uuid;index;<-:create"`
	CreatedByUsername string             `json:"created_by_username,omitempty" gorm:"<-:create"`
	CreatedAt         time.Time          `json:"created_at" gorm:"<-:create"`
	UpdatedAt         time.Time          `json:"updated_at"`
	IsPublic          bool               `json:"is_public" gorm:"default:false"`
	DeletedAt         gorm.DeletedAt     `json:"-" gorm:"index"`
}

type WorkflowFile struct {
	ID                      uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	WorkflowID              uuid.UUID `json:"workflow_id" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	FileName                string    `json:"file_name" gorm:"not null"`
	FileSize                int64     `json:"file_size" gorm:"not null"`
	LocalPath               string    `json:"local_path" gorm:"not null"`
	TargetPath              string    `json:"target_path" gorm:"not null"`
	UseVariableSubstitution bool      `json:"use_variable_substitution" gorm:"default:false"`
	CreatedAt               time.Time `json:"created_at" gorm:"<-:create"`
	UpdatedAt               time.Time `json:"updated_at"`
}

type WorkflowGroup struct {
	ID                 uuid.UUID      `json:"id" gorm:"type:uuid;primaryKey"`
	WorkflowID         uuid.UUID      `json:"workflow_id" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	Name               string         `json:"name" gorm:"not null"`
	Key                string         `json:"key" gorm:"not null;default:''"`
	For                string         `json:"for,omitempty" gorm:"default:''"`
	LoopEnabled        bool           `json:"loop_enabled" gorm:"default:false"`
	Condition          string         `json:"condition" gorm:"default:''"`
	DefaultServerID    *uuid.UUID     `json:"default_server_id,omitempty" gorm:"type:uuid;index"`
	DefaultServer      *Server        `json:"default_server,omitempty" gorm:"foreignKey:DefaultServerID;"`
	Order              int            `json:"order"`
	IsParallel         bool           `json:"is_parallel"`
	Status             Status         `json:"status"`
	Steps              []WorkflowStep `json:"steps,omitempty" gorm:"foreignKey:GroupID;constraint:OnDelete:CASCADE;"`
	IsCopyEnabled      bool           `json:"is_copy_enabled" gorm:"default:false"`
	CopySourcePath     string         `json:"copy_source_path,omitempty" gorm:"default:''"`
	CopyTargetServerID *uuid.UUID     `json:"copy_target_server_id,omitempty" gorm:"type:uuid;index"`
	CopyTargetServer   *Server        `json:"copy_target_server,omitempty" gorm:"foreignKey:CopyTargetServerID;"`
	CopyTargetPath     string         `json:"copy_target_path,omitempty" gorm:"default:''"`
	ContinueOnFailure  bool           `json:"continue_on_failure" gorm:"default:false"`
	RetryEnabled       bool           `json:"retry_enabled" gorm:"default:false"`
	RetryLimit         int            `json:"retry_limit" gorm:"default:0"`
	RetryDelay         int            `json:"retry_delay" gorm:"default:0"`
	McpReportLog       bool           `json:"mcp_report_log" gorm:"default:false"`
	Skip               bool           `json:"skip" gorm:"default:false"`
	// Terminal settings
	UseTTY             bool           `json:"use_tty" gorm:"default:false"`
	// AutoInputs: JSON array of AutoInputRule, e.g. [{"pattern":"Password:","input":"secret"}]
	AutoInputs         string         `json:"auto_inputs" gorm:"default:''"`
	CreatedAt          time.Time      `json:"created_at" gorm:"<-:create"`
	UpdatedAt          time.Time      `json:"updated_at"`
}

type WorkflowStep struct {
	ID                   uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	GroupID              uuid.UUID  `json:"group_id" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	ServerID             uuid.UUID  `json:"server_id,omitempty" gorm:"type:uuid;index"` // Optional: If empty, run locally
	Name                 string     `json:"name" gorm:"not null"`
	ActionType           string     `json:"action_type" gorm:"not null;default:'COMMAND'"` // COMMAND, WORKFLOW, or HTTP
	ActionKey            string     `json:"action_key" gorm:"default:''"`
	CommandText          string     `json:"command_text"`
	HttpUrl              string     `json:"http_url" gorm:"default:''"`
	HttpMethod           string     `json:"http_method" gorm:"default:'GET'"`
	HttpHeaders          string     `json:"http_headers" gorm:"default:'{}'"` // JSON string map[string]string
	HttpBody             string     `json:"http_body" gorm:"default:''"`
	OutputFormat         string     `json:"output_format" gorm:"default:'json'"` // json or string
	// Dataset action (ActionType == "DATASET")
	DatasetID            *uuid.UUID `json:"dataset_id,omitempty" gorm:"type:uuid;index"`
	DatasetOperation     string     `json:"dataset_operation" gorm:"default:''"` // QUERY | INSERT | UPDATE | DELETE
	DatasetFilter        string     `json:"dataset_filter"`                      // "key=val,..." templated; matchConditions syntax
	DatasetPayload       string     `json:"dataset_payload"`                     // JSON object or array, templated (INSERT/UPDATE)
	DatasetLimit         int        `json:"dataset_limit" gorm:"default:0"`      // QUERY cap; 0 = default cap
	// Convert action (ActionType == "CONVERT") — parse a templated text source into JSON
	ConvertSource        string     `json:"convert_source"`
	// ConvertFields: JSON array of field extractors, e.g.
	// [{"name":"id","start":"Order: ","end_mode":"delimiter","end":",","format":"number","default":"0"}].
	// When non-empty, CONVERT greps each field out of the rendered source and returns a JSON object
	// {name: value, ...}. When empty, CONVERT keeps the legacy whole-source-to-JSON behavior.
	ConvertFields        string     `json:"convert_fields" gorm:"default:'[]'"`
	TargetWorkflowID     *uuid.UUID `json:"target_workflow_id,omitempty" gorm:"type:uuid;index"`
	TargetWorkflowInputs string     `json:"target_workflow_inputs,omitempty"` // JSON string of inputs for the target workflow
	WaitToFinish         *bool      `json:"wait_to_finish" gorm:"default:true"`
	Order                int        `json:"order"`
	CreatedAt            time.Time  `json:"created_at" gorm:"<-:create"`
	UpdatedAt            time.Time  `json:"updated_at"`
}

type WorkflowInput struct {
	ID           uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	WorkflowID   uuid.UUID `json:"workflow_id" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	Key          string    `json:"key" gorm:"not null"`
	Label        string    `json:"label" gorm:"not null"`
	Type         string    `json:"type" gorm:"not null;default:'input'"` // input, number, select, multi-select, multi-input, file, dataset-select, dataset-multi-select, date, time
	DefaultValue      string    `json:"default_value"`
	CollapseInitially bool      `json:"collapse_initially" gorm:"default:false"`
	AllowFolder       bool      `json:"allow_folder" gorm:"default:false"` // type=file only: let users pick an entire folder (structure preserved)
	IncludeTime       bool      `json:"include_time" gorm:"default:false"` // type=date only: pick a date AND a time (value becomes YYYY-MM-DDTHH:MM)
	Required          bool      `json:"required" gorm:"default:false"`
	Order        int       `json:"order" gorm:"default:0"`
	CreatedAt    time.Time `json:"created_at" gorm:"<-:create"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// WorkflowOutput declares one field of a workflow's Result contract. `Source` is a
// template (e.g. "{{ flow.groupKey.step.actionKey.field }}") rendered against the final
// execution flow-data; `Key` is the public name callers/widgets bind to. The rendered
// values are assembled into the WorkflowExecution.Result envelope { status, result }.
type WorkflowOutput struct {
	ID          uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	WorkflowID  uuid.UUID `json:"workflow_id" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	Key         string    `json:"key" gorm:"not null"`
	Source      string    `json:"source" gorm:"not null;default:''"`
	Description string    `json:"description" gorm:"default:''"`
	Order       int       `json:"order" gorm:"default:0"`
	CreatedAt   time.Time `json:"created_at" gorm:"<-:create"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type WorkflowVariable struct {
	ID         uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	WorkflowID uuid.UUID `json:"workflow_id" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	Key        string    `json:"key" gorm:"not null"`
	Value      string    `json:"value"`
	Order      int       `json:"order" gorm:"default:0"`
	CreatedAt  time.Time `json:"created_at" gorm:"<-:create"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type GlobalVariable struct {
	ID                uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	NamespaceID       uuid.UUID  `json:"namespace_id" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	Key               string     `json:"key" gorm:"not null"`
	Value             string     `json:"value"`
	Description       string     `json:"description"`
	CreatedBy         *uuid.UUID `json:"created_by,omitempty" gorm:"type:uuid;index;<-:create"`
	CreatedByUsername string     `json:"created_by_username,omitempty" gorm:"<-:create"`
	CreatedAt         time.Time  `json:"created_at" gorm:"<-:create"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

// Dataset is a user-defined collection of records. The schema (Columns) is a loose
// hint for the UI only — records (Data) accept arbitrary JSON, no validation.
type Dataset struct {
	ID                uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	NamespaceID       uuid.UUID  `json:"namespace_id" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	Key               string     `json:"key" gorm:"not null"` // template ref: data.<Key>
	Name              string     `json:"name" gorm:"not null"`
	Description       string     `json:"description"`
	Columns           string     `json:"columns" gorm:"type:jsonb;default:'[]'"` // [{name,type}] UI hint only
	CreatedBy         *uuid.UUID `json:"created_by,omitempty" gorm:"type:uuid;index;<-:create"`
	CreatedByUsername string     `json:"created_by_username,omitempty" gorm:"<-:create"`
	CreatedAt         time.Time  `json:"created_at" gorm:"<-:create"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type DatasetRecord struct {
	ID        uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	DatasetID uuid.UUID `json:"dataset_id" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	Data      string    `json:"data" gorm:"type:jsonb;default:'{}'"` // arbitrary JSON object
	CreatedAt time.Time `json:"created_at" gorm:"<-:create"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Tag struct {
	ID                uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	NamespaceID       uuid.UUID  `json:"namespace_id" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	Name              string     `json:"name" gorm:"not null"`
	Color             string     `json:"color" gorm:"not null;default:'#6366f1'"`
	Description       string     `json:"description" gorm:"default:''"`
	CreatedBy         *uuid.UUID `json:"created_by,omitempty" gorm:"type:uuid;index;<-:create"`
	CreatedByUsername string     `json:"created_by_username,omitempty" gorm:"<-:create"`
	CreatedAt         time.Time  `json:"created_at" gorm:"<-:create"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type ScheduleType string

const (
	ScheduleTypeOneTime   ScheduleType = "ONE_TIME"
	ScheduleTypeRecurring ScheduleType = "RECURRING"
)

type Schedule struct {
	ID                 uuid.UUID          `json:"id" gorm:"type:uuid;primaryKey"`
	NamespaceID        uuid.UUID          `json:"namespace_id" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	Name               string             `json:"name" gorm:"not null"`
	Type               ScheduleType       `json:"type" gorm:"not null"`
	CronExpression     string             `json:"cron_expression"`
	NextRunAt          *time.Time         `json:"next_run_at"`
	// StartDate/EndDate bound a RECURRING schedule's active window (both optional).
	// The cron only fires while now is within [StartDate, EndDate]. Nil means
	// unbounded on that side. Ignored for ONE_TIME.
	StartDate          *time.Time         `json:"start_date"`
	EndDate            *time.Time         `json:"end_date"`
	Status             string             `json:"status" gorm:"default:'ACTIVE'"` // ACTIVE, PAUSED
	// PageID is set when the schedule was created from a public page's ENDPOINT widget
	// (self-service scheduling). Nil for regular admin-created schedules.
	PageID             *uuid.UUID         `json:"page_id,omitempty" gorm:"type:uuid;index"`
	Retries            int                `json:"retries" gorm:"default:0"`
	CatchUp            bool               `json:"catch_up" gorm:"default:false"`
	CreatedBy          *uuid.UUID         `json:"created_by,omitempty" gorm:"type:uuid;index;<-:create"`
	CreatedByUsername  string             `json:"created_by_username,omitempty" gorm:"<-:create"`
	User               *User              `json:"user,omitempty" gorm:"foreignKey:CreatedBy"`
	CreatedAt          time.Time          `json:"created_at" gorm:"<-:create"`
	UpdatedAt          time.Time          `json:"updated_at"`
	ScheduledWorkflows []ScheduleWorkflow `json:"scheduled_workflows" gorm:"foreignKey:ScheduleID;constraint:OnDelete:CASCADE;"`
	Hooks              []WorkflowHook     `json:"hooks,omitempty" gorm:"foreignKey:ScheduleID;constraint:OnDelete:CASCADE;"`
	Tags               []Tag              `json:"tags,omitempty" gorm:"many2many:schedule_tags;constraint:OnDelete:CASCADE;"`
	TotalRuns          int                `json:"total_runs" gorm:"-"`
	LastRunStatus      string             `json:"last_run_status" gorm:"-"`
	LastRunAt          *time.Time         `json:"last_run_at" gorm:"-"`
}

type ScheduleWorkflow struct {
	ID         uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	ScheduleID uuid.UUID `json:"schedule_id" gorm:"type:uuid;index;not null;constraint:OnDelete:CASCADE;"`
	WorkflowID uuid.UUID `json:"workflow_id" gorm:"type:uuid;index;not null;constraint:OnDelete:CASCADE;"`
	Inputs     string    `json:"inputs"` // JSON string
	Workflow   *Workflow `json:"workflow,omitempty" gorm:"foreignKey:WorkflowID"`
}

type WorkflowExecution struct {
	ID                uuid.UUID               `json:"id" gorm:"type:uuid;primaryKey"`
	WorkflowID        uuid.UUID               `json:"workflow_id" gorm:"type:uuid;index"`
	ScheduledID       *uuid.UUID              `json:"scheduled_id" gorm:"type:uuid;index"`
	PageID            *uuid.UUID              `json:"page_id,omitempty" gorm:"type:uuid;index"`
	TriggerSource     string                  `json:"trigger_source" gorm:"size:50;index"` // MANUAL, PAGE, SCHEDULE, HOOK
	Status            Status                  `json:"status"`
	Inputs            string                  `json:"inputs"` // JSON string
	ExecutedBy        *uuid.UUID              `json:"executed_by" gorm:"type:uuid;index"`
	APIKeyID          *uuid.UUID              `json:"api_key_id,omitempty" gorm:"type:uuid;index"`
	User              *User                   `json:"user,omitempty" gorm:"foreignKey:ExecutedBy"`
	LogPath           string                  `json:"log_path"`
	// Result holds the JSON envelope produced from the workflow's declared outputs:
	// {"status":"success|failed","result":{"<output key>":<value>}}. Empty when the
	// workflow declares no outputs. Consumed by parent WORKFLOW steps and result widgets.
	Result            string                  `json:"result" gorm:"type:text"`
	StartedAt         time.Time               `json:"started_at"`
	FinishedAt        *time.Time              `json:"finished_at,omitempty"`
	CreatedAt         time.Time               `json:"created_at" gorm:"<-:create"`
	UpdatedAt         time.Time               `json:"updated_at"`
	DeletedAt         gorm.DeletedAt          `json:"-" gorm:"index"`
	ParentExecutionID *uuid.UUID              `json:"parent_execution_id,omitempty" gorm:"type:uuid;index"`
	Workflow          *Workflow               `json:"workflow,omitempty" gorm:"foreignKey:WorkflowID"`
	Schedule          *Schedule               `json:"schedule,omitempty" gorm:"foreignKey:ScheduledID;constraint:OnDelete:SET NULL;"`
	Page              *Page                   `json:"page,omitempty" gorm:"foreignKey:PageID;constraint:OnDelete:SET NULL;"`
	Steps             []WorkflowExecutionStep `json:"steps,omitempty" gorm:"foreignKey:ExecutionID;constraint:OnDelete:CASCADE;"`
}

type WorkflowExecutionStep struct {
	ID          uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	ExecutionID uuid.UUID  `json:"execution_id" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	StepID      uuid.UUID  `json:"step_id" gorm:"type:uuid;index"`
	GroupID     uuid.UUID  `json:"group_id" gorm:"type:uuid;index"`
	GroupName   string     `json:"group_name"`
	Name        string     `json:"name"`
	Status      Status     `json:"status"`
	Output      string     `json:"output"`
	StartedAt   time.Time  `json:"started_at"`
	FinishedAt  *time.Time `json:"finished_at,omitempty"`
	WorkingDir  string     `json:"working_dir"`
	CreatedAt   time.Time  `json:"created_at" gorm:"<-:create"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type WorkflowRepository interface {
	Create(wf *Workflow) error
	GetByID(id uuid.UUID, scope *PermissionScope) (*Workflow, error)
	List(namespaceID uuid.UUID, scope *PermissionScope) ([]Workflow, error)
	ListPaginated(namespaceID uuid.UUID, limit, offset int, searchTerm string, tagIDs []uuid.UUID, isTemplate *bool, isPublic *bool, createdBy *uuid.UUID, scope *PermissionScope) ([]Workflow, int64, error)
	ListGlobalPaginated(limit, offset int, searchTerm string, tagIDs []uuid.UUID, isTemplate *bool, scope *PermissionScope) ([]Workflow, int64, error)
	Update(wf *Workflow) error
	UpdateStatus(id uuid.UUID, status Status) error
	Delete(id uuid.UUID) error
}

type WorkflowGroupRepository interface {
	Create(group *WorkflowGroup) error
	GetByWorkflowID(workflowID uuid.UUID) ([]WorkflowGroup, error)
	Update(group *WorkflowGroup) error
	UpdateStatus(id uuid.UUID, status Status) error
	Delete(id uuid.UUID) error
}

type WorkflowStepRepository interface {
	Create(step *WorkflowStep) error
	GetByGroupID(groupID uuid.UUID) ([]WorkflowStep, error)
	Update(step *WorkflowStep) error
	Delete(id uuid.UUID) error
}

type WorkflowInputRepository interface {
	Create(input *WorkflowInput) error
	GetByWorkflowID(workflowID uuid.UUID) ([]WorkflowInput, error)
	Update(input *WorkflowInput) error
	Delete(id uuid.UUID) error
}

type WorkflowVariableRepository interface {
	Create(variable *WorkflowVariable) error
	GetByWorkflowID(workflowID uuid.UUID) ([]WorkflowVariable, error)
	Update(variable *WorkflowVariable) error
	Delete(id uuid.UUID) error
}

type WorkflowExecutionRepository interface {
	Create(exec *WorkflowExecution) error
	GetByID(id uuid.UUID, scope *PermissionScope) (*WorkflowExecution, error)
	ListByWorkflowID(workflowID uuid.UUID, scope *PermissionScope) ([]WorkflowExecution, error)
	ListByWorkflowIDPaginated(workflowID uuid.UUID, limit, offset int, executedBy *uuid.UUID, tagIDs []uuid.UUID, scope *PermissionScope) ([]WorkflowExecution, int64, error)
	ListByNamespaceID(namespaceID uuid.UUID, scope *PermissionScope) ([]WorkflowExecution, error)
	ListByNamespaceIDPaginated(namespaceID uuid.UUID, limit, offset int, status string, workflowID *uuid.UUID, executedBy *uuid.UUID, tagIDs []uuid.UUID, scope *PermissionScope) ([]WorkflowExecution, int64, error)
	ListGlobalPaginated(limit, offset int, status string, workflowID *uuid.UUID, executedBy *uuid.UUID, tagIDs []uuid.UUID, scope *PermissionScope) ([]WorkflowExecution, int64, error)
	ListByScheduledID(scheduledID uuid.UUID, scope *PermissionScope) ([]WorkflowExecution, error)
	Update(exec *WorkflowExecution) error
	CreateStepResult(stepExec *WorkflowExecutionStep) error
	GetExecutionAnalytics(namespaceID uuid.UUID, days int, scope *PermissionScope) ([]map[string]interface{}, error)
	CleanupInterruptedExecutions() error
	GetRunningExecutions() ([]WorkflowExecution, error)
	GetStatusesByIDs(ids []uuid.UUID) ([]WorkflowExecution, error)
	// DeleteExecutionsOlderThan hard-deletes executions whose started_at is older than
	// `days` days (steps cascade). Returns the deleted execution IDs so the caller can
	// remove their on-disk log directories.
	DeleteExecutionsOlderThan(days int) ([]uuid.UUID, error)
	// GetLatestResult returns the most recent execution of a workflow that produced a
	// non-empty Result envelope, or (nil, nil) when none exists.
	GetLatestResult(workflowID uuid.UUID) (*WorkflowExecution, error)
}

type GlobalVariableRepository interface {
	Create(gv *GlobalVariable) error
	GetByID(id uuid.UUID, scope *PermissionScope) (*GlobalVariable, error)
	List(namespaceID uuid.UUID, scope *PermissionScope) ([]GlobalVariable, error)
	ListPaginated(namespaceID uuid.UUID, limit, offset int, searchTerm string, createdBy *uuid.UUID, scope *PermissionScope) ([]GlobalVariable, int64, error)
	ListGlobalPaginated(limit, offset int, searchTerm string, scope *PermissionScope) ([]GlobalVariable, int64, error)
	Update(gv *GlobalVariable) error
	Delete(id uuid.UUID) error
}

type DatasetRepository interface {
	Create(d *Dataset) error
	GetByID(id uuid.UUID, scope *PermissionScope) (*Dataset, error)
	GetByKey(namespaceID uuid.UUID, key string) (*Dataset, error)
	List(namespaceID uuid.UUID, scope *PermissionScope) ([]Dataset, error)
	ListPaginated(namespaceID uuid.UUID, limit, offset int, searchTerm string, createdBy *uuid.UUID, scope *PermissionScope) ([]Dataset, int64, error)
	ListGlobalPaginated(limit, offset int, searchTerm string, scope *PermissionScope) ([]Dataset, int64, error)
	Update(d *Dataset) error
	Delete(id uuid.UUID) error

	ListRecords(datasetID uuid.UUID, limit, offset int, searchTerm string) ([]DatasetRecord, int64, error)
	AllRecords(datasetID uuid.UUID) ([]DatasetRecord, error)
	AllRecordsCapped(datasetID uuid.UUID, limit int) ([]DatasetRecord, error)
	GetRecord(id uuid.UUID) (*DatasetRecord, error)
	CreateRecord(r *DatasetRecord) error
	UpdateRecord(r *DatasetRecord) error
	// IncrementAndSet atomically merges setPatch (top-level) and applies numeric
	// deltas to each named field on every record in ids, in a single statement.
	// Missing/absent numeric fields are treated as 0. Returns rows affected.
	IncrementAndSet(datasetID uuid.UUID, ids []uuid.UUID, setPatch map[string]interface{}, deltas map[string]float64) (int64, error)
	DeleteRecord(id uuid.UUID) error
}

type ScheduleRepository interface {
	Create(s *Schedule) error
	GetByID(id uuid.UUID, scope *PermissionScope) (*Schedule, error)
	List(namespaceID uuid.UUID, scope *PermissionScope) ([]Schedule, error)
	ListPaginated(namespaceID uuid.UUID, limit, offset int, searchTerm string, tagIDs []uuid.UUID, createdBy *uuid.UUID, from, to *time.Time, scope *PermissionScope) ([]Schedule, int64, error)
	ListGlobalPaginated(limit, offset int, searchTerm string, tagIDs []uuid.UUID, scope *PermissionScope) ([]Schedule, int64, error)
	Update(s *Schedule) error
	Delete(id uuid.UUID) error
	ListByPageID(pageID uuid.UUID) ([]Schedule, error)
	AddScheduledWorkflow(sw *ScheduleWorkflow) error
	RemoveWorkflows(scheduleID uuid.UUID) error
	ListActive() ([]Schedule, error)
	UpdateStatus(id uuid.UUID, status string) error
	UpdateNextRunAt(id uuid.UUID, t *time.Time) error
}

type WorkflowFileRepository interface {
	Create(file *WorkflowFile) error
	GetByID(id uuid.UUID, scope *PermissionScope) (*WorkflowFile, error)
	GetByWorkflowID(workflowID uuid.UUID, scope *PermissionScope) ([]WorkflowFile, error)
	Update(file *WorkflowFile) error
	Delete(id uuid.UUID) error
}

type Page struct {
	ID                uuid.UUID      `json:"id" gorm:"type:uuid;primaryKey"`
	NamespaceID       uuid.UUID      `json:"namespace_id" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	Title             string         `json:"title" gorm:"not null"`
	Description       string         `json:"description"`
	ParentID          *uuid.UUID     `json:"parent_id,omitempty" gorm:"type:uuid;index"`
	Parent            *Page          `json:"parent,omitempty" gorm:"foreignKey:ParentID;constraint:OnDelete:SET NULL;"`
	Slug              string         `json:"slug" gorm:"uniqueIndex;not null"`
	IsPublic          bool           `json:"is_public" gorm:"default:false"`
	Password          string         `json:"password,omitempty" gorm:"column:password"`
	TokenTTLMinutes   int            `json:"token_ttl_minutes" gorm:"default:15"`
	ExpiresAt         *time.Time     `json:"expires_at" gorm:"index"`
	Layout            string         `json:"layout" gorm:"type:text"`
	ShowParentSidebar bool           `json:"show_parent_sidebar" gorm:"default:false"` // Show parent page widgets as a sticky sidebar on the public page
	Workflows         []PageWorkflow `json:"workflows,omitempty" gorm:"foreignKey:PageID;constraint:OnDelete:CASCADE;"`
	Tags              []Tag          `json:"tags,omitempty" gorm:"many2many:page_tags;constraint:OnDelete:CASCADE;"`
	CreatedBy         *uuid.UUID     `json:"created_by,omitempty" gorm:"type:uuid;index;<-:create"`
	CreatedByUsername string         `json:"created_by_username,omitempty" gorm:"<-:create"`
	CreatedAt         time.Time      `json:"created_at" gorm:"<-:create"`
	UpdatedAt         time.Time      `json:"updated_at"`
	// ServerTime is not persisted. Public responses stamp it so the browser can decide
	// whether a widget's "updated" badge is still within its window using the server
	// clock instead of the visitor's (possibly wrong) local clock.
	ServerTime *time.Time `json:"server_time,omitempty" gorm:"-"`
}

type PageWorkflow struct {
	ID         uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	PageID     uuid.UUID `json:"page_id" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	WorkflowID uuid.UUID `json:"workflow_id" gorm:"type:uuid;index;constraint:OnDelete:CASCADE;"`
	Order      int       `json:"order"`
	Label      string    `json:"label"`    // Custom label for the button
	Style      string    `json:"style"`    // Button style (color, etc.)
	ShowLog    bool      `json:"show_log"` // Whether to show execution logs
	Workflow   *Workflow `json:"workflow,omitempty" gorm:"foreignKey:WorkflowID"`
}

type PageRepository interface {
	Create(page *Page) error
	GetByID(id uuid.UUID, scope *PermissionScope) (*Page, error)
	GetBySlug(slug string) (*Page, error) // Public slug lookup doesn't need scope
	List(namespaceID uuid.UUID, scope *PermissionScope) ([]Page, error)
	ListPaginated(namespaceID uuid.UUID, limit, offset int, searchTerm string, isPublic *bool, createdBy *uuid.UUID, tagIDs []uuid.UUID, scope *PermissionScope) ([]Page, int64, error)
	ListGlobalPaginated(limit, offset int, searchTerm string, isPublic *bool, tagIDs []uuid.UUID, scope *PermissionScope) ([]Page, int64, error)
	Update(page *Page) error
	Delete(id uuid.UUID) error
}

type TagRepository interface {
	Create(tag *Tag) error
	GetByID(id uuid.UUID, scope *PermissionScope) (*Tag, error)
	ListByNamespace(namespaceID uuid.UUID, scope *PermissionScope) ([]Tag, error)
	ListPaginated(namespaceID uuid.UUID, limit, offset int, searchTerm string, createdBy *uuid.UUID, scope *PermissionScope) ([]Tag, int64, error)
	ListGlobalPaginated(limit, offset int, searchTerm string, scope *PermissionScope) ([]Tag, int64, error)
	Update(tag *Tag) error
	Delete(id uuid.UUID) error
}

type SystemSettingRepository interface {
	GetByKey(key string) (*SystemSetting, error)
	Upsert(setting *SystemSetting) error
	List() ([]SystemSetting, error)
}
type AuditLog struct {
	ID           uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	Timestamp    time.Time  `json:"timestamp" gorm:"index:idx_audit_logs_timestamp,sort:desc;index:idx_audit_logs_res_timestamp,priority:3"`
	NamespaceID  *uuid.UUID `json:"namespace_id" gorm:"type:uuid;index:idx_audit_logs_ns_timestamp,priority:1"`
	UserID       *uuid.UUID `json:"user_id" gorm:"type:uuid;index"`
	Username     string     `json:"username"`
	Action       string     `json:"action" gorm:"index"`
	ResourceType string     `json:"resource_type" gorm:"index:idx_audit_logs_res_timestamp,priority:1"`
	ResourceID   *string    `json:"resource_id" gorm:"index:idx_audit_logs_res_timestamp,priority:2"`
	Metadata     string     `json:"metadata" gorm:"type:jsonb"`
	Status       string     `json:"status"`
	IPAddress    string     `json:"ip_address"`
}

type AuditLogRepository interface {
	Create(log *AuditLog) error
	CreateBatch(logs []AuditLog) error
	List(namespaceID *uuid.UUID, resourceType *string, resourceID *string, userID *uuid.UUID, username *string, action *string, limit, offset int) ([]AuditLog, int64, error)
	DeleteOldLogs(days int) error
}

type AuditLogService interface {
	LogAction(c context.Context, action string, resourceType string, resourceID string, metadata interface{}, status string)
	ListLogs(namespaceID *uuid.UUID, resourceType *string, resourceID *string, userID *uuid.UUID, username *string, action *string, limit, offset int) ([]AuditLog, int64, error)
	Cleanup(days int) error
}
