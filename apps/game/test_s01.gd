extends SceneTree

const Store = preload("res://prototype/store.gd")
const Replay = preload("res://prototype/replay.gd")
var failures := 0

func check(ok: bool, message: String) -> void:
	if not ok:
		failures += 1
		push_error(message)

func _initialize() -> void:
	check(preload("res://contract_registry.gd").supports(["battle.hp.v1"]), "shared registry")
	check(not preload("res://contract_registry.gd").supports(["unknown.v1"]), "incompatible capability")
	var bytes := FileAccess.get_file_as_bytes("res://prototype/events.json")
	var hash := FileAccess.get_sha256("res://prototype/events.json")
	var first := Store.retain(bytes, hash)
	check(first in ["stored", "reused"], "store")
	check(Store.retain(bytes, hash) == "reused", "repeat must reuse")
	check(Store.retain("broken".to_utf8_buffer(), hash) == "rejected", "bad hash")
	var file := FileAccess.open(Store.ROOT.path_join(hash), FileAccess.WRITE)
	file.store_string("corrupt")
	file.close()
	check(Store.retain(bytes, hash) == "stored", "repair corruption")
	var replay = Replay.new()
	var events = JSON.parse_string(bytes.get_string_from_utf8())
	check(replay.apply(events[1]) == "gap" and replay.hp == 100, "gap must not mutate")
	check(replay.apply({"seq": 1, "kind": "hp", "hp": -1}) == "invalid", "negative hp")
	for event in events:
		check(replay.apply(event) == "applied", "apply event")
		check(replay.apply(event) == "duplicate", "repeat event")
	check(replay.hp == 0 and replay.sequence == 4, "final state")
	var live = preload("res://live_replay.gd").new()
	var snapshot := {"event_seq": 2, "step": 2, "auto": true, "result": null, "actors": [{"id": "hero", "hp": 80, "x": 1, "y": 2, "energy": 10}]}
	check(live.begin(snapshot, 0), "live reconnect snapshot")
	var frame := {"seq": 1, "at_ms": 100, "actors": [{"id": "hero", "hp": 90, "x": 0, "y": 0, "energy": 0}], "events": [], "command_results": [], "auto": false, "result": null}
	check(live.apply(frame) == "replayed" and live.state.actors[0].hp == 80, "replay must not rewind snapshot")
	check(live.apply(frame) == "duplicate", "duplicate frame")
	frame.seq = 3
	check(live.apply(frame) == "gap" and live.cursor == 1, "gap cannot mutate")
	frame.seq = 2
	check(live.apply(frame) == "replayed", "replay in order")
	frame.seq = 3
	frame.actors[0].hp = 60
	check(live.apply(frame) == "applied" and live.state.actors[0].hp == 60, "new frame advances")
	frame.seq = 4
	frame.actors[0].id = "other"
	check(live.apply(frame) == "invalid" and live.cursor == 3 and live.state.actors[0].hp == 60, "invalid actor cannot mutate")
	print("S01 tests: failures=%d first=%s user_dir=%s" % [failures, first, OS.get_user_data_dir()])
	quit(0 if failures == 0 else 1)
