/**
 * CollectionAnalytics.js
 * Tracks basketball intake performance, collection attempts, duration,
 * success rate, retries, and distinguishes manual vs autonomous collection.
 */

import { ANALYTICS_CONFIG } from './AnalyticsConfig.js';

export class CollectionAnalytics {
  /**
   * @param {Object} [config]
   */
  constructor(config = {}) {
    this.config = { ...ANALYTICS_CONFIG, ...config };

    this.reset();
  }

  /**
   * Resets all collection metrics and history cleanly.
   */
  reset() {
    this.totalAttempts = 0;
    this.successfulCollections = 0;
    this.failedCollections = 0;
    this.collectionSuccessRate = 0.0;
    this.totalBasketballsCollected = 0;
    this.collectionRetries = 0;

    // Running duration sum
    this.totalCollectionDuration = 0.0;
    this.successfulDurationCount = 0;

    // Mode-specific breakdowns
    this.modes = {
      MANUAL: { attempts: 0, successes: 0, failures: 0, totalDuration: 0 },
      AUTONOMOUS: { attempts: 0, successes: 0, failures: 0, totalDuration: 0 }
    };

    // Active uncompleted attempt
    this.activeAttempt = null;

    // History of attempts
    this.attemptHistory = [];

    // Internal state tracking for transition detection
    this._prevIntakeState = 'IDLE';
    this._prevCaptured = false;
  }

  /**
   * Begins a new ball collection attempt lifecycle.
   * Guaranteed to be counted only once per physical collection sequence.
   *
   * @param {Object} [options]
   * @param {string} [options.mode='MANUAL'] 'MANUAL' or 'AUTONOMOUS'
   * @param {number} [options.timestamp] Milliseconds
   * @returns {Object} Active attempt record
   */
  startAttempt(options = {}) {
    // If an attempt is already active and incomplete, do not double-count
    if (this.activeAttempt && !this.activeAttempt.isFinished) {
      if (options.mode && this.activeAttempt.mode === 'MANUAL') {
        this.activeAttempt.mode = options.mode;
      }
      return this.activeAttempt;
    }

    this.totalAttempts++;
    const mode = options.mode || 'MANUAL';
    if (this.modes[mode]) {
      this.modes[mode].attempts++;
    }

    const now = options.timestamp || Date.now();
    this.activeAttempt = {
      id: now,
      attemptNumber: this.totalAttempts,
      startTime: now,
      mode: mode,
      duration: 0.0,
      retries: 0,
      status: 'INTAKING',
      isFinished: false
    };

    this._updateSuccessRate();
    return this.activeAttempt;
  }

  /**
   * Increments collection retries (e.g. autonomous reacquisition maneuver).
   */
  recordRetry() {
    this.collectionRetries++;
    if (this.activeAttempt && !this.activeAttempt.isFinished) {
      this.activeAttempt.retries++;
    }
  }

  /**
   * Resolves the active collection attempt as successful upon genuine ball capture.
   *
   * @param {Object} [data]
   * @param {number} [data.duration] Duration in seconds
   * @param {string} [data.mode] 'MANUAL' or 'AUTONOMOUS'
   * @returns {Object|null}
   */
  recordSuccess(data = {}) {
    let attempt = this.activeAttempt;

    // If an attempt was not explicitly started prior to capture, record now
    if (!attempt || attempt.isFinished) {
      attempt = this.startAttempt({ mode: data.mode || 'MANUAL' });
    }

    attempt.isFinished = true;
    attempt.status = 'SUCCESS';

    const duration = data.duration != null
      ? data.duration
      : Math.max(0.1, (Date.now() - attempt.startTime) / 1000.0);

    attempt.duration = duration;

    this.successfulCollections++;
    this.totalBasketballsCollected++;
    this.totalCollectionDuration += duration;
    this.successfulDurationCount++;

    const mode = attempt.mode;
    if (this.modes[mode]) {
      this.modes[mode].successes++;
      this.modes[mode].totalDuration += duration;
    }

    this._updateSuccessRate();

    this.attemptHistory.unshift({ ...attempt });
    if (this.attemptHistory.length > this.config.limits.maxCollectionHistory) {
      this.attemptHistory.pop();
    }

    this.activeAttempt = null;
    return attempt;
  }

