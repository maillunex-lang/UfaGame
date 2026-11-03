extends Control
## S19: vertical battle screen driven only by server frames (live_client.gd).
## Enemies at the top, the player's team at the bottom; portraits trigger the
## main ability (the server decides whether it applies).

signal closed

const STEP := 0.1
var live
var content
var field: Control
var time_label: Label
var status_label: Label
var auto_button: Button
var portraits: HBoxContainer
var result_panel: Control
var allowed_speeds: Array = [1]  # from GET /v1/vip battle.speeds (S26)
var speed := 1
var speed_buttons: Dictionary = {}
var result_label: Label
var actors: Dictionary = {}      # id -> latest actor state (hp, x, y, energy, max_hp, team, slot)
var shown: Dictionary = {}       # id -> {from: Vector2, to: Vector2, t0: float}
var floating: Array = []         # {pos, text, color, born}
var stunned: Dictionary = {}     # id -> step until
var textures: Dictionary = {}
var costs: Dictionary = {}
var names: Dictionary = {}
var portrait_nodes: Dictionary = {}
var step := 0
var auto := false
var pending_auto := false

class Field extends Control:
	var view
	func _draw() -> void:
		view.draw_field(self)

func setup(live_client, content_client) -> void:
	live = live_client
	content = content_client
	live.snapshot_received.connect(_on_snapshot)
	live.frame_received.connect(_on_frame)
	live.connection_changed.connect(func(t): status_label.text = t)
	live.command_answered.connect(_on_answer)
	live.finished.connect(_on_finished)

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var bg := ColorRect.new()
	bg.color = Color(0.12, 0.16, 0.15)
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var box := VBoxContainer.new()
	box.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	box.offset_left = 12
	box.offset_right = -12
	box.offset_top = 48
	box.offset_bottom = -24
	box.add_theme_constant_override("separation", 8)
	add_child(box)
	var top := HBoxContainer.new()
	box.add_child(top)
	time_label = Label.new()
	time_label.text = "Бой · 0.0 с"
	time_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	time_label.add_theme_font_size_override("font_size", 22)
	top.add_child(time_label)
	auto_button = Button.new()
	auto_button.text = "Авто: выкл"
	auto_button.custom_minimum_size = Vector2(150, 52)
	auto_button.pressed.connect(_toggle_auto)
	top.add_child(auto_button)
	# JSON numbers arrive as floats (4.0): compare as integers.
	allowed_speeds = allowed_speeds.map(func(x): return int(x))
	if allowed_speeds.size() > 1:
		for value in [1, 2, 4]:
			var b := Button.new()
			b.text = "×%d" % value
			b.custom_minimum_size = Vector2(56, 52)
			b.toggle_mode = true
			b.button_pressed = value == 1
			b.disabled = not (value in allowed_speeds)
			b.pressed.connect(func(): _set_speed(value))
			top.add_child(b)
			speed_buttons[value] = b
	var leave := Button.new()
	leave.text = "Выйти"
	leave.custom_minimum_size = Vector2(110, 52)
	leave.pressed.connect(_leave)
	top.add_child(leave)
	status_label = Label.new()
	status_label.add_theme_font_size_override("font_size", 16)
	status_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(status_label)
	field = Field.new()
	field.view = self
	field.size_flags_vertical = Control.SIZE_EXPAND_FILL
	field.clip_contents = true
	box.add_child(field)
	var hint := Label.new()
	hint.text = "Нажми на героя, когда энергия заполнится: он применит основную способность."
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.add_theme_font_size_override("font_size", 15)
	box.add_child(hint)
	portraits = HBoxContainer.new()
	portraits.add_theme_constant_override("separation", 6)
	portraits.custom_minimum_size.y = 150
	box.add_child(portraits)
	# Result: dimmed overlay with an opaque card in the centre.
	result_panel = Control.new()
	result_panel.visible = false
	result_panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(result_panel)
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.7)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	result_panel.add_child(dim)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	result_panel.add_child(center)
	var card := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.16, 0.22, 0.2)
	style.set_corner_radius_all(14)
	style.set_content_margin_all(24)
	card.add_theme_stylebox_override("panel", style)
	card.custom_minimum_size = Vector2(420, 0)
	center.add_child(card)
	var rbox := VBoxContainer.new()
	rbox.add_theme_constant_override("separation", 16)
	card.add_child(rbox)
	result_label = Label.new()
	result_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	result_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	result_label.add_theme_font_size_override("font_size", 26)
	rbox.add_child(result_label)
	var back := Button.new()
	back.text = "В меню"
	back.custom_minimum_size.y = 56
	back.pressed.connect(_leave)
	rbox.add_child(back)

