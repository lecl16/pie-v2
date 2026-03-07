import { fetchApi } from "@/api/client";
import { ENDPOINTS  } from "@/api/endpoints";


const validateFile = (file) => {
  // Only check basic file type - the server will do comprehensive validation
  const allowedTypes = [

    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'image/png',
    'image/jpeg',
    'application/zip',
    'application/octet-stream'
  ];
  
  if (!allowedTypes.includes(file.type) && file.type !== '') {
    throw new Error(`File ${file.name} is not an allowed type. Please select a document, image, or archive file.`);
  }
  
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    throw new Error(`File ${file.name} is too large. Maximum size is 10MB.`);
  }
  
  return true;
};



export const sessionService = {
    getSessions: async (courseId, examId) => {
      try {
        const response = await fetchApi(ENDPOINTS.SESSIONS(courseId, examId));
        return response || [];
      } catch (error) {
        console.error("Failed to fetch sessions:", error);
        throw new Error("Unable to retrieve sessions. Please try again later.");
      }
    },
  
    getSession: async (courseId, examId, sessionId) => {
      try {
        const response = await fetchApi(ENDPOINTS.SESSION(courseId, examId, sessionId));
        if (!response) {
          throw new Error("Session not found");
        }
        return response;
      } catch (error) {
        console.error(`Failed to fetch session ${sessionId}:`, error);
        throw error.message === "Session not found" 
          ? error
          : new Error("Unable to retrieve session details. Please try again later.");
      }
    },
  
    createSession: async (courseId, examId, session) => {
      try {
        if (!session.name || !session.date || !session.room) {
          throw new Error("Missing required session information");
        }
  
        const response = await fetchApi(ENDPOINTS.SESSION_CREATE(courseId, examId), {
          method: "POST",
          body: JSON.stringify(session),
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          }
        });
        return response;
      } catch (error) {
        console.error("Failed to create session:", error);
        throw error.message === "Missing required session information"
          ? error
          : new Error("Unable to create session. Please check your input and try again.");
      }
    },
  
    uploadFile: async (courseId, examId, sessionId, formData) => {
      try {
        // Client-side validation of files
        const files = formData.getAll('files');
        const examLink = formData.get('exam_link');
        
        // Mutual exclusivity check (same as server)
        if (files.some(f => f.name) && examLink && examLink !== 'string' && examLink.trim()) {
          throw new Error("Cannot provide both files and an exam link. Choose one method only.");
        }
  
        if (examLink && examLink !== 'string' && examLink.trim()) {
          if (!examLink.startsWith('http://') && !examLink.startsWith('https://')) {
            throw new Error("Exam link must be a valid URL starting with http:// or https://");
          }
        } else if (files.length > 0) {
          for (const file of files) {
            if (file.name) {
              validateFile(file);
            }
          }
        } else {
          throw new Error("Either files or a valid exam link must be provided");
        }
  
        const response = await fetchApi(ENDPOINTS.SESSION_UPLOAD(courseId, examId, sessionId), {
          method: "POST",
          body: formData,
        });
        return response;
      } catch (error) {
        console.error("Failed to upload files:", error);
        throw error;
      }
    },
  
    deleteSession: async (courseId, examId, sessionId) => {
      try {
        if (!window.confirm("Are you sure you want to delete this session? This action cannot be undone.")) {
          return false;
        }
        
        const response = await fetchApi(ENDPOINTS.SESSION(courseId, examId, sessionId), {
          method: "DELETE",
        });
        return response;
      } catch (error) {
        console.error(`Failed to delete session ${sessionId}:`, error);
        throw new Error("Unable to delete the session. Please try again later.");
      }
    },
  
    updateSession: async (courseId, examId, sessionId, session) => {
      try {
        if (!session.name || !session.date || !session.room) {
          throw new Error("Missing required session information");
        }
  
        const response = await fetchApi(ENDPOINTS.SESSION(courseId, examId, sessionId), {
          method: "PUT",
          body: JSON.stringify(session),
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          }
        });
        return response;
      } catch (error) {
        console.error(`Failed to update session ${sessionId}:`, error);
        throw error.message === "Missing required session information"
          ? error
          : new Error("Unable to update session. Please check your input and try again.");
      }
    },
    
    updateSessionWithFiles: async (courseId, examId, sessionId, formData) => {
      try {
        const files = formData.getAll('files');
        const examLink = formData.get('exam_link');
        
        if (files.some(f => f.name) && examLink && examLink !== 'string' && examLink.trim()) {
          throw new Error("Cannot provide both files and an exam link. Choose one method only.");
        }

        if (examLink && examLink !== 'string' && examLink.trim()) {
          if (!examLink.startsWith('http://') && !examLink.startsWith('https://')) {
            throw new Error("Exam link must be a valid URL starting with http:// or https://");
          }
        } else if (files.length > 0) {
          for (const file of files) {
            if (file.name) {
              validateFile(file);
            }
          }
        }

        const response = await fetchApi(ENDPOINTS.SESSION(courseId, examId, sessionId), {
          method: "PUT",
          body: formData,
        });
        return response;
      } catch (error) {
        console.error(`Failed to update session ${sessionId} with files:`, error);
        throw error;
      }
    },
  
    getSessionUsers: async (sessionId) => {
      try {
        const response = await fetchApi(ENDPOINTS.SESSION_USER(sessionId));
        return response || [];
      } catch (error) {
        console.error(`Failed to fetch users for session ${sessionId}:`, error);
        throw new Error("Unable to retrieve session users. Please try again later.");
      }
    },
  
    startSession: async (courseId, examId, sessionId) => {
      try {
        const response = await fetchApi(`${ENDPOINTS.SESSION(courseId, examId, sessionId)}/start`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          }
        });
        
        return response;
      } catch (error) {
        if (error.message.includes("already started")) {
          throw new Error("This session has already been started.");
        }
        console.error(`Failed to start session ${sessionId}:`, error);
        throw new Error("Unable to start the session. Please try again later.");
      }
    },

    endSession: async (courseId, examId, sessionId) => {
        try {
          const response = await fetchApi(`${ENDPOINTS.SESSION_END(courseId, examId, sessionId)}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            }
          });
          
          return response;
        } catch (error) {
          if (error.message.includes("already ended")) {
            throw new Error("This session has already been ended.");
          }
          console.error(`Failed to end session ${sessionId}:`, error);
          throw new Error("Unable to end the session. Please try again later.");
        }
      },
  
      downloadSubmissions: async (courseId, examId, sessionId) => {
        try {
          
          const endpoint = ENDPOINTS.SESSION_SUBMISSIONS_DOWNLOAD(courseId, examId, sessionId);
          
          // Initialize headers with Accept type
          const headers = { 
            "Accept": "application/zip",
            "X-Requested-With": "XMLHttpRequest"
          };
          
          // Use the same authentication approach as fetchApi
          // Get user data from cookie for consistent auth handling
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
                console.error('Failed to parse user cookie for download:', e);
              }
            }
          }
          
          if (userData && userData.access_token) {
            // IMPORTANT: Use the same token handling as in fetchApi
            const cleanToken = userData.access_token.trim();
            headers['Authorization'] = `Bearer ${cleanToken}`;
          } else {
            console.warn('No access token found in cookie for download - auth header not set');
          }
          
          
          const response = await fetch(endpoint, {
            method: "GET",
            headers,
            credentials: "include",
            mode: "cors"
          });
      
          if (!response.ok) {
            console.error("Download submissions failed:", {
              status: response.status,
              statusText: response.statusText,
              headers: Object.fromEntries([...response.headers.entries()]),
            });
            
            try {
              const errorData = await response.text();
              console.error("Error response body:", errorData);
            } catch (e) {
              console.error("Could not parse error response");
            }
            
            if (response.status === 404) {
              throw new Error("No submissions found for this session");
            } else if (response.status === 403) {
              throw new Error("You don't have permission to download these submissions. Please verify you're logged in with the correct account.");
            }
            throw new Error(`API error: ${response.status} - ${response.statusText}`);
          }
          
          const contentType = response.headers.get("content-type");
          if (!contentType || !contentType.includes("application/zip")) {
            throw new Error(`Unexpected content type: ${contentType}. Expected a zip archive.`);
          }
          
          const disposition = response.headers.get('content-disposition');
          let filename = `submissions-${sessionId}-${new Date().toISOString().slice(0,10)}.zip`;
          
          if (disposition && disposition.includes('filename=')) {
            const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
            const matches = filenameRegex.exec(disposition);
            if (matches && matches[1]) {
              filename = matches[1].replace(/['"]/g, '');
            }
          }
      
          const blob = await response.blob();
          const url = window.URL.createObjectURL(
            new Blob([blob], { type: 'application/zip' })
          );
          
          const a = document.createElement("a");
          a.style.display = 'none';
          a.href = url;
          a.download = filename;
      
          document.body.appendChild(a);
          a.click();
          
          setTimeout(() => {
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
          }, 100);
      
          return true;
        } catch (error) {
          console.error("Error downloading submissions:", error);
          throw error;
        }
    },
    
    sendBroadcastMessage: async (user_nmec, message, course_id, exam_id, session_id) => {
        try {
          const response = await fetchApi(`/pie/${user_nmec}`, {
            method: "POST",
            body: JSON.stringify({
              operation: "notification",
              message: message,
              courseID: course_id,
              examID: exam_id,
              sessionID: session_id
            }),
          });
          return response;
        } catch (error) {
          console.error("API Error: Send broadcast message failed", error);
          throw error;
        }
      },

      extendUserTime: async (user_nmec, seconds, course_id, exam_id, session_id, sessionUserId = null) => {
        try {
          const pubsubResponse = await fetchApi(`/pie/${user_nmec}`, {
            method: "POST",
            body: JSON.stringify({
              operation: "insert_time",
              message: String(seconds),
              courseID: course_id,
              examID: exam_id,
              sessionID: session_id
            }),
          });
          
          if (sessionUserId) {
            try {
              const sessionUsers = await sessionService.getSessionUsers(session_id);
              const currentUser = sessionUsers.find(user => user.id === sessionUserId);
              
              if (currentUser) {
                const currentTimeChanged = currentUser.changed_time || 0;
                const newTimeChanged = currentTimeChanged + seconds;
                
                // Use PATCH to only update the time_changed field
                await fetchApi(ENDPOINTS.SESSION_USER_TIME(sessionUserId), {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    changed_time: newTimeChanged
                  }),
                });
              }
            } catch (dbError) {
              console.error("Failed to update time_changed in database:", dbError);
            }
          }
          
          return pubsubResponse;
        } catch (error) {
          console.error("API Error: Time extension failed", error);
          throw error;
        }
      },

      fetchSubmissions: async (user_nmec, courseId, examId, sessionId) => {
        try {
          const response = await fetchApi(`/pie/${user_nmec}`, {
            method: "POST",
            body: JSON.stringify({
              operation: "send_exam",
              message: "The professor has requested your submissions",
              courseID: courseId,
              examID: examId,
              sessionID: sessionId
            }),
          });
          return response;
        }
        catch (error) {
          console.error("API Error: Fetch submissions failed", error);
          throw error;
        }
      },

};
