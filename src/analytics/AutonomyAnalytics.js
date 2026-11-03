/**
 * AutonomyAnalytics.js
 * Tracks autonomous gameplay session performance, state durations across all 18 states,
 * recovery effectiveness, autonomous shooting accuracy, and fixed-target progress.
 */

import { ANALYTICS_CONFIG, AUTONOMY_STATES_LIST } from './AnalyticsConfig.js';

export class AutonomyAnalytics {
  /**
   * @param {Object} [config]
   */
  constructor(config = {}) {
    this.config = { ...ANALYTICS_CONFIG, ...config };

    this.reset();
  }

  /**
   * Resets all autonomous session metrics, state timers, and history cleanly.
   */
  reset() {
    this.totalSessions = 0;
    this.completedSessions = 0;
    this.failedSessions = 0;
    this.cancelledSessions = 0;

    // Autonomous shooting metrics
    this.successfulShots = 0;
    this.totalAttempts = 0;
    this.missedShots = 0;
    this.accuracyPercent = 0.0;

    // Time and durations
    this.totalAutonomousDuration = 0.0;
    this.averageTimePerBasket = 0.0;

    // Recoveries
    this.recoveryAttempts = 0;
    this.successfulRecoveries = 0;
    this.recoverySuccessRate = 0.0;

    // Time spent in each of the 18 states (seconds)
    this.stateDurations = {};
    for (const stateName of AUTONOMY_STATES_LIST) {
      this.stateDurations[stateName] = 0.0;
    }

    // Active session details
    this.activeSession = null;
    this.currentState = 'IDLE';

    // Fixed-target mode tracking
    this.currentMode = 'NONE'; // 'CONTINUOUS', 'FIXED_TARGET', 'NONE'
    this.targetShots = 0;
    this.fixedTargetProgress = 0.0; // Percentage 0-100%

    // Mode-specific performance summaries
    this.modeStats = {
      CONTINUOUS: { sessions: 0, completions: 0, shots: 0, baskets: 0, duration: 0 },
      FIXED_TARGET: { sessions: 0, completions: 0, shots: 0, baskets: 0, duration: 0 }
    };

    // State transition history
    this.stateTransitions = [];

    // Historical sessions
    this.sessionHistory = [];

    // Internal tracking for recovery lifecycle
    this._wasInRecovery = false;
  }

  /**
   * Starts tracking a new autonomous gameplay session.
   *
   * @param {string} mode 'CONTINUOUS' or 'FIXED_TARGET'
   * @param {number} [targetShots=0] Target baskets for fixed target mode
   * @returns {Object} Active session record
   */
  startSession(mode = 'CONTINUOUS', targetShots = 0) {
    if (this.activeSession && !this.activeSession.isFinished) {
      this.finishSession('CANCELLED', 'Superseded by new session');
    }

    this.totalSessions++;
    this.currentMode = mode;
    this.targetShots = targetShots;
    this.fixedTargetProgress = 0.0;

    if (this.modeStats[mode]) {
      this.modeStats[mode].sessions++;
    }

    this.activeSession = {
      id: Date.now(),
      sessionNumber: this.totalSessions,
      mode: mode,
      targetShots: targetShots,
      startTime: Date.now(),
      duration: 0.0,
      successfulShots: 0,
      totalAttempts: 0,
      recoveryAttempts: 0,
      status: 'ACTIVE',
      isFinished: false
    };

    return this.activeSession;
  }

  /**
   * Records an autonomous state transition and accumulates state duration.
   *
   * @param {string} from Previous state
   * @param {string} to Next state
   * @param {string} [reason=''] Diagnostic reason
   */
  recordStateTransition(from, to, reason = '') {
    const now = Date.now();
    this.currentState = to;

    // Track state transition in bounded history
    this.stateTransitions.push({
      from,
      to,
      time: now,
      reason
    });

    if (this.stateTransitions.length > this.config.limits.maxStateTransitions) {
      this.stateTransitions.shift();
    }

    // 1. Detect start of session if entering active gameplay from IDLE
    if (from === 'IDLE' && to !== 'IDLE' && !this.activeSession) {
      this.startSession(this.currentMode !== 'NONE' ? this.currentMode : 'CONTINUOUS', this.targetShots);
    }

    // 2. Track recovery lifecycle
    if (to === 'RECOVERING') {
      this.recoveryAttempts++;
      if (this.activeSession) this.activeSession.recoveryAttempts++;
      this._wasInRecovery = true;
    } else if (this._wasInRecovery) {
      // Transitioned out of RECOVERING: if not FAILED/CANCELLED, recovery was successful
      if (to !== 'FAILED' && to !== 'CANCELLED') {
        this.successfulRecoveries++;
      }
      this._updateRecoveryRate();
      this._wasInRecovery = false;
    }

    // 3. Detect terminal states of the session
    if (to === 'COMPLETED' || to === 'FAILED' || to === 'CANCELLED') {
      this.finishSession(to, reason);
    }
  }

