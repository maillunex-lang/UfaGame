extends SceneTree
## Real Godot campaign (S22): campaign screen, locked stage, first-clear reward, next stage.

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
		push_error("Campaign smoke: " + name)
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

func run() -> void:
	certificate = X509Certificate.new()
	check(certificate.load(OS.get_environment("UFA_AUTH_TEST_CA")) == OK, "trusted test CA")
	var provider := MemoryCredentials.new()
	auth = load("res://auth_client.gd").new()
	get_root().add_child(auth)
	auth.native = provider
	auth.last_error = ""
	auth.state = {}
	auth.http.set_tls_options(TLSOptions.client(certificate))
	check((await auth.connect_guest(OS.get_environment("UFA_AUTH_TEST_URL"))).ok, "guest session")
	DirAccess.remove_absolute("user://live_battle.json")
	var content = load("res://content_client.gd").new()
	content.root = "user://campaign-test-" + str(Time.get_ticks_usec())
	content.auth = auth
	get_root().add_child(content)
	content.http.set_tls_options(TLSOptions.client(certificate))
	check((await content.sync()).ok, "content with campaign.chapters.v1 accepted by this client")
	var bundle: Dictionary = content.active()
	var view = await render(bundle)
	check(view.paths.size() == 1 and view.paths[0].points.size() == 2, "one chapter path with two stage points")
	var geo: Array = view._points([{"location_id": "a"}, {"location_id": "b"}], {"a": {"data": {"lat_e6": 54000000, "lon_e6": 56000000}}, "b": {"data": {"lat_e6": 53000000, "lon_e6": 57000000}}})
	check(geo[0].is_equal_approx(Vector2(0.12, 0.12)) and geo[1].is_equal_approx(Vector2(0.88, 0.88)), "path follows map points (north-west to south-east)")
	check(not view.buttons.stage_one.disabled and view.buttons.stage_boss.disabled, "first stage open, boss locked")
	check(view.buttons.stage_boss.text.contains("БОСС"), "boss marked on the path")
	var chosen := []
	view.stage_chosen.connect(func(stage): chosen.append(stage.id))
	view.buttons.stage_one.pressed.emit()
	check(chosen == ["stage_one"], "tap on an open stage chooses it")
	# Locked stage: the server refuses even if a client tries.
	var locked = client()
	var refused: Dictionary = await locked.start("stage_boss", ["hero_one"])
	check(not refused.ok and refused.get("code") == "CONFLICT", "server refuses a locked stage")
	locked.queue_free()
	# Win the first stage through the real live battle.
	var live = client()
	var battle = load("res://battle_view.gd").new()
	get_root().add_child(battle)
	battle.setup(live, content)
	live.finished.connect(func(result, verified): ended = {"result": result, "verified": verified})
	var main = load("res://main.gd").new()
	main.auth = auth
	var stage: Dictionary = view.find_stage("stage_one")
	live.finished.connect(func(result, _v): main._after_battle(live, battle, result, stage))
	var started: Dictionary = await live.start("stage_one", ["hero_one"])
	check(started.ok, "campaign battle started")
	live.set_auto(true)
	check(await wait_until(func(): return not ended.is_empty(), 60.0), "battle finished")
	check(ended.get("result") == "attacker_win" and ended.get("verified", false), "server-verified win")
	check(await wait_until(func(): return main.last_reward != "", 10.0), "reward text after server confirmation")
	check(main.last_reward.contains("+100 золото"), "reward shown: " + main.last_reward)
	check(battle.result_label.text.contains("Награда: +100 золото"), "reward on the result panel")
	view.queue_free()
	var after = await render(bundle)
	check(not after.buttons.stage_boss.disabled, "boss stage opened after the win")
	var money: Dictionary = await auth.progress()
	check(money.ok and money.data.balances.any(func(b): return b.currency == "gold" and int(b.amount) == 100), "gold 100 from the server")
	# Repeat win: no second reward and no reward text.
	ended = {}
	main.last_reward = ""
	var again = client()
	var battle2 = load("res://battle_view.gd").new()
	get_root().add_child(battle2)
	battle2.setup(again, content)
	again.finished.connect(func(result, verified): ended = {"result": result, "verified": verified})
	var cleared: Dictionary = after.find_stage("stage_one")
	check(cleared.status == "cleared", "stage one cleared")
	again.finished.connect(func(result, _v): main._after_battle(again, battle2, result, {}))
	check((await again.start("stage_one", ["hero_one"])).ok, "repeat battle started")
	again.set_auto(true)
	check(await wait_until(func(): return not ended.is_empty(), 60.0), "repeat battle finished")
	await create_timer(1.0).timeout
	check(main.last_reward == "", "no reward text for a repeat win")
	money = await auth.progress()
	check(money.ok and money.data.balances.any(func(b): return b.currency == "gold" and int(b.amount) == 100), "gold still 100 after a repeat win")
	main.free()
	print("GODOT_CAMPAIGN_OK failures=%d" % failures)
	quit(0 if failures == 0 else 1)
