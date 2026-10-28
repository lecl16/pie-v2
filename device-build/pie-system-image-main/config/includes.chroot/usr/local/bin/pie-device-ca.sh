#!/bin/bash
# Installs the exam device's CA for Firefox. The device filters the web
# traffic of this laptop (its proxy intercepts HTTPS), so the browser has
# to trust the device's CA; this system holds no rules of its own. Firefox
# installs the CA from here through its enterprise policy
# (/usr/lib/firefox-esr/distribution/policies.json) on every start.
# Retries until the device answers: it may still be starting.
URL="http://192.168.7.2:8100/proxy-ca"
CA="/usr/local/share/pie/device-ca.pem"
TMP="$(mktemp)"

until wget -q -T 3 -O "$TMP" "$URL" && grep -q "BEGIN CERTIFICATE" "$TMP"; do
    sleep 2
done
install -D -m 0644 -o root -g root "$TMP" "$CA"
rm -f "$TMP"
echo "Exam device CA installed at $CA"
