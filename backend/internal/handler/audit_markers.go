package handler

// markCredentialChange records that a write carried a credential, without recording the
// credential. Redacted fields are identical on both sides of the diff, so a rotation
// would otherwise produce no audit entry at all.
func markCredentialChange(diff map[string]interface{}, field string, submitted bool) map[string]interface{} {
	if !submitted {
		return diff
	}
	if diff == nil {
		diff = make(map[string]interface{})
	}
	diff[field] = "changed"
	return diff
}
