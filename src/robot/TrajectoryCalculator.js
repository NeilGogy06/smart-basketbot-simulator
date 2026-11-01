/**
 * TrajectoryCalculator.js
 * Analytical projectile motion kinematics for basketball shooting calculations.
 * Calculates required launch velocities, flight times, apex heights, and launch vectors
 * to hit target hoop coordinates under constant gravitational acceleration.
 */

export class TrajectoryCalculator {
  /**
   * @param {Object} [options]
   * @param {number} [options.gravity=9.81] Gravitational acceleration magnitude (m/s²)
   * @param {number} [options.defaultAngleDeg=52.0] Default launch elevation angle in degrees
   */
  constructor(options = {}) {
    this.gravity = options.gravity ?? 9.81;
    this.defaultAngleDeg = options.defaultAngleDeg ?? 52.0;
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

    return {
      valid: true,
      speed: v0,
      launchVelocity: { x: vx, y: vy, z: vz },
      flightTime,
      apexHeight,
      horizontalDistance: d,
      requiredHeadingRad
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
