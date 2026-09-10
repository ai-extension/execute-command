# 🔐 Roles & Permissions: RBAC

CSM uses fine-grained Role-Based Access Control so each user sees only what they need. Permissions are namespace-scoped — a `prod` admin has no power in `staging` unless explicitly granted.

![Roles List](assets/roles.png)
*Defining access levels in the Roles overview.*

---

## 🌟 Overview

```
Permission  →  smallest "can-do" unit (workflow:execute, server:write, audit:read, …)
Role        →  named bundle of permissions (Deployer, Auditor, Operator, …)
User        →  has one or more Roles; effective rights = union of all their roles
Namespace   →  tenancy boundary; a Role applies inside its namespace only
```

A user attempting an action is allowed iff at least one of their roles in the action's namespace grants the required permission.

### When to design a new Role
- A team member needs **just enough** rights for one workflow (don't grant Super Admin).
- A new persona joins (auditor, operator, ops engineer).
- You want to **restrict by item** — e.g., one user can run only `deploy-staging`, not `deploy-prod`.

---

## ⚙️ Permission model

### Action types
| Action | Means |
| :--- | :--- |
| **`READ`** | View lists and details. |
| **`WRITE`** | Create or modify resources. |
| **`EXECUTE`** | High-impact action — run a workflow, fire a schedule. |

### Permission scopes
- **`FUNCTION`** — system-level capabilities (`audit:read`, `system:settings`).
- **`RESOURCE`** — object-level capabilities (`workflow:execute`, `server:write`, `page:read`).

### Item-level restriction
A role can be **Global** (all items of a resource type) or **Item-scoped** via `AllowedItemIDs`. Item-scoping is great for limiting a deploy operator to specific workflows while hiding others in the same namespace.

---

## 🧑‍💼 Common persona templates

| Persona | Permissions (suggested) |
| :--- | :--- |
| **Super Admin** | All `FUNCTION` + all `RESOURCE` permissions across all namespaces. |
| **Workflow Author** | `workflow:read,write` ; `server:read` ; `variable:read,write` ; `page:read,write`. |
| **Deploy Operator** | `workflow:execute` (item-scoped to release workflows) ; `page:read`. |
| **Auditor** | `audit:read` ; `workflow:read` ; `server:read` ; `schedule:read`. |
| **AI Integrator** | API keys with `mcp:enable` ; per-namespace `workflow:read,execute`. |

---

## 🔒 Resolution flow

When a user clicks **Run** on a workflow:

1. Backend reads all roles attached to the user.
2. Filters to roles within the workflow's namespace.
3. Checks if any role grants `workflow:execute`.
4. If the role is item-scoped, checks `AllowedItemIDs` contains the workflow's id.
5. Allowed → executes; not allowed → `403 Forbidden` (and an entry in the [Audit Log](audit_logs.md)).

---

## ✅ Best practices

- **Principle of least privilege** — start with no permissions and add only what's blocked.
- **Audit assignments quarterly** — review the role-user matrix in [Audit Logs](audit_logs.md).
- **Separate `prod` and `staging`** into different namespaces; copy roles but not assignments.
- **Reserve Super Admin** for emergency operations and the initial bootstrap user.
- **Use item scoping** for deploy / production workflows — far safer than namespace-wide `workflow:execute`.

---

## 🛠️ Step-by-step: create a role

1. **Navigate** to Roles → **+ New Role**.
2. **Name** — descriptive, matches the persona (e.g., `Deploy Operator`).
3. **Namespace** — pick the scope (or leave global if applicable).
4. **Add permissions** — tick the action × resource cells in the matrix.
5. (Optional) **Item-scope** — for any `workflow:execute` or similar, pick the specific item IDs.
6. **Save**. The role appears in the user assignment dialog immediately.

### Assigning a role to a user
- Users → pick a user → **Roles** tab → add the role.
- Changes take effect on the user's next API call (no logout required).

---

## 🌐 Google sign-in: domain → role mapping

Users can sign in either with a username + password or with a Google Workspace account. Both routes end at the same user record, so an account created one way can later use the other.

### How a Google sign-in is authorised

1. The browser sends the Google **ID token** to `POST /api/auth/google`.
2. The backend verifies the token's signature against Google's keys and checks that `aud` equals the configured `google_client_id`. Nothing the browser claims about the user is trusted.
3. The account's company is read from the token's `hd` (hosted domain) claim — the only proof that Google Workspace manages the account.
4. That domain is looked up in **Settings → Identity & Access → Domain → Role Mapping**. **No mapping means no sign-in**: unmapped domains are rejected before any account is created.
5. The mapped role is granted, and a normal CSM session cookie is issued.

### Mapping options

| Option | Effect |
| :--- | :--- |
| **Granted Role** | The role given to accounts from this domain. |
| **Auto-provision accounts** | Create the user on first sign-in. Off = only accounts that already exist may sign in. |
| **Sync role on every login** | Re-apply the mapped role at each sign-in, overwriting roles set by hand. Off (default) = the role is set once, and manual changes survive. |
| **Allow non-Workspace accounts** | Accept a personal Google account that merely uses a company address (no `hd` claim). Such an account is **not** managed by the company and keeps working after off-boarding — leave off unless the company has no Workspace. |
| **Enabled** | Block a domain without deleting its mapping. |

### Setup

1. Google Cloud Console → create an **OAuth Client ID** of type *Web application*, listing the CSM origin under *Authorized JavaScript origins*.
2. Settings → Identity & Access → enable **Google OAuth** and paste the Client ID. The client secret is not used by this flow.
3. Add one mapping per company domain. Each alias (`example.com`, `example.jp`) needs its own row.

### Addresses in a mapped domain are reserved

Once a domain is mapped, its addresses decide which account a Google identity links to, so they cannot be claimed by hand:

- **Public registration** rejects an email at a mapped domain (`must sign in with Google`).
- **Profile → Email** rejects a change *into* a mapped domain. Users keep editing their name, and addresses outside mapped domains stay editable.
- A **disabled** mapping still reserves its domain; only removing the mapping frees it.
- An **administrator** (`users:WRITE`) may still create or edit a user with such an address — that is how an account is pre-provisioned before its owner's first Google sign-in.

> [!WARNING]
> Revoking a Google account does not end an existing CSM session: the JWT stays valid until `token_expiration` elapses (24h by default). Remove the user in CSM as well when off-boarding.

---

## 🧠 Reference

- **Default Super Admin** — created at install; has all bits enabled across all namespaces. Treat like a `root` account.
- **Permission storage** — roles are stored as a permission bitmap per resource type, plus an optional `AllowedItemIDs` array.
- **API keys** can have their own permission subset (a sub-role) — useful for limited automation tokens (see [MCP](mcp.md)).
- **Cross-namespace actions** are always denied unless an explicit role grants permission in *each* namespace separately.

---

## 🔧 Troubleshooting

| Symptom | Likely cause | Fix |
| :--- | :--- | :--- |
| User gets `403` on a workflow they should run | Role is item-scoped and workflow id not in `AllowedItemIDs` | Add the id, or grant the role globally. |
| New role doesn't apply | Role assigned but cached session | Refresh the page; for API keys, regenerate or wait for cache TTL. |
| Auditor can't see audit logs | Missing `audit:read` permission | Add the `FUNCTION` permission `audit:read` to the auditor role. |
| Permission bleeds across environments | Same role assigned in multiple namespaces | Split into per-namespace roles; review the namespace column in the assignment table. |
