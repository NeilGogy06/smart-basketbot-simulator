/**
 * AutonomousStateMachine.js
 * Explicit, validated finite state machine managing the 18 lifecycle states
 * of the SMART-BASKETBOT autonomous gameplay intelligence.
 */

import { AUTONOMOUS_STATES } from './AutonomousConfig.js';

export class AutonomousStateMachine {
  /**
   * @param {Object} [options]
   * @param {string} [options.initialState=AUTONOMOUS_STATES.IDLE]
   */
  constructor(options = {}) {
    this.state = options.initialState || AUTONOMOUS_STATES.IDLE;
    this.previousState = null;
    this.stateTimer = 0.0;
    this.statusMessage = 'Autonomous intelligence system initialized';
    this.history = [];

    // State change callbacks
    this.listeners = [];
  }

  /**
   * Returns current active state string.
   */
  getState() {
    return this.state;
  }

  /**
   * Returns time in seconds spent in current state.
   */
  getTimeInState() {
    return this.stateTimer;
  }

  /**
   * Whether state machine is in active gameplay (not IDLE, PAUSED, or terminal).
   */
  get isActive() {
    return (
      this.state !== AUTONOMOUS_STATES.IDLE &&
      this.state !== AUTONOMOUS_STATES.PAUSED &&
      !this.isTerminal()
    );
  }

  /**
   * Whether state machine is in a terminal state (COMPLETED, FAILED, CANCELLED).
   */
  isTerminal() {
    return (
      this.state === AUTONOMOUS_STATES.COMPLETED ||
      this.state === AUTONOMOUS_STATES.FAILED ||
      this.state === AUTONOMOUS_STATES.CANCELLED
    );
  }

  /**
   * Whether state machine is paused.
   */
  isPaused() {
    return this.state === AUTONOMOUS_STATES.PAUSED;
  }

  /**
   * Transitions to a new state with explicit reason logging.
   * @param {string} nextState Target state from AUTONOMOUS_STATES
   * @param {string} [reason=''] Diagnostic message explaining transition
   * @returns {boolean} Whether transition was accepted
   */
  transitionTo(nextState, reason = '') {
    if (!AUTONOMOUS_STATES[nextState]) {
      console.warn(`[AutonomousStateMachine] Invalid state requested: ${nextState}`);
      return false;
    }

    if (this.state === nextState) {
      // Refresh status message if already in state
      if (reason) this.statusMessage = reason;
      return true;
    }

    const prevState = this.state;
    this.previousState = prevState;
    this.state = nextState;
    this.stateTimer = 0.0;
    this.statusMessage = reason || `Transitioned to ${nextState}`;

    // Record in transition history (capped to last 30 entries)
    this.history.push({
      from: prevState,
      to: nextState,
      time: Date.now(),
      reason: this.statusMessage
    });
    if (this.history.length > 30) {
      this.history.shift();
    }

    // Notify listeners
    this.notify(prevState, nextState, this.statusMessage);
    return true;
  }

  /**
   * Pauses the state machine, saving previous active state for seamless resumption.
   * @param {string} [reason='Session paused by operator']
   */
  pause(reason = 'Session paused by operator') {
    if (this.isTerminal() || this.state === AUTONOMOUS_STATES.PAUSED) {
      return false;
    }
    return this.transitionTo(AUTONOMOUS_STATES.PAUSED, reason);
  }

  /**
   * Resumes execution from paused state, restoring previously active state.
   * @returns {boolean} Whether resumption succeeded
   */
  resume() {
    if (this.state !== AUTONOMOUS_STATES.PAUSED) {
      return false;
    }
    const restoreState = this.previousState && this.previousState !== AUTONOMOUS_STATES.PAUSED
      ? this.previousState
      : AUTONOMOUS_STATES.SEARCHING_FOR_BALL;

    return this.transitionTo(restoreState, `Resumed from pause into ${restoreState}`);
  }

  /**
   * Cancels active execution and halts in CANCELLED state.
   * @param {string} [reason='Autonomous gameplay cancelled']
   */
  cancel(reason = 'Autonomous gameplay cancelled') {
    return this.transitionTo(AUTONOMOUS_STATES.CANCELLED, reason);
  }

  /**
   * Transitions to FAILED state upon unrecoverable error.
   * @param {string} [reason='Autonomous operation failed']
   */
  fail(reason = 'Autonomous operation failed') {
    return this.transitionTo(AUTONOMOUS_STATES.FAILED, reason);
  }

  /**
   * Transitions to COMPLETED state upon goal achievement.
   * @param {string} [reason='Autonomous mission target completed']
   */
  complete(reason = 'Autonomous mission target completed') {
    return this.transitionTo(AUTONOMOUS_STATES.COMPLETED, reason);
  }

  /**
   * Resets state machine back to IDLE.
   */
  reset() {
    this.state = AUTONOMOUS_STATES.IDLE;
    this.previousState = null;
    this.stateTimer = 0.0;
    this.statusMessage = 'System idle and ready';
    this.history = [];
    this.notify(null, AUTONOMOUS_STATES.IDLE, this.statusMessage);
  }

  /**
   * Updates state timer.
   * @param {number} dt Delta time in seconds
   */
  update(dt) {
    this.stateTimer += dt;
  }

  /**
   * Subscribes to state transition events.
   * @param {(from: string, to: string, reason: string) => void} callback
   */
  onStateChange(callback) {
    this.listeners.push(callback);
  }

  /**
   * Dispatches state change notification to registered callbacks.
   */
  notify(from, to, reason) {
    for (let i = 0; i < this.listeners.length; i++) {
      try {
        this.listeners[i](from, to, reason);
      } catch (err) {
        console.error('[AutonomousStateMachine] Listener error:', err);
      }
    }
  }

  /**
   * Returns telemetry snapshot of state machine.
   */
  getTelemetry() {
    return {
      state: this.state,
      previousState: this.previousState,
      timeInState: Number(this.stateTimer.toFixed(2)),
      statusMessage: this.statusMessage,
      isActive: this.isActive,
      isPaused: this.isPaused(),
      isTerminal: this.isTerminal(),
      historyCount: this.history.length
    };
  }
}
