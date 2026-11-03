/**
 * Dashboard.js
 * Renders the dark-themed engineering HUD, status monitors, telemetry metrics,
 * differential-drive kinematics monitors, autonomous path planning navigation suite,
 * and comprehensive simulation performance analytics.
 */

import { AnalyticsCharts } from './AnalyticsCharts.js';

export class Dashboard {
  /**
   * @param {HTMLElement} parentElement Root container for the UI layout
   * @param {import('../simulation/Simulation.js').Simulation} simulation
   */
  constructor(parentElement, simulation) {
    this.container = parentElement;
    this.simulation = simulation;
    this.domElement = null;

    // Cache metric DOM nodes for rapid 60Hz updates
    this.nodes = {};

    // Analytics state (Milestone 8)
    this.activeAnalyticsTab = 'SHOOTING';
    this.analyticsCharts = null;
    this.lastChartUpdate = 0;

    this.render();
    this.bindTeleopControls();
    this.bindNavigationControls();
    this.bindShooterAndIntakeControls();
    this.bindVisionControls();
    this.bindAutonomousGameplayControls();
    this.bindAnalyticsControls();
    this.subscribeTelemetry();
  }

  render() {
    this.domElement = document.createElement('div');
    this.domElement.className = 'sim-dashboard-overlay';

    this.domElement.innerHTML = `
      <!-- TOP NAVIGATION & STATUS HEADER -->
      <header class="sim-header">
        <div class="brand-block">
          <div class="brand-logo-hex">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"></polygon>
              <circle cx="12" cy="12" r="4" fill="#f0883e" stroke="none"></circle>
            </svg>
          </div>
          <div class="brand-text">
            <h1 class="app-title">SMART-BASKETBOT</h1>
            <p class="app-subtitle">Autonomous Basketball Robotics Simulation</p>
          </div>
        </div>

        <div class="header-status-strip">
          <div class="status-pill status-running" id="status-indicator">
            <span class="status-dot"></span>
            <span id="txt-sim-status">RUNNING</span>
          </div>

          <div class="header-metric">
            <span class="metric-label">TIME</span>
            <span class="metric-value font-mono" id="txt-sim-time">0.00 s</span>
          </div>

          <div class="header-metric">
            <span class="metric-label">PHYSICS STEP</span>
            <span class="metric-value font-mono" id="txt-sim-steps">#0</span>
          </div>

          <div class="header-metric">
            <span class="metric-label">RENDER FPS</span>
            <span class="metric-value font-mono text-cyan" id="txt-fps">60</span>
          </div>
        </div>
      </header>

      <!-- SIDEBAR TELEMETRY PANELS -->
      <aside class="sim-telemetry-panel">

        <!-- AUTONOMOUS BASKETBALL INTELLIGENCE (MILESTONE 7) -->
        <div class="telemetry-card card-autonomy">
          <div class="card-header">
            <div class="card-title-wrap">
              <svg class="card-icon text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polygon points="12 6 12 12 16 14"></polygon>
              </svg>
              <span>AUTONOMOUS INTELLIGENCE</span>
            </div>
            <span class="badge badge-slate" id="gameplay-state-badge">IDLE</span>
          </div>

          <!-- Current Autonomous Task / Diagnostic Message -->
          <div class="nav-status-banner font-mono text-cyan" id="gameplay-task-msg" style="margin-bottom: 8px;">
            Autonomous intelligence ready.
          </div>

          <!-- Recovery / Error alert banner (hidden when healthy) -->
          <div class="autonomy-alert-banner font-mono" id="gameplay-error-banner" style="display: none; margin-bottom: 8px;"></div>

          <!-- Gameplay Mode Launch Controls -->
          <div class="nav-action-row" style="margin-bottom: 6px;">
            <button class="btn btn-primary btn-nav-action" id="btn-gameplay-continuous" title="Start continuous autonomous basketball search, intake, positioning and shooting">
              <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              <span>Continuous</span>
            </button>
            <div class="target-input-wrap">
              <input type="number" id="input-target-shots" min="1" max="50" value="5" class="font-mono" title="Target successful baskets">
              <button class="btn btn-accent btn-nav-action" id="btn-gameplay-target" title="Play until specified target number of successful baskets are scored">
                <span>Target Play</span>
              </button>
            </div>
          </div>

          <!-- Session Flow Controls (Pause / Resume / Stop / Reset) -->
          <div class="nav-action-row" style="margin-bottom: 8px;">
            <button class="btn btn-secondary btn-nav-action" id="btn-gameplay-pause" title="Pause session">
              <span>Pause</span>
            </button>
            <button class="btn btn-secondary btn-nav-action" id="btn-gameplay-resume" title="Resume session">
              <span>Resume</span>
            </button>
            <button class="btn btn-danger btn-nav-action" id="btn-gameplay-stop" title="Stop session">
              <span>Stop</span>
            </button>
            <button class="btn btn-subtle btn-nav-action" id="btn-gameplay-reset" title="Reset stats and session">
              <span>Reset</span>
            </button>
          </div>

          <!-- Autonomy Telemetry Grid -->
          <div class="telemetry-grid">
            <div class="grid-item">
              <span class="grid-label">State</span>
              <span class="grid-value font-mono text-cyan" id="gameplay-state">IDLE</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Target Ball</span>
              <span class="grid-value font-mono text-amber" id="gameplay-target-ball">NONE</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Ball Range</span>
              <span class="grid-value font-mono" id="gameplay-ball-dist">-- m</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Hoop Visible</span>
              <span class="grid-value font-mono text-muted" id="gameplay-hoop-vis">NO</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Possession</span>
              <span class="grid-value font-mono text-amber" id="gameplay-possession">CLEAR</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Shooter Ready</span>
              <span class="grid-value font-mono" id="gameplay-shooter-ready">NO</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Baskets Scored</span>
              <span class="grid-value font-mono text-success" id="gameplay-stat-scored">0</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Total Attempts</span>
              <span class="grid-value font-mono" id="gameplay-stat-attempts">0</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Target Left</span>
              <span class="grid-value font-mono text-cyan" id="gameplay-stat-remaining">--</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Recoveries</span>
              <span class="grid-value font-mono" id="gameplay-stat-recoveries">0</span>
            </div>
          </div>
        </div>

        <!-- SIMULATION ANALYTICS & PERFORMANCE MONITORING (MILESTONE 8) -->
        <div class="telemetry-card card-analytics">
          <div class="card-header">
            <div class="card-title-wrap">
              <svg class="card-icon text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="20" x2="18" y2="10"></line>
                <line x1="12" y1="20" x2="12" y2="4"></line>
                <line x1="6" y1="20" x2="6" y2="14"></line>
              </svg>
              <span>SIMULATION ANALYTICS</span>
            </div>
            <div class="analytics-header-actions">
              <button class="btn-mini-export" id="btn-analytics-json" title="Download Session Analytics as JSON">JSON</button>
              <button class="btn-mini-export" id="btn-analytics-csv" title="Download Session Analytics as CSV">CSV</button>
              <button class="btn-mini-export" id="btn-analytics-reset" title="Reset Analytics Tracking Session">Reset</button>
            </div>
          </div>

          <!-- Overall KPI Strip (6 Metrics) -->
          <div class="analytics-kpi-strip">
            <div class="kpi-card">
              <span class="kpi-label">Session Time</span>
              <span class="kpi-value font-mono text-cyan" id="an-kpi-time">0.0s</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">Accuracy</span>
              <span class="kpi-value font-mono text-success" id="an-kpi-accuracy">0.0%</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">Total Shots</span>
              <span class="kpi-value font-mono" id="an-kpi-shots">0 (0 sc)</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">Nav Distance</span>
              <span class="kpi-value font-mono text-cyan" id="an-kpi-nav-dist">0.0m</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">Nav Success</span>
              <span class="kpi-value font-mono text-amber" id="an-kpi-nav-rate">0.0%</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">Intake Success</span>
              <span class="kpi-value font-mono text-success" id="an-kpi-intake-rate">0.0%</span>
            </div>
          </div>

          <!-- Category Navigation Tabs -->
          <div class="analytics-nav-tabs">
            <button class="btn-analytics-tab active" data-cat="SHOOTING" id="tab-btn-shooting">Shooting</button>
            <button class="btn-analytics-tab" data-cat="NAVIGATION" id="tab-btn-navigation">Navigation</button>
            <button class="btn-analytics-tab" data-cat="MOTION" id="tab-btn-motion">Motion/PID</button>
            <button class="btn-analytics-tab" data-cat="COLLECTION" id="tab-btn-collection">Intake</button>
            <button class="btn-analytics-tab" data-cat="AUTONOMY" id="tab-btn-autonomy">Autonomy</button>
          </div>

          <!-- Category Dynamic Detail Grid -->
          <div class="telemetry-grid" id="analytics-detail-grid">
            <!-- Dynamically populated per active tab -->
          </div>

          <!-- Chart Mount Point for Chart.js -->
          <div id="analytics-charts-mount"></div>

          <!-- History / Detailed Records Container -->
          <div id="analytics-records-container">
            <div class="analytics-table-wrap">
              <table class="analytics-table" id="analytics-records-table">
                <thead id="analytics-records-thead"></thead>
                <tbody id="analytics-records-tbody"></tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- AUTONOMOUS SHOOTER SUITE & CLOSED-LOOP CONTROL -->
        <div class="telemetry-card card-auto-shooter">
          <div class="card-header">
            <div class="card-title-wrap">
              <svg class="card-icon text-amber" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
              <span>AUTONOMOUS SHOOTER</span>
            </div>
            <span class="badge badge-slate" id="workflow-stage-badge">IDLE</span>
          </div>
          <div class="nav-status-banner font-mono text-amber" id="workflow-status-msg" style="margin-bottom: 8px;">
            Autonomous workflow ready.
          </div>
          <div class="nav-action-row" style="margin-bottom: 8px;">
            <button class="btn btn-accent btn-nav-action" id="btn-workflow-start" title="Run full autonomous acquire, navigate, align, spin up and shoot sequence">
              <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              <span>Acquire & Shoot</span>
            </button>
            <button class="btn btn-secondary btn-nav-action" id="btn-closedloop-shoot" title="Align, calculate trajectory, spin up and shoot from current location (requires ball captured)">
              <span>Aim & Shoot</span>
            </button>
            <button class="btn btn-danger btn-nav-action" id="btn-workflow-cancel" title="Abort sequence">
              <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              <span>Abort</span>
            </button>
          </div>

          <!-- Real-Time Ballistic Trajectory & Alignment Metrics -->
          <div class="telemetry-grid">
            <div class="grid-item">
              <span class="grid-label">Target Dist</span>
              <span class="grid-value font-mono text-cyan" id="wf-target-dist">-- m</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Align Error</span>
              <span class="grid-value font-mono" id="wf-align-error">--°</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Launch Angle</span>
              <span class="grid-value font-mono text-amber" id="wf-launch-angle">--°</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Req. Flywheel</span>
              <span class="grid-value font-mono text-cyan" id="wf-flywheel-rpm">-- RPM</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Flight Time</span>
              <span class="grid-value font-mono" id="wf-flight-time">-- s</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Apex Height</span>
              <span class="grid-value font-mono" id="wf-apex-height">-- m</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Entry Angle</span>
              <span class="grid-value font-mono" id="wf-entry-angle">--°</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Rim Margin</span>
              <span class="grid-value font-mono text-success" id="wf-rim-margin">-- m</span>
            </div>
          </div>

          <!-- Adaptive Feedback Calibration -->
          <div class="adaptive-bias-bar font-mono">
            <span class="text-secondary" style="font-size: 0.62rem;">ADAPTIVE BIAS:</span>
            <span>Δv: <strong class="text-cyan" id="wf-bias-vel">0.00</strong></span>
            <span>Δθ: <strong class="text-amber" id="wf-bias-elev">0.0°</strong></span>
            <span>Δψ: <strong class="text-cyan" id="wf-bias-head">0.0°</strong></span>
          </div>
        </div>

        <!-- SHOT PERFORMANCE STATISTICS & HISTORY -->
        <div class="telemetry-card card-shot-stats">
          <div class="card-header">
            <div class="card-title-wrap">
              <svg class="card-icon text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4" fill="currentColor"></circle></svg>
              <span>SHOT PERFORMANCE</span>
            </div>
            <span class="badge badge-slate" id="shot-result-badge">NO SHOTS</span>
          </div>
          <div class="telemetry-grid">
            <div class="grid-item">
              <span class="grid-label">Attempts</span>
              <span class="grid-value font-mono" id="stat-attempts">0</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Baskets Scored</span>
              <span class="grid-value font-mono text-success" id="stat-scored">0</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Missed</span>
              <span class="grid-value font-mono text-danger" id="stat-missed">0</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Accuracy %</span>
              <span class="grid-value font-mono text-cyan" id="stat-accuracy">0.0%</span>
            </div>
          </div>

          <!-- Recent Shot Outcomes List (Last 5) -->
          <div class="recent-shots-container">
            <div style="font-size: 0.65rem; color: var(--text-muted); font-weight: 700; display: flex; justify-content: space-between;">
              <span>RECENT SHOTS (LAST 5)</span>
            </div>
            <div id="recent-shots-list" class="font-mono" style="display: flex; flex-direction: column; gap: 3px;">
              <div style="font-size: 0.65rem; color: var(--text-muted); font-style: italic; padding: 2px 4px;">Awaiting shot attempts...</div>
            </div>
          </div>
        </div>

        <!-- ROBOT VISION & CAMERA FEED -->
        <div class="telemetry-card card-vision">
          <div class="card-header">
            <div class="card-title-wrap">
              <svg class="card-icon text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                <circle cx="12" cy="13" r="4"></circle>
              </svg>
              <span>ROBOT CAMERA FEED</span>
            </div>
            <span class="badge badge-green" id="vision-status-badge">ACTIVE</span>
          </div>

          <!-- Live Robot Camera Viewport with 2D HUD Canvas Overlay -->
          <div class="vision-viewport-wrap">
            <canvas id="vision-feed-canvas" width="320" height="240" class="vision-canvas"></canvas>
            <div class="vision-fov-indicator" id="vision-fov-tag">FOV 70°</div>
          </div>

          <!-- Vision Telemetry Metrics -->
          <div class="telemetry-grid">
            <div class="grid-item">
              <span class="grid-label">Detected Balls</span>
              <span class="grid-value font-mono text-amber" id="vision-ball-count">0</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Tracked Ball</span>
              <span class="grid-value font-mono text-cyan" id="vision-primary-ball">NONE</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Ball Range</span>
              <span class="grid-value font-mono" id="vision-ball-dist">-- m</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Ball Azimuth</span>
              <span class="grid-value font-mono" id="vision-ball-bearing">--°</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Hoop Detected</span>
              <span class="grid-value font-mono text-muted" id="vision-hoop-visible">NO</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Hoop Range</span>
              <span class="grid-value font-mono" id="vision-hoop-dist">-- m</span>
            </div>
          </div>

          <!-- Vision Settings & Controls -->
          <div class="vision-controls-row">
            <div class="vision-ctrl-group">
              <span class="sub-label">FOV: <span id="lbl-vision-fov" class="text-cyan">70°</span></span>
              <input type="range" id="slider-vision-fov" min="40" max="110" step="5" value="70" class="vision-slider">
            </div>
            <div class="vision-ctrl-group">
              <span class="sub-label">RANGE: <span id="lbl-vision-range" class="text-amber">18m</span></span>
              <input type="range" id="slider-vision-range" min="5" max="30" step="1" value="18" class="vision-slider">
            </div>
          </div>
          <div class="nav-action-row" style="margin-top: 6px;">
            <button class="btn btn-secondary btn-nav-action" id="btn-toggle-vision" style="flex: 1;">
              <span id="lbl-toggle-vision">Disable Camera</span>
            </button>
            <button class="btn btn-subtle btn-nav-action" id="btn-vision-res" style="flex: 1;" title="Toggle resolution (320x240 / 480x360)">
              <span id="lbl-vision-res">320x240</span>
            </button>
          </div>
        </div>

        <!-- AUTONOMOUS NAVIGATION (A*) -->
        <div class="telemetry-card card-nav">
          <div class="card-header">
            <div class="card-title-wrap">
              <svg class="card-icon text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
              </svg>
              <span>AUTONOMOUS NAVIGATION (A*)</span>
            </div>
            <span class="badge badge-slate" id="nav-status-badge">IDLE</span>
          </div>

          <!-- Mode Toggle & Target Input -->
          <div class="nav-control-block">
            <div class="nav-mode-row">
              <span class="sub-label">CONTROL MODE:</span>
              <button class="btn btn-mode-toggle" id="btn-toggle-nav-mode">
                <span class="mode-led" id="mode-led"></span>
                <span id="lbl-control-mode">MANUAL TELEOP</span>
              </button>
            </div>

            <!-- Destination Coordinates & Presets -->
            <div class="nav-input-row">
              <div class="coord-input-wrap">
                <label>X (m):</label>
                <input type="number" id="input-dest-x" step="0.5" value="8.2" min="-14" max="14" class="font-mono">
              </div>
              <div class="coord-input-wrap">
                <label>Z (m):</label>
                <input type="number" id="input-dest-z" step="0.5" value="0.0" min="-7" max="7" class="font-mono">
              </div>
            </div>

            <!-- Court Waypoint Presets -->
            <div class="court-preset-container">
              <span class="sub-label">WAYPOINT PRESETS:</span>
              <div class="preset-pill-grid">
                <button class="btn btn-preset-mini" data-dest="8.2,0">East Key</button>
                <button class="btn btn-preset-mini" data-dest="0,0">Center</button>
                <button class="btn btn-preset-mini" data-dest="5.5,0">3-Pt Top</button>
                <button class="btn btn-preset-mini" data-dest="10,5">Left Wing</button>
                <button class="btn btn-preset-mini" data-dest="10,-5">Right Wing</button>
                <button class="btn btn-preset-mini" data-dest="-8.2,0">West FT</button>
                <button class="btn btn-preset-mini text-amber" id="btn-dest-ball">🏀 Ball</button>
              </div>
            </div>

            <!-- Action Buttons -->
            <div class="nav-action-row">
              <button class="btn btn-primary btn-nav-action" id="btn-nav-start">
                <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                <span>Start Navigation</span>
              </button>
              <button class="btn btn-danger btn-nav-action" id="btn-nav-cancel">
                <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                <span>Cancel</span>
              </button>
            </div>
          </div>

          <!-- Real-Time Navigation Readout -->
          <div class="telemetry-grid nav-telemetry-grid">
            <div class="grid-item">
              <span class="grid-label">Target Coords</span>
              <span class="grid-value font-mono text-cyan" id="nav-target-coords">None</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Distance Left</span>
              <span class="grid-value font-mono text-amber" id="nav-distance-remaining">0.00 m</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Active Waypoints</span>
              <span class="grid-value font-mono" id="nav-waypoint-count">0 / 0</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Nav State</span>
              <span class="grid-value font-mono" id="nav-state">IDLE</span>
            </div>
          </div>

          <div class="nav-status-banner font-mono" id="nav-status-msg">
            Ready for destination selection.
          </div>
          <div class="court-click-hint">Tip: Click anywhere on 3D court to set destination</div>
        </div>

        <!-- BASKETBALL INTAKE & CONTAINMENT -->
        <div class="telemetry-card card-intake">
          <div class="card-header">
            <div class="card-title-wrap">
              <svg class="card-icon text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14h6m-6 4h6m-6-8h16M4 6h16M14 14l3-3 3 3M17 11v8"/></svg>
              <span>INTAKE & CONTAINMENT</span>
            </div>
            <span class="badge badge-slate" id="intake-status-badge">IDLE</span>
          </div>
          <div class="telemetry-grid">
            <div class="grid-item">
              <span class="grid-label">Ball Possession</span>
              <span class="grid-value font-mono text-amber" id="txt-ball-possession">FIELD</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Optical Beam</span>
              <span class="grid-value font-mono" id="txt-optical-sensor">CLEAR</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Roller State</span>
              <span class="grid-value font-mono" id="txt-roller-state">STOPPED</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Roller RPM</span>
              <span class="grid-value font-mono text-cyan" id="txt-roller-rpm">0.0 RPM</span>
            </div>
          </div>
          <div class="nav-action-row" style="margin-top: 8px;">
            <button class="btn btn-primary btn-nav-action" id="btn-intake-toggle" title="Toggle front intake rollers (I)">
              <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-8-8z"/></svg>
              <span id="lbl-intake-btn">Start Intake</span>
            </button>
            <button class="btn btn-subtle btn-nav-action" id="btn-intake-reject" title="Reject / eject ball forward">
              <span>Reject</span>
            </button>
          </div>
        </div>

        <!-- FLYWHEEL SHOOTER & BALLISTICS -->
        <div class="telemetry-card card-shooter">
          <div class="card-header">
            <div class="card-title-wrap">
              <svg class="card-icon text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><path d="M12 3v6m0 6v6M3 12h6m6 0h6"></path></svg>
              <span>FLYWHEEL SHOOTER</span>
            </div>
            <span class="badge badge-slate" id="shooter-status-badge">IDLE</span>
          </div>
          <div class="telemetry-grid">
            <div class="grid-item">
              <span class="grid-label">Flywheel RPM</span>
              <span class="grid-value font-mono text-cyan" id="txt-flywheel-rpm">0.0 RPM</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Target Speed</span>
              <span class="grid-value font-mono" id="txt-target-speed">8.5 m/s</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Elevation Angle</span>
              <span class="grid-value font-mono text-amber" id="txt-elevation-angle">52.0°</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Apex Height</span>
              <span class="grid-value font-mono" id="txt-calc-apex">~4.1 m</span>
            </div>
          </div>
          <div style="margin: 8px 0 4px 0; display: flex; align-items: center; justify-content: space-between; font-size: 0.72rem; color: var(--text-secondary);">
            <span>Elevation Angle (35° - 75°):</span>
            <span class="font-mono text-cyan" id="lbl-slider-angle">52°</span>
          </div>
          <input type="range" id="slider-elevation-angle" min="35" max="75" step="1" value="52" style="width: 100%; accent-color: var(--accent-cyan); cursor: pointer; margin-bottom: 8px;">
          <div class="nav-action-row">
            <button class="btn btn-secondary btn-nav-action" id="btn-shooter-spinup" title="Spin up flywheels to target speed">
              <span>Spin Up</span>
            </button>
            <button class="btn btn-primary btn-nav-action" id="btn-shooter-fire" title="Launch basketball into Rapier physics (F)">
              <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              <span>Fire Shot</span>
            </button>
          </div>
          <div class="nav-status-banner font-mono text-danger" id="txt-shooter-msg" style="margin-top: 6px; font-size: 0.72rem; display: none;"></div>
        </div>

        <!-- ROBOT POSE & DYNAMICS -->
        <div class="telemetry-card">
          <div class="card-header">
            <div class="card-title-wrap">
              <svg class="card-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a2 2 0 0 1 2 2v1h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3V4a2 2 0 0 1 2-2m-3 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>
              <span>ROBOT POSE & DYNAMICS</span>
            </div>
            <span class="badge badge-cyan" id="bot-movement-badge">STOPPED</span>
          </div>

          <div class="telemetry-grid">
            <div class="grid-item">
              <span class="grid-label">Position X</span>
              <span class="grid-value font-mono" id="bot-pos-x">0.00 m</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Position Z</span>
              <span class="grid-value font-mono" id="bot-pos-z">0.00 m</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Heading θ</span>
              <span class="grid-value font-mono" id="bot-heading">0.0° (0.00 rad)</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Linear Vel (v)</span>
              <span class="grid-value font-mono text-cyan" id="bot-speed">0.00 m/s</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Angular Vel (ω)</span>
              <span class="grid-value font-mono text-amber" id="bot-angvel">0.00 rad/s</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Hoop Distance</span>
              <span class="grid-value font-mono text-cyan" id="bot-hoop-dist">0.00 m</span>
            </div>
          </div>
        </div>

        <!-- DIFFERENTIAL DRIVE WHEELS -->
        <div class="telemetry-card">
          <div class="card-header">
            <div class="card-title-wrap">
              <svg class="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><path d="M12 3v18M3 12h18"></path></svg>
              <span>DIFFERENTIAL DRIVE WHEELS</span>
            </div>
            <span class="badge badge-slate" id="drive-mode-badge">MANUAL</span>
          </div>

          <div class="telemetry-grid">
            <div class="grid-item">
              <span class="grid-label">Left Wheel RPM</span>
              <span class="grid-value font-mono text-cyan" id="wheel-rpm-left">0.0 RPM</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Right Wheel RPM</span>
              <span class="grid-value font-mono text-cyan" id="wheel-rpm-right">0.0 RPM</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Left Wheel Vel (v_L)</span>
              <span class="grid-value font-mono" id="wheel-vl">0.00 m/s</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Right Wheel Vel (v_R)</span>
              <span class="grid-value font-mono" id="wheel-vr">0.00 m/s</span>
            </div>
          </div>
        </div>

        <!-- HEADING PID & STABILIZATION -->
        <div class="telemetry-card">
          <div class="card-header">
            <div class="card-title-wrap">
              <svg class="card-icon text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg>
              <span>HEADING CONTROL (PID)</span>
            </div>
            <span class="badge badge-slate" id="pid-status-badge">STANDBY</span>
          </div>

          <div class="telemetry-grid">
            <div class="grid-item">
              <span class="grid-label">Desired Heading</span>
              <span class="grid-value font-mono" id="pid-target-heading">0.0°</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Actual Heading</span>
              <span class="grid-value font-mono" id="pid-actual-heading">0.0°</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Heading Error Δθ</span>
              <span class="grid-value font-mono text-amber" id="pid-heading-error">0.0°</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">PID Output (ω_cmd)</span>
              <span class="grid-value font-mono text-cyan" id="pid-output">0.00 rad/s</span>
            </div>
          </div>
        </div>

        <!-- MANUAL TELEOPERATION PAD -->
        <div class="telemetry-card">
          <div class="card-header">
            <div class="card-title-wrap">
              <svg class="card-icon text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              <span>ROBOT TELEOPERATION</span>
            </div>
            <span class="badge badge-amber">WASD PAD</span>
          </div>

          <div class="teleop-pad">
            <div class="teleop-row">
              <button class="btn btn-teleop" id="btn-teleop-fwd" title="Drive Forward (W)">▲ W</button>
            </div>
            <div class="teleop-row">
              <button class="btn btn-teleop" id="btn-teleop-left" title="Rotate Left (A)">◄ A</button>
              <button class="btn btn-teleop btn-estop" id="btn-teleop-estop" title="Emergency Stop (Space)">E-STOP</button>
              <button class="btn btn-teleop" id="btn-teleop-right" title="Rotate Right (D)">D ►</button>
            </div>
            <div class="teleop-row">
              <button class="btn btn-teleop" id="btn-teleop-rev" title="Drive Reverse (S)">▼ S</button>
            </div>
          </div>
        </div>

        <!-- BASKETBALL TELEMETRY -->
        <div class="telemetry-card">
          <div class="card-header">
            <div class="card-title-wrap">
              <svg class="card-icon text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><path d="M12 3a15 15 0 0 1 0 18M3 12h18"></path></svg>
              <span>BASKETBALL STATE</span>
            </div>
            <span class="badge badge-amber" id="ball-flight-badge">RESTING</span>
          </div>

          <div class="telemetry-grid">
            <div class="grid-item">
              <span class="grid-label">Ball X</span>
              <span class="grid-value font-mono" id="ball-pos-x">0.00 m</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Ball Y (Height)</span>
              <span class="grid-value font-mono" id="ball-pos-y">0.00 m</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Ball Z</span>
              <span class="grid-value font-mono" id="ball-pos-z">0.00 m</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Linear Speed</span>
              <span class="grid-value font-mono" id="ball-speed">0.00 m/s</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">Vert Velocity (Vy)</span>
              <span class="grid-value font-mono" id="ball-vy">0.00 m/s</span>
            </div>
            <div class="grid-item">
              <span class="grid-label">CCD Tunneling</span>
              <span class="grid-value font-mono text-success">Active</span>
            </div>
          </div>
        </div>

        <!-- QUICK SHORTCUTS CHEATSHEET -->
        <div class="telemetry-card card-compact">
          <div class="cheatsheet-title">ENGINEERING HOTKEYS</div>
          <div class="shortcuts-grid">
            <div><kbd>W / S</kbd> Drive Fwd / Rev</div>
            <div><kbd>A / D</kbd> Rotate Left / Right</div>
            <div><kbd>I</kbd> Toggle Intake</div>
            <div><kbd>F</kbd> Fire Shooter</div>
            <div><kbd>Space</kbd> Robot E-STOP</div>
            <div><kbd>P</kbd> Play / Pause Sim</div>
            <div><kbd>R</kbd> Reset Sim</div>
            <div><kbd>B</kbd> Reset Ball</div>
            <div><kbd>T</kbd> Drop Test</div>
            <div><kbd>1-4</kbd> Cameras</div>
          </div>
        </div>
      </aside>

      <!-- BOTTOM CONTROL DECK PLACEHOLDER -->
      <div id="controls-slot" class="controls-slot"></div>
    `;

    this.container.appendChild(this.domElement);

    // Cache elements for rapid updates
    this.nodes = {
      statusIndicator: this.domElement.querySelector('#status-indicator'),
      statusText: this.domElement.querySelector('#txt-sim-status'),
      simTime: this.domElement.querySelector('#txt-sim-time'),
      simSteps: this.domElement.querySelector('#txt-sim-steps'),
      fps: this.domElement.querySelector('#txt-fps'),

      // Milestone 7 Autonomous Gameplay Nodes
      gameplayBadge: this.domElement.querySelector('#gameplay-state-badge'),
      gameplayTaskMsg: this.domElement.querySelector('#gameplay-task-msg'),
      gameplayErrorBanner: this.domElement.querySelector('#gameplay-error-banner'),
      inputTargetShots: this.domElement.querySelector('#input-target-shots'),
      gameplayState: this.domElement.querySelector('#gameplay-state'),
      gameplayTargetBall: this.domElement.querySelector('#gameplay-target-ball'),
      gameplayBallDist: this.domElement.querySelector('#gameplay-ball-dist'),
      gameplayHoopVis: this.domElement.querySelector('#gameplay-hoop-vis'),
      gameplayPossession: this.domElement.querySelector('#gameplay-possession'),
      gameplayShooterReady: this.domElement.querySelector('#gameplay-shooter-ready'),
      gameplayStatScored: this.domElement.querySelector('#gameplay-stat-scored'),
      gameplayStatAttempts: this.domElement.querySelector('#gameplay-stat-attempts'),
      gameplayStatRemaining: this.domElement.querySelector('#gameplay-stat-remaining'),
      gameplayStatRecoveries: this.domElement.querySelector('#gameplay-stat-recoveries'),

      // Autonomous Shooter Workflow & Trajectory nodes
      workflowStageBadge: this.domElement.querySelector('#workflow-stage-badge'),
      workflowStatusMsg: this.domElement.querySelector('#workflow-status-msg'),
      wfTargetDist: this.domElement.querySelector('#wf-target-dist'),
      wfAlignError: this.domElement.querySelector('#wf-align-error'),
      wfLaunchAngle: this.domElement.querySelector('#wf-launch-angle'),
      wfFlywheelRpm: this.domElement.querySelector('#wf-flywheel-rpm'),
      wfFlightTime: this.domElement.querySelector('#wf-flight-time'),
      wfApexHeight: this.domElement.querySelector('#wf-apex-height'),
      wfEntryAngle: this.domElement.querySelector('#wf-entry-angle'),
      wfRimMargin: this.domElement.querySelector('#wf-rim-margin'),
      wfBiasVel: this.domElement.querySelector('#wf-bias-vel'),
      wfBiasElev: this.domElement.querySelector('#wf-bias-elev'),
      wfBiasHead: this.domElement.querySelector('#wf-bias-head'),

      // Shot Performance Statistics
      shotResultBadge: this.domElement.querySelector('#shot-result-badge'),
      statAttempts: this.domElement.querySelector('#stat-attempts'),
      statScored: this.domElement.querySelector('#stat-scored'),
      statMissed: this.domElement.querySelector('#stat-missed'),
      statAccuracy: this.domElement.querySelector('#stat-accuracy'),
      recentShotsList: this.domElement.querySelector('#recent-shots-list'),

      // Robot Vision & Camera nodes
      visionStatusBadge: this.domElement.querySelector('#vision-status-badge'),
      visionCanvas: this.domElement.querySelector('#vision-feed-canvas'),
      visionFovTag: this.domElement.querySelector('#vision-fov-tag'),
      visionBallCount: this.domElement.querySelector('#vision-ball-count'),
      visionPrimaryBall: this.domElement.querySelector('#vision-primary-ball'),
      visionBallDist: this.domElement.querySelector('#vision-ball-dist'),
      visionBallBearing: this.domElement.querySelector('#vision-ball-bearing'),
      visionHoopVisible: this.domElement.querySelector('#vision-hoop-visible'),
      visionHoopDist: this.domElement.querySelector('#vision-hoop-dist'),
      sliderVisionFov: this.domElement.querySelector('#slider-vision-fov'),
      lblVisionFov: this.domElement.querySelector('#lbl-vision-fov'),
      sliderVisionRange: this.domElement.querySelector('#slider-vision-range'),
      lblVisionRange: this.domElement.querySelector('#lbl-vision-range'),
      btnToggleVision: this.domElement.querySelector('#btn-toggle-vision'),
      lblToggleVision: this.domElement.querySelector('#lbl-toggle-vision'),
      btnVisionRes: this.domElement.querySelector('#btn-vision-res'),
      lblVisionRes: this.domElement.querySelector('#lbl-vision-res'),

      // Intake and containment nodes
      intakeStatusBadge: this.domElement.querySelector('#intake-status-badge'),
      txtBallPossession: this.domElement.querySelector('#txt-ball-possession'),
      txtOpticalSensor: this.domElement.querySelector('#txt-optical-sensor'),
      txtRollerState: this.domElement.querySelector('#txt-roller-state'),
      txtRollerRpm: this.domElement.querySelector('#txt-roller-rpm'),
      lblIntakeBtn: this.domElement.querySelector('#lbl-intake-btn'),

      // Flywheel shooter nodes
      shooterStatusBadge: this.domElement.querySelector('#shooter-status-badge'),
      txtFlywheelRpm: this.domElement.querySelector('#txt-flywheel-rpm'),
      txtTargetSpeed: this.domElement.querySelector('#txt-target-speed'),
      txtElevationAngle: this.domElement.querySelector('#txt-elevation-angle'),
      txtCalcApex: this.domElement.querySelector('#txt-calc-apex'),
      sliderElevationAngle: this.domElement.querySelector('#slider-elevation-angle'),
      lblSliderAngle: this.domElement.querySelector('#lbl-slider-angle'),
      txtShooterMsg: this.domElement.querySelector('#txt-shooter-msg'),

      // Navigation nodes
      navStatusBadge: this.domElement.querySelector('#nav-status-badge'),
      lblControlMode: this.domElement.querySelector('#lbl-control-mode'),
      modeLed: this.domElement.querySelector('#mode-led'),
      inputDestX: this.domElement.querySelector('#input-dest-x'),
      inputDestZ: this.domElement.querySelector('#input-dest-z'),
      navTargetCoords: this.domElement.querySelector('#nav-target-coords'),
      navDistanceRemaining: this.domElement.querySelector('#nav-distance-remaining'),
      navWaypointCount: this.domElement.querySelector('#nav-waypoint-count'),
      navState: this.domElement.querySelector('#nav-state'),
      navStatusMsg: this.domElement.querySelector('#nav-status-msg'),

      // Robot pose & dynamics
      botMovementBadge: this.domElement.querySelector('#bot-movement-badge'),
      botPosX: this.domElement.querySelector('#bot-pos-x'),
      botPosZ: this.domElement.querySelector('#bot-pos-z'),
      botHeading: this.domElement.querySelector('#bot-heading'),
      botSpeed: this.domElement.querySelector('#bot-speed'),
      botAngvel: this.domElement.querySelector('#bot-angvel'),
      botHoopDist: this.domElement.querySelector('#bot-hoop-dist'),

      // Wheel telemetry
      driveModeBadge: this.domElement.querySelector('#drive-mode-badge'),
      wheelRpmLeft: this.domElement.querySelector('#wheel-rpm-left'),
      wheelRpmRight: this.domElement.querySelector('#wheel-rpm-right'),
      wheelVl: this.domElement.querySelector('#wheel-vl'),
      wheelVr: this.domElement.querySelector('#wheel-vr'),

      // Heading PID
      pidStatusBadge: this.domElement.querySelector('#pid-status-badge'),
      pidTargetHeading: this.domElement.querySelector('#pid-target-heading'),
      pidActualHeading: this.domElement.querySelector('#pid-actual-heading'),
      pidHeadingError: this.domElement.querySelector('#pid-heading-error'),
      pidOutput: this.domElement.querySelector('#pid-output'),

      // Ball
      ballPosX: this.domElement.querySelector('#ball-pos-x'),
      ballPosY: this.domElement.querySelector('#ball-pos-y'),
      ballPosZ: this.domElement.querySelector('#ball-pos-z'),
      ballSpeed: this.domElement.querySelector('#ball-speed'),
      ballVy: this.domElement.querySelector('#ball-vy'),
      ballBadge: this.domElement.querySelector('#ball-flight-badge'),

      // Milestone 8 Analytics Nodes
      anKpiTime: this.domElement.querySelector('#an-kpi-time'),
      anKpiAccuracy: this.domElement.querySelector('#an-kpi-accuracy'),
      anKpiShots: this.domElement.querySelector('#an-kpi-shots'),
      anKpiNavDist: this.domElement.querySelector('#an-kpi-nav-dist'),
      anKpiNavRate: this.domElement.querySelector('#an-kpi-nav-rate'),
      anKpiIntakeRate: this.domElement.querySelector('#an-kpi-intake-rate'),
      anDetailGrid: this.domElement.querySelector('#analytics-detail-grid'),
      anChartsMount: this.domElement.querySelector('#analytics-charts-mount'),
      anRecordsTable: this.domElement.querySelector('#analytics-records-table'),
      anRecordsThead: this.domElement.querySelector('#analytics-records-thead'),
      anRecordsTbody: this.domElement.querySelector('#analytics-records-tbody')
    };

    if (this.nodes.anChartsMount) {
      this.analyticsCharts = new AnalyticsCharts(this.nodes.anChartsMount);
    }
  }

