import TestCard from "@/components/editable-card";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { serverCourseService } from "@/api/services/serverService";
import { requireAuth } from "@/api/serverClient";

export default async function CoursesPage() {
  // This will redirect to login if user is not authenticated
  requireAuth();
  
  const t = await getTranslations();

  let courses = [];

  try {
    courses = await serverCourseService.getAllCourses();
  } catch (error) {
    console.error("Error fetching courses:", error);
  }

  return (
    <div className="min-h-screen bg-light-gray">
      <main className="container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold mb-8">
          {t("CourseSelection") || "Course Selection"}
        </h1>

        {courses && courses.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {courses.map((course) => (
              <TestCard
                key={course.id}
                name={course.name}
                description={course.id}
                link={`/course/${course.id}`}
                edit_link={`/course/${course.id}/edit_course`}
                type="course"
                courseId={course.id}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-10">
            <p className="text-xl text-gray-600">No courses found.</p>
          </div>
        )}

        {/* Floating Action Button - Bottom Right */}
        <Link href="/create_course">
          <Button 
            size="icon" 
            className="fixed bottom-40 right-40 h-24 w-24 rounded-full bg-[#008F4C] hover:bg-[#006B3F] shadow-lg border-4 border-white flex items-center justify-center"
          >
            <Plus className="text-white" style={{ width: '35px', height: '35px'}} />
          </Button>
        </Link>
      </main>
    </div>
  );
}