#!/usr/bin/env python3
"""
HouseOps Local Google Cast / Nest Speaker Announcer
Uses pychromecast to discover Google Home / Nest speakers via mDNS on the local LAN,
generates spoken audio via Google Text-to-Speech (gTTS), and streams to the speaker.
"""

import sys
import os
import json
import time
import argparse
import socket
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler

try:
    import pychromecast
    from pychromecast.discovery import CastBrowser, SimpleCastListener
    from gtts import gTTS
    HAS_LIBS = True
except ImportError:
    HAS_LIBS = False

CAST_HOSTS_CACHE_PATH = "/tmp/houseops_cast_hosts.json"
ANNOUNCEMENT_MIN_VOLUME = 0.90

def _load_cached_hosts():
    try:
        with open(CAST_HOSTS_CACHE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return {str(k).lower(): str(v) for k, v in data.items() if v}
    except Exception:
        pass
    return {}

def _save_cached_hosts(host_map):
    try:
        with open(CAST_HOSTS_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(host_map, f)
    except Exception:
        pass

def _discover_chromecasts(wanted_names, discovery_timeout=10.0):
    """Discover Cast devices via CastBrowser + cached hosts, stopping once all wanted names arrive."""
    cached_map = _load_cached_hosts()
    known_hosts = None
    if wanted_names:
        matched_hosts = [cached_map[n] for n in wanted_names if n in cached_map]
        if len(matched_hosts) == len(wanted_names):
            known_hosts = list(dict.fromkeys(matched_hosts))
    if not known_hosts and cached_map:
        known_hosts = list(dict.fromkeys(cached_map.values()))

    wanted_set = set(wanted_names)
    lock = threading.Lock()
    discovered_by_uuid = {}
    discover_complete = threading.Event()
    zconf = pychromecast.create_zeroconf()

    def on_cast_event(uuid, _service):
        info = browser.devices.get(uuid)
        if not info:
            return
        with lock:
            discovered_by_uuid[uuid] = info
            if wanted_set:
                found_names = {d.friendly_name.lower() for d in discovered_by_uuid.values() if d.friendly_name}
                if wanted_set.issubset(found_names):
                    discover_complete.set()

    browser = CastBrowser(SimpleCastListener(on_cast_event), zconf, known_hosts=known_hosts)
    browser.start_discovery()
    wait_limit = discovery_timeout if wanted_set else min(discovery_timeout, 6.0)
    discover_complete.wait(wait_limit)

    with lock:
        infos = list(discovered_by_uuid.values())

    updated_cache = dict(cached_map)
    for info in infos:
        if info.friendly_name and info.host:
            updated_cache[info.friendly_name.lower()] = info.host
    _save_cached_hosts(updated_cache)

    target_infos = []
    if wanted_names:
        by_name = {info.friendly_name.lower(): info for info in infos if info.friendly_name}
        for name in wanted_names:
            if name in by_name:
                target_infos.append(by_name[name])
        missing = [n for n in wanted_names if n not in by_name]
        if missing:
            print(f"[Announcer] Warning: did not discover requested speaker(s): {missing}", file=sys.stderr)
    else:
        for info in infos:
            if info.friendly_name and info.friendly_name.lower() in ["all rooms", "everywhere", "all speakers", "house"]:
                target_infos.append(info)
                break
        if not target_infos:
            for info in infos:
                if "group" in (info.model_name or "").lower():
                    target_infos.append(info)
                    break
        if not target_infos:
            tv_keywords = ["tv", "onn", "shield", "telly", "display"]
            for info in infos:
                name_l = (info.friendly_name or "").lower()
                model_l = (info.model_name or "").lower()
                if not any(k in name_l or k in model_l for k in tv_keywords):
                    target_infos.append(info)
                    break
        if not target_infos and infos:
            target_infos.append(infos[0])

    chromecasts = []
    for info in target_infos:
        try:
            cc = pychromecast.get_chromecast_from_cast_info(info, zconf, tries=3, retry_wait=1.0, timeout=8)
            chromecasts.append(cc)
        except Exception as e:
            print(f"[Announcer] Connect error for {info.friendly_name}: {e}", file=sys.stderr)

    return chromecasts, browser

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def serve_audio_file(directory, port=0):
    class ReusableHTTPServer(HTTPServer):
        allow_reuse_address = True

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=directory, **kwargs)
        def log_message(self, format, *args):
            pass

    server = ReusableHTTPServer(('0.0.0.0', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server

def speak(text, speaker_name=None, port=0, temp_dir="/tmp/houseops_audio"):
    if not HAS_LIBS:
        print(f"[DRY-RUN] pychromecast / gTTS not installed. Would announce: '{text}'")
        return True

    os.makedirs(temp_dir, exist_ok=True)
    filename = f"announcement_{os.getpid()}_{int(time.time() * 1000)}.mp3"
    audio_path = os.path.join(temp_dir, filename)

    # Generate MP3 with network fault tolerance
    try:
        tts = gTTS(text=text, lang="en", tld="com")
        tts.save(audio_path)
    except Exception as e:
        print(f"[Announcer] TTS generation failed (WAN offline?): {e}", file=sys.stderr)
        return False

    server = None
    browser = None
    try:
        # Start local HTTP streaming server on a free port (or specified port)
        server = serve_audio_file(temp_dir, port=port)
        actual_port = server.server_port
        local_ip = get_local_ip()
        media_url = f"http://{local_ip}:{actual_port}/{filename}"

        wanted_names = []
        if speaker_name:
            if isinstance(speaker_name, str):
                wanted_names = [s.strip().lower() for s in speaker_name.split(",") if s.strip()]
            else:
                wanted_names = [s.strip().lower() for s in speaker_name if s.strip()]

        target_casts, browser = _discover_chromecasts(wanted_names, discovery_timeout=10.0)

        if not target_casts:
            print("[Announcer] No Google Cast / Nest speakers discovered on local network.")
            return False

        orig_volumes = {}
        vol_lock = threading.Lock()

        def ensure_announcement_volume(cast_dev):
            try:
                if cast_dev.status is None:
                    time.sleep(0.2)
                cur_vol = getattr(cast_dev.status, "volume_level", None) if cast_dev.status else None
                cur_muted = bool(getattr(cast_dev.status, "volume_muted", False)) if cast_dev.status else False
                needs_unmute = cur_muted
                needs_boost = cur_vol is None or float(cur_vol) < ANNOUNCEMENT_MIN_VOLUME - 0.02
                if (needs_unmute or needs_boost) and cur_vol is not None:
                    with vol_lock:
                        if cast_dev not in orig_volumes:
                            orig_volumes[cast_dev] = (float(cur_vol), cur_muted)
                if needs_unmute:
                    cast_dev.set_volume_muted(False)
                if needs_boost:
                    cast_dev.set_volume(ANNOUNCEMENT_MIN_VOLUME)
                    time.sleep(0.2)
                    print(f"[Announcer] Volume boosted on {cast_dev.name}: {cur_vol} -> {ANNOUNCEMENT_MIN_VOLUME:.2f}")
            except Exception as ve:
                print(f"[Announcer] Volume adjust error on {cast_dev.name}: {ve}", file=sys.stderr)

        def play_on_cast(cast_dev):
            try:
                cast_dev.wait(timeout=8)
                ensure_announcement_volume(cast_dev)

                mc = cast_dev.media_controller
                mc.play_media(media_url, "audio/mp3")
                mc.block_until_active(timeout=6)
                ensure_announcement_volume(cast_dev)
            except Exception as e:
                print(f"[Announcer] Error on {cast_dev.name}: {e}", file=sys.stderr)

        threads = []
        for cast in target_casts:
            t = threading.Thread(target=play_on_cast, args=(cast,))
            t.start()
            threads.append(t)

        for t in threads:
            t.join(timeout=12)

        # Wait long enough for full message playback based on character count
        wait_secs = max(8.0, min(25.0, len(text) * 0.09 + 3.5))
        print(f"[Announcer] Playing '{text}' on {[c.name for c in target_casts]} (hold {wait_secs:.1f}s)")
        time.sleep(wait_secs)

        # Restore previous speaker volumes/mute states so normal levels stay unchanged
        for cast_dev, (prev_vol, prev_muted) in orig_volumes.items():
            try:
                cast_dev.set_volume(prev_vol)
                if prev_muted:
                    cast_dev.set_volume_muted(True)
            except Exception as re:
                print(f"[Announcer] Volume restore error on {cast_dev.name}: {re}", file=sys.stderr)
        if orig_volumes:
            time.sleep(0.3)
        return True
    except Exception as e:
        print(f"[Announcer] Cast playback error: {e}", file=sys.stderr)
        return False
    finally:
        if browser:
            try:
                browser.stop_discovery()
            except Exception:
                pass
        if server:
            try:
                server.shutdown()
                server.server_close()
            except Exception:
                pass
        try:
            if os.path.exists(audio_path):
                os.remove(audio_path)
        except Exception:
            pass

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="HouseOps Google Nest TTS Announcer")
    parser.add_argument("message", help="Message to announce")
    parser.add_argument("--speaker", default=None, help="Target speaker name (e.g. 'Kitchen speaker')")
    parser.add_argument("--port", type=int, default=0, help="Local HTTP streaming port (0 = auto free port)")

    args = parser.parse_args()
    success = speak(args.message, speaker_name=args.speaker, port=args.port)
    sys.exit(0 if success else 1)
