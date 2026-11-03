/**
 * MotionAnalytics.js
 * Monitors differential-drive kinematics, PID heading control tracking,
 * wheel RPM, velocity errors, and maintains bounded time-series ring buffers.
 */

import { ANALYTICS_CONFIG } from './AnalyticsConfig.js';

export class MotionAnalytics {
  /**
   * @param {Object} [config]
   */
  constructor(config = {}) {
    this.config = { ...ANALYTICS_CONFIG, ...config };

    this.reset();
  }

  /**
   * Resets all tracking metrics, peak errors, and time-series buffers cleanly.
   */
  reset() {
    // Current instantaneous values
    this.current = {
      targetLinearVelocity: 0.0,
      actualLinearVelocity: 0.0,
      targetAngularVelocity: 0.0,
      actualAngularVelocity: 0.0,
      rpmLeft: 0.0,
      rpmRight: 0.0,
      linearError: 0.0,
      angularError: 0.0,
      headingErrorDeg: 0.0,
      pidPTerm: 0.0,
      pidITerm: 0.0,
      pidDTerm: 0.0,
      pidOutput: 0.0
    };

    // Cumulative error statistics
    this.cumulativeLinearError = 0.0;
    this.linearErrorSamples = 0;
    this.maxLinearError = 0.0;

    this.cumulativeAngularError = 0.0;
    this.angularErrorSamples = 0;
    this.maxAngularError = 0.0;

    // Motion step response time measurement
    this.stepResponse = {
      isMeasuring: false,
      startTime: 0,
      targetSpeed: 0,
      thresholdSpeed: 0,
      measuredRiseTime: null,
      lastRiseTime: null
    };

    // Bounded time-series ring buffers for real-time Chart.js graphs
    const maxPts = this.config.limits.maxTimeSeriesPoints;
    this.timeSeries = {
      timestamps: [],
      targetLinearVelocities: [],
      actualLinearVelocities: [],
      targetAngularVelocities: [],
      actualAngularVelocities: [],
      linearErrors: [],
      angularErrors: [],
      rpmLefts: [],
      rpmRights: [],
      pidErrors: [],
      pidOutputs: [],
      pidPTerms: [],
      pidITerms: [],
      pidDTerms: []
    };

    this.sampleTimer = 0.0;
    this.simTime = 0.0;
  }

  /**
   * Updates motion metrics and records time-series samples.
   *
   * @param {number} dt Time step in seconds
   * @param {Object} driveTel Telemetry from DifferentialDriveController
   * @param {Object} [robotVel] Measured physical velocity from Rapier rigid body { x, y, z, speed, angularVelocity }
   * @param {Object} [pidTel] Telemetry from HeadingPIDController
   */
  update(dt, driveTel = {}, robotVel = {}, pidTel = {}) {
    this.simTime += dt;
    this.sampleTimer += dt;

    // 1. Instantaneous target vs actual values
    const targetV = driveTel.targetLinearVelocity ?? 0.0;
    const actualV = robotVel.speed ?? driveTel.linearVelocity ?? 0.0;

    const targetW = driveTel.targetAngularVelocity ?? 0.0;
    const actualW = robotVel.angularVelocity ?? driveTel.angularVelocity ?? 0.0;

    const rpmL = driveTel.rpmLeft ?? 0.0;
    const rpmR = driveTel.rpmRight ?? 0.0;

    const headingErr = driveTel.headingErrorDeg ?? 0.0;

    // Tracking errors: absolute differences
    const linErr = Math.abs(targetV - actualV);
    const angErr = Math.abs(targetW - actualW);

    this.current = {
      targetLinearVelocity: targetV,
      actualLinearVelocity: actualV,
      targetAngularVelocity: targetW,
      actualAngularVelocity: actualW,
      rpmLeft: rpmL,
      rpmRight: rpmR,
      linearError: linErr,
      angularError: angErr,
      headingErrorDeg: headingErr,
      pidPTerm: pidTel.pTerm ?? 0.0,
      pidITerm: pidTel.iTerm ?? 0.0,
      pidDTerm: pidTel.dTerm ?? 0.0,
      pidOutput: pidTel.output ?? driveTel.pidOutput ?? 0.0
    };

    // 2. Track cumulative and maximum errors when actively commanding motion
    if (Math.abs(targetV) > this.config.motion.minVelocityForTracking) {
      this.cumulativeLinearError += linErr;
      this.linearErrorSamples++;
      if (linErr > this.maxLinearError) {
        this.maxLinearError = linErr;
      }
    }

    if (Math.abs(targetW) > this.config.motion.minVelocityForTracking) {
      this.cumulativeAngularError += angErr;
      this.angularErrorSamples++;
      if (angErr > this.maxAngularError) {
        this.maxAngularError = angErr;
      }
    }

    // 3. Step response rise time detection
    // Detect sudden step command from stationary (|targetV| > 0.5 when prev was 0)
    if (!this.stepResponse.isMeasuring && Math.abs(targetV) >= 0.5 && actualV < 0.1) {
      this.stepResponse.isMeasuring = true;
      this.stepResponse.startTime = this.simTime;
      this.stepResponse.targetSpeed = Math.abs(targetV);
      this.stepResponse.thresholdSpeed = Math.abs(targetV) * this.config.motion.stepResponseThreshold;
    } else if (this.stepResponse.isMeasuring) {
      if (Math.abs(actualV) >= this.stepResponse.thresholdSpeed) {
        // 90% rise time reached!
        const riseTime = this.simTime - this.stepResponse.startTime;
        this.stepResponse.measuredRiseTime = riseTime;
        this.stepResponse.lastRiseTime = riseTime;
        this.stepResponse.isMeasuring = false;
      } else if (Math.abs(targetV) < 0.1 || (this.simTime - this.stepResponse.startTime) > 5.0) {
        // Aborted or timed out
        this.stepResponse.isMeasuring = false;
      }
    }

    // 4. Sample into ring buffer at specified interval (e.g. 10 Hz)
    if (this.sampleTimer >= this.config.sampling.timeSeriesSampleInterval) {
      this.sampleTimer = 0.0;
      this._pushTimeSeriesPoint();
    }
  }

