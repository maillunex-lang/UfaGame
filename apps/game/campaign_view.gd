extends VBoxContainer
## S22: campaign screen. Chapters from GET /v1/campaign (statuses decided by the
## server), a path of stages drawn over the chapter's area (stage points by their
## coordinates, otherwise a zigzag), boss crowns and first-clear rewards. Tapping an
## open or cleared stage emits stage_chosen; locked stages cannot be tapped.

signal stage_chosen(stage: Dictionary)

const STATUS_TEXT := {"cleared": "пройден", "open": "открыт", "locked": "закрыт"}
const COLORS := {"cleared": Color("2f8f5b"), "open": Color("e3a72f"), "locked": Color("8a948f")}
const CURRENCY := {"gold": "золото", "gems": "самоцветы"}

var campaign: Dictionary = {}
var paths: Array = []  # ChapterPath controls (tests read them)
var buttons: Dictionary = {}  # stage id -> Button

class ChapterPath:
	extends Control
	var points: Array = []  # normalized Vector2 per stage
	var stages: Array = []
	var owner_view
	func _ready() -> void:
		resized.connect(_layout)
		_layout()
	func _layout() -> void:
		var i := 0
		for stage in stages:
			var b: Button = owner_view.buttons.get(stage.id)
			if b != null:
				b.position = points[i] * size - b.size / 2.0
			i += 1
		queue_redraw()
	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), Color("eef1ed"))
		for i in range(1, points.size()):
			var done: bool = stages[i - 1].status == "cleared"
			draw_line(points[i - 1] * size, points[i] * size, Color("2f8f5b") if done else Color("b9c2bd"), 6.0 if done else 4.0, true)
		for i in points.size():
			var c: Vector2 = points[i] * size
			draw_circle(c, 30.0 if stages[i].boss else 24.0, COLORS.get(stages[i].status, Color.GRAY))

func show_campaign(data: Dictionary, bundle: Dictionary, balances: Array) -> void:
	for child in get_children():
		child.queue_free()
	campaign = data
	paths.clear()
	buttons.clear()
	add_theme_constant_override("separation", 10)
	var money := []
	for b in balances:
		money.append("%s: %d" % [str(CURRENCY.get(b.currency, b.currency)).capitalize(), int(b.amount)])
	_label("Кампания" + ("  ·  " + ", ".join(money) if not money.is_empty() else ""), 24)
	var chapters: Array = data.get("chapters", [])
	if chapters.is_empty():
		_label("Глав пока нет. В Studio создай главу из этапов и опубликуй — она появится здесь.", 18)
		return
	var places := {}
	for e in bundle.get("content", {}).get("entities", []):
		if e.get("kind") == "location":
			places[e.id] = e
	for chapter in chapters:
		var title := "Глава %d. %s" % [int(chapter.order), str(chapter.name)]
		if chapter.get("location_id") != null and places.has(chapter.location_id):
			title += " — " + str(places[chapter.location_id].name)
		_label(title, 22)
		if chapter.get("proposed", false):
			_label("Маршрут предварительный и может измениться.", 16)
		var path := ChapterPath.new()
		path.owner_view = self
		path.stages = chapter.stages
		path.points = _points(chapter.stages, places)
		path.custom_minimum_size = Vector2(0, max(240, 90 * chapter.stages.size()) if not _has_geo(chapter.stages, places) else 320)
		path.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		path.clip_contents = true
		add_child(path)
		paths.append(path)
		var n := 0
		for stage in chapter.stages:
			n += 1
			var b := Button.new()
			b.text = str(n) + ("\nБОСС" if stage.boss else "")
			b.custom_minimum_size = Vector2(64, 64)
			b.flat = true
			b.disabled = stage.status == "locked"
			b.tooltip_text = str(stage.name)
			b.pressed.connect(func(): stage_chosen.emit(stage))
			path.add_child(b)
			buttons[stage.id] = b
		for stage in chapter.stages:
			var row := Button.new()
			row.alignment = HORIZONTAL_ALIGNMENT_LEFT
			row.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.custom_minimum_size.y = 54
			row.text = "%s%s — %s%s" % [str(stage.name), " (босс)" if stage.boss else "", STATUS_TEXT.get(stage.status, stage.status), _reward_text(stage)]
			row.disabled = stage.status == "locked"
			row.pressed.connect(func(): stage_chosen.emit(stage))
			add_child(row)

static func reward_list(stage: Dictionary) -> String:
	var parts := []
	for r in stage.get("rewards_first", []):
		parts.append("+%d %s" % [int(r.amount), CURRENCY.get(r.currency, r.currency)])
	return ", ".join(parts)

func _reward_text(stage: Dictionary) -> String:
	var text := reward_list(stage)
	if text == "" or stage.status == "cleared":
		return ""
	return " · награда: " + text

func find_stage(stage_id: String) -> Dictionary:
	for chapter in campaign.get("chapters", []):
		for stage in chapter.stages:
			if stage.id == stage_id:
				return stage
	return {}

func _label(text: String, size: int) -> void:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", size)
	add_child(l)

func _coords(stage: Dictionary, places: Dictionary):
	var place = places.get(stage.get("location_id"))
	if place == null:
		return null
	var d: Dictionary = place.get("data", {})
	if not d.has("lat_e6") or not d.has("lon_e6"):
		return null
	return Vector2(float(d.lon_e6), -float(d.lat_e6))

func _has_geo(stages: Array, places: Dictionary) -> bool:
	if stages.size() < 2:
		return false
	var seen := {}
	for s in stages:
		var c = _coords(s, places)
		if c == null:
			return false
		seen[c] = true
	return seen.size() == stages.size()

## Stage points inside [0.12, 0.88]: real coordinates when every stage has its own
## map point, otherwise a top-down zigzag.
func _points(stages: Array, places: Dictionary) -> Array:
	var result := []
	if _has_geo(stages, places):
		var all := stages.map(func(s): return _coords(s, places))
		var lo: Vector2 = all[0]
		var hi: Vector2 = all[0]
		for c in all:
			lo = Vector2(min(lo.x, c.x), min(lo.y, c.y))
			hi = Vector2(max(hi.x, c.x), max(hi.y, c.y))
		var span := Vector2(max(hi.x - lo.x, 1.0), max(hi.y - lo.y, 1.0))
		for c in all:
			result.append(Vector2(0.12, 0.12) + (c - lo) / span * 0.76)
		return result
	var n := stages.size()
	for i in n:
		var y := 0.5 if n == 1 else 0.12 + 0.76 * float(i) / float(n - 1)
		result.append(Vector2(0.3 if i % 2 == 0 else 0.7, y))
	return result
