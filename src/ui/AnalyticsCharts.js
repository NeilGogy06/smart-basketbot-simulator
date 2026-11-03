/**
 * AnalyticsCharts.js
 * Manages Chart.js visualizations for the SMART-BASKETBOT Analytics subsystem.
 * Handles chart lifecycle, efficient real-time updating, canvas memory cleanup,
 * and dark-themed engineering HUD aesthetic.
 */

import Chart from 'chart.js/auto';

export class AnalyticsCharts {
  /**
   * @param {HTMLElement} mountElement Container DOM element for analytics charts
   */
  constructor(mountElement) {
    this.container = mountElement;
    this.currentCategory = 'SHOOTING'; // 'SHOOTING', 'NAVIGATION', 'MOTION', 'COLLECTION', 'AUTONOMY'
    this.charts = {};

    this.chartColors = {
      cyan: '#38bdf8',
      cyanBg: 'rgba(56, 189, 248, 0.15)',
      green: '#10b981',
      greenBg: 'rgba(16, 185, 129, 0.20)',
      red: '#ef4444',
      redBg: 'rgba(239, 68, 68, 0.20)',
      amber: '#f59e0b',
      amberBg: 'rgba(245, 158, 11, 0.20)',
      purple: '#a855f7',
      purpleBg: 'rgba(168, 85, 247, 0.20)',
      slate: '#64748b',
      border: '#334155',
      grid: 'rgba(51, 65, 85, 0.45)',
      text: '#94a3b8'
    };

    this.setupView();
  }

  /**
   * Switches visible analytics category tab and rebuilds relevant charts.
   * @param {string} category
   */
  setCategory(category) {
    if (this.currentCategory === category && Object.keys(this.charts).length > 0) {
      return;
    }
    this.currentCategory = category;
    this.destroyCharts();
    this.setupView();
  }

  /**
   * Destroys all active Chart.js instances to avoid memory leaks and canvas conflicts.
   */
  destroyCharts() {
    for (const key of Object.keys(this.charts)) {
      if (this.charts[key]) {
        try {
          this.charts[key].destroy();
        } catch (e) {
          // Ignore destruction errors in headless test runners
        }
      }
    }
    this.charts = {};
  }

  /**
   * Sets up HTML canvases and instantiates Chart.js instances for the active tab.
   */
  setupView() {
    if (!this.container) return;
    this.container.innerHTML = '';

    switch (this.currentCategory) {
      case 'SHOOTING':
        this.setupShootingView();
        break;
      case 'NAVIGATION':
        this.setupNavigationView();
        break;
      case 'MOTION':
        this.setupMotionView();
        break;
      case 'COLLECTION':
        this.setupCollectionView();
        break;
      case 'AUTONOMY':
        this.setupAutonomyView();
        break;
    }
  }

  // =========================================================================
  // 1. SHOOTING CHARTS VIEW
  // =========================================================================
  setupShootingView() {
    const wrap = document.createElement('div');
    wrap.className = 'analytics-chart-grid';
    wrap.innerHTML = `
      <div class="analytics-chart-card">
        <div class="chart-title">Shot Outcomes (Scored vs Missed)</div>
        <div class="chart-canvas-wrap" style="height: 180px;">
          <canvas id="chart-shooting-outcomes"></canvas>
        </div>
      </div>
      <div class="analytics-chart-card">
        <div class="chart-title">Miss Classification Breakdown</div>
        <div class="chart-canvas-wrap" style="height: 180px;">
          <canvas id="chart-shooting-misses"></canvas>
        </div>
      </div>
    `;
    this.container.appendChild(wrap);

    const c1 = wrap.querySelector('#chart-shooting-outcomes');
    const c2 = wrap.querySelector('#chart-shooting-misses');

    if (c1 && c1.getContext) {
      this.charts.outcomes = new Chart(c1, {
        type: 'doughnut',
        data: {
          labels: ['Scored', 'Missed'],
          datasets: [{
            data: [0, 0],
            backgroundColor: [this.chartColors.green, this.chartColors.red],
            borderColor: this.chartColors.border,
            borderWidth: 1.5
          }]
        },
        options: this.getDoughnutOptions()
      });
    }

    if (c2 && c2.getContext) {
      this.charts.misses = new Chart(c2, {
        type: 'bar',
        data: {
          labels: ['Short', 'Long', 'Left', 'Right', 'General'],
          datasets: [{
            label: 'Count',
            data: [0, 0, 0, 0, 0],
            backgroundColor: this.chartColors.amberBg,
            borderColor: this.chartColors.amber,
            borderWidth: 1.5
          }]
        },
        options: this.getBarOptions()
      });
    }
  }

