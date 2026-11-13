#!/usr/bin/env python3
import os
import sys
import time
import argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import pychromecast
    from cast_announcer import speak
except ImportError as e:
    print(f"Error: {e}. Run pip3 install pychromecast gTTS")
    sys.exit(1)

def discover_speakers():
    print("🔍 Scanning your home Wi-Fi for Google Nest / Cast speakers (please wait ~5s)...")
    chromecasts, browser = pychromecast.get_chromecasts()
    time.sleep(3) # allow mDNS responses to arrive
    
    if not chromecasts:
        print("❌ No Google Nest / Chromecast speakers found on this Wi-Fi network.")
        pychromecast.discovery.stop_discovery(browser)
        return []

    print(f"\n🎉 Found {len(chromecasts)} Google Nest device(s):")
    for i, cast in enumerate(chromecasts, 1):
        print(f"  {i}. \"{cast.name}\"  (Model: {cast.model_name}, IP: {cast.cast_info.host})")
    
    pychromecast.discovery.stop_discovery(browser)
    return chromecasts

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Discover and test Google Nest speakers")
    parser.add_argument("--say", type=str, default=None, help="Spoken message to test")
    parser.add_argument("--speaker", type=str, default=None, help="Target speaker name")
    args = parser.parse_args()

    speakers = discover_speakers()
    
    if args.say and speakers:
        target = args.speaker or speakers[0].name
        print(f"\n📢 Broadcasting to \"{target}\": '{args.say}'...")
        speak(args.say, speaker_name=target)
        print("✅ Broadcast dispatched!")
