#!/usr/bin/env bash
# ─── Billing Buddy 58mm Bluetooth Printer — One-time Setup ──────────────────
# Run this ONCE on the Kali machine that runs the Next.js server.
# After this, the app auto-reconnects via env vars on every start.
#
# Usage:
#   chmod +x scripts/setup-bluetooth-printer.sh
#   sudo ./scripts/setup-bluetooth-printer.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── 0. Root check ────────────────────────────────────────────────────────────
[ "$EUID" -ne 0 ] && error "Please run as root: sudo $0"

# ── 1. Ensure BlueZ is installed ─────────────────────────────────────────────
info "Checking BlueZ tools..."
command -v bluetoothctl >/dev/null 2>&1 || apt-get install -y bluez
command -v rfcomm       >/dev/null 2>&1 || apt-get install -y bluez-utils || apt-get install -y rfcomm

# ── 2. Power on Bluetooth adapter ────────────────────────────────────────────
info "Powering on Bluetooth adapter..."
bluetoothctl power on

# ── 3. Scan and let user pick the printer ────────────────────────────────────
echo ""
warn "Turn on the Billing Buddy printer NOW, then press ENTER to start scanning..."
read -r

info "Scanning for 15 seconds..."
SCAN_OUTPUT=$(timeout 15 bluetoothctl scan on 2>&1 || true)
DEVICES=$(bluetoothctl devices 2>/dev/null | grep -i -E "billing|buddy|thermal|rpp|pos|58|blue" || bluetoothctl devices 2>/dev/null)

echo ""
info "Found devices:"
echo "$DEVICES"
echo ""

read -rp "Paste the printer MAC address from the list above (format AA:BB:CC:DD:EE:FF): " MAC

# Basic MAC format check
if [[ ! "$MAC" =~ ^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$ ]]; then
  error "Invalid MAC address format: $MAC"
fi

# ── 4. Pair and trust ─────────────────────────────────────────────────────────
info "Pairing with $MAC..."
bluetoothctl pair   "$MAC" || warn "Already paired or pairing failed — continuing"
bluetoothctl trust  "$MAC"
info "Printer trusted."

# ── 5. Bind RFCOMM device ────────────────────────────────────────────────────
DEVICE="/dev/rfcomm0"
RFCOMM_INDEX=0
CHANNEL=1

if [ -e "$DEVICE" ]; then
  warn "$DEVICE already exists — releasing it first."
  rfcomm release $RFCOMM_INDEX || true
fi

info "Binding $MAC → $DEVICE (channel $CHANNEL)..."
rfcomm bind $RFCOMM_INDEX "$MAC" $CHANNEL

sleep 2

if [ ! -e "$DEVICE" ]; then
  error "Bind completed but $DEVICE not found. Is the printer on and in range?"
fi

info "$DEVICE created successfully."

# ── 6. Test print ─────────────────────────────────────────────────────────────
echo ""
read -rp "Send a test print now? (y/n): " TEST
if [[ "$TEST" == "y" || "$TEST" == "Y" ]]; then
  info "Sending test page..."
  node - << 'NODESCRIPT'
const fs = require('fs')
const ESC = 0x1b, GS = 0x1d
const buf = Buffer.concat([
  Buffer.from([ESC, 0x40]),                        // init
  Buffer.from([ESC, 0x61, 0x01]),                  // center
  Buffer.from([ESC, 0x21, 0x10]),                  // double height
  Buffer.from('THE BREAD CHAPTER\n', 'utf8'),
  Buffer.from([ESC, 0x21, 0x00]),                  // normal
  Buffer.from('Kitchen Printer Test\n', 'utf8'),
  Buffer.from(new Date().toLocaleString('en-IN') + '\n', 'utf8'),
  Buffer.from('--------------------------------\n', 'utf8'),
  Buffer.from([ESC, 0x61, 0x00]),                  // left
  Buffer.from([ESC, 0x45, 0x01]),                  // bold on
  Buffer.from(' 2x  Butter Chicken\n', 'utf8'),
  Buffer.from(' 1x  Garlic Naan\n', 'utf8'),
  Buffer.from([ESC, 0x45, 0x00]),                  // bold off
  Buffer.from([ESC, 0x61, 0x01]),                  // center
  Buffer.from('--------------------------------\n', 'utf8'),
  Buffer.from([ESC, 0x64, 4]),                     // feed 4 lines
  Buffer.from([GS,  0x56, 0x00]),                  // cut
])
const O_NOCTTY = 128
const fd = fs.openSync('/dev/rfcomm0', fs.constants.O_WRONLY | O_NOCTTY)
fs.writeSync(fd, buf)
fs.closeSync(fd)
console.log('Test print sent!')
NODESCRIPT
fi

# ── 7. Write env vars ─────────────────────────────────────────────────────────
ENV_FILE="$(dirname "$0")/../.env.local"
echo ""
info "Writing printer env vars to .env.local..."

# Remove any old printer BT lines and append fresh ones
sed -i '/^PRINTER_KITCHEN_BT/d' "$ENV_FILE" 2>/dev/null || true
{
  echo ""
  echo "# ─── Thermal Printer (Billing Buddy 58mm Bluetooth) ─────────────"
  echo "PRINTER_KITCHEN_BT_MAC=$MAC"
  echo "PRINTER_KITCHEN_BT_DEVICE=/dev/rfcomm0"
} >> "$ENV_FILE"

# ── 8. Persist RFCOMM bind across reboots ────────────────────────────────────
RC_FILE="/etc/rc.local"
BIND_CMD="rfcomm bind 0 $MAC 1"

if [ -f "$RC_FILE" ]; then
  if grep -q "rfcomm bind 0" "$RC_FILE"; then
    sed -i "s/rfcomm bind 0.*/$BIND_CMD/" "$RC_FILE"
  else
    sed -i "s|^exit 0|$BIND_CMD\nexit 0|" "$RC_FILE"
  fi
else
  cat > "$RC_FILE" << EOF
#!/bin/bash
$BIND_CMD
exit 0
EOF
  chmod +x "$RC_FILE"
fi

info "RFCOMM bind added to $RC_FILE (runs on every boot)."

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Bluetooth printer setup complete!            ${NC}"
echo -e "${GREEN}  MAC    : $MAC                                ${NC}"
echo -e "${GREEN}  Device : $DEVICE                            ${NC}"
echo -e "${GREEN}  Env    : PRINTER_KITCHEN_BT_MAC written      ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
echo ""
echo "Restart the Next.js server: npm run dev"
