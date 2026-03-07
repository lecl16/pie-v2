"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast, Toaster } from "sonner";
import { AlertCircle } from "lucide-react";
import { fetchApi } from "@/api/client";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import BackButton from "@/components/back-button";
import { courseService } from "@/api/services/courseService";

// Form validation schema
const formSchema = z.object({
  name: z.string().min(2, {
    message: "Course name must be at least 2 characters.",
  }),
  id: z.string().min(2, {
    message: "Course ID must be at least 2 characters.",
  }),
});

if (!courseService.updateCourse) {
  courseService.updateCourse = async (courseId, course) => {
    return fetchApi(`/course/${courseId}`, {
      method: "PUT",
      body: JSON.stringify(course),
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
      },
    });
  };
}

export default function EditCourseForm({ params }) {
  const { course_id } = params;
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [courseName, setCourseName] = useState("");

  const locale = pathname.split("/")[1];

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      id: "",
    },
  });

  useEffect(() => {
    async function fetchCourseData() {
      try {
        setIsLoading(true);
        const course = await courseService.getCoursebyID(course_id);

        if (course) {
          // Check if course.name exists and is a string
          const name =
            typeof course.name === "string"
              ? course.name
              : course.id || "Unknown";
          setCourseName(name); // Set this to a default if name is missing

          form.reset({
            name: name,
            id: course.id || "", // Provide fallback for id as well
          });
        } else {
          setError("Course not found");
        }
      } catch (err) {
        console.error("Error fetching course:", err);
        setError(err.message || "Failed to load course data");
      } finally {
        setIsLoading(false);
      }
    }

    fetchCourseData();
  }, [course_id, form]);

  async function onSubmit(values) {
    try {
      setFormError("");
      setError(null);
      setIsSubmitting(true);

      const course = {
        name: values.name,
        id: values.id,
      };

      // Update the course
      await courseService.updateCourse(course_id, course);

      // Show success message
      toast.success(
        t("Course name updated Successfully") || "Course updated successfully!"
      );

      // Navigate back to course page
      setTimeout(() => {
        router.push(`/${locale}/course/${course_id}`);
      }, 1500);
    } catch (err) {
      console.error("Error updating course:", err);
      setError(err.message || "Failed to update course. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6 bg-light-gray">Loading...</div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 bg-light-gray">
      <h1 className="text-2xl font-bold mb-6">
        {isLoading
          ? "Loading..."
          : courseName
          ? `Edit Course ${courseName}` // Don't rely solely on translations
          : "Edit Course"}
      </h1>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </Alert>
      )}

      {formError && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <span>{formError}</span>
        </Alert>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Course Name */}
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("Course Name") || "Course Name"}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={
                      t("Enter the course name") || "Enter course name"
                    }
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Course ID - Disabled as it's typically not changed after creation */}
          <FormField
            control={form.control}
            name="id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("Course Id") || "Course ID"}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t("Enter the course Id") || "Enter course ID"}
                    disabled={true}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
                <p className="text-sm text-gray-500">
                  Course ID cannot be changed after creation
                </p>
              </FormItem>
            )}
          />

          <div className="flex justify-between pt-4">
            <BackButton />
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-[#008F4C] hover:bg-[#006B3F]"
            >
              {isSubmitting
                ? t("Updating") || "Updating..."
                : t("UpdateCourse") || "Update Course"}
            </Button>
          </div>
        </form>
      </Form>

      <Toaster position="bottom-right" />
    </div>
  );
}
