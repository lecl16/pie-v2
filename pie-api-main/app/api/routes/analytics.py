from fastapi import APIRouter, Query
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from app.services.elasticsearch_service import elasticsearch_service

router = APIRouter()

@router.get("/logs/summary", response_model=Dict[str, Any])
async def get_logs_summary(
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
):
    """Get a summary of logs for dashboard visualizations."""
    if not start_time:
        start_time = datetime.utcnow() - timedelta(days=1)
    if not end_time:
        end_time = datetime.utcnow()
    
    # Get log counts by level
    level_counts = await elasticsearch_service.aggregate_logs(
        agg_field="level",
        start_time=start_time,
        end_time=end_time
    )
    
    # Get log counts by category
    category_counts = await elasticsearch_service.aggregate_logs(
        agg_field="category",
        start_time=start_time,
        end_time=end_time
    )
    
    # Get logs over time (histogram)
    time_histogram = await elasticsearch_service.time_histogram(
        start_time=start_time,
        end_time=end_time,
        interval="hour"
    )
    
    # Get top sessions by log count
    top_sessions = await elasticsearch_service.aggregate_logs(
        agg_field="session_id",
        start_time=start_time,
        end_time=end_time,
        size=20
    )
    
    # Get top courses by log count
    top_courses = await elasticsearch_service.aggregate_logs(
        agg_field="course_id",
        start_time=start_time,
        end_time=end_time,
        size=20
    )
    
    # Get top exams by log count
    top_exams = await elasticsearch_service.aggregate_logs(
        agg_field="exam_id",
        start_time=start_time,
        end_time=end_time,
        size=20
    )
    
    # Get top users by log count
    top_users = await elasticsearch_service.aggregate_logs(
        agg_field="user_nmec",
        start_time=start_time,
        end_time=end_time,
        size=20
    )
    
    # Get error logs
    error_logs = await elasticsearch_service.search_logs(
        level="ERROR",
        start_time=start_time,
        end_time=end_time,
        size=10
    )
    
    return {
        "level_distribution": level_counts,
        "category_distribution": category_counts,
        "time_histogram": time_histogram,
        "top_sessions": top_sessions,
        "top_courses": top_courses,
        "top_exams": top_exams,
        "top_users": top_users,
        "recent_errors": error_logs
    }

@router.get("/logs/time-series", response_model=Dict[str, Any])
async def get_logs_time_series(
    field: str = "level",
    value: Optional[str] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    interval: str = "hour"
):
    """Get time-series data for a specific field."""
    if not start_time:
        start_time = datetime.utcnow() - timedelta(days=1)
    if not end_time:
        end_time = datetime.utcnow()
        
    time_series = await elasticsearch_service.time_histogram(
        start_time=start_time,
        end_time=end_time,
        interval=interval,
        filter_field=field,
        filter_value=value
    )
    
    return {
        "time_series": time_series,
        "field": field,
        "value": value,
        "interval": interval
    }

@router.get("/logs/entity/{entity_type}/{entity_id}", response_model=Dict[str, Any])
async def get_entity_logs_summary(
    entity_type: str,
    entity_id: str,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
):
    """Get summary of logs for a specific entity (course, exam, session, user)."""
    if not start_time:
        start_time = datetime.utcnow() - timedelta(days=7)
    if not end_time:
        end_time = datetime.utcnow()
    
    # Map entity type to field name
    field_name = {
        "course": "course_id",
        "exam": "exam_id",
        "session": "session_id",
        "user": "user_nmec"
    }.get(entity_type)
    
    if not field_name:
        return {"error": f"Invalid entity type: {entity_type}"}
    
    # Convert entity_id to integer if needed
    if entity_type in ["exam", "session", "user"]:
        try:
            entity_id = int(entity_id)
        except ValueError:
            return {"error": f"Invalid {entity_type}_id: {entity_id}, must be an integer"}
    
    # Get time histogram for this entity
    time_histogram = await elasticsearch_service.time_histogram(
        start_time=start_time,
        end_time=end_time,
        interval="hour",
        filter_field=field_name,
        filter_value=entity_id
    )
    
    # Get level distribution for this entity
    level_counts = await elasticsearch_service.aggregate_logs(
        agg_field="level",
        start_time=start_time,
        end_time=end_time,
        **{field_name: entity_id}
    )
    
    # Get category distribution for this entity
    category_counts = await elasticsearch_service.aggregate_logs(
        agg_field="category",
        start_time=start_time,
        end_time=end_time,
        **{field_name: entity_id}
    )
    
    # Get recent logs for this entity
    recent_logs = await elasticsearch_service.search_logs(
        start_time=start_time,
        end_time=end_time,
        size=10,
        **{field_name: entity_id}
    )
    
    return {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "time_histogram": time_histogram,
        "level_distribution": level_counts,
        "category_distribution": category_counts,
        "recent_logs": recent_logs
    }

@router.get("/logs/hierarchy", response_model=Dict[str, Any])
async def get_logs_hierarchy(
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
):
    """Get a hierarchical view of logs - courses, exams, sessions."""
    if not start_time:
        start_time = datetime.utcnow() - timedelta(days=30)
    if not end_time:
        end_time = datetime.utcnow()
    
    # Get courses with log counts
    courses = await elasticsearch_service.aggregate_logs(
        agg_field="course_id",
        start_time=start_time,
        end_time=end_time,
        size=100  # Get more courses to have a complete picture
    )
    
    # Get exams with log counts
    exams = await elasticsearch_service.aggregate_logs(
        agg_field="exam_id",
        start_time=start_time,
        end_time=end_time,
        size=100
    )
    
    # Get sessions with log counts
    sessions = await elasticsearch_service.aggregate_logs(
        agg_field="session_id",
        start_time=start_time,
        end_time=end_time,
        size=200
    )
    
    return {
        "courses": courses,
        "exams": exams,
        "sessions": sessions,
    }

@router.get("/logs/hierarchy/course/{course_id}", response_model=Dict[str, Any])
async def get_course_hierarchy(
    course_id: str,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
):
    """Get hierarchical view of exams within a course."""
    if not start_time:
        start_time = datetime.utcnow() - timedelta(days=30)
    if not end_time:
        end_time = datetime.utcnow()
    
    # Get exams for this course
    exams = await elasticsearch_service.aggregate_logs(
        agg_field="exam_id",
        start_time=start_time,
        end_time=end_time,
        course_id=course_id,
        size=100
    )
    
    return {
        "course_id": course_id,
        "exams": exams
    }

@router.get("/logs/hierarchy/exam/{exam_id}", response_model=Dict[str, Any])
async def get_exam_hierarchy(
    exam_id: int,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
):
    """Get hierarchical view of sessions within an exam."""
    if not start_time:
        start_time = datetime.utcnow() - timedelta(days=30)
    if not end_time:
        end_time = datetime.utcnow()
    
    # Get sessions for this exam
    sessions = await elasticsearch_service.aggregate_logs(
        agg_field="session_id",
        start_time=start_time,
        end_time=end_time,
        exam_id=exam_id,
        size=100
    )
    
    return {
        "exam_id": exam_id,
        "sessions": sessions
    }
