import os
import json
import uuid
import shutil
from datetime import datetime
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form as FormParam
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session as DBSession
import jwt
import re
import base64
from jwt import PyJWKClient
import httpx
import re

from database import SessionLocal, Form, Session as SurveySession, Response, init_db
import llm_provider
import clustering
import ocr_provider
import rag_pipeline
import whatsapp_provider

# Create backend directories
os.makedirs("uploads", exist_ok=True)

# Initialize database
init_db()

app = FastAPI(title="FormPulse API", version="1.0")

import asyncio

async def keep_awake_loop():
    """Pings the external URLs every 10 minutes to prevent Render free tier sleep."""
    import httpx
    while True:
        await asyncio.sleep(600)  # 10 minutes (Render sleeps after 15)
        # Grab external URLs from env
        backend_url = os.getenv("RENDER_EXTERNAL_URL", "http://localhost:8000")
        openwa_url = os.getenv("OPENWA_EXTERNAL_URL")
        
        # Fallback to OPENWA_API_URL if OPENWA_EXTERNAL_URL isn't explicitly set
        if not openwa_url:
            openwa_api = os.getenv("OPENWA_API_URL", "http://localhost:2785/api")
            openwa_url = openwa_api.replace("/api", "")
        
        urls_to_ping = [f"{backend_url}/api/health"]
        if openwa_url and "localhost" not in openwa_url:
            urls_to_ping.append(openwa_url) # Pinging the root domain of OpenWA keeps it awake
        
        async with httpx.AsyncClient() as client:
            for url in urls_to_ping:
                try:
                    await client.get(url, timeout=10.0)
                    print(f"[Keep Awake] Pinged {url} successfully to prevent Render sleep.")
                except Exception as e:
                    print(f"[Keep Awake] Failed to ping {url}: {e}")

@app.on_event("startup")
async def startup_event():
    # Launch the infinite loop in the background when FastAPI starts
    asyncio.create_task(keep_awake_loop())

# Mount uploads folder statically for zero-config file serving
app.mount("/api/uploads", StaticFiles(directory="uploads"), name="uploads")

# CORS middleware for local Vercel/frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# DB dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# JWT Token validation dependency
security = HTTPBearer(auto_error=False)
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

_jwks_clients = {}

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """
    Decodes the JWT bearer token sent by the frontend to verify the creator.
    If the JWT secret is not configured or in local SQLite fallback mode,
    it allows access for a default 'sandbox-user' creator.
    Supports both HS256 (symmetric) and ES256 (asymmetric JWKS) token verification.
    """
    from database import IS_FALLBACK_SQLITE
    
    if not credentials:
        if IS_FALLBACK_SQLITE:
            return "sandbox-user"
        raise HTTPException(status_code=401, detail="Authentication credentials required")

    token = credentials.credentials
    
    try:
        # Inspect the algorithm in the header without verification first
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "HS256")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token format: {e}")

    if alg == "ES256":
        try:
            # Parse supabase reference from database URL
            db_url = os.getenv("SUPABASE_DATABASE_URL", "")
            match = re.search(r"postgres\.([a-z0-9]+)", db_url)
            if not match:
                raise Exception("Unable to parse Supabase reference from database URL")
            
            supabase_ref = match.group(1)
            jwks_url = f"https://{supabase_ref}.supabase.co/auth/v1/.well-known/jwks.json"
            
            if jwks_url not in _jwks_clients:
                _jwks_clients[jwks_url] = PyJWKClient(jwks_url)
                
            jwks_client = _jwks_clients[jwks_url]
            signing_key = jwks_client.get_signing_key_from_jwt(token)
            
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256"],
                options={"verify_aud": False}
            )
            
            user_id = payload.get("sub")
            if not user_id:
                raise HTTPException(status_code=401, detail="Invalid token subject")
            return user_id
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
        except Exception as e:
            if IS_FALLBACK_SQLITE:
                return "sandbox-user"
            raise HTTPException(status_code=401, detail=f"Invalid authentication token: {e}")
            
    else: # HS256 fallback
        if SUPABASE_JWT_SECRET:
            try:
                # Some Supabase secrets are base64-encoded, try decoding if it ends with '=' or is length 88
                secret_key = SUPABASE_JWT_SECRET
                if len(secret_key) == 88 and secret_key.endswith("="):
                    try:
                        secret_key = base64.b64decode(secret_key)
                    except Exception:
                        pass
                
                payload = jwt.decode(token, secret_key, algorithms=["HS256"], options={"verify_aud": False})
                user_id = payload.get("sub")
                if not user_id:
                    raise HTTPException(status_code=401, detail="Invalid token subject")
                return user_id
            except jwt.ExpiredSignatureError:
                raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
            except jwt.InvalidTokenError as e:
                if IS_FALLBACK_SQLITE:
                    return "sandbox-user"
                raise HTTPException(status_code=401, detail=f"Invalid authentication token: {e}")
        else:
            if IS_FALLBACK_SQLITE:
                try:
                    payload = jwt.decode(token, options={"verify_signature": False})
                    return payload.get("sub", "sandbox-user")
                except Exception:
                    return "sandbox-user"
            raise HTTPException(status_code=401, detail="Supabase JWT secret is not configured in backend environment")

# -----------------
# 0. ROOT ROUTE
# -----------------
@app.get("/")
def read_root():
    return {
        "status": "healthy",
        "message": "FormPulse API is running.",
        "health": "/api/health"
    }

