extends Node

var native
var state: Dictionary = {}
var last_error := ""
var http: HTTPRequest

func _ready() -> void:
	http = HTTPRequest.new()
	http.timeout = 15.0
	http.body_size_limit = 65536
	http.max_redirects = 0
	add_child(http)
	if Engine.has_singleton("UfaCredentials"):
		native = Engine.get_singleton("UfaCredentials")
		var saved: String = native.load_credentials()
		if not saved.is_empty():
			var parsed = JSON.parse_string(saved)
			if not parsed is Dictionary or parsed.has("error"):
				last_error = "CREDENTIALS_UNAVAILABLE"
			else:
				state = parsed
	else:
		last_error = "ANDROID_KEYSTORE_REQUIRED"

func save_state() -> bool:
	if native == null or not native.save_credentials(JSON.stringify(state)):
		last_error = "CREDENTIALS_UNAVAILABLE"
		return false
	return true

func call_api(path: String, payload = null, authorized := false) -> Dictionary:
	var base: String = state.get("base_url", "")
	if not base.begins_with("https://") or base.contains("@") or base.contains("?") or base.contains("#") or base.contains(" "):
		return {"ok": false, "code": "HTTPS_REQUIRED", "status": 0}
	var headers := PackedStringArray(["Content-Type: application/json"])
	if authorized:
		headers.append("Authorization: Bearer " + str(state.get("session", {}).get("access_token", "")))
	var method := HTTPClient.METHOD_GET if payload == null else HTTPClient.METHOD_POST
	var body := "" if payload == null else JSON.stringify(payload)
	if http.request(base.trim_suffix("/") + path, headers, method, body) != OK:
		return {"ok": false, "code": "NETWORK_UNAVAILABLE", "status": 0}
	var response = await http.request_completed
	if response[0] != HTTPRequest.RESULT_SUCCESS:
		return {"ok": false, "code": "NETWORK_UNAVAILABLE", "status": 0}
	var data = JSON.parse_string(response[3].get_string_from_utf8())
	if not data is Dictionary:
		return {"ok": false, "code": "INVALID_RESPONSE", "status": response[1]}
	if response[1] < 200 or response[1] >= 300:
		var code: String = data.get("error", {}).get("code", "SERVER_ERROR")
		if code not in ["UNAUTHORIZED", "CONFLICT", "INVALID_REQUEST", "RATE_LIMITED", "SERVICE_UNAVAILABLE"]:
			code = "SERVER_ERROR"
		return {"ok": false, "code": code, "status": response[1]}
	return {"ok": true, "data": data, "status": response[1]}

func retain_session(session: Dictionary) -> bool:
	for key in ["player_id", "access_token", "refresh_token", "api_version"]:
		if not session.has(key):
			last_error = "INVALID_RESPONSE"
			return false
	if session.api_version != 1 or str(session.access_token).length() != 43 or str(session.refresh_token).length() != 43:
		last_error = "INVALID_RESPONSE"
		return false
	state.session = session
	state.erase("pending_refresh")
	return save_state()

func refresh_session() -> Dictionary:
	if not state.has("pending_refresh"):
		state.pending_refresh = native.request_id()
		if not save_state():
			return {"ok": false, "code": last_error}
	var result: Dictionary = await call_api("/v1/sessions/refresh", {"refresh_token": state.session.refresh_token, "request_id": state.pending_refresh})
	if not result.ok and result.get("status") == 401 and state.has("installation_secret"):
		# Only the server may renew an expired guest family; revoked/bound roots fail.
		result = await call_api("/v1/guests", {"installation_secret": state.installation_secret})
	if result.ok and not retain_session(result.data):
		return {"ok": false, "code": last_error}
	return result

func progress() -> Dictionary:
	return await authorized_get("/v1/progress")

## GET with the session token; renews an expired access token once.
func authorized_get(path: String) -> Dictionary:
	var result: Dictionary = await call_api(path, null, true)
	if not result.ok and result.get("status") == 401:
		var refreshed: Dictionary = await refresh_session()
		if not refreshed.ok:
			return refreshed
		result = await call_api(path, null, true)
	return result

func connect_guest(base: String) -> Dictionary:
	if not prepare_server(base):
		return {"ok": false, "code": last_error}
	if not state.has("installation_secret"):
		state.installation_secret = native.random_secret()
	if not save_state():
		return {"ok": false, "code": last_error}
	if not state.has("session"):
		var result: Dictionary = await call_api("/v1/guests", {"installation_secret": state.installation_secret})
		if not result.ok:
			return result
		if not retain_session(result.data):
			return {"ok": false, "code": last_error}
	return await progress()

func prepare_server(base: String) -> bool:
	if last_error not in ["CREDENTIALS_UNAVAILABLE", "ANDROID_KEYSTORE_REQUIRED"]:
		last_error = ""
	if native == null or not last_error.is_empty():
		return false
	var allowed := RegEx.new()
	allowed.compile("^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9_./~-]*)?$")
	if allowed.search(base) == null:
		last_error = "HTTPS_REQUIRED"
		return false
	if state.has("base_url") and state.base_url != base.trim_suffix("/"):
		last_error = "ACCOUNT_SERVER_MISMATCH"
		return false
	state.base_url = base.trim_suffix("/")
	return save_state()

func authorized_post(path: String, payload: Dictionary) -> Dictionary:
	if not state.has("session"):
		return {"ok": false, "code": "UNAUTHORIZED"}
	var result: Dictionary = await call_api(path, payload, true)
	if not result.ok and result.get("status") == 401:
		var refreshed: Dictionary = await refresh_session()
		if not refreshed.ok:
			return refreshed
		result = await call_api(path, payload, true)
	return result

func bind_account(login: String, password: String) -> Dictionary:
	var result: Dictionary = await authorized_post("/v1/account/bind", {"login": login, "password": password})
	if result.ok and (not result.data.get("session") is Dictionary or not result.data.get("recovery_code") is String or str(result.data.get("recovery_code", "")).length() != 43):
		return {"ok": false, "code": "INVALID_RESPONSE"}
	if result.ok and not retain_session(result.data.session):
		return {"ok": false, "code": last_error}
	return result

func login_account(base: String, login: String, password: String) -> Dictionary:
	if not prepare_server(base):
		return {"ok": false, "code": last_error}
	var result: Dictionary = await call_api("/v1/sessions/login", {"login": login, "password": password})
	if result.ok and not retain_session(result.data):
		return {"ok": false, "code": last_error}
	return result

func recover_account(base: String, login: String, code: String, password: String) -> Dictionary:
	if not prepare_server(base):
		return {"ok": false, "code": last_error}
	var result: Dictionary = await call_api("/v1/account/recover", {"login": login, "recovery_code": code, "new_password": password})
	if result.ok and (not result.data.get("session") is Dictionary or not result.data.get("recovery_code") is String or str(result.data.get("recovery_code", "")).length() != 43):
		return {"ok": false, "code": "INVALID_RESPONSE"}
	if result.ok and not retain_session(result.data.session):
		return {"ok": false, "code": last_error}
	return result

func rotate_code(password: String) -> Dictionary:
	return await authorized_post("/v1/account/recovery/rotate", {"password": password})