  /**
   * Pushes a time-series entry to the bounded ring buffers.
   * @private
   */
  _pushTimeSeriesPoint() {
    const max = this.config.limits.maxTimeSeriesPoints;
    const ts = this.simTime.toFixed(1);

    const push = (arr, val) => {
      arr.push(val);
      if (arr.length > max) {
        arr.shift();
      }
    };

    push(this.timeSeries.timestamps, ts);
    push(this.timeSeries.targetLinearVelocities, Number(this.current.targetLinearVelocity.toFixed(2)));
    push(this.timeSeries.actualLinearVelocities, Number(this.current.actualLinearVelocity.toFixed(2)));
    push(this.timeSeries.targetAngularVelocities, Number(this.current.targetAngularVelocity.toFixed(2)));
    push(this.timeSeries.actualAngularVelocities, Number(this.current.actualAngularVelocity.toFixed(2)));
    push(this.timeSeries.linearErrors, Number(this.current.linearError.toFixed(2)));
    push(this.timeSeries.angularErrors, Number(this.current.angularError.toFixed(2)));
    push(this.timeSeries.rpmLefts, Math.round(this.current.rpmLeft));
    push(this.timeSeries.rpmRights, Math.round(this.current.rpmRight));
    push(this.timeSeries.pidErrors, Number((this.current.headingErrorDeg).toFixed(1)));
    push(this.timeSeries.pidOutputs, Number(this.current.pidOutput.toFixed(2)));
    push(this.timeSeries.pidPTerms, Number(this.current.pidPTerm.toFixed(2)));
    push(this.timeSeries.pidITerms, Number(this.current.pidITerm.toFixed(2)));
    push(this.timeSeries.pidDTerms, Number(this.current.pidDTerm.toFixed(2)));
  }

  /**
   * Average absolute linear tracking error (m/s).
   */
  getAverageLinearError() {
    return this.linearErrorSamples > 0 ? (this.cumulativeLinearError / this.linearErrorSamples) : 0.0;
  }

  /**
   * Average absolute angular tracking error (rad/s).
   */
  getAverageAngularError() {
    return this.angularErrorSamples > 0 ? (this.cumulativeAngularError / this.angularErrorSamples) : 0.0;
  }

  /**
   * Returns complete telemetry packet.
   */
  getTelemetry() {
    return {
      current: { ...this.current },
      averageLinearError: this.getAverageLinearError(),
      averageAngularError: this.getAverageAngularError(),
      maxLinearError: this.maxLinearError,
      maxAngularError: this.maxAngularError,
      motionResponseTime: this.stepResponse.lastRiseTime,
      isStepMeasuring: this.stepResponse.isMeasuring,
      timeSeries: this.timeSeries
    };
  }
}
