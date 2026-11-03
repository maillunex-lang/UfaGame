extends SceneTree
## Real Godot economy (S25/S27/S29): AFK, VIP/tutorial and summon screen against the real API.

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
var auth
var ended := {}

func check(value: bool, name: String) -> void:
	if not value:
		failures += 1
		push_error("Economy smoke: " + name)
		print("FAIL: " + name)

func _initialize() -> void:
	call_deferred("run")

func wait_until(condition: Callable, seconds := 20.0) -> bool:
	var limit := Time.get_ticks_msec() + int(seconds * 1000)
	while Time.get_ticks_msec() < limit:
		if condition.call():
			return true
		await process_frame
	return false

func client():
	var live = load("res://live_client.gd").new()
	live.auth = auth
	live.tls_options = TLSOptions.client(certificate)
	get_root().add_child(live)
	return live

func render(bundle: Dictionary):
	var data: Dictionary = await auth.authorized_get("/v1/campaign")
	check(data.ok, "campaign loaded")
	var money: Dictionary = await auth.progress()
	var view = load("res://campaign_view.gd").new()
	view.size = Vector2(720, 1600)
	get_root().add_child(view)
	view.show_campaign(data.data, bundle, money.data.balances if money.ok else [])
	await process_frame
	return view

func same_results(a: Array, b: Array) -> bool:
	if a.size() != b.size():
		return false
	for i in a.size():
		for k in ["hero_id", "shards", "guaranteed", "new_instance_id"]:
			if a[i].get(k) != b[i].get(k):
				return false
	return true

func run() -> void:
	certificate = X509Certificate.new()
	check(certificate.load(OS.get_environment("UFA_AUTH_TEST_CA")) == OK, "trusted test CA")
	auth = load("res://auth_client.gd").new()
	get_root().add_child(auth)
	auth.native = MemoryCredentials.new()
	auth.last_error = ""
	auth.state = {}
	auth.http.set_tls_options(TLSOptions.client(certificate))
	check((await auth.connect_guest(OS.get_environment("UFA_AUTH_TEST_URL"))).ok, "guest session")
	var content = load("res://content_client.gd").new()
	content.root = "user://economy-test-" + str(Time.get_ticks_usec())
	content.auth = auth
	get_root().add_child(content)
	content.http.set_tls_options(TLSOptions.client(certificate))
	check((await content.sync()).ok, "content with vip.v1, summon.v1, afk.v1 accepted by this client")
	var view = load("res://economy_view.gd").new()
	view.auth = auth
	view.size = Vector2(540, 3000)
	get_root().add_child(view)
	var messages := []
	view.message.connect(func(t): messages.append(t))
	await view.load_all()
	check(not view.afk.is_empty() and not view.vip.is_empty() and not view.summon.is_empty(), "AFK, VIP and summon loaded")
	check(view.actions.has("afk") and view.actions.has("pull10:pool_main"), "buttons shown")
	check(view.actions["tutorial"].disabled, "tutorial reward locked until the steps are done")
	check((await view.claim_afk()).ok, "first claim starts the AFK window")
	print("PREPARE " + str(auth.state.session.player_id))
	var ready := false
	for i in 50:
		await view.load_all()
		if int(view.summon.balances.get("gems", 0)) >= 1000 and int(view.afk.accrued.get("gold", 0)) >= 7200:
			ready = true
			break
		await create_timer(0.2).timeout
	check(ready, "server prepared gems, shards and 2 h of AFK time")
	check(view.actions["afk"].text == "Забрать AFK-награды", "claim button")
	# Double tap: one request at a time; 2 h of gold arrive once.
	view.actions["afk"].pressed.emit()
	view.actions["afk"].pressed.emit()
	check(await wait_until(func(): return not view.busy and view.afk.get("claimed") != null and int(view.afk.claimed.get("gold", 0)) >= 7200, 10.0), "AFK claimed: " + str(view.afk.get("claimed")))
	var again: Dictionary = await view.claim_afk()
	check(again.ok and int(again.data.claimed.get("gold", 0)) < 10, "nothing more right after the claim")
	# VIP daily once.
	check((await view.claim_daily()).ok and int(view.vip.points) == 50, "daily VIP points")
	check(not (await view.claim_daily()).ok and messages[-1] == "Сегодня очки уже получены. Приходи завтра.", "second daily refused")
	# Summon x10 and a retried request with the kept id returns the same result.
	check((await view.pull("pool_main", 10)).ok and view.summon.last.size() == 10 and int(view.summon.balances.gems) == 900, "x10 pull for 100 gems")
	var kept := "6d0f6f0e-1111-4111-8111-%012d" % (Time.get_ticks_usec() % 1000000000000)
	view.pending["pull:pool_main:1"] = kept
	var first: Dictionary = await view.pull("pool_main", 1)
	view.pending["pull:pool_main:1"] = kept
	var retry: Dictionary = await view.pull("pool_main", 1)
	check(first.ok and retry.ok and same_results(first.data.last, retry.data.last) and int(retry.data.balances.gems) == 890, "retry with the kept request_id is not paid twice")
	# Shards: 10 granted (+ any from pulls) → assemble.
	var shards := 0
	for s in view.summon.shards:
		if s.hero_id == "hero_c":
			shards = int(s.amount)
	check(shards >= 10 and view.actions.has("assemble:hero_c") and not view.actions["assemble:hero_c"].disabled, "assemble button enabled at %d shards" % shards)
	check((await view.assemble("pool_main", "hero_c")).ok, "hero assembled")
	print("GODOT_ECONOMY_OK failures=%d" % failures)
	quit(0 if failures == 0 else 1)
