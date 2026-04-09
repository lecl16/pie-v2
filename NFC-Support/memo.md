# Memo

## 06/04

- Removida implementação com NDEF (protocolo mais simples) e implementado HCE (permite um maior controlo e é melhor para key exchange)

- ECDH para gerar segredo partilhado e utilizar depois uma HKDF para gerar chaves e cifrar comms para evitar MITM

- Valerá a pena cada RPI ter um par de chaves localmente gerado?

## 09/04

- Imagem base não possui `openssh-server` (apenas uma nota, não deverá ser necessário)

- Teste de `reader_script.py` em máquina virtual. Faltam as seguintes dependências para poder utilizar o script:
  1. `python3-venv python3-pip`
  2. Possível fix: modificar o ficheiro `device-build/pie-system-image-main/config/package-lists/0003-development.list.chroot` e adicionar as dependências em falta
  3. Quanto ao módulo `nfcpy`, será necessário criar um venv

- Para a alínea 3 do último ponto os requisitos base serão:
  1. Adicionar boot-time venv init script em `/usr/local/bin/init-nfc-venv.sh`

     ```python
         #!/bin/bash
         set -euo pipefail

         VENV_DIR=/opt/nfc-venv
         MARKER=/var/lib/nfc-venv/.done

         mkdir -p /var/lib/nfc-venv

         if [ -f "$MARKER" ]; then
         exit 0
         fi

         python3 -m venv "$VENV_DIR"
         "$VENV_DIR/bin/pip" install --upgrade pip
         "$VENV_DIR/bin/pip" install nfcpy

         touch "$MARKER"
     ```

  2. Adicionar serviço para criar o venv (`nfc-venv-init.service`)

     ```TOML
         [Unit]
         Description=Initialize NFC Python virtualenv
         After=network-online.target
         Wants=network-online.target

         [Service]
         Type=oneshot
         ExecStart=/usr/local/bin/init-nfc-venv.sh
         RemainAfterExit=yes

         [Install]
         WantedBy=multi-user.target
     ```

  3. Adicionar serviço para o reader (`nfc-reader.service`)

     ```TOML
         [Unit]
         Description=NFC reader script
         After=nfc-venv-init.service
         Requires=nfc-venv-init.service

         [Service]
         Type=simple
         User=student
         Group=student
         ExecStart=/opt/nfc-venv/bin/python /opt/devapp/reader.py
         Restart=always
         RestartSec=3

         [Install]
         WantedBy=multi-user.target
     ```

  4. Modificar o ficheiro `device-build/pie-system-image-main/config/hooks/normal/enable-services.chroot` para adicionar symlinks para os serviços:

     ```
     #!/bin/bash
     set -e

     SYSTEMD_DIR=/etc/systemd/system
     WANTS_DIR=$SYSTEMD_DIR/multi-user.target.wants

     mkdir -p "$WANTS_DIR"

     # Existing services (fixed names to match actual unit files)
     ln -sf "$SYSTEMD_DIR/init-mitmproxy.service" "$WANTS_DIR/init-mitmproxy.service"
     ln -sf "$SYSTEMD_DIR/inject-certs.service" "$WANTS_DIR/inject-certs.service"
     ln -sf "$SYSTEMD_DIR/devapp.service" "$WANTS_DIR/devapp.service"

     # NFC services (add these after you create the unit files)
     ln -sf "$SYSTEMD_DIR/nfc-venv-init.service" "$WANTS_DIR/nfc-venv-init.service"
     ln -sf "$SYSTEMD_DIR/nfc-reader.service" "$WANTS_DIR/nfc-reader.service"
     ```
