import logging

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.schema import CreateColumn
from sqlalchemy.orm import sessionmaker
from app.core.config import config
from app.models.db.base import Base
from app.models.db import course, device, device_provisioning_secret, exam, user, session, session_user, submission

logger = logging.getLogger("app.database")

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

def _sync_existing_tables(connection):
    """Adds columns/indexes that a model declares but an already-existing
    table is still missing, so a deployment that's already running picks up
    a model change (e.g. a new column) on its next restart without a manual
    migration step.

    `alembic` is in requirements.txt but was never actually wired up (no
    `alembic.ini`/versions directory) — setting that up properly, including
    baseline-stamping every already-deployed database, is more moving parts
    than this single-operator, self-hosted deployment model calls for. This
    covers the same gap `create_all` leaves open (it only creates whole
    tables that don't exist yet, never alters existing ones) with the same
    zero-touch-for-the-operator approach `create_all`/`scripts/setup.sh`
    already use elsewhere.
    """
    inspector = inspect(connection)
    for table in Base.metadata.sorted_tables:
        if not inspector.has_table(table.name):
            continue  # brand new table — create_all already handled it above
        existing_columns = {col["name"] for col in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in existing_columns:
                continue
            column_ddl = CreateColumn(column).compile(dialect=connection.dialect)
            connection.execute(text(f"ALTER TABLE {table.name} ADD COLUMN {column_ddl}"))
            logger.info(f"Added missing column {table.name}.{column.name}")
        for index in table.indexes:
            index.create(bind=connection, checkfirst=True)

# Initialize tables (only run during first setup or migration)
def init_db():
    with engine.connect() as connection:
        # Base.metadata.drop_all(bind=connection) # ! WARNING ! This will delete all data
        # Base.metadata.tables['submission'].drop(connection, checkfirst=True) # Drop a specific table
        # Base.metadata.tables['session_user'].drop(connection, checkfirst=True) # Drop a specific table
        # Base.metadata.tables['session'].drop(connection, checkfirst=True) # Drop a specific table
        Base.metadata.create_all(bind=connection) # Create tables
        _sync_existing_tables(connection) # Add columns/indexes to tables that already existed
