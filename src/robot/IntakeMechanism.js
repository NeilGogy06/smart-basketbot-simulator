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
    this.capturedBall = null;
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
    this.capturedBall = basketball;

    if (basketball) {
      if (typeof basketball.setState === 'function') {
        basketball.setState('POSSESSED');
        basketball.possessedBy = robot;
      } else {
        basketball.state = 'POSSESSED';
        basketball.isPossessed = true;
        basketball.possessedBy = robot;
      }

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
    const targetBall = basketball || this.capturedBall;
    this.isBallCaptured = false;
    this.opticalSensorActive = false;
    this.ballState = 'FIELD';
    this.capturedBall = null;

    if (this.state === 'BALL_CAPTURED') {
      this.state = 'IDLE';
    }

    if (targetBall) {
      if (typeof targetBall.setState === 'function') {
        if (targetBall.state === 'POSSESSED') {
          targetBall.setState('AVAILABLE');
        }
      } else {
        targetBall.isPossessed = false;
        targetBall.possessedBy = null;
      }

      if (targetBall.collider) {
        targetBall.collider.setSensor(false);
      }
      if (targetBall.rigidBody) {
        targetBall.rigidBody.setGravityScale(1.0, true);
        targetBall.rigidBody.wakeUp();
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
    this.capturedBall = null;
  }

  /**
   * Updates intake state, checks optical sensor, guides ball into cradle, and rotates roller mesh.
   * Supports single Basketball entity or an array of Basketball entities.
   * @param {number} dt Frame delta time in seconds
   * @param {Object} robot Reference to Robot instance
   * @param {Array<Object>|Object} basketball Reference to Basketball instance or array
   */
  update(dt, robot, basketball) {
    if (!basketball || !robot) return;

    // 1. Advance roller animation
    this.rollerAngle += this.currentRollerSpeed * dt;

    // Normalize input to array
    const ballList = Array.isArray(basketball) ? basketball : [basketball];

    // Update each ball's state timer and evaluate floor settling
    for (const b of ballList) {
      if (typeof b.update === 'function') {
        b.update(dt);
      }
    }

    // If ballState was IN_FLIGHT, check if any previously fired ball has now settled
    if (this.ballState === 'IN_FLIGHT') {
      const anyInFlight = ballList.some(b => b.state === 'IN_FLIGHT' || b.shotCooldownTimer > 0);
      if (!anyInFlight) {
        this.ballState = 'FIELD';
      }
    }

    const robotPos = robot.getPosition();
    const robotHeading = robot.getHeading();
    const cosH = Math.cos(robotHeading);
    const sinH = Math.sin(robotHeading);

    // 2. If ball is already captured, lock its physical transform to containment cradle
    if (this.isBallCaptured) {
      const ballToHold = this.capturedBall || ballList.find(b => b.isPossessed || b.state === 'POSSESSED') || ballList[0];
      if (ballToHold) {
        this.opticalSensorActive = true;
        this.ballState = 'CAPTURED';
        this.state = 'BALL_CAPTURED';
        this.currentRollerSpeed = 0.0;

        if (ballToHold.collider && !ballToHold.collider.isSensor()) {
          ballToHold.collider.setSensor(true);
        }
        if (ballToHold.rigidBody) {
          ballToHold.rigidBody.setGravityScale(0.0, true);

          // Calculate world coordinates of containment cradle
          const cradleWorldX = robotPos.x + cosH * this.cradleLocalPos.x + sinH * this.cradleLocalPos.z;
          const cradleWorldY = robotPos.y + this.cradleLocalPos.y;
          const cradleWorldZ = robotPos.z - sinH * this.cradleLocalPos.x + cosH * this.cradleLocalPos.z;

          ballToHold.rigidBody.setTranslation({ x: cradleWorldX, y: cradleWorldY, z: cradleWorldZ }, true);
          const rVel = robot.getVelocity();
          ballToHold.rigidBody.setLinvel({ x: rVel.x, y: rVel.y, z: rVel.z }, true);
          ballToHold.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
      return;
    }

    this.opticalSensorActive = false;

    // 3. If INTAKING, scan candidate available balls in front intake zone
    if (this.state === 'INTAKING' && (this.ballState === 'FIELD' || this.ballState === 'IDLE')) {
      for (const candidateBall of ballList) {
        // Enforce possession lifecycle gating:
        // Do not attempt to collect balls that are currently possessed, in flight, or in post-shot cooldown
        if (candidateBall.isPossessed) continue;
        if (candidateBall.state && candidateBall.state !== 'AVAILABLE' && candidateBall.state !== 'FIELD') continue;
        if (candidateBall.shotCooldownTimer && candidateBall.shotCooldownTimer > 0) continue;

        const bPos = candidateBall.getPosition();
        const dx = bPos.x - robotPos.x;
        const dz = bPos.z - robotPos.z;
        const dy = bPos.y - robotPos.y;

        // Local coordinates: forward along local X, lateral along local Z
        const localX = cosH * dx - sinH * dz;
        const localZ = sinH * dx + cosH * dz;
        const localY = dy;

        const distToCradle = Math.hypot(
          localX - this.cradleLocalPos.x,
          localY - this.cradleLocalPos.y,
          localZ - this.cradleLocalPos.z
        );

        const inFrontBumper = (localX >= 0.05 && localX <= 0.85);
        const inIntakeWidth = (Math.abs(localZ) <= 0.38);
        const atGroundHeight = (Math.abs(localY - this.cradleLocalPos.y) <= 0.38);

        if (inFrontBumper && inIntakeWidth && atGroundHeight) {
          // Front intake rollers are at localX = 0.49m, bumper edge at 0.38m
          // When ball touches front rollers or cradle threshold:
          if (localX <= 0.58 || distToCradle <= 0.45) {
            this.captureBall(candidateBall, robot);
            return;
          } else {
            // Apply suction pull drawing ball towards cradle
            const pullSpeed = 3.2;
            const targetWorldX = robotPos.x + cosH * this.cradleLocalPos.x + sinH * this.cradleLocalPos.z;
            const targetWorldY = robotPos.y + this.cradleLocalPos.y;
            const targetWorldZ = robotPos.z - sinH * this.cradleLocalPos.x + cosH * this.cradleLocalPos.z;

            const pullDirX = targetWorldX - bPos.x;
            const pullDirY = targetWorldY - bPos.y;
            const pullDirZ = targetWorldZ - bPos.z;
            const pullDist = Math.hypot(pullDirX, pullDirY, pullDirZ);

            if (pullDist > 0.01 && candidateBall.rigidBody) {
              const inv = 1 / pullDist;
              candidateBall.rigidBody.wakeUp();
              candidateBall.rigidBody.setLinvel({
                x: pullDirX * inv * pullSpeed,
                y: Math.max(0.1, pullDirY * inv * pullSpeed),
                z: pullDirZ * inv * pullSpeed
              }, true);
            }
            return;
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
      capturedBallId: this.capturedBall?.id || null,
      opticalSensorActive: this.opticalSensorActive,
      rollerSpeedRpm: (this.currentRollerSpeed * 30) / Math.PI
    };
  }
}
