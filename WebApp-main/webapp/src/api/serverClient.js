import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Check if user is authenticated based on cookie
 * @returns {boolean} Whether the user is authenticated
 */
export function isAuthenticated() {
  const cookieStore = cookies();
  const currentUserCookie = cookieStore.get('currentUser');
  
  if (!currentUserCookie) {
    return false;
  }
  
  try {
    const userData = JSON.parse(decodeURIComponent(currentUserCookie.value));
    return !!userData.access_token;
  } catch (error) {
    console.error('Failed to parse user cookie:', error);
    return false;
  }
}

/**
 * Redirects to login if not authenticated
 * @param {boolean} shouldRedirect - Whether to redirect if not authenticated
 * @returns {boolean} Whether the user is authenticated
 */
export function requireAuth(shouldRedirect = true) {
  const authenticated = isAuthenticated();
  
  if (!authenticated && shouldRedirect) {
    redirect('/login');
  }
  
  return authenticated;
}

export async function fetchServerApi(endpoint, options = {}, requireAuthentication = true) {
  try {
    // Check authentication if required
    if (requireAuthentication && !isAuthenticated()) {
      // If this is being called from a server component where we need auth
      // we'll redirect to login page
      redirect('/login');
    }
    
    const url = `${API_BASE_URL}${endpoint}`;
    
    // Set default headers
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    
    // Get authentication token from cookies
    const cookieStore = cookies();
    const currentUserCookie = cookieStore.get('currentUser');
    
    if (currentUserCookie) {
      try {
        const userData = JSON.parse(decodeURIComponent(currentUserCookie.value));
        if (userData.access_token) {
          headers['Authorization'] = `Bearer ${userData.access_token.trim()}`;
        }
      } catch (error) {
        console.error('Failed to parse user cookie:', error);
        // Continue without authentication
      }
    }
    
    // Perform server-side fetch
    const response = await fetch(url, {
      ...options,
      headers,
      cache: options.cache || 'no-store', // Disable caching by default
      next: { revalidate: options.revalidate || 0 } // Set revalidation period
    });

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = { message: response.statusText };
      }
      
      throw new Error(`API error (${response.status}): ${JSON.stringify(errorData)}`);
    }

    // Check content type before trying to parse as JSON
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    }
    
    // Return text for non-JSON responses
    return await response.text();
  } catch (error) {
    console.error('Server API request failed:', error);
    throw error;
  }
}