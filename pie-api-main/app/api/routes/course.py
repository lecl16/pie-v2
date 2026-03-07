from fastapi import APIRouter, HTTPException, Depends, Response
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.models.db.course import Course
from app.schemas.course import CourseCreate, CourseRead, CourseUpdate

router = APIRouter()

@router.post("/create", response_model=CourseRead)
def create_course(course: CourseCreate, db: Session = Depends(get_db)):
    db_course = Course(**course.dict())
    try:    
        db.add(db_course)
        db.commit()
        db.refresh(db_course)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return db_course

@router.get("/", response_model=List[CourseRead])
def read_courses(db: Session = Depends(get_db)):
    courses = db.query(Course).all()
    return courses

@router.get("/{course_id}", response_model=CourseRead)
def read_course(course_id: str, db: Session = Depends(get_db)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    return course

@router.put("/{course_id}", response_model=CourseRead)
def update_course(course_id: str, course: CourseUpdate, db: Session = Depends(get_db)):
    db_course = db.query(Course).filter(Course.id == course_id).first()
    if db_course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    for key, value in course.dict().items():
        setattr(db_course, key, value)
    db.commit()
    db.refresh(db_course)
    return db_course

@router.delete("/{course_id}", response_model=CourseRead)
def delete_course(course_id: str, db: Session = Depends(get_db)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    db.delete(course)
    db.commit()
    return Response(status_code=204)