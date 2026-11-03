extends VBoxContainer
## S25/S27/S29: AFK income, VIP + tutorial and summon. Everything shown comes from
## the server (GET /v1/afk, /v1/vip, /v1/summon); buttons send intents with a
## request_id that is kept until the server answers, so a retry after a network
## drop cannot pay or pull twice. The phone clock is never used.

signal message(text: String)
signal changed

const MONEY := {"gold": "золото", "gems": "самоцветы", "hero_exp": "опыт героев", "rank_material": "материалы ранга"}
const ERRORS := {
	"INSUFFICIENT_BALANCE": "Не хватает ресурсов.",
	"ALREADY_CLAIMED_TODAY": "Сегодня очки уже получены. Приходи завтра.",
	"TUTORIAL_NOT_FINISHED": "Сначала выполни все шаги обучения.",
	"TUTORIAL_ALREADY_CLAIMED": "Награда за обучение уже получена.",
	"NO_SHARDS_FOR_HERO": "Для этого героя нет осколков в призыве.",
}

var auth
var afk: Dictionary = {}
var vip: Dictionary = {}
var summon: Dictionary = {}
var busy := false
var pending: Dictionary = {}  # action key -> request_id kept until the server answers
var actions: Dictionary = {}  # tests read buttons by key

func _uuid() -> String:
	var b := Crypto.new().generate_random_bytes(16)
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	var h := b.hex_encode()
	return "%s-%s-%s-%s-%s" % [h.substr(0, 8), h.substr(8, 4), h.substr(12, 4), h.substr(16, 4), h.substr(20, 12)]

func explain(result: Dictionary) -> String:
	return ERRORS.get(str(result.get("detail", "")), ERRORS.get(str(result.get("code", "")), "Не получилось: " + str(result.get("detail", result.get("code", "")))))

## Loads the three parts one after another (one HTTP client).
func load_all() -> void:
	for part in ["afk", "vip", "summon"]:
		var r: Dictionary = await auth.authorized_get("/v1/" + part)
		set(part, r.data if r.ok else {})
	render()

## One intent; the same request_id is reused until the server gives an answer.
func send(key: String, path: String, payload: Dictionary) -> Dictionary:
	if busy:
		return {"ok": false, "code": "BUSY"}
	busy = true
	if not pending.has(key):
		pending[key] = _uuid()
	payload["request_id"] = pending[key]
	var r: Dictionary = await auth.authorized_post(path, payload)
	busy = false
	if r.ok or r.get("code") != "NETWORK_UNAVAILABLE":
		pending.erase(key)
	if not r.ok:
		message.emit(explain(r))
	return r

func claim_afk() -> Dictionary:
	var r := await send("afk", "/v1/afk/claim", {})
	if r.ok:
		afk = r.data
		var got := []
		for c in afk.claimed:
			got.append("+%d %s" % [int(afk.claimed[c]), MONEY.get(c, c)])
		message.emit("Получено: " + (", ".join(got) if not got.is_empty() else "пока ничего не накопилось"))
		render()
		changed.emit()
	return r

func claim_daily() -> Dictionary:
	var r := await send("daily", "/v1/vip/daily", {})
	if r.ok:
		vip = r.data
		message.emit("Ежедневные очки VIP получены.")
		render()
	return r

func claim_tutorial() -> Dictionary:
	var r := await send("tutorial", "/v1/tutorial/claim", {})
	if r.ok:
		vip = r.data
		message.emit("Обучение пройдено! Теперь у тебя VIP %d." % int(vip.level))
		render()
	return r

func pull(pool_id: String, count: int) -> Dictionary:
	var r := await send("pull:%s:%d" % [pool_id, count], "/v1/summon", {"pool_id": pool_id, "count": count})
	if r.ok:
		summon = r.data
		render()
		changed.emit()
	return r

func assemble(pool_id: String, hero_id: String) -> Dictionary:
	var r := await send("assemble:" + hero_id, "/v1/summon/assemble", {"pool_id": pool_id, "hero_id": hero_id})
	if r.ok:
		summon = r.data
		message.emit("Герой собран из осколков.")
		render()
		changed.emit()
	return r

