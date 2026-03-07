# Portable Device Setup

## Create Custom Exame Image

### Create and Run a Debian Docker Container

```bash
$ docker build -t debian-live-build .
$ docker run --rm -it -v $(pwd):/build --privileged debian-live-build bash
```

### Make the Custom Exam Image

Inside the docker container:

```bash
$ cd pie-system-image-main && make live 
```

**Note:** This step might take a while...

After the last step, one of the generated files will be the custom .iso image `live-image-amd64.hybrid.iso`.

## Flash the Micro SD Card With a Raspian 64-bit Image

Download the [Raspberry Pi Imager](https://www.raspberrypi.com/software/) software and flash the card with the following settings:

```yaml
Raspberry Pi Device:    RASPBERRY PI ZERO 2 W
Operating System:       RASPBERRY PI OS (64-BIT)
Storage:                <Micro SD Card>
```

**Note:** This step might take a while...


## Configure the base Raspian OS Image

### Increase Partition Size

Using a partition editor, such as [GParted](https://gparted.org/), increase the `/rootfs` partition size to accommodate the customized .iso image (`live-image-amd64.hybrid.iso`) which has around 2.9Gb.

### Configure USB Gadget Mode

Identify the `/bootfs` mountpoint (it should be something like `/media/<user>/bootfs`):

```bash
$ lsblk
```

Update the `config.txt` and `cmdline.txt` files:

```bash
$ sudo cp aux-files/* /media/<user>/bootfs
```

### Add the Custom Image to the Raspberry Pi

```bash
$ sudo cp pie-system-image-main/live-image-amd64.hybrid.iso /media/<user>/rootfs/boot/firmware
```