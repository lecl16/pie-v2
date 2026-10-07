#!/usr/bin/env bash
set -euo pipefail

# Installs the NFC-reader stack (reader_script.py, the device-identity HTTP
# endpoint, and their systemd units) onto the Pi's OWN Raspberry Pi OS
# rootfs — NOT pie-system-image-main's amd64 Debian image. The PN532 is
# wired to this Pi's I2C pins directly; the amd64 image is booted by a
# *separate* x86 host over the g_multi USB link (see this README's "Pi as
# USB dongle" section) and has no way to reach that hardware at all, so this
# stack has to live here instead of in that image's chroot.
#
# Run this the same way as apply-pi-gateway-setup.sh: against the mounted,
# not-yet-first-booted SD card image, before ejecting it.
#
# liblgpio and the Python venv are deliberately NOT built/created by this
# script even though it otherwise runs host-side via chroot: see
# init-nfc-venv.sh's own comment — both need to probe the real target board,
# which a chrooted host can't reliably do, so both stay deferred to the
# Pi's actual first boot via nfc-venv-init.service.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NFC_SUPPORT_DIR="$SCRIPT_DIR/../../NFC-Support"

ROOTFS="${1:-/media/<user>/rootfs}"

if [[ ! -d "$ROOTFS" ]]; then
  echo "Usage: $0 <rootfs>" >&2
  exit 2
fi

mkdir -p "$ROOTFS/opt/nfc-reader"
# Re-copy from NFC-Support/ after editing either script there — this isn't
# wired up to auto-sync.
cp "$NFC_SUPPORT_DIR/reader_script.py" "$ROOTFS/opt/nfc-reader/reader_script.py"
cp "$NFC_SUPPORT_DIR/device_identity_server.py" "$ROOTFS/opt/nfc-reader/device_identity_server.py"

install -m 755 "$SCRIPT_DIR/init-nfc-venv.sh" "$ROOTFS/usr/local/bin/init-nfc-venv.sh"

mkdir -p "$ROOTFS/etc/systemd/system"
cp "$SCRIPT_DIR/nfc-venv-init.service" "$ROOTFS/etc/systemd/system/nfc-venv-init.service"
cp "$SCRIPT_DIR/nfc-reader.service" "$ROOTFS/etc/systemd/system/nfc-reader.service"
cp "$SCRIPT_DIR/pie-device-identity.service" "$ROOTFS/etc/systemd/system/pie-device-identity.service"

mount --bind /proc "$ROOTFS/proc"
mount --bind /sys "$ROOTFS/sys"
mount --bind /dev "$ROOTFS/dev"
mount --bind /dev/pts "$ROOTFS/dev/pts"

chroot "$ROOTFS" apt update
chroot "$ROOTFS" apt install -y i2c-tools python3-venv python3-pip python3-dev build-essential swig wget
chroot "$ROOTFS" systemctl enable nfc-venv-init.service nfc-reader.service pie-device-identity.service

umount "$ROOTFS/dev/pts" "$ROOTFS/dev" "$ROOTFS/sys" "$ROOTFS/proc"

echo "Done. liblgpio + the Python venv finish setting up on the Pi's first boot (nfc-venv-init.service)."
