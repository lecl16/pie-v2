#!/usr/bin/env bash
# Generates the TLS certificates for this PIE-API deployment.
#
# - certs/ca.crt / ca.key: a private certificate authority for THIS
#   deployment only. Created once and never overwritten; ca.crt is the file
#   installed on the examiner's phone (and the teacher's browser).
# - certs/server.crt / server.key: the API's certificate, signed by that CA.
#   Re-issued on every run, so when the server's address changes (e.g. a
#   different room) just re-run this script with the new address and restart
#   the API. Clients keep trusting the CA, so nothing changes on the phone.
# - certs/phone-ca.crt / phone-ca.key: a second CA, which only signs the
#   client certificates of enrolled Examiner App phones (POST
#   /examiner-phone/enroll). Created once. The API holds its key to sign;
#   Caddy trusts its certificate on the phone port (Caddyfile).
#
# Usage:
#   ./scripts/generate-certs.sh                 # this machine's addresses
#   ./scripts/generate-certs.sh 192.168.1.50 pie.example.org
# localhost and 127.0.0.1 are always included, for the dashboard, and the
# tunnel address 10.77.0.1, for the exam apps.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
CERT_DIR="$ROOT_DIR/certs"

CA_DAYS=3650
# 825 days is the longest validity some clients accept for a server
# certificate, even from a private CA.
SERVER_DAYS=825

if ! command -v openssl >/dev/null 2>&1; then
  echo "Error: openssl is required but was not found." >&2
  exit 1
fi

mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Addresses the certificate is valid for: the arguments, or else every
# IPv4 address and the hostname of this machine; plus localhost.
hosts=("$@")
if [[ ${#hosts[@]} -eq 0 ]]; then
  hosts=("$(hostname)")
  if hostname -I >/dev/null 2>&1; then
    read -r -a ips <<< "$(hostname -I)"
  else
    # macOS has no `hostname -I`.
    ips=($(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2}'))
  fi
  for ip in "${ips[@]}"; do
    [[ "$ip" == *.*.*.* ]] && hosts+=("$ip")
  done
fi
# Also the server's address inside the devices' tunnels (TUNNEL_SERVER_IP),
# where the exam apps reach it.
hosts+=(localhost 127.0.0.1 "${TUNNEL_SERVER_IP:-10.77.0.1}")

san=""
for host in "${hosts[@]}"; do
  if [[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    san+="IP:$host,"
  else
    san+="DNS:$host,"
  fi
done
san="${san%,}"

if [[ ! -f "$CERT_DIR/ca.key" ]]; then
  echo "Creating the deployment CA..."
  cat > "$TMP_DIR/ca.ext" <<EOF
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
EOF
  openssl ecparam -name prime256v1 -genkey -noout -out "$CERT_DIR/ca.key"
  openssl req -new -key "$CERT_DIR/ca.key" -out "$TMP_DIR/ca.csr" \
    -subj "/O=PIE/CN=PIE Deployment CA ($(hostname), $(date -u +%Y-%m-%d))"
  openssl x509 -req -in "$TMP_DIR/ca.csr" -signkey "$CERT_DIR/ca.key" \
    -days "$CA_DAYS" -sha256 -extfile "$TMP_DIR/ca.ext" -out "$CERT_DIR/ca.crt"
  chmod 600 "$CERT_DIR/ca.key"
else
  echo "Reusing the existing deployment CA."
fi

if [[ ! -f "$CERT_DIR/phone-ca.key" ]]; then
  echo "Creating the phone CA..."
  cat > "$TMP_DIR/phone-ca.ext" <<EOF
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
EOF
  openssl ecparam -name prime256v1 -genkey -noout -out "$CERT_DIR/phone-ca.key"
  openssl req -new -key "$CERT_DIR/phone-ca.key" -out "$TMP_DIR/phone-ca.csr" \
    -subj "/O=PIE/CN=PIE Examiner Phone CA ($(hostname), $(date -u +%Y-%m-%d))"
  openssl x509 -req -in "$TMP_DIR/phone-ca.csr" -signkey "$CERT_DIR/phone-ca.key" \
    -days "$CA_DAYS" -sha256 -extfile "$TMP_DIR/phone-ca.ext" -out "$CERT_DIR/phone-ca.crt"
  chmod 600 "$CERT_DIR/phone-ca.key"
else
  echo "Reusing the existing phone CA."
fi

echo "Issuing the server certificate for: ${hosts[*]}"
cat > "$TMP_DIR/server.ext" <<EOF
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = $san
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
EOF
openssl ecparam -name prime256v1 -genkey -noout -out "$TMP_DIR/server.key"
openssl req -new -key "$TMP_DIR/server.key" -out "$TMP_DIR/server.csr" \
  -subj "/O=PIE/CN=PIE API (${hosts[0]})"
openssl x509 -req -in "$TMP_DIR/server.csr" \
  -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
  -days "$SERVER_DAYS" -sha256 -extfile "$TMP_DIR/server.ext" -out "$TMP_DIR/server.crt"
rm -f "$CERT_DIR/ca.srl"
mv "$TMP_DIR/server.key" "$CERT_DIR/server.key"
mv "$TMP_DIR/server.crt" "$CERT_DIR/server.crt"
chmod 600 "$CERT_DIR/server.key"

echo
echo "Done. Files in $CERT_DIR:"
echo "  ca.crt      install this on the examiner's phone (and the teacher's browser)"
echo "  ca.key      keep private; only this script needs it"
echo "  phone-ca.*  signs the Examiner App phones' certificates (used by the API and Caddy)"
echo "  server.crt  / server.key  used by the API"
echo
echo "CA fingerprint (compare with the one shown on the phone when installing):"
openssl x509 -in "$CERT_DIR/ca.crt" -noout -fingerprint -sha256
echo
echo "If the API is already running, restart Caddy: docker compose restart caddy"
