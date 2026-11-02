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
var login_field: LineEdit
var password_field: LineEdit
var recovery_field: LineEdit
var recovery_output: LineEdit
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
	action("Проверить защищенное хранилище", _probe_storage)
	label("Гостевой аккаунт")
	base_url = field("HTTPS-адрес тестового сервера")
	base_url.text = auth.state.get("base_url", "")
	status = label("Для аккаунта нужен тестовый сервер. Локальный HP выше — только запись.")
	action("Подключиться / продолжить гостя", _connect)
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


func finish_account(result: Dictionary, has_code: bool) -> void:
	password_field.clear()
	recovery_field.clear()
	if result.ok:
		if has_code:
			recovery_output.text = str(result.data.recovery_code)
		status.text = "Готово. Сохрани новый код вне игры." if has_code else "Вход выполнен. Можно загрузить прогресс кнопкой выше."
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
