extends RefCounted

static func supports(required: Array, version: int = 1) -> bool:
	var registry = JSON.parse_string(FileAccess.get_file_as_string("res://contracts/capabilities.json"))
	if not registry is Dictionary or registry.api_version != version:
		return false
	for capability in required:
		if capability not in registry.capabilities:
			return false
	return true
