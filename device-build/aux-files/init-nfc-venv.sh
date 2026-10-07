#!/bin/bash
set -euo pipefail

# First-boot setup for the NFC reader stack, on the Pi's own real hardware —
# not at image-build/chroot time (see install-nfc-reader.sh). Two things are
# deferred here rather than done ahead of time, for the same underlying
# reason: adafruit-blinka picks its GPIO backend (RPi.GPIO vs. lgpio) by
# probing the actual board it's installed on, so this has to run on the real
# Pi rather than in a (possibly foreign-arch/emulated) install-time chroot —
# otherwise it can detect the build/install environment instead of the
# target hardware and pick the wrong backend, or none at all.
VENV_DIR=/opt/nfc-reader/venv
MARKER=/var/lib/nfc-reader/.venv-ready

mkdir -p /var/lib/nfc-reader

if [ -f "$MARKER" ]; then
    exit 0
fi

# adafruit-blinka's "lgpio" GPIO backend (used by adafruit-circuitpython-pn532
# for the NFC reader, see NFC-Support/reader_script.py) is a Python wrapper
# around a separate native liblgpio.so, which this Debian base has no apt
# package for. Build it from source here, once, directly on the target
# hardware — same reasoning as above, this isn't reliably cross-buildable
# from install-nfc-reader.sh's host-side chroot.
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT
cd "$BUILD_DIR"
wget -q https://github.com/joan2937/lg/archive/refs/heads/master.tar.gz -O lg.tar.gz
tar xf lg.tar.gz
cd lg-master
make
make install
ldconfig
cd /

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install adafruit-circuitpython-pn532 adafruit-blinka cryptography

touch "$MARKER"
