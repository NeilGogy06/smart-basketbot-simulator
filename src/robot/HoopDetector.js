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
      lastShotResult: 'NONE', // 'SCORED', 'MISSED', 'IN_FLIGHT', 'NONE'
      lastDetailedResult: 'NONE' // 'SCORED', 'MISSED_SHORT', 'MISSED_LONG', 'MISSED_LEFT', 'MISSED_RIGHT', 'MISSED'
    };

    // Tracking state for active shot
    this.activeShot = null;
    this.prevBallPos = null;
    this.lastShotDetails = null;
    this.shotHistory = [];

    // Callbacks
    this.onScoreCallbacks = [];
    this.onMissCallbacks = [];
    this.onShotFiredCallbacks = [];
  }

  /**
   * Begins tracking a newly launched basketball shot.
   * @param {number|Object} [shotInfo] Shot ID or metadata object
   */
  notifyShotFired(shotInfo = Date.now()) {
    this.stats.totalAttempts++;
    this.stats.lastShotResult = 'IN_FLIGHT';
    this.stats.lastDetailedResult = 'IN_FLIGHT';

    const metadata = typeof shotInfo === 'object' ? shotInfo : { id: shotInfo };

    this.activeShot = {
      id: metadata.id ?? Date.now(),
      distance: metadata.distance ?? 0,
      launchSpeed: metadata.launchSpeed ?? 0,
      launchAngleDeg: metadata.launchAngleDeg ?? 0,
      headingErrorDeg: metadata.headingErrorDeg ?? 0,
      predictedApex: metadata.predictedApex ?? 0,
      predictedFlightTime: metadata.predictedFlightTime ?? 0,
      state: 'IN_FLIGHT', // 'IN_FLIGHT', 'ENTERED_RIM', 'RESOLVED'
      passedAboveRim: false,
      enteredRimPlane: false,
      entryTime: 0,
      flightDuration: 0,
      minDistToRim: 999.0,
      closestPoint: null,
      rimLevelPoint: null
    };
    this.prevBallPos = null;
    this.updateAccuracy();

    if (this.onShotFiredCallbacks) {
      this.onShotFiredCallbacks.forEach(cb => cb(this.stats, metadata));
    }
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
    const dy = ballPos.y - this.rimY;
    const dz = ballPos.z - this.rimZ;
    const horizDist = Math.hypot(dx, dz);
    const distToRimCenter = Math.hypot(dx, dy, dz);

    // Track closest point of approach to rim center
    if (distToRimCenter < this.activeShot.minDistToRim) {
      this.activeShot.minDistToRim = distToRimCenter;
      this.activeShot.closestPoint = { ...ballPos };
    }

    const prevY = this.prevBallPos ? this.prevBallPos.y : ballPos.y;

    // Record point where trajectory crosses rim height plane (Y = 3.05m)
    if ((prevY >= this.rimY && ballPos.y <= this.rimY) || (prevY <= this.rimY && ballPos.y >= this.rimY)) {
      this.activeShot.rimLevelPoint = { ...ballPos };
    }

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
    // If the ball hit the floor (Y <= 0.2m) or has been flying for too long (> 6s)
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
   * Resolves the active shot as scored or missed, classifies miss direction,
   * updates stats, and logs to recent shot history.
   * @param {boolean} scored
   * @returns {'SCORED'|'MISSED'}
   */
  resolveShot(scored) {
    if (!this.activeShot || this.activeShot.state === 'RESOLVED') return 'IDLE';

    this.activeShot.state = 'RESOLVED';

    // Point for trajectory error evaluation
    const evalPt = this.activeShot.rimLevelPoint || this.activeShot.closestPoint || (this.prevBallPos ?? { x: this.rimX, y: this.rimY, z: this.rimZ });
    const deltaX = evalPt.x - this.rimX;
    const deltaZ = evalPt.z - this.rimZ;

    let detailedOutcome;

    if (scored) {
      detailedOutcome = 'SCORED';
      this.stats.successfulBaskets++;
      this.stats.lastShotResult = 'SCORED';
      this.stats.lastDetailedResult = 'SCORED';
    } else {
      // Classify miss direction based on displacement from target rim center
      // For East rim (+X direction):
      // - Under-distance (deltaX < -0.15m): MISSED_SHORT
      // - Over-distance (deltaX > +0.18m): MISSED_LONG
      // - Lateral drift: MISSED_LEFT (deltaZ > +0.14m), MISSED_RIGHT (deltaZ < -0.14m)
      if (deltaX < -0.15) {
        detailedOutcome = 'MISSED_SHORT';
      } else if (deltaX > 0.18) {
        detailedOutcome = 'MISSED_LONG';
      } else if (deltaZ > 0.14) {
        detailedOutcome = 'MISSED_LEFT';
      } else if (deltaZ < -0.14) {
        detailedOutcome = 'MISSED_RIGHT';
      } else {
        detailedOutcome = 'MISSED';
      }

      this.stats.missedShots++;
      this.stats.lastShotResult = 'MISSED';
      this.stats.lastDetailedResult = detailedOutcome;
    }

    this.updateAccuracy();

    // Construct detailed shot history record
    const shotRecord = {
      shotNumber: this.stats.totalAttempts,
      timestamp: Date.now(),
      outcome: detailedOutcome,
      isScored: scored,
      distance: this.activeShot.distance,
      launchSpeed: this.activeShot.launchSpeed,
      launchAngleDeg: this.activeShot.launchAngleDeg,
      headingErrorDeg: this.activeShot.headingErrorDeg,
      predictedApex: this.activeShot.predictedApex,
      predictedFlightTime: this.activeShot.predictedFlightTime,
      closestDistance: this.activeShot.minDistToRim,
      impactDisplacement: { x: deltaX, z: deltaZ },
      flightDuration: this.activeShot.flightDuration
    };

    this.lastShotDetails = shotRecord;
    this.shotHistory.unshift(shotRecord);
    if (this.shotHistory.length > 20) {
      this.shotHistory.pop();
    }

    if (scored) {
      this.onScoreCallbacks.forEach(cb => cb(this.stats, shotRecord));
      return 'SCORED';
    } else {
      this.onMissCallbacks.forEach(cb => cb(this.stats, shotRecord));
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
    this.lastShotDetails = null;
    this.shotHistory = [];
    this.stats = {
      totalAttempts: 0,
      successfulBaskets: 0,
      missedShots: 0,
      accuracyPercent: 0.0,
      lastShotResult: 'NONE',
      lastDetailedResult: 'NONE'
    };
  }

  get totalAttempts() { return this.stats.totalAttempts; }
  get successfulBaskets() { return this.stats.successfulBaskets; }
  get missedShots() { return this.stats.missedShots; }
  get accuracyPercent() { return this.stats.accuracyPercent; }
  get lastShotResult() { return this.stats.lastShotResult; }
  set lastShotResult(val) { this.stats.lastShotResult = val; }
  get lastDetailedResult() { return this.stats.lastDetailedResult; }
  set lastDetailedResult(val) { this.stats.lastDetailedResult = val; }

  /**
   * Registers a listener callback for newly fired shots.
   */
  onShotFired(callback) {
    if (typeof callback === 'function') {
      this.onShotFiredCallbacks.push(callback);
    }
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
      shotState: this.activeShot ? this.activeShot.state : 'IDLE',
      lastShotDetails: this.lastShotDetails,
      recentHistory: this.shotHistory.slice(0, 5)
    };
  }
}