# -----------------
# 1. API STATUS & STATS
# -----------------
@app.get("/api/health")
def health_check():
    from database import IS_FALLBACK_SQLITE
    return {
        "status": "healthy",
        "groq_configured": llm_provider.is_configured(),
        "database_mode": "SQLite Fallback" if IS_FALLBACK_SQLITE else "Supabase PostgreSQL",
        "timestamp": datetime.utcnow().isoformat()
    }

@app.get("/api/stats")
def get_global_stats(user_id: str = Depends(get_current_user), db: DBSession = Depends(get_db)):
    """
    Calculates overall real-time KPIs scoped to the authenticated creator.
    """
    total_forms = db.query(Form).filter(Form.user_id == user_id).count()
    total_sessions = db.query(SurveySession).join(Form).filter(Form.user_id == user_id).count()
    total_completed = db.query(Response).join(Form).filter(Form.user_id == user_id).count()
    
    completion_rate = 0
    dropoff_rate = 0
    if total_sessions > 0:
        completion_rate = round((total_completed / total_sessions) * 100)
        dropoff_rate = round(((total_sessions - total_completed) / total_sessions) * 100)
        
    avg_duration_sec = 0.0
    all_responses = db.query(Response).join(Form).filter(Form.user_id == user_id).all()
    if total_completed > 0:
        durations = []
        for r in all_responses:
            sess = db.query(SurveySession).filter(SurveySession.id == r.session_id).first()
            if sess and r.submitted_at and sess.created_at:
                diff = (r.submitted_at - sess.created_at).total_seconds()
                if 0 < diff < 3600:
                    durations.append(diff)
        if durations:
            avg_duration_sec = round(sum(durations) / len(durations), 1)

    # 1. Calculate sentiment pulse
    sentiment_counts = {"Positive": 0, "Neutral": 0, "Negative": 0}
    for r in all_responses:
        raw_history = json.loads(r.raw_chat)
        user_msgs = [m["content"] for m in raw_history if m["role"] == "user"]
        full_user_text = " | ".join(user_msgs) if user_msgs else ""
        sentiment = analyze_sentiment(full_user_text)
        sentiment_counts[sentiment] = sentiment_counts.get(sentiment, 0) + 1

    # 2. Get 5 most recent responses
    recent_responses = []
    latest_db_responses = db.query(Response).join(Form).filter(Form.user_id == user_id).order_by(Response.submitted_at.desc()).limit(5).all()
    for r in latest_db_responses:
        form = db.query(Form).filter(Form.id == r.form_id).first()
        raw_history = json.loads(r.raw_chat)
        user_msgs = [m["content"] for m in raw_history if m["role"] == "user"]
        full_user_text = " | ".join(user_msgs) if user_msgs else "No dialogue"
        sentiment = analyze_sentiment(full_user_text)
        recent_responses.append({
            "id": r.id,
            "form_title": form.title if form else "Deleted Form",
            "form_id": r.form_id,
            "snippet": user_msgs[-1][:60] + "..." if user_msgs else "No messages",
            "sentiment": sentiment,
            "submitted_at": r.submitted_at.date().isoformat() if r.submitted_at else None
        })
        
    return {
        "totalForms": total_forms,
        "totalSessions": total_sessions,
        "totalCompleted": total_completed,
        "completionRate": completion_rate,
        "dropoffRate": dropoff_rate,
        "avgDuration": avg_duration_sec,
        "sentimentDistribution": sentiment_counts,
        "recentResponses": recent_responses
    }

# -----------------
# 2. FORM CREATION & CRUD
# -----------------
@app.post("/api/forms")
def create_form(data: dict, user_id: str = Depends(get_current_user), db: DBSession = Depends(get_db)):
    """
    Creates a form.
    Can accept a natural language "prompt" to auto-generate the form,
    or a manual form configuration payload.
    """
    if "prompt" in data:
        # Prompt-to-form generation
        prompt = data["prompt"]
        generated = llm_provider.generate_form_schema(prompt)
        
        # Enforce pacing planner agent on the generated schema
        fields = generated.get("schema_fields", [])
        title = generated.get("title", "AI Generated Form")
        objective = generated.get("objective", "Extract parameters")
        fields = llm_provider.plan_conversational_flow(title, objective, fields)
        
        # Save to database
        new_form = Form(
            id=str(uuid.uuid4()),
            user_id=user_id,
            title=title,
            objective=objective,
            schema_fields=json.dumps(fields),
            guardrails=json.dumps(generated.get("guardrails", {})),
            settings=json.dumps(generated.get("settings", {}))
        )
    else:
        # Manual configuration
        title = data.get("title", "Untitled Form")
        objective = data.get("objective", "General feedback collection")
        fields = data.get("schema_fields", [])
        
        # Run pacing planner to add casual phrasing to manual fields
        fields = llm_provider.plan_conversational_flow(title, objective, fields)
        
        new_form = Form(
            id=data.get("id", str(uuid.uuid4())),
            user_id=user_id,
            title=title,
            objective=objective,
            schema_fields=json.dumps(fields),
            guardrails=json.dumps(data.get("guardrails", {})),
            settings=json.dumps(data.get("settings", {}))
        )

    db.add(new_form)
    db.commit()
    db.refresh(new_form)
    return new_form.to_dict()

