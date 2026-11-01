/**
 * TrajectoryCalculator.js
 * Analytical projectile motion kinematics and trajectory optimization for basketball shooting.
 * Calculates required launch velocities, flight times, apex heights, entry angles, and launch vectors.
 * Evaluates candidate launch parameters to select trajectories that maximize apparent rim opening
 * and guarantee downward rim entry under Rapier 3D physics.
 */

import { SIMULATION_CONFIG } from '../simulation/SimulationConfig.js';

export class TrajectoryCalculator {
  /**
   * @param {Object} [options]
   * @param {number} [options.gravity=9.81] Gravitational acceleration magnitude (m/s²)
   * @param {number} [options.defaultAngleDeg=52.0] Default launch elevation angle in degrees
   * @param {number} [options.rimRadius=0.225] Regulation rim radius in meters (0.45m diameter)
   * @param {number} [options.ballRadius=0.12] Regulation basketball radius in meters (0.24m diameter)
   */
  constructor(options = {}) {
    this.gravity = options.gravity ?? 9.81;
    this.defaultAngleDeg = options.defaultAngleDeg ?? 52.0;
    this.rimRadius = options.rimRadius ?? SIMULATION_CONFIG.hoop.rimRadius;
    this.ballRadius = options.ballRadius ?? SIMULATION_CONFIG.ball.radius;
    this.rimDiameter = this.rimRadius * 2; // 0.45m
    this.ballDiameter = this.ballRadius * 2; // 0.24m
  }

