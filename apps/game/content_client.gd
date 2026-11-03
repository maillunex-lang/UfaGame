extends Node
## S16: published content loader.
## - Bundle: GET /v1/content/current with the client's capabilities and ETag.
## - Resources: hash-addressed files in user://content/blobs/<sha256>, downloaded by
##   Range chunks into <sha256>.part so an interrupted download resumes after restart.
## - A new bundle becomes active (active.json) only after every primary resource is
##   present and verified; until then the previous active bundle stays in use.

signal progress_changed(done: int, total: int)

const BLOB_PATTERN := "^[a-f0-9]{64}$"
const VERSION_PATTERN := "^pub_[0-9]{6,}$"
var root := "user://content"
var chunk_size := 262144
var storage_budget := 512 * 1024 * 1024
var auth
var http: HTTPRequest
var trace: Array = []
var last_error := ""

func _ready() -> void:
	http = HTTPRequest.new()
	http.timeout = 20.0
	http.max_redirects = 0
	http.body_size_limit = 4 * 1024 * 1024
	add_child(http)
	DirAccess.make_dir_recursive_absolute(root.path_join("blobs"))

func capabilities() -> PackedStringArray:
	var registry = JSON.parse_string(FileAccess.get_file_as_string("res://contracts/capabilities.json"))
	if not registry is Dictionary:
		return PackedStringArray()
	return PackedStringArray(registry.capabilities)

func blob_path(sha: String) -> String:
	return root.path_join("blobs").path_join(sha)

func _valid_bundle(bundle) -> bool:
	if not bundle is Dictionary or bundle.get("api_version") != 1:
		return false
	var version := RegEx.create_from_string(VERSION_PATTERN)
	var sha := RegEx.create_from_string(BLOB_PATTERN)
	if not bundle.get("content_version") is String or version.search(bundle.content_version) == null:
		return false
	if not bundle.get("sha256") is String or sha.search(bundle.sha256) == null:
		return false
	if not bundle.get("content") is Dictionary or not bundle.content.get("entities") is Array or not bundle.get("resources") is Array:
		return false
	for res in bundle.resources:
		if not res is Dictionary or not res.get("sha256") is String or sha.search(res.sha256) == null:
			return false
		if res.get("media_type") not in ["image/png", "audio/wav"] or not (res.get("size") is float or res.get("size") is int) or int(res.size) < 1 or int(res.size) > 8388608:
			return false
	return true

func active() -> Dictionary:
	var path := root.path_join("active.json")
	if not FileAccess.file_exists(path):
		return {}
	var bundle = JSON.parse_string(FileAccess.get_file_as_string(path))
	return bundle if _valid_bundle(bundle) else {}

func primary_resources(bundle: Dictionary) -> Array:
	return bundle.get("resources", []).filter(func(r): return r.media_type == "image/png")

