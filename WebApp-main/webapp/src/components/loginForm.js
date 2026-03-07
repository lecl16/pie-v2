"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { userService } from "@/api/services/userService";

export default function LoginForm() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [credentials, setCredentials] = useState({
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Check for expired parameter in URL
  useEffect(() => {
    const expired = searchParams.get('expired');
    if (expired === 'true') {
      setError(t("Session_Expired") || "Your session has expired. Please log in again.");
    }
  }, [searchParams, t]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setCredentials((prev) => ({
      ...prev,
      [name]: value.trim(),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    setIsLoading(true);
    setError("");

    try {
      // Validate input
      if (!credentials.email || !credentials.password) {
        setError(t("AllFieldsRequired") || "All fields are required");
        setIsLoading(false);
        return;
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(credentials.email)) {
        setError(t("InvalidEmailFormat") || "Invalid email format");
        setIsLoading(false);
        return;
      }
      
      try {
        const data = await userService.loginUser(credentials);
        
        // if role is admin or teacher redirect to /
        if (data && (data.role === "admin" || data.role === "teacher")) {
          // Get the current locale from the URL
          const locale = window.location.pathname.split("/")[1] || "en";
          router.push(`/${locale}`);
          return;
        } else if (data && data.role === "student") {
          setError(t("StudentNotAllowed") || "Student accounts cannot access the admin interface");
        } else {
          setError(t("InvalidUserRole") || "Invalid user role");
        }
      } catch (error) {
        // Simple error handling - just show the message
        setError(t("Invalid_Credentials1") || "Invalid email or password");
        throw error; // Re-throw for the outer catch
      }
    } catch (error) {
      console.error("Login error:", error);
      if (!error.message?.includes("Invalid")) {
        setError(t("LoginFailed") || "Login failed. Please try again");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Button text logic - simplified
  const getButtonText = () => {
    if (isLoading) {
      return t("LoadLogin") || "Logging in...";
    }
    return t("Login") || "Login";
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="email" className="block text-gray-700 mb-2">
          {t("Email")}
        </label>
        <input
          type="email"
          id="email"
          name="email"
          value={credentials.email}
          onChange={handleChange}
          className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
          disabled={isLoading}
          autoComplete="email"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-gray-700 mb-2">
          {t("Password")}
        </label>
        <input
          type="password"
          id="password"
          name="password"
          value={credentials.password}
          onChange={handleChange}
          className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
          disabled={isLoading}
          autoComplete="current-password"
        />
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition duration-200 disabled:bg-blue-400"
      >
        {getButtonText()}
      </button>
    </form>
  );
}