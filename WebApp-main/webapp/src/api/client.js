import { isTokenExpired } from '@/lib/auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function fetchApi(endpoint, options = {}) {
  try {
    const url = `${API_BASE_URL}${endpoint}`;
    
    // Check if we're on server or client side
    const isServer = typeof window === 'undefined';
    
    // Set up headers based on content type
    const headers = options.headers || {};
    
    // Set content type if not FormData
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    
    // Add security headers
    headers['X-Requested-With'] = 'XMLHttpRequest';
    
    // Only handle auth tokens on client-side
    if (!isServer) {
      // DEBUG: Log all cookies to see what we're working with
      
      // Get auth token from cookie - robust parsing
      const cookies = document.cookie.split(';');
      let userData = null;
      
      for (const cookie of cookies) {
        const trimmedCookie = cookie.trim();
        if (trimmedCookie.startsWith('currentUser=')) {
          try {
            const cookieValue = trimmedCookie.substring('currentUser='.length);
            userData = JSON.parse(decodeURIComponent(cookieValue));
            break;
          } catch (e) {
            console.error('Failed to parse user cookie:', e);
          }
        }
      }
      
      if (userData && userData.access_token) {
        // IMPORTANT: Make sure token is properly formatted without extra spaces
        const cleanToken = userData.access_token.trim();
        
        // Explicitly set the Authorization header
        headers['Authorization'] = `Bearer ${cleanToken}`;
        
      } else {
        console.warn('No access token found in cookie - auth header not set');
      }
    }
    
    // DEBUG: Log the final headers being sent
    
    // Create the options object for fetch
    const fetchOptions = {
      ...options,
      headers: headers,
      credentials: 'include',
      mode: 'cors'
    };
    
    // Perform the fetch with proper CORS settings
    const response = await fetch(url, fetchOptions);
    
    // DEBUG: Log response status

    // Handle error responses
    if (!response.ok) {
      let errorDetails = 'Unknown error';
      try {
        const errorData = await response.json();
        errorDetails = errorData.detail || errorData.message || JSON.stringify(errorData);
      } catch (e) {
        errorDetails = response.statusText;
      }
      
      throw new Error(`API error (${response.status}): ${errorDetails}`);
    }

    // Handle empty responses or DELETE requests
    if (options.method === 'DELETE' || response.headers.get('content-length') === '0') {
      return true;
    }
    
    // Handle no-content responses
    if (response.status === 204) {
      return true;
    }
    
    // Check content type before trying to parse as JSON
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    }
    
    // Return text for non-JSON responses
    return await response.text();
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
}