  /**
   * Calculates ballistic launch velocity vector to reach target from launch position.
   *
   * Projectile motion equations:
   *   d = sqrt(dx^2 + dz^2)
   *   h = targetY - launchY
   *   v0 = sqrt( (g * d^2) / (2 * cos^2(theta) * (d * tan(theta) - h)) )
   *
   * @param {{ x: number, y: number, z: number }} launchPos Initial ball position at launcher exit
   * @param {{ x: number, y: number, z: number }} targetPos Hoop center target position
   * @param {number} [launchAngleDeg] Launch elevation angle in degrees (default 52°)
   * @returns {{
   *   valid: boolean,
   *   speed: number,
   *   launchVelocity: { x: number, y: number, z: number },
   *   flightTime: number,
   *   apexHeight: number,
   *   horizontalDistance: number,
   *   requiredHeadingRad: number,
   *   entryVelocity: { x: number, y: number, z: number },
   *   entryAngleDeg: number,
   *   isDescending: boolean,
   *   effectiveRimDiameter: number,
   *   rimClearanceMargin: number,
   *   isPhysicallySuitable: boolean,
   *   launchAngleDeg: number,
   *   message?: string
   * }}
   */
  calculateSolution(launchPos, targetPos, launchAngleDeg = this.defaultAngleDeg) {
    const dx = targetPos.x - launchPos.x;
    const dz = targetPos.z - launchPos.z;
    const dy = targetPos.y - launchPos.y;

    const d = Math.hypot(dx, dz);

    if (d < 0.2) {
      return {
        valid: false,
        speed: 0,
        launchVelocity: { x: 0, y: 0, z: 0 },
        flightTime: 0,
        apexHeight: launchPos.y,
        horizontalDistance: d,
        requiredHeadingRad: 0,
        entryVelocity: { x: 0, y: 0, z: 0 },
        entryAngleDeg: 0,
        isDescending: false,
        effectiveRimDiameter: 0,
        rimClearanceMargin: -this.ballDiameter,
        isPhysicallySuitable: false,
        launchAngleDeg,
        message: 'Robot is too close to hoop for projectile launch'
      };
    }

    const theta = (launchAngleDeg * Math.PI) / 180;
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    const tanTheta = Math.tan(theta);

    // Denominator check: d * tan(theta) - dy must be positive
    const denom = 2 * cosTheta * cosTheta * (d * tanTheta - dy);

    if (denom <= 0) {
      return {
        valid: false,
        speed: 0,
        launchVelocity: { x: 0, y: 0, z: 0 },
        flightTime: 0,
        apexHeight: launchPos.y,
        horizontalDistance: d,
        requiredHeadingRad: Math.atan2(-dz, dx),
        entryVelocity: { x: 0, y: 0, z: 0 },
        entryAngleDeg: 0,
        isDescending: false,
        effectiveRimDiameter: 0,
        rimClearanceMargin: -this.ballDiameter,
        isPhysicallySuitable: false,
        launchAngleDeg,
        message: `Elevation angle ${launchAngleDeg.toFixed(1)}° is too shallow for target height`
      };
    }

    const v0Sq = (this.gravity * d * d) / denom;
    const v0 = Math.sqrt(v0Sq);

    // Flight time until reaching target plane
    const flightTime = d / (v0 * cosTheta);

    // Peak trajectory height
    const vy0 = v0 * sinTheta;
    const apexHeight = launchPos.y + (vy0 * vy0) / (2 * this.gravity);

    // Unit horizontal direction
    const ux = dx / d;
    const uz = dz / d;

    const vx = v0 * cosTheta * ux;
    const vy = vy0;
    const vz = v0 * cosTheta * uz;

    // Required robot yaw heading in simulator coordinate frame: (cos(heading), 0, -sin(heading))
    const requiredHeadingRad = Math.atan2(-dz, dx);

    // Ball velocity at arrival at target hoop plane
    const vyArrival = vy0 - this.gravity * flightTime;
    const isDescending = vyArrival < 0;

    // Entry angle below horizontal: theta_entry = atan2(-vy_arrival, v_horizontal)
    const vHoriz = v0 * cosTheta;
    const entryAngleRad = isDescending ? Math.atan2(-vyArrival, vHoriz) : 0;
    const entryAngleDeg = (entryAngleRad * 180) / Math.PI;

    // Apparent rim ellipse opening viewed from ball trajectory: D_eff = D_rim * sin(theta_entry)
    const effectiveRimDiameter = this.rimDiameter * Math.sin(entryAngleRad);
    const rimClearanceMargin = effectiveRimDiameter - this.ballDiameter;

    // Physical suitability criteria:
    // 1. Ball must be on downward trajectory when reaching hoop (apex > target height)
    // 2. Apparent rim opening must be larger than ball diameter (entry angle >= ~33 degrees)
    // 3. Apex height must remain reasonable (< 7.5m)
    // 4. Launch speed must be achievable by flywheel launcher (<= 15.0 m/s)
    const isPhysicallySuitable = isDescending &&
      rimClearanceMargin > 0.01 &&
      apexHeight <= 7.5 &&
      apexHeight > targetPos.y &&
      v0 >= 4.0 &&
      v0 <= 15.0;

    return {
      valid: true,
      speed: v0,
      launchVelocity: { x: vx, y: vy, z: vz },
      flightTime,
      apexHeight,
      horizontalDistance: d,
      requiredHeadingRad,
      entryVelocity: { x: vx, y: vyArrival, z: vz },
      entryAngleDeg,
      isDescending,
      effectiveRimDiameter,
      rimClearanceMargin,
      isPhysicallySuitable,
      launchAngleDeg
    };
  }

