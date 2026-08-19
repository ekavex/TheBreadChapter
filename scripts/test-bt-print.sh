#!/usr/bin/env bash
# test-bt-print.sh — ESC/POS Bluetooth thermal printer test
# Usage:
#   sudo ./scripts/test-bt-print.sh [MAC] [CHANNEL]
#
# Example:
#   sudo ./scripts/test-bt-print.sh 66:32:F7:C5:B7:05 1

set -euo pipefail

MAC="${1:-66:32:F7:C5:B7:05}"
CHANNEL="${2:-1}"
RFCOMM_DEV="/dev/rfcomm9"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC}  $*"; }
warn() { echo -e "${YELLOW}[!!]${NC}  $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }
log()  { echo -e "[$(date +%H:%M:%S)] $*"; }

COLS=32
DIV=$(printf '%0.s-' $(seq 1 "$COLS"))

# =============================================================================
# ESC/POS COMMANDS
# =============================================================================

# Initialize printer
esc_init() {
    printf '\x1b\x40'
}

# Font A - normal/default font
font_a() {
    printf '\x1b\x4d\x00'
}

# Font B - smaller/narrower font on most printers
font_b() {
    printf '\x1b\x4d\x01'
}

# Alignment
align_left() {
    printf '\x1b\x61\x00'
}

align_center() {
    printf '\x1b\x61\x01'
}

align_right() {
    printf '\x1b\x61\x02'
}

# Bold
bold_on() {
    printf '\x1b\x45\x01'
}

bold_off() {
    printf '\x1b\x45\x00'
}

# Underline
underline_on() {
    printf '\x1b\x2d\x01'
}

underline_off() {
    printf '\x1b\x2d\x00'
}

# Character sizes using GS ! n
#
# GS ! n
#
# High nibble = width
# Low nibble  = height
#
# 0x00 = 1x width, 1x height
# 0x01 = 1x width, 2x height
# 0x11 = 2x width, 2x height
# 0x22 = 3x width, 3x height
# 0x33 = 4x width, 4x height

size_normal() {
    printf '\x1d\x21\x00'
}

size_tall() {
    printf '\x1d\x21\x01'
}

size_wide() {
    printf '\x1d\x21\x10'
}

size_2x() {
    printf '\x1d\x21\x11'
}

size_3x() {
    printf '\x1d\x21\x22'
}

size_4x() {
    printf '\x1d\x21\x33'
}

# Line spacing
default_line_spacing() {
    printf '\x1b\x32'
}

# Feed paper
feed() {
    printf '\x1b\x64\x04'
}

# Full cut
full_cut() {
    printf '\x1d\x56\x00'
}

# =============================================================================
# 1. PREREQUISITES
# =============================================================================

echo ""
log "Checking prerequisites..."

for cmd in rfcomm hcitool; do
    command -v "$cmd" &>/dev/null || \
        fail "Missing: $cmd — install with: sudo apt-get install -y bluez"
done

ok "BlueZ tools present"

# =============================================================================
# 2. BLUETOOTH ADAPTER
# =============================================================================

hcitool dev | grep -q "hci" || \
    fail "No Bluetooth adapter found"

ADAPTER=$(hcitool dev | grep hci | awk '{print $1}' | head -1)

ok "Adapter: $ADAPTER"

# =============================================================================
# 3. RFCOMM CONNECTION
# =============================================================================

log "Binding $MAC → $RFCOMM_DEV (channel $CHANNEL)..."

sudo rfcomm release "$RFCOMM_DEV" 2>/dev/null || true

if ! sudo rfcomm bind "$RFCOMM_DEV" "$MAC" "$CHANNEL" 2>/dev/null; then
    fail "rfcomm bind failed — is the printer on and in range?"
fi

ok "RFCOMM bound: $RFCOMM_DEV"

sleep 1.5

if [ ! -e "$RFCOMM_DEV" ]; then
    sudo rfcomm release "$RFCOMM_DEV" 2>/dev/null || true
    fail "Device $RFCOMM_DEV not found after bind — printer may be off or out of range"
fi

ok "Device ready: $RFCOMM_DEV"

# =============================================================================
# 4. RSSI
# =============================================================================

RSSI_VAL="N/A"

RSSI_RAW=$(hcitool rssi "$MAC" 2>&1 || true)

if echo "$RSSI_RAW" | grep -q "RSSI return value"; then
    RSSI_VAL=$(echo "$RSSI_RAW" | grep -oP '[-0-9]+' | tail -1)" dBm"
fi

# =============================================================================
# 5. INFORMATION
# =============================================================================

NOW=$(date '+%d %b %Y  %H:%M:%S')

log "Building print payload..."

# =============================================================================
# 6. SEND PRINT DATA
# =============================================================================
#
# IMPORTANT:
# We send directly to the RFCOMM device instead of using:
#
#   PAYLOAD=$(...)
#
# This is safer for ESC/POS binary control characters.
#
# =============================================================================

if {
    # -------------------------------------------------------------------------
    # Initialize
    # -------------------------------------------------------------------------

    esc_init
    default_line_spacing

    # -------------------------------------------------------------------------
    # HEADER
    # -------------------------------------------------------------------------

    align_center

    font_a
    bold_on
    size_2x

    printf 'THE BREAD\n'
    printf 'CHAPTER\n'

    size_normal
    bold_off

    printf '%s\n' "$DIV"

    # -------------------------------------------------------------------------
    # TEST BANNER
    # -------------------------------------------------------------------------

    bold_on
    size_tall
    printf '*** PRINTER TEST ***\n'
    size_normal
    bold_off

    printf '%s\n' "$DIV"

    # -------------------------------------------------------------------------
    # PRINTER INFORMATION
    # -------------------------------------------------------------------------

    align_left

    font_a
    size_normal

    printf 'Date : %s\n' "$NOW"
    printf 'MAC  : %s\n' "$MAC"
    printf 'RSSI : %s\n' "$RSSI_VAL"
    printf 'Dev  : %s\n' "$RFCOMM_DEV"
    printf 'Ch   : %s\n' "$CHANNEL"

    printf '%s\n' "$DIV"

    # -------------------------------------------------------------------------
    # FONT TEST
    # -------------------------------------------------------------------------

    align_center

    bold_on
    printf 'FONT TEST\n'
    bold_off

    printf '%s\n' "$DIV"

    align_left

    font_a
    size_normal
    printf 'Font A - Normal size\n'

    font_b
    size_normal
    printf 'Font B - Normal size\n'

    font_a
    size_tall
    printf 'Font A - Tall\n'

    font_a
    size_wide
    printf 'Font A - Wide\n'

    font_a
    size_2x
    printf 'Font A - 2X\n'

    size_normal

    printf '%s\n' "$DIV"

    # -------------------------------------------------------------------------
    # STYLE TEST
    # -------------------------------------------------------------------------

    align_center

    bold_on
    printf 'STYLE TEST\n'
    bold_off

    printf '%s\n' "$DIV"

    align_left

    bold_on
    printf 'Bold text\n'
    bold_off

    underline_on
    printf 'Underlined text\n'
    underline_off

    size_tall
    bold_on
    printf 'Tall + Bold\n'
    bold_off

    size_normal

    printf '%s\n' "$DIV"

    # -------------------------------------------------------------------------
    # SIMULATED KITCHEN ORDER
    # -------------------------------------------------------------------------

    align_center

    bold_on
    size_2x
    printf 'KITCHEN\n'
    size_normal
    bold_off

    align_left

    printf 'Table : A  10:30\n'
    printf 'Order #TEST01\n'

    printf '%s\n' "$DIV"

    bold_on

    printf '2x  Flat White\n'
    printf '1x  Croissant\n'
    printf '3x  Sourdough Toast\n'

    bold_off

    printf '%s\n' "$DIV"

    # -------------------------------------------------------------------------
    # RESULT
    # -------------------------------------------------------------------------

    align_center

    bold_on
    size_2x
    printf 'PRINT OK\n'

    size_normal
    bold_off

    printf 'Bluetooth is working!\n'

    printf '%s\n' "$DIV"

    # -------------------------------------------------------------------------
    # FINISH
    # -------------------------------------------------------------------------

    size_normal
    font_a

    feed
    full_cut

} > "$RFCOMM_DEV"; then

    ok "Data sent successfully"

else

    sudo rfcomm release "$RFCOMM_DEV" 2>/dev/null || true

    fail "Write to $RFCOMM_DEV failed — printer may have disconnected"

fi

# =============================================================================
# 7. CLEANUP
# =============================================================================

sleep 0.5

sudo rfcomm release "$RFCOMM_DEV" 2>/dev/null || true

ok "RFCOMM released"

echo ""
echo "  ─────────────────────────────────"
echo "  Bluetooth ESC/POS test completed."
echo ""
echo "  If paper came out:"
echo "    Bluetooth printing is working."
echo ""
echo "  If nothing printed:"
echo "    Check printer power."
echo "    Check Bluetooth pairing."
echo "    Check RFCOMM channel."
echo "    Check that the printer supports SPP."
echo ""
echo "  RSSI at print time: $RSSI_VAL"
echo ""