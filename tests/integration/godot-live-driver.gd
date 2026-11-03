extends SceneTree
## Real Godot live battle client (S19) against the API behind a TLS + WebSocket front.

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
var seen: Dictionary = {}   # frame seq -> times it changed/animated state
var answers: Array = []
var applied_results: Array = []
var ended := {}

func check(value: bool, name: String) -> void:
	if not value:
		failures += 1
		push_error("Live smoke: " + name)
		print("FAIL: " + name)

func _initialize() -> void:
	call_deferred("run")

func client():
	var live = load("res://live_client.gd").new()
	live.auth = auth
	live.tls_options = TLSOptions.client(certificate)
	get_root().add_child(live)
	live.frame_received.connect(func(frame, status):
		if status != "duplicate":
			seen[int(frame.seq)] = int(seen.get(int(frame.seq), 0)) + 1
		for r in frame.command_results:
			applied_results.append(r))
	live.command_answered.connect(func(seq, ok, code): answers.append([seq, ok, code]))
	live.finished.connect(func(result, verified): ended = {"result": result, "verified": verified})
	return live

func wait_until(condition: Callable, seconds := 20.0) -> bool:
	var limit := Time.get_ticks_msec() + int(seconds * 1000)
	while Time.get_ticks_msec() < limit:
		if condition.call():
			return true
		await process_frame
	return false

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
	var connected: Dictionary = await auth.connect_guest(OS.get_environment("UFA_AUTH_TEST_URL"))
	check(connected.ok, "guest session")
	DirAccess.remove_absolute("user://live_battle.json")
	var content = load("res://content_client.gd").new()
	content.root = "user://live-test-" + str(Time.get_ticks_usec())
	content.auth = auth
	get_root().add_child(content)
	content.http.set_tls_options(TLSOptions.client(certificate))
	var synced: Dictionary = await content.sync()
	check(synced.ok, "content bundle for names and costs")
	var live = client()
	var view = load("res://battle_view.gd").new()
	get_root().add_child(view)
	view.setup(live, content)
	var started: Dictionary = await live.start("stage_one", ["hero_one"])
	check(started.ok and not started.get("resumed", true), "battle created")
	check(await wait_until(func(): return seen.size() >= 3), "first frames arrive")
	# Too early (still walking): the server refuses, the client reports it.
	check(live.send_ability("atk_0") > 0, "early ability command sent")
	check(await wait_until(func(): return applied_results.size() > 0, 5.0), "server answers an early tap within 1 s (applied in reach, otherwise refused)")
	# In range (the hero already hits): the manual main ability is applied.
	var hits := [false]
	live.frame_received.connect(func(frame, _s):
		for e in frame.events:
			if e.get("source_id") == "atk_0" and e.get("kind") == "damage":
				hits[0] = true)
	check(await wait_until(func(): return hits[0]), "hero reached the enemy")
	applied_results.clear()
	check(live.send_ability("atk_0") > 0, "ability command sent")
	check(await wait_until(func(): return applied_results.any(func(r): return r.status == "applied")), "server applied the manual ability")
	check(view.actors.has("atk_0") and view.portrait_nodes.has("atk_0"), "battle screen shows the player's hero")
	check(live.set_auto(true) > 0, "auto toggle sent")
	check(await wait_until(func(): return live.replay.state.get("auto") == true), "auto mode confirmed by a server frame")
	# Network drop: the client reconnects from its cursor without losing frames.
	var before: int = live.replay.cursor
	live.ws.close(4001, "TEST_DROP")
	check(await wait_until(func(): return live.replay.cursor > before + 3, 15.0), "reconnected and continued")
	# App restart: a new client finds the unfinished battle and resumes it.
	live._save()  # what the app has saved when it is closed
	var cursor_at_exit: int = live.replay.cursor
	live.leave()
	view.queue_free()
	await process_frame
	var resumed = client()
	var view2 = load("res://battle_view.gd").new()
	get_root().add_child(view2)
	view2.setup(resumed, content)
	var again: Dictionary = await resumed.start("stage_one", ["hero_one"])
	check(again.ok and again.get("resumed", false), "unfinished battle resumed after restart")
	check(resumed.battle_id == live.battle_id and resumed.replay.cursor >= cursor_at_exit, "same battle, no rewind")
	check(await wait_until(func(): return not ended.is_empty(), 60.0), "battle finished")
	if ended.is_empty():
		print("DEBUG stuck cursor=%d step=%s result=%s ws=%s attempts=%d reconnect_at=%f done=%s" % [resumed.replay.cursor, str(resumed.replay.state.get("step")), str(resumed.replay.state.get("result")), str(resumed.ws.get_ready_state() if resumed.ws else -1), resumed.attempts, resumed.reconnect_at, str(resumed.done)])
	check(ended.get("verified", false), "shown final state equals the server snapshot")
	check(ended.get("result") in ["attacker_win", "attacker_loss"], "result from server")
	var last: int = resumed.replay.cursor
	var missing := []
	for seq in range(1, last + 1):
		if not seen.has(seq):
			missing.append(seq)
	check(missing.is_empty(), "every frame 1..%d was seen (missing %s)" % [last, str(missing)])
	check(view2.result_panel.visible, "result panel shown")
	check(not FileAccess.file_exists("user://live_battle.json"), "local battle marker cleared")
	print("GODOT_LIVE_OK failures=%d frames=%d answers=%d" % [failures, last, answers.size()])
	quit(0 if failures == 0 else 1)
