from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import config
from app.models.db.base import Base
from app.models.db import course, device, exam, user, session, session_user, submission

# Create the SQLAlchemy engine
engine = create_engine(config.DATABASE_URL, echo=True)

# Create session factory
SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False
)

def get_db():
    """Dependency to get the database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Initialize tables (only run during first setup or migration)
def init_db():
    with engine.connect() as connection:
        # Base.metadata.drop_all(bind=connection) # ! WARNING ! This will delete all data
        # Base.metadata.tables['submission'].drop(connection, checkfirst=True) # Drop a specific table
        # Base.metadata.tables['session_user'].drop(connection, checkfirst=True) # Drop a specific table
        # Base.metadata.tables['session'].drop(connection, checkfirst=True) # Drop a specific table
        Base.metadata.create_all(bind=connection) # Create tables
