import { fetchServerApi } from "../serverClient";

export const serverCourseService = {
  getAllCourses: async () => {
    return fetchServerApi('/course');
  },
  
  getCoursebyID: async (courseId) => {
    return fetchServerApi(`/course/${courseId}`);
  }
};

export const serverExamService = {
  getExams: async (courseId) => {
    return fetchServerApi(`/course/${courseId}/exams`);
  },
  
  getExam: async (courseId, examId) => {
    return fetchServerApi(`/course/${courseId}/${examId}`);
  }
};

export const serverSessionService = {
  getSessions: async (courseId, examId) => {
    return fetchServerApi(`/course/${courseId}/${examId}/sessions`);
  },
  
  getSession: async (courseId, examId, sessionId) => {
    return fetchServerApi(`/course/${courseId}/${examId}/${sessionId}`);
  }
};