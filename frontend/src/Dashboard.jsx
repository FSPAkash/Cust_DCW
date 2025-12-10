import React, { useState, useEffect } from 'react';
import config from './config';
import Sidebar from './components/Sidebar';
import PigmentSelector from './components/PigmentSelector';
import ProductionPanel from './components/ProductionPanel';
import ResultsTabs from './components/ResultsTabs';

const ThinkingScreen = () => (
  <div className="thinking-overlay">
    <div className="thinking-box glass-strong">
      <h2 className="thinking-title">Analyzing</h2>
      <p className="thinking-text">Finding matching orders...</p>
      <div className="thinking-dots"><span></span><span></span><span></span></div>
    </div>
  </div>
);

function Dashboard({ user, onLogout }) {
  const [pigments, setPigments] = useState([]);
  const [orders, setOrders] = useState([]);
  const [results, setResults] = useState(null);
  const [isThinking, setIsThinking] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [pRes, oRes] = await Promise.all([
        fetch(`${config.API_URL}/api/database/pigments`),
        fetch(`${config.API_URL}/api/database/orders`)
      ]);
      const p = await pRes.json();
      const o = await oRes.json();
      if (p.success) setPigments(p.data);
      if (o.success) setOrders(o.data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSelect = async (id) => {
    setIsThinking(true);
    setResults(null);
    const wait = new Promise(r => setTimeout(r, 1200));
    try {
      const res = await fetch(`${config.API_URL}/api/match/pigment-to-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pigmentId: id })
      });
      const data = await res.json();
      await wait;
      if (data.success) setResults(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <>
      {/* Static gradient background */}
      <div className="app-background"></div>
      
      <div className="app-container">
        <Sidebar user={user} onLogout={onLogout} pigmentCount={pigments.length} orderCount={orders.length} onDatabaseUpdate={loadData} />
        {isThinking && <ThinkingScreen />}

        <main className="main-content">
          <div className="page-header">
            <h1 className="page-title">Customer Match Matrix</h1>
            <p className="page-subtitle">AI Driven Matching Tool - Powered By Findability Sciences</p>
          </div>

          <PigmentSelector pigments={pigments} onSelect={handleSelect} loading={isThinking} selectedPigment={results?.pigment} />

          {results && (
            <>
              <div className="alert alert-success">
                <svg className="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Found {results.consensus?.length || 0} matching orders
              </div>

              <div className="results-area">
                <ProductionPanel recommendation={results.productionRecommendation} pigment={results.pigment} />
                <ResultsTabs results={results} pigment={results.pigment} orders={orders} />
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}

export default Dashboard;