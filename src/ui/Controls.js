/**
 * Controls.js
 * Builds the interactive simulation toolbar and binds action events to the
 * Simulation lifecycle and camera viewpoints.
 */

export class Controls {
  /**
   * @param {HTMLElement} parentElement Container element to inject the controls
   * @param {import('../simulation/Simulation.js').Simulation} simulation
   */
  constructor(parentElement, simulation) {
    this.container = parentElement;
    this.simulation = simulation;
    this.domElement = null;

    this.btnStart = null;
    this.btnPause = null;
    this.btnReset = null;
    this.btnResetBall = null;
    this.btnResetRobot = null;
    this.btnDropTest = null;

    this.render();
    this.bindEvents();
  }

  render() {
    this.domElement = document.createElement('div');
    this.domElement.className = 'sim-controls-toolbar';

    this.domElement.innerHTML = `
      <div class="control-group">
        <span class="control-group-label">SIMULATION</span>
        <div class="button-row">
          <button id="btn-start" class="btn btn-primary" title="Start / Resume physics (P)">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            <span>Start</span>
          </button>
          <button id="btn-pause" class="btn btn-secondary" title="Pause physics (P)">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            <span>Pause</span>
          </button>
          <button id="btn-reset" class="btn btn-danger" title="Reset entire simulation (R)">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>
            <span>Reset All</span>
          </button>
        </div>
      </div>

      <div class="control-divider"></div>

      <div class="control-group">
        <span class="control-group-label">OBJECT RESETS</span>
        <div class="button-row">
          <button id="btn-reset-ball" class="btn btn-subtle" title="Reset ball to start pose (B)">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/></svg>
            <span>Reset Ball</span>
          </button>
          <button id="btn-reset-robot" class="btn btn-subtle" title="Reset robot to starting position">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a2 2 0 0 1 2 2v1h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3V4a2 2 0 0 1 2-2m-3 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>
            <span>Reset Robot</span>
          </button>
          <button id="btn-drop-test" class="btn btn-accent" title="Drop ball from 3.2m to test Rapier bouncing (T)">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            <span>Drop Test</span>
          </button>
        </div>
      </div>

      <div class="control-divider"></div>

      <div class="control-group">
        <span class="control-group-label">CAMERA PRESETS</span>
        <div class="button-row">
          <button id="cam-overview" class="btn btn-preset active" title="Court Perspective Overview (1)">Overview</button>
          <button id="cam-robot" class="btn btn-preset" title="Robot Orbit View (2)">Robot</button>
          <button id="cam-hoop" class="btn btn-preset" title="Target Hoop View (3)">Hoop</button>
          <button id="cam-top" class="btn btn-preset" title="Tactical Top-Down View (4)">Top-Down</button>
        </div>
      </div>
    `;

    this.container.appendChild(this.domElement);

    // Cache elements
    this.btnStart = this.domElement.querySelector('#btn-start');
    this.btnPause = this.domElement.querySelector('#btn-pause');
    this.btnReset = this.domElement.querySelector('#btn-reset');
    this.btnResetBall = this.domElement.querySelector('#btn-reset-ball');
    this.btnResetRobot = this.domElement.querySelector('#btn-reset-robot');
    this.btnDropTest = this.domElement.querySelector('#btn-drop-test');

    this.camButtons = {
      overview: this.domElement.querySelector('#cam-overview'),
      robot: this.domElement.querySelector('#cam-robot'),
      hoop: this.domElement.querySelector('#cam-hoop'),
      top: this.domElement.querySelector('#cam-top')
    };

    this.updatePlayState(this.simulation.isRunning);
  }

  bindEvents() {
    this.btnStart.addEventListener('click', () => {
      this.simulation.start();
      this.updatePlayState(true);
    });

    this.btnPause.addEventListener('click', () => {
      this.simulation.pause();
      this.updatePlayState(false);
    });

    this.btnReset.addEventListener('click', () => {
      this.simulation.reset();
    });

    this.btnResetBall.addEventListener('click', () => {
      this.simulation.resetBall();
    });

    this.btnResetRobot.addEventListener('click', () => {
      this.simulation.resetRobot();
    });

    this.btnDropTest.addEventListener('click', () => {
      this.simulation.dropBallTest();
    });

    // Camera preset clicks
    Object.keys(this.camButtons).forEach((presetKey) => {
      const btn = this.camButtons[presetKey];
      btn.addEventListener('click', () => {
        this.simulation.setCameraPreset(presetKey);
        Object.values(this.camButtons).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      // Ignore if user is focusing an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.code) {
        case 'KeyP':
          e.preventDefault();
          const newState = this.simulation.togglePlayPause();
          this.updatePlayState(newState);
          break;
        case 'KeyR':
          e.preventDefault();
          this.simulation.reset();
          break;
        case 'KeyB':
          e.preventDefault();
          this.simulation.resetBall();
          break;
        case 'KeyT':
          e.preventDefault();
          this.simulation.dropBallTest();
          break;
        case 'Digit1':
          this.camButtons.overview.click();
          break;
        case 'Digit2':
          this.camButtons.robot.click();
          break;
        case 'Digit3':
          this.camButtons.hoop.click();
          break;
        case 'Digit4':
          this.camButtons.top.click();
          break;
      }
    });
  }

  /**
   * Updates toolbar button highlights based on active play/pause state.
   */
  updatePlayState(isRunning) {
    if (isRunning) {
      this.btnStart.classList.add('active');
      this.btnPause.classList.remove('active');
    } else {
      this.btnStart.classList.remove('active');
      this.btnPause.classList.add('active');
    }
  }
}
