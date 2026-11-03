extends Control
## S16: Russian entry screen, content loader and a minimal hub from published content.
## Account management (bind/login/recover) from S06/S07 stays below.

const DEFAULT_SERVER := "https://tts-ufa.ru/game/server"
var status: Label
var base_url: LineEdit
var auth
var content
var login_field: LineEdit
var password_field: LineEdit
var recovery_field: LineEdit
var recovery_output: LineEdit
var busy := false
var column: VBoxContainer
var progress: ProgressBar
var progress_label: Label
var hub: VBoxContainer
var download_all_button: Button

func label(value: String, size := 20, parent: Container = null) -> Label:
	var item := Label.new()
	item.text = value
	item.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	item.add_theme_font_size_override("font_size", size)
	(parent if parent != null else column).add_child(item)
	return item

func field(placeholder: String, secret := false) -> LineEdit:
	var item := LineEdit.new()
	item.placeholder_text = placeholder
	item.secret = secret
	item.custom_minimum_size.y = 54
	item.max_length = 512
	column.add_child(item)
	return item

func action(title: String, callback: Callable) -> Button:
	var button := Button.new()
	button.text = title
	button.custom_minimum_size.y = 54
	button.pressed.connect(callback)
	column.add_child(button)
	return button

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
	auth = preload("res://auth_client.gd").new()
	add_child(auth)
	content = preload("res://content_client.gd").new()
	content.auth = auth
	add_child(content)
	content.progress_changed.connect(_on_progress)
	label("UfaGame", 32)
	label("Добро пожаловать в Башкортостан! Сначала игра войдёт гостем и скачает описание мира и картинки героев. Скачанное хранится на телефоне и повторно не загружается.")
	base_url = field("Адрес игрового сервера")
	base_url.text = auth.state.get("base_url", DEFAULT_SERVER)
	action("Играть (вход гостем)", _start)
	progress = ProgressBar.new()
	progress.custom_minimum_size.y = 24
	progress.visible = false
	column.add_child(progress)
	progress_label = label("")
	status = label("")
	download_all_button = action("Скачать всё (звуки и остальные файлы)", _download_all)
	download_all_button.visible = false
	hub = VBoxContainer.new()
	hub.add_theme_constant_override("separation", 10)
	column.add_child(hub)
	_build_account()
	_show_hub()
	if auth.state.has("session"):
		_start()

func _on_progress(done: int, total: int) -> void:
	progress.visible = true
	progress.max_value = max(total, 1)
	progress.value = done
	progress_label.text = "Загрузка файла: %d из %d КБ" % [int(done / 1024), int(ceil(total / 1024.0))]

func _explain(code: String) -> String:
	var texts := {
		"NETWORK_UNAVAILABLE": "Нет связи с сервером. Скачанное раньше сохранено; продолжим, когда появится сеть.",
		"HASH_MISMATCH": "Файл повреждён при загрузке и отброшен. Попробуй ещё раз.",
		"STORAGE_FULL": "Не хватает места для файлов игры. Освободи место и повтори.",
		"STORAGE_WRITE_FAILED": "Не удалось записать файл на телефон (возможно, нет места).",
		"INCOMPATIBLE_CLIENT": "Для новой версии мира нужно обновить приложение. Пока работает прежняя версия.",
		"NO_CONTENT": "Мир ещё не опубликован на сервере.",
		"ANDROID_KEYSTORE_REQUIRED": "Нужна Android-сборка с защищённым хранилищем.",
		"HTTPS_REQUIRED": "Нужен адрес сервера, начинающийся с https://",
		"CONFLICT": "Предыдущий бой ещё идёт. Нажми ещё раз — игра продолжит его.",
		"UNAUTHORIZED": "Нужно войти заново: нажми «Играть (вход гостем)».",
		"INVALID_REQUEST": "Сервер не смог собрать бой (проверь героев и этап в Studio).",
		"SERVICE_UNAVAILABLE": "Сервер занят, попробуй через минуту.",
	}
	return texts.get(code, "Ошибка: " + code)

