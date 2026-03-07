import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
  } from "@/components/ui/alert-dialog";
  import { useTranslations } from "next-intl";
  
  export function StartSessionDialog({ open, onOpenChange, onConfirm }) {
    const t = useTranslations();
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Start_Session")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("StartSessionPopUp")}
            </AlertDialogDescription>
          </AlertDialogHeader> 
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={onConfirm}
              className="bg-[#5BA87A] text-white hover:bg-[#4A8B65]"
            >
              {t("Start_Session")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }
  
  export function EndSessionDialog({ open, onOpenChange, onConfirm }) {
    const t = useTranslations();
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("End_Session")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("EndSessionPopUp")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
            {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={onConfirm}
              className="bg-[#993333] text-white hover:bg-[#7A2929]"
            >
              {t("End_Session")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }