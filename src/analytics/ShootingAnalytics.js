/**
 * ShootingAnalytics.js
 * Tracks, deduplicates, evaluates, and stores ballistic shooting metrics
 * for both manual and autonomous gameplay.
 */

import { ANALYTICS_CONFIG, SHOT_OUTCOMES } from './AnalyticsConfig.js';

export class ShootingAnalytics {
  /**
   * @param {Object} [config]
   */
  constructor(config = {}) {
    this.config = { ...ANALYTICS_CONFIG, ...config };

    this.reset();
  }

  /**
   * Resets all shooting statistics and history cleanly.
   */
  reset() {
    this.totalAttempts = 0;
    this.successfulBaskets = 0;
    this.missedShots = 0;
    this.accuracyPercent = 0.0;

    // Running sums for accurate averages
    this.totalLaunchSpeed = 0.0;
    this.launchSpeedCount = 0;

    this.totalLaunchAngle = 0.0;
    this.launchAngleCount = 0;

    this.totalFlightTime = 0.0;
    this.flightTimeCount = 0;

    this.totalTimeBetweenShots = 0.0;
    this.timeBetweenShotsCount = 0;
    this.lastShotTimestamp = null;

    // Outcome classification tallies
    this.outcomeDistribution = {
      [SHOT_OUTCOMES.SCORED]: 0,
      [SHOT_OUTCOMES.MISSED_SHORT]: 0,
      [SHOT_OUTCOMES.MISSED_LONG]: 0,
      [SHOT_OUTCOMES.MISSED_LEFT]: 0,
      [SHOT_OUTCOMES.MISSED_RIGHT]: 0,
      [SHOT_OUTCOMES.MISSED]: 0
    };

    // Full history of recorded shots
    this.shotHistory = [];

    // Active uncompleted shot currently in flight
    this.activeShot = null;
  }

  /**
   * Records a newly launched basketball shot attempt with strict deduplication.
   * Multiple callers reporting the same physical shot (e.g. ShootingMechanism and ClosedLoopShootingController)
   * will update the metadata of the active shot rather than incrementing attempt counts.
   *
   * @param {Object} [metadata]
   * @param {string|number} [metadata.id] Unique shot identifier
   * @param {number} [metadata.timestamp] Milliseconds timestamp
   * @param {number} [metadata.launchSpeed] M/s
   * @param {number} [metadata.launchAngle] Degrees
   * @param {number} [metadata.launchAngleDeg] Degrees (alternative key)
   * @param {number} [metadata.flywheelRPM] Dual flywheel speed
   * @param {string} [metadata.mode] 'MANUAL' or 'AUTONOMOUS'
   * @param {Object} [metadata.predictedTrajectory] Ballistic trajectory prediction
   * @returns {Object} The recorded or updated active shot record
   */
  recordShotAttempt(metadata = {}) {
    const now = metadata.timestamp || Date.now();
    const shotId = metadata.id || now;

    // Deduplication Check:
    // If there is an active shot in flight:
    // 1. Same shot ID
    // 2. OR within deduplication window (< 0.4s)
    if (this.activeShot && !this.activeShot.isResolved) {
      const timeDiff = (now - this.activeShot.timestamp) / 1000.0;
      const isSameId = (this.activeShot.id === shotId);
      const isWithinWindow = Math.abs(timeDiff) <= this.config.sampling.shotDeduplicationWindow;

      if (isSameId || isWithinWindow) {
        // Merge metadata into existing active shot rather than counting as a new attempt
        this._enrichActiveShot(metadata);
        return this.activeShot;
      }
    }

    // New physical shot attempt
    this.totalAttempts++;

    // Track time interval between consecutive shots
    if (this.lastShotTimestamp != null) {
      const interval = Math.max(0, (now - this.lastShotTimestamp) / 1000.0);
      // Only include reasonable intervals (< 120s) in the average
      if (interval < 120.0) {
        this.totalTimeBetweenShots += interval;
        this.timeBetweenShotsCount++;
      }
    }
    this.lastShotTimestamp = now;

    const angle = metadata.launchAngle ?? metadata.launchAngleDeg ?? null;
    const speed = metadata.launchSpeed ?? null;

    if (speed != null && !isNaN(speed) && speed > 0) {
      this.totalLaunchSpeed += speed;
      this.launchSpeedCount++;
    }

    if (angle != null && !isNaN(angle) && angle > 0) {
      this.totalLaunchAngle += angle;
      this.launchAngleCount++;
    }

    const newShot = {
      id: shotId,
      shotNumber: this.totalAttempts,
      timestamp: now,
      mode: metadata.mode || 'MANUAL',
      launchSpeed: speed,
      launchAngle: angle,
      flywheelRPM: metadata.flywheelRPM ?? null,
      flightDuration: null,
      outcome: SHOT_OUTCOMES.IN_FLIGHT,
      isScored: false,
      missClassification: null,
      predictedTrajectory: metadata.predictedTrajectory || (
        (metadata.predictedApex || metadata.predictedFlightTime) ? {
          apex: metadata.predictedApex ?? null,
          flightTime: metadata.predictedFlightTime ?? null,
          speed: speed,
          angle: angle
        } : null
      ),
      actualTrajectory: null,
      isResolved: false
    };

    this.activeShot = newShot;
    this.shotHistory.unshift(newShot);

    if (this.shotHistory.length > this.config.limits.maxShotHistory) {
      this.shotHistory.pop();
    }

    this._updateAccuracy();
    return newShot;
  }

