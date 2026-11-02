extends SceneTree

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
func check(value: bool, name: String) -> void:
	if not value:
		failures += 1
		push_error("Auth smoke: " + name)

func client(provider, certificate):
	var node = load("res://auth_client.gd").new()
	root.add_child(node)
	node.native = provider
	node.last_error = ""
	node.state = {} if provider.saved.is_empty() else JSON.parse_string(provider.load_credentials())
	node.http.set_tls_options(TLSOptions.client(certificate))
	return node

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var certificate := X509Certificate.new()
	check(certificate.load(OS.get_environment("UFA_AUTH_TEST_CA")) == OK, "trusted test CA")
	var provider := MemoryCredentials.new()
	var base := OS.get_environment("UFA_AUTH_TEST_URL")
	var name := OS.get_environment("UFA_AUTH_TEST_LOGIN")
	var first = client(provider, certificate)
	var result: Dictionary = await first.connect_guest(base)
	check(result.ok, "create guest over trusted TLS and path prefix")
	if not result.ok:
		quit(1)
		return
	var player_id: String = result.data.player_id
	check(result.data.balances[0].amount == 13, "server seeded progress")
	root.remove_child(first)
	first.queue_free()
	var second = client(provider, certificate)
	result = await second.connect_guest(base)
	check(result.ok and result.data.player_id == player_id, "restore client identity and refresh expired access")
	check(result.ok and result.data.balances[0].amount == 13, "progress after client restart")
	var password := provider.random_secret()
	result = await second.bind_account(name, password)
	check(result.ok and result.data.session.player_id == player_id, "bind preserves identity")
	if not result.ok:
		quit(1)
		return
	var code: String = result.data.recovery_code
	result = await second.login_account(base, name, password)
	check(result.ok and result.data.player_id == player_id, "password login")
	var new_password := provider.random_secret()
	result = await second.recover_account(base, name, code, new_password)
	check(result.ok and result.data.session.player_id == player_id, "one-use recovery")
	result = await second.recover_account(base, name, code, new_password)
	check(not result.ok and result.code == "UNAUTHORIZED", "old recovery code rejected")
	result = await second.progress()
	check(result.ok and result.data.balances[0].amount == 13, "recovered progress")
	result = await second.rotate_code(new_password)
	check(result.ok and str(result.data.recovery_code).length() == 43, "rotate recovery code")
	print("GODOT_AUTH_TLS_OK failures=%d" % failures)
	quit(0 if failures == 0 else 1)
