/**
 * IntakeMechanism.js
 * Front-mounted basketball acquisition and containment subsystem.
 * Manages:
 * - State machine: IDLE, INTAKING, BALL_CAPTURED, REJECTING, FAULT
 * - Simulated optical photogate sensor detecting physical ball presence in hopper cradle
 * - Physical ball pulling, capture, and containment lock
 * - Intake roller animations reflecting operational state.
 */

export class IntakeMechanism {
  /**
   * @param {Object} [options]
   * @param {number} [options.intakeSpeed=25.0] Roller angular velocity when active (rad/s)
   * @param {number} [options.cradleOffsetX=0.08] Containment cradle X in robot local frame (meters)
   * @param {number} [options.cradleOffsetY=0.20] Containment cradle Y in robot local frame (meters)
   * @param {number} [options.cradleOffsetZ=0.0] Containment cradle Z in robot local frame (meters)
   */
  constructor(options = {}) {
    this.intakeSpeed = options.intakeSpeed ?? 25.0; // rad/s
    this.cradleLocalPos = {
      x: options.cradleOffsetX ?? 0.08,
      y: options.cradleOffsetY ?? -0.08,
      z: options.cradleOffsetZ ?? 0.0
    };

    // Intake state: 'IDLE', 'INTAKING', 'BALL_CAPTURED', 'REJECTING', 'FAULT'
    this.state = 'IDLE';

    // Ball state: 'FIELD', 'CAPTURED', 'IN_FLIGHT', 'SCORED'
    this.ballState = 'FIELD';

    // Simulated optical beam-break sensor
    this.opticalSensorActive = false;

    // Intake roller animation tracking
    this.rollerAngle = 0.0;
    this.currentRollerSpeed = 0.0;

    // Ball capture lock reference
    this.isBallCaptured = false;
  }

  /**
   * Starts intaking balls.
   */
  startIntake() {
    if (this.isBallCaptured) {
      this.state = 'BALL_CAPTURED';
      return;
    }
    this.state = 'INTAKING';
    this.currentRollerSpeed = this.intakeSpeed;
  }

  /**
   * Stops intake rollers.
   */
  stopIntake() {
    if (this.isBallCaptured) {
      this.state = 'BALL_CAPTURED';
    } else {
      this.state = 'IDLE';
    }
    this.currentRollerSpeed = 0.0;
  }

  /**
   * Reverses intake rollers to eject/reject ball forward.
   */
  startReject() {
    this.state = 'REJECTING';
    this.currentRollerSpeed = -this.intakeSpeed;
    if (this.isBallCaptured) {
      this.releaseBall();
    }
  }

