'use client';

import { useState, useEffect } from 'react';
import { 
  LineChart, Line, BarChart, Bar, PieChart, Pie, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, 
  ResponsiveContainer, Cell
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { fetchApi } from '@/api/client';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff7300'];

export function LogsChart({ 
  title, 
  description, 
  endpoint, 
  dataField = null, 
  type = 'line', 
  dataKey = 'count', 
  nameKey = 'key', 
  dateFormat = true, 
  height = 300 
}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const result = await fetchApi(`/analytics${endpoint}`);
        // Determine which field in the result to use based on the dataField parameter
        let chartData;
        if (dataField) {
          chartData = result[dataField];
        } else {
          // If no dataField specified, try to guess based on the type of chart
          if (type === 'line' && result.time_histogram) {
            chartData = result.time_histogram;
          } else if (type === 'pie' && result.level_distribution) {
            chartData = result.level_distribution;
          } else if (type === 'bar' && result.category_distribution) {
            chartData = result.category_distribution;
          } else if (result.time_series) {
            chartData = result.time_series;
          } else {
            chartData = result; // Use the entire result as data
          }
        }

        setData(Array.isArray(chartData) ? chartData : []);
        setError(null);
      } catch (err) {
        console.error("Error fetching chart data:", err);
        setError(`Failed to load data: ${err.message}`);
        setData([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [endpoint, refreshKey, dataField]);

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  const renderChart = () => {
    if (loading) return <div className="flex justify-center items-center h-60">Loading...</div>;
    if (error) return <div className="text-red-500 p-4">{error}</div>;
    if (!data || data.length === 0) return <div className="text-gray-500 p-4">No data available</div>;

    const chartProps = {
      data,
      margin: { top: 5, right: 30, left: 20, bottom: 5 }
    };

    switch (type) {
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart {...chartProps}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey={nameKey} 
                tickFormatter={dateFormat && nameKey === 'time' ? (tick) => new Date(tick).toLocaleTimeString() : undefined}
              />
              <YAxis />
              <Tooltip 
                labelFormatter={dateFormat && nameKey === 'time' ? (label) => new Date(label).toLocaleString() : undefined}
              />
              <Legend />
              <Line type="monotone" dataKey={dataKey} stroke="#8884d8" activeDot={{ r: 8 }} />
            </LineChart>
          </ResponsiveContainer>
        );
      
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart {...chartProps}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={nameKey} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey={dataKey} fill="#8884d8" />
            </BarChart>
          </ResponsiveContainer>
        );
      
      case 'pie':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                labelLine={true}
                outerRadius={80}
                fill="#8884d8"
                dataKey={dataKey}
                nameKey={nameKey}
                label={({name, percent}) => `${name}: ${(percent * 100).toFixed(0)}%`}
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        );
      
      default:
        return <div>Unsupported chart type: {type}</div>;
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button 
          onClick={handleRefresh} 
          variant="outline" 
          size="icon"
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {renderChart()}
      </CardContent>
    </Card>
  );
}