def clean_html_to_text(html_content: str) -> str:
    # Strip script and style blocks
    html_content = re.sub(r'<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>', '', html_content, flags=re.I)
    html_content = re.sub(r'<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>', '', html_content, flags=re.I)
    # Strip head block
    html_content = re.sub(r'<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>', '', html_content, flags=re.I)
    # Strip comments
    html_content = re.sub(r'<!--.*?-->', '', html_content, flags=re.DOTALL)
    # Strip HTML tags
    text = re.sub(r'<[^>]+>', ' ', html_content)
    # Normalize space
    return re.sub(r'\s+', ' ', text).strip()

@app.post("/api/forms/scrape")
def scrape_and_create_form(data: dict, user_id: str = Depends(get_current_user), db: DBSession = Depends(get_db)):
    """
    Scrapes a target website URL, extracts the brand copy/features,
    and uses the LLM to generate a customized conversational survey form.
    """
    url = data.get("url")
    prompt = data.get("prompt", "")
    if not url:
        raise HTTPException(status_code=400, detail="Target URL is required")
        
    # Ensure scheme
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

    text_content = ""
    try:
        # Fetch webpage with a custom User-Agent to avoid quick blocking
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 FormPulseBrandScraper/1.0"
        }
        with httpx.Client(timeout=6.0, follow_redirects=True) as client_http:
            response = client_http.get(url, headers=headers)
            if response.status_code == 200:
                text_content = clean_html_to_text(response.text)
            else:
                print(f"Scraper returned status code {response.status_code} for {url}. Using fallback.")
    except Exception as e:
        print(f"Failed to scrape webpage {url} due to: {e}. Proceeding with domain-fallback schema generation.")

    # Call LLM generator (will automatically use mock generator if text_content is empty or client is not configured)
    generated = llm_provider.generate_form_schema_from_webpage(url, text_content, prompt)
    
    # Enrich pacing flow naturally
    fields = generated.get("schema_fields", [])
    title = generated.get("title", "AI Brand Generated Form")
    objective = generated.get("objective", f"Brand study for {url}")
    fields = llm_provider.plan_conversational_flow(title, objective, fields)

    # Save to database
    new_form = Form(
        id=str(uuid.uuid4()),
        user_id=user_id,
        title=title,
        objective=objective,
        schema_fields=json.dumps(fields),
        guardrails=json.dumps(generated.get("guardrails", {})),
        settings=json.dumps(generated.get("settings", {}))
    )

    db.add(new_form)
    db.commit()
    db.refresh(new_form)
    return new_form.to_dict()

@app.get("/api/forms")
def list_forms(user_id: str = Depends(get_current_user), db: DBSession = Depends(get_db)):
    forms = db.query(Form).filter(Form.user_id == user_id).all()
    return [f.to_dict() for f in forms]

