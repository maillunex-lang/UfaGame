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
	print("S01 tests: failures=%d first=%s user_dir=%s" % [failures, first, OS.get_user_data_dir()])
	quit(0 if failures == 0 else 1)
