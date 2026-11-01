/**
 * PIDController.js
 * Industrial-grade Proportional-Integral-Derivative (PID) controller
 * with anti-windup clamping, output saturation, derivative filtering,
 * and specialized heading control with angular wrapping.
 */

import { RobotKinematics } from './RobotKinematics.js';

export class PIDController {
  /**
   * @param {Object} options
   * @param {number} [options.kp=1.0] Proportional gain
   * @param {number} [options.ki=0.0] Integral gain
   * @param {number} [options.kd=0.0] Derivative gain
   * @param {number} [options.minOutput=-Infinity] Minimum output limit
   * @param {number} [options.maxOutput=Infinity] Maximum output limit
   * @param {number} [options.integralLimit=Infinity] Anti-windup clamping limit for integral accumulator
   */
  constructor(options = {}) {
    this.kp = options.kp ?? 1.0;
    this.ki = options.ki ?? 0.0;
    this.kd = options.kd ?? 0.0;

    this.minOutput = options.minOutput ?? -Infinity;
    this.maxOutput = options.maxOutput ?? Infinity;
    this.integralLimit = options.integralLimit ?? Infinity;

    this.integral = 0.0;
    this.prevError = 0.0;
    this.hasRun = false;

    // Telemetry terms for inspection
    this.lastPTerm = 0.0;
    this.lastITerm = 0.0;
    this.lastDTerm = 0.0;
    this.lastOutput = 0.0;
    this.lastError = 0.0;
  }

  /**
   * Updates PID controller with error and delta time.
   * @param {number} error Current error (setpoint - processVariable)
   * @param {number} dt Time step in seconds
   * @returns {number} Saturated control output
   */
  update(error, dt) {
    if (typeof dt !== 'number' || dt <= 0) {
      return this.lastOutput;
    }

    this.lastError = error;

    // 1. Proportional term
    this.lastPTerm = this.kp * error;

    // 2. Integral term with anti-windup clamping
    this.integral += error * dt;
    if (this.integralLimit < Infinity) {
      this.integral = Math.max(-this.integralLimit, Math.min(this.integralLimit, this.integral));
    }
    this.lastITerm = this.ki * this.integral;

    // 3. Derivative term
    let derivative = 0.0;
    if (this.hasRun) {
      derivative = (error - this.prevError) / dt;
    } else {
      this.hasRun = true;
    }
    this.lastDTerm = this.kd * derivative;
    this.prevError = error;

    // 4. Total output with saturation limits
    const rawOutput = this.lastPTerm + this.lastITerm + this.lastDTerm;
    this.lastOutput = Math.max(this.minOutput, Math.min(this.maxOutput, rawOutput));

    return this.lastOutput;
  }

  /**
   * Resets the controller's internal memory (integral accumulator and previous error).
   */
  reset() {
    this.integral = 0.0;
    this.prevError = 0.0;
    this.hasRun = false;
    this.lastPTerm = 0.0;
    this.lastITerm = 0.0;
    this.lastDTerm = 0.0;
    this.lastOutput = 0.0;
    this.lastError = 0.0;
  }

  /**
   * Configures PID gains dynamically.
   */
  setGains(kp, ki, kd) {
    this.kp = kp;
    this.ki = ki;
    this.kd = kd;
  }

  /**
   * Configures output saturation limits.
   */
  setOutputLimits(min, max) {
    this.minOutput = min;
    this.maxOutput = max;
  }

  /**
   * Configures integral anti-windup limit.
   */
  setIntegralLimit(limit) {
    this.integralLimit = limit;
  }

  /**
   * Returns current internal controller telemetry.
   */
  getTelemetry() {
    return {
      pTerm: this.lastPTerm,
      iTerm: this.lastITerm,
      dTerm: this.lastDTerm,
      output: this.lastOutput,
      error: this.lastError,
      integral: this.integral
    };
  }
}

/**
 * HeadingPIDController
 * Specialized PID controller for mobile robot orientation / heading control.
 * Handles circular angular wrapping to guarantee the robot always turns along the
 * shortest angular path.
 */
export class HeadingPIDController extends PIDController {
  constructor(options = {}) {
    super(options);
  }

  /**
   * Computes angular velocity command (rad/s) to track desired heading.
   * @param {number} desiredHeadingRad Desired heading angle in radians
   * @param {number} currentHeadingRad Current robot heading angle in radians
   * @param {number} dt Time step in seconds
   * @returns {number} Angular velocity command (rad/s)
   */
  computeAngularVelocity(desiredHeadingRad, currentHeadingRad, dt) {
    // Calculate shortest angular error on [-PI, PI]
    const rawDiff = desiredHeadingRad - currentHeadingRad;
    const angularError = RobotKinematics.normalizeAngle(rawDiff);

    return this.update(angularError, dt);
  }
}
