"use client";
import { Search, User, LogOut, ChartLine } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LanguageSwitcher from "./language-switcher";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLocale } from "next-intl";
import { userService } from "@/api/services/userService";
import { getCurrentUser } from "@/lib/auth";

export default function Navbar({ searchQuery, setSearchQuery }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [isUserDialogOpen, setIsUserDialogOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  // Extract cookie parsing logic to component level
  const getUserFromCookie = () => {
    const userData = getCurrentUser();
    setCurrentUser(userData);
  };

  // Handle cookie changes
  const handleCookieChange = () => {
    getUserFromCookie();
  };

  // Handle dialog open change with data refresh
  const handleDialogOpenChange = (open) => {
    if (open) {
      // Refresh user data when dialog opens
      getUserFromCookie();
    }
    setIsUserDialogOpen(open);
  };

  // Set up cookie monitoring
  useEffect(() => {
    // Initial load
    getUserFromCookie();

    // Set up event listeners for cookie changes
    document.addEventListener("click", handleCookieChange);
    document.addEventListener("userLogin", handleCookieChange);
    document.addEventListener("userLogout", handleCookieChange);

    // Poll for cookie changes every 2 seconds as a fallback
    const cookieCheckInterval = setInterval(getUserFromCookie, 2000);

    // Cleanup event listeners on component unmount
    return () => {
      document.removeEventListener("click", handleCookieChange);
      document.removeEventListener("userLogin", handleCookieChange);
      document.removeEventListener("userLogout", handleCookieChange);
      clearInterval(cookieCheckInterval);
    };
  }, []);

  // Handle logout
  const handleLogout = async () => {
    try {
      await userService.logoutUser();
      
      // Get the current locale from the URL
      const locale = window.location.pathname.split('/')[1] || 'en';
      router.push(`/${locale}/login`);
    } catch (error) {
      console.error("Logout failed:", error);
      // Still redirect even on error
      const locale = window.location.pathname.split('/')[1] || 'en';
      router.push(`/${locale}/login`);
    }
  };

  // Handle navigation to admin page
  const navigateToAdmin = () => {
    router.push(`/${locale}/admin`);
  };

  // Get role icon based on user role
  const getRoleIcon = () => {
    if (!currentUser?.role) {
      return null;
    }

    const role = currentUser.role;
    if (role === "teacher") {
      return (
        <div className="bg-blue-500 text-white rounded-full h-10 w-10 flex items-center justify-center">
          T
        </div>
      );
    } else if (role === "admin") {
      return (
        <div className="bg-red-500 text-white rounded-full h-10 w-10 flex items-center justify-center">
          A
        </div>
      );
    } else {
      return (
        <div className="bg-gray-300 text-black rounded-full h-10 w-10 flex items-center justify-center">
          ?
        </div>
      );
    }
  };

  return (
    <nav className="bg-[#007f39] p-3 h-20">
      <div className="container mx-auto flex items-center justify-between">
        {/* Logo */}
        <Link href={`/${locale}/`}>
          <Image
            src="/pie_icon.png"
            alt="Pie Logo"
            width={60}
            height={60}
            className="rounded-full cursor-pointer"
          />
        </Link>

        {/* Search Bar */}
        <div className="flex-1 mx-8">
          <div className="relative max-w-2xl mx-auto">
            <input
              type="search"
              placeholder={t("Search")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-6 py-3 rounded-md bg-white/90 pl-4 pr-10 text-lg"
            />
            <Search className="absolute right-3 top-3 h-6 w-6 text-gray-500" />
          </div>
        </div>

        {/* Icons */}
        <div className="flex items-center gap-4">
          {currentUser?.role === "admin" && (
            <ChartLine
              className="h-6 w-6 text-white cursor-pointer"
              title={t("System_Analytics")}
              onClick={navigateToAdmin}
            />
          )}
          <LanguageSwitcher />
          <User
            className="h-6 w-6 text-white cursor-pointer"
            title={t("Profile")}
            onClick={() => handleDialogOpenChange(true)}
          />
          <LogOut
            className="h-6 w-6 text-white cursor-pointer"
            title={t("Logout")}
            onClick={handleLogout}
          />
        </div>
      </div>

      {/* User Profile Dialog */}
      <Dialog open={isUserDialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("User_Profile")}</DialogTitle>
            <DialogDescription>
              {t("Account_info")}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="flex items-center space-x-4 mb-4">
              <div
                className={`rounded-full h-12 w-12 flex items-center justify-center ${
                  currentUser?.role === "teacher"
                    ? "bg-blue-500 text-white"
                    : currentUser?.role === "admin"
                    ? "bg-red-500 text-white"
                    : "bg-gray-300 text-black"
                }`}
              >
                {currentUser?.name
                  ? currentUser.name.charAt(0).toUpperCase() // Use the first letter of the name
                  : "?"}
              </div>
              <div>
                <h3 className="font-medium text-lg">
                  {currentUser?.name || currentUser?.email || t("Unknown_User")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {currentUser?.email || ""}
                </p>
              </div>
            </div>

            {/* User Details Section */}
            <div className="space-y-3 mt-4 border-t pt-3">
              {currentUser?.role && (
                <div className="flex justify-between">
                  <span className="text-sm font-medium">{t("Role")}:</span>
                  <span className="text-sm capitalize bg-slate-100 px-2 py-0.5 rounded">
                    {currentUser.role}
                  </span>
                </div>
              )}

              {currentUser?.nmec && (
                <div className="flex justify-between">
                  <span className="text-sm font-medium">
                    {t("Student_ID")}:
                  </span>
                  <span className="text-sm font-mono bg-slate-100 px-2 py-0.5 rounded">
                    {currentUser.nmec}
                  </span>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="default"
              onClick={() => setIsUserDialogOpen(false)}
            >
              {t("Close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </nav>
  );
}
