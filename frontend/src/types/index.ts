export type Status = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';


export interface VpnConfig {
    id: string;
    name: string;
    description: string;
    vpn_type: 'SSH' | 'OPENVPN' | 'WIREGUARD';
    host: string;
    port: number;
    user?: string;
    auth_type?: 'PASSWORD' | 'PUBLIC_KEY';
    // Credentials are write-only: the API accepts them but never returns them.
    // The has_* flags report whether a value is stored.
    password?: string;
    private_key?: string;
    config_file?: string; // For OpenVPN (.ovpn) or WireGuard (.conf)
    public_key?: string;   // For WireGuard
    shared_key?: string;  // For WireGuard
    has_password?: boolean;
    has_private_key?: boolean;
    has_config_file?: boolean;
    has_shared_key?: boolean;
    created_by?: string;
    created_by_username?: string;
    created_at: string;
    updated_at: string;
}

export interface Server {
    id: string;
    name: string;
    description: string;
    connection_type: 'SSH' | 'LOCAL';
    host: string;
    port: number;
    user: string;
    auth_type: 'PASSWORD' | 'PUBLIC_KEY';
    // Write-only, as on VpnConfig.
    password?: string;
    private_key?: string;
    has_password?: boolean;
    has_private_key?: boolean;
    vpn_id?: string;
    vpn?: VpnConfig;
    created_by?: string;
    created_by_username?: string;
    created_at: string;
    updated_at: string;
}

export interface WorkflowStep {
    id: string;
    group_id: string;
    server_id?: string;
    name: string;
    action_type: 'COMMAND' | 'WORKFLOW' | 'HTTP' | 'DATASET' | 'CONVERT';
    action_key?: string;
    command_text: string;
    http_url?: string;
    http_method?: string;
    http_headers?: string;
    http_body?: string;
    output_format?: 'json' | 'string';
    dataset_id?: string;
    dataset_operation?: 'QUERY' | 'FIND_ONE' | 'INSERT' | 'UPDATE' | 'DELETE';
    dataset_filter?: string;
    dataset_payload?: string;
    dataset_limit?: number;
    convert_source?: string;
    convert_fields?: string; // JSON array of { name, start, end_mode, end, format, default }
    target_workflow_id?: string;
    target_workflow_inputs?: string; // JSON string
    wait_to_finish: boolean;
    order: number;
    created_at: string;
    updated_at: string;
}

export interface WorkflowGroup {
    id: string;
    workflow_id: string;
    name: string;
    key: string;
    for?: string;
    loop_enabled?: boolean;
    condition?: string;
    default_server_id?: string;
    default_server?: Server;
    order: number;
    is_parallel: boolean;
    status: Status;
    steps?: WorkflowStep[];
    is_copy_enabled: boolean;
    copy_source_path?: string;
    copy_target_server_id?: string;
    copy_target_server?: Server;
    copy_target_path?: string;
    continue_on_failure: boolean;
    retry_enabled: boolean;
    retry_limit: number;
    retry_delay: number;
    mcp_report_log: boolean;
    use_tty?: boolean;
    auto_inputs?: string;
    skip: boolean;
    created_at: string;
    updated_at: string;
}

export interface Tag {
    id: string;
    namespace_id: string;
    name: string;
    color: string;
    description: string;
    created_by?: string;
    created_by_username?: string;
    created_at: string;
    updated_at: string;
}

export interface DatasetColumn {
    name: string;
    type: string; // string | number | bool | json (UI hint only)
    default?: string; // default value pre-filled in the record form
}

export interface Dataset {
    id: string;
    namespace_id: string;
    key: string;
    name: string;
    description: string;
    columns: string; // JSON string of DatasetColumn[]
    created_by?: string;
    created_by_username?: string;
    created_at: string;
    updated_at: string;
}

export interface DatasetRecord {
    id: string;
    dataset_id: string;
    data: string; // JSON string
    created_at: string;
    updated_at: string;
}

export type HookType = 'BEFORE' | 'AFTER_SUCCESS' | 'AFTER_FAILED';

