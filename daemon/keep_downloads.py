#!/usr/bin/env python3
"""
Reads unchecked items from a Google Keep checklist (default: 'Downloads'),
deletes picked items from the list, caches Keep sync state locally, and
prints JSON to stdout: {"ok": true, "items": ["..."]}.
Config is read from stdin JSON so credentials never appear in process argv.
"""

import json
import os
import sys
import gkeepapi


DEFAULT_DEVICE_ID = "0123456789abcdef"


def load_cached_state(state_path: str):
    if not state_path or not os.path.exists(state_path):
        return None
    try:
        with open(state_path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def save_cached_state(state_path: str, state: dict):
    if not state_path:
        return
    parent = os.path.dirname(os.path.abspath(state_path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    tmp_path = f"{state_path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(state, fh)
    os.replace(tmp_path, state_path)


def authenticate_keep(email: str, master_token: str, device_id: str, state_path: str):
    keep = gkeepapi.Keep()
    cached_state = load_cached_state(state_path)
    if cached_state is not None:
        try:
            keep.authenticate(
                email,
                master_token,
                state=cached_state,
                device_id=device_id,
            )
            return keep
        except Exception:
            keep = gkeepapi.Keep()

    keep.authenticate(email, master_token, device_id=device_id)
    return keep


def main() -> int:
    try:
        raw_input = sys.stdin.read()
        cfg = json.loads(raw_input or "{}")
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"Invalid stdin JSON: {exc}", "items": []}))
        return 1

    email = str(cfg.get("email") or "").strip()
    master_token = str(cfg.get("masterToken") or "").strip()
    list_title = str(cfg.get("listTitle") or "Downloads").strip()
    state_path = str(cfg.get("statePath") or "data/keep_state.json").strip()
    device_id = str(cfg.get("deviceId") or DEFAULT_DEVICE_ID).strip()

    if not email or not master_token:
        print(json.dumps({"ok": False, "error": "Missing Keep credentials", "items": []}))
        return 1

    try:
        keep = authenticate_keep(email, master_token, device_id, state_path)
        target_lower = list_title.lower()
        picked_texts = []
        picked_nodes = []

        for note in keep.all():
            title = (getattr(note, "title", None) or "").strip().lower()
            if title == target_lower and hasattr(note, "unchecked"):
                for item in list(note.unchecked):
                    text = (getattr(item, "text", None) or "").strip()
                    if text:
                        picked_texts.append(text)
                        picked_nodes.append(item)

        if picked_nodes:
            for item in picked_nodes:
                item.delete()
            keep.sync()

        try:
            save_cached_state(state_path, keep.dump())
        except Exception as cache_err:
            print(f"[KeepRelay] Warning: failed to cache keep state: {cache_err}", file=sys.stderr)

        print(json.dumps({"ok": True, "items": picked_texts}))
        return 0
    except Exception as exc:
        print(f"[KeepRelay] Google Keep poll error: {exc}", file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(exc), "items": []}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
