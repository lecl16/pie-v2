from pydantic import BaseModel

class PubSubMessage(BaseModel):
    operation: str
    message: str
    courseID: str
    examID: int
    sessionID: int