  /**
   * Merges additional metadata into the active shot without duplicate counting.
   * @private
   */
  _enrichActiveShot(metadata) {
    if (!this.activeShot) return;

    if (metadata.mode && this.activeShot.mode === 'MANUAL') {
      this.activeShot.mode = metadata.mode;
    }

    const speed = metadata.launchSpeed;
    if (speed != null && !isNaN(speed) && speed > 0 && this.activeShot.launchSpeed == null) {
      this.activeShot.launchSpeed = speed;
      this.totalLaunchSpeed += speed;
      this.launchSpeedCount++;
    }

    const angle = metadata.launchAngle ?? metadata.launchAngleDeg;
    if (angle != null && !isNaN(angle) && angle > 0 && this.activeShot.launchAngle == null) {
      this.activeShot.launchAngle = angle;
      this.totalLaunchAngle += angle;
      this.launchAngleCount++;
    }

    if (metadata.flywheelRPM != null && this.activeShot.flywheelRPM == null) {
      this.activeShot.flywheelRPM = metadata.flywheelRPM;
    }

    if (metadata.predictedTrajectory && !this.activeShot.predictedTrajectory) {
      this.activeShot.predictedTrajectory = metadata.predictedTrajectory;
    } else if ((metadata.predictedApex || metadata.predictedFlightTime) && !this.activeShot.predictedTrajectory) {
      this.activeShot.predictedTrajectory = {
        apex: metadata.predictedApex ?? null,
        flightTime: metadata.predictedFlightTime ?? null,
        speed: this.activeShot.launchSpeed,
        angle: this.activeShot.launchAngle
      };
    }
  }

