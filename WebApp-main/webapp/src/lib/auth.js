/**
 * Checks if the JWT token in the cookie is expired
 * @returns {boolean} True if token is expired or invalid, false otherwise
 */
export function isTokenExpired() {
  try {
    // Skip on server-side
    if (typeof window === 'undefined') {
      return false;
    }
    
    const currentUserCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('currentUser='));
      
    if (!currentUserCookie) {
      return true; // No token found
    }
    
    const userData = JSON.parse(decodeURIComponent(currentUserCookie.split('=')[1]));
    if (!userData.access_token) {
      return true; // No token in cookie data
    }
    
    // JWT tokens are base64 encoded with 3 parts: header.payload.signature
    const tokenParts = userData.access_token.split('.');
    if (tokenParts.length !== 3) {
      return true; // Invalid token format
    }
    
    // The payload is the second part, base64 decoded
    const payload = JSON.parse(atob(tokenParts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const expiry = payload.exp * 1000; // Convert to milliseconds
    
    // Include a buffer time (30 seconds) to account for network latency
    return Date.now() > (expiry - 30000);
  } catch (error) {
    console.error('Error checking token expiry:', error);
    return true; // Assume expired on error
  }
}

/**
 * Gets the current user from cookie
 * @returns {Object|null} User object if found, null otherwise
 */
export function getCurrentUser() {
  try {
    // Skip on server-side
    if (typeof window === 'undefined') {
      return null;
    }
    
    const currentUserCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('currentUser='));
      
    if (!currentUserCookie) {
      return null;
    }
    
    return JSON.parse(decodeURIComponent(currentUserCookie.split('=')[1]));
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
}

/**
 * Clears the user cookie (logout)
 */
export function clearUserCookie() {
  document.cookie = "currentUser=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;";
  document.dispatchEvent(new Event('userLogout'));
}

/**
 * Sets the user cookie with appropriate security settings
 * @param {Object} userData User data to store
 */
export function setUserCookie(userData) {
  // Set secure flags in production
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const maxAge = 60 * 60 * 24; // 24 hours
  
  document.cookie = `currentUser=${encodeURIComponent(JSON.stringify(userData))}; path=/; max-age=${maxAge}${secure};`
  document.dispatchEvent(new Event('userLogin'));
}

/**
 * Refreshes the JWT token before it expires
 */
export async function setupTokenRefresh() {
  try {
    // Skip on server-side
    if (typeof window === 'undefined') {
      return;
    }
    
    const userData = getCurrentUser();
    if (!userData?.access_token) return;
    
    // Parse token payload to get expiration time
    const tokenParts = userData.access_token.split('.');
    if (tokenParts.length !== 3) return;
    
    const payload = JSON.parse(atob(tokenParts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const expTime = payload.exp * 1000; // Convert to milliseconds
    
    // Calculate refresh time (5 minutes before expiry)
    const refreshTime = expTime - Date.now() - (5 * 60 * 1000);
    
    if (refreshTime <= 0) {
      // Token is already expired or about to expire
      clearUserCookie();
      return;
    }
    
    // Set timeout to refresh token
    setTimeout(async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        
        // Call your token refresh endpoint
        const response = await fetch(`${apiUrl}/users/refresh_token`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${userData.access_token}`,
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          credentials: 'include'
        });
        
        if (response.ok) {
          const newTokenData = await response.json();
          
          // Update cookie with new token
          const updatedUserData = {
            ...userData,
            access_token: newTokenData.access_token
          };
          
          setUserCookie(updatedUserData);
          
          // Set up next refresh cycle
          setupTokenRefresh();
        } else {
          clearUserCookie();
        }
      } catch (error) {
        console.error('Token refresh failed:', error);
        clearUserCookie();
      }
    }, Math.max(0, refreshTime)); // Ensure timeout is never negative
  } catch (error) {
    console.error('Error setting up token refresh:', error);
  }
}