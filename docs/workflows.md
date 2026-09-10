# ⚙️ Workflows: Orchestration Reference

Workflows are the core of CSM — multi-step command pipelines that you design once and run anywhere. This guide covers the full mental model, every input/output type, lifecycle hooks, the templating engine, advanced patterns, and security.

![Workflows List](assets/workflows_list.png)

---

## 🌟 Overview

A **Workflow** is a tree:

```
Workflow
├── Inputs            (user parameters declared at design time)
├── Files             (scripts/configs uploaded with the run)
├── Variables         (workflow-internal constants)
├── Group 1           (executes in order)
│   ├── Step 1.1      (a command, HTTP call, sub-workflow, TTY, …)
│   ├── Step 1.2
│   └── …
├── Group 2           (executes after Group 1 — or in parallel if configured)
└── Hooks             (BEFORE / AFTER_SUCCESS / AFTER_FAILED)
```

Each **Step** runs a command on a **Server** (or locally), and its output can feed into later steps via templating. The **Execution** record captures every step's stdout/stderr, status, duration, and final result.

### When to use a workflow
- A task takes **more than one command** or involves multiple servers.
- You want to **reuse** the same logic with different parameters.
- You need **traceability** (who ran what, when, with which inputs).
- You want to expose the task to **non-technical users** (via Pages) or to **AI agents** (via MCP).

---

## 📥 Workflow inputs

Inputs collect parameters from the user before a workflow starts. Every input is validated by a `SecurityRegex` to prevent shell injection.

### Input types
| Type | UI component | Returns | Typical use |
| :--- | :--- | :--- | :--- |
| **`input`** | Text box | string | Names, IDs, free text |
| **`number`** | Numeric box | int / float | Counts, ports |
| **`select`** | Dropdown | string | Pre-defined choices |
| **`multi-select`** | Tag input | string[] | Multi-pick options |
| **`multi-input`** | Dynamic list | string[] | Variable-length lists (row fields: `input` / `number` / `select` / `date` / `time` / `file`) |
| **`file`** | File picker | local path string | Scripts, configs, binaries |
| **`date`** | Text box + date picker | `YYYY-MM-DD` (or `YYYY-MM-DDTHH:MM` with *Include time* on) | Backup dates, cut-off dates, maintenance windows |
| **`time`** | Text box + time picker | `HH:MM` | Run-at times, schedule hours |

A `date` / `time` value can be typed or pasted as one string, and the browser picker opens from the calendar / clock
icon or from the click that focuses the field (later clicks only move the caret, so an edit in progress is never cut
off). The value must be a real date/time in the format above (a space separator and seconds are accepted too, e.g.
`2026-08-19 14:30:00`), and a template such as `{{ my_var }}` is **rejected**: an
input's own value is never re-rendered, so only a literal value can reach a command. (A parent workflow mapping
`{{ ... }}` onto a sub-workflow's date input still works — the parent resolves it before the child runs.)

A `multi-input` row field can be a `date` / `time` too (same *Include time* switch, same value format). Each row
value is validated per field; a legacy comma-separated field list declares no field types, so its values are only
character-checked.

### Input metadata
- **Required** — block the run if empty.
- **Default value** — pre-fills the form.
- **Pattern** — extra regex on top of the global security regex.
- **CollapseInitially** — hides inputs under a "Show more" group for cleaner UIs.
- **Group** — visually clusters related inputs in the run dialog.
- **Allow Folder** (`file` type only) — lets the user pick an **entire folder**. The directory tree is preserved on upload and transferred recursively to the server. Like a single file input, the value is an object; use `{{ input.my_folder.path }}` to get the remote folder root (e.g. `/tmp/csm_inputs/<session>/my_folder`).

> [!TIP]
> Use descriptive input keys (`git_branch`, `target_env`) — they appear in MCP tool schemas and AI agents use them to decide how to fill the form.

---

## 📁 Workflow files

Workflows can ship persistent assets (scripts, configs, binaries) that travel with each run.