func _hero_info() -> void:
	var bundle: Dictionary = content.active()
	var entities := {}
	for e in bundle.get("content", {}).get("entities", []):
		entities[e.id] = e
	for actor_id in live.heroes:
		var hero = entities.get(live.heroes[actor_id], {})
		names[actor_id] = str(hero.get("name", live.heroes[actor_id]))
		var data: Dictionary = hero.get("data", {})
		var main = entities.get(data.get("ability_ids", [""])[0], {})
		costs[actor_id] = int(main.get("data", {}).get("energy_cost", 1000))
		var sprite = data.get("sprite_resource_id")
		if sprite is String and not textures.has(actor_id):
			var tex = content.texture(sprite)
			if tex != null:
				textures[actor_id] = tex

func _on_snapshot(state: Dictionary) -> void:
	_hero_info()
	auto = bool(state.get("auto", false))
	step = int(state.get("step", 0))
	for a in state.actors:
		actors[a.id] = a.duplicate()
		var p := _pos(a)
		shown[a.id] = {"from": p, "to": p, "t0": 0.0}
	_build_portraits()
	_refresh()

func _on_frame(frame: Dictionary, status: String) -> void:
	var now := Time.get_ticks_msec() / 1000.0
	step = int(frame.seq)
	if status == "applied":
		auto = bool(frame.auto)
		speed = int(frame.get("speed", 1))
		for value in speed_buttons:
			speed_buttons[value].button_pressed = value == speed
		for change in frame.actors:
			if actors.has(change.id):
				var before := _current(change.id)
				actors[change.id].merge(change, true)
				shown[change.id] = {"from": before, "to": _pos(actors[change.id]), "t0": now}
	for event in frame.events:
		var kind: String = event.get("kind", "")
		if kind in ["damage", "heal", "stun", "knockback"] and actors.has(event.target_id):
			var text: String = ("-%d" % event.amount) if kind == "damage" else ("+%d" % event.amount) if kind == "heal" else ("оглушён" if kind == "stun" else "отброшен")
			var color: Color = Color(1, 0.45, 0.4) if kind == "damage" else Color(0.5, 1, 0.55) if kind == "heal" else Color(1, 0.9, 0.4)
			floating.append({"id": event.target_id, "text": text, "color": color, "born": now})
			if kind == "stun":
				stunned[event.target_id] = step + int(event.amount)
	for result in frame.command_results:
		if result.status == "rejected":
			status_label.text = "Способность не готова." if result.get("reason") == "ABILITY_NOT_READY" else "Нет связи — бой шёл автоматически."
	_refresh()

func _on_answer(_seq: int, ok: bool, code: String) -> void:
	if not ok:
		status_label.text = "Эта скорость пока недоступна." if code == "SPEED_NOT_ALLOWED" else "Команда не принята: " + code

func _on_finished(result: String, verified: bool) -> void:
	result_panel.visible = true
	result_label.text = ("Победа!" if result == "attacker_win" else "Поражение") + ("\nИтог сверен с сервером ✓" if verified else "\nИтог не совпал с сервером — пришли скриншот разработчику")

func _set_speed(value: int) -> void:
	if value == speed:
		return
	if live.set_speed(value) > 0:
		status_label.text = "Скорость ×%d…" % value

func _toggle_auto() -> void:
	if live.set_auto(not auto) > 0:
		pending_auto = true
		auto_button.text = "Авто: …"

func _leave() -> void:
	live.leave()
	closed.emit()
	queue_free()

func _pos(a: Dictionary) -> Vector2:
	# Server x (0..10000, attackers start low) -> screen y from bottom; server y -> screen x.
	var r := field.size if field != null and field.size.x > 0 else Vector2(500, 600)
	return Vector2(40 + float(a.y) / 10000.0 * (r.x - 80), r.y - 50 - float(a.x) / 10000.0 * (r.y - 100))

func _current(id: String) -> Vector2:
	var s: Dictionary = shown.get(id, {})
	if s.is_empty():
		return _pos(actors[id])
	var t: float = clamp((Time.get_ticks_msec() / 1000.0 - float(s.t0)) / (STEP / max(1, speed)), 0.0, 1.0)
	return (s.from as Vector2).lerp(s.to, t)

func _process(_delta: float) -> void:
	if field != null:
		field.queue_redraw()
	var now := Time.get_ticks_msec() / 1000.0
	floating = floating.filter(func(f): return now - float(f.born) < 0.9)

