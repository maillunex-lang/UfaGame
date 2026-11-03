extends VBoxContainer
## S23/S24/S28: "Мои герои". Shows the server roster (GET /v1/heroes): levels,
## ranks with a spending plan, the main five and sync slots, protection and the
## six equipment slots. Every button sends one action with the expected current
## state (from_level / from_rank / from_upgrade); the server answers with the new
## roster, which replaces the screen. The client never computes rewards or stats.

signal changed(data: Dictionary)
signal message(text: String)

const SLOT_NAMES := {"weapon": "Оружие", "armor": "Броня", "helmet": "Шлем", "boots": "Обувь", "jewelry": "Украшение", "artifact": "Артефакт"}
const STAT_NAMES := {"hp": "здоровье", "attack": "атака", "defense": "защита", "speed": "скорость"}
const MONEY := {"gold": "Золото", "hero_exp": "Опыт героев", "rank_material": "Материалы ранга", "gems": "Самоцветы"}
const ERRORS := {
	"INSUFFICIENT_BALANCE": "Не хватает ресурсов.",
	"STALE_STATE": "Уже выполнено — экран обновлён.",
	"LEVEL_CAP": "Достигнут предел уровня ранга. Повысь ранг.",
	"NOT_MAIN_HERO": "Уровень растёт только у героев основной пятёрки.",
	"RANK_MAX": "Это наивысший ранг.",
	"COPY_NOT_ALLOWED": "Эту копию нельзя потратить (она в команде, защищена или с предметами).",
	"SYNC_SLOTS_EXCEEDED": "Все ячейки синхронизации заняты.",
	"ITEM_INCOMPATIBLE": "Этот предмет не подходит герою.",
	"UPGRADE_MAX": "Предмет улучшен до предела.",
	"HERO_NOT_OWNED": "Этого героя у тебя нет.",
}

var auth
var data: Dictionary = {}
var busy := false
var rows: Dictionary = {}  # instance id -> row container (tests read it)
var actions: Dictionary = {}  # "level:<id>", "rank:<id>", ... -> Button

func load_roster() -> Dictionary:
	var result: Dictionary = await auth.authorized_get("/v1/heroes")
	if result.ok:
		show_roster(result.data)
	return result

func explain(result: Dictionary) -> String:
	return ERRORS.get(str(result.get("detail", "")), ERRORS.get(str(result.get("code", "")), "Не получилось: " + str(result.get("detail", result.get("code", "")))))

## Sends one action; the answer is the whole roster.
func act(path: String, payload: Dictionary) -> Dictionary:
	if busy:
		return {"ok": false, "code": "BUSY"}
	busy = true
	var result: Dictionary = await auth.authorized_post(path, payload)
	busy = false
	if result.ok:
		show_roster(result.data)
		changed.emit(result.data)
	else:
		message.emit(explain(result))
		if result.get("detail") == "STALE_STATE":
			await load_roster()
	return result

func hero(id: String) -> Dictionary:
	for h in data.get("heroes", []):
		if h.id == id:
			return h
	return {}

func level_up(id: String) -> Dictionary:
	return await act("/v1/heroes/level", {"instance_id": id, "from_level": int(hero(id).level)})

## Uses as many free copies as the next rank needs; the rest is paid in materials.
func rank_plan(h: Dictionary) -> Dictionary:
	var up: Dictionary = h.get("rank_up", {}) if h.get("rank_up") != null else {}
	if up.is_empty():
		return {}
	var copies: Array = up.candidates.slice(0, int(up.copies))
	return {"copies": copies, "material": (int(up.copies) - copies.size()) * int(up.material_per_copy), "need": int(up.copies), "to": up.to_rank_name, "cap": int(up.max_level_after)}

func rank_up(id: String) -> Dictionary:
	var h := hero(id)
	return await act("/v1/heroes/rank", {"instance_id": id, "from_rank": int(h.rank), "copy_instance_ids": rank_plan(h).get("copies", [])})

func set_team(main: Array, sync: Array) -> Dictionary:
	return await act("/v1/heroes/team", {"main": main, "sync": sync})

func toggle_main(id: String) -> Dictionary:
	var main: Array = data.main.duplicate()
	var sync: Array = data.sync.duplicate()
	if id in main:
		main.erase(id)
	else:
		if main.size() >= 5:
			message.emit("В пятёрке уже 5 героев — сначала убери одного.")
			return {"ok": false}
		sync.erase(id)
		main.append(id)
	return await set_team(main, sync)

func toggle_sync(id: String) -> Dictionary:
	var main: Array = data.main.duplicate()
	var sync: Array = data.sync.duplicate()
	if id in sync:
		sync.erase(id)
	else:
		main.erase(id)
		sync.append(id)
	return await set_team(main, sync)

func equip(item_id: String, hero_id) -> Dictionary:
	return await act("/v1/items/equip", {"item_instance_id": item_id, "hero_instance_id": hero_id})

func upgrade(item_id: String) -> Dictionary:
	var upgrade_level := 0
	for i in data.get("items", []):
		if i.id == item_id:
			upgrade_level = int(i.upgrade)
	return await act("/v1/items/upgrade", {"item_instance_id": item_id, "from_upgrade": upgrade_level})

func _label(text: String, size := 18, parent: Container = null) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", size)
	(parent if parent != null else self).add_child(l)
	return l

func _button(text: String, key: String, parent: Container, callback: Callable, enabled := true) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size.y = 52
	b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	b.custom_minimum_size.x = 120
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.disabled = not enabled
	b.pressed.connect(callback)
	parent.add_child(b)
	actions[key] = b
	return b

