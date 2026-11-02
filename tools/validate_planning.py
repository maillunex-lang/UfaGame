"""Static validation of the planning deliverable; NOT a production ZIP importer."""
from pathlib import Path, PurePosixPath
import hashlib, json, re
ROOT = Path(__file__).resolve().parents[1]
def require(value, message):
    if not value:
        raise ValueError(message)
def load(path):
    return json.loads(path.read_text(encoding="utf-8"))
def digest(data):
    return hashlib.sha256(data).hexdigest()
def safe_path(name):
    p = PurePosixPath(name)
    return bool(name) and not p.is_absolute() and ".." not in p.parts and "\\" not in name and ":" not in name and "\x00" not in name
def check_example():
    base = ROOT / "examples/hello_bashkortostan"
    manifest = load(base / "manifest.json")
    require(manifest["format"] == "ug-content/1" and manifest["game_id"] == "ufagame", "format/game mismatch")
    require(manifest["base_content_version"] == "demo-1", "demo base mismatch")
    paths = [f["path"] for f in manifest["files"]]
    require(len(set(paths)) == len(paths), "duplicate inventory")
    actual = sorted(p.relative_to(base).as_posix() for p in base.rglob("*") if p.is_file() and p.name != "manifest.json")
    require(sorted(paths) == actual, "inventory mismatch")
    for entry in manifest["files"]:
        require(safe_path(entry["path"]), "unsafe path")
        data = (base / entry["path"]).read_bytes()
        require(entry["size"] == len(data), "size mismatch")
        require(entry["sha256"] == digest(data), "hash mismatch")
    operations = load(base / "operations.json")
    require(len(operations) == 1, "demo should have one operation")
    op = operations[0]
    require(op["op"] == "create" and op["entity_type"] == "dialogue_template", "demo operation")
    require(op["source"] in paths, "missing source")
    entity = load(base / op["source"])
    require(entity["id"] == op["id"], "id mismatch")
    require(set(entity) == {"id","channel","text","trigger","cooldown_seconds"}, "demo fields")
    require(re.fullmatch(r"[a-z][a-z0-9_]{2,79}", entity["id"]), "demo id")
    require(entity["channel"] in ["global","guild","private"], "channel")
    require(1 <= len(entity["text"]) <= 500, "text")
    require(entity["trigger"] in ["player_joined","greeting_received","guild_boss_defeated"], "trigger")
    require(type(entity["cooldown_seconds"]) is int and 60 <= entity["cooldown_seconds"] <= 86400, "cooldown")
    for bad in ["../x", "/x", "C:/x", "a\\b"]:
        require(not safe_path(bad), "unsafe path accepted in static checker")
    return len(paths)
def main():
    roadmap = (ROOT / "roadmap.md").read_text(encoding="utf-8")
    rows = re.findall(r"^\| (S\d{2}) \|.*?\| ([^|]+) \| (todo|in_progress|blocked|done) \|$", roadmap, re.M)
    expected = [f"S{i:02}" for i in range(1, 61)]
    require([r[0] for r in rows] == expected, "60 roadmap rows missing/duplicate")
    for stage, deps, status in rows:
        for dep in re.findall(r"S\d{2}", deps):
            require(dep in expected and int(dep[1:]) < int(stage[1:]), "invalid dependency")
        p = ROOT / f"prompts/stages/{stage}.md"
        require(p.exists(), f"missing prompt {stage}")
        text = p.read_text(encoding="utf-8")
        for token in ["roadmap.md", "Критерии", "проверки", "следующий"]:
            require(token.lower() in text.lower(), f"missing prompt requirement: {stage}/{token}")
    require(len(list((ROOT / "prompts/stages").glob("S*.md"))) == 60, "prompt count")
    for p in ROOT.rglob("*.json"):
        load(p)
    for p in ROOT.rglob("*.md"):
        for target in re.findall(r"\]\(([^)]+)\)", p.read_text(encoding="utf-8")):
            if "://" in target or target.startswith("#"):
                continue
            require((p.parent / target.split("#")[0]).exists(), f"broken link {p}: {target}")
    spec = (ROOT / "PROJECT_SPEC.md").read_text(encoding="utf-8")
    require(re.findall(r"^(\d+)\. ", spec, re.M) == [str(i) for i in range(1,56)], "55 decisions")
    count = check_example()
    print(json.dumps({"roadmap_stages":60,"stage_prompts":60,"survey_decisions":55,"example_inventory_files":count,
                      "json_syntax":"ok","relative_links":"ok","dependencies":"acyclic/backward",
                      "runtime_tested":False,"android_built":False,"vps_accessed":False}, ensure_ascii=False))
if __name__ == "__main__":
    main()
