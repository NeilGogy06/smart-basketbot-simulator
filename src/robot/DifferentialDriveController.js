/**
 * DifferentialDriveController.js
 * Dedicated differential-drive mobile robotics controller.
 * Manages:
 * - Independent left and right wheel angular & linear velocities
 * - Maximum wheel speed and body velocity saturation
 * - Linear and angular acceleration / deceleration ramping
 * - Wheel RPM calculation
 * - Heading stabilization via HeadingPIDController
 * - Wheel rotation tracking for visual representation
 * - Conversion of body-frame kinematics to world-frame physics actuator commands.
 */

import { RobotKinematics } from './RobotKinematics.js';
import { HeadingPIDController } from './PIDController.js';

export class DifferentialDriveController {
  /**
   * @param {Object} config
   * @param {number} config.wheelRadius Wheel radius (meters)
   * @param {number} config.trackWidth Distance between driven wheels (meters)
   * @param {number} [config.maxLinearVelocity=2.2] Max robot forward speed (m/s)
   * @param {number} [config.maxAngularVelocity=3.2] Max robot yaw rate (rad/s)
   * @param {number} [config.maxLinearAcceleration=3.5] Max acceleration (m/s²)
   * @param {number} [config.maxAngularAcceleration=6.0] Max angular acceleration (rad/s²)
   * @param {number} [config.maxWheelAngularVelocity=25.0] Max wheel rotational speed (rad/s)
   * @param {Object} [config.pidHeading] Heading PID parameters
   */
  constructor(config) {
    this.kinematics = new RobotKinematics(config.wheelRadius, config.trackWidth);

    this.wheelRadius = config.wheelRadius;
    this.trackWidth = config.trackWidth;

    this.maxLinearVelocity = config.maxLinearVelocity ?? 2.2;
    this.maxAngularVelocity = config.maxAngularVelocity ?? 3.2;
    this.maxLinearAcceleration = config.maxLinearAcceleration ?? 3.5;
    this.maxAngularAcceleration = config.maxAngularAcceleration ?? 6.0;
    this.maxWheelAngularVelocity = config.maxWheelAngularVelocity ?? 25.0;

    // Heading PID controller
    const pidConfig = config.pidHeading ?? { kp: 4.5, ki: 0.2, kd: 0.35, maxOutput: this.maxAngularVelocity, integralLimit: 1.2 };
    this.headingPID = new HeadingPIDController({
      kp: pidConfig.kp,
      ki: pidConfig.ki,
      kd: pidConfig.kd,
      minOutput: -pidConfig.maxOutput,
      maxOutput: pidConfig.maxOutput,
      integralLimit: pidConfig.integralLimit
    });

    // Control targets
    this.targetLinearVelocity = 0.0;
    this.targetAngularVelocity = 0.0;
    this.targetHeadingRad = 0.0;

    // Current commanded states (after acceleration ramp)
    this.currentLinearVelocity = 0.0;
    this.currentAngularVelocity = 0.0;

    // Wheel states
    this.vLeft = 0.0;
    this.vRight = 0.0;
    this.omegaLeft = 0.0;
    this.omegaRight = 0.0;
    this.rpmLeft = 0.0;
    this.rpmRight = 0.0;

    // Cumulative wheel rotation for 3D mesh animation (radians)
    this.wheelAngleLeft = 0.0;
    this.wheelAngleRight = 0.0;

    // Operating Mode: 'MANUAL', 'HEADING_HOLD', 'STOPPED', 'E_STOP'
    this.mode = 'STOPPED';
  }

  /**
   * Sets desired body velocity commands directly in robot frame.
   * Switches controller into MANUAL mode.
   * @param {number} linearVelocity Target linear speed along local X (m/s)
   * @param {number} angularVelocity Target yaw rate around local Y (rad/s)
   */
  setTargetVelocity(linearVelocity, angularVelocity) {
    if (this.mode === 'E_STOP') return;

    this.targetLinearVelocity = Math.max(-this.maxLinearVelocity, Math.min(this.maxLinearVelocity, linearVelocity));
    this.targetAngularVelocity = Math.max(-this.maxAngularVelocity, Math.min(this.maxAngularVelocity, angularVelocity));

    if (Math.abs(this.targetLinearVelocity) > 0.001 || Math.abs(this.targetAngularVelocity) > 0.001) {
      this.mode = 'MANUAL';
    } else if (Math.abs(this.currentLinearVelocity) < 0.01 && Math.abs(this.currentAngularVelocity) < 0.01) {
      this.mode = 'STOPPED';
    }
  }

  /**
   * Compatibility alias for setTargetVelocity.
   * Commands target linear forward speed and yaw angular velocity.
   * @param {number} linearVelocity Target linear speed along local X (m/s)
   * @param {number} angularVelocity Target yaw rate around local Y (rad/s)
   */
  setDriveVelocities(linearVelocity, angularVelocity) {
    return this.setTargetVelocity(linearVelocity, angularVelocity);
  }

