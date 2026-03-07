'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ChevronRight } from "lucide-react";
import { fetchApi } from "@/api/client";

export function HierarchyView({ entityType, timeRange, onSelectEntity }) {
  const [hierarchyData, setHierarchyData] = useState({
    courses: [],
    exams: [],
    sessions: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredItems, setFilteredItems] = useState([]);
  
  // Calculate time range for API calls
  const getTimeParam = () => {
    let startTime;
    switch (timeRange) {
      case '1h': startTime = new Date(Date.now() - 60 * 60 * 1000); break;
      case '7d': startTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); break;
      case '30d': startTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); break;
      default: startTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
    }
    
    return `?start_time=${encodeURIComponent(startTime.toISOString())}`;
  };
  
  useEffect(() => {
    const fetchHierarchyData = async () => {
      try {
        setLoading(true);
        
        const data = await fetchApi(`/analytics/logs/hierarchy${getTimeParam()}`);
        setHierarchyData(data);
        
        // Set the filtered items based on entity type
        setFilteredItems(data[entityType + 's'] || []);
      } catch (err) {
        console.error("Error fetching hierarchy data:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    fetchHierarchyData();
  }, [entityType, timeRange]);
  
  // Filter items based on search term
  useEffect(() => {
    if (!hierarchyData || !hierarchyData[entityType + 's']) return;
    
    if (!searchTerm.trim()) {
      setFilteredItems(hierarchyData[entityType + 's']);
      return;
    }
    
    const filtered = hierarchyData[entityType + 's'].filter(item => 
      String(item.key).toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    setFilteredItems(filtered);
  }, [searchTerm, hierarchyData, entityType]);
  
  if (loading) {
    return <div className="flex justify-center p-4">Loading hierarchy data...</div>;
  }
  
  if (error) {
    return <div className="text-red-500 p-4">Error: {error}</div>;
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>{entityType.charAt(0).toUpperCase() + entityType.slice(1)} Analytics</CardTitle>
        <CardDescription>Select a {entityType} to view detailed analytics</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex mb-4">
          <Input
            type="text"
            placeholder={`Search ${entityType}s...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="mr-2"
          />
          <Button variant="ghost" size="icon">
            <Search className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="overflow-auto max-h-96 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItems.map(item => (
              <Button 
                key={item.key}
                variant="outline"
                className="flex justify-between items-center px-4 py-3 h-auto"
                onClick={() => onSelectEntity({type: entityType, id: item.key})}
              >
                <div className="flex flex-col items-start">
                  <span className="font-medium">{item.key}</span>
                  <span className="text-xs text-gray-500">{item.count} logs</span>
                </div>
                <ChevronRight className="h-4 w-4" />
              </Button>
            ))}
          </div>
          
          {filteredItems.length === 0 && (
            <div className="text-center p-4 text-gray-500">
              No {entityType}s found matching "{searchTerm}"
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