  /**
   * Resolves the active collection attempt as failed (e.g. intake stopped without ball, timeout, reject).
   *
   * @param {string} [reason='Intake stopped without ball capture']
   * @returns {Object|null}
   */
  recordFailure(reason = 'Intake stopped without ball capture') {
    if (!this.activeAttempt || this.activeAttempt.isFinished) {
      return null;
    }

    const attempt = this.activeAttempt;
    attempt.isFinished = true;
    attempt.status = 'FAILED';
    attempt.reason = reason;
    attempt.duration = Math.max(0.1, (Date.now() - attempt.startTime) / 1000.0);

    this.failedCollections++;

    const mode = attempt.mode;
    if (this.modes[mode]) {
      this.modes[mode].failures++;
    }

    this._updateSuccessRate();

    this.attemptHistory.unshift({ ...attempt });
    if (this.attemptHistory.length > this.config.limits.maxCollectionHistory) {
      this.attemptHistory.pop();
    }

    this.activeAttempt = null;
    return attempt;
  }

  /**
   * Evaluates intake state transitions from robot intake telemetry.
   * Automatically starts, resolves, or fails attempts based on genuine physical state changes.
   *
   * @param {number} dt Time step
   * @param {Object} intakeTel Telemetry from IntakeMechanism
   * @param {string} [gameplayMode='MANUAL']
   */
  update(dt, intakeTel = {}, gameplayMode = 'MANUAL') {
    const currentState = intakeTel.state || 'IDLE';
    const isCaptured = Boolean(intakeTel.isBallCaptured);

    // 1. Detect start of collection attempt:
    // Transition from IDLE/STOPPED to INTAKING
    if (currentState === 'INTAKING' && this._prevIntakeState !== 'INTAKING' && !isCaptured) {
      this.startAttempt({ mode: gameplayMode });
    }

    // 2. Detect successful capture:
    // Ball captured flag transitioned from false to true
    if (isCaptured && !this._prevCaptured) {
      this.recordSuccess({ mode: gameplayMode });
    }

    // 3. Detect failed attempt:
    // Intake was stopped or reset without capturing
    if (this._prevIntakeState === 'INTAKING' && (currentState === 'IDLE' || currentState === 'STOPPED') && !isCaptured) {
      this.recordFailure('Intake stopped before ball acquisition');
    }

    // Update active attempt duration
    if (this.activeAttempt && !this.activeAttempt.isFinished) {
      this.activeAttempt.duration += dt;
    }

    this._prevIntakeState = currentState;
    this._prevCaptured = isCaptured;
  }

  /**
   * Recalculates collection success rate.
   * Formula: Success Rate = (Successful Collections / Total Attempts) * 100
   * @private
   */
  _updateSuccessRate() {
    if (this.totalAttempts <= 0) {
      this.collectionSuccessRate = 0.0;
    } else {
      this.collectionSuccessRate = (this.successfulCollections / this.totalAttempts) * 100.0;
    }
  }

  /**
   * Average collection duration in seconds.
   */
  getAverageCollectionDuration() {
    return this.successfulDurationCount > 0
      ? (this.totalCollectionDuration / this.successfulDurationCount)
      : 0.0;
  }

  /**
   * Returns comprehensive telemetry packet.
   */
  getTelemetry() {
    return {
      totalAttempts: this.totalAttempts,
      successfulCollections: this.successfulCollections,
      failedCollections: this.failedCollections,
      collectionSuccessRate: this.collectionSuccessRate,
      totalBasketballsCollected: this.totalBasketballsCollected,
      collectionRetries: this.collectionRetries,
      averageCollectionDuration: this.getAverageCollectionDuration(),
      modes: {
        MANUAL: { ...this.modes.MANUAL },
        AUTONOMOUS: { ...this.modes.AUTONOMOUS }
      },
      activeAttempt: this.activeAttempt ? { ...this.activeAttempt } : null,
      historyCount: this.attemptHistory.length
    };
  }
}
