# PIE — Device Build

How to build the **exam OS image** and set up each **PIE device**.

## Architecture

A PIE device is a Raspberry Pi Zero 2 W with a PN532 NFC reader, plugged
into an exam laptop's USB port. Two separate systems are involved:

- **The exam OS** (`live-image-amd64.hybrid.iso`, built here) is an amd64
  Debian live system. The Pi presents it to the laptop as a read-only USB
  drive (the `g_multi` USB gadget, `aux-files/cmdline.txt`), and the laptop
  boots from it. The exam app (`DevApp-main`) runs there, in RAM: nothing
  persists between boots.
- **The Pi's own Raspberry Pi OS**, on its SD card, runs:
  - the NFC reader and the identity service for the laptop
    (`NFC-Support/`);
  - the network for the laptop: the same USB link carries a network
    interface (`usb0`, 192.168.7.2 on the Pi, 192.168.7.1 on the laptop),
    which the Pi routes to the exam room's Wi-Fi, with a DNS forwarder.

The laptop's only network is that USB link. The Pi's firewall forwards it to
the Wi-Fi and accepts nothing else from it, except the identity service and
DNS.

One image serves every device and every deployment: it holds no server
address, device identity or certificate. Those reach the Pi in the
examiner's NFC taps, and the Pi relays them to the exam app.

## The exam OS image

### What it contains

| Feature | Where (`pie-system-image-main/config/`) |
|---|---|
| Account `student` (password `pie`), logged in automatically by lightdm. No administrator account: root is locked, the `sudo` group is empty, live-config's default user is not created (`user-setup` pinned out, `live-config.noroot`) | `hooks/live/0100-add-user.hook.chroot`, `archives/no-admin-accounts.pref.chroot`, `../Makefile` |
| The exam app in `/opt/devapp`, started by `devapp.service` | `includes.chroot/opt/devapp/`, `includes.chroot/etc/systemd/system/devapp.service` |
| Network only on the USB link, configured by systemd-networkd. No NetworkManager, Wi-Fi tools or DHCP client; Wi-Fi and Bluetooth drivers blocked | `includes.chroot/etc/systemd/network/`, `archives/no-network-managers.pref.chroot`, `includes.chroot/etc/modprobe.d/pie-no-wireless.conf`, `includes.chroot/etc/tmpfiles.d/pie-resolv.conf` |
| Firefox goes through an intercepting proxy (mitmproxy, port 8081) that allows only the session's links. Firefox trusts the proxy's CA by enterprise policy | `includes.chroot/usr/local/bin/whitelist.py`, `inject-cert.sh`, `init-mitmproxy.sh`, `includes.chroot/usr/lib/firefox-esr/` |
| The exam app may power the laptop off at the end (polkit rule) | `includes.chroot/etc/polkit-1/rules.d/50-pie-poweroff.rules`, `hooks/live/0120-polkit-rules-owner.hook.chroot` |

The proxy's whitelist (`/etc/iptables/whitelist.txt`) is written by the
exam app when the student joins:
- an entry allows everything under it; an entry with a query string allows
  that page only;
- files that an allowed page loads are allowed, from any host;
- UA's login hosts are always allowed.

### Build it

Requirements: Docker, network access, and several GB of free disk space (the build tree and package cache grow well beyond the ISO itself).

1. **Put the current exam app in the image.** On an x86-64 Linux machine
   with Flutter:
   ```bash
   cd DevApp-main
   flutter build linux --release
   rm -rf ../device-build/pie-system-image-main/config/includes.chroot/opt/devapp/*
   cp -r build/linux/x64/release/bundle/* ../device-build/pie-system-image-main/config/includes.chroot/opt/devapp/
   ```
