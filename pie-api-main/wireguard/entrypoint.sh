#!/bin/sh
# Brings up wg0 on TUNNEL_SERVER_IP and keeps its peers in step with
# /wg/peers.conf, which the API rewrites whenever a device registers its
# tunnel key (app/core/tunnel.py). The server's private key is created on
# the first start and never leaves the shared volume.
set -eu
umask 077

ADDRESS="${TUNNEL_SERVER_IP:-10.77.0.1}/${TUNNEL_PREFIX:-16}"
[ -s /wg/server.key ] || wg genkey > /wg/server.key
wg pubkey < /wg/server.key > /wg/server_public.key
chmod 644 /wg/server_public.key
[ -f /wg/peers.conf ] || : > /wg/peers.conf

ip link show wg0 >/dev/null 2>&1 || ip link add wg0 type wireguard
ip address replace "$ADDRESS" dev wg0

apply() {
  { printf '[Interface]\nPrivateKey = %s\nListenPort = 51820\n\n' "$(cat /wg/server.key)"
    cat /wg/peers.conf
  } > /run/wg0.conf
  wg syncconf wg0 /run/wg0.conf
}

apply
ip link set wg0 up
echo "wg0 up on $ADDRESS, port 51820/udp; public key $(cat /wg/server_public.key)"

last=""
while true; do
  current="$(md5sum /wg/peers.conf)"
  if [ "$current" != "$last" ]; then
    if apply; then
      echo "Peers applied: $(grep -c '^\[Peer\]' /wg/peers.conf || true)"
      last="$current"
    fi
  fi
  sleep 2
done
