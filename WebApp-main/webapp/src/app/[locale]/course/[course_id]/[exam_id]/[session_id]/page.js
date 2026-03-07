"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import BackButton from "@/components/back-button";
import { sessionService } from "@/api/services/sessionService";
import { userService } from "@/api/services/userService";
import { notFound, useParams, useRouter } from "next/navigation";
import { toast, Toaster } from "sonner";
import {
  StartSessionDialog,
  EndSessionDialog,
} from "@/components/session-dialogs";
import { useTranslations } from "next-intl";

export default function SessionClientPage() {
  const t = useTranslations();
  const [session, setSession] = useState(null);
  const [sessionUsers, setSessionUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [elapsedTimes, setElapsedTimes] = useState({});
  const [allUsersExtensionMinutes, setAllUsersExtensionMinutes] = useState(5);
  const params = useParams();
  const router = useRouter();
  const { course_id, exam_id, session_id } = params;
  const [showJoinCode, setShowJoinCode] = useState(false);
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [showEndDialog, setShowEndDialog] = useState(false);
  const [whitelistedStudents, setWhitelistedStudents] = useState([]);

  const pollingInterval = 5000; // 5 seconds

  const formatDateTime = (dateTimeStr) => {
    if (!dateTimeStr || dateTimeStr === "null") return "N/A";

    try {
      const date = new Date(dateTimeStr);
      // Check if date is valid
      if (isNaN(date.getTime())) return "N/A";
      return date.toLocaleTimeString();
    } catch (error) {
      console.error("Error formatting date:", error);
      return "N/A";
    }
  };

  const formatRemainingTime = (startTimeStr, sessionUser) => {
    if (!startTimeStr || startTimeStr === "null") return "Not started";
    if (sessionUser.start_time && sessionUser.end_time) return "Completed";

    try {
      const startTime = new Date(startTimeStr);
      if (isNaN(startTime.getTime())) return "Invalid time";

      const now = new Date();

      const durationSeconds = session?.duration || 60;
      const durationMs = durationSeconds * 1000;
      const extensionSeconds = sessionUser.changed_time || 0;
      const extensionMs = extensionSeconds * 1000;

      const expectedEndTime = new Date(
        startTime.getTime() + durationMs + extensionMs
      );

      // Calculate remaining time
      const remainingMs = expectedEndTime - now;

      if (remainingMs <= 0) {
        return <span className="text-red-600 font-bold">Time's up!</span>;
      }

      const hours = Math.floor(remainingMs / (1000 * 60 * 60));
      const minutes = Math.floor(
        (remainingMs % (1000 * 60 * 60)) / (1000 * 60)
      );
      const seconds = Math.floor((remainingMs % (1000 * 60)) / 1000);

      const timeStr = `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

      if (remainingMs < 5 * 60 * 1000) {
        return <span className="text-red-600">{timeStr}</span>;
      } else if (remainingMs < 15 * 60 * 1000) {
        return <span className="text-orange-500">{timeStr}</span>;
      } else {
        return timeStr;
      }
    } catch (error) {
      console.error("Error calculating remaining time:", error);
      return "Error";
    }
  };

  const fetchSessionUsers = useCallback(async () => {
    try {
      const sessionUsersData = await sessionService.getSessionUsers(session_id);
      const sessionData = await sessionService.getSession(
        course_id,
        exam_id,
        session_id
      );

      if (
        sessionData.allowed_students &&
        Array.isArray(sessionData.allowed_students)
      ) {
        setWhitelistedStudents(sessionData.allowed_students);
      }

      const enhancedSessionUsers = await Promise.all(
        sessionUsersData.map(async (sessionUser) => {
          try {
            const userData = await userService.getUser(sessionUser.user_nmec);
            return {
              ...sessionUser,
              user: userData,
            };
          } catch (error) {
            console.error(
              `Error fetching user ${sessionUser.user_nmec}:`,
              error
            );
            return {
              ...sessionUser,
              user: { name: "Unknown User" },
            };
          }
        })
      );

      setSessionUsers(enhancedSessionUsers);
    } catch (error) {
      console.error("Error fetching session users:", error);
    }
  }, [session_id, course_id, exam_id]);

  // Initial data loading
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setIsLoading(true);

        // Get session details
        const sessionData = await sessionService.getSession(
          course_id,
          exam_id,
          session_id
        );
        if (!sessionData) {
          router.push(notFound());
          return;
        }

        setSession(sessionData);

        // Get initial session users
        await fetchSessionUsers();
      } catch (error) {
        console.error("Error fetching initial data:", error);
        setError(true);
      } finally {
        setIsLoading(false);
      }
    };

    fetchInitialData();
  }, [course_id, exam_id, session_id, router, fetchSessionUsers]);

  useEffect(() => {
    // Only start polling if we have the initial data loaded
    if (!isLoading && session) {
      // Set up the interval for polling
      const intervalId = setInterval(() => {
        fetchSessionUsers();
      }, pollingInterval);

      // Clean up the interval when component unmounts
      return () => clearInterval(intervalId);
    }
  }, [isLoading, session, fetchSessionUsers, pollingInterval]);

  useEffect(() => {
    const timerInterval = setInterval(() => {
      setElapsedTimes((prevTimes) => {
        const newRemainingTimes = {};
        sessionUsers.forEach((user) => {
          if (user.start_time && !user.end_time) {
            newRemainingTimes[user.id] = formatRemainingTime(
              user.start_time,
              user
            );
          }
        });
        return newRemainingTimes;
      });
    }, 1000);

    return () => clearInterval(timerInterval);
  }, [sessionUsers]);

  if (error) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        {t("Loading")}...
      </div>
    );
  }

  if (!session) {
    router.push(notFound());
    return null; // Add this return to prevent rendering after redirect
  }

  const handleStartButtonClick = () => {
    setShowStartDialog(true);
  };

  const handleEndButtonClick = () => {
    setShowEndDialog(true);
  };

  const handleStartConfirm = () => {
    setShowStartDialog(false);
    handleSendSessionStart();
  };

  const handleEndConfirm = () => {
    setShowEndDialog(false);
    handleSendSessionEnd();
  };

  const handleSendSessionStart = async () => {
    try {
      const startButton = document.getElementById("start-button");
      if (startButton) startButton.disabled = true;
      const result = await sessionService.startSession(
        course_id,
        exam_id,
        session_id
      );

      setSession((prevSession) => ({
        ...prevSession,
        is_started: true,
      }));

      toast.success("Exam started successfully");
    } catch (error) {
      toast.error(`Failed to start exam: ${error.message || "Unknown error"}`);
    } finally {
      const startButton = document.getElementById("start-button");
      if (startButton) startButton.disabled = false;
    }
  };

  const handleSendSessionEnd = async () => {
    try {
      await sessionService.endSession(course_id, exam_id, session_id);

      setSession((prevSession) => ({
        ...prevSession,
        is_ended: true,
      }));

      const refreshedSession = await sessionService.getSession(
        course_id,
        exam_id,
        session_id
      );
      if (refreshedSession) {
        setSession(refreshedSession);
      }
      toast.success("Exam ended successfully");
    } catch (error) {
      toast.error(`Failed to end exam: ${error.message || "Unknown error"}`);
    }
  };

  const handleSendBroadcastMessage = async () => {
    try {
      if (!broadcastMessage.trim()) {
        toast.error("Please enter a message to broadcast");
        return;
      }

      // Disable button during submission
      const sendButton = document.getElementById("send-button");
      if (sendButton) sendButton.disabled = true;

      // Show loading toast
      const toastId = toast.loading("Sending broadcast...");

      const messagePromises = sessionUsers.map((user) =>
        sessionService.sendBroadcastMessage(
          user.user_nmec,
          broadcastMessage,
          course_id,
          exam_id,
          session_id
        )
      );

      await Promise.all(messagePromises);

      // Dismiss loading toast and show success
      toast.dismiss(toastId);
      toast.success("Message sent successfully");

      // Clear the input field after successful broadcast
      setBroadcastMessage("");
    } catch (error) {
      toast.error(
        `Failed to send message: ${error.message || "Unknown error"}`
      );
    } finally {
      const sendButton = document.getElementById("send-button");
      if (sendButton) sendButton.disabled = false;
    }
  };

  const handleClearBroadcast = () => {
    setBroadcastMessage("");
  };

  const handleViewUserDetails = (sessionUser) => {
    router.push(
      `/course/${course_id}/${exam_id}/${session_id}/${sessionUser.user_nmec}`
    );
  };

  // Just like Broadcast message
  const handleFetchSubmissions = async () => {
    const fetchButton = document.getElementById("fetch-button");
    try {
      if (fetchButton) {
        fetchButton.disabled = true;
        fetchButton.innerText = "Fetching...";
      }

      const toastId = toast.loading("Fetching submissions...");
      const fetchPromises = sessionUsers.map((sessionUser) =>
        sessionService.fetchSubmissions(
          sessionUser.user_nmec,
          course_id,
          exam_id,
          session_id
        )
      );

      await Promise.all(fetchPromises);

      await fetchSessionUsers();

      toast.dismiss(toastId);
      toast.success("Submissions fetched successfully");
    } catch (error) {
      console.error("Error fetching submissions:", error);
      alert(`Fetch failed: ${error.message || "Unknown error"}`);
    } finally {
      if (fetchButton) {
        fetchButton.disabled = false;
        fetchButton.innerText = "Fetch Submissions";
      }
    }
  };

  const handleDownloadSubmissions = async () => {
    const downloadButton = document.getElementById("download-button");
    try {
      if (downloadButton) {
        downloadButton.disabled = true;
        downloadButton.innerText = "Downloading...";
      }

      await sessionService.downloadSubmissions(course_id, exam_id, session_id);

      toast.success("Submissions downloaded successfully");
    } catch (error) {
      console.error("Error downloading submissions:", error);
      alert(`Download failed: ${error.message || "Unknown error"}`);
    } finally {
      if (downloadButton) {
        downloadButton.disabled = false;
        downloadButton.innerText = "Download Submissions";
      }
    }
  };

  const handleExtendTimeAll = async () => {
    try {
      if (sessionUsers.length === 0) {
        toast.error("No users to extend time for");
        return;
      }

      const seconds = allUsersExtensionMinutes * 60;
      const toastId = toast.loading(
        `Extending time for all users by ${allUsersExtensionMinutes} minutes...`
      );

      setSessionUsers((prevUsers) =>
        prevUsers.map((user) => ({
          ...user,
          changed_time: (user.changed_time || 0) + seconds,
        }))
      );

      const extensionPromises = sessionUsers.map((sessionUser) =>
        sessionService.extendUserTime(
          sessionUser.user_nmec,
          seconds,
          course_id,
          exam_id,
          session_id,
          sessionUser.id
        )
      );

      await Promise.all(extensionPromises);
      setElapsedTimes({});
      await fetchSessionUsers();

      toast.dismiss(toastId);
      toast.success(
        `Time extended successfully for all users by ${allUsersExtensionMinutes} minutes`
      );
    } catch (error) {
      await fetchSessionUsers();
      toast.error(
        `Failed to extend time for all users: ${
          error.message || "Unknown error"
        }`
      );
    }
  };

  const getStatusColor = (sessionUser) => {
    if (!sessionUser) return "bg-red-100"; // Not Joined - Red
    if (!sessionUser.start_time) return "bg-yellow-100"; // Not Started - Yellow
    if (sessionUser.end_time) return "bg-blue-100"; // Completed - Blue
    return "bg-green-100"; // In Progress - Green
  };

  return (
    <div className="min-h-screen bg-light-gray">
      <main className="container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold mb-8">{session?.name}</h1>

        {/* Generate Code Section */}
        <div className="flex flex-col items-center justify-center mb-6 mt-8">
          <div className="flex flex-col items-center gap-6 p-8 rounded-lg bg-gray-50 w-full max-w-2xl">
            <div className="flex flex-col items-center gap-3">
              <span className="text-sm text-gray-500">{t("JoinCode")}:</span>
              <div className="flex items-center gap-3">
                <div
                  className={`text-4xl font-bold transition-all duration-200 ${
                    !showJoinCode ? "blur-md select-none" : ""
                  }`}
                >
                  {showJoinCode ? session?.join_code : "••••••"}
                </div>
                <button
                  onClick={() => setShowJoinCode(!showJoinCode)}
                  className="flex items-center justify-center p-2 rounded-full hover:bg-gray-200 transition-colors"
                  aria-label={
                    showJoinCode ? t("HideJoinCode") : t("ShowJoinCode")
                  }
                >
                  {showJoinCode ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path>
                      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path>
                      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path>
                      <line x1="2" y1="2" x2="22" y2="22"></line>
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {showJoinCode ? t("ClickEyeToHide") : t("ClickEyeToReveal")}
              </p>
            </div>
          </div>
        </div>

        {/* Session Actions */}
        <div className="flex justify-center gap-4 mb-8">
          <Button
            id="start-button"
            className="bg-[#5BA87A] hover:bg-[#4A8B65]"
            onClick={handleStartButtonClick}
            disabled={session?.is_started}
          >
            {t("StartSession")}
          </Button>
          <Button
            id="end-button"
            className="bg-[#993333] hover:bg-[#7A2929]"
            onClick={handleEndButtonClick}
            disabled={!session?.is_started || session?.is_ended}
          >
            {t("EndSession")}
          </Button>
        </div>

        {/* Broadcast Message */}
        <div className="bg-gray-100 p-3 rounded-lg mb-8">
          <div className="flex items-center gap-2">
            <span className="font-medium">{t("BroadcastMessage")}:</span>
            <input
              type="text"
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSendBroadcastMessage();
                }
              }}
              className="flex-grow border p-1 rounded"
              placeholder={t("EnterMessageBroadcast")}
            />
            <Button
              id="send-button"
              className="bg-[#5BA87A] hover:bg-[#4A8B65] whitespace-nowrap"
              onClick={handleSendBroadcastMessage}
            >
              {t("Send")}
            </Button>
            <Button
              id="clear-button"
              className="bg-[#993333] hover:bg-[#7A2929] whitespace-nowrap"
              onClick={handleClearBroadcast}
            >
              {t("Clear")}
            </Button>
          </div>
        </div>
        {/* Extend Time for All Users */}
        <div className="bg-gray-100 p-3 rounded-lg mb-8">
          <div className="flex items-center gap-2">
            <span className="font-medium">{t("ExtendTimeAllUsers")}:</span>
            <input
              type="number"
              min="1"
              value={allUsersExtensionMinutes}
              onChange={(e) =>
                setAllUsersExtensionMinutes(
                  Math.max(1, parseInt(e.target.value) || 1)
                )
              }
              className="w-16 border p-1 rounded text-center"
              placeholder="5"
            />
            <span className="mr-2">{t("minutes")}</span>
            <Button
              id="extend-all-button"
              className="bg-blue-500 hover:bg-blue-700 whitespace-nowrap"
              onClick={handleExtendTimeAll}
              disabled={sessionUsers.length === 0}
            >
              {t("ExtendTimeForAll")}
            </Button>
          </div>
        </div>
        {/* Table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">{t("StudentNMEC")}</TableHead>
              <TableHead>{t("StudentEmail")}</TableHead>
              <TableHead>{t("DeviceID")}</TableHead>
              <TableHead>{t("StartTime")}</TableHead>
              <TableHead>{t("RemainingTime")}</TableHead>
              <TableHead>{t("EndTime")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {whitelistedStudents.length > 0 ? (
              whitelistedStudents.map((studentEmail, index) => {
                // Find if this student has joined the session
                const sessionUser = sessionUsers.find(
                  (user) =>
                    user.user &&
                    user.user.email &&
                    user.user.email.toLowerCase() === studentEmail.toLowerCase()
                );

                return (
                  <TableRow
                    key={sessionUser ? sessionUser.id : `whitelist-${index}`}
                    className={getStatusColor(sessionUser)}
                  >
                    <TableCell>
                      {sessionUser ? sessionUser.user_nmec : "--"}
                    </TableCell>
                    <TableCell>
                      {studentEmail}
                    </TableCell>
                    <TableCell>
                      {sessionUser ? sessionUser.device_id : "--"}
                    </TableCell>
                    <TableCell>
                      {sessionUser
                        ? formatDateTime(sessionUser.start_time)
                        : "--"}
                    </TableCell>
                    <TableCell>
                      {sessionUser &&
                      sessionUser.start_time &&
                      !sessionUser.end_time ? (
                        <span className="font-mono bg-green-100 px-2 py-1 rounded text-green-800 font-medium">
                          {elapsedTimes[sessionUser.id] ||
                            formatRemainingTime(
                              sessionUser.start_time,
                              sessionUser
                            )}
                        </span>
                      ) : sessionUser && sessionUser.end_time ? (
                        t("Completed")
                      ) : (
                        "--"
                      )}
                    </TableCell>
                    <TableCell>
                      {sessionUser
                        ? formatDateTime(sessionUser.end_time)
                        : "--"}
                    </TableCell>
                    <TableCell>
                      {!sessionUser
                        ? t("NotJoined")
                        : !sessionUser.start_time
                        ? t("NotStarted")
                        : sessionUser.end_time
                        ? t("Completed")
                        : t("InProgress")}
                    </TableCell>
                    <TableCell>
                      {sessionUser && (
                        <div className="flex items-center gap-4">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewUserDetails(sessionUser)}
                            title={t("ViewUserDetails")}
                            className="text-blue-600 border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                          >
                            {t("ViewUser")}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            ) : sessionUsers.length > 0 ? (
              // Fallback to just showing session users if no whitelist is available
              sessionUsers.map((sessionUser) => (
                <TableRow key={sessionUser.id}
                  className={getStatusColor(sessionUser)}
                >
                  {/* Original session user row rendering */}
                  <TableCell>{sessionUser.user_nmec}</TableCell>
                  <TableCell>
                    {sessionUser.user?.name || t("Unknown User")}
                  </TableCell>
                  <TableCell>{sessionUser.device_id}</TableCell>
                  <TableCell>
                    {formatDateTime(sessionUser.start_time)}
                  </TableCell>
                  <TableCell>
                    {/* Remaining time cell */}
                    {/* Keep the original implementation here */}
                  </TableCell>
                  <TableCell>{formatDateTime(sessionUser.end_time)}</TableCell>
                  <TableCell>
                    {!sessionUser.start_time
                      ? t("NotStarted")
                      : sessionUser.end_time
                      ? t("Completed")
                      : t("InProgress")}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewUserDetails(sessionUser)}
                        title={t("ViewUserDetails")}
                        className="text-blue-600 border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                      >
                        {t("ViewUser")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-4">
                  {t("No Users In Session")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* Navigation Buttons */}
        <div className="flex justify-between items-center mt-8">
          <BackButton />
          <Button
            className="ml-auto mr-4"
            id="fetch-button"
            onClick={handleFetchSubmissions}
          >
            {t("FetchSubmissions")}
          </Button>
          <Button
            type="button"
            id="download-button"
            onClick={handleDownloadSubmissions}
          >
            {t("DownloadSubmissions")}
          </Button>
        </div>
        <StartSessionDialog
          open={showStartDialog}
          onOpenChange={setShowStartDialog}
          onConfirm={handleStartConfirm}
        />

        <EndSessionDialog
          open={showEndDialog}
          onOpenChange={setShowEndDialog}
          onConfirm={handleEndConfirm}
        />
      </main>
      <Toaster richColors />
    </div>
  );
}
