# FormPulse — Conversations That Collect

AI-powered conversational forms that replace boring surveys with natural dialogues. Real-time sentiment analytics, voice transcription, fatigue detection, and semantic clustering.

**Stack:** React · FastAPI · Groq LLM · Supabase · Scikit-learn

---

## Features

- 🤖 **AI Form Generation** — Describe your survey in plain English, get a full conversational form
- 💬 **Natural Dialogue Engine** — Respondents chat instead of filling fields
- 🎙️ **Voice Transcription** — Groq Whisper-powered voice input
- 📊 **Real-time Analytics** — Sentiment analysis, semantic clustering, response trends
- 🧠 **Synthetic Cohort Chat** — Talk to AI personas representing your respondent groups
- 🔐 **Google OAuth** — Supabase Auth with multi-tenant data isolation
- 😓 **Fatigue Detection** — Auto-completes surveys when respondents tire out

## Project Structure

```
├── frontend/          # React + Vite SPA
│   ├── src/
│   │   ├── App.jsx              # Auth flow, routing, layout
│   │   ├── components/
│   │   │   ├── Dashboard.jsx    # Form management + KPI cards
│   │   │   ├── AIWorkspace.jsx  # Form editor + AI refinement
│   │   │   ├── Analytics.jsx    # Charts, clusters, cohort chat
│   │   │   └── FormFiller.jsx   # Respondent chat interface
│   │   └── lib/
│   │       └── supabaseClient.js
│   └── .env.example
├── backend/           # FastAPI + SQLAlchemy
│   ├── main.py        # API endpoints
│   ├── database.py    # Supabase PostgreSQL / SQLite fallback
│   ├── llm_provider.py # Groq LLM integration
│   ├── clustering.py  # TF-IDF + K-Means response clustering
│   └── .env.example
└── vercel.json        # Frontend deployment config
```

## Local Development

### Backend
```bash
cd backend
python -m venv .venv
.venv/Scripts/activate  # Windows
pip install -r requirements.txt
cp .env.example .env    # Add your GROQ_API_KEY
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env    # Add Supabase keys (optional)
npm run dev
```

## Environment Variables

### Backend (`backend/.env`)
| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | Yes | Groq API key for LLM + Whisper |
| `SUPABASE_DATABASE_URL` | No | PostgreSQL connection string (falls back to SQLite) |
| `SUPABASE_JWT_SECRET` | No | For validating auth tokens |

### Frontend (`frontend/.env`)
| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | No | Supabase project URL (skip for sandbox mode) |
| `VITE_SUPABASE_ANON_KEY` | No | Supabase anon key |

## Deployment

- **Frontend** → Vercel (auto-deploys from GitHub)
- **Backend** → Render (uses `render.yaml`)

## License

MIT
