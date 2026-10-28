"""The exam devices' WireGuard tunnels to the server.

Each device keeps its WireGuard private key on the device; it registers the
public key over its TLS-PSK port (POST /device/{d}/tunnel). Its tunnel
address is derived from its id, so nothing else is stored. The `wireguard`
service applies the peers written here (TUNNEL_DIR/peers.conf) and keeps
its own private key; its public key is in TUNNEL_DIR/server_public.key.

Caddy serves the API on the tunnel address, where it sets the client's
tunnel address in TUNNEL_IP_HEADER (Caddyfile). That address is what
identifies the device behind a request from an exam app.
"""

import base64
import binascii
import ipaddress
import os
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import config
from app.models.db.device import Device

# Set by Caddy on the tunnel site only; dropped on the other sites.
TUNNEL_IP_HEADER = "X-Pie-Tunnel-IP"


def _network() -> ipaddress.IPv4Network:
    return ipaddress.IPv4Network(config.TUNNEL_NETWORK)


def device_tunnel_ip(device_id: int) -> str:
    """Address 1 is the server; device n gets address n + 1."""
    network = _network()
    if device_id < 1 or device_id + 1 >= network.num_addresses - 1:
        raise ValueError(f"Device id {device_id} does not fit in {network}")
    return str(network[device_id + 1])


def device_id_for_tunnel_ip(address: str | None) -> int | None:
    """The device behind a tunnel address, or None if it is not one."""
    try:
        ip = ipaddress.IPv4Address(address or "")
    except ValueError:
        return None
    network = _network()
    if ip not in network:
        return None
    device_id = int(ip) - int(network.network_address) - 1
    return device_id if device_id >= 1 and str(ip) != config.TUNNEL_SERVER_IP else None


def valid_wireguard_key(key: str) -> bool:
    try:
        return len(base64.b64decode(key, validate=True)) == 32
    except (binascii.Error, ValueError):
        return False


def server_public_key() -> str | None:
    try:
        key = Path(config.TUNNEL_DIR, "server_public.key").read_text(encoding="ascii").strip()
    except OSError:
        return None
    return key if valid_wireguard_key(key) else None


def write_peers(db: Session):
    """Rewrites the peer list from the database; the `wireguard` service
    applies it within seconds. Write-then-rename, so it never reads half."""
    lines = []
    for device in db.query(Device).filter(Device.wg_public_key.isnot(None)).order_by(Device.id):
        lines += [
            "[Peer]",
            f"PublicKey = {device.wg_public_key}",
            f"AllowedIPs = {device_tunnel_ip(device.id)}/32",
            "",
        ]
    path = Path(config.TUNNEL_DIR, "peers.conf")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".tmp")
    tmp_path.write_text("\n".join(lines), encoding="ascii")
    os.chmod(tmp_path, 0o644)
    tmp_path.replace(path)
