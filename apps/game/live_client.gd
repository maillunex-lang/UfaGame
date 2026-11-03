extends Node
## S19: live battle client. Server frames drive everything; the client never
## decides results. Uses live_replay.gd for ordering (duplicates/gaps/replays).

signal snapshot_received(state: Dictionary)
signal frame_received(frame: Dictionary, status: String)
signal command_answered(seq: int, ok: bool, code: String)
signal connection_changed(text: String)
signal finished(result: String, verified: bool)

const Replay = preload("res://live_replay.gd")
const SAVE_PATH := "user://live_battle.json"
var auth
var tls_options: TLSOptions = null
var replay = Replay.new()
var battle_id := ""
var heroes: Dictionary = {}
var ws: WebSocketPeer
var last_seq := 0
var attempts := 0
var reconnect_at := -1.0
var closing := false
var done := false
var event_log: Array = []  ## every applied event (for the replay log on screen)

func _process(_delta: float) -> void:
	if reconnect_at >= 0.0 and Time.get_ticks_msec() / 1000.0 >= reconnect_at:
		reconnect_at = -1.0
		_open()
	if ws == null:
		return
	ws.poll()
	while ws != null and ws.get_available_packet_count() > 0:
		var parsed = JSON.parse_string(ws.get_packet().get_string_from_utf8())
		if parsed is Dictionary:
			_handle(parsed)
	if ws != null and ws.get_ready_state() == WebSocketPeer.STATE_CLOSED:
		var code := ws.get_close_code()
		if OS.get_environment("UFA_LIVE_DEBUG") != "":
			print("DEBUG close code=%d reason=%s cursor=%d result=%s" % [code, ws.get_close_reason(), replay.cursor, str(replay.state.get("result"))])
		ws = null
		if done or closing:
			return
		if code == 1000 and replay.state.get("result") != null:
			_finish()
			return
		_schedule_reconnect()

func _save() -> void:
	var file := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if file:
		file.store_string(JSON.stringify({"battle_id": battle_id, "last_seq": last_seq, "cursor": replay.cursor}))

func _load() -> Dictionary:
	if not FileAccess.file_exists(SAVE_PATH):
		return {}
	var data = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
	return data if data is Dictionary else {}

func _uuid() -> String:
	var bytes := Crypto.new().generate_random_bytes(16)
	bytes[6] = (bytes[6] & 15) | 64
	bytes[8] = (bytes[8] & 63) | 128
	var h := bytes.hex_encode()
	return "%s-%s-%s-%s-%s" % [h.substr(0, 8), h.substr(8, 4), h.substr(12, 4), h.substr(16, 4), h.substr(20, 12)]

## Starts a new battle, or resumes the unfinished one. Returns {ok, code?}.
## With hero progression `use_instances` sends the player's hero instances.
func start(stage_id: String, hero_ids: Array, use_instances := false) -> Dictionary:
	var active: Dictionary = await auth.call_api("/v1/live-battles/active", null, true)
	if not active.ok and active.get("status") == 401:
		var refreshed: Dictionary = await auth.refresh_session()
		if not refreshed.ok:
			return refreshed
		active = await auth.call_api("/v1/live-battles/active", null, true)
	var snapshot: Dictionary
	if active.ok:
		snapshot = active.data
	else:
		var created: Dictionary = await auth.authorized_post("/v1/live-battles", {"request_id": _uuid(), "stage_id": stage_id, ("instance_ids" if use_instances else "hero_ids"): hero_ids})
		if not created.ok:
			return created
		snapshot = created.data
	_attach(snapshot)
	return {"ok": true, "resumed": active.ok}

func _attach(snapshot: Dictionary) -> void:
	var saved := _load()
	battle_id = str(snapshot.battle_id)
	heroes = snapshot.get("heroes", {})
	last_seq = max(int(snapshot.get("last_command_seq", 0)), int(saved.get("last_seq", 0)) if saved.get("battle_id") == battle_id else 0)
	done = false
	closing = false
	event_log.clear()
	replay = Replay.new()
	# After an app restart, continue from the last frame this device showed so the
	# missed frames are replayed (animated) instead of silently skipped.
	var from := int(snapshot.event_seq)
	if saved.get("battle_id") == battle_id:
		from = clampi(int(saved.get("cursor", from)), 0, int(snapshot.event_seq))
	replay.begin(snapshot, from)
	_save()
	snapshot_received.emit(replay.state)
	_open()