  // =========================================================================
  // 2. NAVIGATION CHARTS VIEW
  // =========================================================================
  setupNavigationView() {
    const wrap = document.createElement('div');
    wrap.className = 'analytics-chart-grid';
    wrap.innerHTML = `
      <div class="analytics-chart-card">
        <div class="chart-title">Task Success vs Failure</div>
        <div class="chart-canvas-wrap" style="height: 180px;">
          <canvas id="chart-nav-tasks"></canvas>
        </div>
      </div>
      <div class="analytics-chart-card">
        <div class="chart-title">Planned vs Actual Path Length (m)</div>
        <div class="chart-canvas-wrap" style="height: 180px;">
          <canvas id="chart-nav-distance"></canvas>
        </div>
      </div>
    `;
    this.container.appendChild(wrap);

    const c1 = wrap.querySelector('#chart-nav-tasks');
    const c2 = wrap.querySelector('#chart-nav-distance');

    if (c1 && c1.getContext) {
      this.charts.tasks = new Chart(c1, {
        type: 'doughnut',
        data: {
          labels: ['Successful', 'Failed / Cancelled'],
          datasets: [{
            data: [0, 0],
            backgroundColor: [this.chartColors.cyan, this.chartColors.red],
            borderColor: this.chartColors.border,
            borderWidth: 1.5
          }]
        },
        options: this.getDoughnutOptions()
      });
    }

    if (c2 && c2.getContext) {
      this.charts.distance = new Chart(c2, {
        type: 'bar',
        data: {
          labels: ['Planned Distance', 'Actual Distance'],
          datasets: [{
            label: 'Meters',
            data: [0, 0],
            backgroundColor: [this.chartColors.cyanBg, this.chartColors.purpleBg],
            borderColor: [this.chartColors.cyan, this.chartColors.purple],
            borderWidth: 1.5
          }]
        },
        options: this.getBarOptions()
      });
    }
  }

