#!/usr/bin/env bash
set -euo pipefail

IFACE="$(ip -o link show | awk -F': ' '/enx/ {print $2; exit}')"
if [[ -z "$IFACE" ]]; then
  exit 0
fi

ip link set "$IFACE" up

CONN="$(nmcli -t -f NAME,DEVICE con show | awk -F: -v dev="$IFACE" '$2==dev{print $1; exit}')"
if [[ -z "$CONN" ]]; then
  CONN="usb0-host"
  nmcli connection add type ethernet ifname "$IFACE" con-name "$CONN" \
    ip4 192.168.7.1/24 ipv4.method manual ipv6.method ignore
fi

nmcli connection modify "$CONN" \
  ipv4.addresses 192.168.7.1/24 \
  ipv4.method manual \
  ipv4.gateway 192.168.7.2 \
  ipv4.dns "192.168.7.2" \
  ipv4.ignore-auto-dns yes \
  ipv6.method ignore

nmcli connection up "$CONN"
