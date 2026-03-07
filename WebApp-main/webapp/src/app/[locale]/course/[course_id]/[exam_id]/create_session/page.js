"use client";

import { useState, useRef } from "react";
import { CalendarIcon, Upload, Link, AlertCircle, Globe } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
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
import { format } from "date-fns";
import BackButton from "@/components/back-button";
import { sessionService } from "@/api/services/sessionService";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert } from "@/components/ui/alert";
import { toast, Toaster } from "sonner";
import { useTranslations } from "next-intl";

const createFormSchema = (t) =>
  z.object({
    title: z.string().min(2, {
      message: t("Title_Warning"),
    }),
    date: z.date({
      required_error: t("Date_Warning"),
    }),
    room: z.string().min(1, {
      message: t("Room_Warning"),
    }),
    duration: z.string().min(1, {
      message: t("Duration_Warning"),
    }),
    examLink: z
      .string()
      .url(t("URL_Validation"))
      .optional()
      .or(z.literal("")),
  });

export default function CreateSessionForm() {
  const t = useTranslations();
  const formSchema = createFormSchema(t);
  const [files, setFiles] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("files");
  const [formError, setFormError] = useState("");
  const [whitelistLink, setWhitelistLink] = useState("");
  const [whitelistLinks, setWhitelistLinks] = useState([]);
  const [whitelistedStudents, setWhitelistedStudents] = useState([]);
  const fileInputRef = useRef(null);

  const params = useParams();
  const router = useRouter();
  const { course_id, exam_id } = params;

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
    setWhitelistLinks(whitelistLinks.filter((_, index) => index !== indexToRemove));
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
              duplicates: duplicates.length 
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
    
    if (whitelistedStudents.some(student => 
      student.email.toLowerCase() === studentEmail.toLowerCase())) {
      toast.error(t("EmailAlreadyInList") || "This email is already in the list");
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

  async function onSubmit(values) {
    try {
      setIsSubmitting(true);
      setError(null);
      setFormError("");

      const formattedDate = format(values.date, "yyyy-MM-dd");

      const hasFiles = files.length > 0;
      const hasLink = values.examLink && values.examLink.trim() !== "";

      if (hasFiles && hasLink) {
        setFormError(
          t("Link_File_Error")
        );
        return;
      }

      if (!hasFiles && !hasLink) {
        setFormError("Please provide either exam files or an external link.");
        return;
      }

      // Extract just the email strings from the student objects into a simple array
      const studentEmails = whitelistedStudents.length > 0 
        ? whitelistedStudents.map(student => student.email)
        : null;

      const sessionData = {
        exam_id: Number(exam_id),
        course_id: course_id,
        name: values.title,
        date: formattedDate,
        duration: values.duration
          .split(":")
          .reduce(
            (acc, time, index) =>
              acc + parseInt(time) * (index === 0 ? 3600 : 60),
            0
          ),
        room: values.room,
        allowed_links: whitelistLinks.length > 0 ? whitelistLinks : null,
        allowed_students: studentEmails, // Send as array of strings
      };

      try {
        const sessionResponse = await sessionService.createSession(
          course_id,
          exam_id,
          sessionData
        );
        const session_id = sessionResponse.id;

        if (hasFiles) {
          const formData = new FormData();

          for (const file of files) {
            formData.append("files", file);
          }

          await sessionService.uploadFile(
            course_id,
            exam_id,
            session_id,
            formData
          );
        } else if (hasLink) {
          const formData = new FormData();
          formData.append("exam_link", values.examLink);

          await sessionService.uploadFile(
            course_id,
            exam_id,
            session_id,
            formData
          );
        }

        toast.success("Session created successfully!");
        router.push(`/course/${course_id}/${exam_id}/${session_id}`);
      } catch (apiError) {
        throw new Error(`API error: ${apiError.message}`);
      }
    } catch (err) {
      toast.error(
        err.message || "An error occurred while creating the session"
      );
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 bg-light-gray">
      <h1 className="text-2xl font-bold mb-6">{t("CreateSessionTitle")}</h1>

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
                <FormItem>
                  <FormLabel>{t("Date")}</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant={"outline"}
                          className={cn(
                            "w-full pl-3 text-left font-normal",
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
                          value={field.value.split(":")[0] || ""}
                          onChange={(e) => {
                            const hours = e.target.value;
                            const minutes = field.value.split(":")[1] || "00";
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
                          value={field.value.split(":")[1] || ""}
                          onChange={(e) => {
                            const hours = field.value.split(":")[0] || "00";
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

            <Tabs
              defaultValue={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="files">{t("UploadFiles")}</TabsTrigger>
                <TabsTrigger value="link">{t("UseExternalLink")}</TabsTrigger>
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
                      <p className="text-sm font-medium">{t("AttachFiles")}</p>
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
                        {t("SelectedFiles")}
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
                          <Link className="mr-2 h-4 w-4 text-muted-foreground" />
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
            <h3 className="font-medium mb-4">{t("Allowed_Links") || "Allowed Links"}</h3>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("LinksPopUp") || "Add links that students are allowed to access during the exam."}
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
                  {t("Add_Link") || "Add Link"}
                </Button>
              </div>
              
              {whitelistLinks.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-medium">{t("Whitelisted_Links") || "Whitelisted Links"}:</p>
                  <ul className="mt-2 space-y-2">
                    {whitelistLinks.map((link, index) => (
                      <li key={index} className="flex items-center justify-between bg-muted p-2 rounded-md">
                        <span className="text-sm truncate max-w-[80%]">{link}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveWhitelistLink(index)}
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
          </div>

          <div className="border rounded-md p-4">
            <h3 className="font-medium mb-4">{t("Student Whitelist") || "Student Whitelist"}</h3>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("StudentWhitelistDescription") || "Add students who are allowed to join this session. Leave empty to allow all students."}
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
                    onClick={() => document.getElementById("whitelist-csv-upload").click()}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {t("UploadCSV") || "Upload CSV File"}
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
                  {t("CSVUploadHelp") || "Upload a CSV file containing student emails (column 6)"}
                </p>
              </div>
              
              <div className="mt-6">
                <div className="flex gap-2">
                  <Input
                    id="student-email"
                    placeholder="student@example.com"
                    className="flex-1"
                  />
                  <Button 
                    type="button" 
                    onClick={handleAddStudent}
                  >
                    {t("AddStudent") || "Add Student"}
                  </Button>
                </div>
              </div>
              
              {whitelistedStudents.length > 0 && (
                <div className="mt-4">
                  <div className="flex justify-between items-center">
                    <p className="text-sm font-medium">
                      {t("WhitelistedStudents", { count: whitelistedStudents.length }) || 
                       `Whitelisted Students (${whitelistedStudents.length})`}:
                    </p>
                  </div>
                  <div className="mt-2 max-h-40 overflow-y-auto border rounded-md">
                    <ul className="divide-y">
                      {whitelistedStudents.map((student, index) => (
                        <li key={index} className="flex items-center justify-between p-2">
                          <span className="text-sm truncate max-w-[80%]">{student.email}</span>
                          <Button
                            type="button" // Add this to prevent form submission
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveStudent(index)}
                            className="h-8 w-8 p-0 text-red-500"
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

          <div className="flex justify-between">
            <BackButton />
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("Creating") + "..." : t("CreateSession")}
            </Button>
          </div>
        </form>
      </Form>
      <Toaster richColors />
    </div>
  );
}