  // =========================================================================
  // 3. MOTION & PID CHARTS VIEW
  // =========================================================================
  setupMotionView() {
    const wrap = document.createElement('div');
    wrap.className = 'analytics-chart-grid';
    wrap.innerHTML = `
      <div class="analytics-chart-card" style="grid-column: 1 / -1;">
        <div class="chart-title">Linear Velocity: Target vs Actual (m/s)</div>
        <div class="chart-canvas-wrap" style="height: 180px;">
          <canvas id="chart-motion-velocity"></canvas>
        </div>
      </div>
      <div class="analytics-chart-card" style="grid-column: 1 / -1;">
        <div class="chart-title">Heading PID Error (deg) & Output</div>
        <div class="chart-canvas-wrap" style="height: 180px;">
          <canvas id="chart-motion-pid"></canvas>
        </div>
      </div>
    `;
    this.container.appendChild(wrap);

    const c1 = wrap.querySelector('#chart-motion-velocity');
    const c2 = wrap.querySelector('#chart-motion-pid');

    if (c1 && c1.getContext) {
      this.charts.velocity = new Chart(c1, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Target Linear Vel',
              data: [],
              borderColor: this.chartColors.cyan,
              borderDash: [5, 5],
              borderWidth: 1.5,
              pointRadius: 0,
              fill: false
            },
            {
              label: 'Actual Linear Vel',
              data: [],
              borderColor: this.chartColors.green,
              backgroundColor: this.chartColors.greenBg,
              borderWidth: 2,
              pointRadius: 0,
              fill: true
            }
          ]
        },
        options: this.getLineOptions('Velocity (m/s)')
      });
    }

    if (c2 && c2.getContext) {
      this.charts.pid = new Chart(c2, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Heading Error (°)',
              data: [],
              borderColor: this.chartColors.amber,
              borderWidth: 1.5,
              pointRadius: 0,
              fill: false
            },
            {
              label: 'PID Output (rad/s)',
              data: [],
              borderColor: this.chartColors.purple,
              borderWidth: 1.5,
              pointRadius: 0,
              fill: false
            }
          ]
        },
        options: this.getLineOptions('Value')
      });
    }
  }

  // =========================================================================
  // 4. BASKETBALL COLLECTION CHARTS VIEW
  // =========================================================================
  setupCollectionView() {
    const wrap = document.createElement('div');
    wrap.className = 'analytics-chart-grid';
    wrap.innerHTML = `
      <div class="analytics-chart-card">
        <div class="chart-title">Collection Success vs Failure</div>
        <div class="chart-canvas-wrap" style="height: 180px;">
          <canvas id="chart-collection-outcomes"></canvas>
        </div>
      </div>
      <div class="analytics-chart-card">
        <div class="chart-title">Collection by Gameplay Mode</div>
        <div class="chart-canvas-wrap" style="height: 180px;">
          <canvas id="chart-collection-modes"></canvas>
        </div>
      </div>
    `;
    this.container.appendChild(wrap);

    const c1 = wrap.querySelector('#chart-collection-outcomes');
    const c2 = wrap.querySelector('#chart-collection-modes');

    if (c1 && c1.getContext) {
      this.charts.collectionOutcomes = new Chart(c1, {
        type: 'doughnut',
        data: {
          labels: ['Successful Captures', 'Failed / Interrupted'],
          datasets: [{
            data: [0, 0],
            backgroundColor: [this.chartColors.green, this.chartColors.red],
            borderColor: this.chartColors.border,
            borderWidth: 1.5
          }]
        },
        options: this.getDoughnutOptions()
      });
    }

    if (c2 && c2.getContext) {
      this.charts.collectionModes = new Chart(c2, {
        type: 'bar',
        data: {
          labels: ['Manual', 'Autonomous'],
          datasets: [
            {
              label: 'Success',
              data: [0, 0],
              backgroundColor: this.chartColors.greenBg,
              borderColor: this.chartColors.green,
              borderWidth: 1.5
            },
            {
              label: 'Failed',
              data: [0, 0],
              backgroundColor: this.chartColors.redBg,
              borderColor: this.chartColors.red,
              borderWidth: 1.5
            }
          ]
        },
        options: this.getBarOptions()
      });
    }
  }

  // =========================================================================
  // 5. AUTONOMOUS PERFORMANCE CHARTS VIEW
  // =========================================================================
  setupAutonomyView() {
    const wrap = document.createElement('div');
    wrap.className = 'analytics-chart-grid';
    wrap.innerHTML = `
      <div class="analytics-chart-card" style="grid-column: 1 / -1;">
        <div class="chart-title">Time Spent in Autonomous States (seconds)</div>
        <div class="chart-canvas-wrap" style="height: 240px;">
          <canvas id="chart-autonomy-states"></canvas>
        </div>
      </div>
    `;
    this.container.appendChild(wrap);

    const c1 = wrap.querySelector('#chart-autonomy-states');

    if (c1 && c1.getContext) {
      this.charts.states = new Chart(c1, {
        type: 'bar',
        data: {
          labels: [
            'SEARCH_BALL', 'SELECT_TARGET', 'NAV_TO_BALL', 'COLLECT_BALL',
            'SEARCH_HOOP', 'NAV_TO_SHOOT', 'ALIGN_HOOP', 'OPTIMIZE_TRAJ',
            'SPIN_UP', 'SHOOTING', 'EVAL_SHOT', 'REACQUIRE', 'RECOVERING'
          ],
          datasets: [{
            label: 'Seconds in State',
            data: new Array(13).fill(0),
            backgroundColor: this.chartColors.cyanBg,
            borderColor: this.chartColors.cyan,
            borderWidth: 1.5
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: {
              grid: { color: this.chartColors.grid },
              ticks: { color: this.chartColors.text, font: { family: 'JetBrains Mono, monospace', size: 10 } }
            },
            y: {
              grid: { display: false },
              ticks: { color: this.chartColors.text, font: { family: 'JetBrains Mono, monospace', size: 9 } }
            }
          }
        }
      });
    }
  }

  // =========================================================================
  // REAL-TIME UPDATE METHODS
  // =========================================================================
  /**
   * Updates currently visible charts with new simulation telemetry.
   * @param {Object} telemetry Consolidated telemetry packet containing analytics
   */
  update(telemetry) {
    if (!telemetry || !telemetry.analytics) return;
    const a = telemetry.analytics;

    switch (this.currentCategory) {
      case 'SHOOTING':
        this.updateShootingCharts(a.shooting);
        break;
      case 'NAVIGATION':
        this.updateNavigationCharts(a.navigation);
        break;
      case 'MOTION':
        this.updateMotionCharts(a.motion);
        break;
      case 'COLLECTION':
        this.updateCollectionCharts(a.collection);
        break;
      case 'AUTONOMY':
        this.updateAutonomyCharts(a.autonomy);
        break;
    }
  }

  updateShootingCharts(shooting) {
    if (!shooting) return;

    if (this.charts.outcomes) {
      this.charts.outcomes.data.datasets[0].data = [
        shooting.successfulBaskets || 0,
        shooting.missedShots || 0
      ];
      this.charts.outcomes.update('none');
    }

    if (this.charts.misses && shooting.outcomeDistribution) {
      const d = shooting.outcomeDistribution;
      this.charts.misses.data.datasets[0].data = [
        d.MISSED_SHORT || 0,
        d.MISSED_LONG || 0,
        d.MISSED_LEFT || 0,
        d.MISSED_RIGHT || 0,
        d.MISSED || 0
      ];
      this.charts.misses.update('none');
    }
  }

  updateNavigationCharts(nav) {
    if (!nav) return;

    if (this.charts.tasks) {
      this.charts.tasks.data.datasets[0].data = [
        nav.successfulTasks || 0,
        nav.failedTasks || 0
      ];
      this.charts.tasks.update('none');
    }

    if (this.charts.distance) {
      this.charts.distance.data.datasets[0].data = [
        Number((nav.totalPlannedPathLength || 0).toFixed(2)),
        Number((nav.totalActualPathLength || 0).toFixed(2))
      ];
      this.charts.distance.update('none');
    }
  }

  updateMotionCharts(motion) {
    if (!motion || !motion.timeSeries) return;
    const ts = motion.timeSeries;

    if (this.charts.velocity) {
      this.charts.velocity.data.labels = ts.timestamps || [];
      this.charts.velocity.data.datasets[0].data = ts.targetLinearVelocities || [];
      this.charts.velocity.data.datasets[1].data = ts.actualLinearVelocities || [];
      this.charts.velocity.update('none');
    }

    if (this.charts.pid) {
      this.charts.pid.data.labels = ts.timestamps || [];
      this.charts.pid.data.datasets[0].data = ts.pidErrors || [];
      this.charts.pid.data.datasets[1].data = ts.pidOutputs || [];
      this.charts.pid.update('none');
    }
  }

  updateCollectionCharts(collection) {
    if (!collection) return;

    if (this.charts.collectionOutcomes) {
      this.charts.collectionOutcomes.data.datasets[0].data = [
        collection.successfulCollections || 0,
        collection.failedCollections || 0
      ];
      this.charts.collectionOutcomes.update('none');
    }

    if (this.charts.collectionModes && collection.modes) {
      const m = collection.modes;
      this.charts.collectionModes.data.datasets[0].data = [
        m.MANUAL?.successes || 0,
        m.AUTONOMOUS?.successes || 0
      ];
      this.charts.collectionModes.data.datasets[1].data = [
        m.MANUAL?.failures || 0,
        m.AUTONOMOUS?.failures || 0
      ];
      this.charts.collectionModes.update('none');
    }
  }

  updateAutonomyCharts(autonomy) {
    if (!autonomy || !autonomy.stateDurations) return;
    const s = autonomy.stateDurations;

    if (this.charts.states) {
      this.charts.states.data.datasets[0].data = [
        Number((s.SEARCHING_FOR_BALL || 0).toFixed(1)),
        Number((s.SELECTING_TARGET || 0).toFixed(1)),
        Number((s.NAVIGATING_TO_BALL || 0).toFixed(1)),
        Number((s.COLLECTING_BALL || 0).toFixed(1)),
        Number((s.SEARCHING_FOR_HOOP || 0).toFixed(1)),
        Number((s.NAVIGATING_TO_SHOOTING_POSITION || 0).toFixed(1)),
        Number((s.ALIGNING_WITH_HOOP || 0).toFixed(1)),
        Number((s.OPTIMIZING_TRAJECTORY || 0).toFixed(1)),
        Number((s.SPINNING_UP_FLYWHEELS || 0).toFixed(1)),
        Number((s.SHOOTING || 0).toFixed(1)),
        Number((s.EVALUATING_SHOT || 0).toFixed(1)),
        Number((s.REACQUIRING_BALL || 0).toFixed(1)),
        Number((s.RECOVERING || 0).toFixed(1))
      ];
      this.charts.states.update('none');
    }
  }

  // =========================================================================
  // CHART CONFIG HELPERS
  // =========================================================================
  getDoughnutOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: this.chartColors.text,
            font: { family: 'JetBrains Mono, monospace', size: 10 }
          }
        }
      }
    };
  }

  getBarOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: this.chartColors.text,
            font: { family: 'JetBrains Mono, monospace', size: 10 }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: this.chartColors.text, font: { family: 'JetBrains Mono, monospace', size: 9 } }
        },
        y: {
          grid: { color: this.chartColors.grid },
          ticks: { color: this.chartColors.text, font: { family: 'JetBrains Mono, monospace', size: 9 } }
        }
      }
    };
  }

  getLineOptions(yTitle = 'Value') {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          labels: {
            color: this.chartColors.text,
            font: { family: 'JetBrains Mono, monospace', size: 10 }
          }
        }
      },
      scales: {
        x: {
          grid: { color: this.chartColors.grid },
          ticks: {
            color: this.chartColors.text,
            font: { family: 'JetBrains Mono, monospace', size: 9 },
            maxTicksLimit: 8
          }
        },
        y: {
          title: {
            display: true,
            text: yTitle,
            color: this.chartColors.text,
            font: { family: 'JetBrains Mono, monospace', size: 9 }
          },
          grid: { color: this.chartColors.grid },
          ticks: { color: this.chartColors.text, font: { family: 'JetBrains Mono, monospace', size: 9 } }
        }
      }
    };
  }

  destroy() {
    this.destroyCharts();
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