  /**
   * Captures ball into containment cradle and engages possession lock.
   * @param {Object} basketball
   * @param {Object} robot
   */
  captureBall(basketball, robot) {
    this.isBallCaptured = true;
    this.opticalSensorActive = true;
    this.state = 'BALL_CAPTURED';
    this.ballState = 'CAPTURED';
    this.currentRollerSpeed = 0.0;

    if (basketball) {
      if (basketball.collider) {
        basketball.collider.setSensor(true);
      }
      if (basketball.rigidBody) {
        basketball.rigidBody.setGravityScale(0.0, true);
        basketball.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        basketball.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  /**
   * Releases ball from physical containment.
   * @param {Object} [basketball]
   */
  releaseBall(basketball = null) {
    this.isBallCaptured = false;
    this.opticalSensorActive = false;
    this.ballState = 'FIELD';
    if (this.state === 'BALL_CAPTURED') {
      this.state = 'IDLE';
    }

    if (basketball) {
      if (basketball.collider) {
        basketball.collider.setSensor(false);
      }
      if (basketball.rigidBody) {
        basketball.rigidBody.setGravityScale(1.0, true);
        basketball.rigidBody.wakeUp();
      }
    }
  }

  /**
   * Resets intake to initial uncaptured state.
   * @param {Object} [basketball]
   */
  reset(basketball = null) {
    this.releaseBall(basketball);
    this.state = 'IDLE';
    this.ballState = 'FIELD';
    this.currentRollerSpeed = 0.0;
    this.rollerAngle = 0.0;
  }

  /**
   * Updates intake state, checks optical sensor, guides ball into cradle, and rotates roller mesh.
   * @param {number} dt Frame delta time in seconds
   * @param {Object} robot Reference to Robot instance
   * @param {Object} basketball Reference to Basketball instance
   */
  update(dt, robot, basketball) {
    if (!basketball || !robot) return;

    // 1. Advance roller animation
    this.rollerAngle += this.currentRollerSpeed * dt;

    const ballPos = basketball.getPosition();
    const robotPos = robot.getPosition();
    const robotHeading = robot.getHeading();

    // 2. Transform ball position into robot local frame
    const dx = ballPos.x - robotPos.x;
    const dz = ballPos.z - robotPos.z;
    const dy = ballPos.y - robotPos.y;

    const cosH = Math.cos(robotHeading);
    const sinH = Math.sin(robotHeading);

    // Local coordinates: forward along local X, lateral along local Z
    const localX = cosH * dx - sinH * dz;
    const localZ = sinH * dx + cosH * dz;
    const localY = dy;

    // 3. Distance to optical sensor / containment cradle
    const distToCradle = Math.hypot(
      localX - this.cradleLocalPos.x,
      localY - this.cradleLocalPos.y,
      localZ - this.cradleLocalPos.z
    );

    // 4. If ball is already captured, lock its physical transform to containment cradle
    if (this.isBallCaptured) {
      this.opticalSensorActive = true;
      this.ballState = 'CAPTURED';
      this.state = 'BALL_CAPTURED';
      this.currentRollerSpeed = 0.0;

      if (basketball.collider && !basketball.collider.isSensor()) {
        basketball.collider.setSensor(true);
      }
      if (basketball.rigidBody) {
        basketball.rigidBody.setGravityScale(0.0, true);

        // Calculate world coordinates of the containment cradle
        const cradleWorldX = robotPos.x + cosH * this.cradleLocalPos.x + sinH * this.cradleLocalPos.z;
        const cradleWorldY = robotPos.y + this.cradleLocalPos.y;
        const cradleWorldZ = robotPos.z - sinH * this.cradleLocalPos.x + cosH * this.cradleLocalPos.z;

        basketball.rigidBody.setTranslation({ x: cradleWorldX, y: cradleWorldY, z: cradleWorldZ }, true);
        const rVel = robot.getVelocity();
        basketball.rigidBody.setLinvel({ x: rVel.x, y: rVel.y, z: rVel.z }, true);
        basketball.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      return;
    }

    this.opticalSensorActive = false;

    // 5. If INTAKING, detect ball in front intake zone
    if (this.state === 'INTAKING' && this.ballState === 'FIELD') {
      const inFrontBumper = (localX >= 0.05 && localX <= 0.85);
      const inIntakeWidth = (Math.abs(localZ) <= 0.35);
      const atGroundHeight = (Math.abs(localY - this.cradleLocalPos.y) <= 0.35);

      if (inFrontBumper && inIntakeWidth && atGroundHeight) {
        // Front intake rollers are at localX = 0.49m, bumper edge at 0.38m
        // When ball touches front rollers or bumper cutout (localX <= 0.58m or distToCradle <= 0.45m):
        if (localX <= 0.58 || distToCradle <= 0.45) {
          this.captureBall(basketball, robot);
        } else {
          // Physical intake action: apply pull force drawing ball toward intake opening
          const pullSpeed = 3.0;
          const targetWorldX = robotPos.x + cosH * this.cradleLocalPos.x + sinH * this.cradleLocalPos.z;
          const targetWorldY = robotPos.y + this.cradleLocalPos.y;
          const targetWorldZ = robotPos.z - sinH * this.cradleLocalPos.x + cosH * this.cradleLocalPos.z;

          const pullDirX = targetWorldX - ballPos.x;
          const pullDirY = targetWorldY - ballPos.y;
          const pullDirZ = targetWorldZ - ballPos.z;
          const pullDist = Math.hypot(pullDirX, pullDirY, pullDirZ);

          if (pullDist > 0.01 && basketball.rigidBody) {
            const inv = 1 / pullDist;
            basketball.rigidBody.wakeUp();
            basketball.rigidBody.setLinvel({
              x: pullDirX * inv * pullSpeed,
              y: Math.max(0.1, pullDirY * inv * pullSpeed),
              z: pullDirZ * inv * pullSpeed
            }, true);
          }
        }
      }
    }
  }

  /**
   * Intake and ball sensor telemetry.
   */
  getTelemetry() {
    return {
      state: this.state,
      ballState: this.ballState,
      hasBall: this.isBallCaptured,
      opticalSensorActive: this.opticalSensorActive,
      rollerSpeedRpm: (this.currentRollerSpeed * 30) / Math.PI
    };
  }
}
