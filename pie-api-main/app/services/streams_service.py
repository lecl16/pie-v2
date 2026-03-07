import json
import uuid
import logging
from datetime import datetime
from typing import Dict, List, Any, Optional
import redis.asyncio as redis
from app.core.config import config
from app.schemas.logs import LogCreate, LogResponse

logger = logging.getLogger("uvicorn.error")

class LogService:
    def __init__(self):
        self.redis = None
        self.es_service = None
        self.max_stream_length = 1000  # Keep last 1000 logs per stream
        
    async def connect(self, es_service=None):
        self.redis = await redis.Redis.from_url(config.REDIS_URL, decode_responses=True)
        if es_service:
            self.es_service = es_service
            logger.info("Elasticsearch service connected to DeviceLogService")

    async def add_log(self, device_id: int, log: LogCreate) -> str:
        log_dict = log.model_dump()
        
        if isinstance(log_dict["timestamp"], datetime):
            log_dict["timestamp"] = log_dict["timestamp"].isoformat()
            
        log_id = str(uuid.uuid4())
        log_dict["id"] = log_id
        
        if log_dict.get("details") is not None:
            log_dict["details"] = json.dumps(log_dict["details"])

        log_dict = {k: v for k, v in log_dict.items() if v is not None}

        # Create streams for course and exam if they exist
        if log.course_id:
            course_stream_key = f"logs:course:{log.course_id}"
            await self.redis.xadd(
                course_stream_key, 
                log_dict,
                maxlen=self.max_stream_length,
                approximate=True
            )
            
        if log.exam_id:
            exam_stream_key = f"logs:exam:{log.exam_id}"
            await self.redis.xadd(
                exam_stream_key, 
                log_dict,
                maxlen=self.max_stream_length,
                approximate=True
            )
            
        if log.course_id and log.exam_id:
            course_exam_stream_key = f"logs:course:{log.course_id}:exam:{log.exam_id}"
            await self.redis.xadd(
                course_exam_stream_key, 
                log_dict,
                maxlen=self.max_stream_length,
                approximate=True
            )

        # Store in device stream
        device_stream_key = f"logs:device:{device_id}"
        await self.redis.xadd(
            device_stream_key, 
            log_dict,
            maxlen=self.max_stream_length,
            approximate=True
        )
        
        # Store in session stream if session_id is provided
        if log.session_id:
            session_stream_key = f"logs:session:{log.session_id}"
            await self.redis.xadd(
                session_stream_key, 
                log_dict,
                maxlen=self.max_stream_length,
                approximate=True
            )
            
        # Store in session_user stream if both session_id and user_nmec are provided
        if log.user_nmec:
            session_user_stream_key = f"logs:session:{log.session_id}:user:{log.user_nmec}"
            await self.redis.xadd(
                session_user_stream_key, 
                log_dict,
                maxlen=self.max_stream_length,
                approximate=True
            )
            
        # Store in user stream if user_nmec is provided
        if log.user_nmec:
            user_stream_key = f"logs:user:{log.user_nmec}"
            await self.redis.xadd(
                user_stream_key, 
                log_dict,
                maxlen=self.max_stream_length,
                approximate=True
            )
        
            # Also publish to pubsub for real-time streaming
            log_json = json.dumps(log_dict)
            if log.session_id and log.user_nmec:
                await self.redis.publish(
                    f"logs:session:{log.session_id}:user:{log.user_nmec}", 
                    log_json
                )     
        
        # Store in Elasticsearch for long-term archival and search
        if self.es_service:
            try:
                # Create a copy with properly parsed details for Elasticsearch
                es_log = log_dict.copy()
                if "details" in es_log and isinstance(es_log["details"], str):
                    try:
                        es_log["details"] = json.loads(es_log["details"])
                    except Exception as e:
                        logger.warning(f"Failed to parse details JSON for Elasticsearch: {e}")
                
                # Ensure fields have correct types for Elasticsearch
                for field in ["device_id", "user_nmec", "session_id", "exam_id"]:
                    if field in es_log and es_log[field] is not None:
                        try:
                            es_log[field] = int(es_log[field])
                        except (ValueError, TypeError):
                            logger.warning(f"Could not convert {field} to integer: {es_log[field]}")
                
                # Index the log in Elasticsearch
                await self.es_service.index_logs([es_log])
                logger.info(f"Log {log_id} indexed in Elasticsearch with data: {json.dumps(es_log)}")
            except Exception as e:
                logger.error(f"Error indexing log in Elasticsearch: {e}")
        
        return log_id
    
    async def get_device_logs(self, device_id: int, count: int = 100) -> List[LogResponse]:
        stream_key = f"logs:device:{device_id}"
        return await self._get_logs_from_stream(stream_key, count)
    
    async def get_session_logs(self, session_id: int, count: int = 100) -> List[LogResponse]:
        stream_key = f"logs:session:{session_id}"
        return await self._get_logs_from_stream(stream_key, count)
    
    async def get_user_logs(self, user_nmec: int, count: int = 100) -> List[LogResponse]:
        stream_key = f"logs:user:{user_nmec}"
        return await self._get_logs_from_stream(stream_key, count)
    
    async def get_session_user_logs(self, session_id: int, user_nmec: int, count: int = 100) -> List[LogResponse]:
        stream_key = f"logs:session:{session_id}:user:{user_nmec}"
        return await self._get_logs_from_stream(stream_key, count)

    async def get_course_logs(self, course_id: str, count: int = 100) -> List[LogResponse]:
        stream_key = f"logs:course:{course_id}"
        return await self._get_logs_from_stream(stream_key, count)

    async def get_exam_logs(self, exam_id: int, count: int = 100) -> List[LogResponse]:
        stream_key = f"logs:exam:{exam_id}"
        return await self._get_logs_from_stream(stream_key, count)

    async def get_course_exam_logs(self, course_id: str, exam_id: int, count: int = 100) -> List[LogResponse]:
        stream_key = f"logs:course:{course_id}:exam:{exam_id}"
        return await self._get_logs_from_stream(stream_key, count)
    
    async def _get_logs_from_stream(self, stream_key: str, count: int = 100) -> List[LogResponse]:
        logs_data = await self.redis.xrevrange(stream_key, '+', '-', count=count)
        
        logs = []
        for _, log_dict in logs_data:
            if "details" in log_dict and log_dict["details"]:
                try:
                    log_dict["details"] = json.loads(log_dict["details"])
                except:
                    pass
                
            if "timestamp" in log_dict:
                try:
                    log_dict["timestamp"] = datetime.fromisoformat(log_dict["timestamp"])
                except:
                    pass
                
            logs.append(LogResponse(**log_dict))
            
        return logs

# Initialize the service
log_service = LogService()