func draw_field(canvas: Control) -> void:
	var now := Time.get_ticks_msec() / 1000.0
	var font := canvas.get_theme_default_font()
	for id in actors:
		var a: Dictionary = actors[id]
		var p := _current(id)
		var alive := int(a.hp) > 0
		var tint := Color(1, 1, 1, 1.0 if alive else 0.3)
		var team_color := Color(0.25, 0.75, 0.55) if a.team == "attacker" else Color(0.85, 0.35, 0.3)
		if textures.has(id):
			var tex: Texture2D = textures[id]
			var size := 64.0
			canvas.draw_texture_rect(tex, Rect2(p - Vector2(size, size) / 2, Vector2(size, size)), false, tint)
			canvas.draw_arc(p, 36, 0, TAU, 32, team_color, 3)
		else:
			canvas.draw_circle(p, 26, Color(team_color, tint.a))
		var ratio: float = float(a.hp) / maxf(1.0, float(a.get("max_hp", 1)))
		canvas.draw_rect(Rect2(p + Vector2(-32, -48), Vector2(64, 7)), Color(0, 0, 0, 0.6))
		canvas.draw_rect(Rect2(p + Vector2(-32, -48), Vector2(64 * ratio, 7)), Color(0.35, 0.85, 0.4) if ratio > 0.3 else Color(0.95, 0.4, 0.3))
		if int(stunned.get(id, 0)) > step and alive:
			canvas.draw_string(font, p + Vector2(-30, 52), "оглушён", HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color(1, 0.9, 0.4))
	for f in floating:
		if actors.has(f.id):
			var age := now - float(f.born)
			canvas.draw_string(font, _current(f.id) + Vector2(-20, -56 - age * 40), f.text, HORIZONTAL_ALIGNMENT_LEFT, -1, 20, Color(f.color, 1.0 - age))

func _build_portraits() -> void:
	for child in portraits.get_children():
		child.queue_free()
	portrait_nodes.clear()
	var team: Array = actors.values().filter(func(a): return a.team == "attacker")
	team.sort_custom(func(a, b): return int(a.slot) < int(b.slot))
	for a in team:
		var button := Button.new()
		button.custom_minimum_size = Vector2(96, 146)
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		button.pressed.connect(_use_ability.bind(a.id))
		var box := VBoxContainer.new()
		box.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		box.mouse_filter = Control.MOUSE_FILTER_IGNORE
		button.add_child(box)
		var picture := TextureRect.new()
		picture.custom_minimum_size = Vector2(0, 64)
		picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		picture.texture = textures.get(a.id)
		picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
		box.add_child(picture)
		var label := Label.new()
		label.text = str(names.get(a.id, a.id))
		label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		label.clip_text = true
		label.mouse_filter = Control.MOUSE_FILTER_IGNORE
		box.add_child(label)
		var hp := ProgressBar.new()
		hp.show_percentage = false
		hp.custom_minimum_size.y = 10
		hp.mouse_filter = Control.MOUSE_FILTER_IGNORE
		box.add_child(hp)
		var energy := ProgressBar.new()
		energy.show_percentage = false
		energy.custom_minimum_size.y = 10
		energy.max_value = 1000
		energy.modulate = Color(0.5, 0.8, 1)
		energy.mouse_filter = Control.MOUSE_FILTER_IGNORE
		box.add_child(energy)
		portraits.add_child(button)
		portrait_nodes[a.id] = {"button": button, "hp": hp, "energy": energy}

func _use_ability(id: String) -> void:
	var a: Dictionary = actors.get(id, {})
	if a.is_empty() or int(a.hp) <= 0:
		status_label.text = "Этот герой выбыл."
		return
	if int(a.energy) < int(costs.get(id, 1000)):
		status_label.text = "Энергия ещё не накоплена."
		return
	if live.send_ability(id) > 0:
		status_label.text = "%s: способность!" % names.get(id, id)

func _refresh() -> void:
	time_label.text = "Бой · %.1f с" % (step * STEP)
	if pending_auto:
		pending_auto = false
	auto_button.text = "Авто: вкл" if auto else "Авто: выкл"
	for id in portrait_nodes:
		var n: Dictionary = portrait_nodes[id]
		var a: Dictionary = actors[id]
		n.hp.max_value = max(1, int(a.get("max_hp", 1)))
		n.hp.value = int(a.hp)
		n.energy.value = int(a.energy)
		var ready := int(a.hp) > 0 and int(a.energy) >= int(costs.get(id, 1000))
		n.button.modulate = Color(1, 1, 0.75) if ready else (Color(1, 1, 1, 0.45) if int(a.hp) <= 0 else Color.WHITE)
