import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

const API_BASE = process.env.NODE_ENV === 'production' 
  ? window.location.origin 
  : 'http://localhost:3001';

// Sound System
class SoundManager {
  constructor() {
    this.audioContext = null;
    this.sounds = {};
    this.enabled = true;
    this.volume = 0.3;
    this.initAudioContext();
  }

  initAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.createSounds();
    } catch (error) {
      console.log('Web Audio API not supported');
    }
  }

  createSounds() {
    // Message received sound (gentle notification)
    this.sounds.message = {
      frequency: 800,
      duration: 0.15,
      type: 'sine'
    };

    // File received sound (slightly different tone)
    this.sounds.file = {
      frequency: 600,
      duration: 0.2,
      type: 'triangle'
    };

    // Voice note received sound (warmer tone)
    this.sounds.voice = {
      frequency: 400,
      duration: 0.25,
      type: 'sine'
    };

    // New customer connected sound (higher tone)
    this.sounds.connect = {
      frequency: 1000,
      duration: 0.3,
      type: 'sine'
    };

    // Typing sound (very subtle)
    this.sounds.typing = {
      frequency: 300,
      duration: 0.05,
      type: 'triangle'
    };
  }

  playSound(soundType) {
    if (!this.enabled || !this.audioContext || !this.sounds[soundType]) return;

    try {
      // Resume audio context if suspended (browser autoplay policy)
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      const sound = this.sounds[soundType];
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      oscillator.frequency.setValueAtTime(sound.frequency, this.audioContext.currentTime);
      oscillator.type = sound.type;

      // Fade in and out for smooth sound
      gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(this.volume, this.audioContext.currentTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + sound.duration);

      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + sound.duration);
    } catch (error) {
      console.log('Error playing sound:', error);
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
  }
}

// Browser Notifications
class NotificationManager {
  constructor() {
    this.permission = 'default';
    this.enabled = true;
    this.requestPermission();
  }

  async requestPermission() {
    if ('Notification' in window) {
      this.permission = await Notification.requestPermission();
    }
  }

  show(title, body, icon = '💬') {
    if (!this.enabled || this.permission !== 'granted' || document.hasFocus()) {
      return;
    }

    const notification = new Notification(title, {
      body,
      icon: `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${icon}</text></svg>`,
      requireInteraction: false,
      silent: false
    });

    // Auto-close notification after 4 seconds
    setTimeout(() => notification.close(), 4000);

    // Focus window when notification is clicked
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }
}

// Global instances
const soundManager = new SoundManager();
const notificationManager = new NotificationManager();

