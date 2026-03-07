#!/bin/bash
ISO_PATH=$1

if [ -z "$ISO_PATH" ]; then
  echo "Usage: $0 /path/to/exam.iso"
  exit 1
fi

# Unload previous gadget if exists
modprobe -r g_mass_storage 2>/dev/null

modprobe libcomposite
GADGET_DIR=/sys/kernel/config/usb_gadget/exam_usb
mkdir -p $GADGET_DIR
cd $GADGET_DIR

echo 0x1d6b > idVendor  # Linux Foundation
echo 0x0104 > idProduct # Multifunction Composite Gadget
mkdir -p strings/0x409
echo "1234567890" > strings/0x409/serialnumber
echo "ExamDevice" > strings/0x409/manufacturer
echo "Exam Boot" > strings/0x409/product

mkdir -p functions/mass_storage.usb0
echo 1 > functions/mass_storage.usb0/stall
echo 0 > functions/mass_storage.usb0/lun.0/removable
echo $ISO_PATH > functions/mass_storage.usb0/lun.0/file

mkdir -p configs/c.1/strings/0x409
echo "Config 1" > configs/c.1/strings/0x409/configuration
ln -s functions/mass_storage.usb0 configs/c.1/

ls /sys/class/udc > UDC
echo "USB gadget ready with $ISO_PATH"
