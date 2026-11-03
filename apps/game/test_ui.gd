extends SceneTree

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var screen = load("res://main.tscn").instantiate()
	root.add_child(screen)
	await process_frame
	var errors := 0
	for page in ["Карта", "Герои", "Задания", "Награды", "Настройки"]:
		if not screen.pages.has(page):
			push_error("Missing page: " + page)
			errors += 1
	if screen.tabs.get_tab_count() != 5:
		push_error("Navigation pages are missing")
		errors += 1
	for index in range(5):
		screen.tabs.current_tab = index
		await process_frame
		if screen.tabs.current_tab != index:
			push_error("Cannot switch page")
			errors += 1
	if not screen.base_url.text.begins_with("https://"):
		push_error("Server setting lost")
		errors += 1
	print("Game navigation: failures=", errors)
	screen.queue_free()
	quit(0 if errors == 0 else 1)
