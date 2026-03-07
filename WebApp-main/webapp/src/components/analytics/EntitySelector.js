'use client';

import { useState, useEffect } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Search } from "lucide-react";
import { fetchApi } from "@/api/client";

export function EntitySelector({ entityType, entityField, timeRange, onSelectEntity }) {
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredEntities, setFilteredEntities] = useState([]);

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
    const fetchEntities = async () => {
      try {
        setLoading(true);
        
        const data = await fetchApi(`/analytics/logs/summary${getTimeParam()}`);
        
        // Select the right data field based on entity type
        let entityData;
        if (entityType === 'user') entityData = data.top_users;
        else if (entityType === 'course') entityData = data.top_courses;
        else if (entityType === 'exam') entityData = data.top_exams;
        else if (entityType === 'session') entityData = data.top_sessions;
        
        setEntities(entityData || []);
        setFilteredEntities(entityData || []);
      } catch (error) {
        console.error(`Error fetching ${entityType} data:`, error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchEntities();
  }, [entityType, timeRange]);
  
  // Filter entities based on search term
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredEntities(entities);
      return;
    }
    
    const filtered = entities.filter(entity => 
      String(entity.key).toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    setFilteredEntities(filtered);
  }, [searchTerm, entities]);
  
  if (loading) {
    return <div className="flex justify-center p-4">Loading {entityType} data...</div>;
  }
  
  if (!entities.length) {
    return <div className="text-center p-4">No {entityType} data available</div>;
  }
  
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex mb-4">
          <Input
            type="text"
            placeholder={`Search ${entityType}...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="mr-2"
          />
          <Button variant="ghost" size="icon">
            <Search className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
          {filteredEntities.map(entity => (
            <Button 
              key={entity.key}
              variant="outline"
              className="justify-between"
              onClick={() => onSelectEntity(entity.key)}
            >
              <span>{entity.key}</span>
              <span className="bg-slate-100 text-slate-800 rounded-full px-2 ml-2 text-xs">
                {entity.count}
              </span>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