func _label(text: String, size := 16) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", size)
	add_child(l)
	return l

func _button(text: String, key: String, callback: Callable, enabled := true, parent: Container = null) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(120, 52)
	b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.disabled = not enabled
	b.pressed.connect(callback)
	(parent if parent != null else self).add_child(b)
	actions[key] = b
	return b

func _money(d: Dictionary) -> String:
	var out := []
	for c in d:
		out.append("%d %s" % [int(d[c]), MONEY.get(c, c)])
	return ", ".join(out)

func render() -> void:
	for child in get_children():
		child.queue_free()
	actions.clear()
	add_theme_constant_override("separation", 8)
	if not afk.is_empty():
		_label("AFK-награды", 22)
		_label("В час: %s. Копится до %d ч (без игры тоже)." % [_money(afk.per_hour), int(afk.cap_hours)])
		var hours := float(afk.accrued_ms) / 3600000.0
		_label("Накоплено за %.1f ч: %s" % [hours, _money(afk.accrued) if not afk.accrued.is_empty() else "пока ничего"])
		_button("Забрать AFK-награды", "afk", func(): claim_afk())
	if not vip.is_empty():
		_label("VIP %d" % int(vip.level), 22)
		var next_text := "максимальный уровень" if vip.next_points == null else "до следующего: %d очков" % (int(vip.next_points) - int(vip.points))
		_label("Очки: %d · %s" % [int(vip.points), next_text])
		if int(vip.level) > 0:
			var perks := str(vip.levels[int(vip.level) - 1].perks_text)
			if perks != "":
				_label("Твои привилегии: " + perks)
		_button("Ежедневные очки VIP: +%d" % int(vip.daily.points) if vip.daily.available else "Ежедневные очки получены — приходи завтра", "daily", func(): claim_daily(), vip.daily.available)
		_label("За победы сегодня: %d из %d очков." % [int(vip.wins.today), int(vip.wins.cap)], 14)
		if not vip.tutorial.claimed:
			_label("Обучение (награда: %d очков VIP):" % int(vip.tutorial.points), 18)
			var all_done := true
			for s in vip.tutorial.steps:
				_label(("✔ " if s.done else "○ ") + str(s.name), 15)
				all_done = all_done and s.done
			_button("Получить награду за обучение", "tutorial", func(): claim_tutorial(), all_done)
	if not summon.is_empty():
		_label("Призыв", 22)
		_label("Самоцветы: %d · Золото: %d" % [int(summon.balances.get("gems", 0)), int(summon.balances.get("gold", 0))], 15)
		for p in summon.pools:
			_label("%s · цена попытки: %d (%s)" % [p.name, int(p.cost.amount), MONEY.get(p.cost.currency, p.cost.currency)], 18)
			if str(p.description) != "":
				_label(str(p.description), 14)
			var odds := []
			for o in p.odds:
				odds.append("%s%s — %s%%" % [o.name, (" (осколки ×%d)" % int(o.shards)) if o.shards != null else "", o.chance_pct])
			_label("Шансы: " + "; ".join(odds), 14)
			if p.guarantee != null:
				_label("Гарантия: %s не позже чем через %d попыт." % [", ".join(p.guarantee.hero_names), int(p.guarantee.pulls_left)], 14)
			var row := GridContainer.new()
			row.columns = 2
			row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			add_child(row)
			_button("Призвать ×1", "pull1:" + p.id, func(): pull(p.id, 1), true, row)
			_button("Призвать ×10", "pull10:" + p.id, func(): pull(p.id, 10), true, row)
			if p.shards_per_hero != null:
				for s in summon.shards:
					_button("Собрать %s из осколков (%d/%d)" % [s.name, int(s.amount), int(p.shards_per_hero)], "assemble:" + s.hero_id, func(): assemble(p.id, s.hero_id), int(s.amount) >= int(p.shards_per_hero))
		if summon.last != null:
			var got := []
			for r in summon.last:
				got.append(("%s ×%d осколков" % [r.name, int(r.shards)]) if r.shards != null else (str(r.name) + (" (гарантия)" if r.guaranteed else "")))
			_label("Выпало: " + ", ".join(got), 16)
