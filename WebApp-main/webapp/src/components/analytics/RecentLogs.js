'use client';

import { useState, useEffect, Fragment } from 'react';
import { Button } from "@/components/ui/button";
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { fetchApi } from '@/api/client';

export function RecentLogs({ 
  courseId = null, 
  examId = null, 
  sessionId = null, 
  userNmec = null,
  level = null, 
  category = null, 
  limit = 10, 
  timeRange = '24h', 
  showDetails = false 
}) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedLog, setExpandedLog] = useState(null);
  
  const fetchLogs = async () => {
    try {
      setLoading(true);
      
      // Calculate time range
      let startTime;
      switch (timeRange) {
        case '1h': startTime = new Date(Date.now() - 60 * 60 * 1000); break;
        case '7d': startTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); break;
        case '30d': startTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); break;
        default: startTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // Default to 24h
      }
      
      // Build query parameters
      const params = new URLSearchParams();
      params.append('start_time', startTime.toISOString());
      params.append('end_time', new Date().toISOString());
      params.append('page_size', limit.toString());
      if (level) params.append('level', level);
      if (category) params.append('category', category);
      if (courseId) params.append('course_id', courseId);
      if (examId) params.append('exam_id', examId);
      if (sessionId) params.append('session_id', sessionId);
      if (userNmec) params.append('user_nmec', userNmec);
      
      const data = await fetchApi(`/logs/search?${params.toString()}`);
       
      // Format logs for display
      const formattedLogs = data.logs.map(log => {
        const source = log._source || log;
        return {
          id: source.id || log._id,
          timestamp: source.timestamp,
          level: source.level,
          category: source.category,
          message: source.message,
          details: source.details,
          session_id: source.session_id,
          user_nmec: source.user_nmec,
          course_id: source.course_id,
          exam_id: source.exam_id
        };
      });
      
      setLogs(formattedLogs);
      setError(null);
    } catch (err) {
      console.error("Error fetching logs:", err);
      setError(err.message);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    fetchLogs();
  }, [level, category, limit, timeRange, courseId, examId, sessionId, userNmec]);
  
  const getLevelColor = (level) => {
    switch (level?.toUpperCase()) {
      case 'ERROR': return 'text-red-600 bg-red-100';
      case 'WARNING': return 'text-yellow-600 bg-yellow-100';
      case 'INFO': return 'text-blue-600 bg-blue-100';
      case 'DEBUG': return 'text-gray-600 bg-gray-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };
  
  const toggleDetails = (id) => {
    setExpandedLog(expandedLog === id ? null : id);
  };
  
  if (loading) {
    return <div className="flex justify-center p-4">Loading logs...</div>;
  }
  
  if (error) {
    return <div className="text-red-500 p-4">Error: {error}</div>;
  }
  
  if (logs.length === 0) {
    return <div className="text-gray-500 p-4">No logs found</div>;
  }
  
  return (
    <div>
      <div className="flex justify-end mb-2">
        <Button 
          onClick={fetchLogs} 
          variant="outline" 
          size="sm"
          className="text-xs"
        >
          <RefreshCw className="h-3 w-3 mr-1" /> Refresh
        </Button>
      </div>
      
      <div className="rounded border overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Level</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Message</th>
              {showDetails && (
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              )}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {logs.map((log) => (
              <Fragment key={log.id}>
                <tr className="hover:bg-gray-50">
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs rounded-full ${getLevelColor(log.level)}`}>
                      {log.level}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-900">
                    {log.message}
                  </td>
                  {showDetails && (
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                      <Button 
                        onClick={() => toggleDetails(log.id)} 
                        variant="ghost" 
                        size="sm"
                        className="flex items-center"
                      >
                        {expandedLog === log.id ? (
                          <ChevronDown className="h-4 w-4 mr-1" />
                        ) : (
                          <ChevronRight className="h-4 w-4 mr-1" />
                        )}
                        Details
                      </Button>
                    </td>
                  )}
                </tr>
                {showDetails && expandedLog === log.id && (
                  <tr>
                    <td colSpan={4} className="px-4 py-2 bg-gray-50">
                      <div className="text-sm">
                        <p><span className="font-semibold">Category:</span> {log.category}</p>
                        {log.session_id && <p><span className="font-semibold">Session ID:</span> {log.session_id}</p>}
                        {log.user_nmec && <p><span className="font-semibold">User NMEC:</span> {log.user_nmec}</p>}
                        {log.course_id && <p><span className="font-semibold">Course ID:</span> {log.course_id}</p>}
                        {log.exam_id && <p><span className="font-semibold">Exam ID:</span> {log.exam_id}</p>}
                        {log.details && (
                          <div>
                            <p className="font-semibold mt-1">Details:</p>
                            <pre className="bg-gray-100 p-2 rounded text-xs overflow-x-auto mt-1">
                              {typeof log.details === 'object' 
                                ? JSON.stringify(log.details, null, 2) 
                                : log.details}
                            </pre>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