2. **Build the ISO** in the live-build container:
   ```bash
   cd device-build
   docker build -t debian-live-build .
   docker run --rm -it -v "$(pwd)":/build --privileged debian-live-build bash
   # inside the container:
   cd pie-system-image-main
   sudo lb clean --all && make live
   ```
   This takes a while. The result is
   `pie-system-image-main/live-image-amd64.hybrid.iso`.
   - **Harmless warnings:** `libisofs: WARNING : Cannot add … to Joliet
     tree` (symlinks in the installer's package pool).
   - **Success:** the build ends with `Build completed successfully`.
   - **Always clean first** (`lb clean --all`): a failed build leaves a
     chroot that the next build would reuse.

`/etc/pie-devapp/config.json` in the image comes from
`includes.chroot/etc/pie-devapp/config.json`. It only holds local paths and
the Pi's fixed USB address (see `DevApp-main/README.md`).

## Setting up a PIE device

Hardware:
- a Raspberry Pi Zero 2 W and a microSD card of 16 GB or more;
- a PN532 NFC module in I²C mode, wired to the Pi:

  | PN532 | Pi |
  |---|---|
  | VCC | 3.3 V |
  | GND | GND |
  | SDA | GPIO2, pin 3 |
  | SCL | GPIO3, pin 5 |

- a USB data cable from the Pi's USB (OTG) port, not its power-only port,
  to the laptop.

The Pi must run **Raspberry Pi OS Trixie, 64-bit** (Python 3.13 or later is
needed for TLS-PSK).

1. **Flash the card** with [Raspberry Pi Imager](https://www.raspberrypi.com/software/):
   Raspberry Pi Zero 2 W, Raspberry Pi OS (64-bit). In the customisation
   settings, create the user `pie` with a strong password. The setup script
   below enables SSH and configures the Wi-Fi.
2. **Make room for the image.** Before the first boot, grow the `rootfs`
   partition with a partition editor (for example GParted) to fit the ISO
   (about 3 GB) plus some margin.
3. **Mount both partitions** (`bootfs` and `rootfs`; check with `lsblk`)
   and, from `device-build/`, copy the boot configuration and the image:
   ```bash
   sudo cp aux-files/cmdline.txt aux-files/config.txt /media/$USER/bootfs/
   sudo cp pie-system-image-main/live-image-amd64.hybrid.iso /media/$USER/rootfs/boot/firmware/
   ```
   - `cmdline.txt` loads the USB gadget, with the ISO and fixed MAC
     addresses.
   - `config.txt` enables I²C at 10 kHz (see "Notes").
4. **Configure the network and the firewall:**
   ```bash
   sudo bash aux-files/apply-pi-gateway-setup.sh /media/$USER/rootfs /media/$USER/bootfs "<exam Wi-Fi SSID>" "<Wi-Fi password>"
   ```
   This writes:
   - the Wi-Fi connection and the `usb0` address (NetworkManager);
   - IP forwarding;
   - the DNS forwarder for the laptop (dnsmasq on `usb0`);
   - the nftables rules (below).

   It also installs dnsmasq, nftables and the SSH server, and enables them.
5. **Install the device services:**
   ```bash
   sudo bash aux-files/install-nfc-reader.sh /media/$USER/rootfs
   ```
   This copies `reader_script.py`, `device_identity_server.py` and
   `pie_tls.py` to `/opt/nfc-reader/`, installs their systemd units
   (`nfc-reader`, `pie-device-identity`, `nfc-venv-init`) and enables them.
6. **First boot, with Wi-Fi access.** `nfc-venv-init.service` builds
   `liblgpio` and the Python environment once; this takes several minutes.
   It runs on the Pi itself because `adafruit-blinka` detects the board it
   is installed on. Then, over SSH (`ssh pie@raspberrypi.local`), add the two
   units that make the USB link reliable at boot:
   ```bash
   sudo tee /etc/systemd/system/usb0-up.service >/dev/null <<'EOF'
   [Unit]
   Description=Bring up the usb0-static connection
   Requires=sys-subsystem-net-devices-usb0.device
   After=sys-subsystem-net-devices-usb0.device NetworkManager.service

   [Service]
   Type=oneshot
   ExecStartPre=/bin/sleep 30
   ExecStart=/usr/bin/nmcli connection up usb0-static
   RemainAfterExit=yes

   [Install]
   WantedBy=multi-user.target
   EOF
   sudo mkdir -p /etc/systemd/system/dnsmasq.service.d
   sudo tee /etc/systemd/system/dnsmasq.service.d/override.conf >/dev/null <<'EOF'
   [Unit]
   After=sys-subsystem-net-devices-usb0.device network-online.target
   Requires=sys-subsystem-net-devices-usb0.device

   [Service]
   Restart=on-failure
   RestartSec=5
   EOF
   sudo systemctl daemon-reload
   sudo systemctl enable usb0-up.service
   ```
7. **Check it:**
   ```bash
   systemctl is-active nfc-reader pie-device-identity dnsmasq nftables
   journalctl -u nfc-reader -b --no-pager | tail -3
   python3 --version
   ```
   - All four services show `active`.
   - The reader shows `PN532 firmware v1.6 detected` and waits for a
     registration tap.
   - Python is 3.13 or later.
8. **Register the device:** in the Examiner App, under "Provision New
   Device", enter a name (for example the seat), tap **Create & Hold for
   Tap**, and tap the phone on the device. Label the device with its ID.

### Firewall rules

`apply-pi-gateway-setup.sh` writes these to `/etc/nftables.conf`:

```
#!/usr/sbin/nft -f

flush ruleset

table inet filter {
    # Drop by default: accept only what the device's role needs.
    chain input {
        type filter hook input priority filter; policy drop;
        iifname "lo" accept
        ct state established,related accept
        ct state invalid drop
        meta l4proto icmp accept
        meta l4proto ipv6-icmp accept

        # From the exam host (USB link): the identity service
        # (device_identity_server.py, which binds 0.0.0.0) and dnsmasq.
        iifname "usb0" tcp dport 8100 accept
        iifname "usb0" meta l4proto { tcp, udp } th dport 53 accept

        # From the exam room's network (Wi-Fi uplink): DHCP replies and
        # mDNS (raspberrypi.local).
        iifname "wlan0" udp sport 67 udp dport 68 accept
        iifname "wlan0" udp sport 547 udp dport 546 accept
        iifname "wlan0" udp dport 5353 accept

        # SSH for administration, on both interfaces as before; restricting
        # it is a separate, pending decision.
        tcp dport 22 accept
    }

    # The exam host's traffic is forwarded to the uplink; nothing else is.
    chain forward {
        type filter hook forward priority filter; policy drop;
        ct state established,related accept
        iifname "usb0" oifname "wlan0" accept
    }

    chain output {
        type filter hook output priority filter;
    }
}

table inet nat {
    chain postrouting {
        type nat hook postrouting priority 100;
        oifname "wlan0" masquerade
    }
}
```

To apply changed rules to a device that is already set up, copy the file to
`/etc/nftables.conf` and run `sudo nft -c -f /etc/nftables.conf && sudo nft
-f /etc/nftables.conf`.

## Operations

### Changing things on a device that is already set up

| Change | How |
|---|---|
| A new exam OS image | Power the device off, mount its SD card, and copy the new ISO as in step 3 |
| A new version of the device services | Run `install-nfc-reader.sh` against the mounted card, or copy the files to `/opt/nfc-reader/` and run `sudo systemctl restart nfc-reader pie-device-identity` |
| Another Wi-Fi network | `sudo nmcli device wifi connect "<SSID>" password "<password>"` |
| Another server address | Nothing on the device: the next session tap carries it |

### Shutting down

Shut exam laptops down from the exam OS (**Fechar** at the end of the exam,
or the power button on the waiting screens), not by holding the laptop's
power button. A forced power-off can leave the PN532 stuck.

### The NFC reader stopped responding

These are the signs:
- taps do nothing;
- `journalctl -u nfc-reader` shows `No I2C device at address: 0x24` or
  `Errno 110`, or nothing new since boot.

**To recover:**
- run `sudo poweroff`, unplug the device for about 10 seconds, and plug it
  back in. A `reboot` is not enough, because it keeps the 3.3 V on the
  header powered.
- The reader service retries every 5 s without limit, so it comes back by
  itself once the chip answers.

If it happens often, check the wiring and the power supply.

### What the exam app's screen means

| Screen | Meaning | Check |
|---|---|---|
| "Dispositivo não provisionado" | The device isn't registered, or the server's CA hasn't been fetched yet | Register it; check the device reaches the server (`journalctl -u pie-device-identity`) |
| "A aguardar o examinador" | Registered; waiting for the session tap | Tap with the Examiner App; check `journalctl -u nfc-reader` |
| "Estado da conexão: Desconectado" | The exam app can't reach the API | From the laptop: `ip -4 addr show usb0` (192.168.7.1), `cat /etc/resolv.conf` (192.168.7.2); from the device: Wi-Fi up, server reachable |

## Default accounts

| System | Account | Notes |
|---|---|---|
| Exam OS | `student` / `pie` | Logged in automatically. Gives no rights beyond the student's own session |
| Pi | `pie` / set in Imager | Administers the device; has sudo |

## Known limitations

- **SSH on the Pi** is open on both the Wi-Fi and the USB side, with password
  login. A student could reach it from a laptop booted into another system.
  Use a strong password; restricting SSH is a pending decision.
- **The exam image still carries development leftovers:** an SSH server,
  build tools, Git, vim and VS Code (`package-lists/0003-development`,
  `0004-pkgs`, `hooks/normal/0010-install-vscode.hook.chroot`). They're
  harmless without an administrator account, but unnecessary.
- **`usb0` is named by driver** (`includes.chroot/etc/systemd/network/10-usb0.link`
  matches `rndis_host`). A phone's USB tethering uses the same driver.
  Matching the Pi's fixed MAC address (`g_multi.host_addr` in
  `cmdline.txt`) would exclude it.
- **The Pi's DNS forwarder** sends queries to a fixed resolver (`1.1.1.1`),
  not the exam room network's.
- **The reader runs as root**, for raw I²C access.
- **The Pi's root filesystem is writable** (no read-only overlay). The files
  in `/etc/pie/` and `/opt/nfc-reader/` must survive reboots, so a future
  read-only setup has to keep them on a persistent mount.

## Notes

- **I²C.** `config.txt` needs only:
  ```
  dtparam=i2c_arm=on
  dtparam=i2c_arm_baudrate=10000
  ```
  - **Why 10 kHz:** the PN532 stretches the I²C clock, which the Pi's
    controller handles badly at the default 100 kHz.
  - **No kernel NFC driver:** do not add `dtoverlay=pn532-i2c` or load the
    kernel's `nfc`/`pn532`/`pn532_i2c` modules. They take the chip away from
    the reader (`OSError: [Errno 19] No such device`).
  - **To check:** `lsmod | grep pn532` should show nothing, and
    `i2cdetect -y 1` should show `24`, not `UU`.
- **Why `reader_script.py` doesn't use `nfcpy`:** it drives the PN532 over
  I²C with `adafruit-circuitpython-pn532`. `nfcpy` has no I²C transport.
- **The device's state is kept on the Pi**: `/etc/pie/device.json`,
  `session.json` and `server-ca.json`. The exam OS keeps nothing between
  boots. See `NFC-Support/README.md`.
- **`aux-files/usb-host-net.*` and `999-enable-usb-host-net.hook.chroot`**
  are from an earlier NetworkManager-based setup of the laptop's side and
  are not used by the image.
