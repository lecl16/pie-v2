FROM debian:bookworm

# Install base tools + emulation support
RUN apt update && apt install -y \
    live-build \
    debootstrap \
    qemu-user-static \
    binfmt-support \
    dosfstools \
    e2fsprogs \
    mtools \
    rsync \
    make \
    sudo \
 && rm -rf /var/lib/apt/lists/*

# Register QEMU handlers for foreign archs
RUN update-binfmts --enable qemu-arm && update-binfmts --enable qemu-aarch64

WORKDIR /build