  /**
   * Steps the state duration timers and active session duration.
   *
   * @param {number} dt Time step in seconds
   * @param {string} currentState Active autonomous state
   */
  update(dt, currentState = this.currentState) {
    this.currentState = currentState;

    // Accumulate duration in current state
    if (this.stateDurations[currentState] !== undefined) {
      this.stateDurations[currentState] += dt;
    } else {
      this.stateDurations[currentState] = dt;
    }

    // Accumulate session duration if active
    if (this.activeSession && !this.activeSession.isFinished) {
      this.totalAutonomousDuration += dt;
      this.activeSession.duration += dt;

      if (this.modeStats[this.currentMode]) {
        this.modeStats[this.currentMode].duration += dt;
      }
    }
  }

  /**
   * Records a shot outcome specifically during autonomous gameplay.
   *
   * @param {boolean} isScored True if basket scored
   */
  recordAutonomousShot(isScored) {
    this.totalAttempts++;

    if (this.activeSession && !this.activeSession.isFinished) {
      this.activeSession.totalAttempts++;
    }

    if (this.modeStats[this.currentMode]) {
      this.modeStats[this.currentMode].shots++;
    }

    if (isScored) {
      this.successfulShots++;

      if (this.activeSession && !this.activeSession.isFinished) {
        this.activeSession.successfulShots++;
      }

      if (this.modeStats[this.currentMode]) {
        this.modeStats[this.currentMode].baskets++;
      }
    } else {
      this.missedShots++;
    }

    this._updateAccuracy();
    this._updateTimePerBasket();
    this._updateFixedTargetProgress();
  }

  /**
   * Concludes an autonomous gameplay session based on terminal state machine transition.
   *
   * @param {'COMPLETED'|'FAILED'|'CANCELLED'} status
   * @param {string} [reason='']
   * @returns {Object|null}
   */
  finishSession(status, reason = '') {
    if (!this.activeSession || this.activeSession.isFinished) {
      return null;
    }

    const session = this.activeSession;
    session.isFinished = true;
    session.status = status;
    session.reason = reason;

    if (status === 'COMPLETED') {
      this.completedSessions++;
      if (this.modeStats[session.mode]) {
        this.modeStats[session.mode].completions++;
      }
    } else if (status === 'FAILED') {
      this.failedSessions++;
    } else if (status === 'CANCELLED') {
      this.cancelledSessions++;
    }

    this.sessionHistory.unshift({ ...session });
    if (this.sessionHistory.length > 30) {
      this.sessionHistory.pop();
    }

    this.activeSession = null;
    return session;
  }

  /**
   * Updates autonomous shooting accuracy.
   * Formula: Accuracy = (Successful Shots / Total Attempts) * 100
   * @private
   */
  _updateAccuracy() {
    if (this.totalAttempts <= 0) {
      this.accuracyPercent = 0.0;
    } else {
      this.accuracyPercent = (this.successfulShots / this.totalAttempts) * 100.0;
    }
  }

  /**
   * Updates average time per basket.
   * Formula: Avg Time Per Basket = Total Autonomous Duration / Successful Shots
   * @private
   */
  _updateTimePerBasket() {
    if (this.successfulShots <= 0) {
      this.averageTimePerBasket = 0.0;
    } else {
      this.averageTimePerBasket = this.totalAutonomousDuration / this.successfulShots;
    }
  }

  /**
   * Updates recovery success rate.
   * Formula: Recovery Success Rate = (Successful Recoveries / Total Recovery Attempts) * 100
   * @private
   */
  _updateRecoveryRate() {
    if (this.recoveryAttempts <= 0) {
      this.recoverySuccessRate = 0.0;
    } else {
      this.recoverySuccessRate = (this.successfulRecoveries / this.recoveryAttempts) * 100.0;
    }
  }

  /**
   * Updates fixed-target mode progress percentage.
   * @private
   */
  _updateFixedTargetProgress() {
    if (this.currentMode === 'FIXED_TARGET' && this.targetShots > 0) {
      const basketsInSession = this.activeSession ? this.activeSession.successfulShots : this.successfulShots;
      this.fixedTargetProgress = Math.min(100.0, (basketsInSession / this.targetShots) * 100.0);
    } else {
      this.fixedTargetProgress = 0.0;
    }
  }

  /**
   * Returns comprehensive telemetry packet.
   */
  getTelemetry() {
    return {
      totalSessions: this.totalSessions,
      completedSessions: this.completedSessions,
      failedSessions: this.failedSessions,
      cancelledSessions: this.cancelledSessions,
      successfulShots: this.successfulShots,
      totalAttempts: this.totalAttempts,
      missedShots: this.missedShots,
      accuracyPercent: this.accuracyPercent,
      averageTimePerBasket: this.averageTimePerBasket,
      totalAutonomousDuration: this.totalAutonomousDuration,
      recoveryAttempts: this.recoveryAttempts,
      successfulRecoveries: this.successfulRecoveries,
      recoverySuccessRate: this.recoverySuccessRate,
      currentState: this.currentState,
      currentMode: this.currentMode,
      targetShots: this.targetShots,
      fixedTargetProgress: this.fixedTargetProgress,
      stateDurations: { ...this.stateDurations },
      modeStats: {
        CONTINUOUS: { ...this.modeStats.CONTINUOUS },
        FIXED_TARGET: { ...this.modeStats.FIXED_TARGET }
      },
      activeSession: this.activeSession ? { ...this.activeSession } : null,
      transitionCount: this.stateTransitions.length,
      historyCount: this.sessionHistory.length
    };
  }
}
