import React, { useState, useEffect, useRef } from 'react';
import { Send, Mic, Square, Volume2, AlertCircle, RefreshCw, Paperclip } from 'lucide-react';

export default function FormFiller({ formId, standalone = true, onSessionUpdate = null }) {
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // File upload state
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef(null);
  
  const messagesEndRef = useRef(null);
  const timerRef = useRef(null);

  // Initialize Session
  useEffect(() => {
    if (!formId) return;
    
    const initializeSurvey = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form_id: formId })
        });
        
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("Form not found. Please verify the URL/Form ID.");
          }
          throw new Error("Failed to initialize conversational survey session.");
        }
        
        const data = await response.json();
        setSession(data);
        setMessages(data.conversation_history || []);
        if (onSessionUpdate) onSessionUpdate(data);
      } catch (err) {
        console.error("Survey Init Error:", err);
        setError(err.message || "Unable to connect to the FormPulse survey engine. Ensure the backend is active.");
      } finally {
        setIsLoading(false);
      }
    };

    initializeSurvey();
  }, [formId]);

  // Scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Audio timer ticker
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
      setRecordingSeconds(0);
    }
    return () => clearInterval(timerRef.current);
  }, [isRecording]);

  const handleSendText = async (e) => {
    e?.preventDefault();
    if (!inputText.trim() || isLoading) return;

    const textToSend = inputText;
    setInputText('');
    await submitResponse(textToSend, null);
  };

  const submitResponse = async (text, audioBlob, fileUrl = null, fileFieldId = null) => {
    setIsLoading(true);
    setError(null);

    // Optimistically add user message to UI
    let tempUserContent = text || "[Voice Note Uploading...]";
    if (fileUrl) {
      // Clean up the URL representation for the chat view
      const filename = fileUrl.split('/').pop() || 'file';
      tempUserContent = `📎 Attached File: ${filename}`;
    }
    const tempUserMsg = { role: 'user', content: tempUserContent };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      const formData = new FormData();
      if (text) formData.append('message', text);
      if (audioBlob) formData.append('audio', audioBlob, 'voice_note.webm');
      if (fileUrl) formData.append('file_url', fileUrl);
      if (fileFieldId) formData.append('file_field_id', fileFieldId);

      const response = await fetch(`/api/sessions/${session.id}/respond`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error("Server error processing turn.");

      const data = await response.json();
      setSession(data.session);
      setMessages(data.session.conversation_history || []);
      
      if (onSessionUpdate) onSessionUpdate(data.session, data.form_complete);
    } catch (err) {
      console.error("Submit error:", err);
      setError("Failed to transmit answer. Retrying...");
      // Revert optimistic add on failure
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !session) return;

    const activeField = session.active_field;
    if (!activeField) return;

    const isPic = activeField.type === 'picture';
    if (isPic && !file.type.startsWith('image/')) {
      alert("Please upload an image file (PNG, JPG, WEBP, GIF).");
      return;
    }

    // proposed limits: 5MB for picture, 10MB for documents
    const limitBytes = isPic ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > limitBytes) {
      alert(`File is too large. Maximum size is ${isPic ? '5MB' : '10MB'}.`);
      return;
    }

    setUploadingFile(true);
    setError(null);

    try {
      const uploadFormData = new FormData();
      uploadFormData.append('file', file);

      const response = await fetch(`/api/sessions/${session.id}/upload`, {
        method: 'POST',
        body: uploadFormData
      });

      if (!response.ok) throw new Error("Failed to upload file to storage.");

      const data = await response.json();
      const fileUrl = data.url;

      // Submit file response to the session
      await submitResponse(null, null, fileUrl, activeField.id);
    } catch (err) {
      console.error("Upload error:", err);
      alert(`Upload failed: ${err.message || 'Server error'}`);
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Audio Recorder Actions
  const startRecording = async () => {
    setAudioChunks([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      
      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        // Clean stream tracks
        stream.getTracks().forEach(track => track.stop());
        
        // Submit audio blob
        await submitResponse(null, blob);
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (err) {
      console.error("Audio Access Denied:", err);
      alert("Microphone permission denied or unsupported. Please type your responses.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  const formatTimer = (secs) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins}:${remainingSecs < 10 ? '0' : ''}${remainingSecs}`;
  };

  if (error && messages.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '2rem', textAlign: 'center' }}>
        <AlertCircle size={48} style={{ color: 'var(--error)', marginBottom: '1rem' }} />
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>{error}</p>
        <button className="button-primary" onClick={() => window.location.reload()}>
          <RefreshCw size={14} /> Retry Connection
        </button>
      </div>
    );
  }

  const isCompleted = session?.status === 'completed';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', background: 'inherit' }}>
      
      {/* Standalone Header */}
      {standalone && (
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--card-border)', background: 'var(--card-bg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>FormPulse Collector</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Conversational survey session</span>
          </div>
          <span className="share-url" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
            {isCompleted ? "Session Done" : "Live Chat"}
          </span>
        </div>
      )}

      {/* Chat Messages */}
      <div className="chat-messages-container" style={{ padding: '1.5rem' }}>
        {messages.map((msg, index) => (
          <div key={index} className={`chat-bubble ${msg.role}`}>
            {msg.content}
            {/* If it was a voice note user response, show audio identifier */}
            {msg.role === 'user' && msg.content.includes('[Voice Note') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem', fontSize: '0.8rem', opacity: 0.8 }}>
                <Volume2 size={12} /> Voice Recording Ingested
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="chat-bubble assistant" style={{ opacity: 0.65, display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
            <span className="loader-dot" style={{ animation: 'bounce 0.6s infinite alternate' }}>•</span>
            <span className="loader-dot" style={{ animation: 'bounce 0.6s infinite alternate 0.2s' }}>•</span>
            <span className="loader-dot" style={{ animation: 'bounce 0.6s infinite alternate 0.4s' }}>•</span>
            Thinking...
          </div>
        )}
        {uploadingFile && (
          <div className="chat-bubble user" style={{ 
            opacity: 0.75, 
            display: 'inline-flex', 
            gap: '0.4rem', 
            alignItems: 'center', 
            alignSelf: 'flex-end', 
            background: 'var(--card-bg)', 
            border: '1px solid var(--card-border)', 
            color: 'var(--text-primary)',
            fontSize: '0.82rem',
            padding: '0.5rem 1.25rem',
            borderRadius: '12px 12px 0 12px'
          }}>
            <span className="loader-dot" style={{ animation: 'bounce 0.6s infinite alternate' }}>•</span>
            Uploading attachment...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Footer Controls */}
      <div style={{ borderTop: '1px solid var(--card-border)', padding: '1rem', background: 'var(--card-bg)' }}>
        {isCompleted ? (
          <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--success)', fontWeight: 600 }}>
             ✓ Response submitted. Thank you for your time!
          </div>
        ) : (
          <form onSubmit={handleSendText} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {/* Hidden native file input picker */}
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              style={{ display: 'none' }} 
              accept={session?.active_field?.type === 'picture' ? 'image/*' : '*'}
            />

            {/* Paperclip attachment button for pictures and documents */}
            {session?.active_field && (session.active_field.type === 'picture' || session.active_field.type === 'file') && (
              <button 
                type="button" 
                className="button-icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || uploadingFile || isRecording}
                title={`Upload ${session.active_field.type === 'picture' ? 'Image' : 'File'}`}
                style={{ 
                  border: '1px solid var(--card-border)', 
                  width: '38px', 
                  height: '38px', 
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-primary)',
                  background: 'transparent',
                  cursor: 'pointer'
                }}
              >
                <Paperclip size={18} />
              </button>
            )}

            {isRecording ? (
              <div style={{ 
                flex: 1, 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                background: 'var(--error-bg)', 
                border: '1px solid var(--error)',
                borderRadius: '20px', 
                padding: '0.5rem 1.25rem',
                color: 'var(--error)' 
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ 
                    width: '8px', 
                    height: '8px', 
                    borderRadius: '50%', 
                    backgroundColor: 'var(--error)', 
                    animation: 'pulse 1s infinite' 
                  }} />
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Recording Voice Note: {formatTimer(recordingSeconds)}</span>
                </div>
                <button type="button" onClick={stopRecording} style={{ background: 'transparent', border: 'none', color: 'var(--error)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                  <Square size={16} />
                </button>
              </div>
            ) : (
              <input 
                type="text" 
                className="input-field" 
                placeholder={session?.active_field?.type === 'url' ? "Please provide a website link..." : "Type your message..."}
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                disabled={isLoading || uploadingFile}
                style={{ borderRadius: '20px', padding: '0.5rem 1.25rem' }}
              />
            )}

            {/* Mic / Record button */}
            {!inputText.trim() && (
              <button 
                type="button" 
                className={`button-icon ${isRecording ? 'recording' : ''}`}
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isLoading}
                style={{ 
                  color: isRecording ? 'white' : 'var(--text-muted)',
                  backgroundColor: isRecording ? 'var(--error)' : 'transparent',
                  border: isRecording ? 'none' : '1px solid var(--card-border)',
                  width: '38px',
                  height: '38px'
                }}
              >
                <Mic size={18} />
              </button>
            )}

            {/* Send button */}
            {(inputText.trim() || isRecording) && (
              <button 
                type="submit" 
                className="button-primary" 
                disabled={isLoading || isRecording}
                style={{ width: '38px', height: '38px', borderRadius: '50%', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Send size={16} />
              </button>
            )}
          </form>
        )}
      </div>
      
      {/* Blinking keyframe styling */}
      <style>{`
        @keyframes bounce {
          0% { transform: translateY(0); }
          100% { transform: translateY(-4px); }
        }
        @keyframes pulse {
          0% { opacity: 0.3; }
          50% { opacity: 1; }
          100% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