### Lifecycle
1. **Validate** — existence + size limit.
2. **Preprocess** — if **Variable Substitution** is enabled, the file content is rendered through Pongo2 (inputs, variables, globals).
3. **Transfer** — uploaded to the **Workflow Default Server** (or each step's server, depending on settings).
4. **Deploy path** — `TargetFolder/FileName` if `Target Folder` is set; otherwise the file's explicit `Target Path`.
5. **Cleanup** — if **Cleanup Files** is on, transferred files are deleted after the run completes (success or failure).

### Implicit remote path rewriting
When a workflow runs on a **remote SSH server**, CSM rewrites any reference to a local upload path:

- Local: `data/uploads/inputs/job_123/script.sh`
- Remote: `/tmp/csm_inputs/job_123/script.sh`

You can use `bash {{ input.my_file }}` and the same template works locally and over SSH.

---

## 🏗️ Lifecycle hooks

Hooks attach side-effects to workflow phases.

| Hook | Fires when |
| :--- | :--- |
| **BEFORE** | After input validation, before file transfers |
| **AFTER_SUCCESS** | All groups/steps finished with `SUCCESS` |
| **AFTER_FAILED** | Any critical group/step failed or workflow timed out |

Hooks are themselves workflows. To prevent loops, CSM enforces a maximum **recursion depth of 3 levels**.

---

## 🧠 Templating (Pongo2)

Every command, URL, header, and file body is a Pongo2 template. Available scopes:

| Scope | Reference | Notes |
| :--- | :--- | :--- |
| Inputs | `{{ input.key }}` | User-provided at runtime |
| Variables | `{{ variable.key }}` | Workflow-internal constants |
| Globals | `{{ global.key }}` | System-wide, namespace-scoped |
| Step outputs | `{{ flow.group_key.step.action_key }}` | Output from a previous step's `action_key` |
| Loop item | `{{ item }}` / `{{ index }}` | Current value and 0-based position |
| Runner | `{{ user.username }}`, `{{ user.full_name }}`, `{{ user.nickname }}`, `{{ user.email }}`, `{{ user.chat_account_id }}`, `{{ user.id }}` | Identity of whoever triggered the run |

### Runner identity
`user.*` carries the account that started the execution — handy for notifications
(`curl -d "<@{{ user.chat_account_id }}> deploy finished"`) or audit trails inside a command.
Nickname and Chat Account ID are set by the user on **Profile**, or by an administrator on
**Users → Edit Identity**.

A **schedule** run has no triggering account, so every `user.*` key renders empty. Values
containing characters the command sanitizer rejects also render empty.

### Common patterns
- Conditional command: `{% if input.dry_run == "yes" %}--dry-run{% endif %}`
- JSON access: `{{ flow.fetch.json.result.0.host }}`
- Pre-formatted block: `{% raw %}{ "k": "v" }{% endraw %}` to skip parsing.

---

## 🧩 Advanced orchestration

### Working directory tracking
After every step, CSM runs `pwd -P` and remembers the cwd. The next step on the same server resumes from there — so a `cd` in one step persists into the next.

### Group loops
Set `Loop` on a group with a JSON array or comma-separated string. The group runs once per element; outputs are indexed as `step_key_0`, `step_key_1`, …

### Parallel groups
Groups marked **parallel** start simultaneously; the workflow waits for all of them before proceeding to the next sequential group.

### Relay (cross-server transfer)
Stream artifacts from one remote server to another via the CSM backend as a tarball — no scp gymnastics needed.

---

## ⚡ Step specializations

### COMMAND
Plain shell command. Captures stdout/stderr, exit code.

### HTTP
Send REST requests. Headers, body, and query are templated. Response body parsed as JSON into `flow.*` for later steps.

### WORKFLOW (nested)
Run another workflow as a step.
- **Sync** — wait for completion (default).
- **Async** (`WaitToFinish: false`) — spawn and continue ("fire and forget").
- **Dynamic foreach** — pass a JSON array to spawn N sub-workflows.

### DATASET
Read or mutate a [Dataset](datasets.md) without leaving the run. Pick a dataset and an operation — **Find Many / Find One / INSERT / UPDATE / DELETE**. Filter and payload are templated. The JSON result is captured into `flow.*` (set an `action_key`, keep Output Format = JSON) for later steps. See the [Datasets guide](datasets.md#-the-dataset-step).

### CONVERT
Turn a templated text **source** into JSON so later steps can read structured fields. Two modes:

- **No fields (legacy)** — the rendered source (e.g. `{{ flow.grp.step.raw }}`) is parsed as JSON; if it isn't valid JSON it's wrapped as a JSON string.
- **With fields (grep)** — add one or more fields, each greps a value out of the source and the step returns a JSON **object** `{name: value, …}`. Per field:
  - **start** — capture begins right *after* the first occurrence of this marker (empty = from the beginning of the source).
  - **end** — `until char` (a delimiter string), `end of line`, or `to end` of the source. A missing delimiter/newline falls back to end-of-source.
  - **format** — `string` or `number` (number-parse failure falls back to the default).
  - **default** — used when start isn't found, the capture is empty, or a number fails to parse.

Result is captured into `flow.*` (set an `action_key`, Output Format = JSON). A later step reads a single field with `{{ flow.grp.step.key.name }}` or the whole object with `{{ flow.grp.step.key|json }}` (e.g. an HTTP body, a DATASET payload, or a sub-workflow input).

> **Example** — source `Order: 12345, name: Bob` with fields `id` (start `Order: `, until char `,`, number) and `name` (start `name: `, to end, string) → `{"id":12345,"name":"Bob"}`.

### TTY
For interactive prompts (`sudo`, `ssh-keygen`, vault unlocks). Define regex/keystroke pairs; CSM watches output and types responses automatically.

---

## 🚨 Failure handling

- Each step has a **timeout** (default workflow-level, overridable per-step).
- **Critical** flag: if a critical step fails, the whole workflow fails immediately and `AFTER_FAILED` runs.
- Non-critical failures are logged but the workflow continues.
- A step can be retried with `MaxRetries`/`RetryDelaySeconds`.

---

## 🔒 Security

All input values must match the global allow-list regex:

```
^[\pL0-9_\-\.\ \/\\:\[\]{}"',@#%!+=?;&|\(\)\$\n\r]*$
```

This permits Unicode letters, JSON, and shell-safe punctuation while blocking metacharacters that would enable injection (backticks, `>`, etc.).

Secrets from **Global Variables** are masked in logs (see [Variables](variables.md) — Secret Masking).

---

## 🛠️ Step-by-step: build a workflow

1. **Create** — Workflows → **+ New**.
2. **Meta** — name, description, AI guide (used by [MCP](mcp.md)).
3. **Inputs** — declare parameters; pick types and defaults.
4. **Variables / Files** — add internal constants and uploaded assets.
5. **Groups & steps** — drag steps in; set command, server, timeout, critical flag.
6. **Hooks** — wire up `BEFORE` / `AFTER_*` if needed.
7. **Test** — **Run Now** with sample inputs; watch the [Execution Log](audit_logs.md).
8. **Expose** — wrap in a [Page](pages.md), attach a [Schedule](schedules.md), or expose via [MCP](mcp.md).

---

## 🔧 Troubleshooting

| Symptom | Likely cause | Fix |
| :--- | :--- | :--- |
| Command works on terminal but fails in CSM | Working directory or env differ | Add `cd /path && …` or set an explicit working dir; check the SSH user's shell init files. |
| `{{ flow.X.Y }}` is empty | Previous step's `action_key` not set or step skipped | Confirm the producing step ran and the `action_key` matches exactly. |
| File upload referenced as local path on remote | Variable substitution off | Enable **Variable Substitution** for that file, or use the explicit `/tmp/csm_inputs/...` path. |
| Secret leaked in logs | Value not registered as a Global Secret | Move the value into a Global Variable marked **Secret**. |
| Workflow hangs on TTY prompt | No matching auto-input rule | Add a TTY rule with the correct regex; pre-test on a non-prod server. |
