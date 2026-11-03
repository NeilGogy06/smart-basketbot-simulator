/**
 * AdaptiveShotCorrector.js
 * Deterministic adaptive closed-loop correction controller for basketball shooting.
 * Adjusts subsequent shot launch parameters (velocity bias, elevation angle bias, heading bias)
 * based on empirical miss outcomes (short, long, left, right) while strictly enforcing
 * anti-windup saturation bounds for closed-loop stability.
 *
 * NOTE: This is a classical deterministic adaptive feedback law, not statistical machine learning.
 */

import { RobotKinematics } from './RobotKinematics.js';

export class AdaptiveShotCorrector {
  /**
   * @param {Object} [options]
   * @param {number} [options.velocityStep=0.15] Velocity adjustment per short/long miss (m/s)
   * @param {number} [options.headingStep=0.015] Heading adjustment per lateral miss (rad)
   * @param {number} [options.elevationStep=0.5] Elevation angle adjustment (deg)
   * @param {number} [options.maxVelocityBias=1.5] Hard clamp limit on velocity correction (m/s)
   * @param {number} [options.maxHeadingBias=0.06] Hard clamp limit on heading correction (rad ~3.4°)
   * @param {number} [options.maxElevationBias=3.0] Hard clamp limit on elevation angle correction (deg)
   * @param {number} [options.decayFactor=0.90] Exponential decay applied to biases upon successful score
   */
  constructor(options = {}) {
    this.velocityStep = options.velocityStep ?? 0.15;
    this.headingStep = options.headingStep ?? 0.015;
    this.elevationStep = options.elevationStep ?? 0.5;

    this.maxVelocityBias = options.maxVelocityBias ?? 1.5;
    this.maxHeadingBias = options.maxHeadingBias ?? 0.06;
    this.maxElevationBias = options.maxElevationBias ?? 3.0;
    this.decayFactor = options.decayFactor ?? 0.90;

    // Cumulative adaptive offsets
    this.velocityBias = 0.0; // m/s
    this.elevationBias = 0.0; // degrees
    this.headingBias = 0.0; // radians

    // Adjustment event log
    this.history = [];
  }

  /**
   * Updates adaptive parameters based on the observed physical outcome of a shot.
   *
   * @param {Object} shotRecord Detailed record from HoopDetector
   * @param {string} shotRecord.outcome 'SCORED'|'MISSED_SHORT'|'MISSED_LONG'|'MISSED_LEFT'|'MISSED_RIGHT'|'MISSED'
   * @param {number} [shotRecord.distance]
   * @param {number} [shotRecord.launchSpeed]
   * @returns {{ velocityBias: number, elevationBias: number, headingBias: number, action: string }}
   */
  recordShotOutcome(shotRecord) {
    if (!shotRecord) return this.getTelemetry();

    const outcome = shotRecord.outcome || 'MISSED';
    let action = 'NO_CHANGE';

    switch (outcome) {
      case 'MISSED_SHORT':
        // Ball fell short of target: increase launch speed
        this.velocityBias += this.velocityStep;
        action = `Increased launch velocity by +${this.velocityStep.toFixed(2)} m/s (undershot)`;
        break;

      case 'MISSED_LONG':
        // Ball overshot target: decrease launch speed
        this.velocityBias -= this.velocityStep;
        action = `Decreased launch velocity by -${this.velocityStep.toFixed(2)} m/s (overshot)`;
        break;

      case 'MISSED_LEFT':
        // Ball deviated left (+Z in East-facing frame): apply negative heading offset (steer right)
        this.headingBias -= this.headingStep;
        action = `Adjusted heading bias by -${(this.headingStep * 180 / Math.PI).toFixed(2)}° (steered right)`;
        break;

      case 'MISSED_RIGHT':
        // Ball deviated right (-Z in East-facing frame): apply positive heading offset (steer left)
        this.headingBias += this.headingStep;
        action = `Adjusted heading bias by +${(this.headingStep * 180 / Math.PI).toFixed(2)}° (steered left)`;
        break;

      case 'SCORED':
        // Successful basket: damp/decay corrections slightly toward zero to prevent saturation creep
        this.velocityBias *= this.decayFactor;
        this.headingBias *= this.decayFactor;
        this.elevationBias *= this.decayFactor;
        action = `Maintained calibrated launch parameters (decay factor ${this.decayFactor})`;
        break;

      case 'MISSED':
      default:
        // Generic miss without clear directional bias: no parameter shift
        action = 'Unclassified miss: preserved current biases';
        break;
    }

    // Apply strict saturation clamps (anti-windup)
    this.velocityBias = Math.max(-this.maxVelocityBias, Math.min(this.maxVelocityBias, this.velocityBias));
    this.elevationBias = Math.max(-this.maxElevationBias, Math.min(this.maxElevationBias, this.elevationBias));
    this.headingBias = Math.max(-this.maxHeadingBias, Math.min(this.maxHeadingBias, this.headingBias));

    const event = {
      shotNumber: this.history.length + 1,
      timestamp: Date.now(),
      outcome,
      action,
      biases: {
        velocityBias: this.velocityBias,
        elevationBias: this.elevationBias,
        headingBias: this.headingBias
      }
    };

    this.history.unshift(event);
    if (this.history.length > 25) {
      this.history.pop();
    }

    return event;
  }

  /**
   * Compatibility alias for recordShotOutcome.
   * Updates adaptive parameters based on the observed physical outcome of a shot.
   *
   * @param {Object} shotRecord Detailed record from HoopDetector
   * @returns {{ velocityBias: number, elevationBias: number, headingBias: number, action: string }}
   */
  recordOutcome(shotRecord) {
    return this.recordShotOutcome(shotRecord);
  }

  /**
   * Applies cumulative adaptive biases to nominal ballistic trajectory parameters.
   *
   * @param {Object} nominalParams
   * @param {number} nominalParams.speed Nominal launch speed (m/s)
   * @param {number} nominalParams.launchAngleDeg Nominal launch angle (degrees)
   * @param {number} nominalParams.requiredHeadingRad Nominal required yaw heading (radians)
   * @returns {{
   *   speed: number,
   *   launchAngleDeg: number,
   *   targetHeadingRad: number,
   *   biases: { velocityBias: number, elevationBias: number, headingBias: number }
   * }}
   */
  applyCorrection(nominalParams) {
    if (!nominalParams) return null;

    const correctedSpeed = Math.max(5.0, Math.min(14.5, nominalParams.speed + this.velocityBias));
    const correctedAngle = Math.max(40.0, Math.min(72.0, nominalParams.launchAngleDeg + this.elevationBias));
    const correctedHeading = RobotKinematics.normalizeAngle(nominalParams.requiredHeadingRad + this.headingBias);

    return {
      speed: correctedSpeed,
      launchAngleDeg: correctedAngle,
      targetHeadingRad: correctedHeading,
      biases: {
        velocityBias: this.velocityBias,
        elevationBias: this.elevationBias,
        headingBias: this.headingBias
      }
    };
  }

  /**
   * Resets all adaptive biases and history log to zero.
   */
  reset() {
    this.velocityBias = 0.0;
    this.elevationBias = 0.0;
    this.headingBias = 0.0;
    this.history = [];
  }

  /**
   * Telemetry summary.
   */
  getTelemetry() {
    return {
      velocityBias: this.velocityBias,
      elevationBias: this.elevationBias,
      headingBiasRad: this.headingBias,
      headingBiasDeg: (this.headingBias * 180) / Math.PI,
      totalAdjustments: this.history.length,
      lastAdjustment: this.history.length > 0 ? this.history[0] : null
    };
  }
}