  /**
   * Evaluates a sweep of candidate launch elevation angles and returns physically suitable candidates
   * scored by entry angle, clearance margin, and speed efficiency.
   *
   * @param {{ x: number, y: number, z: number }} launchPos Initial launch point
   * @param {{ x: number, y: number, z: number }} targetPos Hoop center target
   * @param {Object} [options]
   * @param {number} [options.minAngleDeg=48.0] Minimum candidate launch angle
   * @param {number} [options.maxAngleDeg=68.0] Maximum candidate launch angle
   * @param {number} [options.angleStepDeg=1.0] Step size between candidate angles
   * @param {number} [options.minEntryAngleDeg=34.0] Minimum entry angle to clear rim
   * @param {number} [options.maxApexHeight=6.5] Maximum allowable apex height (meters)
   * @param {number} [options.minSpeed=5.0] Minimum flywheel speed (m/s)
   * @param {number} [options.maxSpeed=14.0] Maximum flywheel speed (m/s)
   * @returns {Array<Object>} Evaluated candidate solutions sorted by score descending
   */
  evaluateCandidateTrajectories(launchPos, targetPos, options = {}) {
    const minAngle = options.minAngleDeg ?? 48.0;
    const maxAngle = options.maxAngleDeg ?? 68.0;
    const step = options.angleStepDeg ?? 1.0;
    const minEntryAngle = options.minEntryAngleDeg ?? 34.0;
    const maxApex = options.maxApexHeight ?? 6.5;
    const minSpd = options.minSpeed ?? 5.0;
    const maxSpd = options.maxSpeed ?? 14.0;

    const candidates = [];

    for (let angle = minAngle; angle <= maxAngle + 1e-4; angle += step) {
      const sol = this.calculateSolution(launchPos, targetPos, angle);
      if (!sol.valid) continue;

      // Filter physical constraints
      if (!sol.isDescending) continue;
      if (sol.entryAngleDeg < minEntryAngle) continue;
      if (sol.apexHeight > maxApex || sol.apexHeight <= targetPos.y) continue;
      if (sol.speed < minSpd || sol.speed > maxSpd) continue;
      if (sol.rimClearanceMargin <= 0) continue;

      // Objective scoring function:
      // - Higher entry angle dramatically increases effective rim opening: +2.5 per degree
      // - Clearance margin in meters: +100.0 * margin (e.g. +8.0 for 8cm margin)
      // - Speed penalty: higher speeds produce more vibration and wheel slip: -0.8 * speed
      const score = (sol.entryAngleDeg * 2.5) + (sol.rimClearanceMargin * 100.0) - (sol.speed * 0.8);

      candidates.push({
        ...sol,
        score
      });
    }

    // Sort descending by score
    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  /**
   * Optimizes launch parameters for the target hoop, selecting the candidate trajectory that maximizes
   * entry clearance while keeping required launch velocity within stable motor limits.
   *
   * @param {{ x: number, y: number, z: number }} launchPos Initial launch point
   * @param {{ x: number, y: number, z: number }} targetPos Hoop center target
   * @param {Object} [options] Options passed to evaluateCandidateTrajectories
   * @returns {{
   *   valid: boolean,
   *   solution: Object | null,
   *   candidatesCount: number,
   *   bestAngleDeg: number,
   *   message?: string
   * }}
   */
  optimizeTrajectory(launchPos, targetPos, options = {}) {
    const candidates = this.evaluateCandidateTrajectories(launchPos, targetPos, options);

    if (candidates.length === 0) {
      // Fallback: calculate nominal solution with default angle if candidates sweep found none
      const fallback = this.calculateSolution(launchPos, targetPos, this.defaultAngleDeg);
      if (fallback.valid && fallback.isDescending) {
        return {
          valid: true,
          solution: fallback,
          candidatesCount: 1,
          bestAngleDeg: fallback.launchAngleDeg,
          message: 'Fallback trajectory selected (no optimal candidate satisfied all bounds)'
        };
      }

      return {
        valid: false,
        solution: null,
        candidatesCount: 0,
        bestAngleDeg: this.defaultAngleDeg,
        message: 'No physically suitable trajectory found for current position and target'
      };
    }

    const best = candidates[0];
    return {
      valid: true,
      solution: best,
      candidatesCount: candidates.length,
      bestAngleDeg: best.launchAngleDeg,
      message: `Optimal trajectory found: ${best.launchAngleDeg.toFixed(1)}° at ${best.speed.toFixed(2)} m/s (Entry: ${best.entryAngleDeg.toFixed(1)}°, Clearance: ${(best.rimClearanceMargin * 100).toFixed(1)}cm)`
    };
  }

  /**
   * Predicts ball position at time t along theoretical ballistic trajectory.
   * Useful for trajectory validation and visualization.
   */
  predictPositionAtTime(launchPos, launchVelocity, t) {
    return {
      x: launchPos.x + launchVelocity.x * t,
      y: launchPos.y + launchVelocity.y * t - 0.5 * this.gravity * t * t,
      z: launchPos.z + launchVelocity.z * t
    };
  }
}
