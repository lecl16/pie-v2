# The exam devices' tunnels (app/core/tunnel.py). Uses the host kernel's
# WireGuard; this image only carries the tools.
FROM alpine:3.20
RUN apk add --no-cache wireguard-tools iproute2
COPY entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
