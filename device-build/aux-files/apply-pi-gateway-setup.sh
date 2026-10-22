#!/usr/bin/env bash
set -euo pipefail

ROOTFS="${1:-/media/<user>/rootfs}"
BOOTFS="${2:-/media/<user>/bootfs}"
SSID="${3:-Exam Wifi}"
PSK="${4:-abc}"

if [[ ! -d "$ROOTFS" || ! -d "$BOOTFS" ]]; then
  echo "Usage: $0 <rootfs> <bootfs> [ssid] [psk]" >&2
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
EOF

mount --bind /proc "$ROOTFS/proc"
mount --bind /sys "$ROOTFS/sys"
mount --bind /dev "$ROOTFS/dev"
mount --bind /dev/pts "$ROOTFS/dev/pts"

chroot "$ROOTFS" apt update
chroot "$ROOTFS" apt install -y dnsmasq nftables openssh-server
chroot "$ROOTFS" systemctl enable NetworkManager dnsmasq nftables ssh

touch "$BOOTFS/ssh"

umount "$ROOTFS/dev/pts" "$ROOTFS/dev" "$ROOTFS/sys" "$ROOTFS/proc"

echo "Done. You can eject the SD card and boot the Pi."
