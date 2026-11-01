/**
 * main.js
 * Application entry point for SMART-BASKETBOT Simulator.
 * Bootstraps the 3D graphics viewport, Rapier physics engine, dashboard HUD,
 * and simulation controls.
 */

import './style.css';
import { Simulation } from './simulation/Simulation.js';
import { Dashboard } from './ui/Dashboard.js';
import { Controls } from './ui/Controls.js';

async function bootstrap() {
  const appElement = document.getElementById('app');
  const viewportElement = document.getElementById('viewport');

  if (!appElement || !viewportElement) {
    console.error('Fatal: Missing root elements #app or #viewport');
    return;
  }

  // Display initial loading indicator
  const loadingOverlay = document.createElement('div');
  loadingOverlay.id = 'loading-overlay';
  loadingOverlay.innerHTML = `
    <div style="
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      background: #0a0e14;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      z-index: 1000; color: #f8fafc; font-family: sans-serif;
      transition: opacity 0.4s ease;
    ">
      <div style="
        width: 48px; height: 48px; border: 3px solid rgba(56, 189, 248, 0.2);
        border-top-color: #38bdf8; border-radius: 50%; animation: spin 1s linear infinite;
        margin-bottom: 16px;
      "></div>
      <div style="font-weight: 700; font-size: 1.1rem; letter-spacing: 0.1em; color: #ffffff;">SMART-BASKETBOT</div>
      <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 6px;">Initializing 3D Environment & Physics Core...</div>
      <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
    </div>
  `;
  document.body.appendChild(loadingOverlay);

  try {
    // 1. Initialize 3D Simulation & Rapier Physics
    const simulation = new Simulation(viewportElement);
    await simulation.initialize();

    // 2. Initialize Telemetry Dashboard
    const dashboard = new Dashboard(appElement, simulation);

    // 3. Initialize Interactive Controls Toolbar
    new Controls(dashboard.getControlsSlot(), simulation);

    // Fade out and remove loading overlay
    loadingOverlay.style.opacity = '0';
    setTimeout(() => {
      if (loadingOverlay.parentNode) {
        loadingOverlay.parentNode.removeChild(loadingOverlay);
      }
    }, 400);

    // Expose simulation on window for engineering debugging
    window.__SIMULATION__ = simulation;

  } catch (error) {
    console.error('[SMART-BASKETBOT] Initialization failed:', error);
    loadingOverlay.innerHTML = `
      <div style="
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: #0a0e14; display: flex; flex-direction: column; align-items: center; justify-content: center;
        z-index: 1000; color: #ef4444; font-family: monospace; padding: 24px; text-align: center;
      ">
        <h2 style="margin-bottom: 12px;">Simulation Initialization Error</h2>
        <p style="color: #cbd5e1; max-width: 600px; font-size: 0.85rem;">${error.message}</p>
      </div>
    `;
  }
}

// Bootstrap on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
