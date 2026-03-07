"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const PopupButton = ({ buttonText = "Open Popup", title = "Popup Title", content = "This is the popup content." }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {/* Button that Opens the Pop-up */}
      <DialogTrigger asChild>
        <Button onClick={() => setIsOpen(true)}>{buttonText}</Button>
      </DialogTrigger>

      {/* Pop-up Dialog Content */}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <p className="text-gray-600">{content}</p>

        <DialogFooter className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
          <Button onClick={() => setIsOpen(false)}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PopupButton;
