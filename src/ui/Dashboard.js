/**
 * Dashboard.js
 * Renders the dark-themed engineering HUD, status monitors, telemetry metrics,
 * differential-drive kinematics monitors, and autonomous path planning navigation suite.
 */

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

    this.render();
    this.bindTeleopControls();
    this.bindNavigationControls();
    this.bindShooterAndIntakeControls();
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
      ballBadge: this.domElement.querySelector('#ball-flight-badge')
    };
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
  }

  /**
   * Container node where controls toolbar should be mounted.
   */
  getControlsSlot() {
    return this.domElement.querySelector('#controls-slot');
  }
}
