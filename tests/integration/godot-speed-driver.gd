extends SceneTree
## Real Godot speeds and quests (S26/S30) against the real API.

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
		push_error("Speed smoke: " + name)
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

func battle(content, stage: String, ids: Array, speeds: Array):
	var live = load("res://live_client.gd").new()
	live.auth = auth
	live.tls_options = TLSOptions.client(certificate)
	get_root().add_child(live)
	var view = load("res://battle_view.gd").new()
	view.allowed_speeds = speeds
	get_root().add_child(view)
	view.setup(live, content)
	ended = {}
	live.finished.connect(func(result, verified): ended = {"result": result, "verified": verified})
	var started: Dictionary = await live.start(stage, ids, true)
	check(started.ok, "battle %s started" % stage)
	return [live, view]

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
	DirAccess.remove_absolute("user://live_battle.json")
	var content = load("res://content_client.gd").new()
	content.root = "user://speed-test-" + str(Time.get_ticks_usec())
	content.auth = auth
	get_root().add_child(content)
	content.http.set_tls_options(TLSOptions.client(certificate))
	check((await content.sync()).ok, "content with battle.speed.v1 and quests.v1 accepted by this client")
	var roster: Dictionary = await auth.authorized_get("/v1/heroes")
	var hero: String = roster.data.main[0]
	var vip: Dictionary = await auth.authorized_get("/v1/vip")
	check(vip.data.battle.speeds.map(func(x): return int(x)) == [1], "×1 only at the start")
	print("PREPARE " + str(auth.state.session.player_id))
	var rights := {}
	for i in 50:
		vip = await auth.authorized_get("/v1/vip")
		if vip.data.battle.instant:
			rights = vip.data.battle
			break
		await create_timer(0.2).timeout
	check(rights.get("speeds", []).map(func(x): return int(x)) == [1, 2, 4], "×2 and ×4 by VIP: " + str(rights))
	# Long battle at ×4: buttons, frames with speed 4, timeout after 900 steps.
	var pair = await battle(content, "stage_long", [hero], rights.speeds)
	var view = pair[1]
	check(view.speed_buttons.size() == 3 and not view.speed_buttons[4].disabled, "×1/×2/×4 buttons")
	check(await wait_until(func(): return view.step > 2, 10.0), "frames arrive")
	var t0 := Time.get_ticks_msec()
	view.speed_buttons[4].pressed.emit()
	check(await wait_until(func(): return view.speed == 4, 10.0), "server switched to ×4")
	check(view.speed_buttons[4].button_pressed, "×4 shown as active")
	check(await wait_until(func(): return not ended.is_empty(), 45.0), "battle finished")
	var real := (Time.get_ticks_msec() - t0) / 1000.0
	check(ended.get("result") == "attacker_loss" and ended.get("verified", false), "timeout loss verified")
	check(view.step == 900 and real < 35.0, "900 steps (90 game s) in %.1f real s" % real)
	pair[0].queue_free()
	view.queue_free()
	# First clear → quest ready → claim through the quest screen.
	pair = await battle(content, "stage_one", [hero], rights.speeds)
	pair[0].set_auto(true)
	check(await wait_until(func(): return not ended.is_empty(), 30.0) and ended.get("result") == "attacker_win", "stage one won")
	var quests = load("res://quests_view.gd").new()
	quests.auth = auth
	get_root().add_child(quests)
	await quests.load_quests()
	check(quests.actions.has("claim:quest_clear_one"), "claim button for the finished quest")
	check((await quests.claim("quest_clear_one")).ok, "quest reward claimed")
	var statuses := {}
	for q in quests.data.quests:
		statuses[q.id] = q.status
	check(statuses.get("quest_clear_one") == "claimed" and statuses.get("quest_level_after") == "active", "series opened: " + str(statuses))
	check(not (await quests.claim("quest_clear_one")).ok, "second claim refused")
	# Instant calculation button for the cleared stage.
	var campaign: Dictionary = await auth.authorized_get("/v1/campaign")
	var cv = load("res://campaign_view.gd").new()
	cv.instant = true
	get_root().add_child(cv)
	cv.show_campaign(campaign.data, content.active(), [])
	check(cv.instant_buttons.has("stage_one") and not cv.instant_buttons.has("stage_two"), "instant only for the cleared stage")
	var fast: Dictionary = await auth.authorized_post("/v1/battles", {"request_id": "7e0f6f0e-1111-4111-8111-%012d" % (Time.get_ticks_usec() % 1000000000000), "stage_id": "stage_one", "instance_ids": [hero]})
	check(fast.ok and fast.data.result == "attacker_win", "instant repeat calculated by the server")
	print("GODOT_SPEED_OK failures=%d" % failures)
	quit(0 if failures == 0 else 1)
