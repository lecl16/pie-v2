import { fetchApi } from "@/api/client";
import { ENDPOINTS } from "@/api/endpoints";

// Helper functions for cookie management
function setUserCookie(userData) {
  // Set secure flags in production
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const maxAge = 60 * 60 * 24; // 24 hours
  
  document.cookie = `currentUser=${encodeURIComponent(JSON.stringify(userData))}; path=/; max-age=${maxAge}${secure};`
  document.dispatchEvent(new Event('userLogin'));
}

function clearUserCookie() {
  document.cookie = "currentUser=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;";
  document.dispatchEvent(new Event('userLogout'));
}

export const userService = {
    getUsers: async () => {
        return fetchApi(ENDPOINTS.USERS);
    },
    
    getUser: async (userId) => {
        return fetchApi(ENDPOINTS.USER(userId));
    },
    
    loginUser: async (user) => {
        try {
            const data = await fetchApi(ENDPOINTS.USER_LOGIN, {
                method: "POST",
                body: JSON.stringify(user),
                headers: {
                    "Content-Type": "application/json",
                }
            });
            
            // Set cookie if there's an access_token
            if (data && data.access_token) {
                setUserCookie(data);
            }
            
            return data;
        } catch (error) {
            console.error("Login failed:", error);
            throw error;
        }
    },
    
    logoutUser: async () => {
        try {
            await fetchApi(ENDPOINTS.USER_LOGOUT, {
                method: "POST"
            });
            
            // Clear cookie regardless of API response
            clearUserCookie();
            
            return true;
        } catch (error) {
            console.error("Logout failed:", error);
            
            // Still clear cookie on error
            clearUserCookie();
            
            throw error;
        }
    }
};