

<h1 align="center">FormPulse</h1>

<p align="center">
  <strong>Conversations That Collect</strong> — Next-generation conversational survey engine replacing static forms with natural dialogues, real-time sentiment analytics, voice transcription, and semantic cohort clustering.
</p>

<p align="center">
  <a href="#key-features">Key Features</a> &bull;
  <a href="#architecture-and-structure">Architecture</a> &bull;
  <a href="#getting-started">Getting Started</a> &bull;
  <a href="#environment-configuration">Environment Configuration</a> &bull;
  <a href="#production-deployment">Production Deployment</a> &bull;
  <a href="#security--multi-tenancy">Security</a>
</p>

---

## Overview

FormPulse is an enterprise-grade, multi-tenant survey platform designed to maximize response yields and capture deep qualitative insights. By substituting rigid web forms with dynamic, context-aware conversational agents, the platform dramatically reduces fatigue-induced drop-off. The built-in analysis suite leverages machine learning to cluster unstructured feedback into actionable user cohorts, exposing performance bottlenecks, friction points, and product opportunities in real time.

## Key Features

* **AI-Driven Form Compilation:** Compile complex, multi-variable survey objectives expressed in natural language into structured target schemas instantly.
* **Natural Pacing Flow Engine:** Conversational agents parse dialogue inputs, evaluate respondent fatigue, and pace questions dynamically based on configured pacing schemas.
* **Whisper Audio Ingestion:** Integrated audio voice note transcription using Groq Whisper-large-v3, allowing hands-free responses.
* **Semantic Analysis & Clustering:** Automated TF-IDF vectorization and K-Means clustering organize text responses into distinct thematic cohorts, mapped dynamically in vector space.
* **Synthetic Cohort Querying:** Interactive roleplay engine simulating aggregate feedback. Researchers can chat directly with AI representatives of specific user cohorts.
* **Outbound Webhooks:** Real-time push integration allowing completed survey sessions and transcripts to be securely dispatched to external endpoints with HMAC SHA-256 signatures.
* **Inline SDK Widget:** A lightweight, dependency-free JS SDK (`formpulse-widget.js`) to seamlessly embed the conversational surveyor inside external web applications via a sleek floating action button.
* **Secure Multi-Tenancy:** Secure authentication utilizing Supabase Auth (OAuth / Google) with robust token validation supporting both symmetric HS256 and asymmetric ES256 JWKS verification schemes.
* **SQLite Fallback Sandbox:** Local, zero-config sqlite execution mode for offline sandbox testing.

## Architecture and Structure

The system is split into a React-based frontend single-page application and a high-performance Python FastAPI backend web service.

```
├── frontend/                   # React Single-Page Application
│   ├── src/
│   │   ├── App.jsx             # Authentication listener, routing, global state
│   │   ├── components/
│   │   │   ├── Dashboard.jsx   # Form directory, creation wizard, KPI metrics
│   │   │   ├── AIWorkspace.jsx # Interactive schema editor and AI refinement
│   │   │   ├── Analytics.jsx   # Canvas scatter plot, timelines, cohort chat
│   │   │   └── FormFiller.jsx  # Conversational respondent interface
│   │   └── lib/
│   │       └── supabaseClient.js
│   └── vercel.json             # Frontend rewrite routing rules
├── backend/                    # FastAPI Web Service
│   ├── main.py                 # API endpoints, JWT token verification, PickyAssist webhooks
│   ├── database.py             # SQLAlchemy models (PostgreSQL / SQLite)
│   ├── llm_provider.py         # LLM completion loops and Whisper transcription
│   ├── clustering.py           # ML-based response vectorization & clustering (scikit-learn)
│   ├── ocr_provider.py         # OCR.space API integration for extracting text from images
│   ├── whatsapp_provider.py    # PickyAssist WhatsApp Push API integration
│   └── render.yaml             # Render infrastructure deployment config
└── logo.png                    # Project logo asset
```

## Getting Started

### Prerequisites

* Python 3.11+
* Node.js 18+

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Initialize virtual environment:
   ```bash
   python -m venv venv
   venv\Scripts\activate  # On Windows
   # source venv/bin/activate  # On macOS/Linux
   ```
3. Install required packages:
   ```bash
   pip install -r requirements.txt
   ```
4. Copy the environment variables template and fill in your keys:
   ```bash
   cp .env.example .env
   ```
5. Launch the development server:
   ```bash
   uvicorn main:app --reload --port 8000
   ```

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the environment variables template and configure your Supabase instance:
   ```bash
   cp .env.example .env.local
   ```
4. Start the local development server:
   ```bash
   npm run dev
   ```
   *(The local Vite server runs on port 3000 to match the default redirect configuration)*

---

## Environment Configuration

### Backend Configuration (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | Yes | API access key for Groq LLM and Whisper |
| `SUPABASE_DATABASE_URL` | No | PostgreSQL connection string (falls back to local SQLite if omitted) |
| `SUPABASE_JWT_SECRET` | No | Base64-encoded secret key used for verifying symmetric HS256 tokens |
| `PICKY_ASSIST_TOKEN` | No | Token for Picky Assist WhatsApp Push API |
| `PICKY_ASSIST_APP_ID` | No | App ID for Picky Assist |
| `OCR_API_KEY` | No | API Key for OCR.space image parsing |

### Frontend Configuration (`frontend/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | No | Supabase API Endpoint URL (falls back to local sandbox mode if omitted) |
| `VITE_SUPABASE_ANON_KEY` | No | Supabase Anon API key |

---

## Production Deployment

### Frontend (Vercel)

Ensure that you add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to your Vercel Environment Variables. The frontend uses `frontend/vercel.json` to configure rewrite proxying of `/api/*` requests to your deployed backend.

### Backend (Render)

The backend is configured for automated builds on Render via `backend/render.yaml`.
Make sure the following variables are configured in the Render Dashboard under Environment Settings:
* `SUPABASE_DATABASE_URL`
* `SUPABASE_JWT_SECRET`
* `GROQ_API_KEY`
* `PICKY_ASSIST_TOKEN`
* `PICKY_ASSIST_APP_ID`

---

## Security & Multi-Tenancy

FormPulse secures creator data using row-level filters matching the verified identity token (`sub` claim) from Supabase. The FastAPI backend verifies the integrity of these JWTs dynamically:
* **Asymmetric Tokens (ES256):** Fetches the project-specific public key from the Supabase JSON Web Key Set (JWKS) endpoints to verify asymmetric signatures.
* **Symmetric Tokens (HS256):** Verifies the signature using the configured `SUPABASE_JWT_SECRET` (supporting both raw and base64-encoded formats).

---

## License

MIT
