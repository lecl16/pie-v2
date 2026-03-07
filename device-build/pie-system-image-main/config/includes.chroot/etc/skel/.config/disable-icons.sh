#!/bin/bash
# Esperar um bocadinho para o xfdesktop arrancar
sleep 2

# Desligar os icons
xfconf-query --channel xfce4-desktop --property /desktop-icons/file-icons/show-home --create --type bool --set false
xfconf-query --channel xfce4-desktop --property /desktop-icons/file-icons/show-trash --create --type bool --set false
xfconf-query --channel xfce4-desktop --property /desktop-icons/file-icons/show-removable --create --type bool --set false
xfconf-query --channel xfce4-desktop --property /desktop-icons/file-icons/show-filesystem --create --type bool --set false
