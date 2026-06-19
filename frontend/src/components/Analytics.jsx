import React, { useState, useEffect, useRef } from 'react';
import { 
  BarChart3, Brain, MessageSquare, AlertTriangle, 
  ArrowLeft, Users, RefreshCw, Send, ZoomIn, ZoomOut, Move, Activity,
  Download, ExternalLink, X
} from 'lucide-react';

// --- SUB-COMPONENT: High-Performance Canvas Scatter Plot ---
function CanvasScatterPlot({ points, clusters, getClusterColor, onHoverPoint, hoveredPoint }) {
  const canvasRef = useRef(null);
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Reset zoom and pan when points change (e.g. switching forms)
  useEffect(() => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  }, [points]);

  // Main drawing loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Support high-DPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rectWidth(canvas) * dpr;
    canvas.height = rectHeight(canvas) * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);
    ctx.save();

    // 1. Apply Pan and Zoom centered
    const centerX = rectWidth(canvas) / 2;
    const centerY = rectHeight(canvas) / 2;
    ctx.translate(centerX + pan.x, centerY + pan.y);
    ctx.scale(zoom, zoom);

    // 2. Draw Gridlines
    ctx.strokeStyle = 'rgba(228, 228, 231, 0.4)'; // Zinc border equivalent
    ctx.lineWidth = 0.5 / zoom;
    const gridSpacing = 40;
    const range = 400;
    for (let x = -range; x <= range; x += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, -range);
      ctx.lineTo(x, range);
      ctx.stroke();
    }
    for (let y = -range; y <= range; y += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(-range, y);
      ctx.lineTo(range, y);
      ctx.stroke();
    }

    // 3. Draw Main Axes
    ctx.strokeStyle = 'rgba(113, 113, 122, 0.3)';
    ctx.lineWidth = 1.0 / zoom;
    ctx.beginPath();
    ctx.moveTo(-range, 0);
    ctx.lineTo(range, 0);
    ctx.moveTo(0, -range);
    ctx.lineTo(0, range);
    ctx.stroke();

    // 4. Draw cluster background radial glow centers
    clusters.forEach(c => {
      // Find centroid of cluster
      const cPoints = points.filter(p => p.cluster === c.id);
      if (cPoints.length === 0) return;
      const avgX = cPoints.reduce((sum, p) => sum + p.x, 0) / cPoints.length;
      const avgY = cPoints.reduce((sum, p) => sum + p.y, 0) / cPoints.length;

      const px = avgX * 35;
      const py = avgY * -35;

      const radGrad = ctx.createRadialGradient(px, py, 5, px, py, 60);
      const col = getClusterColor(c.id);
      
      // Convert hex to rgba for transparent gradient glow
      const r = parseInt(col.substring(1, 3), 16);
      const g = parseInt(col.substring(3, 5), 16);
      const b = parseInt(col.substring(5, 7), 16);

      radGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.12)`);
      radGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      
      ctx.beginPath();
      ctx.arc(px, py, 60, 0, Math.PI * 2);
      ctx.fillStyle = radGrad;
      ctx.fill();
    });

    // 5. Draw Individual Vector Points
    points.forEach(p => {
      const px = p.x * 35;
      const py = p.y * -35;
      const isHovered = hoveredPoint && hoveredPoint.id === p.id;

      // Draw point circle
      ctx.beginPath();
      ctx.arc(px, py, (isHovered ? 8 : 5) / zoom, 0, Math.PI * 2);
      ctx.fillStyle = getClusterColor(p.cluster);
      ctx.fill();

      // Outline
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = (isHovered ? 2 : 1) / zoom;
      ctx.stroke();

      // Aura on hover
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(px, py, 14 / zoom, 0, Math.PI * 2);
        ctx.strokeStyle = getClusterColor(p.cluster);
        ctx.lineWidth = 1 / zoom;
        ctx.stroke();
      }
    });

    ctx.restore();
  }, [points, clusters, zoom, pan, hoveredPoint]);

  const rectWidth = (c) => c.clientWidth || 500;
  const rectHeight = (c) => c.clientHeight || 360;

  // Transform page coordinates to coordinate system of canvas
  const getTransformedMouse = (clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const w = rectWidth(canvas);
    const h = rectHeight(canvas);
    return {
      x: (x - w / 2 - pan.x) / zoom,
      y: (y - h / 2 - pan.y) / zoom
    };
  };

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
      return;
    }

    // Hover check
    const mouse = getTransformedMouse(e.clientX, e.clientY);
    let closestPoint = null;
    let minDistance = 15; // screen pixels threshold

    points.forEach(p => {
      const px = p.x * 35;
      const py = p.y * -35;
      const dx = mouse.x - px;
      const dy = mouse.y - py;
      const dist = Math.sqrt(dx * dx + dy * dy) * zoom;

      if (dist < minDistance) {
        minDistance = dist;
        closestPoint = p;
      }
    });

    onHoverPoint(closestPoint);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const zoomFactor = 1.1;
    const nextZoom = e.deltaY < 0 ? zoom * zoomFactor : zoom / zoomFactor;
    setZoom(Math.max(0.5, Math.min(5.0, nextZoom)));
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '360px', background: 'var(--bg-color)', borderRadius: '8px', border: '1px solid var(--card-border)', overflow: 'hidden' }}>
      <canvas 
        ref={canvasRef}
        style={{ width: '100%', height: '100%', cursor: isDragging ? 'grabbing' : 'grab', display: 'block' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
      
      {/* Zoom and Pan Toolbar Controls */}
      <div style={{ position: 'absolute', bottom: '10px', right: '10px', display: 'flex', gap: '0.25rem', background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '6px', padding: '0.25rem', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
        <button className="button-icon" style={{ width: '28px', height: '28px' }} onClick={() => setZoom(z => Math.min(5.0, z * 1.2))} title="Zoom In">
          <ZoomIn size={14} />
        </button>
        <button className="button-icon" style={{ width: '28px', height: '28px' }} onClick={() => setZoom(z => Math.max(0.5, z / 1.2))} title="Zoom Out">
          <ZoomOut size={14} />
        </button>
        <button className="button-icon" style={{ width: '28px', height: '28px' }} onClick={() => { setZoom(1.0); setPan({ x: 0, y: 0 }); }} title="Recenter View">
          <Move size={14} />
        </button>
      </div>
    </div>
  );
}

// --- SUB-COMPONENT: SVG Area-Gradient Trend Line Chart ---
function HistoricalTrendChart({ data }) {
  if (!data || data.length === 0) return null;

  const w = 500;
  const h = 140;
  const padding = { top: 20, right: 30, bottom: 25, left: 40 };

  const counts = data.map(d => d.count);
  const maxCount = Math.max(5, ...counts);

  const getX = (idx) => {
    if (data.length <= 1) return padding.left + (w - padding.left - padding.right) / 2;
    return padding.left + (idx / (data.length - 1)) * (w - padding.left - padding.right);
  };

  const getY = (val) => {
    return h - padding.bottom - (val / maxCount) * (h - padding.top - padding.bottom);
  };

  // Build points path
  const points = data.map((d, i) => `${getX(i)},${getY(d.count)}`).join(' ');
  const linePath = `M ${points}`;
  
  // Build area path (for gradient fill under the line)
  const areaPath = data.length > 0 
    ? `${linePath} L ${getX(data.length - 1)},${h - padding.bottom} L ${getX(0)},${h - padding.bottom} Z`
    : '';

  return (
    <div style={{ width: '100%', height: '160px', overflow: 'hidden' }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id="trendGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-color)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--accent-color)" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1.0].map((ratio, idx) => {
          const val = Math.round(maxCount * ratio);
          const y = getY(val);
          return (
            <g key={idx}>
              <line 
                x1={padding.left} 
                y1={y} 
                x2={w - padding.right} 
                y2={y} 
                stroke="var(--card-border)" 
                strokeWidth={0.5} 
                strokeDasharray="4 4"
              />
              <text 
                x={padding.left - 10} 
                y={y + 4} 
                textAnchor="end" 
                fontSize="10" 
                fill="var(--text-muted)"
                fontFamily="var(--font-mono)"
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* X Axis dates */}
        {data.map((d, idx) => {
          // Display dates at start, middle, and end to avoid overlap
          if (data.length > 3 && idx !== 0 && idx !== data.length - 1 && idx !== Math.floor(data.length / 2)) return null;
          const x = getX(idx);
          // Format Date string: "2026-06-18" -> "Jun 18"
          let label = d.date;
          try {
            const dateObj = new Date(d.date);
            label = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          } catch(e){}

          return (
            <text 
              key={idx} 
              x={x} 
              y={h - 8} 
              textAnchor="middle" 
              fontSize="10" 
              fill="var(--text-muted)"
              fontFamily="var(--font-mono)"
            >
              {label}
            </text>
          );
        })}

        {/* Area under the trend line */}
        {areaPath && (
          <path d={areaPath} fill="url(#trendGlow)" />
        )}

        {/* Trend Line */}
        <path 
          d={linePath} 
          fill="none" 
          stroke="var(--accent-color)" 
          strokeWidth={2} 
          strokeLinecap="round" 
          strokeLinejoin="round" 
        />

        {/* Interactive Dots on points */}
        {data.map((d, i) => (
          <circle 
            key={i} 
            cx={getX(i)} 
            cy={getY(d.count)} 
            r={3.5} 
            fill="var(--card-bg)" 
            stroke="var(--accent-color)" 
            strokeWidth={1.5} 
          />
        ))}
      </svg>
    </div>
  );
}

// --- MAIN WRAPPER ANALYTICS PAGE ---
export default function Analytics({ activeForm, selectForm, onNavigate, forms, authHeaders = {} }) {
  const [loading, setLoading] = useState(true);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [activeSentimentTab, setActiveSentimentTab] = useState('All');
  const [expandedResponseId, setExpandedResponseId] = useState(null);
  
  // Lightbox view for image uploads
  const [lightboxUrl, setLightboxUrl] = useState(null);
  
  // Synthetic Cohort Chat state
  const [selectedCohort, setSelectedCohort] = useState(null);
  const [cohortMessages, setCohortMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState(null);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      if (activeForm) {
        const response = await fetch(`/api/forms/${activeForm.id}/analytics`, { headers: authHeaders });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setAnalyticsData(data);
        if (data.semantic_map?.clusters?.length > 0) {
          setSelectedCohort(data.semantic_map.clusters[0]);
          setCohortMessages([
            { role: 'assistant', content: `Hello! I represent the '${data.semantic_map.clusters[0].name}' user group. Go ahead and ask me any questions based on our experiences!` }
          ]);
        }
      } else {
        const response = await fetch('/api/stats', { headers: authHeaders });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setAnalyticsData(data);
      }
    } catch (err) {
      console.error("Error fetching analytics:", err);
      if (activeForm) {
        // Individual mock fallback
        const mockData = {
          summary: { total_responses: 0, total_sessions: 0, completion_rate_pct: 0.0, avg_fatigue: 0.0 },
          semantic_map: { points: [], clusters: [] },
          pacing_telemetry: [],
          outliers: [],
          historical_trends: [],
          responses_list: []
        };
        setAnalyticsData(mockData);
      } else {
        // Global mock fallback
        const mockData = {
          totalForms: forms?.length || 0,
          totalSessions: 0,
          totalCompleted: 0,
          completionRate: 0,
          dropoffRate: 0,
          avgDuration: 0.0,
          sentimentDistribution: { Positive: 0, Neutral: 0, Negative: 0 },
          recentResponses: []
        };
        setAnalyticsData(mockData);
      }
    } finally {
      setLoading(false);
    }
  };

  const renderGlobalView = () => {
    const totalForms = analyticsData?.totalForms || 0;
    const totalSessions = analyticsData?.totalSessions || 0;
    const totalCompleted = analyticsData?.totalCompleted || 0;
    const completionRate = analyticsData?.completionRate || 0;
    const avgDuration = analyticsData?.avgDuration || 0.0;
    const dropoffRate = analyticsData?.dropoffRate || 0;
    const sentiments = analyticsData?.sentimentDistribution || { Positive: 0, Neutral: 0, Negative: 0 };
    const recentResponses = analyticsData?.recentResponses || [];

    const totalSentimentSum = sentiments.Positive + sentiments.Neutral + sentiments.Negative;
    const posPct = totalSentimentSum > 0 ? (sentiments.Positive / totalSentimentSum) * 100 : 0;
    const neuPct = totalSentimentSum > 0 ? (sentiments.Neutral / totalSentimentSum) * 100 : 0;
    const negPct = totalSentimentSum > 0 ? (sentiments.Negative / totalSentimentSum) * 100 : 0;

    return (
      <div className="scroll-pane" style={{ padding: '2rem 0', overflowY: 'auto', flex: 1 }}>
        {/* Header Toolbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2rem 1.5rem 2rem', borderBottom: '1px solid var(--card-border)' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Overall Pipeline Analytics</h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Aggregated cross-form conversational metrics</span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="button-secondary no-print" onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Download size={14} /> Export PDF
            </button>
            <button className="button-secondary no-print" onClick={fetchAnalytics}>
              <RefreshCw size={14} /> Refresh Data
            </button>
          </div>
        </div>

        {/* Global KPIs */}
        <div className="dashboard-grid" style={{ padding: '2rem' }}>
          <div className="kpi-card" style={{ padding: '1.25rem' }}>
            <div className="kpi-header">Active Forms</div>
            <div className="kpi-value">{totalForms}</div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Conversational forms built</span>
          </div>
          <div className="kpi-card" style={{ padding: '1.25rem' }}>
            <div className="kpi-header">Total Responses</div>
            <div className="kpi-value">{totalCompleted}</div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>From {totalSessions} sessions</span>
          </div>
          <div className="kpi-card" style={{ padding: '1.25rem' }}>
            <div className="kpi-header">Funnel Completion</div>
            <div className="kpi-value">{completionRate}%</div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Global completion rate</span>
          </div>
          <div className="kpi-card" style={{ padding: '1.25rem' }}>
            <div className="kpi-header">Avg Duration</div>
            <div className="kpi-value">{avgDuration}s</div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Conversational turn engagement</span>
          </div>
        </div>

        {/* Sentiment Pulse */}
        <div style={{ padding: '0 2rem 1.5rem 2rem' }}>
          <div className="card-container" style={{ padding: '1.5rem' }}>
            <h3 className="card-title" style={{ marginBottom: '1rem' }}>Global Sentiment Pulse</h3>
            
            {totalSentimentSum === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: 0 }}>No dialogue responses recorded yet to aggregate sentiments.</p>
            ) : (
              <div>
                <div style={{ display: 'flex', height: '24px', borderRadius: '6px', overflow: 'hidden', marginBottom: '1.25rem' }}>
                  {posPct > 0 && <div style={{ width: `${posPct}%`, backgroundColor: '#10b981' }} title={`Positive: ${Math.round(posPct)}%`} />}
                  {neuPct > 0 && <div style={{ width: `${neuPct}%`, backgroundColor: '#71717a' }} title={`Neutral: ${Math.round(neuPct)}%`} />}
                  {negPct > 0 && <div style={{ width: `${negPct}%`, backgroundColor: '#ef4444' }} title={`Negative: ${Math.round(negPct)}%`} />}
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: '0.8rem', fontWeight: 600 }}>
                  <span style={{ color: '#10b981' }}>Positive: {Math.round(posPct)}% ({sentiments.Positive})</span>
                  <span style={{ color: '#71717a' }}>Neutral: {Math.round(neuPct)}% ({sentiments.Neutral})</span>
                  <span style={{ color: '#ef4444' }}>Negative: {Math.round(negPct)}% ({sentiments.Negative})</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Forms Directory */}
        <div style={{ padding: '0 2rem 1.5rem 2rem' }}>
          <div className="card-container" style={{ padding: '1.5rem' }}>
            <h3 className="card-title" style={{ marginBottom: '0.5rem' }}>Forms Directory</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Click on any active conversational form to inspect its individual semantic map, pacing telemetry, and turn-by-turn dialogue transcripts.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {forms.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)', border: '1px dashed var(--card-border)', borderRadius: '8px' }}>
                  No active forms in the pipeline. Go to the dashboard to build one.
                </div>
              ) : (
                forms.map(form => (
                  <div 
                    key={form.id} 
                    style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center', 
                      border: '1px solid var(--card-border)', 
                      padding: '1rem', 
                      borderRadius: '8px', 
                      background: 'var(--bg-color)' 
                    }}
                  >
                    <div style={{ flex: 1, paddingRight: '1.5rem' }}>
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem' }}>{form.title}</h4>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '600px' }}>
                        {form.objective}
                      </p>
                    </div>
                    
                    <button 
                      className="button-primary" 
                      onClick={() => selectForm(form)}
                      style={{ fontSize: '0.78rem', padding: '0.45rem 0.85rem' }}
                    >
                      Analyze Form
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Global Submissions Timeline logs */}
        <div style={{ padding: '0 2rem 2rem 2rem' }}>
          <div className="card-container" style={{ padding: '1.5rem' }}>
            <h3 className="card-title" style={{ marginBottom: '1rem' }}>Global Recent Activity</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {recentResponses.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: 0, textAlign: 'center', padding: '1rem 0' }}>No respondent dialogues completed yet.</p>
              ) : (
                recentResponses.map(resp => (
                  <div 
                    key={resp.id} 
                    style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center', 
                      border: '1px solid var(--card-border)', 
                      padding: '0.75rem 1rem', 
                      borderRadius: '6px', 
                      background: 'var(--bg-color)' 
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>{resp.form_title}</span>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{resp.submitted_at}</span>
                      </div>
                      <p style={{ fontSize: '0.78rem', fontStyle: 'italic', margin: 0, color: 'var(--text-primary)' }}>
                        "{resp.snippet}"
                      </p>
                    </div>
                    
                    <span style={{ 
                      fontSize: '0.68rem', 
                      padding: '0.15rem 0.45rem', 
                      borderRadius: '4px', 
                      fontWeight: 600,
                      backgroundColor: resp.sentiment === 'Positive' ? 'rgba(16, 185, 129, 0.1)' : resp.sentiment === 'Negative' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(113, 113, 122, 0.1)',
                      color: resp.sentiment === 'Positive' ? '#10b981' : resp.sentiment === 'Negative' ? '#ef4444' : 'var(--text-muted)'
                    }}>
                      {resp.sentiment}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    fetchAnalytics();
  }, [activeForm]);

  const handleSelectCohort = (cohort) => {
    setSelectedCohort(cohort);
    setCohortMessages([
      { role: 'assistant', content: `Hello! I represent the '${cohort.name}' user group. Go ahead and ask me any questions based on our experiences!` }
    ]);
  };

  const handleSendCohortChat = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || chatLoading) return;

    const userText = inputText;
    setInputText('');
    
    // Add user question
    const updatedMessages = [...cohortMessages, { role: 'user', content: userText }];
    setCohortMessages(updatedMessages);
    setChatLoading(true);

    try {
      const response = await fetch(`/api/forms/${activeForm.id}/cohort-chat`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          cohort_name: selectedCohort.name,
          chat_history: updatedMessages.slice(-5),
          user_question: userText
        })
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setCohortMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
    } catch (err) {
      console.error("Error querying cohort chat API:", err);
      setTimeout(() => {
        setCohortMessages(prev => [...prev, { 
          role: 'assistant', 
          content: `[SANDBOX RESPONSE] Based on our cluster responses for '${selectedCohort.name}', our primary concern was indeed that the interface felt laggy when querying large arrays of data, which disrupted our core daily usage. Speed was more critical to us than support tiers.` 
        }]);
      }, 800);
    } finally {
      setChatLoading(false);
    }
  };

  // Color mapper for clusters
  const getClusterColor = (cId) => {
    const colors = ["#2563eb", "#a855f7", "#10b981", "#ef4444", "#f59e0b"];
    return colors[cId % colors.length];
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
        <RefreshCw className="kpi-icon" size={36} style={{ animation: 'spin 2s linear infinite' }} />
        <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>Synthesizing conversational response data...</p>
        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!activeForm) {
    return renderGlobalView();
  }

  if (!analyticsData || !analyticsData.summary) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
        <RefreshCw className="kpi-icon" size={36} style={{ animation: 'spin 2s linear infinite' }} />
        <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>Loading form analytics...</p>
      </div>
    );
  }

  const { summary, semantic_map, pacing_telemetry, outliers, historical_trends, responses_list } = analyticsData;
  const responsesList = responses_list || [];

  const filteredResponses = responsesList.filter(resp => {
    if (activeSentimentTab === 'All') return true;
    return resp.sentiment === activeSentimentTab;
  });

  return (
    <div className="scroll-pane" style={{ padding: '2rem 0', overflowY: 'auto', flex: 1 }}>
      
      {/* Analytics Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 2rem 1.5rem 2rem', borderBottom: '1px solid var(--card-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="button-secondary no-print" onClick={() => selectForm(null)} style={{ padding: '0.5rem 0.8rem' }}>
            <ArrowLeft size={16} /> Back to Global
          </button>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Synthesis Suite: {activeForm.title}</h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Semantic clustering and pacing insights</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="button-secondary no-print" onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Download size={14} /> Export PDF
          </button>
          <button className="button-secondary no-print" onClick={fetchAnalytics}>
            <RefreshCw size={16} /> Re-Cluster Data
          </button>
        </div>
      </div>

      {/* KPI stats summary block */}
      <div className="dashboard-grid" style={{ padding: '2rem 2rem 1rem 2rem' }}>
        <div className="kpi-card" style={{ padding: '1.25rem' }}>
          <div className="kpi-header">Survey Completion</div>
          <div className="kpi-value">{summary.completion_rate_pct}%</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{summary.total_responses} of {summary.total_sessions} completed</span>
        </div>
        <div className="kpi-card" style={{ padding: '1.25rem' }}>
          <div className="kpi-header">Avg Fatigue Index</div>
          <div className="kpi-value">{summary.avg_fatigue}</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Respondent fatigue rating (0-1)</span>
        </div>
        <div className="kpi-card" style={{ padding: '1.25rem' }}>
          <div className="kpi-header">Qualitative Clusters</div>
          <div className="kpi-value">{semantic_map.clusters?.length || 0}</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Autonomous thematic cohorts</span>
        </div>
        <div className="kpi-card" style={{ padding: '1.25rem' }}>
          <div className="kpi-header">Flagged Outliers</div>
          <div className="kpi-value">{outliers.length}</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Friction/Performance alerts</span>
        </div>
      </div>

      {/* Semantic map block */}
      <div className="content-layout">
        <div className="two-column-layout">
          
          {/* Scatter Plot cluster canvas */}
          <div className="card-container" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: '520px', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="card-title">
                <Brain size={18} className="kpi-icon" /> Qualitative Semantic Cluster Map
              </h3>
              <div style={{ display: 'flex', gap: '0.25rem', fontSize: '0.7rem', color: 'var(--text-muted)', background: 'var(--bg-color)', border: '1px solid var(--card-border)', borderRadius: '4px', padding: '0.2rem 0.5rem' }}>
                <span style={{ fontWeight: 600 }}>Vector space</span> (TF-IDF + PCA)
              </div>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              Close points represent similar customer feedback. Drag to pan, scroll to zoom, hover to inspect quote.
            </p>

            {semantic_map.points?.length < 3 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '360px', background: 'var(--bg-color)', border: '1px solid var(--card-border)', borderRadius: '8px', padding: '2rem', textAlign: 'center' }}>
                <Brain size={42} style={{ color: 'var(--accent-color)', opacity: 0.8, marginBottom: '1rem' }} />
                <h4 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Clustering activates at 3 responses</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '400px', margin: 0, lineHeight: '1.5' }}>
                  FormPulse uses TF-IDF + K-Means + PCA to cluster respondent answers into cohorts. Collect at least 3 completed responses to unlock vector-space semantic maps.
                </p>
                <span style={{ fontSize: '0.72rem', marginTop: '1rem', background: 'var(--card-bg)', border: '1px solid var(--card-border)', padding: '0.2rem 0.6rem', borderRadius: '20px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Current responses: {semantic_map.points?.length || 0} / 3
                </span>
              </div>
            ) : (
              <>
                <CanvasScatterPlot 
                  points={semantic_map.points || []} 
                  clusters={semantic_map.clusters || []} 
                  getClusterColor={getClusterColor}
                  onHoverPoint={setHoveredPoint}
                  hoveredPoint={hoveredPoint}
                />

                {/* Clusters Legend */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginTop: '0.5rem', borderTop: '1px solid var(--card-border)', paddingTop: '0.75rem' }}>
                  {semantic_map.clusters?.map(c => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', fontWeight: 600 }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: getClusterColor(c.id) }} />
                      <span style={{ color: 'var(--text-primary)' }}>{c.name}</span>
                    </div>
                  ))}
                </div>

                {/* Float HUD Tooltip for hovered vector point */}
                {hoveredPoint && (
                  <div 
                    style={{
                      position: 'absolute',
                      top: '120px',
                      left: '20px',
                      right: '20px',
                      background: 'var(--card-bg)',
                      border: `1px solid ${getClusterColor(hoveredPoint.cluster)}`,
                      borderRadius: '6px',
                      padding: '0.75rem',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      zIndex: 20,
                      fontSize: '0.8rem',
                      lineHeight: '1.4',
                      transition: 'opacity 0.2s ease-in-out'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem', fontWeight: 700, fontSize: '0.75rem', color: getClusterColor(hoveredPoint.cluster) }}>
                      <span>{semantic_map.clusters?.find(c => c.id === hoveredPoint.cluster)?.name || "Cohort"} Group</span>
                      <span style={{ background: 'var(--bg-color)', border: '1px solid var(--card-border)', borderRadius: '4px', padding: '0.1rem 0.3rem', fontSize: '0.65rem' }}>
                        Vector Similarity: {hoveredPoint.similarity}
                      </span>
                    </div>
                    <div style={{ fontStyle: 'italic', color: 'var(--text-primary)' }}>
                      "{hoveredPoint.text}"
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Interactive Cohort Chat Panel */}
          <div className="card-container" style={{ display: 'flex', flexDirection: 'column', height: '520px' }}>
            <h3 className="card-title" style={{ marginBottom: '0.5rem' }}>
              <Users size={18} className="kpi-icon" /> Query Synthetic Personas
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Select a cluster group to talk directly with a synthetic cohort persona representing the aggregated experiences of real respondents.
            </p>

            {semantic_map.clusters?.length < 2 ? (
              <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-color)', border: '1px dashed var(--card-border)', borderRadius: '8px', padding: '2rem', textAlign: 'center' }}>
                <Users size={36} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
                <h4 style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Query Synthetic Cohorts</h4>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', maxWidth: '300px', margin: 0, lineHeight: '1.4' }}>
                  Once you gather enough feedback, you can chat directly with AI representatives of distinct user groups.
                </p>
              </div>
            ) : (
              <>
                {/* Cohort Selector pills */}
                <div style={{ display: 'flex', gap: '0.35rem', overflowX: 'auto', paddingBottom: '0.5rem', borderBottom: '1px solid var(--card-border)' }}>
                  {semantic_map.clusters?.map(c => (
                    <button 
                      key={c.id} 
                      className={`nav-link ${selectedCohort?.id === c.id ? 'active' : ''}`}
                      onClick={() => handleSelectCohort(c)}
                      style={{ whiteSpace: 'nowrap', fontSize: '0.75rem', padding: '0.35rem 0.65rem', borderRadius: '4px' }}
                    >
                      {c.name.split(' ')[0]} Cohort
                    </button>
                  ))}
                </div>

                {/* Chat Body */}
                <div className="chat-messages-container" style={{ flex: 1, padding: '1rem 0', gap: '0.5rem', overflowY: 'auto' }}>
                  {cohortMessages.map((msg, idx) => (
                    <div key={idx} className={`chat-bubble ${msg.role}`} style={{ fontSize: '0.8rem', padding: '0.6rem 0.8rem', borderRadius: '8px', maxWidth: '85%' }}>
                      {msg.content}
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="chat-bubble assistant" style={{ opacity: 0.6, fontSize: '0.8rem' }}>
                      Analyzing cohort context...
                    </div>
                  )}
                </div>

                {/* Input Form */}
                <form onSubmit={handleSendCohortChat} style={{ display: 'flex', gap: '0.5rem', borderTop: '1px solid var(--card-border)', paddingTop: '0.75rem' }}>
                  <input 
                    type="text" 
                    className="input-field" 
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    placeholder={`Ask the ${selectedCohort?.name.split(' ')[0]} persona...`}
                    style={{ height: '38px', fontSize: '0.8rem' }}
                    disabled={chatLoading}
                  />
                  <button className="button-primary" style={{ padding: '0 1rem', height: '38px', borderRadius: '6px' }} disabled={chatLoading}>
                    <Send size={14} />
                  </button>
                </form>
              </>
            )}
          </div>

        </div>
      </div>

      {/* Historical trends & pacing friction row */}
      <div className="content-layout">
        <div className="equal-two-columns">
          
          {/* Time Series chart */}
          <div className="card-container" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3 className="card-title">
              <Activity size={18} className="kpi-icon" /> Response Volume Timeline
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              Real-time trend analysis tracking daily conversational survey submissions.
            </p>
            <HistoricalTrendChart data={historical_trends || []} />
          </div>

          {/* Friction telemetry list */}
          <div className="card-container" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3 className="card-title">
              <BarChart3 size={18} className="kpi-icon" /> Question Node Friction Telemetry
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              Performance metrics detecting latency and dropout rates for each conversational question.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto' }}>
              {pacing_telemetry.map((telemetry, index) => (
                <div key={index} style={{ border: '1px solid var(--card-border)', padding: '0.6rem 0.8rem', borderRadius: '6px', background: 'var(--bg-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    <span>{telemetry.field}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      Latency: {telemetry.avg_time_sec}s
                    </span>
                  </div>
                  {/* Progress bar visual indicator */}
                  <div style={{ height: '6px', background: 'var(--card-border)', borderRadius: '3px', overflow: 'hidden', display: 'flex' }}>
                    <div style={{ 
                      height: '100%', 
                      width: `${Math.min(100, (telemetry.avg_time_sec / 60) * 100)}%`, 
                      backgroundColor: telemetry.avg_time_sec > 25 ? 'var(--error)' : 'var(--accent-color)' 
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    <span>Drop-off rate:</span>
                    <span style={{ color: telemetry.dropoff_rate > 0.15 ? 'var(--error)' : 'var(--text-muted)', fontWeight: 600 }}>
                      {Math.round(telemetry.dropoff_rate * 100)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* Outliers Alert List */}
      <div className="content-layout" style={{ marginTop: '1.5rem' }}>
        <div className="card-container">
          <h3 className="card-title" style={{ marginBottom: '0.5rem' }}>
            <AlertTriangle size={18} style={{ color: 'var(--warning)' }} /> Qualitative Anomalies & Outliers
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
            Identifies atypical feedback nodes calculated mathematically based on low vector similarity to cluster centroids.
          </p>
          <div className="equal-two-columns" style={{ gap: '1rem' }}>
            {outliers.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No atypical qualitative friction reported. Forms running smoothly.</p>
            ) : (
              outliers.map((outlier, index) => (
                <div key={index} style={{ border: '1px solid var(--card-border)', padding: '0.75rem', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.02)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--warning)', fontWeight: 700, marginBottom: '0.35rem' }}>
                      <span style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                        <AlertTriangle size={12} />
                        {outlier.reason}
                      </span>
                      {outlier.similarity < 1.0 && (
                        <span style={{ fontSize: '0.65rem', background: 'var(--card-border)', padding: '0.05rem 0.25rem', borderRadius: '4px' }}>
                          Similarity: {outlier.similarity}
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontStyle: 'italic', margin: 0 }}>
                      "{outlier.text}"
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Sentiment-Grouped Verbatim List */}
      <div className="content-layout" style={{ marginTop: '1.5rem' }}>
        <div className="card-container">
          <h3 className="card-title" style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <MessageSquare size={18} style={{ color: 'var(--accent-color)' }} /> Verbatim Respondent Dialogues
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
            Explore verbatim feedback details left by respondents, classified dynamically by AI-analyzed sentiment. Click on any feedback to inspect the complete dialog history.
          </p>

          {/* Sentiment Filter Tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--card-border)', paddingBottom: '0.75rem' }}>
            {['All', 'Positive', 'Neutral', 'Negative'].map(tab => {
              const count = tab === 'All' 
                ? (responsesList?.length || 0)
                : (responsesList?.filter(r => r.sentiment === tab).length || 0);
              return (
                <button
                  key={tab}
                  className={`nav-link ${activeSentimentTab === tab ? 'active' : ''}`}
                  onClick={() => {
                    setActiveSentimentTab(tab);
                    setExpandedResponseId(null);
                  }}
                  style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', borderRadius: '4px' }}
                >
                  {tab} ({count})
                </button>
              );
            })}
          </div>

          {/* Feed List */}
          {filteredResponses.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '1rem 0', textAlign: 'center' }}>No verbatim dialogues match this sentiment category.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {filteredResponses.map(resp => {
                const isExpanded = expandedResponseId === resp.id;
                return (
                  <div 
                    key={resp.id} 
                    style={{ 
                      border: '1px solid var(--card-border)', 
                      borderRadius: '8px', 
                      padding: '1rem', 
                      background: 'var(--bg-color)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                    onClick={() => setExpandedResponseId(isExpanded ? null : resp.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Submitted: {resp.submitted_at ? new Date(resp.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown Date'}
                      </span>
                      <span style={{ 
                        fontSize: '0.72rem', 
                        padding: '0.15rem 0.5rem', 
                        borderRadius: '4px', 
                        fontWeight: 600,
                        backgroundColor: resp.sentiment === 'Positive' ? 'rgba(16, 185, 129, 0.1)' : resp.sentiment === 'Negative' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(113, 113, 122, 0.1)',
                        color: resp.sentiment === 'Positive' ? '#10b981' : resp.sentiment === 'Negative' ? '#ef4444' : 'var(--text-muted)'
                      }}>
                        {resp.sentiment}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', margin: '0.5rem 0' }}>
                      {resp.full_text.split(" | ").map((msg, mIdx) => (
                        <div 
                          key={mIdx} 
                          style={{ 
                            display: 'flex', 
                            gap: '0.5rem', 
                            alignItems: 'center', 
                            fontSize: '0.8rem', 
                            background: 'var(--card-bg)', 
                            border: '1px solid var(--card-border)', 
                            padding: '0.4rem 0.65rem', 
                            borderRadius: '6px',
                            color: 'var(--text-primary)'
                          }}
                        >
                          <span style={{ 
                            display: 'inline-block', 
                            width: '6px', 
                            height: '6px', 
                            borderRadius: '50%', 
                            backgroundColor: resp.sentiment === 'Positive' ? '#10b981' : resp.sentiment === 'Negative' ? '#ef4444' : 'var(--text-muted)' 
                          }} />
                          <span style={{ lineHeight: '1.4' }}>{msg}</span>
                        </div>
                      ))}
                    </div>

                    {/* Expander transcript details */}
                    {isExpanded && resp.raw_chat && (
                      <div 
                        style={{ 
                          marginTop: '1rem', 
                          borderTop: '1px solid var(--card-border)', 
                          paddingTop: '1rem',
                          background: 'var(--card-bg)',
                          borderRadius: '6px',
                          padding: '0.75rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.75rem'
                        }}
                        onClick={e => e.stopPropagation()}
                      >
                        {/* Extracted Structured Data Table */}
                        {resp.extracted_data && Object.keys(resp.extracted_data).length > 0 && (
                          <div style={{ marginBottom: '0.75rem', borderBottom: '1px solid var(--card-border)', paddingBottom: '1rem' }}>
                            <strong style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.5rem' }}>
                              Extracted Survey Answers:
                            </strong>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
                              {(() => {
                                const fields = activeForm.schema_fields ? (typeof activeForm.schema_fields === 'string' ? JSON.parse(activeForm.schema_fields) : activeForm.schema_fields) : [];
                                return fields.map(field => {
                                  const val = resp.extracted_data[field.id];
                                  if (val === undefined || val === null || val === '') return null;
                                  
                                  return (
                                    <div 
                                      key={field.id} 
                                      style={{ 
                                        border: '1px solid var(--card-border)', 
                                        background: 'var(--bg-color)', 
                                        padding: '0.5rem 0.75rem', 
                                        borderRadius: '6px' 
                                      }}
                                    >
                                      <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.15rem' }}>
                                        {field.label}
                                      </span>
                                      <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                                        {field.type === 'url' ? (
                                          <a 
                                            href={val.startsWith('http') ? val : `https://${val}`} 
                                            target="_blank" 
                                            rel="noopener noreferrer" 
                                            style={{ color: 'var(--accent-color)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                                          >
                                            {val}
                                            <ExternalLink size={10} />
                                          </a>
                                        ) : field.type === 'picture' ? (
                                          <div style={{ marginTop: '0.25rem' }}>
                                            <img 
                                              src={val} 
                                              alt={field.label} 
                                              style={{ width: '60px', height: '45px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--card-border)', cursor: 'pointer', display: 'block' }} 
                                              onClick={() => setLightboxUrl(val)} 
                                            />
                                          </div>
                                        ) : field.type === 'file' ? (
                                          <a 
                                            href={val} 
                                            target="_blank" 
                                            rel="noopener noreferrer" 
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'var(--card-bg)', border: '1px solid var(--card-border)', padding: '0.15rem 0.4rem', borderRadius: '4px', textDecoration: 'none', color: 'var(--text-primary)', fontSize: '0.72rem', marginTop: '0.25rem' }}
                                          >
                                            <Download size={10} />
                                            View Document
                                          </a>
                                        ) : (
                                          <span>{String(val)}</span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          </div>
                        )}
                        
                        <strong style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Dialogue Transcript:</strong>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.50rem' }}>
                          {resp.raw_chat.map((msg, mIdx) => (
                            <div 
                              key={mIdx} 
                              style={{ 
                                display: 'flex', 
                                flexDirection: 'column', 
                                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                                maxWidth: '85%'
                              }}
                            >
                              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '0.15rem', alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                                {msg.role === 'user' ? 'Respondent' : 'AI Agent'}
                              </span>
                              <div style={{
                                padding: '0.5rem 0.75rem',
                                borderRadius: '8px',
                                fontSize: '0.8rem',
                                backgroundColor: msg.role === 'user' ? 'var(--accent-color)' : 'var(--bg-color)',
                                color: msg.role === 'user' ? '#ffffff' : 'var(--text-primary)',
                                border: msg.role === 'user' ? 'none' : '1px solid var(--card-border)'
                              }}>
                                {msg.content}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox Image Overlay Modal */}
      {lightboxUrl && (
        <div 
          className="modal-overlay" 
          onClick={() => setLightboxUrl(null)} 
          style={{ 
            zIndex: 99999, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            backgroundColor: 'rgba(0,0,0,0.85)',
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0
          }}
        >
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            <button 
              className="button-icon" 
              onClick={() => setLightboxUrl(null)} 
              style={{ position: 'absolute', top: '-40px', right: '0px', color: '#ffffff', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <X size={24} />
            </button>
            <img 
              src={lightboxUrl} 
              alt="Enlarged Upload" 
              style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain', borderRadius: '8px', border: '1px solid var(--card-border)' }} 
            />
          </div>
        </div>
      )}
    </div>
  );
}