func _start() -> void:
	if busy:
		return
	busy = true
	var saved: Dictionary = content.active()
	status.text = "Вход…" if saved.is_empty() else "Работает сохранённая версия %s. Проверяем обновления…" % saved.content_version
	var connected: Dictionary = await auth.connect_guest(base_url.text.strip_edges())
	if not connected.ok and connected.code == "NETWORK_UNAVAILABLE" and not saved.is_empty():
		status.text = "Без сети: работает сохранённая версия %s. Обновим, когда появится сеть." % saved.content_version
		busy = false
		_show_hub()
		return
	if not connected.ok:
		status.text = _explain(str(connected.code)) + "\nСохранённые данные не удалены."
		busy = false
		_show_hub()
		return
	status.text = "Загружаем мир…"
	var result: Dictionary = await content.sync()
	progress.visible = false
	progress_label.text = ""
	if result.ok:
		status.text = ("Без сети: работает сохранённая версия " if result.get("offline", false) else "Версия мира: ") + str(result.version)
	else:
		status.text = _explain(str(result.code)) + ("\nРаботает сохранённая версия " + str(result.version) if str(result.get("version", "")) != "" else "")
	busy = false
	_show_hub()

func _download_all() -> void:
	if busy:
		return
	busy = true
	status.text = "Скачиваем все файлы…"
	var result: Dictionary = await content.sync(true)
	progress.visible = false
	progress_label.text = ""
	status.text = "Все файлы скачаны." if result.ok else _explain(str(result.code))
	busy = false
	_show_hub()

func _show_hub() -> void:
	for child in hub.get_children():
		child.queue_free()
	var bundle: Dictionary = content.active()
	download_all_button.visible = not bundle.is_empty()
	if bundle.is_empty():
		return
	var missing: int = bundle.resources.filter(func(r): return not content.downloaded(r)).size()
	label("Мир %s · файлов не скачано: %d" % [bundle.content_version, missing], 18, hub)
	label("Герои", 24, hub)
	for entity in bundle.content.entities:
		if entity.get("kind") != "hero":
			continue
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		var picture := TextureRect.new()
		picture.custom_minimum_size = Vector2(64, 64)
		picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		picture.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		var sprite = entity.get("data", {}).get("sprite_resource_id")
		if sprite is String:
			picture.texture = content.texture(sprite)
		row.add_child(picture)
		var title := Label.new()
		title.text = str(entity.get("name", entity.get("id", "")))
		title.add_theme_font_size_override("font_size", 20)
		row.add_child(title)
		hub.add_child(row)
	_battle_section(bundle)

var stage_picker: OptionButton
var hero_checks: Dictionary = {}
var stage_ids: Array = []

func _battle_section(bundle: Dictionary) -> void:
	label("Бой", 24, hub)
	stage_ids = bundle.content.entities.filter(func(e): return e.get("kind") == "stage").map(func(e): return e.id)
	var fighters: Array = bundle.content.entities.filter(func(e): return e.get("kind") == "hero" and e.get("data", {}).has("combat"))
	if stage_ids.is_empty() or fighters.is_empty():
		label("Чтобы сразиться, создай в Studio этап с противниками и героя с боевыми параметрами, затем опубликуй.", 18, hub)
		return
	stage_picker = OptionButton.new()
	stage_picker.custom_minimum_size.y = 54
	for e in bundle.content.entities:
		if e.get("kind") == "stage":
			stage_picker.add_item(str(e.get("name", e.id)))
	hub.add_child(stage_picker)
	label("Твоя команда (до 5):", 18, hub)
	hero_checks.clear()
	for e in fighters:
		var check := CheckBox.new()
		check.text = str(e.get("name", e.id))
		check.custom_minimum_size.y = 48
		check.button_pressed = hero_checks.size() == 0
		hub.add_child(check)
		hero_checks[e.id] = check
	var go := Button.new()
	go.text = "Продолжить бой" if FileAccess.file_exists("user://live_battle.json") else "В бой!"
	go.custom_minimum_size.y = 60
	go.pressed.connect(_start_battle)
	hub.add_child(go)

