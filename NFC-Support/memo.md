# Memo

## 06/04

- Removida implementação com NDEF (protocolo mais simples) e implementado HCE (permite um maior controlo e é melhor para key exchange)

- ECDH para gerar segredo partilhado e utilizar depois uma HKDF para gerar chaves e cifrar comms para evitar MITM

- Valerá a pena cada RPI ter um par de chaves localmente gerado?

## 09/04

- Imagem base não possui `openssh-server` (apenas uma nota, não deverá ser necessário)

- Teste de `reader_script.py` em máquina virtual. Faltam as seguintes dependências para poder utilizar o script:
  1. `python3-venv python3-pip`
  2. Possível fix: modificar o ficheiro `device-build/pie-system-image-main/config/package-lists/0003-development.list.chroot` e adicionar as dependências em falta
  3. Quanto ao módulo `nfcpy`, será necessário criar um venv

- Para a alínea 3 do último ponto os requisitos base serão:
  1. Adicionar boot-time venv init script em `/usr/local/bin/init-nfc-venv.sh`

     ```python
         #!/bin/bash
         set -euo pipefail

         VENV_DIR=/opt/nfc-venv
         MARKER=/var/lib/nfc-venv/.done

         mkdir -p /var/lib/nfc-venv

         if [ -f "$MARKER" ]; then
         exit 0
         fi

         python3 -m venv "$VENV_DIR"
         "$VENV_DIR/bin/pip" install --upgrade pip
         "$VENV_DIR/bin/pip" install nfcpy

         touch "$MARKER"
     ```

  2. Adicionar serviço para criar o venv (`nfc-venv-init.service`)

     ```TOML
         [Unit]
         Description=Initialize NFC Python virtualenv
         After=network-online.target
         Wants=network-online.target

         [Service]
         Type=oneshot
         ExecStart=/usr/local/bin/init-nfc-venv.sh
         RemainAfterExit=yes

         [Install]
         WantedBy=multi-user.target
     ```

  3. Adicionar serviço para o reader (`nfc-reader.service`)

     ```TOML
         [Unit]
         Description=NFC reader script
         After=nfc-venv-init.service
         Requires=nfc-venv-init.service

         [Service]
         Type=simple
         User=student
         Group=student
         ExecStart=/opt/nfc-venv/bin/python /opt/devapp/reader.py
         Restart=always
         RestartSec=3

         [Install]
         WantedBy=multi-user.target
     ```

  4. Modificar o ficheiro `device-build/pie-system-image-main/config/hooks/normal/enable-services.chroot` para adicionar symlinks para os serviços:

     ```
     #!/bin/bash
     set -e

     SYSTEMD_DIR=/etc/systemd/system
     WANTS_DIR=$SYSTEMD_DIR/multi-user.target.wants

     mkdir -p "$WANTS_DIR"

     # Existing services (fixed names to match actual unit files)
     ln -sf "$SYSTEMD_DIR/init-mitmproxy.service" "$WANTS_DIR/init-mitmproxy.service"
     ln -sf "$SYSTEMD_DIR/inject-certs.service" "$WANTS_DIR/inject-certs.service"
     ln -sf "$SYSTEMD_DIR/devapp.service" "$WANTS_DIR/devapp.service"

     # NFC services (add these after you create the unit files)
     ln -sf "$SYSTEMD_DIR/nfc-venv-init.service" "$WANTS_DIR/nfc-venv-init.service"
     ln -sf "$SYSTEMD_DIR/nfc-reader.service" "$WANTS_DIR/nfc-reader.service"
     ```

## 12/04

Imagem sem acesso à internet e a apresentar apenas a interface loopback.
No journalctl o erro é o seguinte:

```
iwlwifi 0000:00:14.3: firmware: failed to load iwlwifi-bz-a0-gf-a0-72.ucode (-2)
firmware_class: See https://wiki.debian.org/Firmware for information about missing firmware

and then it continues with the same error trying to load different firmware versions until the load iwlwifi-bz-a0-gf-a0-39.ucode
```

## 20/04

1st implementation (App2.tsx; reader_script2.py):

- Android side:
   - Generates an ephemeral Curve25519 keypair per activation.
   - Uses the reader public key you paste in the UI.
   - Encrypts compact exam payload using NaCl box (ECDH + authenticated encryption).
   - Publishes encrypted envelope through your existing HCE GET_EXAM_DATA response (INS CA), so no native Kotlin changes were required.

- Raspberry Pi side:
   - Creates and persists a static reader keypair in reader_keypair.json on first run.
   - Prints reader public key for you to paste into App2 UI.
   - Reads encrypted envelope from the phone and decrypts it.
   - Prints decrypted fields as regular exam data.

## 2026-09-03

Finalized design (previously implemented as App3.tsx/reader_script4.py,
now consolidated into App.tsx/reader_script.py — the numbered iteration
files are removed, this is the canonical version going forward): a
challenge-response scheme instead of the NaCl box encryption above.

