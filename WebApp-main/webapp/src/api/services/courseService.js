import { fetchApi } from "@/api/client";
import { ENDPOINTS } from "@/api/endpoints";

export const courseService = {
    getAllCourses: async () => {
        return fetchApi(ENDPOINTS.COURSES);
    },
    getCoursebyID: async (courseId) => {
        return fetchApi(ENDPOINTS.COURSE(courseId));
    },
    createCourse: async (course) => {
        return fetchApi(ENDPOINTS.COURSE_CREATE, {
            method: "POST",
            body: JSON.stringify(course),
            headers: {
                "Content-Type": "application/json",
                accept: "application/json"
            }
        });
    },
    updateCourse: async (courseId, course) => {
        return fetchApi(ENDPOINTS.COURSE(courseId), {
            method: "PUT",
            body: JSON.stringify(course),
            headers: {
                "Content-Type": "application/json",
                accept: "application/json"
            }
        });
    },
    deleteCourse: async (courseId) => {
        return fetchApi(ENDPOINTS.COURSE(courseId), {
            method: "DELETE"
        });
    }
};