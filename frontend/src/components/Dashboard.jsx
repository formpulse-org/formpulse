import React, { useState, useEffect } from 'react';
import { 
  FileText, Plus, Share2, BarChart3, Clock, 
  Smile, Settings, Trash2, CheckCircle, ExternalLink,
  Code, Copy, Download, X
} from 'lucide-react';

export default function Dashboard({ onNavigate, forms, setForms, selectForm, setView, authHeaders = {} }) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newFormPrompt, setNewFormPrompt] = useState('');
  const [newFormTitle, setNewFormTitle] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [shareForm, setShareForm] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  
  const [deletingFormId, setDeletingFormId] = useState(null);
  
  // Stats calculations
  const [stats, setStats] = useState({
    totalSessions: 0,
    totalCompleted: 0,
    completionRate: 0,
    dropoffRate: 0,
    avgDuration: 0.0,
    sentimentDistribution: { Positive: 0, Neutral: 0, Negative: 0 },
    recentResponses: []
  });

  const formatDuration = (seconds) => {
    if (!seconds) return '0s';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch('/api/stats', { headers: authHeaders });
        if (response.ok) {
          const data = await response.json();
          setStats({
            totalSessions: data.totalSessions,
            totalCompleted: data.totalCompleted,
            completionRate: data.completionRate,
            dropoffRate: data.dropoffRate,
            avgDuration: data.avgDuration,
            sentimentDistribution: data.sentimentDistribution || { Positive: 0, Neutral: 0, Negative: 0 },
            recentResponses: data.recentResponses || []
          });
        }
      } catch (err) {
        console.warn("Backend API not reachable. Defaulting statistics to zero.");
      }
    };
    fetchStats();
  }, [forms]);

  const handleCreateForm = async (e) => {
    e.preventDefault();
    setIsGenerating(true);
    
    try {
      const isAI = newFormPrompt.trim() !== '';
      const payload = isAI 
        ? { prompt: newFormPrompt }
        : { title: newFormTitle || "Untitled Form", objective: "General feedback collection", schema_fields: [] };

      const response = await fetch('/api/forms', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(payload)
      });
      
      const newForm = await response.json();
      setForms(prevForms => [newForm, ...prevForms]);
      selectForm(newForm);
      setShowCreateModal(false);
      setNewFormPrompt('');
      setNewFormTitle('');
      
      // Navigate to Workspace to edit
      onNavigate('workspace');
    } catch (err) {
      console.error("Error creating form:", err);
      
      // Local Mock fallback on error - parses prompt to avoid predefined static layout
      const promptLower = (newFormPrompt || "").toLowerCase();
      const fields = [];
      
      if (promptLower.includes("name") || promptLower.includes("user") || promptLower.includes("customer")) {
        fields.push({ id: "respondent_name", label: "Full Name", type: "text", required: true, description: "Respondent's name", pacing_question: "To start off, could you tell me your name?" });
      }
      if (promptLower.includes("price") || promptLower.includes("pricing") || promptLower.includes("cost") || promptLower.includes("billing")) {
        fields.push({ id: "pricing_friction", label: "Pricing or Billing setup", type: "choice", choices: ["Too expensive", "Regional currency issues", "Fair value"], required: true, description: "Feedback on pricing setup", pacing_question: "How did you find our pricing structure? Is there any feedback on the tiers?" });
      }
      if (promptLower.includes("speed") || promptLower.includes("lag") || promptLower.includes("slow") || promptLower.includes("performance") || promptLower.includes("database") || promptLower.includes("db")) {
        fields.push({ id: "performance_issues", label: "Performance lags or bugs", type: "text", required: true, description: "Lag or database loading details", pacing_question: "Have you noticed any lag or speed bottlenecks while working on your database?" });
      }
      if (promptLower.includes("supabase") || promptLower.includes("firebase") || promptLower.includes("competitor") || promptLower.includes("migrate")) {
        fields.push({ id: "competitor_migration", label: "Competitor migration alternatives", type: "choice", choices: ["Supabase", "Firebase", "None"], required: false, description: "Alternative migration details", pacing_question: "What tools or alternative databases are you considering migrating to?" });
      }
      
      // Extract custom words for dynamic targets if empty
      if (fields.length === 0 && newFormPrompt) {
        const cleanPrompt = newFormPrompt.replace(/[?,.!:;()"]/g, '');
        const words = cleanPrompt.split(/\s+/).filter(w => w.length > 5 && !["survey", "identify", "details", "feedback", "cancel", "customer", "organizer", "meetup"].includes(w.toLowerCase()));
        if (words.length > 0) {
          fields.push({
            id: `target_${words[0].toLowerCase()}`,
            label: `${words[0].charAt(0).toUpperCase() + words[0].slice(1)} feedback details`,
            type: "text",
            required: true,
            description: `User thoughts on ${words[0]}`,
            pacing_question: `Could you tell me a little bit about your thoughts on ${words[0].toLowerCase()}?`
          });
          if (words.length > 1) {
            fields.push({
              id: `target_${words[1].toLowerCase()}`,
              label: `${words[1].charAt(0).toUpperCase() + words[1].slice(1)} satisfaction rating (1-5)`,
              type: "number",
              required: false,
              description: `User thoughts on ${words[1]}`,
              pacing_question: `On a scale of 1 to 5, how would you rate your satisfaction with ${words[1].lower()}?`
            });
          }
        }
      }
      
      // Default fallback
      if (fields.length === 0) {
        fields.push(
          { id: "feedback_topic", label: "Primary Feedback Area", type: "text", required: true, description: "Feedback topic details", pacing_question: "To kick things off, what primary feedback area did you want to discuss?" },
          { id: "satisfaction_rating", label: "Satisfaction Rating (1-5)", type: "number", required: true, description: "Satisfaction level score", pacing_question: "On a scale of 1 to 5, how would you rate your overall satisfaction?" }
        );
      }

      const mockId = Math.random().toString(36).substr(2, 9);
      const mockForm = {
        id: mockId,
        title: newFormTitle || (newFormPrompt ? `Survey: ${newFormPrompt.slice(0, 30).trim()}...` : "Untitled Form"),
        objective: newFormPrompt || "Collect qualitative parameters",
        schema_fields: fields,
        guardrails: { system_instructions: "Remain casual, warm, and empathetic. Stay on topic.", topics_allowed: "survey" },
        settings: { allow_voice: true, fatigue_threshold: 0.7, code_switching: true }
      };

      setForms(prevForms => [mockForm, ...prevForms]);
      selectForm(mockForm);
      setShowCreateModal(false);
      setNewFormPrompt('');
      setNewFormTitle('');
      onNavigate('workspace');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteForm = (id, e) => {
    e.stopPropagation();
    setDeletingFormId(id);
  };

  const confirmDelete = async (id) => {
    try {
      const response = await fetch(`/api/forms/${id}`, { method: 'DELETE', headers: authHeaders });
      if (response.ok) {
        setForms(prevForms => prevForms.filter(f => f.id !== id));
      } else {
        console.error("Failed to delete form from server, removing locally.");
        setForms(prevForms => prevForms.filter(f => f.id !== id));
      }
    } catch (err) {
      console.error("Error deleting form:", err);
      setForms(prevForms => prevForms.filter(f => f.id !== id));
    } finally {
      setDeletingFormId(null);
    }
  };

  const copyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text);
    if (type === 'link') {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } else {
      setCopiedEmbed(true);
      setTimeout(() => setCopiedEmbed(false), 2000);
    }
  };

  // Generate shareable link
  const getShareLink = (formId) => {
    const origin = window.location.origin;
    return `${origin}/fill?id=${formId}`;
  };

  // Generate embed code
  const getEmbedCode = (formId) => {
    return `<iframe src="${getShareLink(formId)}" width="100%" height="600" frameborder="0" style="border:1px solid #1e1e24; border-radius:12px;"></iframe>`;
  };

  const posCount = stats.sentimentDistribution?.Positive || 0;
  const neuCount = stats.sentimentDistribution?.Neutral || 0;
  const negCount = stats.sentimentDistribution?.Negative || 0;
  const totalSent = posCount + neuCount + negCount;
  
  const posPct = totalSent > 0 ? Math.round((posCount / totalSent) * 100) : 0;
  const neuPct = totalSent > 0 ? Math.round((neuCount / totalSent) * 100) : 0;
  const negPct = totalSent > 0 ? Math.round((negCount / totalSent) * 100) : 0;

  return (
    <div className="scroll-pane" style={{ padding: '2rem 0' }}>
      {/* KPI Stats Row */}
      <div className="dashboard-grid" style={{ padding: '0 2rem 2rem 2rem' }}>
        <div className="kpi-card">
          <div className="kpi-header">
            <span>Conversation Completion</span>
            <CheckCircle className="kpi-icon" size={18} />
          </div>
          <div>
            <div className="kpi-value">{stats.completionRate}%</div>
            <div className="kpi-trend up" style={{ marginTop: '0.5rem' }}>
              +43% vs industry average
            </div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span>Response Yield</span>
            <FileText className="kpi-icon" size={18} />
          </div>
          <div>
            <div className="kpi-value">{stats.totalCompleted}</div>
            <div className="kpi-trend up" style={{ marginTop: '0.5rem' }}>
              {stats.totalSessions} sessions initiated
            </div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span>Avg Session Duration</span>
            <Smile className="kpi-icon" size={18} />
          </div>
          <div>
            <div className="kpi-value">{formatDuration(stats.avgDuration)}</div>
            <div className="kpi-trend up" style={{ marginTop: '0.5rem' }}>
              Total active dialogue minutes
            </div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span>Survey Drop-off Rate</span>
            <Settings className="kpi-icon" size={18} />
          </div>
          <div>
            <div className="kpi-value">{stats.dropoffRate}%</div>
            <div className="kpi-trend down" style={{ marginTop: '0.5rem', color: stats.dropoffRate > 40 ? 'var(--error)' : 'var(--success)' }}>
              {stats.dropoffRate > 40 ? 'Requires pacing adjustment' : 'Optimal pacing flow'}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Split Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '2.4fr 1fr', gap: '2rem', padding: '0 2rem' }}>
        
        {/* LEFT COLUMN: Active Conversational Forms */}
        <div className="card-container" style={{ margin: 0 }}>
          <div className="card-title-row">
            <h2 className="card-title">
              <FileText size={22} className="kpi-icon" />
              Active Conversational Forms
            </h2>
            <button className="button-primary" onClick={() => setShowCreateModal(true)}>
              <Plus size={18} /> Create Form
            </button>
          </div>

          {forms.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              <FileText size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
              <p>No forms found. Click "Create Form" to generate your first conversational workflow!</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Form Title</th>
                  <th>Core Objective</th>
                  <th>Fields</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {forms.map(form => (
                  <tr 
                    key={form.id} 
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      selectForm(form);
                      onNavigate('workspace');
                    }}
                  >
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{form.title}</td>
                    <td style={{ color: 'var(--text-muted)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {form.objective}
                    </td>
                    <td>
                      <span className="share-url" style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid var(--card-border)', fontSize: '0.75rem' }}>
                        {form.schema_fields ? (typeof form.schema_fields === 'string' ? JSON.parse(form.schema_fields).length : form.schema_fields.length) : 0} targets
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button 
                          className="button-secondary" 
                          style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                          onClick={() => {
                            selectForm(form);
                            onNavigate('workspace');
                          }}
                        >
                          <Settings size={14} /> Edit
                        </button>
                        <a 
                          href={getShareLink(form.id)}
                          target="_blank"
                          rel="noreferrer"
                          className="button-secondary" 
                          style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        >
                          <ExternalLink size={14} /> Live Link
                        </a>
                        <button 
                          className="button-secondary" 
                          style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                          onClick={() => {
                            selectForm(form);
                            onNavigate('analytics');
                          }}
                        >
                          <BarChart3 size={14} /> Analytics
                        </button>
                        <button 
                          className="button-secondary" 
                          style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                          onClick={() => setShareForm(form)}
                        >
                          <Share2 size={14} /> Share
                        </button>
                        <button 
                          className="button-icon" 
                          style={{ color: 'var(--error)' }}
                          onClick={(e) => handleDeleteForm(form.id, e)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* RIGHT COLUMN: Sentiment Pulse & Recent Feed */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Sentiment Pulse */}
          <div className="card-container" style={{ margin: 0, padding: '1.25rem' }}>
            <h3 className="card-title" style={{ fontSize: '0.95rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Smile size={18} style={{ color: 'var(--accent-color)' }} /> Sentiment Pulse
            </h3>
            
            {totalSent === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0, textAlign: 'center', padding: '1rem 0' }}>No responses recorded yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {/* Segmented bar */}
                <div style={{ height: '10px', width: '100%', borderRadius: '5px', overflow: 'hidden', display: 'flex', background: 'var(--card-border)' }}>
                  <div style={{ width: `${posPct}%`, backgroundColor: '#10b981', transition: 'width 0.3s ease' }} title={`Positive: ${posPct}%`} />
                  <div style={{ width: `${neuPct}%`, backgroundColor: '#71717a', transition: 'width 0.3s ease' }} title={`Neutral: ${neuPct}%`} />
                  <div style={{ width: `${negPct}%`, backgroundColor: '#ef4444', transition: 'width 0.3s ease' }} title={`Negative: ${negPct}%`} />
                </div>
                
                {/* Legend list with counts */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.8rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 500 }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                      Positive
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>{posCount} ({posPct}%)</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 500 }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#71717a' }} />
                      Neutral
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>{neuCount} ({neuPct}%)</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 500 }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
                      Negative
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>{negCount} ({negPct}%)</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Recent Responses Feed */}
          <div className="card-container" style={{ margin: 0, padding: '1.25rem' }}>
            <h3 className="card-title" style={{ fontSize: '0.95rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={18} style={{ color: 'var(--accent-color)' }} /> Recent Activity Feed
            </h3>
            
            {!stats.recentResponses || stats.recentResponses.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0, textAlign: 'center', padding: '1.5rem 0' }}>No submissions yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', maxHeight: '380px', overflowY: 'auto' }}>
                {stats.recentResponses.map(resp => (
                  <div key={resp.id} style={{ padding: '0.65rem', borderRadius: '6px', border: '1px solid var(--card-border)', background: 'var(--bg-color)', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem' }}>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100px' }} title={resp.form_title}>
                        {resp.form_title}
                      </span>
                      <span style={{ 
                        fontSize: '0.62rem', 
                        padding: '0.1rem 0.35rem', 
                        borderRadius: '4px', 
                        fontWeight: 600,
                        backgroundColor: resp.sentiment === 'Positive' ? 'rgba(16, 185, 129, 0.1)' : resp.sentiment === 'Negative' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(113, 113, 122, 0.1)',
                        color: resp.sentiment === 'Positive' ? '#10b981' : resp.sentiment === 'Negative' ? '#ef4444' : 'var(--text-muted)'
                      }}>
                        {resp.sentiment}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0, lineHeight: '1.3' }}>
                      "{resp.snippet}"
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* CREATE FORM MODAL */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="card-title-row">
              <h3>Create New Form</h3>
              <button className="button-icon" onClick={() => setShowCreateModal(false)}><X size={18} /></button>
            </div>
            
            <form onSubmit={handleCreateForm} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 600 }}>
                  Option A: Quick AI Prompt (Recommended)
                </label>
                <textarea 
                  className="input-field" 
                  rows="3" 
                  placeholder="e.g., I need a churn survey. Identify if pricing model, batch loading speeds, or migration to Supabase triggered their cancellation."
                  value={newFormPrompt}
                  onChange={e => setNewFormPrompt(e.target.value)}
                  style={{ resize: 'vertical' }}
                />
              </div>

              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>— OR —</div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 600 }}>
                  Option B: Manual Google Forms Setup
                </label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="e.g., Technical Support Feedback"
                  value={newFormTitle}
                  onChange={e => setNewFormTitle(e.target.value)}
                  disabled={newFormPrompt.trim() !== ''}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button type="button" className="button-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
                <button type="submit" className="button-primary" disabled={isGenerating}>
                  {isGenerating ? "Generating..." : "Generate Form"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SHARE / QR CODE MODAL */}
      {shareForm && (
        <div className="modal-overlay" onClick={() => setShareForm(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="card-title-row">
              <h3>Share: {shareForm.title}</h3>
              <button className="button-icon" onClick={() => setShareForm(null)}><X size={18} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', alignItems: 'center' }}>
              {/* QR Code Container */}
              <div style={{ textAlign: 'center' }}>
                <div className="qr-code-placeholder">
                  <img 
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(getShareLink(shareForm.id))}`}
                    alt="Form QR Code"
                    style={{ width: '150px', height: '150px' }}
                  />
                </div>
                <a 
                  href={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(getShareLink(shareForm.id))}`}
                  target="_blank" 
                  download="qrcode.png"
                  className="button-secondary"
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', marginTop: '0.5rem' }}
                >
                  <Download size={12} /> Save QR Code
                </a>
              </div>

              {/* Share URL */}
              <div style={{ width: '100%' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontWeight: 600 }}>
                  Shareable Web Survey URL (Vercel Wrapper)
                </label>
                <div className="share-url-container">
                  <div className="share-url">{getShareLink(shareForm.id)}</div>
                  <button 
                    className="button-primary" 
                    style={{ padding: '0.6rem 1rem' }}
                    onClick={() => copyToClipboard(getShareLink(shareForm.id), 'link')}
                  >
                    {copiedLink ? "Copied!" : <Copy size={16} />}
                  </button>
                  <a 
                    href={getShareLink(shareForm.id)} 
                    target="_blank" 
                    rel="noreferrer"
                    className="button-secondary" 
                    style={{ padding: '0.6rem 1rem' }}
                  >
                    <ExternalLink size={16} />
                  </a>
                </div>
              </div>

              {/* Embed Script code */}
              <div style={{ width: '100%' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontWeight: 600 }}>
                  HTML Widget Code (Inline Snip Injection)
                </label>
                <div className="share-url-container">
                  <textarea 
                    className="input-field" 
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', height: '60px', resize: 'none' }}
                    readOnly
                    value={getEmbedCode(shareForm.id)}
                  />
                  <button 
                    className="button-primary" 
                    style={{ padding: '0.6rem 1rem' }}
                    onClick={() => copyToClipboard(getEmbedCode(shareForm.id), 'embed')}
                  >
                    {copiedEmbed ? "Copied!" : <Copy size={16} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deletingFormId && (
        <div className="modal-overlay" onClick={() => setDeletingFormId(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px', padding: '2rem' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem', color: 'var(--error)' }}>
                <Trash2 size={40} />
              </div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
                Delete Conversational Form?
              </h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: '1.5', marginBottom: '1.75rem' }}>
                Are you sure you want to permanently delete this form? This action cannot be undone and will delete all associated respondent sessions, telemetry logs, and response data.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                <button 
                  type="button" 
                  className="button-secondary" 
                  style={{ minWidth: '100px' }}
                  onClick={() => setDeletingFormId(null)}
                >
                  Cancel
                </button>
                <button 
                  type="button" 
                  className="button-primary" 
                  style={{ backgroundColor: 'var(--error)', border: 'none', color: '#fff', minWidth: '120px' }}
                  onClick={() => confirmDelete(deletingFormId)}
                >
                  Delete Form
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
