extends RefCounted

# S01 only: trusted bundled fixture, not a production downloader.
const ROOT = "user://s01-assets"

static func retain(bytes: PackedByteArray, expected: String) -> String:
	var digest := HashingContext.new()
	digest.start(HashingContext.HASH_SHA256)
	digest.update(bytes)
	if digest.finish().hex_encode() != expected:
		return "rejected"
	if DirAccess.make_dir_recursive_absolute(ROOT) != OK:
		return "error"
	var path := ROOT.path_join(expected)
	if FileAccess.file_exists(path) and FileAccess.get_sha256(path) == expected:
		return "reused"
	var file := FileAccess.open(path + ".part", FileAccess.WRITE)
	if file == null:
		return "error"
	file.store_buffer(bytes)
	file.close()
	if DirAccess.rename_absolute(path + ".part", path) != OK:
		return "error"
	return "stored"