  /**
   * Binds autonomous navigation buttons, destination presets, and mode toggle.
   */
  bindNavigationControls() {
    const btnToggleMode = this.domElement.querySelector('#btn-toggle-nav-mode');
    const btnStart = this.domElement.querySelector('#btn-nav-start');
    const btnCancel = this.domElement.querySelector('#btn-nav-cancel');
    const btnDestBall = this.domElement.querySelector('#btn-dest-ball');
    const inputX = this.domElement.querySelector('#input-dest-x');
    const inputZ = this.domElement.querySelector('#input-dest-z');

    // Toggle between MANUAL and AUTONOMOUS modes
    btnToggleMode.addEventListener('click', () => {
      if (!this.simulation.robot) return;
      const current = this.simulation.robot.controlMode;
      const next = (current === 'MANUAL') ? 'AUTONOMOUS' : 'MANUAL';
      this.simulation.robot.setControlMode(next);
      this.updateModeDisplay(next);
    });

    // Start Navigation to input coordinates
    btnStart.addEventListener('click', () => {
      if (!this.simulation.robot) return;
      const targetX = parseFloat(inputX.value);
      const targetZ = parseFloat(inputZ.value);
      if (!isNaN(targetX) && !isNaN(targetZ)) {
        this.simulation.robot.startAutonomousNavigation(targetX, targetZ);
        this.updateModeDisplay('AUTONOMOUS');
      }
    });

    // Cancel Navigation
    btnCancel.addEventListener('click', () => {
      if (!this.simulation.robot) return;
      this.simulation.robot.cancelAutonomousNavigation();
      this.updateModeDisplay('MANUAL');
    });

    // Preset Buttons
    const presetBtns = this.domElement.querySelectorAll('.preset-pill-grid .btn-preset-mini[data-dest]');
    presetBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const [xStr, zStr] = btn.dataset.dest.split(',');
        inputX.value = xStr;
        inputZ.value = zStr;
        if (this.simulation.robot) {
          this.simulation.robot.startAutonomousNavigation(parseFloat(xStr), parseFloat(zStr));
          this.updateModeDisplay('AUTONOMOUS');
        }
      });
    });

    // Preset for Ball Target
    if (btnDestBall) {
      btnDestBall.addEventListener('click', () => {
        if (!this.simulation.basketball || !this.simulation.robot) return;
        const bPos = this.simulation.basketball.getPosition();
        inputX.value = bPos.x.toFixed(2);
        inputZ.value = bPos.z.toFixed(2);
        this.simulation.robot.startAutonomousNavigation(bPos.x, bPos.z);
        this.updateModeDisplay('AUTONOMOUS');
      });
    }

    // Court click listener
    this.simulation.onCourtClickCallback = (clickedX, clickedZ) => {
      inputX.value = clickedX.toFixed(2);
      inputZ.value = clickedZ.toFixed(2);
      if (this.simulation.robot) {
        this.simulation.robot.startAutonomousNavigation(clickedX, clickedZ);
        this.updateModeDisplay('AUTONOMOUS');
      }
    };
  }

  /**
   * Updates visual mode toggle indicator.
   */
  updateModeDisplay(mode) {
    if (mode === 'AUTONOMOUS') {
      this.nodes.lblControlMode.textContent = 'AUTONOMOUS MODE';
      this.nodes.modeLed.className = 'mode-led mode-led-auto';
    } else {
      this.nodes.lblControlMode.textContent = 'MANUAL TELEOP';
      this.nodes.modeLed.className = 'mode-led mode-led-manual';
    }
  }

  /**
   * Binds mouse/touch events to interactive teleoperation pad buttons.
   */
  bindTeleopControls() {
    const bindBtn = (id, action) => {
      const btn = this.domElement.querySelector(id);
      if (!btn) return;

      const onPress = (e) => {
        e.preventDefault();
        if (this.simulation.robot) {
          this.simulation.robot.inputController.setUiAction(action, true);
        }
      };

      const onRelease = (e) => {
        e.preventDefault();
        if (this.simulation.robot) {
          this.simulation.robot.inputController.setUiAction(action, false);
        }
      };

      btn.addEventListener('mousedown', onPress);
      btn.addEventListener('mouseup', onRelease);
      btn.addEventListener('mouseleave', onRelease);
      btn.addEventListener('touchstart', onPress, { passive: false });
      btn.addEventListener('touchend', onRelease, { passive: false });
    };

    bindBtn('#btn-teleop-fwd', 'forward');
    bindBtn('#btn-teleop-rev', 'reverse');
    bindBtn('#btn-teleop-left', 'left');
    bindBtn('#btn-teleop-right', 'right');
    bindBtn('#btn-teleop-estop', 'estop');
  }

  /**
   * Binds intake, flywheel shooter, and autonomous shooting workflow UI buttons and sliders.
   */
  bindShooterAndIntakeControls() {
    // Autonomous Shooter Workflow & Closed-Loop Controls
    const btnWorkflowStart = this.domElement.querySelector('#btn-workflow-start');
    const btnWorkflowCancel = this.domElement.querySelector('#btn-workflow-cancel');
    const btnClosedLoopShoot = this.domElement.querySelector('#btn-closedloop-shoot');

    if (btnWorkflowStart) {
      btnWorkflowStart.addEventListener('click', () => {
        this.simulation.startAutonomousShootingSequence();
      });
    }

    if (btnClosedLoopShoot) {
      btnClosedLoopShoot.addEventListener('click', () => {
        this.simulation.startClosedLoopShooting();
      });
    }

    if (btnWorkflowCancel) {
      btnWorkflowCancel.addEventListener('click', () => {
        this.simulation.cancelAutonomousShootingSequence();
        this.simulation.cancelClosedLoopShooting();
      });
    }

    // Intake Controls
    const btnIntakeToggle = this.domElement.querySelector('#btn-intake-toggle');
    const btnIntakeReject = this.domElement.querySelector('#btn-intake-reject');

    if (btnIntakeToggle) {
      btnIntakeToggle.addEventListener('click', () => {
        this.simulation.toggleIntake();
      });
    }

    if (btnIntakeReject) {
      btnIntakeReject.addEventListener('click', () => {
        this.simulation.rejectBall();
      });
    }

    // Flywheel Shooter Controls
    const sliderAngle = this.domElement.querySelector('#slider-elevation-angle');
    const lblAngle = this.domElement.querySelector('#lbl-slider-angle');
    const btnSpinup = this.domElement.querySelector('#btn-shooter-spinup');
    const btnFire = this.domElement.querySelector('#btn-shooter-fire');

    if (sliderAngle) {
      sliderAngle.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (lblAngle) lblAngle.textContent = `${val}°`;
        if (this.simulation.robot && this.simulation.robot.shooter) {
          this.simulation.robot.shooter.setLaunchAngle(val);
        }
      });
    }

    if (btnSpinup) {
      btnSpinup.addEventListener('click', () => {
        if (this.simulation.robot && this.simulation.robot.shooter) {
          this.simulation.robot.shooter.prepareShotAtHoop(this.simulation.robot);
        }
      });
    }

    if (btnFire) {
      btnFire.addEventListener('click', () => {
        this.simulation.fireShooter();
      });
    }
  }

  /**
   * Binds camera FOV, max distance, enable toggle, and resolution controls.
   */
  bindVisionControls() {
    const btnToggle = this.domElement.querySelector('#btn-toggle-vision');
    const lblToggle = this.domElement.querySelector('#lbl-toggle-vision');
    const sliderFov = this.domElement.querySelector('#slider-vision-fov');
    const lblFov = this.domElement.querySelector('#lbl-vision-fov');
    const sliderRange = this.domElement.querySelector('#slider-vision-range');
    const lblRange = this.domElement.querySelector('#lbl-vision-range');
    const btnRes = this.domElement.querySelector('#btn-vision-res');
    const lblRes = this.domElement.querySelector('#lbl-vision-res');

    if (btnToggle) {
      btnToggle.addEventListener('click', () => {
        if (!this.simulation.visionManager) return;
        const next = !this.simulation.visionManager.isEnabled;
        this.simulation.setVisionEnabled(next);
        if (lblToggle) lblToggle.textContent = next ? 'Disable Camera' : 'Enable Camera';
        if (this.nodes.visionStatusBadge) {
          this.nodes.visionStatusBadge.textContent = next ? 'ACTIVE' : 'OFFLINE';
          this.nodes.visionStatusBadge.className = next ? 'badge badge-green' : 'badge badge-slate';
        }
      });
    }

    if (sliderFov) {
      sliderFov.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (lblFov) lblFov.textContent = `${val}°`;
        if (this.nodes.visionFovTag) this.nodes.visionFovTag.textContent = `FOV ${val}°`;
        this.simulation.setVisionFOV(val);
      });
    }

    if (sliderRange) {
      sliderRange.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (lblRange) lblRange.textContent = `${val}m`;
        this.simulation.setVisionMaxDistance(val);
      });
    }

    let isHighRes = false;
    if (btnRes) {
      btnRes.addEventListener('click', () => {
        isHighRes = !isHighRes;
        const w = isHighRes ? 480 : 320;
        const h = isHighRes ? 360 : 240;
        this.simulation.setVisionResolution(w, h);
        if (this.nodes.visionCanvas) {
          this.nodes.visionCanvas.width = w;
          this.nodes.visionCanvas.height = h;
        }
        if (lblRes) lblRes.textContent = `${w}x${h}`;
      });
    }
  }

  /**
   * Binds Milestone 7 Autonomous Gameplay controls and session buttons.
   */
  bindAutonomousGameplayControls() {
    const btnContinuous = this.domElement.querySelector('#btn-gameplay-continuous');
    const btnTarget = this.domElement.querySelector('#btn-gameplay-target');
    const inputTarget = this.domElement.querySelector('#input-target-shots');
    const btnPause = this.domElement.querySelector('#btn-gameplay-pause');
    const btnResume = this.domElement.querySelector('#btn-gameplay-resume');
    const btnStop = this.domElement.querySelector('#btn-gameplay-stop');
    const btnReset = this.domElement.querySelector('#btn-gameplay-reset');

    if (btnContinuous) {
      btnContinuous.addEventListener('click', () => {
        this.simulation.startAutonomousContinuous();
      });
    }

    if (btnTarget) {
      btnTarget.addEventListener('click', () => {
        const targetVal = inputTarget ? parseInt(inputTarget.value, 10) : 5;
        this.simulation.startAutonomousFixedTarget(targetVal || 5);
      });
    }

    if (btnPause) {
      btnPause.addEventListener('click', () => {
        this.simulation.pauseAutonomousGameplay();
      });
    }

    if (btnResume) {
      btnResume.addEventListener('click', () => {
        this.simulation.resumeAutonomousGameplay();
      });
    }

    if (btnStop) {
      btnStop.addEventListener('click', () => {
        this.simulation.stopAutonomousGameplay();
      });
    }

    if (btnReset) {
      btnReset.addEventListener('click', () => {
        this.simulation.resetAutonomousGameplay();
      });
    }
  }

  /**
   * Binds analytics tab buttons, export actions, and reset controls.
   */
  bindAnalyticsControls() {
    const tabs = this.domElement.querySelectorAll('.btn-analytics-tab');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.getAttribute('data-cat');
        if (!cat) return;
        this.activeAnalyticsTab = cat;
        tabs.forEach(b => b.classList.toggle('active', b === btn));
        if (this.analyticsCharts) {
          this.analyticsCharts.setCategory(cat);
        }
      });
    });

    const btnJson = this.domElement.querySelector('#btn-analytics-json');
    if (btnJson) {
      btnJson.addEventListener('click', () => {
        if (this.simulation) this.simulation.downloadAnalytics('JSON');
      });
    }

    const btnCsv = this.domElement.querySelector('#btn-analytics-csv');
    if (btnCsv) {
      btnCsv.addEventListener('click', () => {
        if (this.simulation) this.simulation.downloadAnalytics('CSV');
      });
    }

    const btnReset = this.domElement.querySelector('#btn-analytics-reset');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (this.simulation) {
          this.simulation.resetAnalytics();
          if (this.analyticsCharts) {
            this.analyticsCharts.destroyCharts();
            this.analyticsCharts.setupView();
          }
        }
      });
    }
  }

  /**
   * Renders specific telemetry metrics inside the active analytics tab.
   * @param {Object} analytics
   */
  renderAnalyticsDetailGrid(analytics) {
    if (!this.nodes.anDetailGrid || !analytics) return;
    const grid = this.nodes.anDetailGrid;

    switch (this.activeAnalyticsTab) {
      case 'SHOOTING': {
        const s = analytics.shooting || {};
        grid.innerHTML = `
          <div class="grid-item">
            <span class="grid-label">Avg Launch Speed</span>
            <span class="grid-value font-mono text-cyan">${(s.averageLaunchSpeed || 0).toFixed(2)} m/s</span>
          </div>
          <div class="grid-item">
            <span class="grid-label">Avg Elevation Angle</span>
            <span class="grid-value font-mono text-amber">${(s.averageLaunchAngle || 0).toFixed(1)}°</span>
          </div>
          <div class="grid-item">
            <span class="grid-label">Avg Flight Time</span>
            <span class="grid-value font-mono">${(s.averageFlightTime || 0).toFixed(2)} s</span>
          </div>
          <div class="grid-item">
            <span class="grid-label">Avg Shot Interval</span>
            <span class="grid-value font-mono text-cyan">${(s.averageTimeBetweenShots || 0).toFixed(1)} s</span>
          </div>
        `;
        break;
      }
      case 'NAVIGATION': {
        const n = analytics.navigation || {};
        grid.innerHTML = `
          <div class="grid-item">
            <span class="grid-label">Total Nav Time</span>
            <span class="grid-value font-mono text-cyan">${(n.totalNavigationTime || 0).toFixed(1)} s</span>
          </div>
          <div class="grid-item">
            <span class="grid-label">Path Efficiency</span>
            <span class="grid-value font-mono text-success">${(n.overallPathEfficiency || 0).toFixed(1)}%</span>
          </div>
          <div class="grid-item">
            <span class="grid-label">Replans / Obstacles</span>
            <span class="grid-value font-mono text-amber">${n.replanningEvents || 0} / ${n.obstacleEncounters || 0}</span>
          </div>
          <div class="grid-item">
            <span class="grid-label">Avg Time to Target</span>
            <span class="grid-value font-mono">${(n.averageTimeToTarget || 0).toFixed(1)} s</span>
          </div>
        `;
        break;
      }
      case 'MOTION': {
        const m = analytics.motion || {};
        grid.innerHTML = `
          <div class="grid-item">
            <span class="grid-label">Avg Linear Error</span>
            <span class="grid-value font-mono text-cyan">${(m.averageLinearError || 0).toFixed(3)} m/s</span>
          </div>
          <div class="grid-item">
            <span class="grid-label">Max Linear Error</span>
            <span class="grid-value font-mono text-danger">${(m.maxLinearError || 0).toFixed(2)} m/s</span>
          </div>
          <div class="grid-item">
            <span class="grid-label">Avg Angular Error</span>
            <span class="grid-value font-mono text-amber">${(m.averageAngularError || 0).toFixed(3)} rad/s</span>
          </div>
          <div class="grid-item">
            <span class="grid-label">Step Rise Time</span>
            <span class="grid-value font-mono">${m.motionResponseTime ? m.motionResponseTime.toFixed(2) + ' s' : '-- s'}</span>
          </div>
        `;
        break;
      }
      case 'COLLECTION': {
        const c = analytics.collection || {};
        grid.innerHTML = `
          <div class="grid-item">
            <span class="grid-label">Total Attempts</span>
            <span class="grid-value font-mono">${c.totalAttempts || 0}</span>
          </div>
          <div class="grid-item">
            <span class="grid-label">Captures / Failures</span>
            <span class="grid-value font-mono text-success">${c.successfulCollections || 0} <span class="text-danger">/ ${c.failedCollections || 0}</span></span>
          </div>
          <div class="grid-item">
            <span class="grid-label">Avg Duration</span>
            <span class="grid-value font-mono text-cyan">${(c.averageCollectionDuration || 0).toFixed(2)} s</span>
          </div>
          <div class="grid-item">
            <span class="grid-label">Retries Count</span>
            <span class="grid-value font-mono text-amber">${c.collectionRetries || 0}</span>
          </div>
        `;
        break;
      }
      case 'AUTONOMY': {
        const au = analytics.autonomy || {};
        grid.innerHTML = `
          <div class="grid-item">
            <span class="grid-label">Sessions (C/F)</span>
            <span class="grid-value font-mono text-cyan">${au.completedSessions || 0} <span class="text-muted">/ ${(au.failedSessions || 0) + (au.cancelledSessions || 0)}</span></span>
          </div>
          <div class="grid-item">
            <span class="grid-label">Auto Accuracy</span>
            <span class="grid-value font-mono text-success">${(au.accuracyPercent || 0).toFixed(1)}%</span>
          </div>
          <div class="grid-item">
            <span class="grid-label">Time / Basket</span>
            <span class="grid-value font-mono text-amber">${(au.averageTimePerBasket || 0).toFixed(1)} s</span>
          </div>
          <div class="grid-item">
            <span class="grid-label">Recovery Rate</span>
            <span class="grid-value font-mono">${(au.recoverySuccessRate || 0).toFixed(0)}% (${au.recoveryAttempts || 0} att)</span>
          </div>
        `;
        break;
      }
    }
  }

  /**
   * Populates the historical records table for the active analytics tab.
   * @param {Object} analytics
   */
  renderAnalyticsRecordsTable(analytics) {
    if (!this.nodes.anRecordsThead || !this.nodes.anRecordsTbody || !analytics) return;

    const thead = this.nodes.anRecordsThead;
    const tbody = this.nodes.anRecordsTbody;

    switch (this.activeAnalyticsTab) {
      case 'SHOOTING': {
        const hist = analytics.shooting?.shotHistory || [];
        thead.innerHTML = `<tr><th>#</th><th>Time</th><th>Mode</th><th>Outcome</th><th>Speed</th><th>Angle</th><th>RPM</th><th>Flight</th></tr>`;
        if (hist.length === 0) {
          tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); font-style: italic;">No shots recorded yet</td></tr>`;
        } else {
          tbody.innerHTML = hist.slice(0, 5).map(s => `
            <tr>
              <td>#${s.shotNumber}</td>
              <td>${new Date(s.timestamp).toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })}</td>
              <td>${s.mode}</td>
              <td class="${s.isScored ? 'text-success' : 'text-danger'}">${s.outcome}</td>
              <td>${s.launchSpeed != null ? s.launchSpeed.toFixed(1) + 'm/s' : '--'}</td>
              <td>${s.launchAngle != null ? s.launchAngle.toFixed(0) + '°' : '--'}</td>
              <td>${s.flywheelRPM != null ? Math.round(s.flywheelRPM) : '--'}</td>
              <td>${s.flightDuration != null ? s.flightDuration.toFixed(2) + 's' : '--'}</td>
            </tr>
          `).join('');
        }
        break;
      }
      case 'NAVIGATION': {
        const hist = analytics.navigation?.taskHistory || [];
        thead.innerHTML = `<tr><th>#</th><th>Mode</th><th>Status</th><th>Planned</th><th>Actual</th><th>Efficiency</th><th>Duration</th></tr>`;
        if (hist.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); font-style: italic;">No navigation tasks recorded yet</td></tr>`;
        } else {
          tbody.innerHTML = hist.slice(0, 5).map(t => `
            <tr>
              <td>#${t.taskNumber}</td>
              <td>${t.mode}</td>
              <td class="${t.status === 'GOAL_REACHED' ? 'text-success' : 'text-danger'}">${t.status}</td>
              <td>${t.plannedPathLength.toFixed(1)}m</td>
              <td>${t.actualTravelledDistance.toFixed(1)}m</td>
              <td class="text-cyan">${t.pathEfficiency.toFixed(0)}%</td>
              <td>${t.duration.toFixed(1)}s</td>
            </tr>
          `).join('');
        }
        break;
      }
      case 'COLLECTION': {
        const hist = analytics.collection?.attemptHistory || [];
        thead.innerHTML = `<tr><th>#</th><th>Mode</th><th>Status</th><th>Duration</th><th>Retries</th></tr>`;
        if (hist.length === 0) {
          tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); font-style: italic;">No collection attempts recorded yet</td></tr>`;
        } else {
          tbody.innerHTML = hist.slice(0, 5).map(a => `
            <tr>
              <td>#${a.attemptNumber}</td>
              <td>${a.mode}</td>
              <td class="${a.status === 'SUCCESS' ? 'text-success' : 'text-danger'}">${a.status}</td>
              <td>${a.duration.toFixed(2)}s</td>
              <td>${a.retries}</td>
            </tr>
          `).join('');
        }
        break;
      }
      case 'AUTONOMY': {
        const hist = analytics.autonomy?.sessionHistory || [];
        thead.innerHTML = `<tr><th>#</th><th>Mode</th><th>Status</th><th>Duration</th><th>Scored</th><th>Attempts</th><th>Recoveries</th></tr>`;
        if (hist.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); font-style: italic;">No autonomous sessions recorded yet</td></tr>`;
        } else {
          tbody.innerHTML = hist.slice(0, 5).map(sess => `
            <tr>
              <td>#${sess.sessionNumber}</td>
              <td>${sess.mode}</td>
              <td class="${sess.status === 'COMPLETED' ? 'text-success' : 'text-danger'}">${sess.status}</td>
              <td>${sess.duration.toFixed(1)}s</td>
              <td class="text-success">${sess.successfulShots}</td>
              <td>${sess.totalAttempts}</td>
              <td>${sess.recoveryAttempts}</td>
            </tr>
          `).join('');
        }
        break;
      }
      default: {
        thead.innerHTML = '';
        tbody.innerHTML = '';
        break;
      }
    }
  }

  /**
   * Subscribes to real-time simulation updates.
   */
  subscribeTelemetry() {
    this.simulation.onTelemetry((data) => {
      this.update(data);
    });
  }

  /**
   * Updates DOM telemetry indicators efficiently.
   */
  update(data) {
    if (!this.nodes.statusText) return;

    // Simulation status
    const isRunning = data.status === 'RUNNING';
    this.nodes.statusText.textContent = data.status;
    if (isRunning) {
      this.nodes.statusIndicator.className = 'status-pill status-running';
    } else {
      this.nodes.statusIndicator.className = 'status-pill status-paused';
    }

    this.nodes.simTime.textContent = `${data.simTime.toFixed(2)} s`;
    this.nodes.simSteps.textContent = `#${data.stepCount}`;
    this.nodes.fps.textContent = `${data.fps}`;

    // Milestone 7 Complete Autonomous Intelligence Telemetry
    if (data.autonomy) {
      const auto = data.autonomy;
      const st = auto.state || 'IDLE';

      if (this.nodes.gameplayBadge) {
        this.nodes.gameplayBadge.textContent = st;
        if (st === 'COMPLETED') {
          this.nodes.gameplayBadge.className = 'badge badge-green';
        } else if (st === 'FAILED' || st === 'CANCELLED') {
          this.nodes.gameplayBadge.className = 'badge badge-red';
        } else if (st === 'PAUSED') {
          this.nodes.gameplayBadge.className = 'badge badge-amber';
        } else if (st === 'RECOVERING') {
          this.nodes.gameplayBadge.className = 'badge badge-amber';
        } else if (st !== 'IDLE') {
          this.nodes.gameplayBadge.className = 'badge badge-cyan';
        } else {
          this.nodes.gameplayBadge.className = 'badge badge-slate';
        }
      }

      if (this.nodes.gameplayState) {
        this.nodes.gameplayState.textContent = st;
      }

      if (this.nodes.gameplayTaskMsg) {
        this.nodes.gameplayTaskMsg.textContent = auto.statusMessage || `State: ${st}`;
      }

      if (this.nodes.gameplayErrorBanner) {
        if (st === 'RECOVERING' || st === 'FAILED') {
          this.nodes.gameplayErrorBanner.style.display = 'block';
          this.nodes.gameplayErrorBanner.textContent = auto.statusMessage || 'Recovery action underway';
        } else {
          this.nodes.gameplayErrorBanner.style.display = 'none';
        }
      }

      if (this.nodes.gameplayTargetBall) {
        this.nodes.gameplayTargetBall.textContent = auto.target?.id || 'NONE';
      }

      if (this.nodes.gameplayBallDist) {
        this.nodes.gameplayBallDist.textContent = auto.target?.distance != null
          ? `${auto.target.distance.toFixed(2)} m`
          : '-- m';
      }

      if (this.nodes.gameplayHoopVis) {
        this.nodes.gameplayHoopVis.textContent = auto.hoop?.visible ? 'YES' : 'NO';
        this.nodes.gameplayHoopVis.className = auto.hoop?.visible
          ? 'grid-value font-mono text-success'
          : 'grid-value font-mono text-muted';
      }

      if (this.nodes.gameplayPossession) {
        this.nodes.gameplayPossession.textContent = auto.possession?.hasBall ? 'CAPTURED' : (auto.possession?.state || 'CLEAR');
        this.nodes.gameplayPossession.className = auto.possession?.hasBall
          ? 'grid-value font-mono text-success'
          : 'grid-value font-mono text-amber';
      }

      if (this.nodes.gameplayShooterReady) {
        this.nodes.gameplayShooterReady.textContent = auto.shooter?.isReady ? 'READY' : (auto.shooter?.state || 'IDLE');
        this.nodes.gameplayShooterReady.className = auto.shooter?.isReady
          ? 'grid-value font-mono text-success'
          : 'grid-value font-mono';
      }

      if (this.nodes.gameplayStatScored && auto.statistics) {
        this.nodes.gameplayStatScored.textContent = `${auto.statistics.successfulShots || 0}`;
        this.nodes.gameplayStatAttempts.textContent = `${auto.statistics.totalAttempts || 0}`;
        this.nodes.gameplayStatRecoveries.textContent = `${auto.statistics.recoveryAttempts || 0}`;

        if (this.nodes.gameplayStatRemaining) {
          if (auto.mode === 'FIXED_TARGET') {
            this.nodes.gameplayStatRemaining.textContent = `${auto.remainingShots ?? 0}`;
          } else {
            this.nodes.gameplayStatRemaining.textContent = 'INF (CONT)';
          }
        }
      }
    }

    const r = data.robot;

    // Autonomous Shooter Workflow & Closed-Loop Controller telemetry
    const wf = data.shooterWorkflow;
    const clShooter = r.shootingController;
    const activeShooter = (clShooter && clShooter.isActive) ? clShooter : wf;

    if (activeShooter && this.nodes.workflowStageBadge) {
      const stage = activeShooter.stage || activeShooter.state || 'IDLE';
      this.nodes.workflowStageBadge.textContent = stage;
      if (stage === 'COMPLETED') {
        this.nodes.workflowStageBadge.className = 'badge badge-green';
      } else if (stage === 'FIRING' || stage === 'READY') {
        this.nodes.workflowStageBadge.className = 'badge badge-amber';
      } else if (activeShooter.isActive) {
        this.nodes.workflowStageBadge.className = 'badge badge-cyan';
      } else if (stage === 'CANCELLED' || stage === 'FAILED') {
        this.nodes.workflowStageBadge.className = 'badge badge-red';
      } else {
        this.nodes.workflowStageBadge.className = 'badge badge-slate';
      }
      if (this.nodes.workflowStatusMsg) {
        this.nodes.workflowStatusMsg.textContent = activeShooter.statusMessage || '';
      }
    }

    // Ballistic Trajectory & Alignment Readouts
    const activeSol = wf?.activeSolution || clShooter?.trajectorySolution;
    if (this.nodes.wfTargetDist) {
      if (activeSol) {
        this.nodes.wfTargetDist.textContent = `${(activeSol.targetDistance ?? r.distToHoop).toFixed(2)} m`;
        this.nodes.wfAlignError.textContent = `${(activeSol.headingErrorDeg ?? 0).toFixed(1)}°`;
        this.nodes.wfLaunchAngle.textContent = `${(activeSol.launchAngleDeg ?? 52).toFixed(1)}°`;
        const rpm = (activeSol.launchSpeed / (0.05 * 2 * Math.PI / 60)).toFixed(0);
        this.nodes.wfFlywheelRpm.textContent = `${rpm} RPM`;
        this.nodes.wfFlightTime.textContent = `${(activeSol.flightTime ?? 0).toFixed(2)} s`;
        this.nodes.wfApexHeight.textContent = `${(activeSol.apexHeight ?? 0).toFixed(2)} m`;
        this.nodes.wfEntryAngle.textContent = `${(activeSol.entryAngleDeg ?? 0).toFixed(1)}°`;
        this.nodes.wfRimMargin.textContent = activeSol.margin != null 
          ? `${(activeSol.margin >= 0 ? '+' : '')}${(activeSol.margin * 100).toFixed(1)} cm` 
          : '--';
      } else {
        this.nodes.wfTargetDist.textContent = `${r.distToHoop.toFixed(2)} m`;
        this.nodes.wfAlignError.textContent = `${(r.headingErrorDeg || 0).toFixed(1)}°`;
        this.nodes.wfLaunchAngle.textContent = `${(r.shooter?.launchAngleDeg || 52).toFixed(1)}°`;
        const currentRpm = r.shooter?.flywheelRpm || 0;
        this.nodes.wfFlywheelRpm.textContent = `${currentRpm.toFixed(0)} RPM`;
        this.nodes.wfFlightTime.textContent = '-- s';
        this.nodes.wfApexHeight.textContent = '-- m';
        this.nodes.wfEntryAngle.textContent = '--°';
        this.nodes.wfRimMargin.textContent = '--';
      }
    }

    // Adaptive Calibration Biases
    const biases = wf?.adaptiveBiases || r.adaptiveCorrector;
    if (biases && this.nodes.wfBiasVel) {
      const vBias = biases.velocityBias || 0;
      const eBias = biases.elevationBias || 0;
      const hBiasRad = biases.headingBias || 0;
      const hBiasDeg = (hBiasRad * 180 / Math.PI);

      this.nodes.wfBiasVel.textContent = `${vBias >= 0 ? '+' : ''}${vBias.toFixed(2)}`;
      this.nodes.wfBiasElev.textContent = `${eBias >= 0 ? '+' : ''}${eBias.toFixed(1)}°`;
      this.nodes.wfBiasHead.textContent = `${hBiasDeg >= 0 ? '+' : ''}${hBiasDeg.toFixed(1)}°`;
    }

    // Shot Performance Statistics & History
    if (data.shotStats && this.nodes.statAttempts) {
      const st = data.shotStats;
      this.nodes.statAttempts.textContent = `${st.totalAttempts || 0}`;
      this.nodes.statScored.textContent = `${st.successfulBaskets || 0}`;
      this.nodes.statMissed.textContent = `${st.missedShots || 0}`;
      this.nodes.statAccuracy.textContent = `${(st.accuracyPercent || 0).toFixed(1)}%`;
      if (this.nodes.shotResultBadge) {
        const lastOutcome = st.lastShotDetails?.outcome || st.lastShotResult || 'NO SHOTS';
        this.nodes.shotResultBadge.textContent = lastOutcome;
        if (lastOutcome === 'SCORED') {
          this.nodes.shotResultBadge.className = 'badge badge-green';
        } else if (lastOutcome.startsWith('MISSED_')) {
          this.nodes.shotResultBadge.className = 'badge badge-amber';
        } else if (lastOutcome === 'MISSED') {
          this.nodes.shotResultBadge.className = 'badge badge-red';
        } else if (lastOutcome === 'IN_FLIGHT') {
          this.nodes.shotResultBadge.className = 'badge badge-cyan';
        } else {
          this.nodes.shotResultBadge.className = 'badge badge-slate';
        }
      }

      // Render recent shots list (cached by history count)
      if (this.nodes.recentShotsList && st.shotHistory) {
        if (this._lastRenderedHistoryCount !== st.shotHistory.length) {
          this._lastRenderedHistoryCount = st.shotHistory.length;
          if (st.shotHistory.length === 0) {
            this.nodes.recentShotsList.innerHTML = `<div style="font-size: 0.65rem; color: var(--text-muted); font-style: italic; padding: 2px 4px;">Awaiting shot attempts...</div>`;
          } else {
            const recent = st.shotHistory.slice(-5).reverse();
            this.nodes.recentShotsList.innerHTML = recent.map((shot, idx) => {
              const isScore = shot.outcome === 'SCORED';
              const badgeCls = isScore ? 'badge-green' : (shot.outcome.startsWith('MISSED_') ? 'badge-amber' : 'badge-red');
              const distStr = shot.distance != null ? `${shot.distance.toFixed(1)}m` : '';
              const angStr = shot.launchAngleDeg != null ? `${shot.launchAngleDeg.toFixed(0)}°` : '';
              const tag = [distStr, angStr].filter(Boolean).join(', ');
              const shotNum = shot.shotId || (st.shotHistory.length - idx);
              return `<div class="shot-history-row ${isScore ? 'scored' : 'missed'}">
                <span class="text-secondary">#${shotNum} ${tag ? `(${tag})` : ''}</span>
                <span class="badge ${badgeCls}">${shot.outcome}</span>
              </div>`;
            }).join('');
          }
        }
      }
    }

    // Intake & Ball Possession telemetry
    if (r.intake && this.nodes.intakeStatusBadge) {
      const it = r.intake;
      this.nodes.intakeStatusBadge.textContent = it.state || 'IDLE';
      if (it.state === 'BALL_CAPTURED') {
        this.nodes.intakeStatusBadge.className = 'badge badge-green';
      } else if (it.state === 'INTAKING') {
        this.nodes.intakeStatusBadge.className = 'badge badge-cyan';
      } else if (it.state === 'REJECTING') {
        this.nodes.intakeStatusBadge.className = 'badge badge-amber';
      } else {
        this.nodes.intakeStatusBadge.className = 'badge badge-slate';
      }

      if (this.nodes.txtBallPossession) {
        this.nodes.txtBallPossession.textContent = it.ballState || 'FIELD';
        if (it.ballState === 'CAPTURED') {
          this.nodes.txtBallPossession.className = 'grid-value font-mono text-success';
        } else if (it.ballState === 'IN_FLIGHT') {
          this.nodes.txtBallPossession.className = 'grid-value font-mono text-cyan';
        } else {
          this.nodes.txtBallPossession.className = 'grid-value font-mono text-amber';
        }
      }

      if (this.nodes.txtOpticalSensor) {
        this.nodes.txtOpticalSensor.textContent = it.opticalSensorActive ? 'ACTIVE (BALL DETECTED)' : 'CLEAR (BEAM INTACT)';
        this.nodes.txtOpticalSensor.className = it.opticalSensorActive ? 'grid-value font-mono text-success' : 'grid-value font-mono text-muted';
      }

      if (this.nodes.txtRollerState) {
        this.nodes.txtRollerState.textContent = it.state === 'INTAKING' ? 'INTAKING' : (it.state === 'REJECTING' ? 'REJECTING' : 'STOPPED');
      }

      if (this.nodes.txtRollerRpm) {
        this.nodes.txtRollerRpm.textContent = `${(it.rollerSpeedRpm || 0).toFixed(1)} RPM`;
      }

      if (this.nodes.lblIntakeBtn) {
        this.nodes.lblIntakeBtn.textContent = it.state === 'INTAKING' ? 'Stop Intake' : 'Start Intake';
      }
    }

    // Flywheel Shooter telemetry
    if (r.shooter && this.nodes.shooterStatusBadge) {
      const sh = r.shooter;
      this.nodes.shooterStatusBadge.textContent = sh.state || 'IDLE';
      if (sh.state === 'READY') {
        this.nodes.shooterStatusBadge.className = 'badge badge-green';
      } else if (sh.state === 'SPINNING_UP') {
        this.nodes.shooterStatusBadge.className = 'badge badge-cyan';
      } else if (sh.state === 'FIRING') {
        this.nodes.shooterStatusBadge.className = 'badge badge-amber';
      } else {
        this.nodes.shooterStatusBadge.className = 'badge badge-slate';
      }

      if (this.nodes.txtFlywheelRpm) {
        this.nodes.txtFlywheelRpm.textContent = `${(sh.flywheelRpm || 0).toFixed(1)} RPM`;
      }
      if (this.nodes.txtTargetSpeed) {
        this.nodes.txtTargetSpeed.textContent = `${(sh.targetLaunchSpeed || 8.5).toFixed(2)} m/s`;
      }
      if (this.nodes.txtElevationAngle) {
        this.nodes.txtElevationAngle.textContent = `${(sh.launchAngleDeg || 52).toFixed(1)}°`;
      }

      // Ballistic apex height estimate
      if (this.nodes.txtCalcApex) {
        const theta = ((sh.launchAngleDeg || 52) * Math.PI) / 180;
        const v0 = sh.targetLaunchSpeed || 8.5;
        const apex = r.y + 0.45 + (v0 * Math.sin(theta) * v0 * Math.sin(theta)) / (2 * 9.81);
        this.nodes.txtCalcApex.textContent = `${apex.toFixed(2)} m`;
      }

      if (this.nodes.txtShooterMsg) {
        if (sh.lastRejectReason) {
          this.nodes.txtShooterMsg.style.display = 'block';
          this.nodes.txtShooterMsg.textContent = sh.lastRejectReason;
        } else {
          this.nodes.txtShooterMsg.style.display = 'none';
        }
      }
    }

    // Navigation telemetry
    if (r.navigation) {
      const nav = r.navigation;
      this.nodes.navState.textContent = nav.state;
      this.nodes.navStatusMsg.textContent = nav.statusMessage || '';
      this.nodes.navStatusBadge.textContent = nav.state;

      if (nav.state === 'NAVIGATING' || nav.state === 'APPROACHING_GOAL') {
        this.nodes.navStatusBadge.className = 'badge badge-cyan';
      } else if (nav.state === 'GOAL_REACHED') {
        this.nodes.navStatusBadge.className = 'badge badge-green';
      } else if (nav.state === 'BLOCKED') {
        this.nodes.navStatusBadge.className = 'badge badge-red';
      } else {
        this.nodes.navStatusBadge.className = 'badge badge-slate';
      }

      if (nav.destination) {
        this.nodes.navTargetCoords.textContent = `(${nav.destination.x.toFixed(1)}, ${nav.destination.z.toFixed(1)})`;
        this.nodes.navDistanceRemaining.textContent = `${nav.distanceRemaining.toFixed(2)} m`;
      } else {
        this.nodes.navTargetCoords.textContent = 'None';
        this.nodes.navDistanceRemaining.textContent = '0.00 m';
      }

      this.nodes.navWaypointCount.textContent = `${nav.currentWaypointIndex + (nav.waypointCount > 0 ? 1 : 0)} / ${nav.waypointCount}`;

      this.updateModeDisplay(r.controlMode || 'MANUAL');
    }

    // Robot pose and dynamics
    this.nodes.botPosX.textContent = `${r.x.toFixed(2)} m`;
    this.nodes.botPosZ.textContent = `${r.z.toFixed(2)} m`;
    this.nodes.botHeading.textContent = `${r.headingDeg.toFixed(1)}° (${r.headingRad.toFixed(2)} rad)`;
    this.nodes.botSpeed.textContent = `${r.speed.toFixed(2)} m/s`;
    this.nodes.botAngvel.textContent = `${r.angularVelocity.toFixed(2)} rad/s`;
    this.nodes.botHoopDist.textContent = `${r.distToHoop.toFixed(2)} m`;

    // Movement state badge
    this.nodes.botMovementBadge.textContent = r.movementState;
    if (r.movementState === 'E_STOP') {
      this.nodes.botMovementBadge.className = 'badge badge-red';
    } else if (r.movementState === 'STOPPED') {
      this.nodes.botMovementBadge.className = 'badge badge-slate';
    } else {
      this.nodes.botMovementBadge.className = 'badge badge-cyan';
    }

    // Wheel telemetry
    this.nodes.driveModeBadge.textContent = r.mode;
    this.nodes.wheelRpmLeft.textContent = `${r.rpmLeft.toFixed(1)} RPM`;
    this.nodes.wheelRpmRight.textContent = `${r.rpmRight.toFixed(1)} RPM`;
    this.nodes.wheelVl.textContent = `${r.vLeft.toFixed(2)} m/s`;
    this.nodes.wheelVr.textContent = `${r.vRight.toFixed(2)} m/s`;

    // Heading PID telemetry
    if (r.mode === 'HEADING_HOLD' || r.controlMode === 'AUTONOMOUS') {
      this.nodes.pidStatusBadge.textContent = 'ACTIVE';
      this.nodes.pidStatusBadge.className = 'badge badge-cyan';
    } else {
      this.nodes.pidStatusBadge.textContent = 'STANDBY';
      this.nodes.pidStatusBadge.className = 'badge badge-slate';
    }
    this.nodes.pidTargetHeading.textContent = `${r.targetHeadingDeg.toFixed(1)}°`;
    this.nodes.pidActualHeading.textContent = `${r.headingDeg.toFixed(1)}°`;
    this.nodes.pidHeadingError.textContent = `${r.headingErrorDeg.toFixed(1)}°`;
    this.nodes.pidOutput.textContent = `${r.pidOutput.toFixed(2)} rad/s`;

    // Basketball metrics
    this.nodes.ballPosX.textContent = `${data.ball.x.toFixed(2)} m`;
    this.nodes.ballPosY.textContent = `${data.ball.y.toFixed(2)} m`;
    this.nodes.ballPosZ.textContent = `${data.ball.z.toFixed(2)} m`;
    this.nodes.ballSpeed.textContent = `${data.ball.speed.toFixed(2)} m/s`;
    this.nodes.ballVy.textContent = `${data.ball.vy.toFixed(2)} m/s`;

    if (data.ball.isAirborne) {
      this.nodes.ballBadge.textContent = 'AIRBORNE';
      this.nodes.ballBadge.className = 'badge badge-cyan';
    } else if (data.ball.speed > 0.08) {
      this.nodes.ballBadge.textContent = 'ROLLING';
      this.nodes.ballBadge.className = 'badge badge-amber';
    } else {
      this.nodes.ballBadge.textContent = 'RESTING';
      this.nodes.ballBadge.className = 'badge badge-slate';
    }

    // Robot Vision telemetry & HUD feed
    if (data.vision) {
      const v = data.vision;
      const isVisionOn = v.enabled ?? true;
      if (this.nodes.visionStatusBadge) {
        this.nodes.visionStatusBadge.textContent = isVisionOn ? 'ACTIVE' : 'OFFLINE';
        this.nodes.visionStatusBadge.className = isVisionOn ? 'badge badge-green' : 'badge badge-slate';
      }

      const ballCount = v.balls?.count ?? 0;
      if (this.nodes.visionBallCount) this.nodes.visionBallCount.textContent = `${ballCount}`;

      const primary = v.balls?.primary;
      if (this.nodes.visionPrimaryBall) {
        this.nodes.visionPrimaryBall.textContent = primary ? primary.id : 'NONE';
      }
      if (this.nodes.visionBallDist) {
        this.nodes.visionBallDist.textContent = primary ? `${primary.distance.toFixed(2)} m` : '-- m';
      }
      if (this.nodes.visionBallBearing) {
        this.nodes.visionBallBearing.textContent = primary ? `${primary.azimuthDeg.toFixed(1)}°` : '--°';
      }

      const hoop = v.hoop;
      if (this.nodes.visionHoopVisible) {
        this.nodes.visionHoopVisible.textContent = hoop?.visible ? 'YES' : 'NO';
        this.nodes.visionHoopVisible.className = hoop?.visible ? 'grid-value font-mono text-success' : 'grid-value font-mono text-muted';
      }
      if (this.nodes.visionHoopDist) {
        this.nodes.visionHoopDist.textContent = (hoop?.visible && hoop.distance != null) ? `${hoop.distance.toFixed(2)} m` : '-- m';
      }

      this.renderVisionFeed(v);
    }

    // Milestone 8 Analytics Performance Monitoring Readouts
    if (data.analytics) {
      const an = data.analytics;
      const sh = an.shooting || {};
      const nav = an.navigation || {};
      const col = an.collection || {};

      if (this.nodes.anKpiTime) {
        this.nodes.anKpiTime.textContent = `${(an.sessionDuration || 0).toFixed(1)}s`;
      }
      if (this.nodes.anKpiAccuracy) {
        this.nodes.anKpiAccuracy.textContent = `${(sh.accuracyPercent || 0).toFixed(1)}%`;
      }
      if (this.nodes.anKpiShots) {
        this.nodes.anKpiShots.textContent = `${sh.totalAttempts || 0} (${sh.successfulBaskets || 0} sc)`;
      }
      if (this.nodes.anKpiNavDist) {
        this.nodes.anKpiNavDist.textContent = `${(nav.totalDistanceTravelled || 0).toFixed(1)}m`;
      }
      if (this.nodes.anKpiNavRate) {
        this.nodes.anKpiNavRate.textContent = `${(nav.navigationSuccessRate || 0).toFixed(1)}%`;
      }
      if (this.nodes.anKpiIntakeRate) {
        this.nodes.anKpiIntakeRate.textContent = `${(col.collectionSuccessRate || 0).toFixed(1)}%`;
      }

      this.renderAnalyticsDetailGrid(an);
      this.renderAnalyticsRecordsTable(an);

      // Throttled Chart.js visuals refresh (every 250ms / 4 Hz)
      const now = Date.now();
      if (now - this.lastChartUpdate >= 250) {
        this.lastChartUpdate = now;
        if (this.analyticsCharts) {
          this.analyticsCharts.update(data);
        }
      }
    }
  }

  /**
   * Renders the simulated robot camera stream and HUD bounding boxes onto the 2D dashboard canvas.
   * @param {Object} vision Vision telemetry packet
   */
  renderVisionFeed(vision) {
    if (!this.nodes.visionCanvas || !vision) return;
    const canvas = this.nodes.visionCanvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!vision.enabled) {
      ctx.fillStyle = '#0a0e14';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#64748b';
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('CAMERA FEED OFFLINE', canvas.width / 2, canvas.height / 2);
      return;
    }

    // Draw offscreen camera frame if rendered
    let frameRendered = false;
    if (this.simulation.visionManager) {
      const imgData = this.simulation.visionManager.getFrameImageData();
      if (imgData && imgData.width === canvas.width && imgData.height === canvas.height) {
        ctx.putImageData(imgData, 0, 0);
        frameRendered = true;
      }
    }

    if (!frameRendered) {
      // Fallback dark gradient backdrop if offscreen rendering is unavailable (or in headless test)
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(1, '#070b12');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Reticle crosshair at center
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2 - 14, canvas.height / 2);
    ctx.lineTo(canvas.width / 2 + 14, canvas.height / 2);
    ctx.moveTo(canvas.width / 2, canvas.height / 2 - 14);
    ctx.lineTo(canvas.width / 2, canvas.height / 2 + 14);
    ctx.stroke();

    // 1. Draw Basketball Bounding Boxes
    const trackedBalls = vision.balls?.tracked || [];
    for (let i = 0; i < trackedBalls.length; i++) {
      const b = trackedBalls[i];
      if (b.status === 'LOST' || !b.screenBoundingBox) continue;
      const box = b.screenBoundingBox;

      ctx.strokeStyle = '#10b981'; // Vibrant green
      ctx.lineWidth = 1.5;
      ctx.strokeRect(box.x, box.y, box.width, box.height);

      ctx.fillStyle = 'rgba(16, 185, 129, 0.85)';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      const label = `${b.id} ${(b.distance ?? 0).toFixed(1)}m`;
      const textWidth = ctx.measureText(label).width;
      ctx.fillRect(box.x, Math.max(0, box.y - 12), textWidth + 4, 12);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, box.x + 2, Math.max(9, box.y - 3));
    }

    // 2. Draw Hoop Detection Overlay
    const hoop = vision.hoop;
    if (hoop && hoop.visible && hoop.screenBoundingBox) {
      const hb = hoop.screenBoundingBox;
      ctx.strokeStyle = '#f97316'; // Vibrant orange
      ctx.lineWidth = 1.5;
      ctx.strokeRect(hb.x, hb.y, hb.width, hb.height);

      if (hoop.screen) {
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(hoop.screen.x, hoop.screen.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = 'rgba(249, 115, 22, 0.85)';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      const hoopLabel = `HOOP ${(hoop.distance ?? 0).toFixed(1)}m (${(hoop.confidence * 100).toFixed(0)}%)`;
      const textW = ctx.measureText(hoopLabel).width;
      ctx.fillRect(hb.x, Math.max(0, hb.y - 12), textW + 4, 12);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(hoopLabel, hb.x + 2, Math.max(9, hb.y - 3));
    }
  }

  /**
   * Container node where controls toolbar should be mounted.
   */
  getControlsSlot() {
    return this.domElement.querySelector('#controls-slot');
  }

  /**
   * Destroys dashboard and releases chart resources.
   */
  destroy() {
    if (this.analyticsCharts) {
      this.analyticsCharts.destroy();
      this.analyticsCharts = null;
    }
  }
}
