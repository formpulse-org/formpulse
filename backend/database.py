import json
from datetime import datetime
import uuid
from sqlalchemy import create_engine, Column, String, DateTime, Float, Text, ForeignKey, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship

import os
from dotenv import load_dotenv

load_dotenv()

# Check if Supabase Database URL is configured
supabase_db_url = os.getenv("SUPABASE_DATABASE_URL", "")

IS_FALLBACK_SQLITE = True

def _create_sqlite_engine():
    if os.path.exists("/data"):
        url = "sqlite:////data/formpulse.db"
    else:
        url = "sqlite:///./formpulse.db"
    return create_engine(url, connect_args={"check_same_thread": False})

if supabase_db_url:
    db_url = supabase_db_url
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+psycopg2://", 1)
    elif db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+psycopg2://", 1)
    
    try:
        engine = create_engine(db_url, pool_pre_ping=True)
        # Test the connection immediately
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        IS_FALLBACK_SQLITE = False
        print("[OK] Connected to Supabase PostgreSQL")
    except Exception as e:
        print(f"[WARN] Supabase connection failed: {e}")
        print("       Falling back to local SQLite database")
        engine = _create_sqlite_engine()
        IS_FALLBACK_SQLITE = True
else:
    engine = _create_sqlite_engine()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class Form(Base):
    __tablename__ = "forms"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=True) # Multi-tenant scoped forms
    title = Column(String, nullable=False)
    objective = Column(Text, nullable=False)
    # Stored as JSON strings in SQLite
    schema_fields = Column(Text, default="[]") 
    guardrails = Column(Text, default="{}")
    settings = Column(Text, default="{}")
    created_at = Column(DateTime, default=datetime.utcnow)

    sessions = relationship("Session", back_populates="form", cascade="all, delete-orphan")
    responses = relationship("Response", back_populates="form", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "title": self.title,
            "objective": self.objective,
            "schema_fields": json.loads(self.schema_fields),
            "guardrails": json.loads(self.guardrails),
            "settings": json.loads(self.settings),
            "created_at": self.created_at.isoformat() if self.created_at else None
        }

class Session(Base):
    __tablename__ = "sessions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    form_id = Column(String, ForeignKey("forms.id"), nullable=False)
    status = Column(String, default="active") # active, completed, abandoned
    conversation_history = Column(Text, default="[]") # JSON list of messages
    extracted_data = Column(Text, default="{}") # JSON extracted fields
    fatigue_index = Column(Float, default=0.0) # 0.0 to 1.0
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    form = relationship("Form", back_populates="sessions")
    response = relationship("Response", uselist=False, back_populates="session", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "form_id": self.form_id,
            "status": self.status,
            "conversation_history": json.loads(self.conversation_history),
            "extracted_data": json.loads(self.extracted_data),
            "fatigue_index": self.fatigue_index,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }

class Response(Base):
    __tablename__ = "responses"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    form_id = Column(String, ForeignKey("forms.id"), nullable=False)
    session_id = Column(String, ForeignKey("sessions.id"), nullable=False)
    raw_chat = Column(Text, default="[]") # JSON list of chat messages
    extracted_data = Column(Text, default="{}") # JSON extracted fields
    fatigue_index = Column(Float, default=0.0)
    submitted_at = Column(DateTime, default=datetime.utcnow)

    form = relationship("Form", back_populates="responses")
    session = relationship("Session", back_populates="response")

    def to_dict(self):
        return {
            "id": self.id,
            "form_id": self.form_id,
            "session_id": self.session_id,
            "raw_chat": json.loads(self.raw_chat),
            "extracted_data": json.loads(self.extracted_data),
            "fatigue_index": self.fatigue_index,
            "submitted_at": self.submitted_at.isoformat() if self.submitted_at else None
        }

def init_db():
    Base.metadata.create_all(bind=engine)
