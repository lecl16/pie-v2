#!/bin/bash

LOG="/tmp/inject-certs.log"
echo "Script iniciado: $(date)" >> "$LOG"

sleep 10

# Inicia o mitmdump só para gerar o certificado
mitmdump >/dev/null 2>&1 &
MITM_PID=$!

# Espera pelo ficheiro do certificado mitmproxy
CERT_PATH="/home/student/.mitmproxy/mitmproxy-ca-cert.pem"
for i in {1..20}; do
    if [ -f "$CERT_PATH" ]; then
        echo "Certificado encontrado em $CERT_PATH" >> "$LOG"
        break
    fi
    echo "Aguardando certificado..." >> "$LOG"
    sleep 1
done

# Termina o mitmdump
kill $MITM_PID

if [ ! -f "$CERT_PATH" ]; then
    echo "Certificado não encontrado. Abortando." >> "$LOG"
    exit 1
fi

HOME_USER=/home/student

if [ -d "$HOME_USER/.mozilla/firefox" ]; then
    if [ -f "$HOME_USER/.mozilla/firefox/profiles.ini" ]; then
        for profile in "$HOME_USER"/.mozilla/firefox/*.default*; do
            certutil -A -n "mitmproxy" -t "C,," -i "$CERT_PATH" -d sql:"$profile"
        done
        echo "Certificado mitmproxy adicionado aos perfis." >> "$LOG"
    else
        echo "profiles.ini não existe. Firefox ainda não foi executado." >> "$LOG"
    fi
else
    echo "Diretório de perfis do Firefox não existe." >> "$LOG"
fi


mitmdump -p 8081 -s /usr/local/bin/whitelist.py
