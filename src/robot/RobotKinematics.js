/**
 * RobotKinematics.js
 * Mathematical models for two-wheel differential drive robotics kinematics.
 * Provides independent, purely mathematical forward and inverse kinematics
 * using consistent SI units (meters, seconds, radians).
 */

export class RobotKinematics {
  /**
   * @param {number} wheelRadius Radius of the driven wheels (meters)
   * @param {number} trackWidth Distance between left and right driven wheels (meters)
   */
  constructor(wheelRadius, trackWidth) {
    if (typeof wheelRadius !== 'number' || wheelRadius <= 0) {
      throw new Error(`Invalid wheelRadius: ${wheelRadius}. Must be a positive number.`);
    }
    if (typeof trackWidth !== 'number' || trackWidth <= 0) {
      throw new Error(`Invalid trackWidth: ${trackWidth}. Must be a positive number.`);
    }

    this.r = wheelRadius;
    this.L = trackWidth;
  }

  /**
   * Forward kinematics: computes robot body linear velocity (m/s) and angular velocity (rad/s)
   * from left and right wheel linear velocities (m/s).
   *
   * Formulas:
   *   v = (v_right + v_left) / 2
   *   w = (v_right - v_left) / L
   *
   * @param {number} vLeft Linear velocity of left wheel (m/s)
   * @param {number} vRight Linear velocity of right wheel (m/s)
   * @returns {{ linearVelocity: number, angularVelocity: number }}
   */
  forwardKinematics(vLeft, vRight) {
    const linearVelocity = (vRight + vLeft) / 2;
    const angularVelocity = (vRight - vLeft) / this.L;
    return { linearVelocity, angularVelocity };
  }

  /**
   * Forward kinematics from wheel angular velocities (rad/s).
   *
   * Formulas:
   *   v = r * (w_right + w_left) / 2
   *   w = r * (w_right - w_left) / L
   *
   * @param {number} omegaLeft Angular velocity of left wheel (rad/s)
   * @param {number} omegaRight Angular velocity of right wheel (rad/s)
   * @returns {{ linearVelocity: number, angularVelocity: number, vLeft: number, vRight: number }}
   */
  forwardKinematicsFromAngular(omegaLeft, omegaRight) {
    const vLeft = omegaLeft * this.r;
    const vRight = omegaRight * this.r;
    const { linearVelocity, angularVelocity } = this.forwardKinematics(vLeft, vRight);
    return { linearVelocity, angularVelocity, vLeft, vRight };
  }

  /**
   * Inverse kinematics: computes wheel linear velocities (m/s) and wheel angular velocities (rad/s)
   * from desired robot body linear velocity (m/s) and angular velocity (rad/s).
   *
   * Formulas:
   *   v_left = v - (w * L) / 2
   *   v_right = v + (w * L) / 2
   *   w_left = v_left / r
   *   w_right = v_right / r
   *
   * @param {number} linearVelocity Desired robot linear velocity (m/s)
   * @param {number} angularVelocity Desired robot angular velocity (rad/s)
   * @returns {{ vLeft: number, vRight: number, omegaLeft: number, omegaRight: number }}
   */
  inverseKinematics(linearVelocity, angularVelocity) {
    const halfBaseSpeed = (angularVelocity * this.L) / 2;
    const vLeft = linearVelocity - halfBaseSpeed;
    const vRight = linearVelocity + halfBaseSpeed;
    const omegaLeft = vLeft / this.r;
    const omegaRight = vRight / this.r;

    return { vLeft, vRight, omegaLeft, omegaRight };
  }

  /**
   * Converts angular velocity in radians per second to revolutions per minute (RPM).
   * RPM = omega * (60 / (2 * PI))
   * @param {number} radPerSec
   * @returns {number}
   */
  static radPerSecToRpm(radPerSec) {
    return radPerSec * (30 / Math.PI);
  }

  /**
   * Converts revolutions per minute (RPM) to angular velocity in radians per second.
   * omega = RPM * ((2 * PI) / 60)
   * @param {number} rpm
   * @returns {number}
   */
  static rpmToRadPerSec(rpm) {
    return rpm * (Math.PI / 30);
  }

  /**
   * Normalizes an angle into the [-PI, PI] range.
   * @param {number} angleRad Angle in radians
   * @returns {number} Normalized angle in radians
   */
  static normalizeAngle(angleRad) {
    return Math.atan2(Math.sin(angleRad), Math.cos(angleRad));
  }
}
