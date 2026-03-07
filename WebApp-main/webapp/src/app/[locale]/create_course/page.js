"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { AlertCircle } from "lucide-react";
import BackButton from "@/components/back-button";
import { usePathname } from "next/navigation";

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
import { toast, Toaster } from "sonner";
import { useTranslations } from "next-intl";
import { courseService } from "@/api/services/courseService";


export default function CreateCourseForm() {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formSchema = z.object({
    name: z.string().min(2, {
      message: t("CourseNameWarning"),
    }),
    id: z.string().min(2, {
      message: t("CourseIdWarning"),
    }),
  });

  const locale = pathname.split("/")[1];

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      id: "",
    },
  });

  async function onSubmit(values) {
    try {
      setFormError("");
      setError(null);
      setIsSubmitting(true);

      // Create the course object
      const course = {
        name: values.name,
        id: values.id,
      };

      // Submit to API
      await courseService.createCourse(course);

      // Show success message
      toast.success(t("SuccessCourseToast") || "Course created successfully!");

      // Navigate back to courses page
      setTimeout(() => {
        router.push(`/${locale}`);
      }, 1500);
    } catch (err) {
      console.error("Error creating course:", err);
      setError(err.message || "Failed to create course. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 bg-light-gray">
      <h1 className="text-2xl font-bold mb-6">
        {t("CreateCourseTitle") || "Create New Course"}
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
                <FormLabel>{t("CourseName") || "Course Name"}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={
                      t("CourseNamePlaceholder") || "Enter course name"
                    }
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Course ID */}
          <FormField
            control={form.control}
            name="id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("CourseId") || "Course ID"}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t("CourseIdPlaceholder") || "Enter course ID"}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex justify-between pt-4">
            <BackButton />
            <Button
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? t("Creating") || "Creating..."
                : t("CreateCourse") || "Create Course"}
            </Button>
          </div>
        </form>
      </Form>

      <Toaster position="bottom-right" />
    </div>
  );
}
