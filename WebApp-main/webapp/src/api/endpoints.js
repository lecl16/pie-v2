
const coursePath = (courseId) => `/course/${courseId}`;
const examPath = (courseId, examId) => `${coursePath(courseId)}/${examId}`;
const sessionPath = (courseId, examId, sessionId) => `${examPath(courseId, examId)}/${sessionId}`;

export const ENDPOINTS = {
  // Course endpoints
  COURSES: "/course",
  COURSE: coursePath,
  COURSE_CREATE: `/course/create`, // * ADMIN SIDE


  // Exam endpoints
  EXAMS: (courseId) => `${coursePath(courseId)}/exams`,
  EXAM: examPath,
  EXAM_CREATE: (courseId) => `${coursePath(courseId)}/exam-create`,

  // Session endpoints
  SESSIONS: (courseId, examId) => `${examPath(courseId, examId)}/sessions`,
  SESSION: sessionPath,
  SESSION_CREATE: (courseId, examId) => `${examPath(courseId, examId)}/session-create`,
  SESSION_UPLOAD: (courseId, examId, sessionId) => `${sessionPath(courseId, examId, sessionId)}/upload`,
  SESSION_DOWNLOAD: (courseId, examId, sessionId) => `${sessionPath(courseId, examId, sessionId)}/download`, // * STUDENT SIDE
  SESSION_START: (courseId, examId, sessionId) => `${sessionPath(courseId, examId, sessionId)}/start`,
  SESSION_END: (courseId, examId, sessionId) => `${sessionPath(courseId, examId, sessionId)}/end`,
  SESSION_GET_KEY: (courseId, examId, sessionId) => `${sessionPath(courseId, examId, sessionId)}/key`, // * STUDENT SIDE 
  SESSION_SUBMISSIONS: (courseId, examId, sessionId) => `${sessionPath(courseId, examId, sessionId)}/submissions`,
  SESSION_SUBMISSIONS_DOWNLOAD: (courseId, examId, sessionId) =>  `/api/course/${courseId}/${examId}/${sessionId}/get-submissions`,

  // User endpoints
  USERS: "/users",
  USER: (userId) => `/users/${userId}`,
  USER_CREATE: "/users/create", // * ADMIN SIDE
  USER_LOGIN: "/users/login",
  USER_LOGOUT: "/users/logout",

  // SESSION USER ENDPOINTS
  SESSION_USERS: "/session-users", // * ADMIN SIDE (GET ALL)
  SESSION_USER: (sessionUserId) => `/session-users/${sessionUserId}`,
  SESSION_USER_CREATE: "/session-users/create", // * STUDENT SIDE
  SESSION_USER_TIME: (sessionUserId) => `/session-users/${sessionUserId}/time`,
};