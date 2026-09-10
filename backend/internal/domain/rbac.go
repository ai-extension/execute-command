package domain

// IsSuperAdmin reports whether the user has unrestricted access. It is carried by the
// is_super_admin column, set by the seeder and never by a request payload — NOT by username
// and NOT by role name. Keying it off a name would be fragile: whoever could create or
// rename a role, or re-register a deleted account, would inherit full access. Every other
// account earns its access through roles and permissions.
func IsSuperAdmin(user *User) bool {
	if user == nil {
		return false
	}
	return user.IsSuperAdmin
}

// HasPermission checks if a user has a specific permission, considering hierarchy.
func HasPermission(user *User, permType, action string, namespaceID *string, resourceID *string, tagIDs []string) bool {
	if user == nil {
		return false
	}
	if IsSuperAdmin(user) {
		return true
	}

	// 1. Check specific Item level: If user has direct permission on this item.
	if resourceID != nil && *resourceID != "" {
		if checkLevel(user, permType, action, resourceID) {
			return true
		}
	}

	// 2. Check Resource Type level: If user has global access to this resource type.
	if checkLevel(user, permType, action, nil) {
		return true
	}

	// 3. Check Tag level: If user has RESOURCE_* permission on any of the tags, grant access.
	for _, tagID := range tagIDs {
		if tagID != "" {
			if checkLevel(user, "tags", "RESOURCE_"+action, &tagID) {
				return true
			}
		}
	}

	// 4. Check Namespace level: If user has RESOURCE_* permission on this namespace, grant access.
	if namespaceID != nil && *namespaceID != "" {
		if checkLevel(user, "namespaces", "RESOURCE_"+action, namespaceID) {
			return true
		}
	}

	// 5. Fallback for List operations (no specific resource ID)
	if resourceID == nil && (action == "READ" || action == "EXECUTE") {
		scope := GetPermissionScope(user, permType, action)
		if scope.IsGlobal || len(scope.AllowedItemIDs) > 0 || len(scope.AllowedNamespaceIDs) > 0 || len(scope.AllowedTagIDs) > 0 {
			return true
		}
	}

	return false
}

// checkLevel is a helper to check permission at a specific scope
func checkLevel(user *User, permType, action string, resourceID *string) bool {
	// Check Role-based permissions
	for _, role := range user.Roles {
		for _, rp := range role.Permissions {
			if rp.Permission != nil && rp.Permission.Type == permType && rp.Permission.Action == action {
				if rp.ResourceID == nil || *rp.ResourceID == "" {
					return true
				}
				if resourceID != nil && *rp.ResourceID == *resourceID {
					return true
				}
			}
		}
	}

	// Check Direct User permissions (if any)
	for _, p := range user.Permissions {
		if p.Type == permType && p.Action == action {
			return true // For now, direct perms are always global scope or item scope is not handled here
		}
	}
	return false
}

// GetPermissionScope returns the allowed scopes for a user for a given permission type and action.
func GetPermissionScope(user *User, permType, action string) PermissionScope {
	scope := PermissionScope{
		IsGlobal:            false,
		AllowedItemIDs:      []string{},
		AllowedNamespaceIDs: []string{},
		AllowedTagIDs:       []string{},
	}

	if user == nil {
		return scope
	}

	if IsSuperAdmin(user) {
		scope.IsGlobal = true
		return scope
	}

	for _, role := range user.Roles {
		for _, rp := range role.Permissions {
			if rp.Permission == nil {
				continue
			}

			// Apply hierarchical inheritance ONLY if the requested permType is a namespace-bound resource
			if isNamespaceScoped(permType) {
				// 1. Check for hierarchy: Namespace RESOURCE_* permissions
				if rp.Permission.Type == "namespaces" && rp.Permission.Action == "RESOURCE_"+action {
					if rp.ResourceID == nil || *rp.ResourceID == "" {
						scope.IsGlobal = true
					} else {
						scope.AllowedNamespaceIDs = append(scope.AllowedNamespaceIDs, *rp.ResourceID)
					}
				}

				// 2. Check for hierarchy: Tag RESOURCE_* permissions
				if rp.Permission.Type == "tags" && rp.Permission.Action == "RESOURCE_"+action {
					if rp.ResourceID == nil || *rp.ResourceID == "" {
						scope.IsGlobal = true
					} else {
						scope.AllowedTagIDs = append(scope.AllowedTagIDs, *rp.ResourceID)
					}
				}
			}

			// 3. Check for specific Item permissions
			if rp.Permission.Type == permType && rp.Permission.Action == action {
				if rp.ResourceID == nil || *rp.ResourceID == "" {
					scope.IsGlobal = true
				} else {
					scope.AllowedItemIDs = append(scope.AllowedItemIDs, *rp.ResourceID)
				}
			}
		}
	}

	// 4. Check Direct User permissions
	for _, p := range user.Permissions {
		if p.Type == permType && p.Action == action {
			scope.IsGlobal = true // Direct user perms currently assumed global
		}
		// Direct hierarchical perms could be added here
	}

	return scope
}

// isNamespaceScoped checks if a given permission type refers to a resource that lives inside a namespace.
func isNamespaceScoped(permType string) bool {
	switch permType {
	case "workflows", "history", "executions", "variables", "global-variables", "datasets", "schedules", "pages", "tags", "servers", "vpns":
		return true
	default:
		return false
	}
}