  /**
   * Commands the robot to face and hold a target heading while optionally translating.
   * Switches controller into HEADING_HOLD mode.
   * @param {number} headingRad Desired absolute heading in radians
   * @param {number} [linearVelocity=0.0] Desired linear translation velocity
   */
  setTargetHeading(headingRad, linearVelocity = 0.0) {
    if (this.mode === 'E_STOP') return;

    const normalized = RobotKinematics.normalizeAngle(headingRad);
    const targetChanged = Math.abs(RobotKinematics.normalizeAngle(normalized - this.targetHeadingRad)) > 0.04;
    const modeChanged = this.mode !== 'HEADING_HOLD';

    if (modeChanged || targetChanged) {
      // Reset derivative state so setpoint changes do not cause violent derivative spikes
      this.headingPID.hasRun = false;
    }

    this.targetHeadingRad = normalized;
    this.targetLinearVelocity = Math.max(-this.maxLinearVelocity, Math.min(this.maxLinearVelocity, linearVelocity));
    this.mode = 'HEADING_HOLD';
  }

  /**
   * Triggers an immediate emergency stop, halting all actuator outputs and zeroing commands.
   */
  emergencyStop() {
    this.mode = 'E_STOP';
    this.targetLinearVelocity = 0.0;
    this.targetAngularVelocity = 0.0;
    this.currentLinearVelocity = 0.0;
    this.currentAngularVelocity = 0.0;
    this.vLeft = 0.0;
    this.vRight = 0.0;
    this.omegaLeft = 0.0;
    this.omegaRight = 0.0;
    this.rpmLeft = 0.0;
    this.rpmRight = 0.0;
    this.headingPID.reset();
  }

  /**
   * Releases emergency stop condition and returns to STOPPED state.
   */
  releaseEmergencyStop() {
    if (this.mode === 'E_STOP') {
      this.mode = 'STOPPED';
      this.reset();
    }
  }

  /**
   * Decelerates robot smoothly to a complete stop.
   */
  stop() {
    if (this.mode === 'E_STOP') return;
    this.targetLinearVelocity = 0.0;
    this.targetAngularVelocity = 0.0;
    this.mode = 'STOPPED';
    this.headingPID.reset();
  }

  /**
   * Resets internal controllers, timers, and velocity registers.
   */
  reset() {
    this.targetLinearVelocity = 0.0;
    this.targetAngularVelocity = 0.0;
    this.targetHeadingRad = 0.0;
    this.currentLinearVelocity = 0.0;
    this.currentAngularVelocity = 0.0;
    this.vLeft = 0.0;
    this.vRight = 0.0;
    this.omegaLeft = 0.0;
    this.omegaRight = 0.0;
    this.rpmLeft = 0.0;
    this.rpmRight = 0.0;
    this.wheelAngleLeft = 0.0;
    this.wheelAngleRight = 0.0;
    this.mode = 'STOPPED';
    this.headingPID.reset();
  }

