extends SceneTree
## Real Godot heroes (S23/S24/S28): roster screen actions against the real API.

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
		push_error("Heroes smoke: " + name)
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
	content.root = "user://heroes-test-" + str(Time.get_ticks_usec())
	content.auth = auth
	get_root().add_child(content)
	content.http.set_tls_options(TLSOptions.client(certificate))
	check((await content.sync()).ok, "content with heroes.progression.v1 accepted by this client")
	var view = load("res://heroes_view.gd").new()
	view.auth = auth
	view.size = Vector2(720, 3000)
	get_root().add_child(view)
	var messages := []
	view.message.connect(func(t): messages.append(t))
	check((await view.load_roster()).ok, "roster loaded")
	check(view.data.heroes.size() == 8 and view.data.main.size() == 5, "starter heroes, main five filled")
	var a1: String = view.data.main[0]
	check(view.rows.has(a1) and view.actions.has("level:" + a1), "level button for a main hero")
	check(view.actions["level:" + a1].text.contains("10 зол."), "cost shown from the server: " + view.actions["level:" + a1].text)
	# Shortage: the server refuses, the player sees why.
	await view.level_up(a1)
	check(messages.size() > 0 and messages[-1] == "Не хватает ресурсов.", "shortage explained")
	print("GRANT_FOR " + str(auth.state.session.player_id))
	check(await wait_until(func(): return true, 0.1), "tick")
	var granted := false
	for i in 50:
		await view.load_roster()
		if int(view.data.balances.get("gold", 0)) >= 1000 and int(view.data.balances.get("rank_material", 0)) >= 100:
			granted = true
			break
		await create_timer(0.2).timeout
	check(granted, "test resources granted")
	# Double tap on the same button: one level, paid once.
	view.actions["level:" + a1].pressed.emit()
	view.actions["level:" + a1].pressed.emit()
	check(await wait_until(func(): return not view.busy and int(view.hero(a1).level) == 2, 10.0), "one level after a double tap")
	check(int(view.data.balances.gold) == 990, "gold spent once")
	var stale: Dictionary = await auth.authorized_post("/v1/heroes/level", {"instance_id": a1, "from_level": 1})
	check(not stale.ok and view.explain(stale) == "Уже выполнено — экран обновлён.", "repeat of an old tap is refused")
	# Rank plan: two free copies, no materials.
	var plan: Dictionary = view.rank_plan(view.hero(a1))
	check(plan.copies.size() == 2 and plan.material == 0, "rank plan uses two copies")
	check(view.actions["rank:" + a1].text.contains("копий 2 из 2"), "plan shown: " + view.actions["rank:" + a1].text)
	check((await view.rank_up(a1)).ok and int(view.hero(a1).rank) == 1 and view.data.heroes.size() == 6, "rank up spent the copies")
	# Sync: b2 into sync; level is the weakest main level.
	var spare := ""
	for h in view.data.heroes:
		if h.role == null:
			spare = h.id
	check(spare != "" and (await view.toggle_sync(spare)).ok, "hero into sync")
	check(view.hero(spare).role == "sync" and int(view.data.sync_level) == 1 and int(view.hero(spare).effective_level) == 1, "sync level = weakest main")
	check(not (await view.toggle_main(spare)).ok or view.data.main.size() == 5, "full five: no sixth main")
	# Equipment.
	var sword := ""
	for i in view.data.items:
		if i.item_id == "item_sword":
			sword = i.id
	var before: int = int(view.hero(a1).stats.attack)
	check((await view.equip(sword, a1)).ok and int(view.hero(a1).stats.attack) == before + 100, "sword adds attack on the server")
	check((await view.upgrade(sword)).ok and int(view.hero(a1).stats.attack) == before + 150, "upgrade +50%")
	# Battle with the owned hero; first clear grants a hero and an item.
	var live = load("res://live_client.gd").new()
	live.auth = auth
	live.tls_options = TLSOptions.client(certificate)
	get_root().add_child(live)
	var battle = load("res://battle_view.gd").new()
	get_root().add_child(battle)
	battle.setup(live, content)
	live.finished.connect(func(result, verified): ended = {"result": result, "verified": verified})
	check((await live.start("stage_one", [a1], true)).ok, "battle with an owned instance")
	live.set_auto(true)
	check(await wait_until(func(): return not ended.is_empty(), 60.0), "battle finished")
	check(ended.get("result") == "attacker_win" and ended.get("verified", false), "server-verified win")
	await view.load_roster()
	check(view.data.heroes.any(func(h): return h.hero_id == "hero_f") and view.data.items.any(func(i): return i.item_id == "item_bow"), "reward hero and item in the roster")
	print("GODOT_HEROES_OK failures=%d" % failures)
	quit(0 if failures == 0 else 1)
