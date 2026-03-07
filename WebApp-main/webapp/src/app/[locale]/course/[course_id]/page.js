import { notFound } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import BackButton from "@/components/back-button";
import TestCard from "@/components/editable-card";
import { serverCourseService, serverExamService } from "@/api/services/serverService";

export default async function CoursePage({ params }) {
  const { course_id } = await params;
  const course = await serverCourseService.getCoursebyID(course_id);
  const exams = await serverExamService.getExams(course_id);

  if (!course) {
    return notFound(); // Show 404 if course doesn't exist
  }

  return (
    <div className="min-h-screen bg-light-gray">
      <main className="container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold mb-8">{course.name}</h1>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {exams.map((exam) => (
              <TestCard
                key={exam.id}
                name={exam.name}
                link={`/course/${course.id}/${exam.id}`}
                edit_link={`/course/${course.id}/${exam.id}/edit_exam`}
                type="exam"
                courseId={course_id}
                examId={exam.id}
              />
            ))}
          </div>

        {/* Back Button */}
        <div className="mt-8">
          <BackButton />
        </div>

        {/* Floating Action Button - Bottom Left */}
        <Link href={`/course/${course_id}/create_exam`}>
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