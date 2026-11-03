extends VBoxContainer
## S30: quests and achievements from GET /v1/quests. Progress and "ready" come from
## the server; "Забрать" sends the quest id with a request_id kept until an answer.

signal message(text: String)
signal changed

const MONEY := {"gold": "золото", "gems": "самоцветы", "hero_exp": "опыт героев", "rank_material": "материалы ранга", "vip_points": "очки VIP"}
const STATUS := {"locked": "откроется позже", "active": "в процессе", "ready": "готово!", "claimed": "награда получена"}

var auth
var data: Dictionary = {}
var busy := false
var pending: Dictionary = {}
var actions: Dictionary = {}

func _uuid() -> String:
	var b := Crypto.new().generate_random_bytes(16)
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	var h := b.hex_encode()
	return "%s-%s-%s-%s-%s" % [h.substr(0, 8), h.substr(8, 4), h.substr(12, 4), h.substr(16, 4), h.substr(20, 12)]

func load_quests() -> Dictionary:
	var r: Dictionary = await auth.authorized_get("/v1/quests")
	data = r.data if r.ok else {}
	render()
	return r

func claim(quest_id: String) -> Dictionary:
	if busy:
		return {"ok": false, "code": "BUSY"}
	busy = true
	if not pending.has(quest_id):
		pending[quest_id] = _uuid()
	var r: Dictionary = await auth.authorized_post("/v1/quests/claim", {"request_id": pending[quest_id], "quest_id": quest_id})
	busy = false
	if r.ok or r.get("code") != "NETWORK_UNAVAILABLE":
		pending.erase(quest_id)
	if r.ok:
		data = r.data
		message.emit("Награда за задание получена.")
		render()
		changed.emit()
	else:
		var d := str(r.get("detail", ""))
		message.emit({"ALREADY_CLAIMED": "Награда уже получена.", "QUEST_NOT_COMPLETE": "Задание ещё не выполнено.", "QUEST_LOCKED": "Задание ещё закрыто."}.get(d, "Не получилось: " + d))
		await load_quests()
	return r

func _label(text: String, size := 16, parent: Container = null) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", size)
	(parent if parent != null else self).add_child(l)
	return l

func render() -> void:
	for child in get_children():
		child.queue_free()
	actions.clear()
	if data.is_empty() or data.quests.is_empty():
		return
	add_theme_constant_override("separation", 8)
	_label("Задания", 22)
	for q in data.quests:
		var box := VBoxContainer.new()
		add_child(box)
		var kind := "Ежедневное" if q.period == "daily" else "Достижение"
		_label("%s — %s" % [q.name, STATUS.get(q.status, q.status)], 18, box)
		if str(q.description) != "":
			_label(str(q.description), 14, box)
		var reward := []
		for r in q.rewards:
			reward.append("+%d %s" % [int(r.amount), MONEY.get(r.currency, r.currency)])
		for h in q.reward_heroes:
			reward.append("герой %s" % h)
		_label("%s · %d / %d%s · награда: %s" % [kind, int(q.progress), int(q.target), (" · этап «%s»" % q.stage_name) if q.stage_name != null else "", ", ".join(reward)], 14, box)
		var bar := ProgressBar.new()
		bar.max_value = max(1, int(q.target))
		bar.value = int(q.progress)
		bar.show_percentage = false
		bar.custom_minimum_size.y = 12
		box.add_child(bar)
		if q.status == "ready":
			var b := Button.new()
			b.text = "Забрать награду"
			b.custom_minimum_size.y = 52
			b.pressed.connect(func(): claim(q.id))
			box.add_child(b)
			actions["claim:" + q.id] = b