## Two buttons per row: fits a phone in portrait.
func _grid(parent: Container) -> GridContainer:
	var g := GridContainer.new()
	g.columns = 2
	g.add_theme_constant_override("h_separation", 8)
	g.add_theme_constant_override("v_separation", 6)
	g.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(g)
	return g

func _stats(s) -> String:
	if not s is Dictionary:
		return "нет в текущей версии мира"
	return "здоровье %d · атака %d · защита %d" % [int(s.hp), int(s.attack), int(s.defense)]

func _name(id) -> String:
	var h := hero(str(id))
	return str(h.get("name", "—"))

func show_roster(value: Dictionary) -> void:
	data = value
	for child in get_children():
		child.queue_free()
	rows.clear()
	actions.clear()
	add_theme_constant_override("separation", 8)
	_label("Мои герои", 24)
	var money := []
	for key in ["gold", "hero_exp", "rank_material"]:
		money.append("%s: %d" % [MONEY[key], int(data.balances.get(key, 0))])
	_label(" · ".join(money), 16)
	var mains: int = data.main.size()
	if data.sync_level != null:
		_label("Пятёрка собрана. Синхронизация: уровень %d (самый слабый из пятёрки) для %d из %d ячеек." % [int(data.sync_level), data.sync.size(), int(data.sync_slots)], 16)
	else:
		_label("В пятёрке %d из 5. Уровень растёт только у основных героев; синхронизация включится, когда пятёрка будет полной." % mains, 16)
	if data.get("proposed", false):
		_label("Цены и пределы предварительные и могут измениться.", 14)
	var ordered: Array = []
	for id in data.main:
		ordered.append(hero(id))
	for id in data.sync:
		ordered.append(hero(id))
	for h in data.heroes:
		if h.role == null:
			ordered.append(h)
	for h in ordered:
		if h.is_empty():
			continue
		_hero_row(h)
	_items()

func _hero_row(h: Dictionary) -> void:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)
	add_child(box)
	rows[h.id] = box
	var role := ""
	if h.role == "main":
		role = " · основной №%d" % (int(h.slot) + 1)
	elif h.role == "sync":
		role = " · синхронизация"
	var level_text := "ур. %d" % int(h.effective_level)
	if int(h.effective_level) != int(h.level):
		level_text += " (свой %d)" % int(h.level)
	_label("%s%s — %s из %d · ранг «%s»%s" % [h.name, " [защищён]" if h.protected else "", level_text, int(h.max_level), h.rank_name, role], 20, box)
	_label(_stats(h.stats), 15, box)
	var line := box
	if h.next_level != null:
		_button("Уровень +1: %d зол., %d опыта" % [int(h.next_level.gold), int(h.next_level.hero_exp)], "level:" + h.id, line, func(): level_up(h.id))
	elif h.role == "main":
		_button("Предел уровня ранга", "level:" + h.id, line, func(): pass, false)
	var plan := rank_plan(h)
	if not plan.is_empty():
		var text := "Ранг «%s» (до %d ур.): копий %d из %d" % [plan.to, plan.cap, plan.copies.size(), plan.need]
		if plan.material > 0:
			text += " + %d материалов" % plan.material
		_button(text, "rank:" + h.id, box, func(): rank_up(h.id))
	var team := _grid(box)
	_button("Убрать из пятёрки" if h.role == "main" else "В пятёрку", "main:" + h.id, team, func(): toggle_main(h.id))
	if int(data.sync_slots) > 0:
		_button("Убрать из синхр." if h.role == "sync" else "В синхронизацию", "sync:" + h.id, team, func(): toggle_sync(h.id), h.role == "sync" or data.sync.size() < int(data.sync_slots))
	_button("Снять защиту" if h.protected else "Защитить", "protect:" + h.id, team, func(): act("/v1/heroes/protect", {"instance_id": h.id, "protected": not h.protected}))
	var gear := []
	for i in data.items:
		if i.equipped_on == h.id:
			gear.append("%s: %s +%d" % [SLOT_NAMES.get(i.slot, i.slot), i.name, int(i.upgrade)])
	_label("Снаряжение: " + (", ".join(gear) if not gear.is_empty() else "нет"), 15, box)
	var sep := HSeparator.new()
	box.add_child(sep)

func _items() -> void:
	_label("Предметы", 22)
	if data.items.is_empty():
		_label("Предметов пока нет. Их дают за первые победы в кампании.", 16)
		return
	for i in data.items:
		var box := VBoxContainer.new()
		add_child(box)
		var bonus := []
		for k in i.stats:
			bonus.append("%s +%d" % [STAT_NAMES.get(k, k), int(i.stats[k])])
		_label("%s · %s · улучшение %d/%d · %s · %s" % [i.name, SLOT_NAMES.get(i.slot, i.slot), int(i.upgrade), int(i.upgrade_max), ", ".join(bonus), ("на: " + _name(i.equipped_on)) if i.equipped_on != null else "в сумке"], 16, box)
		var line := _grid(box)
		var pick := OptionButton.new()
		pick.custom_minimum_size.y = 52
		pick.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var targets := []
		for h in data.heroes:
			if h.available and h.id != i.equipped_on:
				pick.add_item(str(h.name) + (" (основной)" if h.role == "main" else ""))
				targets.append(h.id)
		line.add_child(pick)
		if not targets.is_empty():
			_button("Надеть", "equip:" + i.id, line, func(): equip(i.id, targets[pick.selected]))
		if i.equipped_on != null:
			_button("Снять", "unequip:" + i.id, line, func(): equip(i.id, null))
		if i.next_upgrade_gold != null:
			_button("Улучшить: %d зол." % int(i.next_upgrade_gold), "upgrade:" + i.id, box, func(): upgrade(i.id))