- Raspberry Pi side (`reader_script.py`):
   - Generates and persists a random 32-byte shared secret
     (`provision_secret.txt`) on first run; printed for manual copy-paste
     into the app (see `TODO(server-integration)` — replacing this with a
     server-mediated fetch through `pie-api-main` is a planned, separate
     piece of work, not done here).
   - Requires an explicitly "armed" provisioning window (`--arm`,
     default 60s, max 300s) before accepting any tap at all — hard lock
     mode.
   - On tap: sends a random 16-byte challenge (`SET_READER_CHALLENGE`),
     then requests a signed token (`GET_PROVISION_TOKEN`).
   - Verifies the token's HMAC-SHA256 MAC under the shared secret, its
     schema version, that the echoed challenge matches, that it hasn't
     expired, and that its `jti` hasn't been used before (persisted to
     `used_token_ids.json` to survive restarts) — rejecting replays.
   - Consumes/closes the provisioning window after a successful
     provisioning, so each tap needs a fresh `--arm`.

- Android side (`ExamHceService.kt`, `NfcHceModule.kt`, `App.tsx`):
   - Examiner pastes the shared secret and fills the exam payload
     (server IP, session ID, nmec, timestamp, token TTL) in the app.
   - `setSecureProvisioning` activates HCE with that payload + secret;
     `ExamHceService.kt` builds and HMAC-signs the token natively in
     response to the reader's `SET_READER_CHALLENGE`/`GET_PROVISION_TOKEN`
     APDUs — the secret and signing never leave native code.

Net effect vs. the 20/04 NaCl design above: this is proximity-channel
authentication of *who* is provisioning (proves possession of the shared
secret, binds the token to this specific challenge/tap, and rejects
replay) rather than payload confidentiality — appropriate since the NFC
channel itself is the trusted physical proximity check, not something
that needs protecting from eavesdroppers the way a network channel would.

## 2026-09-06

Real hardware testing on the Pi surfaced two problems with the PN532/I2C
setup, both now fixed:

- `device-build/aux-files/config.txt` had `dtoverlay=pn532-i2c`, which binds
  the chip to the kernel's own NFC subsystem driver at boot. That's a
  different consumer of the I2C address than `reader_script.py` needs, and
  it silently prevented userspace access — same class of conflict as the
  classic RTC/`ds1307` overlay-vs-`i2c-dev` problem. Removed the overlay
  (`dtparam=i2c_arm=on` alone is enough); README's Notes section corrected
  to match.
- Even with that fixed, `nfc.ContactlessFrontend("i2c:/dev/i2c-1")` still
  raised `ENODEV` — turns out `nfcpy` has no I2C transport at all. Confirmed
  straight from its source (`nfc/clf/transport.py` only defines `TTY`/`USB`
  classes; `nfc/clf/pn532.py`'s `init()` hard-rejects anything that isn't
  `TYPE == "TTY"`). The `"i2c:..."` connstring was never going to work,
  independent of the overlay issue above.
- Since the I2C wiring is fixed (non-negotiable for this deployment),
  swapped `nfcpy` out for `adafruit-circuitpython-pn532`, which has a real
  I2C driver. Added a small `Type4TagSession` shim in `reader_script.py`
  that drives the PN532's `InListPassiveTarget`/`InDataExchange` commands
  directly and exposes the same `.transceive(apdu)` interface the existing
  `on_connect()`/`send_and_parse()` challenge-response logic already
  expected from an `nfcpy` tag object — so none of the HMAC/window/replay
  logic changed, only the transport underneath it.

End-to-end tap test against `ExamHceService.kt` succeeded after that (all
three APDUs returned SW=9000, token MAC verified) — the one live failure
along the way was a stale shared secret from testing in an older script
location, not a protocol bug; both sides' JSON canonicalization checked out
byte-for-byte on review.

Baked all of this into `device-build` so a fresh image has a working NFC
reader out of the box (closes the "Add python dependencies to the ISO
build" / "Upload the NFC reader script into the ISO" TODOs in
`device-build/README.md` — see its Notes section for the full breakdown):
- `reader_script.py` copied into the image at `/opt/nfc-reader/`.
- `liblgpio` (native lib `adafruit-blinka`'s GPIO backend needs) built from
  source at image-build time — no apt package for it on this Debian base.
- The actual `adafruit-circuitpython-pn532`/`adafruit-blinka` venv is
  deliberately deferred to **first boot** (`nfc-venv-init.service`) rather
  than built at image time, since Blinka's install-time board detection
  needs to run on the real Pi, not the build chroot.
- `nfc-reader.service` runs the reader loop as root at boot (needs raw
  `/dev/i2c-1`); `--arm` is still a manual one-off command post-boot.
- Flagged a persistence caveat for later: the generated
  `provision_secret.txt` only survives reboots because this image's rootfs
  is currently a real ext4 partition, not a live-boot overlay — the planned
  read-only-overlay hardening (see README's "Overlayfs" note) would need to
  carve out `/opt/nfc-reader/` as a persistent bind mount, or every reboot
  silently invalidates whatever secret is pasted into the Examiner App.