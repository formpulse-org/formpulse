import React, { useState, useEffect, useCallback } from 'react';
import { 
  Layers, LayoutDashboard, Settings, 
  BarChart3, Sun, Moon, AlertTriangle, LogOut, Database, ChevronRight
} from 'lucide-react';

import Dashboard from './components/Dashboard';
import AIWorkspace from './components/AIWorkspace';
import Analytics from './components/Analytics';
import FormFiller from './components/FormFiller';
import { supabase, isSupabaseConfigured } from './lib/supabaseClient';

export default function App() {
  const [view, setView] = useState('dashboard');
  const [forms, setForms] = useState([]);
  const [activeForm, setActiveForm] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [apiHealthy, setApiHealthy] = useState(false);
  const [isRespondent, setIsRespondent] = useState(false);
  const [respondentFormId, setRespondentFormId] = useState(null);

  // Auth state
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dbMode, setDbMode] = useState(null); // 'Supabase PostgreSQL' | 'SQLite Fallback' | null

  // ----- Auth Helpers -----
  const getAuthHeaders = useCallback(() => {
    const headers = { 'Content-Type': 'application/json' };
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
    return headers;
  }, [session]);

  // ----- Supabase Auth Listener -----
  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) {
      // No Supabase configured → run in sandbox mode (no login required)
      setAuthLoading(false);
      setSession(null);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setAuthLoading(false);
    });

    // Listen for auth changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, s) => {
        setSession(s);
        setAuthLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // ----- Theme -----
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // ----- URL parsing for respondent fill links -----
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fillPath = window.location.pathname;
    const id = params.get('id');
    if (id && (fillPath === '/fill' || fillPath.startsWith('/fill'))) {
      setIsRespondent(true);
      setRespondentFormId(id);
    }
  }, []);

  // ----- Health Check (DB mode indicator) -----
  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(data => {
        setDbMode(data.database_mode || null);
        setApiHealthy(true);
      })
      .catch(() => {
        setApiHealthy(false);
        setDbMode(null);
      });
  }, [session]);

  // ----- Fetch forms -----
  const fetchForms = useCallback(async () => {
    try {
      const res = await fetch('/api/forms', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setForms(data);
        setApiHealthy(true);
        if (data.length > 0 && !activeForm) {
          setActiveForm(data[0]);
        }
      } else if (res.status === 401) {
        // Token expired or invalid
        setForms([]);
      }
    } catch (err) {
      console.warn("Backend not active, loading Sandbox mode.");
      setApiHealthy(false);
      
      const defaultForms = [
        {
          id: "meetup-feedback",
          title: "Tech Meetup Organizer Survey",
          objective: "Identify attendee feedback. Check for food quality, speaker engagement, and venue accessibility friction.",
          schema_fields: [
            { id: "name", label: "Full Name", type: "text", required: true, description: "Name of respondent" },
            { id: "speaker_rating", label: "Speaker rating (1-5)", type: "number", required: true, description: "Rating score" },
            { id: "food_feedback", label: "Food Quality notes", type: "text", required: false, description: "Any dietary issue/taste details" },
            { id: "venue_friction", label: "Venue Accessibility bottlenecks", type: "text", required: false, description: "Parking or entrance complaints" }
          ],
          guardrails: {
            system_instructions: "Stay friendly. Do not prompt answers. Be objective.",
            topics_allowed: "meetup, speakers, food, location"
          },
          settings: { allow_voice: true, fatigue_threshold: 0.7, code_switching: true }
        },
        {
          id: "saas-cancel",
          title: "FormPulse Churn Analysis Survey",
          objective: "Determine why subscribers canceled. Identify pricing tiers feedback, batch loading bottlenecks, or Supabase migration.",
          schema_fields: [
            { id: "price_issue", label: "Pricing friction details", type: "choice", choices: ["Too expensive", "Regional currency issues", "Fair value"], required: true, description: "Pricing model concerns" },
            { id: "sync_bottlenecks", label: "Database syncing speed lag", type: "text", required: true, description: "Detail query lag sizes" },
            { id: "migrated_competitor", label: "Supabase or alternative migration", type: "choice", choices: ["Migrated to Supabase", "Migrated to Firebase", "No migration"], required: false, description: "Competitor migration info" }
          ],
          guardrails: {
            system_instructions: "Be neutral. Prevent pitch details. Avoid conversational bias.",
            topics_allowed: "billing, pricing, database, supabse, speed, lag"
          },
          settings: { allow_voice: true, fatigue_threshold: 0.65, code_switching: true }
        }
      ];
      setForms(defaultForms);
      setActiveForm(defaultForms[0]);
    }
  }, [getAuthHeaders, activeForm]);

  useEffect(() => {
    // Only fetch forms when auth is resolved
    if (!authLoading) {
      // If Supabase is configured, wait for session. If not configured, just fetch.
      if (isSupabaseConfigured()) {
        if (session) fetchForms();
      } else {
        fetchForms();
      }
    }
  }, [authLoading, session, fetchForms]);

  const toggleTheme = () => setDarkMode(!darkMode);

  // ----- Auth Actions -----
  const handleGoogleSignIn = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) console.error('Google Sign-In error:', error.message);
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setForms([]);
    setActiveForm(null);
    setView('dashboard');
  };

  // ----- Loading Screen -----
  if (authLoading) {
    return (
      <div style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)',
        color: '#fff',
        fontFamily: "'Inter', 'Segoe UI', sans-serif"
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 48, height: 48,
            border: '3px solid rgba(139, 92, 246, 0.2)',
            borderTopColor: '#8b5cf6',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 1rem'
          }} />
          <p style={{ opacity: 0.7, fontSize: '0.9rem' }}>Initializing FormPulse…</p>
        </div>
      </div>
    );
  }

  // ----- Respondent Survey View -----
  if (isRespondent && respondentFormId) {
    return (
      <div style={{ height: '100vh', width: '100vw', backgroundColor: 'var(--bg-color)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ width: '100%', maxWidth: '600px', height: '100%', borderLeft: '1px solid var(--card-border)', borderRight: '1px solid var(--card-border)', background: 'var(--card-bg)' }}>
          <FormFiller formId={respondentFormId} standalone={true} />
        </div>
      </div>
    );
  }

  // ----- Login Landing Page (only when Supabase IS configured and no session) -----
  if (isSupabaseConfigured() && !session) {
    return (
      <div className="login-landing">
        <div className="login-bg-grid" />
        
        {/* Floating orbs */}
        <div className="login-orb login-orb-1" />
        <div className="login-orb login-orb-2" />
        <div className="login-orb login-orb-3" />

        <div className="login-card">
          <div className="login-logo">
            <div className="login-logo-icon">
              <Layers size={28} />
            </div>
            <h1 className="login-title">FormPulse</h1>
            <p className="login-subtitle">Conversations That Collect</p>
          </div>

          <div className="login-features">
            <div className="login-feature-item">
              <ChevronRight size={14} style={{ color: '#8b5cf6', flexShrink: 0 }} />
              <span>AI-powered conversational surveys</span>
            </div>
            <div className="login-feature-item">
              <ChevronRight size={14} style={{ color: '#8b5cf6', flexShrink: 0 }} />
              <span>Real-time sentiment & cluster analytics</span>
            </div>
            <div className="login-feature-item">
              <ChevronRight size={14} style={{ color: '#8b5cf6', flexShrink: 0 }} />
              <span>Voice transcription & fatigue detection</span>
            </div>
          </div>

          <button
            className="google-sign-in-btn"
            onClick={handleGoogleSignIn}
          >
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <span>Sign in with Google</span>
          </button>

          <p className="login-disclaimer">
            By signing in, you agree to our Terms of Service. Your data stays secure with Supabase.
          </p>
        </div>

        <div className="login-footer">
          <span>Built with</span>
          <Layers size={14} style={{ color: '#8b5cf6' }} />
          <span>FormPulse &middot; Groq &middot; Supabase</span>
        </div>
      </div>
    );
  }

  // ----- Creator SaaS View -----
  return (
    <div className="app-container">
      {/* SQLite Fallback Banner */}
      {apiHealthy && dbMode === 'SQLite Fallback' && (
        <div className="db-fallback-banner">
          <Database size={14} />
          <span>Running on local SQLite — connect Supabase for persistent multi-tenant storage</span>
        </div>
      )}

      {/* Header Navigation */}
      <header className="header-bar">
        <div className="header-logo" style={{ cursor: 'pointer' }} onClick={() => setView('dashboard')}>
          <div className="logo-badge">
            <Layers size={18} />
          </div>
          <span>FormPulse</span>
        </div>

        {/* Global Creator navigation tabs */}
        <nav className="nav-links">
          <button 
            className={`nav-link ${view === 'dashboard' ? 'active' : ''}`}
            onClick={() => setView('dashboard')}
          >
            <LayoutDashboard size={16} /> Dashboard
          </button>
          
          <button 
            className={`nav-link ${view === 'analytics' ? 'active' : ''}`}
            onClick={() => {
              setActiveForm(null);
              setView('analytics');
            }}
          >
            <BarChart3 size={16} /> Analytics
          </button>
          
          {activeForm && (
            <button 
              className={`nav-link ${view === 'workspace' ? 'active' : ''}`}
              onClick={() => setView('workspace')}
            >
              <Settings size={16} /> Workspace Editor
            </button>
          )}
        </nav>

        {/* Action Panel */}
        <div className="header-actions">
          {!apiHealthy && (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.35rem', 
              background: 'var(--warning-bg)', 
              color: 'var(--warning)', 
              padding: '0.4rem 0.8rem', 
              borderRadius: '6px',
              fontSize: '0.8rem',
              fontWeight: 600
            }}>
              <AlertTriangle size={14} />
              <span>Sandbox Offline Mode</span>
            </div>
          )}

          <button className="button-icon" onClick={toggleTheme}>
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* User Profile + Sign Out (only when Supabase auth is active) */}
          {session && isSupabaseConfigured() && (
            <div className="user-profile-chip">
              {session.user?.user_metadata?.avatar_url ? (
                <img 
                  src={session.user.user_metadata.avatar_url} 
                  alt="Profile" 
                  className="user-avatar"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="user-avatar-placeholder">
                  {(session.user?.user_metadata?.full_name || session.user?.email || 'U')[0].toUpperCase()}
                </div>
              )}
              <span className="user-name">
                {session.user?.user_metadata?.full_name || session.user?.email?.split('@')[0] || 'User'}
              </span>
              <button 
                className="sign-out-btn" 
                onClick={handleSignOut}
                title="Sign Out"
              >
                <LogOut size={15} />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* View router */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {view === 'dashboard' && (
          <Dashboard 
            onNavigate={setView} 
            forms={forms} 
            setForms={setForms}
            selectForm={setActiveForm}
            authHeaders={getAuthHeaders()}
          />
        )}
        {view === 'workspace' && activeForm && (
          <AIWorkspace 
            activeForm={activeForm} 
            selectForm={setActiveForm}
            onNavigate={setView}
            forms={forms}
            setForms={setForms}
            authHeaders={getAuthHeaders()}
          />
        )}

        {view === 'analytics' && (
          <Analytics 
            activeForm={activeForm} 
            selectForm={setActiveForm}
            onNavigate={setView}
            forms={forms}
            authHeaders={getAuthHeaders()}
          />
        )}
      </main>
    </div>
  );
}