  /**
   * Records the final resolution of a shot (scored or missed) with classification.
   *
   * @param {Object} outcomeData
   * @param {boolean} outcomeData.isScored True if basket scored
   * @param {string} [outcomeData.outcome] 'SCORED', 'MISSED_SHORT', 'MISSED_LONG', 'MISSED_LEFT', 'MISSED_RIGHT', 'MISSED'
   * @param {number} [outcomeData.flightDuration] In seconds
   * @param {Object} [outcomeData.actualTrajectory] Closest point, displacement, etc.
   * @param {string|number} [outcomeData.id] Shot ID to match
   * @returns {Object} The resolved shot record
   */
  recordShotOutcome(outcomeData = {}) {
    // Determine which shot is being resolved
    let targetShot = null;

    if (this.activeShot && !this.activeShot.isResolved) {
      targetShot = this.activeShot;
    } else if (outcomeData.id != null) {
      targetShot = this.shotHistory.find(s => s.id === outcomeData.id);
    } else if (this.shotHistory.length > 0 && !this.shotHistory[0].isResolved) {
      targetShot = this.shotHistory[0];
    }

    // If no shot record exists yet (e.g. outcome arrived before attempt event in decoupled harness),
    // create the attempt record now to ensure data completeness
    if (!targetShot) {
      targetShot = this.recordShotAttempt({
        id: outcomeData.id || Date.now(),
        launchSpeed: outcomeData.launchSpeed,
        launchAngle: outcomeData.launchAngleDeg || outcomeData.launchAngle,
        mode: outcomeData.mode || 'MANUAL'
      });
    }

    // Guard against resolving the same shot twice
    if (targetShot.isResolved) {
      return targetShot;
    }

    const scored = Boolean(outcomeData.isScored ?? (outcomeData.outcome === SHOT_OUTCOMES.SCORED));
    let outcome = outcomeData.outcome;

    if (!outcome) {
      outcome = scored ? SHOT_OUTCOMES.SCORED : SHOT_OUTCOMES.MISSED;
    }

    targetShot.isResolved = true;
    targetShot.isScored = scored;
    targetShot.outcome = outcome;
    targetShot.missClassification = scored ? null : outcome;

    if (outcomeData.flightDuration != null && !isNaN(outcomeData.flightDuration)) {
      targetShot.flightDuration = outcomeData.flightDuration;
      this.totalFlightTime += outcomeData.flightDuration;
      this.flightTimeCount++;
    }

    if (outcomeData.actualTrajectory) {
      targetShot.actualTrajectory = outcomeData.actualTrajectory;
    } else if (outcomeData.closestDistance != null || outcomeData.impactDisplacement != null) {
      targetShot.actualTrajectory = {
        minDistToRim: outcomeData.closestDistance ?? null,
        impactDisplacement: outcomeData.impactDisplacement ?? null
      };
    }

    // Update tallies
    if (scored) {
      this.successfulBaskets++;
      this.outcomeDistribution[SHOT_OUTCOMES.SCORED] = (this.outcomeDistribution[SHOT_OUTCOMES.SCORED] || 0) + 1;
    } else {
      this.missedShots++;
      const cat = this.outcomeDistribution[outcome] !== undefined ? outcome : SHOT_OUTCOMES.MISSED;
      this.outcomeDistribution[cat] = (this.outcomeDistribution[cat] || 0) + 1;
    }

    this._updateAccuracy();

    if (this.activeShot === targetShot) {
      this.activeShot = null;
    }

    return targetShot;
  }

  /**
   * Recalculates shooting accuracy percentage.
   * Formula: Accuracy = (Successful Shots / Total Attempts) * 100
   * @private
   */
  _updateAccuracy() {
    if (this.totalAttempts <= 0) {
      this.accuracyPercent = 0.0;
    } else {
      this.accuracyPercent = (this.successfulBaskets / this.totalAttempts) * 100.0;
    }
  }

  /**
   * Returns calculated averages.
   */
  getAverageLaunchSpeed() {
    return this.launchSpeedCount > 0 ? (this.totalLaunchSpeed / this.launchSpeedCount) : 0.0;
  }

  getAverageLaunchAngle() {
    return this.launchAngleCount > 0 ? (this.totalLaunchAngle / this.launchAngleCount) : 0.0;
  }

  getAverageFlightTime() {
    return this.flightTimeCount > 0 ? (this.totalFlightTime / this.flightTimeCount) : 0.0;
  }

  getAverageTimeBetweenShots() {
    return this.timeBetweenShotsCount > 0 ? (this.totalTimeBetweenShots / this.timeBetweenShotsCount) : 0.0;
  }

  /**
   * Returns complete telemetry packet for dashboard and exports.
   */
  getTelemetry() {
    return {
      totalAttempts: this.totalAttempts,
      successfulBaskets: this.successfulBaskets,
      missedShots: this.missedShots,
      accuracyPercent: this.accuracyPercent,
      averageLaunchSpeed: this.getAverageLaunchSpeed(),
      averageLaunchAngle: this.getAverageLaunchAngle(),
      averageFlightTime: this.getAverageFlightTime(),
      averageTimeBetweenShots: this.getAverageTimeBetweenShots(),
      outcomeDistribution: { ...this.outcomeDistribution },
      lastShot: this.shotHistory[0] || null,
      activeShot: this.activeShot ? { ...this.activeShot } : null,
      historyCount: this.shotHistory.length
    };
  }
}
