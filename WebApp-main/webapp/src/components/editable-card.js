"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Router, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchApi } from "@/api/client";
import { ENDPOINTS } from "@/api/endpoints";
import { sessionService } from "@/api/services/sessionService";
import { examService } from "@/api/services/examService";
import { useTranslations } from "next-intl";
import { courseService } from "@/api/services/courseService";

export default function TestCard({
  name,
  description,
  link,
  edit_link,
  type = "exam", // 'exam', 'session', or 'course' 
  courseId = "",
  examId = "",
  sessionId = "", // Only needed for session deletion
  onDeleteSuccess, // Callback after successful deletion
  })
 {
  const t = useTranslations();
  const router = useRouter();
  const validType = ["exam", "session", "course"].includes(type) ? type : "exam";
  if (validType !== type) {
    console.error(
      `Invalid type prop "${type}" provided. Using "${validType}" instead.`
    );
  }

  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const confirmMessage = t(`Are you sure you want to delete this ${validType}?`);
    if (!window.confirm(confirmMessage)) {
      return;
    }

    if (validType === "course" && !courseId) {
      console.error("Missing courseId - cannot delete course");
      alert(t("Cannot delete course: Missing course ID"));
      return;
    }

    if (validType === "exam" && (!courseId || !examId)) {
      console.error("Missing courseId or examId - cannot delete exam");
      alert(t(`Cannot delete ${validType}: Missing required IDs`));
      return;
    }

    if (validType === "session" && (!courseId || !examId || !sessionId)) {
      console.error(
        "Missing courseId, examId or sessionId - cannot delete session"
      );
      alert(t("Cannot delete session: Missing required IDs"));
      return;
    }

    setIsDeleting(true);

    try {
      if (validType === "course") {
        await courseService.deleteCourse(courseId);
      } else if (validType === "exam") {
        await examService.deleteExam(courseId, examId);
      } else {
        await sessionService.deleteSession(courseId, examId, sessionId);
      }

      if (onDeleteSuccess) {
        onDeleteSuccess();
      }
      router.refresh();
    } catch (error) {
      console.error(`Error deleting ${validType}:`, error);
      alert(t(`Failed to delete ${validType}. Please try again. (${error.message})`));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="group relative rounded-lg border bg-[#1C1C1C] p-6 hover:bg-[#242424] transition-colors">
      <Link href={link} className="block cursor-pointer">
        <div>
          <h2 className="text-lg font-semibold text-white">{name}</h2>
          <p className="mt-2 text-sm text-gray-400">{description || ""}</p>
        </div>
      </Link>

      {/* Edit Button */}
      <Link href={edit_link}>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-4 right-12 text-white"
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </Link>

      {/* Delete Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handleDelete}
        disabled={isDeleting}
        className="absolute top-4 right-4 text-white opacity-60 hover:opacity-100"
      >
        <Trash2 className="h-4 w-4" />
        {isDeleting && <span className="sr-only">{t("Deleting...")}</span>}
      </Button>
    </div>
  );
}
