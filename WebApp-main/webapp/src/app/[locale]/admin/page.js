'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LogsChart } from "@/components/analytics/LogsChart";
import { RecentLogs } from "@/components/analytics/RecentLogs";
import { EntitySelector } from "@/components/analytics/EntitySelector";
import { HierarchyView } from "@/components/analytics/HierarchyView";

export default function AdminPage({ params }) {
  const [timeRange, setTimeRange] = useState('24h');
  const [selectedEntity, setSelectedEntity] = useState(null);

  // Format time range for API calls
  const getTimeParam = () => {
    return `?start_time=${encodeURIComponent(
      new Date(Date.now() - getTimeInMs()).toISOString()
    )}`;
  };

  // Get time in milliseconds based on selected range
  const getTimeInMs = () => {
    switch (timeRange) {
      case '1h': return 60 * 60 * 1000;
      case '24h': return 24 * 60 * 60 * 1000;
      case '7d': return 7 * 24 * 60 * 60 * 1000;
      case '30d': return 30 * 24 * 60 * 60 * 1000;
      default: return 24 * 60 * 60 * 1000;
    }
  };

    return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">System Analytics</h1>
        
            <div>
          <select 
            className="border rounded p-2"
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
          >
            <option value="1h">Last Hour</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>
            </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="errors">Errors</TabsTrigger>
          <TabsTrigger value="courses">Courses</TabsTrigger>
          <TabsTrigger value="exams">Exams</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <LogsChart 
            title="Log Activity Over Time" 
            description="Number of logs recorded over time"
              endpoint={`/logs/summary${getTimeParam()}`}
            dataField="time_histogram"
            type="line"
            nameKey="time"
          />
          
          <LogsChart 
            title="Logs by Level" 
            description="Distribution of logs by severity level"
              endpoint={`/logs/summary${getTimeParam()}`}
            dataField="level_distribution"
            type="pie"
            nameKey="key"
          />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <LogsChart 
            title="Top Log Categories" 
            description="Most frequent log categories"
              endpoint={`/logs/summary${getTimeParam()}`}
            dataField="category_distribution"
            type="bar"
            nameKey="key"
          />
          
          <Card>
            <CardHeader>
              <CardTitle>Recent Error Logs</CardTitle>
              <CardDescription>Latest error messages from the system</CardDescription>
            </CardHeader>
            <CardContent>
              <RecentLogs level="ERROR" limit={5} timeRange={timeRange} />
            </CardContent>
          </Card>
        </div>
        </TabsContent>
    
        <TabsContent value="errors">
      <div className="grid grid-cols-1 gap-6">
        <LogsChart 
          title="Error Logs Over Time" 
          description="Frequency of error logs over time"
              endpoint={`/logs/time-series?field=level&value=ERROR${getTimeParam().replace('?', '&')}`}
          dataField="time_series"
          type="line"
          nameKey="time"
          height={300}
        />
        
        <Card>
          <CardHeader>
            <CardTitle>Error Log Details</CardTitle>
            <CardDescription>Detailed view of all error logs</CardDescription>
          </CardHeader>
          <CardContent>
            <RecentLogs level="ERROR" limit={20} timeRange={timeRange} showDetails={true} />
          </CardContent>
        </Card>
      </div>
        </TabsContent>
    
        <TabsContent value="courses">
          <HierarchyView 
            entityType="course"
        timeRange={timeRange}
            onSelectEntity={(entity) => setSelectedEntity(entity)}
      />
          
          {selectedEntity && selectedEntity.type === 'course' && (
            <div className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Course: {selectedEntity.id}</CardTitle>
                  <CardDescription>Logs for the selected course</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <LogsChart 
                      title="Activity Over Time" 
                      description="Log activity for this course"
                      endpoint={`/logs/entity/course/${selectedEntity.id}${getTimeParam()}`}
                      dataField="time_histogram"
                      type="line"
                      nameKey="time"
                    />
                    
                    <LogsChart 
                      title="Log Levels" 
                      description="Distribution by log level"
                      endpoint={`/logs/entity/course/${selectedEntity.id}${getTimeParam()}`}
                      dataField="level_distribution"
                      type="pie"
                      nameKey="key"
                    />
                  </div>
                  
                  <RecentLogs 
                    courseId={selectedEntity.id} 
                    limit={10} 
        timeRange={timeRange}
                    showDetails={true} 
                  />
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="exams">
          <HierarchyView 
            entityType="exam"
            timeRange={timeRange}
            onSelectEntity={(entity) => setSelectedEntity(entity)}
      />
          
          {selectedEntity && selectedEntity.type === 'exam' && (
            <div className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Exam: {selectedEntity.id}</CardTitle>
                  <CardDescription>Logs for the selected exam</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <LogsChart 
                      title="Activity Over Time" 
                      description="Log activity for this exam"
                      endpoint={`/logs/entity/exam/${selectedEntity.id}${getTimeParam()}`}
                      dataField="time_histogram"
                      type="line"
                      nameKey="time"
                    />
                    
                    <LogsChart 
                      title="Log Levels" 
                      description="Distribution by log level"
                      endpoint={`/logs/entity/exam/${selectedEntity.id}${getTimeParam()}`}
                      dataField="level_distribution"
                      type="pie"
                      nameKey="key"
                    />
                  </div>
                  
                  <RecentLogs 
                    examId={selectedEntity.id} 
                    limit={10} 
                    timeRange={timeRange} 
                    showDetails={true} 
                  />
                </CardContent>
              </Card>
        </div>
          )}
        </TabsContent>

        <TabsContent value="sessions">
          <HierarchyView 
            entityType="session"
            timeRange={timeRange}
            onSelectEntity={(entity) => setSelectedEntity(entity)}
          />
          
          {selectedEntity && selectedEntity.type === 'session' && (
            <div className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Session: {selectedEntity.id}</CardTitle>
                  <CardDescription>Logs for the selected session</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <LogsChart 
                      title="Activity Over Time" 
                      description="Log activity for this session"
                      endpoint={`/logs/entity/session/${selectedEntity.id}${getTimeParam()}`}
                      dataField="time_histogram"
                      type="line"
                      nameKey="time"
                    />
                    
                    <LogsChart 
                      title="Log Levels" 
                      description="Distribution by log level"
                      endpoint={`/logs/entity/session/${selectedEntity.id}${getTimeParam()}`}
                      dataField="level_distribution"
                      type="pie"
                      nameKey="key"
                    />
      </div>

                  <RecentLogs 
                    sessionId={selectedEntity.id} 
                    limit={10} 
                    timeRange={timeRange} 
                    showDetails={true} 
                  />
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="users">
          <EntitySelector 
            entityType="user"
            entityField="user_nmec"
            timeRange={timeRange}
            onSelectEntity={(id) => setSelectedEntity({type: 'user', id})}
          />
          
          {selectedEntity && selectedEntity.type === 'user' && (
            <div className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>User: {selectedEntity.id}</CardTitle>
                  <CardDescription>Logs for the selected user</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <LogsChart 
                      title="Activity Over Time" 
                      description="Log activity for this user"
                      endpoint={`/logs/entity/user/${selectedEntity.id}${getTimeParam()}`}
                      dataField="time_histogram"
                      type="line"
                      nameKey="time"
                    />
                    
                    <LogsChart 
                      title="Log Levels" 
                      description="Distribution by log level"
                      endpoint={`/logs/entity/user/${selectedEntity.id}${getTimeParam()}`}
                      dataField="level_distribution"
                      type="pie"
                      nameKey="key"
                    />
                  </div>
                  
                  <RecentLogs 
                    userNmec={selectedEntity.id} 
                    limit={10} 
                    timeRange={timeRange} 
                    showDetails={true} 
                  />
                </CardContent>
              </Card>
            </div>
          )}
          </TabsContent>
      </Tabs>
    </div>
  );
}
