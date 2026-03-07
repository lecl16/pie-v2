.PHONY: live 

clean:
	sudo lb clean

live: 
	lb config -d bookworm --debian-installer live --debian-installer-distribution bookworm --archive-areas "main non-free-firmware" --debootstrap-options "--variant=minbase" --bootappend-live "boot=live components locales=en_US.UTF-8 keyboard-layouts=pt --language en"
	sudo lb build
