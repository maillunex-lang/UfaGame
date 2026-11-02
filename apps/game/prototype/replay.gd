extends RefCounted

var sequence := 0
var hp := 100

func apply(event: Dictionary) -> String:
	if event.keys().size() != 3 or not event.has_all(["seq", "kind", "hp"]):
		return "invalid"
	if typeof(event.seq) not in [TYPE_INT, TYPE_FLOAT] or typeof(event.hp) not in [TYPE_INT, TYPE_FLOAT]:
		return "invalid"
	if event.seq != int(event.seq) or event.hp != int(event.hp):
		return "invalid"
	if event.kind != "hp" or event.hp < 0 or event.hp > 100 or event.seq < 1:
		return "invalid"
	if event.seq <= sequence:
		return "duplicate"
	if event.seq != sequence + 1:
		return "gap"
	sequence = int(event.seq)
	hp = int(event.hp)
	return "applied"
