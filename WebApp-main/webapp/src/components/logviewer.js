"use client";
import { useState, useEffect, Fragment, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fetchApi } from "@/api/client";

const LogViewer = ({ sessionId, user_nmec }) => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedRows, setExpandedRows] = useState({});
  const eventSourceRef = useRef(null);

  const toggleRowExpansion = (index) => {
    setExpandedRows((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const fetchLogs = async () => {
    if (!sessionId || !user_nmec) return;
    try {
      setLoading(true);
      const data = await fetchApi(`/logs/session/${sessionId}/user/${user_nmec}`);
      setLogs(data || []);
      setError(null);
    } catch (err) {
      console.error("Error fetching logs:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Set up PubSub connection
  const setupEventSource = () => {
    if (!sessionId || !user_nmec) return;

    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      // Get token from cookie
      let token = '';
      const currentUserCookie = document.cookie
        .split('; ')
        .find(row => row.startsWith('currentUser='));
        
      if (currentUserCookie) {
        const userData = JSON.parse(decodeURIComponent(currentUserCookie.split('=')[1]));
        token = userData.access_token;
      }
      
      // Include token as query parameter for SSE
      const url = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/logs/session/${sessionId}/user/${user_nmec}/stream?token=${token}`;
      eventSourceRef.current = new EventSource(url);

      eventSourceRef.current.onmessage = (event) => {
        try {
          const logData = JSON.parse(event.data);
          setLogs((prevLogs) => [logData, ...prevLogs]); // Add new log at the beginning
        } catch (error) {
          console.error("Error parsing SSE data:", error);
        }
      };

      eventSourceRef.current.onerror = (error) => {
        console.error("EventSource error:", error);
        eventSourceRef.current.close();
        // Try to reconnect after a delay
        setTimeout(setupEventSource, 5000);
      };
    } catch (err) {
      console.error("Error setting up EventSource:", err);
    }
  };

  useEffect(() => {
    if (!sessionId || !user_nmec) {
      setLogs([]);
      setLoading(false);
      return;
    }

    // Fetch initial logs
    fetchLogs();

    // Set up PubSub connection
    setupEventSource();

    // Cleanup on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [sessionId, user_nmec]);

  const getLogLevelColor = (level) => {
    switch (level?.toLowerCase()) {
      case "error":
        return "bg-red-500";
      case "warning":
        return "bg-yellow-500";
      case "info":
        return "bg-blue-500";
      case "debug":
        return "bg-gray-500";
      default:
        return "bg-gray-500";
    }
  };

  return (
    <div className="w-full">
      <h2 className="text-xl font-semibold mb-4">Session Logs</h2>

      {loading && logs.length === 0 && (
        <div className="flex justify-center p-8">
          <p>Loading logs...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          <p>{error}</p>
        </div>
      )}

      {!sessionId || !user_nmec ? (
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded mb-4">
          <p>No session or user ID provided. Please select a session and user to view logs.</p>
        </div>
      ) : (
        <div className="bg-gray-50 rounded-lg border overflow-hidden">
          <div className="overflow-auto max-h-[500px]">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  <th className="w-10 px-2 py-2"></th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Time
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Level
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Category
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Message
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {logs.length > 0 ? (
                  logs.map((log, index) => (
                    <Fragment key={log.id || `log-${index}`}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-2 py-2">
                          {(log.details || log.data) && (
                            <button
                              onClick={() => toggleRowExpansion(index)}
                              className="p-1 rounded-full hover:bg-gray-200 focus:outline-none"
                            >
                              {expandedRows[index] ? (
                                <ChevronDown className="w-4 h-4 text-gray-500" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-gray-500" />
                              )}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500 whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleString("en-GB", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </td>
                        <td className="px-4 py-2">
                          <Badge
                            className={`${getLogLevelColor(log.level)} text-white`}
                          >
                            {log.level || "unknown"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-600">
                          {log.category || "N/A"}
                        </td>
                        <td className="px-4 py-2 text-sm">
                          <div className="max-w-xl overflow-hidden text-ellipsis">
                            {log.message}
                          </div>
                        </td>
                      </tr>
                      {expandedRows[index] && (log.details || log.data) && (
                        <tr className="bg-gray-50">
                          <td className="px-2 py-2"></td>
                          <td colSpan="4" className="px-4 py-2">
                            <div className="bg-white p-3 rounded border border-gray-200 shadow-sm">
                              <h4 className="text-sm font-medium mb-2 text-gray-700">
                                Details:
                              </h4>
                              <pre className="text-xs whitespace-pre-wrap bg-gray-50 p-3 rounded overflow-x-auto">
                                {typeof (log.details || log.data) === "object"
                                  ? JSON.stringify(log.details || log.data, null, 2)
                                  : log.details || log.data}
                              </pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan="5"
                      className="px-4 py-8 text-center text-gray-500"
                    >
                      {loading ? "Loading logs..." : "No logs found"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default LogViewer;