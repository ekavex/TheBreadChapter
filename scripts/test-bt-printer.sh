#!/usr/bin/env bash
# test-bt-printer.sh - Bluetooth range & connectivity test for KOT thermal printer
# Usage: ./scripts/test-bt-printer.sh [MAC] [pings]
# Example: ./scripts/test-bt-printer.sh 66:32:F7:C5:B7:05 10

set -euo pipefail

MAC="${1:-66:32:F7:C5:B7:05}"
COUNT="${2:-5}"
RFCOMM_CHANNEL=1
RFCOMM_DEV=/dev/rfcomm9   # temporary device, released after test

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

log()  { echo -e "${NC}[$(date +%H:%M:%S)] $*"; }
ok()   { echo -e "${GREEN}[OK]${NC}  $*"; }
warn() { echo -e "${YELLOW}[!!]${NC}  $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; }

echo ""
echo "  Bluetooth KOT Printer Range Test"
echo "  MAC     : $MAC"
echo "  Pings   : $COUNT"
echo "  ─────────────────────────────────"
echo ""

# ── 1. Prerequisites ────────────────────────────────────────────────────────
log "Checking tools..."
for cmd in hcitool l2ping rfcomm; do
  if ! command -v "$cmd" &>/dev/null; then
    fail "Missing: $cmd - install with: sudo apt-get install -y bluez"
    exit 1
  fi
done
ok "All tools present (hcitool, l2ping, rfcomm)"

# ── 2. Bluetooth adapter up? ────────────────────────────────────────────────
log "Checking local Bluetooth adapter..."
if ! hcitool dev | grep -q "hci"; then
  fail "No Bluetooth adapter found. Is it plugged in and enabled?"
  exit 1
fi
ADAPTER=$(hcitool dev | grep hci | awk '{print $1}' | head -1)
ok "Adapter: $ADAPTER"

# ── 3. L2CAP ping (range test) ──────────────────────────────────────────────
echo ""
log "L2CAP ping - $COUNT packets to $MAC"
log "Move the printer further away between pings to test range."
echo ""

PASS=0; FAIL_COUNT=0; TOTAL_RTT=0

# l2ping exits non-zero if unreachable; we handle per-line
set +e
l2ping -c "$COUNT" -t 5 "$MAC" 2>&1 | while IFS= read -r line; do
  echo "  $line"
done
BT_EXIT=${PIPESTATUS[0]}
set -e

echo ""
if [ "$BT_EXIT" -eq 0 ]; then
  ok "Printer is reachable via Bluetooth"
else
  fail "Printer did not respond - out of range or powered off"
fi

# ── 4. RSSI (signal strength) ───────────────────────────────────────────────
echo ""
log "Checking signal strength (RSSI)..."
log "RSSI guide:  0 to -50 = excellent  |  -50 to -70 = good  |  -80+ = weak"
echo ""

# Need an active connection for RSSI - bind RFCOMM temporarily
BOUND=false
if sudo rfcomm bind "$RFCOMM_DEV" "$MAC" "$RFCOMM_CHANNEL" 2>/dev/null; then
  BOUND=true
  sleep 1
fi

RSSI_RAW=$(hcitool rssi "$MAC" 2>&1 || true)
echo "  $RSSI_RAW"

if echo "$RSSI_RAW" | grep -q "RSSI return value"; then
  RSSI_VAL=$(echo "$RSSI_RAW" | grep -oP '[-0-9]+' | tail -1)
  if   [ "$RSSI_VAL" -ge -50 ]; then ok  "Signal: ${RSSI_VAL} dBm - Excellent"
  elif [ "$RSSI_VAL" -ge -70 ]; then ok  "Signal: ${RSSI_VAL} dBm - Good"
  elif [ "$RSSI_VAL" -ge -80 ]; then warn "Signal: ${RSSI_VAL} dBm - Weak, may drop"
  else                                fail "Signal: ${RSSI_VAL} dBm - Too weak for reliable printing"
  fi
else
  warn "Could not read RSSI - printer may not be paired yet"
fi

# ── 5. Cleanup ───────────────────────────────────────────────────────────────
if $BOUND; then
  sudo rfcomm release "$RFCOMM_DEV" 2>/dev/null || true
fi

# ── 6. Summary ───────────────────────────────────────────────────────────────
echo ""
echo "  ─────────────────────────────────"
echo "  Test complete."
echo ""
echo "  Next steps:"
echo "    • If reachable: pair once with  sudo bluetoothctl"
echo "    • Then bind for printing:       sudo rfcomm bind /dev/rfcomm0 $MAC 1"
echo "    • Test an actual print:         ./scripts/test-bt-print.sh"
echo ""