func _write_atomic(path: String, text: String) -> bool:
	var tmp := path + ".tmp"
	var file := FileAccess.open(tmp, FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(text)
	var ok := file.get_error() == OK
	file.close()
	return ok and DirAccess.rename_absolute(tmp, path) == OK

func _fetch(path: String, headers: Array, retry := true) -> Dictionary:
	var base: String = auth.state.get("base_url", "")
	if not base.begins_with("https://") or not auth.state.has("session"):
		return {"ok": false, "status": 0, "code": "UNAUTHORIZED"}
	var all := PackedStringArray(headers)
	all.append("Authorization: Bearer " + str(auth.state.session.get("access_token", "")))
	if http.request(base.trim_suffix("/") + path, all, HTTPClient.METHOD_GET) != OK:
		return {"ok": false, "status": 0, "code": "NETWORK_UNAVAILABLE"}
	var response = await http.request_completed
	if response[0] != HTTPRequest.RESULT_SUCCESS:
		return {"ok": false, "status": 0, "code": "NETWORK_UNAVAILABLE"}
	if response[1] == 401 and retry:
		var refreshed: Dictionary = await auth.refresh_session()
		if not refreshed.ok:
			return {"ok": false, "status": 401, "code": "UNAUTHORIZED"}
		return await _fetch(path, headers, false)
	return {"ok": response[1] >= 200 and response[1] < 300, "status": response[1], "body": response[3]}

func _used_bytes() -> int:
	var total := 0
	var dir := DirAccess.open(root.path_join("blobs"))
	if dir == null:
		return 0
	for name in dir.get_files():
		var f := FileAccess.open(root.path_join("blobs").path_join(name), FileAccess.READ)
		if f != null:
			total += f.get_length()
	return total

## Returns "" on success or an error code; never leaves an unverified final file.
func ensure_blob(res: Dictionary) -> String:
	var sha: String = res.sha256
	var size := int(res.size)
	var path := blob_path(sha)
	if FileAccess.file_exists(path):
		if FileAccess.get_sha256(path) == sha:
			trace.append("blob_reuse:" + sha)
			return ""
		DirAccess.remove_absolute(path)
		trace.append("blob_corrupt:" + sha)
	var part := path + ".part"
	var offset := 0
	if FileAccess.file_exists(part):
		var existing := FileAccess.open(part, FileAccess.READ)
		offset = existing.get_length() if existing != null else 0
		existing = null
		if offset > size:
			DirAccess.remove_absolute(part)
			offset = 0
	if _used_bytes() + size - offset > storage_budget:
		trace.append("storage_full:" + sha)
		return "STORAGE_FULL"
	if offset > 0:
		trace.append("blob_resume:%s:%d" % [sha, offset])
	while offset < size:
		var end: int = min(offset + chunk_size, size) - 1
		var r: Dictionary = await _fetch("/v1/content/blobs/" + sha, ["Range: bytes=%d-%d" % [offset, end]])
		if not r.ok or r.status != 206 or r.body.size() != end - offset + 1:
			trace.append("blob_interrupted:%s:%d" % [sha, offset])
			return r.get("code", "NETWORK_UNAVAILABLE") if not r.ok else "NETWORK_UNAVAILABLE"
		var file := FileAccess.open(part, FileAccess.READ_WRITE if FileAccess.file_exists(part) else FileAccess.WRITE)
		if file == null:
			return "STORAGE_WRITE_FAILED"
		file.seek_end()
		file.store_buffer(r.body)
		var failed := file.get_error() != OK
		file.close()
		if failed:
			return "STORAGE_WRITE_FAILED"
		offset += r.body.size()
		progress_changed.emit(offset, size)
	if FileAccess.get_sha256(part) != sha:
		DirAccess.remove_absolute(part)
		trace.append("blob_hash_mismatch:" + sha)
		return "HASH_MISMATCH"
	if DirAccess.rename_absolute(part, path) != OK:
		return "STORAGE_WRITE_FAILED"
	trace.append("blob_download:" + sha)
	return ""

## Fetches the current bundle and the resources it needs. With download_all the
## optional resources (sounds) are fetched too. Returns {ok, version, offline?, code?}.
func sync(download_all := false) -> Dictionary:
	last_error = ""
	var current := active()
	var headers := ["X-Ufa-Capabilities: " + ",".join(capabilities())]
	if not current.is_empty():
		headers.append("If-None-Match: \"%s\"" % current.sha256)
	var r: Dictionary = await _fetch("/v1/content/current", headers)
	var bundle := {}
	if r.status == 304 and not current.is_empty():
		trace.append("bundle_not_modified:" + str(current.content_version))
		bundle = current
	elif r.ok:
		var parsed = JSON.parse_string(r.body.get_string_from_utf8())
		if not _valid_bundle(parsed):
			last_error = "INVALID_RESPONSE"
			return {"ok": false, "code": last_error, "version": current.get("content_version", "")}
		bundle = parsed
		trace.append("bundle_download:" + str(bundle.content_version))
	elif r.status == 409:
		last_error = "INCOMPATIBLE_CLIENT"
		return {"ok": false, "code": last_error, "version": current.get("content_version", "")}
	elif r.status == 404:
		last_error = "NO_CONTENT"
		return {"ok": false, "code": last_error, "version": current.get("content_version", "")}
	elif not current.is_empty() and r.status == 0:
		trace.append("offline_active:" + str(current.content_version))
		return {"ok": true, "offline": true, "version": current.content_version}
	else:
		last_error = r.get("code", "SERVER_ERROR")
		return {"ok": false, "code": last_error, "version": current.get("content_version", "")}
	var needed: Array = bundle.resources if download_all else primary_resources(bundle)
	for res in needed:
		var error := await ensure_blob(res)
		if not error.is_empty():
			last_error = error
			return {"ok": false, "code": error, "version": current.get("content_version", "")}
	if current.get("sha256", "") != bundle.sha256:
		if not _write_atomic(root.path_join("active.json"), JSON.stringify(bundle)):
			last_error = "STORAGE_WRITE_FAILED"
			return {"ok": false, "code": last_error, "version": current.get("content_version", "")}
		trace.append("activate:" + str(bundle.content_version))
	return {"ok": true, "version": bundle.content_version}

func downloaded(res: Dictionary) -> bool:
	return FileAccess.file_exists(blob_path(res.sha256))

func texture(resource_id: String) -> Texture2D:
	for res in active().get("resources", []):
		if res.id == resource_id and res.media_type == "image/png" and downloaded(res):
			var image := Image.new()
			if image.load_png_from_buffer(FileAccess.get_file_as_bytes(blob_path(res.sha256))) == OK:
				var whole := ImageTexture.create_from_image(image)
				var frames = res.get("frames", [])
				if frames is Array and frames.size() > 0 and frames[0] is Dictionary:
					# Show the first animation frame, not the whole atlas.
					var f: Dictionary = frames[0]
					var region := Rect2(float(f.get("x", 0)), float(f.get("y", 0)), float(f.get("width", image.get_width())), float(f.get("height", image.get_height())))
					if region.position.x >= 0 and region.position.y >= 0 and region.end.x <= image.get_width() and region.end.y <= image.get_height() and region.size.x > 0 and region.size.y > 0:
						var atlas := AtlasTexture.new()
						atlas.atlas = whole
						atlas.region = region
						return atlas
				return whole
	return null
