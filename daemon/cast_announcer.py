#!/usr/bin/env python3
"""
HouseOps Local Google Cast / Nest Speaker Announcer
Uses pychromecast to discover Google Home / Nest speakers via mDNS on the local LAN,
generates spoken audio via Google Text-to-Speech (gTTS), and streams to the speaker.
"""

import sys
import os
import time
import argparse
import socket
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler

try:
    import pychromecast
    from gtts import gTTS
    HAS_LIBS = True
except ImportError:
    HAS_LIBS = False

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

def serve_audio_file(directory, port=8099):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=directory, **kwargs)
        def log_message(self, format, *args):
            pass

    server = HTTPServer(('0.0.0.0', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server

def speak(text, speaker_name=None, port=8099, temp_dir="/tmp/houseops_audio"):
    if not HAS_LIBS:
        print(f"[DRY-RUN] pychromecast / gTTS not installed. Would announce: '{text}'")
        return True

    os.makedirs(temp_dir, exist_ok=True)
    audio_path = os.path.join(temp_dir, "announcement.mp3")

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
        # Start local HTTP streaming server
        server = serve_audio_file(temp_dir, port=port)
        local_ip = get_local_ip()
        media_url = f"http://{local_ip}:{port}/announcement.mp3"

        # Discover Cast devices
        chromecasts, browser = pychromecast.get_chromecasts()
        target_casts = []

        if speaker_name:
            if isinstance(speaker_name, str):
                names = [s.strip().lower() for s in speaker_name.split(",") if s.strip()]
            else:
                names = [s.strip().lower() for s in speaker_name if s.strip()]

            for cast in chromecasts:
                if cast.name.lower() in names:
                    target_casts.append(cast)

        # Fallback 1: Prefer "All Rooms" or any Google Cast Group
        if not target_casts:
            for cast in chromecasts:
                if cast.name.lower() in ["all rooms", "everywhere", "all speakers", "house"]:
                    target_casts.append(cast)
                    break

        if not target_casts:
            for cast in chromecasts:
                if "group" in cast.model_name.lower():
                    target_casts.append(cast)
                    break

        # Fallback 2: Exclude TVs/streamers (onn, shield, tv, telly) and pick first real audio speaker
        if not target_casts:
            tv_keywords = ["tv", "onn", "shield", "telly", "display"]
            for cast in chromecasts:
                name_l = cast.name.lower()
                model_l = cast.model_name.lower()
                if not any(k in name_l or k in model_l for k in tv_keywords):
                    target_casts.append(cast)
                    break

        if not target_casts and len(chromecasts) > 0:
            target_casts.append(chromecasts[0])

        if not target_casts:
            print("[Announcer] No Google Cast / Nest speakers discovered on local network.")
            return False

        def play_on_cast(cast_dev):
            try:
                cast_dev.wait(timeout=5)
                mc = cast_dev.media_controller
                mc.play_media(media_url, "audio/mp3")
                mc.block_until_active(timeout=5)
            except Exception as e:
                print(f"[Announcer] Error on {cast_dev.name}: {e}", file=sys.stderr)

        threads = []
        for cast in target_casts:
            t = threading.Thread(target=play_on_cast, args=(cast,))
            t.start()
            threads.append(t)

        for t in threads:
            t.join(timeout=6)

        time.sleep(3) # Wait for buffer stream
        return True
    except Exception as e:
        print(f"[Announcer] Cast playback error: {e}", file=sys.stderr)
        return False
    finally:
        if browser:
            try:
                pychromecast.discovery.stop_discovery(browser)
            except Exception:
                pass
        if server:
            try:
                server.shutdown()
            except Exception:
                pass

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="HouseOps Google Nest TTS Announcer")
    parser.add_argument("message", help="Message to announce")
    parser.add_argument("--speaker", default=None, help="Target speaker name (e.g. 'Kitchen speaker')")
    parser.add_argument("--port", type=int, default=8099, help="Local HTTP streaming port")

    args = parser.parse_args()
    success = speak(args.message, speaker_name=args.speaker, port=args.port)
    sys.exit(0 if success else 1)
