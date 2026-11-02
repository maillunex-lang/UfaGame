extends Control

const Store = preload("res://prototype/store.gd")
const Replay = preload("res://prototype/replay.gd")
var replay = Replay.new()
var events: Array = []
var index := 0
var text: Label
var status: Label
var base_url: LineEdit
var auth
var busy := false
var column: VBoxContainer

func label(value: String) -> Label:
	var item := Label.new()
	item.text = value
	item.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	item.add_theme_font_size_override("font_size", 20)
	column.add_child(item)
	return item

func field(placeholder: String, secret := false) -> LineEdit:
	var item := LineEdit.new()
	item.placeholder_text = placeholder
	item.secret = secret
	item.custom_minimum_size.y = 54
	item.max_length = 512
	column.add_child(item)
	return item

func action(title: String, callback: Callable) -> void:
	var button := Button.new()
	button.text = title
	button.custom_minimum_size.y = 54
	button.pressed.connect(callback)
	column.add_child(button)

func _ready() -> void:
	assert(preload("res://contract_registry.gd").supports(["battle.hp.v1", "auth.guest.v1"]))
	var scroll := ScrollContainer.new()
	scroll.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	scroll.offset_left = 20
	scroll.offset_right = -20
	scroll.offset_top = 60
	scroll.offset_bottom = -30
	add_child(scroll)
	column = VBoxContainer.new()
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_theme_constant_override("separation", 14)
	scroll.add_child(column)
	label("UfaGame — техническая сборка")
	text = label("")
	var bytes := FileAccess.get_file_as_bytes("res://prototype/events.json")
	var result := Store.retain(bytes, FileAccess.get_sha256("res://prototype/events.json"))
	events = JSON.parse_string(bytes.get_string_from_utf8())
	label("Ресурс: " + result + "\n" + OS.get_user_data_dir())
	text.text = "Локальная запись событий. HP: 100"
	auth = preload("res://auth_client.gd").new()
	add_child(auth)
	label("Гостевой аккаунт")
	base_url = field("HTTPS-адрес тестового сервера")
	base_url.text = auth.state.get("base_url", "")
	status = label("Для аккаунта нужен тестовый сервер. Локальный HP выше — только запись.")
	action("Подключиться / продолжить гостя", _connect)
	var timer := Timer.new()
	timer.wait_time = 1.0
	timer.timeout.connect(_tick)
	add_child(timer)
	timer.start()

func _connect() -> void:
	if busy:
		return
	busy = true
	status.text = "Подключение…"
	var result: Dictionary = await auth.connect_guest(base_url.text.strip_edges())
	if result.ok:
		status.text = "Игрок: " + str(result.data.player_id) + "\nБаланс: " + JSON.stringify(result.data.balances)
	else:
		status.text = "Не удалось подключиться: " + str(result.code) + "\nСохраненные данные не удалены."
	busy = false

func _tick() -> void:
	if index >= events.size():
		return
	var result: String = replay.apply(events[index])
	index += 1
	text.text = "Локальное событие: %d / %s\nHP: %d" % [index, result, replay.hp]
