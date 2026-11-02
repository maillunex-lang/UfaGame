extends Control

const Store = preload("res://prototype/store.gd")
const Replay = preload("res://prototype/replay.gd")
var replay = Replay.new()
var events: Array = []
var index := 0
var text: Label

func _ready() -> void:
	text = Label.new()
	text.position = Vector2(24, 70)
	text.add_theme_font_size_override("font_size", 22)
	add_child(text)
	var bytes := FileAccess.get_file_as_bytes("res://prototype/events.json")
	var digest := FileAccess.get_sha256("res://prototype/events.json")
	var result := Store.retain(bytes, digest)
	events = JSON.parse_string(bytes.get_string_from_utf8())
	text.text = "UfaGame / S01\nЗапись сервера: локальный fixture\nРесурс: %s\n%s\nHP: 100" % [result, OS.get_user_data_dir()]
	var timer := Timer.new()
	timer.wait_time = 1.0
	timer.timeout.connect(_tick)
	add_child(timer)
	timer.start()

func _tick() -> void:
	if index >= events.size():
		return
	var result: String = replay.apply(events[index])
	index += 1
	text.text = "UfaGame / S01\nЗапись сервера: локальный fixture\nСобытие: %d / %s\nHP: %d\nРесурсы: %s" % [index, result, replay.hp, OS.get_user_data_dir()]
