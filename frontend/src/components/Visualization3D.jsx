import React from 'react';
import Plot from 'react-plotly.js';

function Visualization3D({ database = [], inputLab, inputHex, matches = [], methodName }) {
  const labels = ['1st', '2nd', '3rd'];
  const colors = ['#fbbf24', '#9ca3af', '#d97706'];

  const data = [
    {
      type: 'scatter3d',
      mode: 'markers',
      x: database.map(p => p.L),
      y: database.map(p => p.a),
      z: database.map(p => p.b),
      marker: { size: 3, color: database.map(p => p.HexColor || '#ccc'), opacity: 0.3 },
      name: 'Orders',
      hovertemplate: 'L:%{x:.1f} a:%{y:.1f} b:%{z:.1f}<extra></extra>'
    },
    ...(inputLab ? [{
      type: 'scatter3d',
      mode: 'markers',
      x: [inputLab.L],
      y: [inputLab.a],
      z: [inputLab.b],
      marker: { size: 12, color: inputHex || '#6366f1', symbol: 'diamond', line: { width: 2, color: '#000' } },
      name: 'PIGMENT',
      hovertemplate: `PIGMENT<br>L:%{x:.1f} a:%{y:.1f} b:%{z:.1f}<extra></extra>`
    }] : []),
    ...matches.slice(0, 3).map((m, i) => ({
      type: 'scatter3d',
      mode: 'markers',
      x: [m.L],
      y: [m.a],
      z: [m.b],
      marker: { size: 9, color: m.hexColor || '#10b981', line: { width: 2, color: colors[i] } },
      name: `${labels[i]}: ${m.orderId}`,
      hovertemplate: `${labels[i]}<br>${m.orderId}<br>L:%{x:.1f} a:%{y:.1f} b:%{z:.1f}<extra></extra>`
    })),
    ...(inputLab ? matches.slice(0, 3).map((m, i) => ({
      type: 'scatter3d',
      mode: 'lines',
      x: [inputLab.L, m.L],
      y: [inputLab.a, m.a],
      z: [inputLab.b, m.b],
      line: { color: colors[i], width: 2, dash: 'dot' },
      showlegend: false,
      hoverinfo: 'skip'
    })) : [])
  ];

  const layout = {
    title: { text: methodName, font: { size: 13, color: '#1e293b' } },
    scene: {
      xaxis: { title: 'L*', range: [0, 100], gridcolor: '#e5e7eb' },
      yaxis: { title: 'a*', gridcolor: '#e5e7eb' },
      zaxis: { title: 'b*', gridcolor: '#e5e7eb' },
      camera: { eye: { x: 1.5, y: 1.5, z: 1.1 } },
      bgcolor: 'rgba(255,255,255,0)'
    },
    height: 280,
    margin: { l: 0, r: 0, t: 32, b: 0 },
    legend: { x: 0, y: 1, bgcolor: 'rgba(255,255,255,0.8)', font: { size: 9 } },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent'
  };

  return (
    <div className="viz-container">
      <Plot data={data} layout={layout} config={{ responsive: true, displayModeBar: false }} style={{ width: '100%' }} />
    </div>
  );
}

export default Visualization3D;