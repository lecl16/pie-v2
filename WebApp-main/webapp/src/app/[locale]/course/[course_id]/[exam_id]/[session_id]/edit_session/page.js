"use client";

import { useState, useEffect, useRef } from "react";
import {
  CalendarIcon,
  Upload,
  Link as LinkIcon,
  AlertCircle,
  Globe,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format, parse } from "date-fns";
import BackButton from "@/components/back-button";
import { sessionService } from "@/api/services/sessionService";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert } from "@/components/ui/alert";
import { toast, Toaster } from "sonner";
import { useTranslations } from "next-intl";

const formSchema = z.object({
  title: z.string().min(2, {
    message: "Title must be at least 2 characters.",
  }),
  date: z.date({
    required_error: "A date is required.",
  }),
  room: z.string().min(1, {
    message: "Room is required.",
  }),
  duration: z.string().min(1, {
    message: "Duration is required.",
  }),
  examLink: z
    .string()
    .url("Please enter a valid URL starting with http:// or https://")
    .optional()
    .or(z.literal("")),
});

export default function EditSessionForm() {
  const t = useTranslations();
  const [files, setFiles] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [activeTab, setActiveTab] = useState("files");
  const [formError, setFormError] = useState("");
  const [whitelistLink, setWhitelistLink] = useState("");
  const [whitelistLinks, setWhitelistLinks] = useState([]);
  const [whitelistedStudents, setWhitelistedStudents] = useState([]);
  const fileInputRef = useRef(null);

  const params = useParams();
  const router = useRouter();
  const { course_id, exam_id, session_id } = params;

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      setFiles((prevFiles) => [...prevFiles, ...droppedFiles]);
      e.dataTransfer.clearData();
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      setFiles((prevFiles) => [...prevFiles, ...selectedFiles]);
    }
  };

  const handleRemoveFile = (indexToRemove) => {
    setFiles((prevFiles) =>
      prevFiles.filter((_, index) => index !== indexToRemove)
    );
  };

  const isValidUrl = (string) => {
    try {
      const url = new URL(string);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (_) {
      return false;
    }
  };

  const handleAddWhitelistLink = () => {
    if (isValidUrl(whitelistLink) && !whitelistLinks.includes(whitelistLink)) {
      setWhitelistLinks([...whitelistLinks, whitelistLink]);
      setWhitelistLink("");
    }
  };

  const handleRemoveWhitelistLink = (indexToRemove) => {
    setWhitelistLinks(
      whitelistLinks.filter((_, index) => index !== indexToRemove)
    );
  };

  const handleWhitelistUpload = (e) => {
    const file = e.target.files[0];
    if (!file || !file.name.endsWith(".csv")) {
      toast.error(t("PleaseSelectCSVFile") || "Please select a valid CSV file");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target.result;
        const rows = text.split("\n");

        const dataRows = rows[0].includes("email") ? rows.slice(1) : rows;

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        const uniqueEmails = new Set();
        const students = [];
        const duplicates = [];

        dataRows.forEach((row) => {
          const columns = row.split(/[\t,]/);

          if (columns.length > 5) {
            const email = columns[5].trim();
            if (email && emailRegex.test(email)) {
              if (!uniqueEmails.has(email.toLowerCase())) {
                uniqueEmails.add(email.toLowerCase());
                students.push({ email });
              } else {
                duplicates.push(email);
              }
            }
          }
        });

        if (students.length === 0) {
          toast.error(
            t("NoValidEmailsFound") || "No valid emails found in the CSV file"
          );
          return;
        }

        setWhitelistedStudents(students);

        if (duplicates.length > 0) {
          toast.success(
            t("WhitelistUpdatedWithDuplicates", {
              count: students.length,
              duplicates: duplicates.length,
            }) ||
              `Whitelist updated with ${students.length} student emails. ${duplicates.length} duplicate(s) were removed.`
          );
        } else {
          toast.success(
            t("WhitelistUpdated", { count: students.length }) ||
              `Whitelist updated with ${students.length} student emails`
          );
        }

        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      } catch (error) {
        console.error("Error processing CSV:", error);
        toast.error(t("ErrorProcessingCSV") || "Error processing CSV file");
      }
    };
    reader.readAsText(file);
  };

  const handleAddStudent = () => {
    const studentEmail = document.getElementById("student-email").value.trim();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(studentEmail)) {
      toast.error(t("InvalidEmailFormat") || "Invalid email format");
      return;
    }

    if (
      whitelistedStudents.some(
        (student) => student.email.toLowerCase() === studentEmail.toLowerCase()
      )
    ) {
      toast.error(
        t("EmailAlreadyInList") || "This email is already in the list"
      );
      return;
    }

    setWhitelistedStudents([...whitelistedStudents, { email: studentEmail }]);

    document.getElementById("student-email").value = "";
  };

  const handleRemoveStudent = (index) => {
    setWhitelistedStudents(whitelistedStudents.filter((_, i) => i !== index));
  };

  const clearWhitelist = () => {
    setWhitelistedStudents([]);
    toast.success(t("WhitelistCleared") || "Student whitelist cleared");
  };

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      room: "",
      duration: "02:00",
      examLink: "",
    },
  });

  useEffect(() => {
    async function fetchSessionData() {
      try {
        setIsLoading(true);
        const data = await sessionService.getSession(
          course_id,
          exam_id,
          session_id
        );
        setSessionData(data);

        if (data.allowed_links && Array.isArray(data.allowed_links)) {
          setWhitelistLinks(data.allowed_links);
        }

        if (data.allowed_students && Array.isArray(data.allowed_students)) {
          const students = data.allowed_students.map((email) => ({ email }));
          setWhitelistedStudents(students);
        } else {
          setWhitelistedStudents([]); // Ensure it's initialized as empty array
        }

        if (data.exam_link && data.exam_link.trim() !== "") {
          setActiveTab("link");
        } else {
          setActiveTab("files");
        }

        let formattedDuration = "02:00";
        if (data.duration) {
          const totalSeconds = parseInt(data.duration);

          if (!isNaN(totalSeconds)) {
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            formattedDuration = `${String(hours).padStart(2, "0")}:${String(
              minutes
            ).padStart(2, "0")}`;
          }
        }

        let displayExamLink = "";
        if (data.exam_link && data.exam_link.includes("|")) {
          displayExamLink = data.exam_link.split("|")[0];
        } else if (data.exam_link) {
          displayExamLink = data.exam_link;
        }

        form.reset({
          title: data.name,
          room: data.room,
          date: new Date(data.date),
          duration: formattedDuration,
          examLink: displayExamLink,
        });

        setIsLoading(false);
      } catch (err) {
        console.error("Failed to fetch session data:", err);
        setError("Failed to load session data. Please try again.");
        setIsLoading(false);
      }
    }

    fetchSessionData();
  }, [course_id, exam_id, session_id, form]);

  const validateFormBeforeSubmit = (values) => {
    const hasFiles = files.length > 0;
    const hasLink = values.examLink && values.examLink.trim() !== "";
    const hasExistingMaterials =
      sessionData?.encrypted_exam_file || sessionData?.exam_link;

    if (hasFiles && hasLink) {
      setFormError(
        "You cannot provide both files and an exam link. Please choose one option."
      );
      return false;
    }

    if (!hasExistingMaterials && !hasFiles && !hasLink) {
      setFormError("Please provide either exam files or an external link.");
      return false;
    }

    return true;
  };

  async function onSubmit(values) {
    try {
      setFormError("");
      setError(null);

      if (!validateFormBeforeSubmit(values)) {
        return;
      }

      setIsSubmitting(true);

      const formattedDate = format(values.date, "yyyy-MM-dd");

      let durationInSeconds = 7200;

      if (
        typeof values.duration === "string" &&
        values.duration.includes(":")
      ) {
        try {
          const [hours, minutes] = values.duration.split(":");
          durationInSeconds =
            parseInt(hours, 10) * 3600 + parseInt(minutes, 10) * 60;
        } catch (err) {
          console.error("Failed to parse duration:", err);
        }
      }

      const hasNewFiles = files.length > 0;
      const hasNewLink = values.examLink && values.examLink.trim() !== "";
      const keepExistingMaterials = !hasNewFiles && !hasNewLink;

      const formData = new FormData();

      formData.append("name", values.title);
      formData.append("date", formattedDate);
      formData.append("duration", String(durationInSeconds));
      formData.append("room", values.room);
      formData.append("exam_id", Number(exam_id));
      formData.append("course_id", course_id);

      if (whitelistLinks.length > 0) {
        formData.append("allowed_links", JSON.stringify(whitelistLinks));
      }

      const studentEmails = whitelistedStudents.map((student) => student.email);
      formData.append("allowed_students", JSON.stringify(studentEmails));

      // Add a flag to indicate we're keeping existing materials
      if (keepExistingMaterials) {
        formData.append("keep_existing_materials", "true");
      } else if (hasNewFiles) {
        for (const file of files) {
          formData.append("files", file);
        }
      } else if (hasNewLink) {
        formData.append("exam_link", values.examLink);
      }

      const response = await sessionService.updateSessionWithFiles(
        course_id,
        exam_id,
        session_id,
        formData
      );

      toast.success("Session updated successfully!");
      router.push(`/course/${course_id}/${exam_id}`);
    } catch (err) {
      setError(err.message || "An error occurred while updating the session");
      toast.error(
        err.message || "An error occurred while updating the session"
      );
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">{t("EditSession")}</h1>
        <div className="space-y-6">
          <Skeleton className="h-10 w-full" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
          <Skeleton className="h-40 w-full" />
          <div className="flex justify-between">
            <Skeleton className="h-10 w-20" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !sessionData) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </Alert>
        <div className="mt-4">
          <BackButton />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 bg-light-gray">
      <h1 className="text-2xl font-bold mb-6">{t("EditSession")}</h1>

      {formError && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <span>{formError}</span>
        </Alert>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("SessionTitle")}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t("SessionTitlePlaceholder")}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>{t("Date")}</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant={"outline"}
                          className={cn(
                            "pl-3 text-left font-normal",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {field.value ? (
                            format(field.value, "yyyy-MM-dd")
                          ) : (
                            <span>{t("DatePlaceholder")}</span>
                          )}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="room"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("Room")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("RoomPlaceholder")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="duration"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("Duration")}</FormLabel>
                  <FormControl>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          max="10"
                          placeholder={t("Hours")}
                          value={
                            field.value && field.value.includes(":")
                              ? field.value.split(":")[0]
                              : "00"
                          }
                          onChange={(e) => {
                            const hours = e.target.value;
                            const minutes =
                              field.value && field.value.includes(":")
                                ? field.value.split(":")[1] || "00"
                                : "00";
                            field.onChange(
                              `${hours.padStart(2, "0")}:${minutes}`
                            );
                          }}
                          className="w-20"
                        />
                        <span>:</span>
                        <Input
                          type="number"
                          min="0"
                          max="59"
                          placeholder={t("Minutes")}
                          value={
                            field.value && field.value.includes(":")
                              ? field.value.split(":")[1]
                              : "00"
                          }
                          onChange={(e) => {
                            const hours =
                              field.value && field.value.includes(":")
                                ? field.value.split(":")[0] || "00"
                                : "00";
                            const minutes = e.target.value;
                            field.onChange(
                              `${hours}:${minutes.padStart(2, "0")}`
                            );
                          }}
                          className="w-20"
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {t("DurationHelper")}
                      </span>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="border rounded-md p-4">
            <h3 className="font-medium mb-4">{t("ExamMaterials")}</h3>

            {(sessionData?.encrypted_exam_file || sessionData?.exam_link) && (
              <div className="mb-4 p-3 bg-gray-50 rounded-md">
                <p className="text-sm font-medium">{t("CurrentMaterials")}:</p>
                {sessionData?.encrypted_exam_file && (
                  <p className="text-sm text-muted-foreground">
                    {t("File")}:{" "}
                    {sessionData.encrypted_exam_file.split("/").pop()}
                  </p>
                )}
                {sessionData?.exam_link && (
                  <p className="text-sm text-muted-foreground">
                    {t("Link")}:{" "}
                    {sessionData.exam_link.includes("|")
                      ? sessionData.exam_link.split("|")[0]
                      : sessionData.exam_link}
                  </p>
                )}
              </div>
            )}

            <Tabs
              defaultValue={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="files">{t("ReplaceWithFiles")}</TabsTrigger>
                <TabsTrigger value="link">{t("ReplaceWithLink")}</TabsTrigger>
              </TabsList>

              <TabsContent value="files" className="mt-0">
                <div
                  className="border border-dashed rounded-md p-10 text-center cursor-pointer"
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Upload className="h-10 w-10 text-muted-foreground" />
                    <div className="flex flex-col items-center">
                      <p className="text-sm font-medium">{t("UpdateFiles")}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("DropFilesInstructions")}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("AcceptedFileTypes")}
                      </p>
                    </div>
                    <Input
                      type="file"
                      className="hidden"
                      id="file-upload"
                      multiple
                      onChange={handleFileChange}
                    />
                    <label
                      htmlFor="file-upload"
                      className="mt-2 inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
                    >
                      {t("SelectFiles")}
                    </label>
                  </div>
                  {files.length > 0 && (
                    <div className="mt-4">
                      <p className="text-sm font-medium">
                        {t("NewFilesToUpload")}:
                      </p>
                      <ul className="text-sm text-muted-foreground mt-1">
                        {files.map((file, index) => (
                          <li
                            key={index}
                            className="flex justify-between items-center"
                          >
                            <span>{file.name}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveFile(index)}
                              className="h-8 w-8 p-0"
                            >
                              ×
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="link" className="mt-0">
                <FormField
                  control={form.control}
                  name="examLink"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("ExternalExamLink")}</FormLabel>
                      <FormControl>
                        <div className="flex items-center">
                          <LinkIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder={t("ExamLinkPlaceholder")}
                            {...field}
                            className="flex-1"
                          />
                        </div>
                      </FormControl>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("ExamLinkHelper")}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>
            </Tabs>
          </div>

          <div className="border rounded-md p-4">
            <h3 className="font-medium mb-4">
              {t("Allowed Links") || "Allowed Links"}
            </h3>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("The Links should start by https:// or http://") ||
                  "Add links that students are allowed to access during the exam."}
              </p>

              <div className="flex gap-2">
                <div className="flex items-center flex-1">
                  <Globe className="mr-2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="https://example.com"
                    value={whitelistLink}
                    onChange={(e) => setWhitelistLink(e.target.value)}
                    className="flex-1"
                  />
                </div>
                <Button
                  type="button"
                  onClick={handleAddWhitelistLink}
                  disabled={!isValidUrl(whitelistLink)}
                >
                  {t("Add Link") || "Add Link"}
                </Button>
              </div>

              {whitelistLinks.length > 0 && (
                <div className="mt-4">
                  <div className="flex justify-between items-center bg-blue-50 p-2 rounded-t-md border-b">
                    <p className="text-sm font-medium text-blue-700">
                      {t("Whitelisted Links", {
                        count: whitelistLinks.length,
                      }) || `Whitelisted Links (${whitelistLinks.length})`}
                    </p>
                  </div>
                  <div className="max-h-60 overflow-y-auto border border-t-0 rounded-b-md">
                    <ul className="divide-y">
                      {whitelistLinks.map((link, index) => (
                        <li
                          key={index}
                          className="flex items-center justify-between p-2 hover:bg-gray-50"
                        >
                          <span className="text-sm truncate max-w-[80%]">
                            {link}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveWhitelistLink(index)}
                            className="h-8 w-8 p-0 text-red-500 hover:bg-red-100"
                          >
                            ×
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="border rounded-md p-4">
            <h3 className="font-medium mb-4">
              {t("Student Whitelist") || "Student Whitelist"}
            </h3>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("Add the students that are allowed do join this session.") ||
                  "Add students who are allowed to join this session. Leave empty to allow all students."}
              </p>

              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".csv"
                    onChange={handleWhitelistUpload}
                    className="hidden"
                    id="whitelist-csv-upload"
                  />
                  <Button
                    type="button"
                    onClick={() =>
                      document.getElementById("whitelist-csv-upload").click()
                    }
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {t("Upload CSV") || "Upload CSV File"}
                  </Button>
                  
                  {whitelistedStudents.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={clearWhitelist}
                      className="border-red-300 text-red-600 hover:bg-red-50"
                    >
                      {t("ClearWhitelist") || "Clear Whitelist"}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("CSVU pload Help") ||
                    "Upload a CSV file containing student emails (column 6)"}
                </p>
              </div>

              <div className="mt-6">
                <div className="flex gap-2">
                  <Input
                    id="student-email"
                    placeholder="student@example.com"
                    className="flex-1"
                  />
                  <Button type="button" onClick={handleAddStudent}>
                    {t("Add Student") || "Add Student"}
                  </Button>
                </div>
              </div>

              <div className="mt-4">
                <div className="flex justify-between items-center bg-blue-50 p-2 rounded-t-md border-b">
                  <p className="text-sm font-medium text-blue-700">
                    {t("WhitelistedStudents", {
                      count: whitelistedStudents.length,
                    }) || `Whitelisted Students (${whitelistedStudents.length})`}
                  </p>
                </div>
                <div className="max-h-60 overflow-y-auto border border-t-0 rounded-b-md">
                  <ul className="divide-y">
                    {whitelistedStudents.map((student, index) => (
                      <li
                        key={index}
                        className="flex items-center justify-between p-2 hover:bg-gray-50"
                      >
                        <span className="text-sm truncate max-w-[80%]">
                          {student.email}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveStudent(index)}
                          className="h-8 w-8 p-0 text-red-500 hover:bg-red-100"
                        >
                          ×
                        </Button>
                      </li>
                    ))}
                   {whitelistedStudents.length === 0 && (
                      <li className="p-3 text-center text-sm text-muted-foreground">
                        {t("No Students Whitelisted") || "No students whitelisted - all students will be allowed"}
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          </div>


          <div className="flex justify-between">
            <BackButton />
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("Updating") + "..." : t("UpdateSession")}
            </Button>
          </div>
        </form>
      </Form>
      <Toaster richColors />
    </div>
  );
}
