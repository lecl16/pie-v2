import { fetchApi } from "@/api/client";
import { ENDPOINTS  } from "@/api/endpoints";

export const examService = {
    getExams : async (courseId) => {
        return fetchApi(ENDPOINTS.EXAMS(courseId));
    },
    getExam: async (courseId, examId) => {
        return fetchApi(ENDPOINTS.EXAM(courseId, examId));
    },
    createExam: async (courseId, exam) => {
        return fetchApi(ENDPOINTS.EXAM_CREATE(courseId), {
            method: "POST",
            body: JSON.stringify(exam),
            headers: {
                "Content-Type": "application/json",
                accept: "application/json"
            }
        });
    },
    deleteExam: async(courseId, examId) => {
        return fetchApi(ENDPOINTS.EXAM(courseId, examId), {
            method: "DELETE",
            
        });
    },
    updateExam: async(courseId, examId, exam) => { 
        return fetchApi(ENDPOINTS.EXAM(courseId, examId), {
            method: "PUT",
            body: JSON.stringify(exam),
            headers: {
                "Content-Type": "application/json",
                accept: "application/json"
            }
        });
    }
}