  /**
   * Advances controller by dt seconds and computes physical world velocity commands.
   * @param {number} dt Time step in seconds
   * @param {number} currentHeadingRad Current robot heading in radians
   * @returns {{
   *   worldLinvelX: number,
   *   worldLinvelZ: number,
   *   worldAngvelY: number,
   *   movementState: string
   * }}
   */
  update(dt, currentHeadingRad) {
    if (typeof dt !== 'number' || dt <= 0) {
      return this.generatePhysicsCommand(currentHeadingRad);
    }

    // 1. Emergency stop fast-path
    if (this.mode === 'E_STOP') {
      this.currentLinearVelocity = 0.0;
      this.currentAngularVelocity = 0.0;
      this.vLeft = 0.0;
      this.vRight = 0.0;
      this.omegaLeft = 0.0;
      this.omegaRight = 0.0;
      this.rpmLeft = 0.0;
      this.rpmRight = 0.0;
      return this.generatePhysicsCommand(currentHeadingRad);
    }

    // 2. Heading PID correction if in HEADING_HOLD mode
    if (this.mode === 'HEADING_HOLD') {
      const pidAngularVel = this.headingPID.computeAngularVelocity(this.targetHeadingRad, currentHeadingRad, dt);
      this.targetAngularVelocity = pidAngularVel;
    }

    // 3. Acceleration / deceleration ramping
    const maxLinStep = this.maxLinearAcceleration * dt;
    const linDiff = this.targetLinearVelocity - this.currentLinearVelocity;
    if (Math.abs(linDiff) <= maxLinStep) {
      this.currentLinearVelocity = this.targetLinearVelocity;
    } else {
      this.currentLinearVelocity += Math.sign(linDiff) * maxLinStep;
    }

    const maxAngStep = this.maxAngularAcceleration * dt;
    const angDiff = this.targetAngularVelocity - this.currentAngularVelocity;
    if (Math.abs(angDiff) <= maxAngStep) {
      this.currentAngularVelocity = this.targetAngularVelocity;
    } else {
      this.currentAngularVelocity += Math.sign(angDiff) * maxAngStep;
    }

    // 4. Inverse kinematics to determine wheel velocities
    let { vLeft, vRight, omegaLeft, omegaRight } = this.kinematics.inverseKinematics(
      this.currentLinearVelocity,
      this.currentAngularVelocity
    );

    // 5. Wheel speed saturation constraints (scale both wheels to preserve curvature)
    const maxWheelOmega = Math.max(Math.abs(omegaLeft), Math.abs(omegaRight));
    if (maxWheelOmega > this.maxWheelAngularVelocity && maxWheelOmega > 0) {
      const scale = this.maxWheelAngularVelocity / maxWheelOmega;
      omegaLeft *= scale;
      omegaRight *= scale;
      vLeft *= scale;
      vRight *= scale;

      // Recompute effective body linear & angular velocity
      const effective = this.kinematics.forwardKinematics(vLeft, vRight);
      this.currentLinearVelocity = effective.linearVelocity;
      this.currentAngularVelocity = effective.angularVelocity;
    }

    this.vLeft = vLeft;
    this.vRight = vRight;
    this.omegaLeft = omegaLeft;
    this.omegaRight = omegaRight;

    // 6. Calculate wheel RPM
    this.rpmLeft = RobotKinematics.radPerSecToRpm(omegaLeft);
    this.rpmRight = RobotKinematics.radPerSecToRpm(omegaRight);

    // 7. Track visual wheel rotation
    this.wheelAngleLeft += omegaLeft * dt;
    this.wheelAngleRight += omegaRight * dt;

    // Keep angle representation in [-2PI, 2PI] range to avoid floating overflow
    if (Math.abs(this.wheelAngleLeft) > Math.PI * 100) this.wheelAngleLeft %= (Math.PI * 2);
    if (Math.abs(this.wheelAngleRight) > Math.PI * 100) this.wheelAngleRight %= (Math.PI * 2);

    return this.generatePhysicsCommand(currentHeadingRad);
  }

  /**
   * Translates body linear velocity into world X-Z velocity and determines movement state.
   */
  generatePhysicsCommand(headingRad) {
    const v = this.currentLinearVelocity;
    const omega = this.currentAngularVelocity;

    // Forward vector in world coordinates: (cos(heading), 0, -sin(heading))
    const worldLinvelX = v * Math.cos(headingRad);
    const worldLinvelZ = -v * Math.sin(headingRad);
    const worldAngvelY = omega;

    const movementState = this.classifyMovementState();

    return {
      worldLinvelX,
      worldLinvelZ,
      worldAngvelY,
      movementState
    };
  }

  /**
   * Classifies current robot dynamics into a descriptive engineering state.
   */
  classifyMovementState() {
    if (this.mode === 'E_STOP') return 'E_STOP';

    const v = this.currentLinearVelocity;
    const w = this.currentAngularVelocity;
    const vThresh = 0.02;
    const wThresh = 0.04;

    const hasLin = Math.abs(v) > vThresh;
    const hasAng = Math.abs(w) > wThresh;

    if (!hasLin && !hasAng) return 'STOPPED';

    if (hasLin && !hasAng) {
      return v > 0 ? 'FORWARD' : 'REVERSE';
    }

    if (!hasLin && hasAng) {
      return w > 0 ? 'TURNING_LEFT' : 'TURNING_RIGHT';
    }

    // Arc movement
    if (v > 0) {
      return w > 0 ? 'ARC_FORWARD_LEFT' : 'ARC_FORWARD_RIGHT';
    } else {
      return w > 0 ? 'ARC_REVERSE_LEFT' : 'ARC_REVERSE_RIGHT';
    }
  }

  /**
   * Returns comprehensive differential drive telemetry for display and testing.
   */
  getTelemetry(currentHeadingRad = 0) {
    const headingDiff = RobotKinematics.normalizeAngle(this.targetHeadingRad - currentHeadingRad);
    const pidTel = this.headingPID.getTelemetry();

    return {
      mode: this.mode,
      movementState: this.classifyMovementState(),
      linearVelocity: this.currentLinearVelocity,
      angularVelocity: this.currentAngularVelocity,
      targetLinearVelocity: this.targetLinearVelocity,
      targetAngularVelocity: this.targetAngularVelocity,
      targetHeadingRad: this.targetHeadingRad,
      targetHeadingDeg: (this.targetHeadingRad * 180) / Math.PI,
      headingErrorDeg: (headingDiff * 180) / Math.PI,
      pidOutput: pidTel.output,
      vLeft: this.vLeft,
      vRight: this.vRight,
      omegaLeft: this.omegaLeft,
      omegaRight: this.omegaRight,
      rpmLeft: this.rpmLeft,
      rpmRight: this.rpmRight,
      wheelAngleLeft: this.wheelAngleLeft,
      wheelAngleRight: this.wheelAngleRight
    };
  }
}
