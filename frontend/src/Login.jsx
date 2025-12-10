import React, { useState } from 'react';
import config from './config';

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${config.API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      
      if (data.success) {
        onLogin(data.user);
      } else {
        setError('Invalid credentials');
      }
    } catch (e) {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-background">
        <div className="login-grid"></div>
        <div className="login-dots">
          <div className="login-dot dot-1"></div>
          <div className="login-dot dot-2"></div>
          <div className="login-dot dot-3"></div>
          <div className="login-dot dot-4"></div>
          <div className="login-dot dot-5"></div>
          <div className="login-dot dot-6"></div>
          <div className="login-dot dot-7"></div>
          <div className="login-dot dot-8"></div>
          <div className="login-dot dot-9"></div>
          <div className="login-dot dot-10"></div>
          <div className="login-dot dot-11"></div>
          <div className="login-dot dot-12"></div>
        </div>
      </div>

      <div className="login-page">
        <div className="login-container">
          <div className="login-logo">
            <div className="login-logo-icon">
              <img 
                src="/logos/main-logo.png" 
                alt="Pigment Matcher" 
                className="login-main-logo"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </div>
            <h1>Customer Match Matrix</h1>
            <p>AI Driven Matching Tool - Powered By Findability Sciences</p>
          </div>

          <div className="login-box">
            <h2>Sign In</h2>

            {error && (
              <div className="alert alert-error">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Username</label>
                <input
                  type="text"
                  className="form-input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  type="password"
                  className="form-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                />
              </div>

              <button 
                type="submit" 
                className="btn btn-primary btn-full"
                disabled={loading}
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          </div>

          <div className="login-powered">
            <p>Powered by</p>
            <div className="login-powered-logos">
              <img 
                src="/logos/partner1.png" 
                alt="Partner 1" 
                className="powered-logo-img"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
              <span className="powered-divider"></span>
              <img 
                src="/logos/partner2.png" 
                alt="Partner 2" 
                className="powered-logo-img"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;