"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useParams, useRouter } from "next/navigation"
import { toast, Toaster } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Skeleton } from "@/components/ui/skeleton"
import BackButton from "@/components/back-button"
import { examService } from "@/api/services/examService"
import { useTranslations } from 'next-intl'

const formSchema = z.object({
  title: z.string().min(2, {
    message: "Exam title must be at least 2 characters.",
  }),
})

export default function EditExamForm() {
  const t = useTranslations();
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [examData, setExamData] = useState(null)
  
  const params = useParams()
  const router = useRouter()
  const { course_id, exam_id } = params

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
    },
  })

  useEffect(() => {
    async function fetchExamData() {
      try {
        setIsLoading(true)
        const data = await examService.getExam(course_id, exam_id)
        setExamData(data)
        form.reset({
          title: data.name,
        })
      } catch (err) {
        setError("Failed to load exam data")
        console.error(err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchExamData()
  }, [course_id, exam_id, form])

  async function onSubmit(values) {
    try {
      setIsSubmitting(true)
      setError(null)
      
      const updatedExam = {
        course_id: course_id,
        name: values.title
      }

      try {
        await examService.updateExam(course_id, exam_id, updatedExam)
        
        toast.success("Exam updated successfully!") // Replace with toast in the future
        router.push(`/course/${course_id}`)
      } catch (apiError) {
        throw new Error(`API error: ${apiError.message}`)
      }
    } catch (err) {
      setError(err.message || "An error occurred while updating the exam")
      toast.error("An error occurred while updating the exam") // Replace with toast in the future
      console.error(err)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Skeleton className="h-10 w-3/4 mb-6" />
        <div className="space-y-6">
          <Skeleton className="h-10 w-full" />
          <div className="flex justify-between">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
      </div>
    )
  }

  if (error && !examData) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">{t('ErrorLoadingExam')}</h1>
        <p className="text-red-500">{error}</p>
        <div className="mt-4">
          <BackButton />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6 bg-light-gray">
      <h1 className="text-2xl font-bold mb-6">{t('EditExam')}</h1>

      {error && <p className="text-red-500 mb-4">{error}</p>}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('ExamFormTitle')}</FormLabel>
                <FormControl>
                  <Input placeholder={t('ExamFormTitlePlaceholder')} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex justify-between">
            <BackButton />
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('Updating') + "..." : t('UpdateExam')}
            </Button>
          </div>
        </form>
      </Form>
      <Toaster richColors />
    </div>
  )
}