/**
 * HoopDetector.js
 * Physics-based basketball hoop scoring detection and shot performance statistics tracker.
 * Analyzes real Rapier 3D basketball trajectory relative to the regulation rim geometry,
 * distinguishing scored baskets (clean or off-rim downward penetration) from missed shots.
 */

import { SIMULATION_CONFIG } from '../simulation/SimulationConfig.js';

export class HoopDetector {
  /**
   * @param {Object} [options]
   * @param {number} [options.rimX] X coordinate of target hoop rim center (meters)
   * @param {number} [options.rimY=3.05] Height of rim (meters)
   * @param {number} [options.rimZ=0.0] Z coordinate of target hoop rim center (meters)
   * @param {number} [options.rimRadius=0.225] Inner radius of regulation rim (meters)
   */
  constructor(options = {}) {
    const courtLen = SIMULATION_CONFIG.court.length;
    const overhang = SIMULATION_CONFIG.court.basketCenterOverhang;

    this.rimX = options.rimX ?? (courtLen / 2 - overhang); // Default East rim: 14.0 - 1.575 = 12.425
    this.rimY = options.rimY ?? SIMULATION_CONFIG.hoop.rimHeight; // 3.05m
    this.rimZ = options.rimZ ?? 0.0;
    this.rimRadius = options.rimRadius ?? SIMULATION_CONFIG.hoop.rimRadius; // 0.225m

    // Shot Statistics
    this.stats = {
      totalAttempts: 0,
      successfulBaskets: 0,
      missedShots: 0,
      accuracyPercent: 0.0,
      lastShotResult: 'NONE' // 'SCORED', 'MISSED', 'IN_FLIGHT', 'NONE'
    };

    // Tracking state for active shot
    this.activeShot = null;
    this.prevBallPos = null;

    // Callbacks
    this.onScoreCallbacks = [];
    this.onMissCallbacks = [];
  }

  /**
   * Begins tracking a newly launched basketball shot.
   * @param {number} shotId Unique id or timestamp of the shot
   */
  notifyShotFired(shotId = Date.now()) {
    this.stats.totalAttempts++;
    this.stats.lastShotResult = 'IN_FLIGHT';
    this.activeShot = {
      id: shotId,
      state: 'IN_FLIGHT', // 'IN_FLIGHT', 'ENTERED_RIM', 'RESOLVED'
      passedAboveRim: false,
      enteredRimPlane: false,
      entryTime: 0,
      flightDuration: 0
    };
    this.prevBallPos = null;
    this.updateAccuracy();
  }

  /**
   * Evaluates the ball's position and velocity every frame.
   * @param {{ x: number, y: number, z: number }} ballPos
   * @param {{ x: number, y: number, z: number }} ballVel
   * @param {number} dt Frame time step in seconds
   * @returns {'SCORED'|'MISSED'|'IN_FLIGHT'|'IDLE'}
   */
  update(ballPos, ballVel, dt) {
    if (!this.activeShot || this.activeShot.state === 'RESOLVED') {
      this.prevBallPos = { ...ballPos };
      return 'IDLE';
    }

    this.activeShot.flightDuration += dt;

    const dx = ballPos.x - this.rimX;
    const dz = ballPos.z - this.rimZ;
    const horizDist = Math.hypot(dx, dz);

    const prevY = this.prevBallPos ? this.prevBallPos.y : ballPos.y;

    // 1. Did the ball fly above the rim?
    if (ballPos.y > (this.rimY + 0.15)) {
      this.activeShot.passedAboveRim = true;
    }

    // 2. Check downward rim penetration
    // The ball must cross downward through Y = rimY plane while within inner rim cylinder
    const crossedRimPlaneDownward = (prevY >= this.rimY && ballPos.y < this.rimY && ballVel.y < 0);
    // Tolerance for inner rim cylinder penetration (radius ~ 0.225m)
    const isInsideRimCylinder = horizDist < (this.rimRadius + 0.02);

    if (crossedRimPlaneDownward && isInsideRimCylinder && this.activeShot.passedAboveRim) {
      this.activeShot.enteredRimPlane = true;
      this.activeShot.state = 'ENTERED_RIM';
      this.activeShot.entryTime = this.activeShot.flightDuration;
    }

    // 3. Confirm score when ball exits net downward after entering rim
    if (this.activeShot.enteredRimPlane && ballPos.y < (this.rimY - 0.25) && ballPos.y > 1.0) {
      return this.resolveShot(true);
    }

    // 4. Check for missed shot:
    // If the ball hit the floor (Y <= 0.2m) or has been flying for too long (> 5s)
    // without scoring
    const hitFloor = ballPos.y <= (SIMULATION_CONFIG.ball.radius + 0.05);
    const timeout = this.activeShot.flightDuration > 6.0;

    if ((hitFloor || timeout) && !this.activeShot.enteredRimPlane) {
      return this.resolveShot(false);
    }

    this.prevBallPos = { ...ballPos };
    return 'IN_FLIGHT';
  }

  /**
   * Resolves the active shot as scored or missed.
   */
  resolveShot(scored) {
    if (!this.activeShot || this.activeShot.state === 'RESOLVED') return 'IDLE';

    this.activeShot.state = 'RESOLVED';

    if (scored) {
      this.stats.successfulBaskets++;
      this.stats.lastShotResult = 'SCORED';
      this.updateAccuracy();
      this.onScoreCallbacks.forEach(cb => cb(this.stats));
      return 'SCORED';
    } else {
      this.stats.missedShots++;
      this.stats.lastShotResult = 'MISSED';
      this.updateAccuracy();
      this.onMissCallbacks.forEach(cb => cb(this.stats));
      return 'MISSED';
    }
  }

  /**
   * Recalculates shooting accuracy percentage.
   */
  updateAccuracy() {
    if (this.stats.totalAttempts === 0) {
      this.stats.accuracyPercent = 0.0;
    } else {
      this.stats.accuracyPercent = (this.stats.successfulBaskets / this.stats.totalAttempts) * 100;
    }
  }

  /**
   * Resets all tracking state and statistics.
   */
  reset() {
    this.activeShot = null;
    this.prevBallPos = null;
    this.stats = {
      totalAttempts: 0,
      successfulBaskets: 0,
      missedShots: 0,
      accuracyPercent: 0.0,
      lastShotResult: 'NONE'
    };
  }

  /**
   * Registers a listener callback for successful baskets.
   */
  onScore(callback) {
    this.onScoreCallbacks.push(callback);
  }

  /**
   * Registers a listener callback for missed shots.
   */
  onMiss(callback) {
    this.onMissCallbacks.push(callback);
  }

  /**
   * Returns current shot telemetry and statistics.
   */
  getTelemetry() {
    return {
      ...this.stats,
      isTrackingShot: (this.activeShot !== null && this.activeShot.state !== 'RESOLVED'),
      shotState: this.activeShot ? this.activeShot.state : 'IDLE'
    };
  }
}