func _start_battle() -> void:
	if busy:
		return
	var team: Array = hero_checks.keys().filter(func(id): return hero_checks[id].button_pressed)
	if team.is_empty() or team.size() > 5:
		status.text = "Отметь от 1 до 5 героев."
		return
	busy = true
	status.text = "Начинаем бой…"
	var live = preload("res://live_client.gd").new()
	live.auth = auth
	add_child(live)
	var view = preload("res://battle_view.gd").new()
	add_child(view)
	view.setup(live, content)
	view.closed.connect(func():
		live.queue_free()
		status.text = ""
		_show_hub())
	var result: Dictionary = await live.start(str(stage_ids[stage_picker.selected]), team)
	busy = false
	if not result.ok:
		view.queue_free()
		live.queue_free()
		status.text = "Бой не начался: " + _explain(str(result.code))
	elif result.get("resumed", false):
		view.status_label.text = "Продолжаем начатый бой."

func _build_account() -> void:
	label("Аккаунт", 24)
	label("Логин: 3–32 латинских буквы, цифры или _. Пароль: 12–128 символов.")
	login_field = field("Логин")
	login_field.max_length = 32
	password_field = field("Пароль / новый пароль", true)
	password_field.max_length = 128
	action("Привязать текущего гостя", _bind)
	label("Вход в другой аккаунт заменит сохраненный вход. Сначала привяжи гостя, чтобы не потерять доступ к нему.")
	action("Войти по логину и паролю", _login)
	recovery_field = field("Секретный код восстановления", true)
	action("Восстановить с новым паролем", _recover)
	action("Выпустить новый код по текущему паролю", _rotate)
	label("Код восстановления показывается только после выпуска. Сохрани его в надежном месте вне игры. Новый код заменяет старый.")
	recovery_output = field("Новый код появится здесь")
	recovery_output.editable = false
	action("Скопировать новый код", _copy_code)
	action("Проверить защищенное хранилище", _probe_storage)

func finish_account(result: Dictionary, has_code: bool) -> void:
	password_field.clear()
	recovery_field.clear()
	if result.ok:
		if has_code:
			recovery_output.text = str(result.data.recovery_code)
		status.text = "Готово. Сохрани новый код вне игры." if has_code else "Вход выполнен."
	else:
		status.text = "Ошибка: " + str(result.code) + "\nДанные аккаунта не удалены. Если ответ привязки или восстановления потерян, войди заданным паролем и выпусти новый код."
	busy = false

func _bind() -> void:
	if busy:
		return
	busy = true
	recovery_output.clear()
	finish_account(await auth.bind_account(login_field.text.strip_edges(), password_field.text), true)

func _login() -> void:
	if busy:
		return
	busy = true
	recovery_output.clear()
	finish_account(await auth.login_account(base_url.text.strip_edges(), login_field.text.strip_edges(), password_field.text), false)

func _recover() -> void:
	if busy:
		return
	busy = true
	recovery_output.clear()
	finish_account(await auth.recover_account(base_url.text.strip_edges(), login_field.text.strip_edges(), recovery_field.text.strip_edges(), password_field.text), true)

func _rotate() -> void:
	if busy:
		return
	busy = true
	recovery_output.clear()
	finish_account(await auth.rotate_code(password_field.text), true)

func _copy_code() -> void:
	if not recovery_output.text.is_empty():
		DisplayServer.clipboard_set(recovery_output.text)
		status.text = "Код скопирован. Сохрани его в надежном месте."

func _probe_storage() -> void:
	if busy:
		return
	if auth.native == null:
		status.text = "AndroidKeyStore недоступен: нужна Android-сборка с native bridge."
		return
	status.text = "Защищенное хранилище: " + str(auth.native.storage_probe()) + "\nПроверка использует отдельный файл и не меняет учетные данные."
