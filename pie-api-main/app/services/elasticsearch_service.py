import time
import json  # Add this import
from datetime import datetime
from elasticsearch import AsyncElasticsearch
from elasticsearch.exceptions import ConnectionError as ESConnectionError
from typing import List, Dict, Any
from app.core.config import config
import asyncio

import logging

logger = logging.getLogger("uvicorn.error")

class ElasticsearchService:
    def __init__(self):
        self.es = None
        self.index_name = "device-logs"
        
    async def connect(self, max_retries=10, retry_interval=15):
        retries = 0
        while retries < max_retries:
            try:
                self.es = AsyncElasticsearch([config.ELASTICSEARCH_URL])
                await asyncio.wait_for(self.es.info(), timeout=10)
                await self.create_index_if_not_exists()
                return
            except (ESConnectionError, asyncio.TimeoutError, Exception) as e:
                retries += 1
                logger.warning(f"Elasticsearch connection attempt {retries}/{max_retries} failed: {str(e)}")
                if retries < max_retries:
                    wait_time = retry_interval * (1.5 ** (retries - 1)) 
                    logger.info(f"Retrying in {wait_time:.1f} seconds...")
                    await asyncio.sleep(wait_time)
                else:
                    logger.error(f"Failed to connect to Elasticsearch after {max_retries} attempts")
                    return
        
    async def close(self):
        if self.es:
            await self.es.close()
            
    async def create_index_if_not_exists(self):
        if not await self.es.indices.exists(index=self.index_name):
            await self.es.indices.create(
                index=self.index_name,
                body={
                    "mappings": {
                        "properties": {
                            "device_id": {"type": "keyword"},
                            "timestamp": {"type": "date"},
                            "level": {"type": "keyword"},
                            "category": {"type": "keyword"},
                            "message": {"type": "text"},
                            "details": {"type": "object"},
                            "user_nmec": {"type": "integer"},
                            "course_id": {"type": "keyword"},
                            "exam_id": {"type": "integer"},
                            "session_id": {"type": "integer"}
                        }
                    }
                }
            )
            
    async def index_logs(self, logs: List[Dict[str, Any]]):
        operations = []
        for log in logs:
            if isinstance(log.get("timestamp"), datetime):
                log["timestamp"] = log["timestamp"].isoformat()
                
            operations.extend([
                {"index": {"_index": self.index_name}},
                log
            ])
            
        if operations:
            try:
                # Fix: Use keyword arguments instead of positional arguments
                await self.es.bulk(body=operations, refresh=True)
                logger.info(f"Successfully indexed {len(operations)//2} logs")
            except Exception as e:
                logger.error(f"Error indexing log in Elasticsearch: {e}")
            
    async def search_logs(self, device_id: int = None, user_nmec: int = None, session_id: int = None, course_id: str = None, exam_id: int = None, **filters):

        query = {"bool": {"must": []}}
        
        if device_id:
            query["bool"]["must"].append({"term": {"device_id": device_id}})
        if user_nmec:
            query["bool"]["must"].append({"term": {"user_nmec": user_nmec}})
        if session_id:
            query["bool"]["must"].append({"term": {"session_id": session_id}})
        if course_id:
            query["bool"]["must"].append({"term": {"course_id": course_id}}) 
        if exam_id:
            query["bool"]["must"].append({"term": {"exam_id": exam_id}})
        if filters.get("level"):
            query["bool"]["must"].append({"term": {"level": filters["level"]}})
        if filters.get("category"):
            query["bool"]["must"].append({"term": {"category": filters["category"]}})
            
        # Time range filter
        if filters.get("start_time") or filters.get("end_time"):
            time_range = {}
            if filters.get("start_time"):
                time_range["gte"] = filters["start_time"].isoformat()
            if filters.get("end_time"):
                time_range["lte"] = filters["end_time"].isoformat()
                
            query["bool"]["must"].append({"range": {"timestamp": time_range}})
            
        # Execute search
        response = await self.es.search(
            index=self.index_name,
            body={
                "query": query,
                "sort": [{"timestamp": {"order": "desc"}}],
                "from": filters.get("from", 0),
                "size": filters.get("size", 100)
            }
        )
        
        return response["hits"]["hits"]

    async def aggregate_logs(self, agg_field: str, start_time: datetime = None, end_time: datetime = None, size: int = 20, **filters):
        """Aggregate logs by a specific field."""
        query = {"bool": {"must": []}}
        
        # Add time range filter
        if start_time or end_time:
            time_range = {}
            if start_time:
                time_range["gte"] = start_time.isoformat()
            if end_time:
                time_range["lte"] = end_time.isoformat()
                
            query["bool"]["must"].append({"range": {"timestamp": time_range}})
        
        # Add other filters
        for field, value in filters.items():
            if value is not None and field not in ['from_', 'size']:
                query["bool"]["must"].append({"term": {field: value}})
        
        # Execute aggregation
        try:
            response = await self.es.search(
                index=self.index_name,
                body={
                    "size": 0,  # We only want aggregations, not documents
                    "query": query,
                    "aggs": {
                        "group_by_field": {
                            "terms": {
                                "field": f"{agg_field}",
                                "size": size
                            }
                        }
                    }
                }
            )
            
            result = []
            for bucket in response.get("aggregations", {}).get("group_by_field", {}).get("buckets", []):
                result.append({
                    "key": bucket["key"],
                    "count": bucket["doc_count"]
                })
                
            return result
        except Exception as e:
            logger.error(f"Error aggregating logs by {agg_field}: {str(e)}")
            return []
    
    async def time_histogram(self, start_time: datetime = None, end_time: datetime = None, interval: str = "hour", filter_field: str = None, filter_value: str = None):
        """Get time-based histogram of logs."""
        query = {"bool": {"must": []}}
        
        # Add time range filter
        if start_time or end_time:
            time_range = {}
            if start_time:
                time_range["gte"] = start_time.isoformat()
            if end_time:
                time_range["lte"] = end_time.isoformat()
                
            query["bool"]["must"].append({"range": {"timestamp": time_range}})
        
        # Add specific field filter if provided
        if filter_field and filter_value:
            query["bool"]["must"].append({"term": {filter_field: filter_value}})
        
        # Execute histogram aggregation
        try:
            response = await self.es.search(
                index=self.index_name,
                body={
                    "size": 0,
                    "query": query,
                    "aggs": {
                        "logs_over_time": {
                            "date_histogram": {
                                "field": "timestamp",
                                "calendar_interval": interval,
                                "min_doc_count": 0,
                                "extended_bounds": {
                                    "min": start_time.isoformat() if start_time else None,
                                    "max": end_time.isoformat() if end_time else None
                                }
                            }
                        }
                    }
                }
            )
            
            result = []
            for bucket in response.get("aggregations", {}).get("logs_over_time", {}).get("buckets", []):
                result.append({
                    "time": bucket["key_as_string"],
                    "count": bucket["doc_count"]
                })
                
            return result
        except Exception as e:
            logger.error(f"Error getting time histogram: {str(e)}")
            return []

    async def count_logs(self, **filters):
        """Count logs based on filters."""
        query = {"bool": {"must": []}}
        
        # Add filters
        for field, value in filters.items():
            if value is not None and field not in ['from_', 'size']:
                if field == "start_time" or field == "end_time":
                    continue
                query["bool"]["must"].append({"term": {field: value}})
        
        # Add time range filter
        if filters.get("start_time") or filters.get("end_time"):
            time_range = {}
            if filters.get("start_time"):
                time_range["gte"] = filters["start_time"].isoformat()
            if filters.get("end_time"):
                time_range["lte"] = filters["end_time"].isoformat()
                
            query["bool"]["must"].append({"range": {"timestamp": time_range}})
        
        # Execute count
        try:
            response = await self.es.count(
                index=self.index_name,
                body={"query": query}
            )
            return response.get("count", 0)
        except Exception as e:
            logger.error(f"Error counting logs: {str(e)}")
            return 0

# Singleton instance
elasticsearch_service = ElasticsearchService()