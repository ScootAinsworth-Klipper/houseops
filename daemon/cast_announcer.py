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
            pass # Silent

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

    # Generate MP3
    tts = gTTS(text=text, lang="en", tld="com")
    tts.save(audio_path)

    # Start local HTTP server to stream MP3 to Cast device
    server = serve_audio_file(temp_dir, port=port)
    local_ip = get_local_ip()
    media_url = f"http://{local_ip}:{port}/announcement.mp3"

    # Discover Cast devices
    chromecasts, browser = pychromecast.get_chromecasts()
    target_cast = None

    if speaker_name:
        for cast in chromecasts:
            if cast.name.lower() == speaker_name.lower():
                target_cast = cast
                break

    if not target_cast and len(chromecasts) > 0:
        target_cast = chromecasts[0]

    if not target_cast:
        print("No Google Cast / Nest speakers discovered on local network.")
        pychromecast.discovery.stop_discovery(browser)
        return False

    target_cast.wait()
    mc = target_cast.media_controller
    mc.play_media(media_url, "audio/mp3")
    mc.block_until_active(timeout=5)
    time.sleep(4) # Allow playback to buffer

    pychromecast.discovery.stop_discovery(browser)
    server.shutdown()
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="HouseOps Google Nest TTS Announcer")
    parser.add_argument("message", help="Message to announce")
    parser.add_argument("--speaker", default=None, help="Target speaker name (e.g. 'Kitchen speaker')")
    parser.add_argument("--port", type=int, default=8099, help="Local HTTP streaming port")

    args = parser.parse_args()
    success = speak(args.message, speaker_name=args.speaker, port=args.port)
    sys.exit(0 if success else 1)
