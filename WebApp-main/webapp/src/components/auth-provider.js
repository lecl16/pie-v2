"use client";

import { useEffect, useState, createContext, useContext } from 'react';
import { useRouter } from 'next/navigation';
import { isTokenExpired, getCurrentUser, setupTokenRefresh } from '@/lib/auth';

// Create an authentication context
export const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export default function AuthProvider({ children, locale }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Public paths that don't require authentication
  const publicPaths = ['/login', '/register', '/forgot-password'];

  // Check if the current path is public
  const isPublicPath = () => {
    if (typeof window === 'undefined') return true; // Server-side, skip check
    
    const path = window.location.pathname;
    return publicPaths.some(publicPath => 
      path.endsWith(publicPath) || path === `/${locale}`
    );
  };

  useEffect(() => {
    // Skip auth check for public paths
    if (isPublicPath()) {
      setLoading(false);
      return;
    }

    const checkAuth = () => {
      try {
        // Get current user from cookie
        const currentUser = getCurrentUser();
        
        // If no user or token is expired, redirect to login
        if (!currentUser || isTokenExpired()) {
          const locale = window.location.pathname.split('/')[1] || 'en';
          router.push(`/${locale}/login?expired=${!currentUser ? 'false' : 'true'}`);
          return;
        }
        
        // User is authenticated
        setUser(currentUser);
      } catch (error) {
        console.error('Auth check error:', error);
        const locale = window.location.pathname.split('/')[1] || 'en';
        router.push(`/${locale}/login?error=true`);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
    
    // Set up token refresh
    setupTokenRefresh();
  }, [router, locale]);

  // Add event listeners for user logout/login
  useEffect(() => {
    const handleLogout = () => {
      setUser(null);
    };
    
    const handleLogin = () => {
      setUser(getCurrentUser());
    };
    
    document.addEventListener('userLogout', handleLogout);
    document.addEventListener('userLogin', handleLogin);
    
    return () => {
      document.removeEventListener('userLogout', handleLogout);
      document.removeEventListener('userLogin', handleLogin);
    };
  }, []);

  // Show loading state if we're still checking auth
  if (loading && !isPublicPath()) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}