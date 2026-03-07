#!/bin/bash
# Script para forçar criação do perfil .mozilla

if [ ! -d "/home/student/.mozilla" ]; then
  firefox --headless
  rm -f "/home/student/screenshot.png"
fi

