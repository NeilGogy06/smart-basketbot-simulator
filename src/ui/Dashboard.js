/**
 * Dashboard.js
 * Renders the dark-themed engineering HUD, status monitors, telemetry metrics,
 * differential-drive kinematics monitors, and interactive robot teleoperation deck.
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

          <!-- Quick Heading Hold Target Presets -->
          <div class="heading-preset-row">
            <span class="sub-label">SET HEADING:</span>
            <button class="btn btn-preset-mini" data-heading="0">0° (Hoop)</button>
            <button class="btn btn-preset-mini" data-heading="90">90° (Left)</button>
            <button class="btn btn-preset-mini" data-heading="-90">-90° (Right)</button>
            <button class="btn btn-preset-mini" data-heading="180">180°</button>
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

      botMovementBadge: this.domElement.querySelector('#bot-movement-badge'),
      botPosX: this.domElement.querySelector('#bot-pos-x'),
      botPosZ: this.domElement.querySelector('#bot-pos-z'),
      botHeading: this.domElement.querySelector('#bot-heading'),
      botSpeed: this.domElement.querySelector('#bot-speed'),
      botAngvel: this.domElement.querySelector('#bot-angvel'),
      botHoopDist: this.domElement.querySelector('#bot-hoop-dist'),

      driveModeBadge: this.domElement.querySelector('#drive-mode-badge'),
      wheelRpmLeft: this.domElement.querySelector('#wheel-rpm-left'),
      wheelRpmRight: this.domElement.querySelector('#wheel-rpm-right'),
      wheelVl: this.domElement.querySelector('#wheel-vl'),
      wheelVr: this.domElement.querySelector('#wheel-vr'),

      pidStatusBadge: this.domElement.querySelector('#pid-status-badge'),
      pidTargetHeading: this.domElement.querySelector('#pid-target-heading'),
      pidActualHeading: this.domElement.querySelector('#pid-actual-heading'),
      pidHeadingError: this.domElement.querySelector('#pid-heading-error'),
      pidOutput: this.domElement.querySelector('#pid-output'),

      ballPosX: this.domElement.querySelector('#ball-pos-x'),
      ballPosY: this.domElement.querySelector('#ball-pos-y'),
      ballPosZ: this.domElement.querySelector('#ball-pos-z'),
      ballSpeed: this.domElement.querySelector('#ball-speed'),
      ballVy: this.domElement.querySelector('#ball-vy'),
      ballBadge: this.domElement.querySelector('#ball-flight-badge')
    };
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

    // Heading preset buttons
    const presetButtons = this.domElement.querySelectorAll('.btn-preset-mini');
    presetButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetDeg = parseFloat(btn.dataset.heading);
        const targetRad = (targetDeg * Math.PI) / 180;
        if (this.simulation.robot) {
          this.simulation.robot.driveController.setTargetHeading(targetRad, 0.0);
        }
      });
    });
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

    // Robot pose and dynamics
    const r = data.robot;
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
    if (r.mode === 'HEADING_HOLD') {
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
