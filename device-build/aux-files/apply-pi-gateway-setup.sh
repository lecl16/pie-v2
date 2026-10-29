#!/usr/bin/env bash
set -euo pipefail

ROOTFS="${1:-/media/<user>/rootfs}"
BOOTFS="${2:-/media/<user>/bootfs}"
SSID="${3:-Exam Wifi}"
PSK="${4:-abc}"
# The administrator's SSH public key (e.g. ~/.ssh/id_ed25519.pub): the only
# way into the device over SSH, which accepts no passwords.
ADMIN_KEY="${5:-}"

if [[ ! -d "$ROOTFS" || ! -d "$BOOTFS" || -z "$ADMIN_KEY" ]]; then
  echo "Usage: $0 <rootfs> <bootfs> <ssid> <psk> <admin SSH public key file>" >&2
  exit 2
fi
# Refuse anything that isn't a single public key, so a device never ends up
# with SSH enabled and no way in.
if [[ ! -f "$ADMIN_KEY" ]] || [[ "$(grep -c . "$ADMIN_KEY")" -ne 1 ]] \
    || ! ssh-keygen -l -f "$ADMIN_KEY" >/dev/null 2>&1 || grep -q PRIVATE "$ADMIN_KEY"; then
  echo "Not a single SSH public key: $ADMIN_KEY (create one with ssh-keygen -t ed25519)" >&2
  exit 2
fi

mkdir -p "$ROOTFS/etc/NetworkManager/system-connections"

cat >"$ROOTFS/etc/NetworkManager/system-connections/ExamWiFi.nmconnection" <<EOF
[connection]
id=ExamWiFi
uuid=$(uuidgen)
type=wifi
interface-name=wlan0
autoconnect=true
# Above any other Wi-Fi profile on the card; the reader keeps the same
# value when a tap changes the network (WIFI_AUTOCONNECT_PRIORITY).
autoconnect-priority=100

[wifi]
mode=infrastructure
ssid=$SSID

[wifi-security]
key-mgmt=wpa-psk
psk=$PSK

[ipv4]
method=auto

[ipv6]
addr-gen-mode=default
method=auto

[proxy]
EOF

chmod 600 "$ROOTFS/etc/NetworkManager/system-connections/ExamWiFi.nmconnection"

cat >"$ROOTFS/etc/NetworkManager/system-connections/usb0-static.nmconnection" <<EOF
[connection]
id=usb0-static
type=ethernet
interface-name=usb0
autoconnect=true

[ipv4]
method=manual
address1=192.168.7.2/24

[ipv6]
method=ignore
EOF

chmod 600 "$ROOTFS/etc/NetworkManager/system-connections/usb0-static.nmconnection"

mkdir -p "$ROOTFS/etc/dnsmasq.d"
cat >"$ROOTFS/etc/dnsmasq.d/usb0.conf" <<'EOF'
interface=usb0
bind-interfaces
listen-address=192.168.7.2
no-hosts
no-resolv
server=1.1.1.1
EOF

cat >"$ROOTFS/etc/sysctl.d/99-usb-forward.conf" <<'EOF'
net.ipv4.ip_forward=1
EOF

cat >"$ROOTFS/etc/nftables.conf" <<'EOF'
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
        # (device_identity_server.py, which binds 0.0.0.0), dnsmasq, and the
        # filtering proxy its web traffic is redirected to (pie-proxy.service).
        iifname "usb0" tcp dport 8100 accept
        iifname "usb0" meta l4proto { tcp, udp } th dport 53 accept
        iifname "usb0" tcp dport 8080 accept

        # From the exam room's network (Wi-Fi uplink): DHCP replies and
        # mDNS (raspberrypi.local).
        iifname "wlan0" udp sport 67 udp dport 68 accept
        iifname "wlan0" udp sport 547 udp dport 546 accept
        iifname "wlan0" udp dport 5353 accept

        # SSH, for the device's administration: from the Wi-Fi only, never
        # from the exam host on the USB link.
        iifname "wlan0" tcp dport 22 accept
    }

    # Only the exam host's traffic to the server is forwarded, through the
    # WireGuard tunnel (wg0, set up by device_identity_server.py, whose
    # routes only cover the server's tunnel address). Its web traffic goes
    # through the filtering proxy instead (prerouting, below), which makes
    # its own connections; nothing else reaches the Wi-Fi.
    chain forward {
        type filter hook forward priority filter; policy drop;
        ct state established,related accept
        iifname "usb0" oifname "wg0" accept
    }

    chain output {
        type filter hook output priority filter;
    }
}

table inet nat {
    # The exam host's web traffic goes to the filtering proxy, except its
    # traffic to the server's tunnel address.
    chain prerouting {
        type nat hook prerouting priority dstnat;
        iifname "usb0" ip daddr != 10.77.0.1 tcp dport { 80, 443 } redirect to :8080
    }

    chain postrouting {
        type nat hook postrouting priority 100;
        oifname "wlan0" masquerade
        # The server tells which device a request comes from by this Pi's
        # tunnel address, so the exam host's traffic takes it.
        oifname "wg0" masquerade
    }
}
EOF

mount --bind /proc "$ROOTFS/proc"
mount --bind /sys "$ROOTFS/sys"
mount --bind /dev "$ROOTFS/dev"
mount --bind /dev/pts "$ROOTFS/dev/pts"

chroot "$ROOTFS" apt update
chroot "$ROOTFS" apt install -y dnsmasq nftables openssh-server wireguard-tools
chroot "$ROOTFS" systemctl enable NetworkManager dnsmasq nftables ssh
# Raspberry Pi OS runs rpcbind (the port mapper of NFS), which the device
# doesn't use: masked, so nothing starts it as a dependency either.
chroot "$ROOTFS" systemctl mask rpcbind.service rpcbind.socket

touch "$BOOTFS/ssh"

# SSH with the administrator's key only (the firewall above already limits
# it to the Wi-Fi). The key lives outside the home directory, which only
# exists once the user is created on the first boot. sshd takes the first
# value it reads, and this file comes before the one Raspberry Pi Imager's
# settings may add (50-cloud-init.conf, which can allow passwords).
install -d -m 0755 "$ROOTFS/etc/ssh/authorized_keys"
install -m 0644 "$ADMIN_KEY" "$ROOTFS/etc/ssh/authorized_keys/pie"
install -d -m 0755 "$ROOTFS/etc/ssh/sshd_config.d"
cat >"$ROOTFS/etc/ssh/sshd_config.d/10-pie.conf" <<'EOF'
AuthorizedKeysFile /etc/ssh/authorized_keys/%u
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF

umount "$ROOTFS/dev/pts" "$ROOTFS/dev" "$ROOTFS/sys" "$ROOTFS/proc"

echo "Done. You can eject the SD card and boot the Pi."
