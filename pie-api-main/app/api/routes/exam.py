from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.models.db.exam import Exam
from app.schemas.exam import ExamCreate, ExamUpdate, ExamOut

router = APIRouter()

@router.post("/exam-create", response_model=ExamOut)
def create_exam(course_id: str, exam: ExamCreate, db: Session = Depends(get_db)):
    db_exam = Exam(**exam.dict())
    try:
        db.add(db_exam)
        db.commit()
        db.refresh(db_exam)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return db_exam

@router.get("/exams", response_model=List[ExamOut])
def read_exams(course_id: str, db: Session = Depends(get_db)):
    exams = db.query(Exam).filter(Exam.course_id == course_id).all()
    return exams

@router.get("/{exam_id}", response_model=ExamOut)
def read_exam(course_id: str, exam_id: int, db: Session = Depends(get_db)):
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if exam is None:
        raise HTTPException(status_code=404, detail="Exam not found")
    return exam

@router.put("/{exam_id}", response_model=ExamOut)
def update_exam(course_id: str, exam_id: int, exam: ExamUpdate, db: Session = Depends(get_db)):
    db_exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if db_exam is None:
        raise HTTPException(status_code=404, detail="Exam not found")
    for key, value in exam.dict().items():
        setattr(db_exam, key, value)
    db.commit()
    db.refresh(db_exam)
    return db_exam

@router.delete("/{exam_id}", response_model=ExamOut)
def delete_exam(course_id: str, exam_id: int, db: Session = Depends(get_db)):
    db_exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if db_exam is None:
        raise HTTPException(status_code=404, detail="Exam not found")
    db.delete(db_exam)
    db.commit()
    return Response(status_code=204)