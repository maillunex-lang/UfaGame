extends SceneTree
## Real Godot content loader against the API behind a TLS test front (S16).

class MemoryCredentials:
	extends RefCounted
	var saved := ""
	func save_credentials(value: String) -> bool:
		saved = value
		return true
	func load_credentials() -> String:
		return saved
	func random_secret() -> String:
		return Marshalls.raw_to_base64(Crypto.new().generate_random_bytes(32)).replace("+", "-").replace("/", "_").replace("=", "")
	func request_id() -> String:
		var bytes := Crypto.new().generate_random_bytes(16)
		bytes[6] = (bytes[6] & 15) | 64
		bytes[8] = (bytes[8] & 63) | 128
		var h := bytes.hex_encode()
		return "%s-%s-%s-%s-%s" % [h.substr(0, 8), h.substr(8, 4), h.substr(12, 4), h.substr(16, 4), h.substr(20, 12)]

var failures := 0
var certificate: X509Certificate
var base := ""
var auth
var control: HTTPRequest
var store_root := ""

func check(value: bool, name: String) -> void:
	if not value:
		failures += 1
		push_error("Content smoke: " + name)
		print("FAIL: " + name)

func _initialize() -> void:
	call_deferred("run")

## Test-only control channel of the front (publish versions, arm faults).
func command(name: String) -> Dictionary:
	control.request(OS.get_environment("UFA_AUTH_TEST_ORIGIN") + "/__test/" + name)
	var r = await control.request_completed
	return JSON.parse_string(r[3].get_string_from_utf8()) if r[1] == 200 else {}

func loader(budget := 512 * 1024 * 1024):
	var node = load("res://content_client.gd").new()
	node.root = store_root
	node.chunk_size = 4096
	node.storage_budget = budget
	node.auth = auth
	get_root().add_child(node)
	node.http.set_tls_options(TLSOptions.client(certificate))
	return node

func has(trace: Array, prefix: String) -> bool:
	return trace.any(func(t): return str(t).begins_with(prefix))

func run() -> void:
	certificate = X509Certificate.new()
	check(certificate.load(OS.get_environment("UFA_AUTH_TEST_CA")) == OK, "trusted test CA")
	base = OS.get_environment("UFA_AUTH_TEST_URL")
	store_root = "user://content-test-" + str(Time.get_ticks_usec())
	control = HTTPRequest.new()
	get_root().add_child(control)
	control.set_tls_options(TLSOptions.client(certificate))
	var provider := MemoryCredentials.new()
	auth = load("res://auth_client.gd").new()
	get_root().add_child(auth)
	auth.native = provider
	auth.last_error = ""
	auth.state = {}
	auth.http.set_tls_options(TLSOptions.client(certificate))
	var connected: Dictionary = await auth.connect_guest(base)
	check(connected.ok, "guest session")
	var v1: Dictionary = await command("publish/v1")
	# 1. First start: bundle + primary PNG only, then activation.
	var first = loader()
	var result: Dictionary = await first.sync()
	check(result.ok and result.version == v1.version, "first sync activates v1")
	check(has(first.trace, "blob_download:" + v1.sprite), "sprite downloaded")
	check(not has(first.trace, "blob_download:" + v1.sound), "sound is optional until Download all")
	var tex = first.texture("sprite_hero")
	check(tex != null and tex.get_width() == 64 and tex.get_height() == 64, "sprite first frame decodes from local storage")
	# 2. Restart: nothing is downloaded again.
	var second = loader()
	result = await second.sync()
	check(result.ok and has(second.trace, "bundle_not_modified") and has(second.trace, "blob_reuse:" + v1.sprite), "restart reuses bundle and blob")
	check(not has(second.trace, "blob_download") and not has(second.trace, "activate"), "restart downloads nothing")
	# 3. Download all fetches the optional sound.
	result = await second.sync(true)
	check(result.ok and has(second.trace, "blob_download:" + v1.sound), "download all fetches sound")
	# 4. Corrupted file is replaced.
	var file := FileAccess.open(second.blob_path(v1.sprite), FileAccess.WRITE)
	file.store_string("corrupt")
	file.close()
	var third = loader()
	result = await third.sync()
	check(result.ok and has(third.trace, "blob_corrupt:" + v1.sprite) and has(third.trace, "blob_download:" + v1.sprite), "corrupted blob replaced")
	# 5. Interrupted download keeps .part and the old version; restart resumes.
	var v2: Dictionary = await command("publish/v2")
	await command("interrupt/" + v2.sprite)
	var fourth = loader()
	result = await fourth.sync()
	check(not result.ok and result.code == "NETWORK_UNAVAILABLE", "interrupted download fails")
	check(fourth.active().content_version == v1.version, "unfinished version not activated")
	check(FileAccess.file_exists(fourth.blob_path(v2.sprite) + ".part") and not FileAccess.file_exists(fourth.blob_path(v2.sprite)), "partial file kept, final absent")
	var fifth = loader()
	result = await fifth.sync()
	check(result.ok and result.version == v2.version, "resume completes v2")
	check(has(fifth.trace, "blob_resume:%s:4096" % v2.sprite), "resumed from 4096 bytes")
	var ranges: Dictionary = await command("ranges/" + v2.sprite)
	check(ranges.get("starts", []).count(0.0) == 1, "first chunk not downloaded twice")
	# 6. Wrong hash: rejected, nothing activated, then a clean retry works.
	var v3: Dictionary = await command("publish/v3")
	await command("tamper/" + v3.sprite)
	var sixth = loader()
	result = await sixth.sync()
	check(not result.ok and result.code == "HASH_MISMATCH", "tampered bytes rejected")
	check(sixth.active().content_version == v2.version and not FileAccess.file_exists(sixth.blob_path(v3.sprite) + ".part"), "no activation, part removed")
	result = await sixth.sync()
	check(result.ok and result.version == v3.version, "clean retry activates v3")
	# 7. No space within the budget: refused before writing, old version stays.
	var v4: Dictionary = await command("publish/v4")
	var tight = loader(1024)
	result = await tight.sync()
	check(not result.ok and result.code == "STORAGE_FULL" and tight.active().content_version == v3.version, "storage full keeps v3")
	# 8. Incompatible content: client keeps its active version.
	await command("publish/incompatible")
	var seventh = loader()
	result = await seventh.sync()
	check(not result.ok and result.code == "INCOMPATIBLE_CLIENT" and seventh.active().content_version == v3.version, "incompatible content keeps v3")
	print("GODOT_CONTENT_OK failures=%d checks_trace=%s" % [failures, str(fifth.trace)])
	quit(0 if failures == 0 else 1)