export interface WorkflowHook {
    id: string;
    workflow_id?: string;
    schedule_id?: string;
    target_workflow_id: string;
    hook_type: HookType;
    inputs: string;
    order: number;
    target_workflow?: Workflow;
}

export interface Workflow {
    id: string;
    namespace_id: string;
    name: string;
    description: string;
    default_server_id?: string;
    default_server?: Server;
    status: Status;
    timeout_minutes?: number;
    inputs?: WorkflowInput[];
    variables?: WorkflowVariable[];
    outputs?: WorkflowOutput[];
    groups?: WorkflowGroup[];
    tags?: Tag[];
    files?: WorkflowFile[];
    target_folder?: string;
    cleanup_files?: boolean;

    group_count?: number;
    step_count?: number;

    is_template?: boolean;
    is_public?: boolean;
    hooks?: WorkflowHook[];
    created_by?: string;
    created_by_username?: string;
    created_at?: string;
    updated_at?: string;
}

export interface WorkflowFile {
    id?: string;
    workflow_id: string;
    file_name: string;
    file_size: number;
    local_path?: string;
    target_path: string;
    use_variable_substitution: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface WorkflowExecution {
    id: string;
    workflow_id: string;
    scheduled_id?: string;
    page_id?: string;
    parent_execution_id?: string;
    trigger_source: string;
    status: Status;
    inputs: string;
    executed_by?: string;
    user?: { id: string; username: string; full_name?: string; email?: string };
    log_path: string;
    started_at: string;
    finished_at?: string;
    created_at: string;
    updated_at: string;
    workflow?: Workflow;
    page?: Page;
    steps?: WorkflowExecutionStep[];
}

export interface WorkflowExecutionStep {
    id: string;
    execution_id: string;
    step_id: string;
    group_id: string;
    group_name: string;
    name: string;
    status: string;
    output: string;
    started_at: string;
    finished_at?: string;
}

export interface MultiInputItem {
    id: string;
    key: string;
    label: string;
    type: 'input' | 'number' | 'select' | 'file' | 'date' | 'time';
    options?: string; // Comma separated for select type
    // type=date only: pick a date AND a time (value becomes YYYY-MM-DDTHH:MM).
    include_time?: boolean;
}

export interface WorkflowInput {
    id: string;
    workflow_id: string;
    key: string;
    label: string;
    type: 'input' | 'textarea' | 'number' | 'select' | 'multi-select' | 'multi-input' | 'file' | 'dataset-select' | 'dataset-multi-select' | 'date' | 'time';
    default_value: string;
    collapse_initially?: boolean;
    allow_folder?: boolean;
    // type=date only: pick a date AND a time (value becomes YYYY-MM-DDTHH:MM).
    include_time?: boolean;
    required: boolean;
    order?: number;
    created_at: string;
    updated_at: string;
}

// A declared field of a workflow's Result contract. `source` is a template
// (e.g. "{{ flow.groupKey.step.actionKey.field }}") rendered at the end of execution;
// `key` is the public name callers/widgets bind to.
export interface WorkflowOutput {
    id: string;
    workflow_id: string;
    key: string;
    source: string;
    description?: string;
    order?: number;
    created_at?: string;
    updated_at?: string;
}

export interface WorkflowVariable {
    id: string;
    workflow_id: string;
    key: string;
    value: string;
    order?: number;
    created_at: string;
    updated_at: string;
}

export interface GlobalVariable {
    id: string;
    namespace_id: string;
    key: string;
    // A secret variable's value is write-only: the API stores it encrypted and returns
    // an empty string. has_value reports whether one is stored.
    value: string;
    is_secret?: boolean;
    has_value?: boolean;
    description: string;
    created_by?: string;
    created_by_username?: string;
    created_at: string;
    updated_at: string;
}

export type ScheduleType = 'ONE_TIME' | 'RECURRING';

export interface ScheduleWorkflow {
    id: string;
    schedule_id: string;
    workflow_id: string;
    inputs: string;
    workflow?: Workflow;
}

export interface Schedule {
    id: string;
    namespace_id: string;
    name: string;
    type: ScheduleType;
    cron_expression?: string;
    next_run_at?: string;
    start_date?: string;
    end_date?: string;
    status: 'ACTIVE' | 'PAUSED';
    // Set when the schedule was created from a public page's ENDPOINT widget.
    page_id?: string | null;
    retries: number;
    catch_up: boolean;
    created_by?: string;
    created_by_username?: string;
    created_at: string;
    updated_at: string;
    workflows?: Workflow[]; // Legacy many-to-many
    scheduled_workflows?: ScheduleWorkflow[]; // Granular configurations
    hooks?: WorkflowHook[];
    tags?: Tag[];
    total_runs: number;
    last_run_status: string;
    last_run_at?: string;
}

export interface PageWorkflow {
    id: string;
    page_id: string;
    workflow_id: string;
    order: number;
    label: string;
    style: string;
    show_log: boolean;
    workflow?: Workflow;
}

export type PageWidgetSize = '1/6' | '2/6' | '3/6' | '4/6' | '5/6' | 'full';
export type PageWidgetType = 'TERMINAL' | 'ENDPOINT' | 'LINK' | 'SECTION' | 'TEXT' | 'IMAGE' | 'IFRAME' | 'STATUS' | 'TABLE' | 'CHART' | 'METRIC' | 'GAUGE' | 'PROGRESS' | 'STAT_GRID' | 'SPARKLINE';
export type PageWidgetReload = 'realtime' | '5' | '10' | '30' | '60';
export type ChartKind = 'line' | 'bar' | 'pie' | 'area';
export type AggregateFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

// SelectAggregation: one aggregation column to compute per bucket. `field` is the
// numeric field to reduce (ignored when fn === 'count'); `label` is the display name
// used on chart legends/axes and falls back to `${fn}(${field})` when absent.
export interface SelectAggregation {
    id?: string;
    field?: string;
    fn: AggregateFn;
    label?: string;
}

// DatasetSource: dataset-backed widget config. The shape mirrors the backend
// AggregateRequest. `columns` is TABLE-only.
//
// New multi-field shape (preferred):
//   group_bys: ['region', 'channel']  →  composite key per bucket
//   selects:   [{fn:'sum',field:'amount',label:'Total'}, {fn:'count',label:'Orders'}]
//
// Legacy single-field fields (group_by, metric, fn) are still read for backward
// compatibility with existing widgets; on save we mirror them into the arrays.
export interface DatasetSource {
    dataset_id: string;
    filter: string;            // FilterBuilder tree JSON, applied server-side
    group_bys?: string[];
    selects?: SelectAggregation[];
    // Legacy single-field
    group_by?: string;
    metric?: string;
    fn?: AggregateFn;
    limit?: number;
    sort?: 'value_desc' | 'value_asc' | 'key_asc' | 'key_desc';
    columns?: string[];        // TABLE: which record fields to render as columns
}

export interface PageWidget {
    id: string;
    type: PageWidgetType;
    title: string;
    size: PageWidgetSize;
    // Optional header icon shown on the public page. A lucide kebab-case icon name
    // (e.g. "rocket", "chart-column"), loaded lazily via lib/widgetIcons. When unset,
    // the widget falls back to its per-type default icon.
    icon?: string;
    // TERMINAL-specific
    server_id?: string;
    server_name?: string;
    command?: string;
    run_interval?: number;
    reload_interval?: PageWidgetReload;
    // ENDPOINT-specific
    workflow_id?: string;
    workflow_name?: string;
    label?: string;
    style?: string;
    show_log?: boolean;
    // When true, the public page shows a "Schedule" button on this ENDPOINT widget,
    // letting visitors schedule the workflow (one-time or daily-recurring). See
    // POST /public/pages/:slug/schedule/:workflow_id.
    allow_schedule?: boolean;
    description?: string;
    // LINK-specific
    url?: string;
    new_tab?: boolean;
    // TEXT-specific
    content?: string;
    // IMAGE-specific
    image_url?: string;
    alt_text?: string;
    // IFRAME-specific
    iframe_url?: string;
    iframe_height?: number;
    // STATUS-specific
    status_label?: string;
    status_value?: 'ok' | 'warning' | 'error' | 'info';
    status_url?: string;
    // TABLE-specific
    table_headers?: string[];
    table_rows?: string[][];
    // Dataset-backed widgets (TABLE | CHART | METRIC): when 'dataset', read records via
    // /datasets/:id/aggregate using `dataset`. Otherwise widget uses its static fields.
    data_source?: 'static' | 'dataset';
    dataset?: DatasetSource;
    // CHART-specific
    chart_kind?: ChartKind;
    chart_static_data?: string;   // JSON array of {key,value} for data_source==='static'
    // METRIC / GAUGE / PROGRESS / SPARKLINE share the single-value fields below.
    metric_label?: string;
    metric_unit?: string;
    metric_format?: 'number' | 'percent' | 'currency';
    metric_static_value?: string; // when data_source==='static'
    // GAUGE-specific: radial arc with optional colour thresholds.
    gauge_min?: number;   // arc start (default 0)
    gauge_max?: number;   // arc end (default 100)
    gauge_warn?: number;  // value ≥ warn → amber
    gauge_crit?: number;  // value ≥ crit → rose
    // PROGRESS-specific: value vs target → percentage bar.
    progress_target?: number; // default 100
    // SECTION nesting — id of parent SECTION widget (top-level when undefined)
    parent_id?: string;
    // SECTION-specific: when true, hide the section header (title + description) so only
    // the frame and its child widgets render. Child widgets size relative to the section's
    // own width (see PublicPageView / PageDesignerPage container-query layout).
    hide_header?: boolean;
    // "Updated" badge — any type. Defined (even as '') means the author enabled the badge
    // section in the designer; the badge itself only renders while the server date
    // (Page.server_time) is still on or before `updated_until`. Undefined → feature off.
    updated_until?: string;
    // Badge wording / lucide icon name. Unset → "Updated" with the sparkles icon.
    updated_label?: string;
    updated_icon?: string;
}

export interface PageLayout {
    widgets: PageWidget[];
}

export interface Page {
    id: string;
    namespace_id: string;
    title: string;
    description: string;
    parent_id?: string | null;
    // `layout` is only present when this page has show_parent_sidebar enabled — the
    // backend strips it otherwise. Used to render the parent widgets sidebar.
    parent?: { id: string; title: string; slug: string; is_public?: boolean; layout?: string } | null;
    slug: string;
    is_public: boolean;
    // When true and a parent exists, the public page renders the parent's widgets as a
    // sticky left sidebar (read-only, deep-linking back to the parent page).
    show_parent_sidebar?: boolean;
    password?: string;
    token_ttl_minutes?: number;
    expires_at?: string;
    layout: string;
    workflows?: PageWorkflow[];
    tags?: Tag[];
    created_by?: string;
    created_by_username?: string;
    created_at?: string;
    updated_at?: string;
    // Server clock at response time (RFC3339), only sent on public page responses.
    // Used to decide whether a widget's `updated_until` badge window is still open.
    server_time?: string;
}

export interface User {
    id: string;
    username: string;
    is_super_admin?: boolean;
    email?: string;
    full_name?: string;
    nickname?: string;
    chat_account_id?: string;
    created_at?: string;
    updated_at?: string;
}

export interface Permission {
    id: string;
    name: string;
    type: string;
    action: string;
    created_at?: string;
    updated_at?: string;
}

export interface RolePermission {
    id: string;
    role_id: string;
    permission_id: string;
    resource_id?: string;
    permission?: Permission;
}

export interface Role {
    id: string;
    name: string;
    description: string;
    permissions?: RolePermission[];
    created_at?: string;
    updated_at?: string;
}

export interface AuditLog {
    id: string;
    timestamp: string;
    namespace_id?: string;
    user_id?: string;
    username: string;
    action: string;
    resource_type: string;
    resource_id?: string;
    metadata: string; // JSON string
    status: string;
    ip_address: string;
}
