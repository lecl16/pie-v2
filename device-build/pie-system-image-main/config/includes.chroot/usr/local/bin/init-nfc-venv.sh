#!/bin/bash
set -euo pipefail

# adafruit-blinka picks its GPIO backend (RPi.GPIO vs. lgpio) by probing the
# actual board it's installed on, so this has to run on the real Pi at first
# boot rather than in the (possibly foreign-arch/emulated) image-build chroot
# — otherwise it can detect the build environment instead of the target
# hardware and pick the wrong backend, or none at all.
VENV_DIR=/opt/nfc-reader/venv
MARKER=/var/lib/nfc-reader/.venv-ready

mkdir -p /var/lib/nfc-reader

if [ -f "$MARKER" ]; then
    exit 0
fi

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install adafruit-circuitpython-pn532 adafruit-blinka

touch "$MARKER"
