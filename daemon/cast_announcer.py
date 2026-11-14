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

        # Discover Cast devices quickly (4s mDNS window)
        chromecasts, browser = pychromecast.get_chromecasts(timeout=4)
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

        orig_volumes = {}

        def play_on_cast(cast_dev):
            try:
                cast_dev.wait(timeout=5)
                try:
                    cur_vol = getattr(cast_dev.status, "volume_level", None)
                    if cur_vol is not None:
                        orig_volumes[cast_dev] = float(cur_vol)
                        if float(cur_vol) < 0.72:
                            cast_dev.set_volume(0.72)
                            time.sleep(0.15)
                except Exception:
                    pass

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
            t.join(timeout=8)

        # Wait long enough for full message playback based on character count
        wait_secs = max(8.0, min(25.0, len(text) * 0.09 + 3.5))
        print(f"[Announcer] Playing '{text}' on {[c.name for c in target_casts]} (hold {wait_secs:.1f}s)")
        time.sleep(wait_secs)

        # Restore previous speaker volumes so normal music levels stay unchanged
        for cast_dev, prev_vol in orig_volumes.items():
            try:
                cast_dev.set_volume(prev_vol)
            except Exception:
                pass
        if orig_volumes:
            time.sleep(0.25)
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