func _open() -> void:
	var base: String = auth.state.get("base_url", "")
	var url := base.replace("https://", "wss://") + "/v1/live-battles/%s/stream?after=%d" % [battle_id, replay.cursor]
	ws = WebSocketPeer.new()
	ws.handshake_headers = PackedStringArray(["Authorization: Bearer " + str(auth.state.get("session", {}).get("access_token", ""))])
	ws.inbound_buffer_size = 1 << 20
	if ws.connect_to_url(url, tls_options) != OK:
		ws = null
		_schedule_reconnect()
		return
	connection_changed.emit("Подключение…" if attempts == 0 else "Восстанавливаем связь…")

func _schedule_reconnect() -> void:
	attempts += 1
	if attempts > 6:
		connection_changed.emit("Нет связи. Бой продолжается на сервере автоматически.")
		# The stream is gone: if the battle has already ended, take the result by HTTP.
		var server: Dictionary = await auth.call_api("/v1/live-battles/" + battle_id, null, true)
		if server.ok and server.data.get("result") != null and not done:
			replay.begin(server.data, int(server.data.event_seq))
			snapshot_received.emit(replay.state)
			_finish()
		return
	connection_changed.emit("Связь потеряна, переподключение… (сервер ведёт бой сам)")
	if attempts == 2 or attempts == 4:
		await auth.refresh_session()  # the access token may have expired
	reconnect_at = Time.get_ticks_msec() / 1000.0 + min(8.0, pow(2.0, attempts - 1))

func _handle(message: Dictionary) -> void:
	match message.get("type"):
		"snapshot":
			attempts = 0
			var snapshot: Dictionary = message.snapshot
			var after: int = replay.cursor
			if int(snapshot.event_seq) < after:
				after = int(snapshot.event_seq)
			replay.begin(snapshot, after)
			last_seq = max(last_seq, int(snapshot.get("last_command_seq", 0)))
			connection_changed.emit("")
			snapshot_received.emit(replay.state)
		"frame":
			var frame: Dictionary = message.frame
			var status: String = replay.apply(frame)
			if status == "gap" or status == "invalid":
				closing = false
				ws.close(4000, "RESYNC")
				return
			if status != "duplicate":
				for event in frame.events:
					event_log.append(event)
				if replay.cursor % 5 == 0:
					_save()
			frame_received.emit(frame, status)
			if frame.result != null and replay.cursor >= replay.snapshot_sequence:
				_finish()
		"ack":
			command_answered.emit(int(message.ack.get("seq", 0)), true, "")
		"error":
			command_answered.emit(int(message.get("seq", 0)), false, str(message.get("code", "ERROR")))

func send_ability(actor_id: String) -> int:
	return _send({"type": "ability", "actor_id": actor_id})

func set_auto(enabled: bool) -> int:
	return _send({"type": "auto", "enabled": enabled})

## ×1/×2/×4 (S26): the server checks the right and changes only real time per step.
func set_speed(value: int) -> int:
	return _send({"type": "speed", "value": value})

func _send(command: Dictionary) -> int:
	if ws == null or ws.get_ready_state() != WebSocketPeer.STATE_OPEN or done:
		return 0
	last_seq += 1
	_save()
	command.seq = last_seq
	command.for_step = min(900, int(replay.state.get("step", 0)) + 3)  # next steps; server accepts up to 5 ahead
	ws.send_text(JSON.stringify(command))
	return last_seq

## Compares what was shown with the server's final snapshot (hp, position, energy).
func _finish() -> void:
	if done:
		return
	done = true
	closing = true
	if ws != null:
		ws.close(1000)
		ws = null
	var server: Dictionary = await auth.call_api("/v1/live-battles/" + battle_id, null, true)
	var verified := false
	if server.ok and server.data.get("result") == replay.state.get("result"):
		verified = true
		var shown := {}
		for actor in replay.state.actors:
			shown[actor.id] = actor
		for actor in server.data.actors:
			var mine = shown.get(actor.id)
			if mine == null or int(mine.hp) != int(actor.hp) or int(mine.x) != int(actor.x) or int(mine.y) != int(actor.y) or int(mine.energy) != int(actor.energy):
				verified = false
	DirAccess.remove_absolute(SAVE_PATH)
	finished.emit(str(replay.state.get("result")), verified)

func leave() -> void:
	closing = true
	reconnect_at = -1.0
	if ws != null:
		ws.close(1000)
		ws = null
