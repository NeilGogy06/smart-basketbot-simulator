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
   * @param {number} [options.linearDamping=0.08] Rapier physics linear damping coefficient (s^-1)
   */
  constructor(options = {}) {
    this.gravity = options.gravity ?? 9.81;
    this.defaultAngleDeg = options.defaultAngleDeg ?? 52.0;
    this.rimRadius = options.rimRadius ?? SIMULATION_CONFIG.hoop.rimRadius;
    this.ballRadius = options.ballRadius ?? SIMULATION_CONFIG.ball.radius;
    this.linearDamping = options.linearDamping ?? SIMULATION_CONFIG.ball?.linearDamping ?? 0.08;
    this.rimDiameter = this.rimRadius * 2; // 0.45m
    this.ballDiameter = this.ballRadius * 2; // 0.24m
  }

  /**
   * Numerically solves flight time t under Rapier linear damping gamma and gravity g:
   *   dv/dt = g - gamma * v
   * Integrating horizontally:
   *   d = (v_r0 / gamma) * (1 - exp(-gamma * t))
   * Integrating vertically with v_y0 = v_r0 * tan(theta):
   *   dy = d * tan(theta) - (g / gamma^2) * (gamma * t - 1 + exp(-gamma * t))
   *
   * Let K = d * tan(theta) - dy.
   * If gamma <= 1e-7: t = sqrt(2 * K / g)
   * If gamma > 1e-7: solves (g / gamma^2) * (tau - 1 + exp(-tau)) = K, where tau = gamma * t.
   *
   * @param {number} d Horizontal distance to target
   * @param {number} dy Vertical elevation difference to target (targetY - launchY)
   * @param {number} theta Launch elevation angle in radians
   * @param {number} gamma Linear damping coefficient
   * @param {number} g Gravitational acceleration magnitude
   * @returns {number|null} Solved flight time in seconds, or null if unreachable
   */
  solveFlightTime(d, dy, theta, gamma, g) {
    const tanTheta = Math.tan(theta);
    const K = d * tanTheta - dy;
    if (K <= 0) return null;

    if (gamma <= 1e-7) {
      return Math.sqrt((2 * K) / g);
    }

    // Vacuum flight time as initial estimate
    const t0 = Math.sqrt((2 * K) / g);
    const target = (gamma * gamma * K) / g;

    // Newton-Raphson iteration on tau = gamma * t
    let tau = gamma * t0;
    for (let iter = 0; iter < 12; iter++) {
      const expNegTau = Math.exp(-tau);
      const f = tau - 1 + expNegTau - target;
      const fPrime = 1 - expNegTau;
      if (Math.abs(fPrime) < 1e-12) break;
      const delta = f / fPrime;
      tau -= delta;
      if (Math.abs(delta) < 1e-12) break;
    }

    if (tau <= 0 || isNaN(tau)) {
      return null;
    }

    return tau / gamma;
  }

  /**
   * Calculates ballistic launch velocity vector to reach target from launch position,
   * incorporating Rapier 3D linear damping (drag) and gravity.
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

    const gamma = this.linearDamping;
    const g = this.gravity;

    // Denominator check: d * tan(theta) - dy must be positive
    const K = d * tanTheta - dy;
    if (K <= 0) {
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

    const flightTime = this.solveFlightTime(d, dy, theta, gamma, g);
    if (!flightTime || flightTime <= 0) {
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
        message: `Failed to converge on damped ballistic flight time for elevation angle ${launchAngleDeg.toFixed(1)}°`
      };
    }

    // Required initial horizontal and vertical speeds
    let vr0, vy0, v0;
    if (gamma <= 1e-7) {
      vr0 = d / flightTime;
      vy0 = vr0 * tanTheta;
      v0 = Math.hypot(vr0, vy0);
    } else {
      const expTerm = Math.exp(-gamma * flightTime);
      vr0 = (gamma * d) / (1 - expTerm);
      vy0 = vr0 * tanTheta;
      v0 = Math.hypot(vr0, vy0);
    }

    // Unit horizontal direction
    const ux = dx / d;
    const uz = dz / d;

    const vx = vr0 * ux;
    const vy = vy0;
    const vz = vr0 * uz;

    // Required robot yaw heading in simulator coordinate frame: (cos(heading), 0, -sin(heading))
    const requiredHeadingRad = Math.atan2(-dz, dx);

    // Ball velocity at target hoop plane arrival (t = flightTime)
    let vrArrival, vyArrival;
    if (gamma <= 1e-7) {
      vrArrival = vr0;
      vyArrival = vy0 - g * flightTime;
    } else {
      const expTerm = Math.exp(-gamma * flightTime);
      vrArrival = vr0 * expTerm;
      vyArrival = (vy0 + g / gamma) * expTerm - (g / gamma);
    }

    const vxArrival = vrArrival * ux;
    const vzArrival = vrArrival * uz;
    const isDescending = vyArrival < 0;

    // Peak trajectory apex height
    let apexHeight;
    if (vy0 <= 0) {
      apexHeight = launchPos.y;
    } else if (gamma <= 1e-7) {
      apexHeight = launchPos.y + (vy0 * vy0) / (2 * g);
    } else {
      // Apex occurs when vy(t) = 0 => exp(-gamma * t_apex) = g / (g + gamma * vy0)
      apexHeight = launchPos.y + vy0 / gamma - (g / (gamma * gamma)) * Math.log(1 + (gamma * vy0) / g);
    }

    // Entry angle below horizontal: theta_entry = atan2(-vy_arrival, v_horizontal)
    const entryAngleRad = isDescending ? Math.atan2(-vyArrival, vrArrival) : 0;
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
      entryVelocity: { x: vxArrival, y: vyArrival, z: vzArrival },
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
   * Predicts ball position at time t along theoretical ballistic trajectory,
   * accounting for Rapier linear damping when linearDamping > 0.
   *
   * @param {{ x: number, y: number, z: number }} launchPos Initial launch point
   * @param {{ x: number, y: number, z: number }} launchVelocity Initial launch velocity vector
   * @param {number} t Flight time in seconds
   * @returns {{ x: number, y: number, z: number }}
   */
  predictPositionAtTime(launchPos, launchVelocity, t) {
    const gamma = this.linearDamping;
    const g = this.gravity;

    if (gamma <= 1e-7 || t <= 0) {
      return {
        x: launchPos.x + launchVelocity.x * t,
        y: launchPos.y + launchVelocity.y * t - 0.5 * g * t * t,
        z: launchPos.z + launchVelocity.z * t
      };
    }

    const expTerm = Math.exp(-gamma * t);
    const intFactor = (1 - expTerm) / gamma;

    return {
      x: launchPos.x + launchVelocity.x * intFactor,
      y: launchPos.y + (launchVelocity.y + g / gamma) * intFactor - (g / gamma) * t,
      z: launchPos.z + launchVelocity.z * intFactor
    };
  }

  /**
   * Generates discrete trajectory points from launch position to target arrival.
   * Useful for trajectory validation and visualization.
   *
   * @param {{ x: number, y: number, z: number }} launchPos
   * @param {{ x: number, y: number, z: number }} launchVelocity
   * @param {number} flightTime Total flight duration in seconds
   * @param {number} [numPoints=50] Number of sampling steps
   * @returns {Array<{ x: number, y: number, z: number, t: number }>}
   */
  calculateTrajectoryPoints(launchPos, launchVelocity, flightTime, numPoints = 50) {
    const points = [];
    const count = Math.max(2, numPoints);
    for (let i = 0; i <= count; i++) {
      const t = (i / count) * flightTime;
      const pos = this.predictPositionAtTime(launchPos, launchVelocity, t);
      points.push({ ...pos, t });
    }
    return points;
  }
}