// Admin Dashboard Component
const AdminDashboard = ({ setCurrentView }) => {
  const [workers, setWorkers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [adminKey, setAdminKey] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(null);
  const [registerForm, setRegisterForm] = useState({ username: '', password: '' });
  const [passwordForm, setPasswordForm] = useState({ newPassword: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated]);

  const loadData = async () => {
    try {
      const [workersRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/admin/workers`),
        fetch(`${API_BASE}/api/admin/stats`)
      ]);
      
      const workersData = await workersRes.json();
      const statsData = await statsRes.json();
      
      setWorkers(workersData.workers);
      setStats(statsData);
    } catch (error) {
      console.error('Error loading admin data:', error);
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const authenticate = () => {
    if (adminKey === 'admin123') {
      setIsAuthenticated(true);
      setError('');
    } else {
      setError('Invalid admin key');
    }
  };

  const registerWorker = async () => {
    if (!registerForm.username || !registerForm.password) {
      setError('Please fill in all fields');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/admin/workers/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: registerForm.username,
          password: registerForm.password,
          adminKey
        })
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess('Worker registered successfully!');
        setRegisterForm({ username: '', password: '' });
        setShowRegisterForm(false);
        loadData();
      } else {
        setError(data.error || 'Registration failed');
      }
    } catch (error) {
      setError('Network error');
    }
  };

  const deleteWorker = async (workerId, username) => {
    if (!window.confirm(`Are you sure you want to delete worker "${username}"?`)) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/admin/workers/${workerId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminKey })
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess('Worker deleted successfully!');
        loadData();
      } else {
        setError(data.error || 'Deletion failed');
      }
    } catch (error) {
      setError('Network error');
    }
  };

  const updatePassword = async (workerId) => {
    if (!passwordForm.newPassword) {
      setError('Please enter a new password');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/admin/workers/${workerId}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newPassword: passwordForm.newPassword,
          adminKey
        })
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess('Password updated successfully!');
        setPasswordForm({ newPassword: '' });
        setShowPasswordForm(null);
      } else {
        setError(data.error || 'Password update failed');
      }
    } catch (error) {
      setError('Network error');
    }
  };

  // Clear messages after 3 seconds
  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError('');
        setSuccess('');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [error, success]);

  if (!isAuthenticated) {
    return (
      <div className="login-container">
        <div className="login-content">
          <div className="login-header">
            <div className="login-icon">⚙️</div>
            <h2>Admin Dashboard</h2>
            <p>Enter admin key to manage workers</p>
          </div>

          <div className="login-form">
            <div className="form-group">
              <label>Admin Key</label>
              <input
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && authenticate()}
                className="form-input"
                placeholder="Enter admin key"
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button onClick={authenticate} className="btn btn-primary btn-full">
              Access Dashboard
            </button>
          </div>

          <div className="login-footer">
            <button onClick={() => setCurrentView('customer')} className="link-button">
              Back to Customer Chat
            </button>
          </div>

          <div className="demo-credentials">
            <p><strong>Demo Admin Key:</strong> admin123</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-content">
          <div className="spinner"></div>
          <p>Loading admin dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto', backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1 style={{ margin: 0, color: '#333' }}>🛠️ Admin Dashboard</h1>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => setCurrentView('customer')} className="btn" style={{ backgroundColor: '#6c757d', color: 'white' }}>
            Customer View
          </button>
          <button onClick={() => setCurrentView('worker-login')} className="btn" style={{ backgroundColor: '#007bff', color: 'white' }}>
            Worker Login
          </button>
          <button onClick={() => setIsAuthenticated(false)} className="btn btn-danger">
            Logout
          </button>
        </div>
      </div>

      {/* Status Messages */}
      {error && (
        <div className="error-message" style={{ marginBottom: '20px' }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ 
          color: '#155724', 
          backgroundColor: '#d4edda', 
          border: '1px solid #c3e6cb', 
          padding: '10px', 
          borderRadius: '5px', 
          marginBottom: '20px' 
        }}>
          {success}
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '10px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#007bff' }}>👥 Total Workers</h3>
            <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{stats.totalWorkers}</div>
          </div>
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '10px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#28a745' }}>✅ Available</h3>
            <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{stats.availableWorkers}</div>
          </div>
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '10px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#ffc107' }}>💬 Active Chats</h3>
            <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{stats.activeChats}</div>
          </div>
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '10px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#dc3545' }}>📞 Callbacks</h3>
            <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{stats.pendingCallbacks}</div>
          </div>
        </div>
      )}

      {/* Workers Management */}
      <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '10px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0 }}>Worker Management</h2>
          <button 
            onClick={() => setShowRegisterForm(!showRegisterForm)} 
            className="btn btn-primary"
          >
            {showRegisterForm ? 'Cancel' : '+ Add Worker'}
          </button>
        </div>

        {/* Register Form */}
        {showRegisterForm && (
          <div style={{ 
            backgroundColor: '#f8f9fa', 
            padding: '20px', 
            borderRadius: '8px', 
            marginBottom: '20px',
            border: '1px solid #dee2e6'
          }}>
            <h3 style={{ marginTop: 0 }}>Register New Worker</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '15px', alignItems: 'end' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Username</label>
                <input
                  type="text"
                  value={registerForm.username}
                  onChange={(e) => setRegisterForm({...registerForm, username: e.target.value})}
                  className="form-input"
                  placeholder="Enter username"
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Password</label>
                <input
                  type="password"
                  value={registerForm.password}
                  onChange={(e) => setRegisterForm({...registerForm, password: e.target.value})}
                  className="form-input"
                  placeholder="Enter password"
                />
              </div>
              <button onClick={registerWorker} className="btn btn-primary">
                Register
              </button>
            </div>
          </div>
        )}

        {/* Workers Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8f9fa' }}>
                <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #dee2e6' }}>ID</th>
                <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #dee2e6' }}>Username</th>
                <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #dee2e6' }}>Status</th>
                <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #dee2e6' }}>Current Chat</th>
                <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #dee2e6' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((worker) => (
                <tr key={worker.id} style={{ borderBottom: '1px solid #dee2e6' }}>
                  <td style={{ padding: '12px' }}>{worker.id}</td>
                  <td style={{ padding: '12px', fontWeight: 'bold' }}>{worker.username}</td>
                  <td style={{ padding: '12px' }}>
                    <span style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      backgroundColor: 
                        worker.status === 'available' ? '#d4edda' :
                        worker.status === 'busy' ? '#fff3cd' : '#f8d7da',
                      color:
                        worker.status === 'available' ? '#155724' :
                        worker.status === 'busy' ? '#856404' : '#721c24'
                    }}>
                      {worker.status.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '12px' }}>
                    {worker.currentCustomer ? `Customer ${worker.currentCustomer}` : '-'}
                  </td>
                  <td style={{ padding: '12px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => setShowPasswordForm(worker.id)}
                        style={{
                          padding: '4px 8px',
                          fontSize: '12px',
                          backgroundColor: '#ffc107',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      >
                        🔑 Password
                      </button>
                      <button
                        onClick={() => deleteWorker(worker.id, worker.username)}
                        disabled={worker.currentCustomer}
                        style={{
                          padding: '4px 8px',
                          fontSize: '12px',
                          backgroundColor: worker.currentCustomer ? '#ccc' : '#dc3545',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: worker.currentCustomer ? 'not-allowed' : 'pointer'
                        }}
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {workers.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
            No workers found
          </div>
        )}
      </div>

      {/* Password Update Modal */}
      {showPasswordForm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '30px',
            borderRadius: '10px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            maxWidth: '400px',
            width: '90%'
          }}>
            <h3 style={{ marginTop: 0 }}>Update Password</h3>
            <p>Worker: {workers.find(w => w.id === showPasswordForm)?.username}</p>
            
            <div className="form-group">
              <label>New Password</label>
              <input
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({newPassword: e.target.value})}
                className="form-input"
                placeholder="Enter new password"
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowPasswordForm(null);
                  setPasswordForm({newPassword: ''});
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => updatePassword(showPasswordForm)}
                className="btn btn-primary"
              >
                Update
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Refresh Button */}
      <div style={{ textAlign: 'center', marginTop: '30px' }}>
        <button onClick={loadData} className="btn" style={{ backgroundColor: '#28a745', color: 'white' }}>
          🔄 Refresh Data
        </button>
      </div>
    </div>
  );
};

// Chat Rating Component
const ChatRating = ({ customerData, onRatingComplete }) => {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const submitRating = async () => {
    if (rating === 0) {
      alert('Please select a rating');
      return;
    }

    setIsSubmitting(true);

    try {
      const ratingData = {
        roomId: customerData.roomId,
        customerId: customerData.customerId,
        workerId: customerData.workerId,
        workerName: customerData.workerName,
        rating: rating,
        feedback: feedback.trim()
      };

      const response = await fetch(`${API_BASE}/api/chat/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ratingData)
      });

      if (response.ok) {
        setSubmitted(true);
        setTimeout(() => {
          onRatingComplete();
        }, 3000);
      } else {
        alert('Failed to submit rating. Please try again.');
      }
    } catch (error) {
      console.error('Error submitting rating:', error);
      alert('Failed to submit rating. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStarClick = (starRating) => {
    setRating(starRating);
  };

  const handleStarHover = (starRating) => {
    setHoverRating(starRating);
  };

  const handleStarLeave = () => {
    setHoverRating(0);
  };

  if (submitted) {
    return (
      <div className="rating-container">
        <div className="rating-content">
          <div className="rating-success">
            <div style={{ fontSize: '64px', marginBottom: '20px' }}>🎉</div>
            <h2>Thank You!</h2>
            <p>Your feedback helps us improve our service.</p>
            <div className="rating-display">
              <div className="stars-display">
                {[1, 2, 3, 4, 5].map((star) => (
                  <span key={star} style={{ fontSize: '24px', color: star <= rating ? '#ffc107' : '#e0e0e0' }}>
                    ⭐
                  </span>
                ))}
              </div>
              <p style={{ marginTop: '10px', color: '#666' }}>
                {rating === 5 ? 'Excellent!' : rating === 4 ? 'Very Good!' : rating === 3 ? 'Good!' : rating === 2 ? 'Fair' : 'Needs Improvement'}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rating-container">
      <div className="rating-content">
        <div className="rating-header">
          <h2>Rate Your Experience</h2>
          <p>How was your chat with {customerData?.workerName || 'our support team'}?</p>
        </div>

        <div className="rating-stars">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              className="star-button"
              onClick={() => handleStarClick(star)}
              onMouseEnter={() => handleStarHover(star)}
              onMouseLeave={handleStarLeave}
              style={{
                fontSize: '36px',
                color: star <= (hoverRating || rating) ? '#ffc107' : '#e0e0e0',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '5px',
                transition: 'color 0.2s'
              }}
            >
              ⭐
            </button>
          ))}
        </div>

        <div className="rating-labels">
          <span style={{ fontSize: '14px', color: '#666' }}>
            {(hoverRating || rating) === 5 ? 'Excellent!' : 
             (hoverRating || rating) === 4 ? 'Very Good!' : 
             (hoverRating || rating) === 3 ? 'Good!' : 
             (hoverRating || rating) === 2 ? 'Fair' : 
             (hoverRating || rating) === 1 ? 'Needs Improvement' : 
             'Select a rating'}
          </span>
        </div>

        <div className="rating-feedback">
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Additional Feedback (Optional)
          </label>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Tell us more about your experience..."
            rows={4}
            style={{
              width: '100%',
              padding: '12px',
              border: '1px solid #ddd',
              borderRadius: '8px',
              fontSize: '16px',
              resize: 'vertical',
              fontFamily: 'inherit'
            }}
            maxLength={500}
          />
          <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
            {feedback.length}/500 characters
          </div>
        </div>

        <div className="rating-actions">
          <button
            onClick={submitRating}
            disabled={rating === 0 || isSubmitting}
            style={{
              backgroundColor: rating === 0 ? '#ccc' : '#007bff',
              color: 'white',
              border: 'none',
              padding: '12px 24px',
              borderRadius: '8px',
              fontSize: '16px',
              cursor: rating === 0 ? 'not-allowed' : 'pointer',
              width: '100%',
              marginBottom: '10px'
            }}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Rating'}
          </button>
          
          <button
            onClick={onRatingComplete}
            style={{
              backgroundColor: 'transparent',
              color: '#666',
              border: 'none',
              padding: '8px',
              fontSize: '14px',
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            Skip Rating
          </button>
        </div>
      </div>
    </div>
  );
};

// Customer Chat Component
const CustomerChat = ({ setCurrentView }) => {
  const [chatState, setChatState] = useState('connecting');
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [customerData, setCustomerData] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const [workerTyping, setWorkerTyping] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [showRating, setShowRating] = useState(false);
  const [chatEnded, setChatEnded] = useState(false);
  const messagesEndRef = useRef(null);
  const socketRef = useRef(null);
  const hasJoined = useRef(false);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const chatContainerRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (hasJoined.current) return;
    hasJoined.current = true;
    
    joinChat();
    
    return () => {
      console.log('🧹 Customer chat cleanup...');
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  const joinChat = async () => {
    setChatState('connecting');
    
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('🔄 Customer attempting to join chat...');
      const response = await fetch(`${API_BASE}/api/customer/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await response.json();
      console.log('📥 Customer join response:', data);
      
      if (data.status === 'connected') {
        setCustomerData(data);
        setChatState('connected');
        connectSocket(data);
      } else {
        setChatState('busy');
        setCustomerData(data);
      }
    } catch (error) {
      console.error('Error joining chat:', error);
      setChatState('busy');
    }
  };

  const connectSocket = (data) => {
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
    }

    console.log('🔌 Customer creating socket connection...');
    socketRef.current = io(API_BASE, {
      forceNew: true,
      transports: ['polling'],
      upgrade: false
    });
    
    socketRef.current.on('connect', () => {
      console.log('✅ Customer socket connected');
      setIsConnected(true);
      socketRef.current.emit('customer-join', {
        customerId: data.customerId,
        roomId: data.roomId
      });
    });

    socketRef.current.on('disconnect', (reason) => {
      console.log('❌ Customer socket disconnected:', reason);
      setIsConnected(false);
    });

    socketRef.current.on('connect_error', (error) => {
      console.log('🚫 Customer socket connection error:', error);
      setIsConnected(false);
    });
    
    socketRef.current.on('new-message', (message) => {
      console.log('📨 New message received:', message);
      setMessages(prev => [...prev, message]);
      
      // Play sound and show notification for incoming messages
      if (message.sender !== 'customer') {
        if (soundEnabled) {
          // Play different sounds for different message types
          switch (message.messageType) {
            case 'image':
            case 'file':
              soundManager.playSound('file');
              break;
            case 'voice':
              soundManager.playSound('voice');
              break;
            default:
              soundManager.playSound('message');
          }
        }

        // Show browser notification
        if (notificationsEnabled) {
          const workerName = customerData?.workerName || 'Support Agent';
          let notificationBody = message.message;
          let notificationIcon = '💬';

          switch (message.messageType) {
            case 'image':
              notificationBody = 'Sent an image';
              notificationIcon = '🖼️';
              break;
            case 'file':
              notificationBody = `Sent a file: ${message.fileData?.originalname || 'document'}`;
              notificationIcon = '📎';
              break;
            case 'voice':
              notificationBody = 'Sent a voice note';
              notificationIcon = '🎤';
              break;
          }

          notificationManager.show(
            `${workerName}`,
            notificationBody,
            notificationIcon
          );
        }
      }
      
      // Send delivery confirmation
      if (message.sender !== 'customer' && customerData?.roomId) {
        setTimeout(() => {
          socketRef.current.emit('message-read', {
            roomId: customerData.roomId,
            messageId: message.id
          });
        }, 1000);
      }
    });
    
    socketRef.current.on('user-typing', (data) => {
      if (data.sender === 'worker') {
        setWorkerTyping(data.typing);
        
        // Play subtle typing sound
        if (data.typing && soundEnabled) {
          soundManager.playSound('typing');
        }
        
        if (data.typing) {
          // Auto-hide typing indicator after 3 seconds
          setTimeout(() => setWorkerTyping(false), 3000);
        }
      }
    });
    
    socketRef.current.on('message-status-update', (data) => {
      setMessages(prev => prev.map(msg => 
        msg.id === data.messageId ? { ...msg, status: data.status } : msg
      ));
    });
    
    socketRef.current.on('chat-ended', (data) => {
      console.log('🔚 Chat ended by worker');
      setMessages(prev => [...prev, {
        id: Date.now(),
        message: data.message,
        sender: 'system',
        timestamp: new Date()
      }]);
      
      // Show rating interface after a short delay
      setTimeout(() => {
        setChatEnded(true);
        setShowRating(true);
      }, 2000);
    });
  };

  const sendMessage = () => {
    if (!newMessage.trim() || !customerData || !socketRef.current?.connected) return;
    
    const messageData = {
      roomId: customerData.roomId,
      message: newMessage,
      sender: 'customer',
      senderId: customerData.customerId,
      messageType: 'text',
      status: 'sent'
    };
    
    console.log('📤 Sending message:', messageData);
    socketRef.current.emit('send-message', messageData);
    
    // Stop typing indicator
    handleTypingStop();
    setNewMessage('');
  };

  const handleTypingStart = () => {
    if (!isTyping && socketRef.current?.connected && customerData) {
      setIsTyping(true);
      socketRef.current.emit('typing-start', {
        roomId: customerData.roomId,
        sender: 'customer'
      });
    }
  };

  const handleTypingStop = () => {
    if (isTyping && socketRef.current?.connected && customerData) {
      setIsTyping(false);
      socketRef.current.emit('typing-stop', {
        roomId: customerData.roomId,
        sender: 'customer'
      });
    }
  };

  const handleInputChange = (e) => {
    setNewMessage(e.target.value);
    
    // Handle typing indicators
    if (e.target.value.length > 0) {
      handleTypingStart();
      
      // Reset typing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      
      // Stop typing after 2 seconds of inactivity
      typingTimeoutRef.current = setTimeout(() => {
        handleTypingStop();
      }, 2000);
    } else {
      handleTypingStop();
    }
  };

  const getMessageStatusIcon = (status) => {
    switch (status) {
      case 'sent': return '✓';
      case 'delivered': return '✓✓';
      case 'read': return '✓✓';
      default: return '';
    }
  };

  const getMessageStatusColor = (status) => {
    switch (status) {
      case 'sent': return '#999';
      case 'delivered': return '#999';  
      case 'read': return '#007bff';
      default: return '#999';
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file || !customerData || !socketRef.current?.connected) return;

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const fileInfo = await response.json();
        const messageType = file.type.startsWith('image/') ? 'image' : 'file';
        
        console.log('📎 File upload response:', fileInfo);
        console.log('🔍 Message type detected:', messageType);
        console.log('🔗 File URL:', fileInfo.secure_url || fileInfo.url);
        
        const messageData = {
          roomId: customerData.roomId,
          message: messageType === 'image' ? 'Image' : file.name,
          sender: 'customer',
          senderId: customerData.customerId,
          messageType,
          fileData: {
            ...fileInfo,
            url: fileInfo.secure_url || fileInfo.url // Use Cloudinary URL directly
          }
        };

        console.log('📤 Sending file message:', messageData);
        socketRef.current.emit('send-message', messageData);
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Failed to upload file');
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (event) => {
        chunks.push(event.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
        await sendVoiceNote(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setMediaRecorder(recorder);
      setAudioChunks(chunks);
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Could not access microphone');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  const sendVoiceNote = async (audioBlob) => {
    if (!customerData || !socketRef.current?.connected) return;

    try {
      const formData = new FormData();
      formData.append('voice', audioBlob, 'voice-note.webm');

      const response = await fetch(`${API_BASE}/api/upload-voice`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const voiceInfo = await response.json();
        
        const messageData = {
          roomId: customerData.roomId,
          message: 'Voice note',
          sender: 'customer',
          senderId: customerData.customerId,
          messageType: 'voice',
          fileData: {
            ...voiceInfo,
            url: voiceInfo.secure_url || voiceInfo.url // Use Cloudinary URL directly
          }
        };

        console.log('📤 Sending voice note:', messageData);
        socketRef.current.emit('send-message', messageData);
      }
    } catch (error) {
      console.error('Error uploading voice note:', error);
      alert('Failed to upload voice note');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  const reconnect = () => {
    if (customerData) {
      console.log('🔄 Manual reconnect...');
      connectSocket(customerData);
    }
  };

  if (showRating) {
    return <ChatRating 
      customerData={customerData} 
      onRatingComplete={() => {
        setShowRating(false);
        setCurrentView('customer'); // Reset to allow new chats
      }}
    />;
  }

  if (chatState === 'connecting') {
    return (
      <div className="loading-container">
        <div className="loading-content">
          <div className="spinner"></div>
          <p>Connecting you to our customer service...</p>
        </div>
      </div>
    );
  }

  if (chatState === 'busy') {
    return (
      <div className="busy-container">
        <div className="busy-content">
          <div className="busy-icon">💬</div>
          <h2>All Agents Busy</h2>
          <p>
            All our customer service agents are currently helping other customers. 
            Would you like to request a callback?
          </p>
          <button
            onClick={() => setCurrentView('callback')}
            className="btn btn-primary"
          >
            Request Callback
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-container">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-content">
          <span className="chat-icon">💬</span>
          <div>
            <h1>Customer Support</h1>
            <p>Connected to {customerData?.workerName || 'Agent'}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ fontSize: '12px', opacity: 0.8 }}>
              <div className={`status-dot ${isConnected ? 'status-available' : 'status-busy'}`} style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', marginRight: '5px' }}></div>
              {isConnected ? 'Connected' : 'Connecting...'}
            </div>
            
            {/* Sound Controls */}
            <div style={{ display: 'flex', gap: '5px' }}>
              <button
                onClick={() => {
                  const newState = soundManager.toggle();
                  setSoundEnabled(newState);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '16px',
                  opacity: soundEnabled ? 1 : 0.5,
                  padding: '2px'
                }}
                title={soundEnabled ? 'Sounds ON' : 'Sounds OFF'}
              >
                {soundEnabled ? '🔊' : '🔇'}
              </button>
              
              <button
                onClick={() => {
                  const newState = notificationManager.toggle();
                  setNotificationsEnabled(newState);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '16px',
                  opacity: notificationsEnabled ? 1 : 0.5,
                  padding: '2px'
                }}
                title={notificationsEnabled ? 'Notifications ON' : 'Notifications OFF'}
              >
                {notificationsEnabled ? '🔔' : '🔕'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="messages-container" ref={chatContainerRef}>
        {messages.length === 0 && (
          <div className="welcome-message">
            <p>Welcome! How can we help you today?</p>
          </div>
        )}
        
        {messages.map((message) => (
          <div
            key={message.id}
            className={`message ${message.sender === 'customer' ? 'message-customer' : 
                       message.sender === 'system' ? 'message-system' : 'message-worker'}`}
          >
            <div className="message-content">
              {message.messageType === 'text' && <p>{message.message}</p>}
              
              {message.messageType === 'image' && (
                <div>
                  <img 
                    src={message.fileData.url} 
                    alt="Shared image"
                    style={{ maxWidth: '200px', maxHeight: '200px', borderRadius: '8px', cursor: 'pointer' }}
                    onClick={() => window.open(message.fileData.url, '_blank')}
                    onError={(e) => {
                      console.error('Image failed to load:', message.fileData.url);
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'block';
                    }}
                  />
                  <div style={{ display: 'none', padding: '10px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
                    📷 Image failed to load
                    <br />
                    <a href={message.fileData.url} target="_blank" rel="noopener noreferrer">
                      View image
                    </a>
                  </div>
                </div>
              )}
              
              {message.messageType === 'file' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>📎</span>
                  <a 
                    href={message.fileData.url} 
                    download={message.fileData.originalname}
                    style={{ color: message.sender === 'customer' ? 'white' : '#007bff', textDecoration: 'underline' }}
                  >
                    {message.fileData.originalname}
                  </a>
                  <span style={{ fontSize: '12px', opacity: 0.7 }}>
                    ({(message.fileData.size / 1024).toFixed(1)} KB)
                  </span>
                </div>
              )}
              
              {message.messageType === 'voice' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🎤</span>
                  <audio controls style={{ maxWidth: '200px' }}>
                    <source src={message.fileData.url} type="audio/webm" />
                    <source src={message.fileData.url} type="audio/mp3" />
                    Your browser does not support audio playback.
                  </audio>
                </div>
              )}
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                <span className="message-time">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </span>
                {message.sender === 'customer' && (
                  <span 
                    style={{ 
                      fontSize: '12px', 
                      color: getMessageStatusColor(message.status),
                      marginLeft: '8px' 
                    }}
                  >
                    {getMessageStatusIcon(message.status)}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        
        {/* Typing Indicator */}
        {workerTyping && (
          <div className="message message-worker">
            <div className="message-content">
              <div className="typing-indicator">
                <span>Worker is typing</span>
                <div className="typing-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="input-container">
        <div className="input-wrapper">
          {/* Hidden file input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="image/*,.pdf,.doc,.docx,.txt"
            style={{ display: 'none' }}
          />
          
          {/* File upload button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!isConnected}
            style={{ 
              padding: '8px 12px', 
              backgroundColor: '#6c757d', 
              color: 'white', 
              border: 'none', 
              borderRadius: '5px', 
              fontSize: '14px',
              cursor: isConnected ? 'pointer' : 'not-allowed',
              opacity: isConnected ? 1 : 0.5,
              marginRight: '8px'
            }}
            title="Upload file or image"
          >
            📎
          </button>

          {/* Voice recording button */}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={!isConnected}
            style={{ 
              padding: '8px 12px', 
              backgroundColor: isRecording ? '#dc3545' : '#28a745', 
              color: 'white', 
              border: 'none', 
              borderRadius: '5px', 
              fontSize: '14px',
              cursor: isConnected ? 'pointer' : 'not-allowed',
              opacity: isConnected ? 1 : 0.5,
              marginRight: '8px',
              animation: isRecording ? 'pulse 1s infinite' : 'none'
            }}
            title={isRecording ? "Stop recording" : "Record voice note"}
          >
            {isRecording ? '⏹️' : '🎤'}
          </button>
          
          <input
            type="text"
            value={newMessage}
            onChange={handleInputChange}
            onKeyPress={handleKeyPress}
            placeholder="Type your message..."
            className="message-input"
            disabled={!isConnected}
          />
          <button
            onClick={sendMessage}
            className="send-button"
            disabled={!isConnected || !newMessage.trim()}
            style={{ opacity: (!isConnected || !newMessage.trim()) ? 0.5 : 1 }}
          >
            ➤
          </button>
          {!isConnected && (
            <button
              onClick={reconnect}
              style={{ 
                marginLeft: '5px', 
                padding: '8px 12px', 
                backgroundColor: '#28a745', 
                color: 'white', 
                border: 'none', 
                borderRadius: '5px', 
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              Reconnect
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Worker Login Component
const WorkerLogin = ({ setCurrentView }) => {
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/api/worker/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('workerToken', data.token);
        localStorage.setItem('workerData', JSON.stringify(data.worker));
        setCurrentView('worker-dashboard');
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (error) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-content">
        <div className="login-header">
          <div className="login-icon">🔐</div>
          <h2>Worker Login</h2>
          <p>Access your customer service dashboard</p>
        </div>

        <div className="login-form">
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={credentials.username}
              onChange={(e) => setCredentials({...credentials, username: e.target.value})}
              className="form-input"
            />
          </div>
          
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={credentials.password}
              onChange={(e) => setCredentials({...credentials, password: e.target.value})}
              onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
              className="form-input"
            />
          </div>

          {error && (
            <div className="error-message">{error}</div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading}
            className="btn btn-primary btn-full"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </div>

        <div className="login-footer">
          <button
            onClick={() => setCurrentView('customer')}
            className="link-button"
          >
            Back to Customer Chat
          </button>
        </div>

        <div className="demo-credentials">
          <p><strong>Demo Credentials:</strong></p>
          <p>Username: worker1</p>
          <p>Password: password123</p>
        </div>
      </div>
    </div>
  );
};

// Worker Dashboard Component  
const WorkerDashboard = ({ setCurrentView }) => {
  const [workerData, setWorkerData] = useState(null);
  const [currentChat, setCurrentChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [callbacks, setCallbacks] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [allWorkers, setAllWorkers] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const [customerTyping, setCustomerTyping] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [ratingsStats, setRatingsStats] = useState(null);
  const [showRatings, setShowRatings] = useState(false);
  const [recentFeedback, setRecentFeedback] = useState([]);
  const messagesEndRef = useRef(null);
  const socketRef = useRef(null);
  const hasInitialized = useRef(false);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('workerToken');
    const worker = JSON.parse(localStorage.getItem('workerData') || '{}');
    
    if (!token || !worker.id) {
      setCurrentView('worker-login');
      return;
    }

    if (hasInitialized.current) return;
    hasInitialized.current = true;
    
    console.log('🔐 Worker dashboard loading for:', worker.username, 'ID:', worker.id);
    setWorkerData(worker);
    
    loadWorkerStatus();
    
    setTimeout(() => {
      connectSocket(worker);
      loadCallbacks();
      loadRatingsStats();
    }, 500);

    return () => {
      console.log('🧹 Worker dashboard cleanup...');
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [setCurrentView]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadWorkerStatus = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/workers/status`);
      const data = await response.json();
      setAllWorkers(data.workers);
      console.log('👥 All workers status:', data.workers);
    } catch (error) {
      console.error('Error loading worker status:', error);
    }
  };

  const connectSocket = (worker) => {
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
    }

    console.log('🔌 Worker creating socket connection for:', worker.username);
    setConnectionStatus('connecting');
    
    socketRef.current = io(API_BASE, {
      forceNew: true,
      transports: ['polling'],
      upgrade: false
    });
    
    socketRef.current.on('connect', () => {
      console.log('✅ Worker socket connected');
      setConnectionStatus('connected');
      socketRef.current.emit('worker-join', { workerId: worker.id });
      
      setTimeout(() => loadWorkerStatus(), 500);
      setTimeout(() => loadWorkerStatus(), 1500);
      setTimeout(() => loadWorkerStatus(), 3000);
    });

    socketRef.current.on('disconnect', (reason) => {
      console.log('❌ Worker socket disconnected:', reason);
      setConnectionStatus('disconnected');
    });

    socketRef.current.on('connect_error', (error) => {
      console.log('🚫 Worker socket connection error:', error);
      setConnectionStatus('error');
    });
    
    socketRef.current.on('worker-status', (data) => {
      console.log('📊 Received worker status update:', data);
    });
    
    socketRef.current.on('customer-connected', (data) => {
      console.log('👤 Customer connected:', data.customerId);
      setCurrentChat({
        customerId: data.customerId,
        roomId: data.roomId
      });
      setMessages([]);
      setCustomerTyping(false); // Reset typing state
      
      // Play connection sound and show notification
      if (soundEnabled) {
        soundManager.playSound('connect');
      }
      
      if (notificationsEnabled) {
        notificationManager.show(
          'New Customer Connected',
          'A customer has joined the chat',
          '👤'
        );
      }
    });
    
    socketRef.current.on('new-message', (message) => {
      console.log('📨 Worker received message:', message);
      setMessages(prev => [...prev, message]);
      
      // Play sound and show notification for customer messages
      if (message.sender !== 'worker') {
        if (soundEnabled) {
          // Play different sounds for different message types
          switch (message.messageType) {
            case 'image':
            case 'file':
              soundManager.playSound('file');
              break;
            case 'voice':
              soundManager.playSound('voice');
              break;
            default:
              soundManager.playSound('message');
          }
        }

        // Show browser notification
        if (notificationsEnabled) {
          let notificationBody = message.message;
          let notificationIcon = '💬';

          switch (message.messageType) {
            case 'image':
              notificationBody = 'Customer sent an image';
              notificationIcon = '🖼️';
              break;
            case 'file':
              notificationBody = `Customer sent a file: ${message.fileData?.originalname || 'document'}`;
              notificationIcon = '📎';
              break;
            case 'voice':
              notificationBody = 'Customer sent a voice note';
              notificationIcon = '🎤';
              break;
          }

          notificationManager.show(
            'Customer Message',
            notificationBody,
            notificationIcon
          );
        }
      }
      
      // Send delivery confirmation for customer messages
      if (message.sender !== 'worker') {
        // Use a more defensive approach
        setTimeout(() => {
          if (socketRef.current && socketRef.current.connected) {
            socketRef.current.emit('message-read', {
              roomId: message.roomId || currentChat?.roomId,
              messageId: message.id
            });
          }
        }, 1000);
      }
    });
    
    socketRef.current.on('user-typing', (data) => {
      if (data.sender === 'customer') {
        setCustomerTyping(data.typing);
        
        // Play subtle typing sound
        if (data.typing && soundEnabled) {
          soundManager.playSound('typing');
        }
        
        if (data.typing) {
          // Auto-hide typing indicator after 3 seconds
          setTimeout(() => setCustomerTyping(false), 3000);
        }
      }
    });
    
    socketRef.current.on('message-status-update', (data) => {
      setMessages(prev => prev.map(msg => 
        msg.id === data.messageId ? { ...msg, status: data.status } : msg
      ));
    });
    
    socketRef.current.on('customer-disconnected', () => {
      console.log('👋 Customer disconnected');
      setCurrentChat(null);
      setMessages([]);
      setCustomerTyping(false);
    });
    
    socketRef.current.on('new-callback', (callback) => {
      setCallbacks(prev => [callback, ...prev]);
      
      // Play sound and show notification for new callback requests
      if (soundEnabled) {
        soundManager.playSound('connect'); // Use connect sound for callbacks
      }
      
      if (notificationsEnabled) {
        notificationManager.show(
          'New Callback Request',
          `${callback.name} - ${callback.phone}`,
          '📞'
        );
      }
    });

    socketRef.current.on('chat-rated', (data) => {
      console.log('⭐ Chat received rating:', data.rating);
      
      // Play sound for rating received
      if (soundEnabled) {
        soundManager.playSound('connect');
      }
      
      // Show notification
      if (notificationsEnabled) {
        notificationManager.show(
          'Chat Rated',
          `Received ${data.rating}/5 stars${data.feedback ? ' with feedback' : ''}`,
          '⭐'
        );
      }
      
      // Refresh ratings stats
      setTimeout(() => {
        loadRatingsStats();
      }, 1000);
    });
  };

  const loadRatingsStats = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/ratings/stats`);
      const stats = await response.json();
      setRatingsStats(stats);
    } catch (error) {
      console.error('Error loading ratings stats:', error);
    }
  };

  const loadRecentFeedback = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/ratings/feedback`);
      const feedback = await response.json();
      setRecentFeedback(feedback);
    } catch (error) {
      console.error('Error loading feedback:', error);
    }
  };

  const loadCallbacks = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/worker/callbacks`);
      const data = await response.json();
      setCallbacks(data);
    } catch (error) {
      console.error('Error loading callbacks:', error);
    }
  };

  const sendMessage = () => {
    if (!newMessage.trim() || !currentChat || !socketRef.current?.connected) return;
    
    const messageData = {
      roomId: currentChat.roomId,
      message: newMessage,
      sender: 'worker',
      senderId: workerData.id,
      messageType: 'text',
      status: 'sent'
    };
    
    console.log('📤 Worker sending message:', messageData);
    socketRef.current.emit('send-message', messageData);
    
    // Stop typing indicator
    handleTypingStop();
    setNewMessage('');
  };

  const handleTypingStart = () => {
    if (!isTyping && socketRef.current?.connected && currentChat) {
      setIsTyping(true);
      socketRef.current.emit('typing-start', {
        roomId: currentChat.roomId,
        sender: 'worker'
      });
    }
  };

  const handleTypingStop = () => {
    if (isTyping && socketRef.current?.connected && currentChat) {
      setIsTyping(false);
      socketRef.current.emit('typing-stop', {
        roomId: currentChat.roomId,
        sender: 'worker'
      });
    }
  };

  const handleInputChange = (e) => {
    setNewMessage(e.target.value);
    
    // Handle typing indicators
    if (e.target.value.length > 0) {
      handleTypingStart();
      
      // Reset typing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      
      // Stop typing after 2 seconds of inactivity
      typingTimeoutRef.current = setTimeout(() => {
        handleTypingStop();
      }, 2000);
    } else {
      handleTypingStop();
    }
  };

  const getMessageStatusIcon = (status) => {
    switch (status) {
      case 'sent': return '✓';
      case 'delivered': return '✓✓';
      case 'read': return '✓✓';
      default: return '';
    }
  };

  const getMessageStatusColor = (status) => {
    switch (status) {
      case 'sent': return '#999';
      case 'delivered': return '#999';  
      case 'read': return '#007bff';
      default: return '#999';
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file || !currentChat || !socketRef.current?.connected) return;

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const fileInfo = await response.json();
        const messageType = file.type.startsWith('image/') ? 'image' : 'file';
        
        console.log('📎 Worker file upload response:', fileInfo);
        console.log('🔍 Message type detected:', messageType);
        console.log('🔗 File URL:', fileInfo.secure_url || fileInfo.url);
        
        const messageData = {
          roomId: currentChat.roomId,
          message: messageType === 'image' ? 'Image' : file.name,
          sender: 'worker',
          senderId: workerData.id,
          messageType,
          fileData: {
            ...fileInfo,
            url: fileInfo.secure_url || fileInfo.url // Use Cloudinary URL directly
          }
        };

        console.log('📤 Worker sending file message:', messageData);
        socketRef.current.emit('send-message', messageData);
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Failed to upload file');
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (event) => {
        chunks.push(event.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
        await sendVoiceNote(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setMediaRecorder(recorder);
      setAudioChunks(chunks);
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Could not access microphone');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  const sendVoiceNote = async (audioBlob) => {
    if (!currentChat || !socketRef.current?.connected) return;

    try {
      const formData = new FormData();
      formData.append('voice', audioBlob, 'voice-note.webm');

      const response = await fetch(`${API_BASE}/api/upload-voice`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const voiceInfo = await response.json();
        
        const messageData = {
          roomId: currentChat.roomId,
          message: 'Voice note',
          sender: 'worker',
          senderId: workerData.id,
          messageType: 'voice',
          fileData: {
            ...voiceInfo,
            url: voiceInfo.secure_url || voiceInfo.url // Use Cloudinary URL directly
          }
        };

        console.log('📤 Worker sending voice note:', messageData);
        socketRef.current.emit('send-message', messageData);
      }
    } catch (error) {
      console.error('Error uploading voice note:', error);
      alert('Failed to upload voice note');
    }
  };

  const endChat = () => {
    if (!currentChat || !socketRef.current?.connected) return;
    
    socketRef.current.emit('end-chat', {
      roomId: currentChat.roomId,
      workerId: workerData.id
    });
    
    setCurrentChat(null);
    setMessages([]);
  };

  const logout = () => {
    localStorage.removeItem('workerToken');
    localStorage.removeItem('workerData');
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setCurrentView('worker-login');
  };

  const rejoinSocket = () => {
    console.log('🔄 Manually rejoining as worker...');
    if (socketRef.current?.connected) {
      socketRef.current.emit('worker-join', { workerId: workerData?.id });
    } else {
      connectSocket(workerData);
    }
    setTimeout(loadWorkerStatus, 1000);
  };

  if (!workerData) {
    return <div>Loading...</div>;
  }

  return (
    <div className="dashboard-container">
      {/* Sidebar */}
      <div className="dashboard-sidebar">
        {/* Header */}
        <div className="sidebar-header">
          <div className="sidebar-header-content">
            <div>
              <h2>Worker Dashboard</h2>
              <p>Welcome, {workerData.username}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Sound Controls */}
              <button
                onClick={() => {
                  const newState = soundManager.toggle();
                  setSoundEnabled(newState);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: soundEnabled ? 'white' : '#a0aec0',
                  cursor: 'pointer',
                  fontSize: '16px',
                  padding: '2px'
                }}
                title={soundEnabled ? 'Sounds ON' : 'Sounds OFF'}
              >
                {soundEnabled ? '🔊' : '🔇'}
              </button>
              
              <button
                onClick={() => {
                  const newState = notificationManager.toggle();
                  setNotificationsEnabled(newState);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: notificationsEnabled ? 'white' : '#a0aec0',
                  cursor: 'pointer',
                  fontSize: '16px',
                  padding: '2px'
                }}
                title={notificationsEnabled ? 'Notifications ON' : 'Notifications OFF'}
              >
                {notificationsEnabled ? '🔔' : '🔕'}
              </button>
              
              <button onClick={logout} className="logout-button">
                🚪
              </button>
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="sidebar-status">
          <div className="status-indicator">
            <div className={`status-dot ${currentChat ? 'status-busy' : 'status-available'}`}></div>
            <span>{currentChat ? 'In Chat' : 'Available'}</span>
          </div>
          <div style={{ marginTop: '10px', fontSize: '12px', color: '#a0aec0' }}>
            Socket: {connectionStatus}
          </div>
        </div>

        {/* Debug Section */}
        <div style={{ padding: '15px', borderBottom: '1px solid #4a5568', fontSize: '12px' }}>
          <h4 style={{ marginBottom: '10px', color: '#e2e8f0' }}>Debug Info:</h4>
          <div style={{ color: '#a0aec0' }}>
            <div>My ID: {workerData?.id}</div>
            <div>My Status: {allWorkers.find(w => w.id === workerData?.id)?.status || 'unknown'}</div>
            <div style={{ marginTop: '8px' }}>
              <button 
                onClick={loadWorkerStatus}
                style={{ marginRight: '5px', padding: '2px 8px', fontSize: '10px', backgroundColor: '#4a5568', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
              >
                Refresh Status
              </button>
              <button 
                onClick={rejoinSocket}
                style={{ padding: '2px 8px', fontSize: '10px', backgroundColor: '#48bb78', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
              >
                Rejoin
              </button>
            </div>
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>All Workers:</div>
              {allWorkers.map(w => (
                <div key={w.id} style={{ fontSize: '11px', color: w.status === 'available' ? '#48bb78' : '#f56565' }}>
                  {w.username}: {w.status}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Ratings Section */}
        <div style={{ padding: '15px', borderBottom: '1px solid #4a5568', fontSize: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h4 style={{ color: '#e2e8f0', margin: 0 }}>Ratings & Feedback</h4>
            <button
              onClick={() => {
                setShowRatings(!showRatings);
                if (!showRatings && !recentFeedback.length) {
                  loadRecentFeedback();
                }
              }}
              style={{ 
                background: 'none', 
                border: 'none', 
                color: '#a0aec0', 
                cursor: 'pointer', 
                fontSize: '16px' 
              }}
            >
              {showRatings ? '▼' : '▶'}
            </button>
          </div>
          
          {ratingsStats && (
            <div style={{ color: '#a0aec0', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>⭐</span>
                <span>{ratingsStats.averageRating}/5.0</span>
                <span style={{ fontSize: '10px' }}>({ratingsStats.totalRatings} ratings)</span>
              </div>
              {ratingsStats.workerStats[workerData?.id] && (
                <div style={{ fontSize: '10px', marginTop: '4px' }}>
                  My Average: {ratingsStats.workerStats[workerData.id].averageRating}/5.0
                  ({ratingsStats.workerStats[workerData.id].totalRatings} ratings)
                </div>
              )}
            </div>
          )}

          {showRatings && (
            <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
              {recentFeedback.length > 0 ? (
                recentFeedback.slice(0, 5).map((feedback) => (
                  <div key={feedback.id} style={{ 
                    backgroundColor: '#4a5568', 
                    padding: '8px', 
                    borderRadius: '4px', 
                    marginBottom: '6px',
                    fontSize: '11px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <div>
                        {'⭐'.repeat(feedback.rating)}
                        <span style={{ color: '#a0aec0', marginLeft: '5px' }}>
                          {feedback.workerName}
                        </span>
                      </div>
                      <span style={{ fontSize: '10px', color: '#a0aec0' }}>
                        {new Date(feedback.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    {feedback.feedback && (
                      <div style={{ color: '#e2e8f0', fontStyle: 'italic' }}>
                        "{feedback.feedback}"
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p style={{ color: '#a0aec0', fontSize: '11px', fontStyle: 'italic' }}>
                  No feedback yet
                </p>
              )}
            </div>
          )}
        </div>

        {/* Callbacks */}
        <div className="sidebar-callbacks">
          <div className="callbacks-content">
            <h3>Pending Callbacks ({callbacks.length})</h3>
            <div className="callbacks-list">
              {callbacks.map((callback) => (
                <div key={callback.id} className="callback-item">
                  <p className="callback-name">{callback.name}</p>
                  <p className="callback-phone">{callback.phone}</p>
                  <p className="callback-time">
                    {new Date(callback.requestedAt).toLocaleString()}
                  </p>
                </div>
              ))}
              {callbacks.length === 0 && (
                <p className="no-callbacks">No pending callbacks</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="dashboard-main">
        {currentChat ? (
          <>
            {/* Chat Header */}
            <div className="dashboard-chat-header">
              <div className="chat-header-info">
                <span className="user-icon">👤</span>
                <span>Customer Chat</span>
              </div>
              <button
                onClick={endChat}
                className="btn btn-danger"
              >
                End Chat
              </button>
            </div>

            {/* Messages */}
            <div className="dashboard-messages">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`dashboard-message ${
                    message.sender === 'worker' ? 'dashboard-message-worker' : 'dashboard-message-customer'
                  }`}
                >
                  <div className="dashboard-message-content">
                    {message.messageType === 'text' && <p>{message.message}</p>}
                    
                    {message.messageType === 'image' && (
                      <div>
                        <img 
                          src={message.fileData.url} 
                          alt="Shared image"
                          style={{ maxWidth: '200px', maxHeight: '200px', borderRadius: '8px', cursor: 'pointer' }}
                          onClick={() => window.open(message.fileData.url, '_blank')}
                          onError={(e) => {
                            console.error('Image failed to load:', message.fileData.url);
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'block';
                          }}
                        />
                        <div style={{ display: 'none', padding: '10px', backgroundColor: '#f0f0f0', borderRadius: '8px' }}>
                          📷 Image failed to load
                          <br />
                          <a href={message.fileData.url} target="_blank" rel="noopener noreferrer">
                            View image
                          </a>
                        </div>
                      </div>
                    )}
                    
                    {message.messageType === 'file' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>📎</span>
                        <a 
                          href={message.fileData.url} 
                          download={message.fileData.originalname}
                          style={{ color: message.sender === 'worker' ? 'white' : '#007bff', textDecoration: 'underline' }}
                        >
                          {message.fileData.originalname}
                        </a>
                        <span style={{ fontSize: '12px', opacity: 0.7 }}>
                          ({(message.fileData.size / 1024).toFixed(1)} KB)
                        </span>
                      </div>
                    )}
                    
                    {message.messageType === 'voice' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>🎤</span>
                        <audio controls style={{ maxWidth: '200px' }}>
                          <source src={message.fileData.url} type="audio/webm" />
                          <source src={message.fileData.url} type="audio/mp3" />
                          Your browser does not support audio playback.
                        </audio>
                      </div>
                    )}
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                      <span className="dashboard-message-time">
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </span>
                      {message.sender === 'worker' && (
                        <span 
                          style={{ 
                            fontSize: '12px', 
                            color: getMessageStatusColor(message.status),
                            marginLeft: '8px' 
                          }}
                        >
                          {getMessageStatusIcon(message.status)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              
              {/* Typing Indicator */}
              {customerTyping && (
                <div className="dashboard-message dashboard-message-customer">
                  <div className="dashboard-message-content">
                    <div className="typing-indicator">
                      <span>Customer is typing</span>
                      <div className="typing-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="dashboard-input">
              <div className="dashboard-input-wrapper">
                {/* Hidden file input */}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept="image/*,.pdf,.doc,.docx,.txt"
                  style={{ display: 'none' }}
                />
                
                {/* File upload button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!socketRef.current?.connected}
                  style={{ 
                    padding: '8px 12px', 
                    backgroundColor: '#6c757d', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: '5px', 
                    fontSize: '14px',
                    cursor: socketRef.current?.connected ? 'pointer' : 'not-allowed',
                    opacity: socketRef.current?.connected ? 1 : 0.5,
                    marginRight: '8px'
                  }}
                  title="Upload file or image"
                >
                  📎
                </button>

                {/* Voice recording button */}
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={!socketRef.current?.connected}
                  style={{ 
                    padding: '8px 12px', 
                    backgroundColor: isRecording ? '#dc3545' : '#28a745', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: '5px', 
                    fontSize: '14px',
                    cursor: socketRef.current?.connected ? 'pointer' : 'not-allowed',
                    opacity: socketRef.current?.connected ? 1 : 0.5,
                    marginRight: '8px',
                    animation: isRecording ? 'pulse 1s infinite' : 'none'
                  }}
                  title={isRecording ? "Stop recording" : "Record voice note"}
                >
                  {isRecording ? '⏹️' : '🎤'}
                </button>
                
                <input
                  type="text"
                  value={newMessage}
                  onChange={handleInputChange}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Type your message..."
                  className="dashboard-message-input"
                  disabled={!socketRef.current?.connected}
                />
                <button
                  onClick={sendMessage}
                  className="dashboard-send-button"
                  disabled={!socketRef.current?.connected || !newMessage.trim()}
                  style={{ opacity: (!socketRef.current?.connected || !newMessage.trim()) ? 0.5 : 1 }}
                >
                  ➤
                </button>
                {!socketRef.current?.connected && (
                  <button
                    onClick={() => connectSocket(workerData)}
                    style={{ 
                      marginLeft: '5px', 
                      padding: '8px 12px', 
                      backgroundColor: '#28a745', 
                      color: 'white', 
                      border: 'none', 
                      borderRadius: '5px', 
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    Reconnect
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="dashboard-waiting">
            <div className="waiting-content">
              <div className="waiting-icon">👥</div>
              <h3>Waiting for customers</h3>
              <p>You'll be automatically connected when a customer needs help</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Callback Form Component
const CallbackForm = ({ setCurrentView }) => {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    message: ''
  });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!formData.name || !formData.phone) {
      alert('Please fill in required fields');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        setSubmitted(true);
      }
    } catch (error) {
      console.error('Error submitting callback:', error);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="callback-container">
        <div className="callback-content">
          <div className="success-icon">✅</div>
          <h2>Request Submitted!</h2>
          <p>Thank you! We'll get back to you as soon as possible.</p>
          <button
            onClick={() => setCurrentView('customer')}
            className="btn btn-primary"
          >
            Back to Chat
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="callback-container">
      <div className="callback-content">
        <div className="callback-header">
          <div className="callback-icon">📞</div>
          <h2>Request Callback</h2>
          <p>We'll get back to you as soon as possible</p>
        </div>

        <div className="callback-form">
          <div className="form-group">
            <label>Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label>Phone Number *</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({...formData, phone: e.target.value})}
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({...formData, email: e.target.value})}
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label>Message</label>
            <textarea
              value={formData.message}
              onChange={(e) => setFormData({...formData, message: e.target.value})}
              rows={4}
              className="form-input"
              placeholder="How can we help you?"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="btn btn-primary btn-full"
          >
            {loading ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>

        <div className="callback-footer">
          <button
            onClick={() => setCurrentView('customer')}
            className="link-button"
          >
            Back to Chat
          </button>
        </div>
      </div>
    </div>
  );
};

// Main App Component
const App = () => {
  const [currentView, setCurrentView] = useState('customer');
  
  // Check URL for QR code parameters or direct routing
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const view = urlParams.get('view');
    if (view === 'worker') {
      setCurrentView('worker-login');
    } else if (view === 'admin') {
      setCurrentView('admin');
    }
  }, []);

  return (
    <div className="app">
      {currentView === 'customer' && <CustomerChat setCurrentView={setCurrentView} />}
      {currentView === 'worker-login' && <WorkerLogin setCurrentView={setCurrentView} />}
      {currentView === 'worker-dashboard' && <WorkerDashboard setCurrentView={setCurrentView} />}
      {currentView === 'callback' && <CallbackForm setCurrentView={setCurrentView} />}
      {currentView === 'admin' && <AdminDashboard setCurrentView={setCurrentView} />}
    </div>
  );
};

export default App;