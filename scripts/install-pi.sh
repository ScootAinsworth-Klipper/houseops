#!/usr/bin/env bash
set -e

echo "🏠 Installing HouseOps on Raspberry Pi..."

# 1. Install Node.js (if not installed)
if ! command -v node &> /dev/null; then
    echo "Installing Node.js v20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# 2. Install Python Cast dependencies
echo "Installing Python Cast & TTS dependencies..."
sudo apt-get update
sudo apt-get install -y python3 python3-pip
pip3 install pychromecast gTTS --break-system-packages 2>/dev/null || pip3 install pychromecast gTTS

# 3. Create photo store and data directories
sudo mkdir -p /var/houseops/photos
sudo chown -R $USER:$USER /var/houseops

# 4. Install Node dependencies
npm install --omit=dev

# Build if dist does not exist
if [ ! -d "dist" ]; then
    echo "Compiling TypeScript..."
    npm install
    npx tsc
fi

# 5. Setup Systemd Service
sudo cp scripts/houseops.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable houseops
sudo systemctl restart houseops

echo "✅ HouseOps installed and running! Visit: http://$(hostname -I | awk '{print $1}'):8088"