@app.get("/api/forms/{form_id}")
def get_form(form_id: str, user_id: str = Depends(get_current_user), db: DBSession = Depends(get_db)):
    form = db.query(Form).filter(Form.id == form_id, Form.user_id == user_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    return form.to_dict()

@app.put("/api/forms/{form_id}")
def update_form(form_id: str, data: dict, user_id: str = Depends(get_current_user), db: DBSession = Depends(get_db)):
    form = db.query(Form).filter(Form.id == form_id, Form.user_id == user_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    title = data.get("title", form.title)
    objective = data.get("objective", form.objective)

    if "title" in data:
        form.title = title
    if "objective" in data:
        form.objective = objective
    if "schema_fields" in data:
        # Run conversation planner agent automatically on manual changes
        fields = data["schema_fields"]
        fields = llm_provider.plan_conversational_flow(title, objective, fields)
        form.schema_fields = json.dumps(fields)
    if "guardrails" in data:
        form.guardrails = json.dumps(data["guardrails"])
    if "settings" in data:
        form.settings = json.dumps(data["settings"])

    db.commit()
    db.refresh(form)
    return form.to_dict()

@app.post("/api/forms/{form_id}/refine")
def refine_form(form_id: str, data: dict, user_id: str = Depends(get_current_user), db: DBSession = Depends(get_db)):
    """
    Refines / updates an existing form config using AI reasoning without creating a duplicate.
    """
    form = db.query(Form).filter(Form.id == form_id, Form.user_id == user_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    prompt = data.get("prompt", "")
    if not prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt is required")

    current_schema = {
        "title": form.title,
        "objective": form.objective,
        "schema_fields": json.loads(form.schema_fields),
        "guardrails": json.loads(form.guardrails),
        "settings": json.loads(form.settings)
    }

    refined = llm_provider.refine_form_schema(current_schema, prompt)
    
    title = refined.get("title", form.title)
    objective = refined.get("objective", form.objective)
    fields = refined.get("schema_fields", [])
    
    # Post-process refined fields to ensure pacing questions are set
    fields = llm_provider.plan_conversational_flow(title, objective, fields)

    form.title = title
    form.objective = objective
    form.schema_fields = json.dumps(fields)
    form.guardrails = json.dumps(refined.get("guardrails", {}))
    form.settings = json.dumps(refined.get("settings", {}))

    db.commit()
    db.refresh(form)
    return form.to_dict()

@app.delete("/api/forms/{form_id}")
def delete_form(form_id: str, user_id: str = Depends(get_current_user), db: DBSession = Depends(get_db)):
    form = db.query(Form).filter(Form.id == form_id, Form.user_id == user_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    
    db.delete(form)
    db.commit()
    return {"message": "Form deleted successfully"}

@app.post("/api/forms/{form_id}/upload_document")
def upload_knowledge_document(
    form_id: str,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    form = db.query(Form).filter(Form.id == form_id, Form.user_id == user_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    ext = file.filename.split(".")[-1]
    temp_filename = f"uploads/{uuid.uuid4().hex}.{ext}"
    with open(temp_filename, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    try:
        markdown_text = ocr_provider.parse_document(temp_filename)
        rag_pipeline.index_document(form_id, markdown_text)
        
        settings = json.loads(form.settings)
        settings["has_knowledge_base"] = True
        form.settings = json.dumps(settings)
        db.commit()
        
        return {"message": "Document uploaded and indexed successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            os.remove(temp_filename)
        except:
            pass

# -----------------
# 3. RESPONDENT SURVEY SESSIONS
# -----------------
def get_active_field(form_dict: dict, extracted_data: dict) -> dict:
    """
    Looks at the form schema and identifies the next unextracted field.
    Returns the field schema details (id, label, type, etc.) or None if complete.
    """
    fields = form_dict.get("schema_fields", [])
    for f in fields:
        if f["id"] not in extracted_data:
            return {
                "id": f["id"],
                "label": f["label"],
                "type": f.get("type", "text"),
                "required": f.get("required", False),
                "choices": f.get("choices"),
                "description": f.get("description", "")
            }
    return None

@app.post("/api/sessions")
def start_session(data: dict, db: DBSession = Depends(get_db)):
    form_id = data.get("form_id")
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    form_dict = form.to_dict()
    # Opening question generated conversationally by the AI agent to maintain flow and context
    opening_message = llm_provider.generate_opening_question(form_dict)

    new_session = SurveySession(
        id=str(uuid.uuid4()),
        form_id=form_id,
        status="active",
        conversation_history=json.dumps([
            {"role": "assistant", "content": opening_message}
        ]),
        extracted_data=json.dumps({}),
        fatigue_index=0.0
    )

    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    
    session_data = new_session.to_dict()
    session_data["active_field"] = get_active_field(form_dict, {})
    session_data["form"] = {
        "title": form.title,
        "settings": form_dict["settings"]
    }
    return session_data

@app.post("/api/sessions/{session_id}/upload")
async def upload_file(
    session_id: str,
    file: UploadFile = File(...),
    db: DBSession = Depends(get_db)
):
    """
    Handles uploads during a survey session.
    First tries uploading to the platform owner's central Supabase Storage bucket (formpulse-uploads).
    Falls back to local disk storage if credentials are missing or if upload fails.
    """
    survey_session = db.query(SurveySession).filter(SurveySession.id == session_id).first()
    if not survey_session:
        raise HTTPException(status_code=404, detail="Survey session not found")

    supabase_url = os.getenv("SUPABASE_URL", "")
    supabase_anon_key = os.getenv("SUPABASE_ANON_KEY", "")

    # Sanitize and format filename
    raw_filename = file.filename or "attachment"
    filename_parts = raw_filename.split(".")
    ext = filename_parts[-1].lower() if len(filename_parts) > 1 else "bin"
    
    unique_id = uuid.uuid4().hex[:8]
    safe_filename = f"{session_id}_{unique_id}.{ext}"
    safe_filename = re.sub(r"[^a-zA-Z0-9_.-]", "_", safe_filename)

    # 1. Supabase Storage Upload (Production-grade, central)
    if supabase_url and supabase_anon_key:
        try:
            url = supabase_url.rstrip("/")
            bucket = "formpulse-uploads"
            upload_url = f"{url}/storage/v1/object/{bucket}/sessions/{session_id}/{safe_filename}"

            headers = {
                "Authorization": f"Bearer {supabase_anon_key}",
                "ApiKey": supabase_anon_key,
                "Content-Type": file.content_type or "application/octet-stream"
            }

            file_content = await file.read()
            async with httpx.AsyncClient() as client_http:
                response = await client_http.post(upload_url, content=file_content, headers=headers, timeout=20.0)
                if response.status_code == 200:
                    public_url = f"{url}/storage/v1/object/public/{bucket}/sessions/{session_id}/{safe_filename}"
                    return {"url": public_url}
                else:
                    print(f"Supabase REST storage upload failed with status {response.status_code}: {response.text}")
        except Exception as e:
            print(f"Failed uploading to Supabase Storage: {e}")

    # 2. Local File System Fallback (Zero-config/Development sandbox)
    try:
        local_path = os.path.join("uploads", safe_filename)
        # Reset file cursor just in case it was read during Supabase attempt
        await file.seek(0)
        with open(local_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Local relative path served by FastAPI static mounting
        return {"url": f"/api/uploads/{safe_filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Local storage fallback failed: {e}")

@app.post("/api/forms/upload")
async def upload_form_asset(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    """
    Handles logo and banner uploads for form configuration.
    Saves to platform owner's central Supabase Storage first, then falls back to local disk.
    """
    supabase_url = os.getenv("SUPABASE_URL", "")
    supabase_anon_key = os.getenv("SUPABASE_ANON_KEY", "")

    # Sanitize and format filename
    raw_filename = file.filename or "asset"
    filename_parts = raw_filename.split(".")
    ext = filename_parts[-1].lower() if len(filename_parts) > 1 else "bin"
    
    unique_id = uuid.uuid4().hex[:8]
    safe_filename = f"creator_{user_id}_{unique_id}.{ext}"
    safe_filename = re.sub(r"[^a-zA-Z0-9_.-]", "_", safe_filename)

    # 1. Supabase Storage
    if supabase_url and supabase_anon_key:
        try:
            url = supabase_url.rstrip("/")
            bucket = "formpulse-uploads"
            upload_url = f"{url}/storage/v1/object/{bucket}/assets/{user_id}/{safe_filename}"

            headers = {
                "Authorization": f"Bearer {supabase_anon_key}",
                "ApiKey": supabase_anon_key,
                "Content-Type": file.content_type or "application/octet-stream"
            }

            file_content = await file.read()
            async with httpx.AsyncClient() as client_http:
                response = await client_http.post(upload_url, content=file_content, headers=headers, timeout=20.0)
                if response.status_code == 200:
                    public_url = f"{url}/storage/v1/object/public/{bucket}/assets/{user_id}/{safe_filename}"
                    return {"url": public_url}
                else:
                    print(f"Supabase asset upload failed with status {response.status_code}: {response.text}")
        except Exception as e:
            print(f"Failed uploading asset to Supabase: {e}")

    # 2. Local fallback
    try:
        local_path = os.path.join("uploads", safe_filename)
        await file.seek(0)
        with open(local_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        return {"url": f"/api/uploads/{safe_filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Local asset storage fallback failed: {e}")

@app.get("/api/sessions/{session_id}")
def get_session(session_id: str, db: DBSession = Depends(get_db)):
    session = db.query(SurveySession).filter(SurveySession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    form = db.query(Form).filter(Form.id == session.form_id).first()
    session_data = session.to_dict()
    if form:
        form_dict = form.to_dict()
        session_data["active_field"] = get_active_field(form_dict, json.loads(session.extracted_data))
        session_data["form"] = {
            "title": form.title,
            "settings": form_dict["settings"]
        }
    return session_data

@app.post("/api/sessions/{session_id}/respond")
async def respond_to_survey(
    session_id: str,
    message: str = FormParam(None),
    audio: UploadFile = File(None),
    file_url: str = FormParam(None),
    file_field_id: str = FormParam(None),
    db: DBSession = Depends(get_db)
):
    """
    Submits a message (text or audio).
    Fires the Groq conversation turn logic.
    Updates session state and saves response to Responses if complete.
    """
    survey_session = db.query(SurveySession).filter(SurveySession.id == session_id).first()
    if not survey_session:
        raise HTTPException(status_code=404, detail="Survey session not found")

    if survey_session.status != "active":
        return {
            "session": survey_session.to_dict(),
            "form_complete": True,
            "next_message": "This session is already complete. Thank you!"
        }

    form = db.query(Form).filter(Form.id == survey_session.form_id).first()
    form_dict = form.to_dict()

    # Process input (Text or Audio)
    user_input = message
    audio_transcription = None

    if not user_input and file_url:
        user_input = "[Attached File]"

    if audio:
        # Save temporary audio file
        filename_parts = audio.filename.split(".")
        if len(filename_parts) < 2:
            raise HTTPException(status_code=400, detail="Invalid audio file name (missing extension)")
        
        ext = filename_parts[-1].lower()
        allowed_extensions = {"mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm", "ogg", "oga", "flac"}
        if ext not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported audio format. Supported formats: {', '.join(sorted(allowed_extensions))}"
            )

        temp_filename = f"uploads/{session_id}_{uuid.uuid4().hex}.{ext}"
        with open(temp_filename, "wb") as buffer:
            shutil.copyfileobj(audio.file, buffer)
        
        # Transcribe audio using Groq Whisper
        audio_transcription = llm_provider.transcribe_audio(temp_filename)
        user_input = audio_transcription
        
        # Cleanup temp file
        try:
            os.remove(temp_filename)
        except Exception:
            pass

    if not user_input or not user_input.strip():
        raise HTTPException(status_code=400, detail="Empty text and audio parameters")

    # Load states
    history = json.loads(survey_session.conversation_history)
    extracted = json.loads(survey_session.extracted_data)

    # Inject uploaded file/image URL directly into state if provided
    if file_url and file_field_id:
        extracted[file_field_id] = file_url
        survey_session.extracted_data = json.dumps(extracted)
    knowledge_context = ""
    if form_dict.get("settings", {}).get("has_knowledge_base"):
        knowledge_context = rag_pipeline.query_document(form.id, user_input)

    # Process Turn with LLM
    result = llm_provider.process_conversation_turn(form_dict, history, extracted, user_input, knowledge_context)

    # Calculate fatigue based on pacing/message details (Heuristic + LLM)
    input_length = len(user_input.split())
    # Fatigue index increases if inputs are too short or if LLM detects exhaustion
    fatigue_delta = 0.05
    if input_length < 3:
        fatigue_delta = 0.15 # User is typing one word answers
    if result.get("fatigue_rating") == "medium":
        fatigue_delta = 0.2
    elif result.get("fatigue_rating") == "high":
        fatigue_delta = 0.4

    new_fatigue = min(1.0, survey_session.fatigue_index + fatigue_delta)

    # Check settings fatigue threshold
    fatigue_threshold = form_dict.get("settings", {}).get("fatigue_threshold", 0.7)
    form_complete = result.get("form_complete", False) or new_fatigue >= fatigue_threshold

    # Format next message
    next_msg = result.get("next_message", "Thank you.")
    if new_fatigue >= fatigue_threshold and not form_complete:
        next_msg = "I notice you might be busy or running out of time. Let me wrap things up here! Thank you so much for your thoughts."
        form_complete = True

    if form_complete:
        # Programmatic guardrail to ensure the final message does NOT ask any questions.
        import re
        parts = re.split(r'([.!?])', next_msg)
        reconstructed = []
        current = ""
        for part in parts:
            if part in ['.', '!', '?']:
                current += part
                reconstructed.append(current.strip())
                current = ""
            else:
                current += part
        if current.strip():
            reconstructed.append(current.strip())
            
        # Filter out any sentence that ends with a question mark
        non_questions = [s for s in reconstructed if not s.endswith('?')]
        if non_questions:
            next_msg = " ".join(non_questions)
        else:
            next_msg = "Thanks so much for taking the time to share your feedback with us today!"
            
        if "thank" not in next_msg.lower():
            next_msg += " Thank you for your time!"

    # Update history
    history.append({"role": "user", "content": user_input})
    history.append({"role": "assistant", "content": next_msg})

    # Merge LLM results with the state to preserve programmatically injected values
    llm_extracted = result.get("extracted_data", {})
    if isinstance(llm_extracted, dict):
        for k, v in llm_extracted.items():
            extracted[k] = v

    # Update session in DB
    survey_session.conversation_history = json.dumps(history)
    survey_session.extracted_data = json.dumps(extracted)
    survey_session.fatigue_index = new_fatigue

    if form_complete:
        survey_session.status = "completed"
        # Save response in database
        response = Response(
            id=str(uuid.uuid4()),
            form_id=form.id,
            session_id=survey_session.id,
            raw_chat=json.dumps(history),
            extracted_data=json.dumps(extracted),
            fatigue_index=new_fatigue
        )
        db.add(response)

    db.commit()
    db.refresh(survey_session)

    session_data = survey_session.to_dict()
    session_data["active_field"] = get_active_field(form_dict, json.loads(survey_session.extracted_data))
    session_data["form"] = {
        "title": form.title,
        "settings": form_dict["settings"]
    }

    return {
        "session": session_data,
        "form_complete": form_complete,
        "next_message": next_msg,
        "user_transcription": audio_transcription
    }

# -----------------
# 4. ANALYTICS & VISUAL CLUSTERING
# -----------------
def analyze_sentiment(text: str) -> str:
    """
    Analyzes the sentiment of a text response using keyphrase matches.
    Returns: 'Positive', 'Neutral', or 'Negative'
    """
    text_lower = text.lower()
    
    # Positive keyword triggers
    pos_words = [
        "good", "great", "awesome", "excellent", "perfect", "love", 
        "satisfied", "happy", "easy", "fast", "helpful", "smooth", 
        "wonderful", "best", "like", "impressed", "correct", "fine", "helpful"
    ]
    # Negative keyword triggers
    neg_words = [
        "bad", "slow", "lag", "bug", "expensive", "cost", "hate", 
        "terrible", "worst", "pricey", "crashed", "friction", "pain", 
        "annoying", "poor", "difficult", "hard", "confusing", "nuts",
        "price", "overpriced", "billing", "charges", "unavailable"
    ]
    
    pos_score = sum(text_lower.count(w) for w in pos_words)
    neg_score = sum(text_lower.count(w) for w in neg_words)
    
    if pos_score > neg_score:
        return "Positive"
    elif neg_score > pos_score:
        return "Negative"
    else:
        return "Neutral"

@app.get("/api/forms/{form_id}/analytics")
def get_form_analytics(form_id: str, user_id: str = Depends(get_current_user), db: DBSession = Depends(get_db)):
    form = db.query(Form).filter(Form.id == form_id, Form.user_id == user_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found or access denied")

    responses = db.query(Response).filter(Response.form_id == form_id).all()
    sessions = db.query(SurveySession).filter(SurveySession.form_id == form_id).all()

    total_sessions = len(sessions)
    total_completed = len(responses)
    completion_rate = round((total_completed / total_sessions * 100), 1) if total_sessions > 0 else 0.0

    avg_fatigue = round(sum([r.fatigue_index for r in responses]) / total_completed, 2) if total_completed > 0 else 0.0

    # Cluster response texts (we gather a main text block from each response)
    clustering_inputs = []
    for r in responses:
        extracted = json.loads(r.extracted_data)
        # Combine all text fields in extracted data as the cluster target
        text_values = [str(v) for v in extracted.values() if isinstance(v, str) and len(v) > 3]
        combined_text = " ".join(text_values)
        if not combined_text:
            # Fallback to last user message in chat
            raw_history = json.loads(r.raw_chat)
            user_msgs = [m["content"] for m in raw_history if m["role"] == "user"]
            combined_text = user_msgs[-1] if user_msgs else ""
        
        clustering_inputs.append({
            "id": r.id,
            "text": combined_text
        })

    # Run clustering using TF-IDF and K-Means
    cluster_results = clustering.analyze_and_cluster_responses(clustering_inputs)

    # Outliers identification
    outliers = cluster_results.get("outliers", [])
    ml_outlier_ids = {o["response_id"] for o in outliers}

    # Add heuristic outliers (words expressing strong frustration)
    for r in responses:
        if r.id in ml_outlier_ids:
            continue
        raw_history = json.loads(r.raw_chat)
        user_msgs = " ".join([m["content"] for m in raw_history if m["role"] == "user"]).lower()
        if any(w in user_msgs for w in ["lag", "bug", "slow", "error", "terrible", "worst", "hate"]):
            outliers.append({
                "response_id": r.id,
                "text": user_msgs[:120] + "...",
                "reason": "High friction language detected in responses",
                "similarity": 1.0
            })

    # Pacing telemetry (mock metrics by mapping forms schema nodes)
    form_dict = form.to_dict()
    fields = form_dict["schema_fields"]
    pacing_metrics = []
    for f in fields:
        # Mocking average latency (seconds) and drop-off rate per node
        pacing_metrics.append({
            "field": f["label"],
            "avg_time_sec": round(15 + hash(f["id"]) % 10, 1),
            "dropoff_rate": round((hash(f["id"]) % 15) / 100.0, 2)
        })

    # Group responses by day for time-series charts and compile text with sentiment
    from collections import Counter
    date_counts = Counter()
    all_responses_data = []

    for r in responses:
        if r.submitted_at:
            day_str = r.submitted_at.date().isoformat()
            date_counts[day_str] += 1
            
        raw_history = json.loads(r.raw_chat)
        user_msgs = [m["content"] for m in raw_history if m["role"] == "user"]
        full_user_text = " | ".join(user_msgs) if user_msgs else "No verbal responses."
        
        sentiment = analyze_sentiment(full_user_text)
        all_responses_data.append({
            "id": r.id,
            "full_text": full_user_text,
            "sentiment": sentiment,
            "raw_chat": raw_history,
            "extracted_data": json.loads(r.extracted_data) if r.extracted_data else {},
            "submitted_at": r.submitted_at.date().isoformat() if r.submitted_at else None
        })

    trend_series = [{"date": d, "count": c} for d, c in sorted(date_counts.items())]
    if not trend_series:
        trend_series = [{"date": datetime.utcnow().date().isoformat(), "count": 0}]

    return {
        "summary": {
            "total_responses": total_completed,
            "total_sessions": total_sessions,
            "completion_rate_pct": completion_rate,
            "avg_fatigue": avg_fatigue
        },
        "semantic_map": {
            "points": cluster_results.get("points", []),
            "clusters": cluster_results.get("clusters", [])
        },
        "pacing_telemetry": pacing_metrics,
        "outliers": outliers[:10],
        "historical_trends": trend_series,
        "responses_list": all_responses_data
    }

# -----------------
# 5. SYNTHETIC COHORT ROLEPLAY
# -----------------
@app.post("/api/forms/{form_id}/cohort-chat")
def chat_with_cohort(form_id: str, data: dict, user_id: str = Depends(get_current_user), db: DBSession = Depends(get_db)):
    """
    Chats with a synthetic cohort persona.
    Instructs the LLM to roleplay as a user representing the aggregated responses.
    """
    form = db.query(Form).filter(Form.id == form_id, Form.user_id == user_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found or access denied")

    cohort_name = data.get("cohort_name", "General Cohort")
    user_question = data.get("user_question", "")
    chat_history = data.get("chat_history", [])

    # Fetch responses to load context
    responses = db.query(Response).filter(Response.form_id == form_id).all()
    
    # Filter or summarize responses to pass as context
    response_summaries = []
    for r in responses:
        extracted = json.loads(r.extracted_data)
        response_summaries.append(extracted)

    response_context = json.dumps(response_summaries[:15], indent=2)

    if not llm_provider.is_configured():
        return {
            "message": f"[SANDBOX MODE] As a member of the synthetic cohort '{cohort_name}', I think database speed syncs was the biggest bottleneck. If it worked 5x faster, I would not have churned."
        }

    # Structure prompt to roleplay
    system_prompt = (
        f"You are roleplaying as a synthetic user representing the customer cohort: '{cohort_name}'.\n"
        "Your responses must reflect the aggregate feedback gathered from our survey.\n\n"
        f"SURVEY OBJECTIVE:\n{form.objective}\n\n"
        f"AGGREGATE SURVEY DATA (EXTRACTED VALUES):\n{response_context}\n\n"
        "INSTRUCTIONS:\n"
        "1. Adopt the persona of a customer in this cohort (e.g. Price-Conscious Student or Frustrated Developer).\n"
        "2. Answer the researcher's questions truthfully based on the aggregate feedback. Do NOT make up positive details that do not exist.\n"
        "3. Keep your answers brief, candid, and conversational. Speak in first person ('I', 'we')."
    )

    # Format history
    messages = [{"role": "system", "content": system_prompt}]
    for msg in chat_history:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": user_question})

    try:
        completion = llm_provider.client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=messages,
            temperature=0.7
        )
        return {"message": completion.choices[0].message.content}
    except Exception as e:
        print(f"Error querying cohort chat: {e}")
        return {"message": f"[Error: {e}]"}

# -----------------
# 6. WHATSAPP WEBHOOK ROUTER (PICKY ASSIST)
# -----------------
import urllib.parse

@app.post("/api/webhooks/whatsapp")
async def whatsapp_webhook(payload: dict, db: DBSession = Depends(get_db)):
    """
    Receives incoming messages from WhatsApp via Picky Assist Webhook.
    Routes to the correct SurveySession or initiates a new one via deep link.
    """
    print(f"--- INCOMING PICKY ASSIST WEBHOOK ---\n{payload}\n-------------------------------------")
    try:
        # Picky Assist payload format
        from_number = payload.get("number", "")
        if not from_number:
            return {"status": "ignored", "reason": "no_number"}

        # Extract number digits only
        number = "".join(c for c in from_number if c.isdigit())
        user_message = payload.get("message_in_raw", payload.get("message-in", "")).strip()
        if not user_message and payload.get("message-in"):
            user_message = urllib.parse.unquote(payload.get("message-in")).strip()

        # Ignore outgoing messages (direction = 1 is outgoing, 0 is inbound)
        if payload.get("direction") == 1:
            return {"status": "ignored", "reason": "outgoing_message"}

        import re
        # Is this an initialization deep link? (e.g. "start_survey_xxx")
        # Strictly enforce the format to ONLY accept exact matches to prevent accidental triggers
        if re.match(r"^start_survey_[0-9a-fA-F\-]{36}$", user_message):
            # Extract form_id
            form_id = user_message.replace("start_survey_", "").strip()
            form = db.query(Form).filter(Form.id == form_id).first()
            if form:
                # Create a new session. Encode the number in the ID to avoid schema migrations.
                survey_session_id = f"wa_{number}_{uuid.uuid4().hex}"
                form_dict = {
                    "id": form.id,
                    "title": form.title,
                    "objective": form.objective,
                    "schema_fields": json.loads(form.schema_fields),
                    "guardrails": json.loads(form.guardrails) if form.guardrails else {},
                    "settings": json.loads(form.settings) if form.settings else {}
                }
                new_session = SurveySession(
                    id=survey_session_id,
                    form_id=form_id,
                    status="active",
                    conversation_history=json.dumps([]),
                    extracted_data=json.dumps({}),
                    fatigue_index=0.0
                )
                db.add(new_session)
                
                # Generate opening question
                opening_msg = llm_provider.generate_opening_question(form_dict)
                
                # Save history
                history = [{"role": "assistant", "content": opening_msg}]
                new_session.conversation_history = json.dumps(history)
                db.commit()

                # Send immediately
                whatsapp_provider.send_whatsapp_message(number, opening_msg)
                return {"status": "ok", "message": "session_started"}
            else:
                whatsapp_provider.send_whatsapp_message(number, "Sorry, I couldn't find that survey. It might have been deleted.")
                return {"status": "error", "message": "survey_not_found"}

        # If not an initiation, check if this number has an active survey session
        # We query for the absolute most recent session containing this number in the ID
        most_recent_session = db.query(SurveySession).filter(
            SurveySession.id.like(f"wa_{number}_%")
        ).order_by(SurveySession.created_at.desc()).first()

        if not most_recent_session or most_recent_session.status != "active":
            # They just sent a random message without an active survey, or their latest is completed
            # We silently ignore it so the bot doesn't spam groups or random chats
            return {"status": "ignored", "reason": "no_active_session"}

        active_session = most_recent_session

        # Process the conversation turn
        form = db.query(Form).filter(Form.id == active_session.form_id).first()
        form_dict = {
            "id": form.id,
            "title": form.title,
            "objective": form.objective,
            "schema_fields": json.loads(form.schema_fields),
            "guardrails": json.loads(form.guardrails) if form.guardrails else {},
            "settings": json.loads(form.settings) if form.settings else {}
        }

        history = json.loads(active_session.conversation_history)
        extracted = json.loads(active_session.extracted_data)

        # Handle Knowledge Base RAG
        knowledge_context = ""
        if form_dict.get("settings", {}).get("has_knowledge_base"):
            knowledge_context = rag_pipeline.query_document(form.id, user_message)

        # Call LLM
        result = llm_provider.process_conversation_turn(form_dict, history, extracted, user_message, knowledge_context)

        # Update Fatigue
        input_length = len(user_message.split())
        fatigue_delta = 0.05
        if input_length < 3: fatigue_delta = 0.15
        if result.get("fatigue_rating") == "medium": fatigue_delta = 0.2
        elif result.get("fatigue_rating") == "high": fatigue_delta = 0.4
        
        new_fatigue = min(1.0, active_session.fatigue_index + fatigue_delta)
        
        # Save State
        history.append({"role": "user", "content": user_message})
        history.append({"role": "assistant", "content": result["next_message"]})
        
        active_session.conversation_history = json.dumps(history)
        active_session.extracted_data = json.dumps(result["extracted_data"])
        active_session.fatigue_index = new_fatigue
        
        if result.get("form_complete"):
            active_session.status = "completed"
            
            # Save Final Response Row
            final_response = Response(
                id=str(uuid.uuid4()),
                form_id=form.id,
                session_id=active_session.id,
                extracted_data=active_session.extracted_data,
                raw_chat=active_session.conversation_history,
                fatigue_index=active_session.fatigue_index
            )
            db.add(final_response)

        db.commit()

        
        # Send back to WhatsApp via Picky Assist
        whatsapp_provider.send_whatsapp_message(number, result["next_message"])
        return {"status": "ok", "message": "replied"}

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Webhook Error: {e}")
        return {"status": "error", "reason": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
