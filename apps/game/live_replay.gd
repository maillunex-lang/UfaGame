extends RefCounted
## Server frames are ordered separately from the latest snapshot. Replayed frames
## can animate after reconnect but must not rewind that snapshot's state.

var cursor := 0
var snapshot_sequence := 0
var state: Dictionary = {}

func begin(snapshot: Dictionary, after: int) -> bool:
	if not snapshot.has_all(["event_seq", "actors", "step", "result", "auto"]) or not snapshot.actors is Array:
		return false
	if typeof(snapshot.event_seq) not in [TYPE_INT, TYPE_FLOAT] or snapshot.event_seq != int(snapshot.event_seq):
		return false
	if after < 0 or after > int(snapshot.event_seq) or snapshot.event_seq > 900:
		return false
	var ids := {}
	for actor in snapshot.actors:
		if not actor is Dictionary or not actor.has("id") or not actor.id is String or ids.has(actor.id):
			return false
		ids[actor.id] = true
	cursor = after
	snapshot_sequence = int(snapshot.event_seq)
	state = snapshot.duplicate(true)
	return true

func apply(frame: Dictionary) -> String:
	if not frame.has_all(["seq", "at_ms", "actors", "events", "command_results", "auto", "result"]):
		return "invalid"
	if typeof(frame.seq) not in [TYPE_INT, TYPE_FLOAT] or frame.seq != int(frame.seq):
		return "invalid"
	var seq := int(frame.seq)
	if seq < 1 or seq > 900 or not frame.actors is Array or not frame.events is Array:
		return "invalid"
	if seq <= cursor:
		return "duplicate"
	if seq != cursor + 1:
		return "gap"
	if seq > snapshot_sequence:
		var by_id := {}
		for actor in state.actors:
			by_id[actor.id] = actor
		var changed_ids := {}
		for actor in frame.actors:
			if not actor is Dictionary or not actor.has_all(["id", "hp", "x", "y", "energy"]) or not by_id.has(actor.id) or changed_ids.has(actor.id):
				return "invalid"
			changed_ids[actor.id] = true
		if frame.actors.size() != state.actors.size():
			return "invalid"
		var updated: Array = state.actors.duplicate(true)
		for actor in updated:
			for change in frame.actors:
				if change.id == actor.id:
					actor.merge(change, true)
		state.actors = updated
		state.step = seq
		state.event_seq = seq
		state.auto = frame.auto
		state.result = frame.result
	cursor = seq
	return "replayed" if seq <= snapshot_sequence else "applied"
