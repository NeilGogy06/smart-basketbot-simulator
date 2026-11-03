/**
 * ShootingMechanism.js
 * Dual-flywheel angled launcher subsystem for basketball shooting.
 * Manages:
 * - State machine: IDLE, SPINNING_UP, READY, FIRING, COOLDOWN, FAULT
 * - Flywheel spin-up inertia and visual flywheel rotation animation
 * - Ballistic trajectory calculation and launch velocity injection into Rapier physics
 * - Integration with IntakeMechanism and HoopDetector.
 */

import { TrajectoryCalculator } from './TrajectoryCalculator.js';
import { SIMULATION_CONFIG } from '../simulation/SimulationConfig.js';

export class ShootingMechanism {
  /**
   * @param {Object} [options]
   * @param {number} [options.launchAngleDeg=52.0] Default elevation angle in degrees
   * @param {number} [options.spinUpDuration=0.8] Time in seconds to spin up flywheels
   * @param {number} [options.cooldownDuration=0.4] Time in seconds after firing
   */
  constructor(options = {}) {
    this.launchAngleDeg = options.launchAngleDeg ?? SIMULATION_CONFIG.robot.shooter.elevationAngleDeg;
    this.spinUpDuration = options.spinUpDuration ?? 0.8;
    this.cooldownDuration = options.cooldownDuration ?? 0.4;

    this.calculator = new TrajectoryCalculator({
      defaultAngleDeg: this.launchAngleDeg
    });

    // Shooter states: 'IDLE', 'SPINNING_UP', 'READY', 'FIRING', 'COOLDOWN', 'FAULT'
    this.state = 'IDLE';

    // State timer
    this.timer = 0.0;

    // Target ballistic speed (m/s) and flywheel RPM
    this.targetLaunchSpeed = 8.5; // m/s
    this.customSpeedOverride = null;
    this.currentFlywheelSpeed = 0.0; // rad/s
    this.flywheelAngle = 0.0;

    // Local barrel muzzle exit point relative to robot origin
    // Configured to sit at barrel exit, strictly clear of the robot chassis collider
    // (X >= 0.38m chassis front + 0.12m ball radius + 0.04m safety margin = 0.54m),
    // clearing intake rollers and preventing collision impulses on spawn.
    const configMuzzle = SIMULATION_CONFIG.robot?.shooter?.muzzleLocalPos;
    this.muzzleLocalPos = options.muzzleLocalPos ?? (configMuzzle ? { ...configMuzzle } : { x: 0.54, y: 0.45, z: 0.0 });

    // Default East target hoop coordinates
    const courtLen = SIMULATION_CONFIG.court.length;
    const overhang = SIMULATION_CONFIG.court.basketCenterOverhang;
    this.defaultHoopPos = {
      x: courtLen / 2 - overhang, // 12.425
      y: SIMULATION_CONFIG.hoop.rimHeight, // 3.05
      z: 0.0
    };

    // Telemetry status message and rejection reason
    this.statusMessage = 'Shooter idle';
    this.lastRejectReason = null;
  }

  /**
   * Sets launcher elevation angle (degrees).
   */
  setLaunchAngle(deg) {
    this.launchAngleDeg = Math.max(35, Math.min(75, deg));
    this.calculator.defaultAngleDeg = this.launchAngleDeg;
  }

  /**
   * Begins spinning up flywheels for a shot at the target hoop.
   * @param {number} [customSpeed] Optional manual speed override (m/s)
   */
  spinUp(customSpeed = null) {
    if (this.state === 'SPINNING_UP' || this.state === 'READY') return;

    if (customSpeed && customSpeed > 0) {
      this.targetLaunchSpeed = customSpeed;
      this.customSpeedOverride = customSpeed;
    }

    this.state = 'SPINNING_UP';
    this.timer = 0.0;
  }

  /**
   * Automatically calculates target launch speed to reach hoop from robot's current position,
   * then begins spin-up.
   * @param {Object} robot
   * @param {{ x: number, y: number, z: number }} [hoopTarget]
   */
  prepareShotAtHoop(robot, hoopTarget = this.defaultHoopPos) {
    const robotPos = robot.getPosition();
    const heading = robot.getHeading();

    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);

    const mx = this.muzzleLocalPos.x;
    const my = this.muzzleLocalPos.y;
    const mz = this.muzzleLocalPos.z || 0.0;

    const muzzleWorld = {
      x: robotPos.x + cosH * mx - sinH * mz,
      y: robotPos.y + my,
      z: robotPos.z - sinH * mx - cosH * mz
    };

    const solution = this.calculator.calculateSolution(muzzleWorld, hoopTarget, this.launchAngleDeg);

    if (solution.valid) {
      this.targetLaunchSpeed = solution.speed;
      this.spinUp(solution.speed);
      return solution;
    } else {
      // Fallback to sensible default
      this.spinUp(8.5);
      return solution;
    }
  }

  /**
   * Cancels spin-up and returns to IDLE.
   */
  cancel() {
    this.state = 'IDLE';
    this.timer = 0.0;
    this.customSpeedOverride = null;
    this.statusMessage = 'Shooter idle';
  }

  /**
   * Fires the basketball if ready or commanded.
   * Releases ball from intake containment and applies 3D ballistic launch velocity to Rapier body.
   * @param {Object} robot
   * @param {Object} basketball
   * @param {import('./HoopDetector.js').HoopDetector} [hoopDetector]
   * @param {{ x: number, y: number, z: number }} [hoopTarget]
   * @returns {boolean} Whether firing succeeded
   */
  fire(robot, basketball, hoopDetector = null, hoopTarget = null) {
    // Resolve the active basketball to fire (prioritize captured ball from intake)
    const ballToShoot = (robot.intake && robot.intake.capturedBall) ? robot.intake.capturedBall : basketball;
    if (!ballToShoot || !robot) {
      this.lastRejectReason = 'Missing robot or basketball reference';
      this.statusMessage = 'Firing rejected: missing references';
      return false;
    }

    const target = hoopTarget || this.defaultHoopPos;

    // Firing requires genuine ball capture by the intake mechanism.
    // Do not bypass the intake or automatically load a nearby ball.
    if (!robot.intake || !robot.intake.isBallCaptured) {
      this.lastRejectReason = 'No ball in containment: intake must capture ball before firing';
      this.statusMessage = 'Firing rejected: ball not in containment';
      return false;
    }

    this.lastRejectReason = null;
    this.statusMessage = 'Ball fired';
    this.state = 'FIRING';

    const robotPos = robot.getPosition();
    const heading = robot.getHeading();

    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);

    // Muzzle position in world frame
    const mx = this.muzzleLocalPos.x;
    const my = this.muzzleLocalPos.y;
    const mz = this.muzzleLocalPos.z || 0.0;

    const muzzleWorld = {
      x: robotPos.x + cosH * mx - sinH * mz,
      y: robotPos.y + my,
      z: robotPos.z - sinH * mx - cosH * mz
    };

    // Calculate exact ballistic launch velocity vector
    let launchVel;
    const solution = this.calculator.calculateSolution(muzzleWorld, target, this.launchAngleDeg);

    if (solution.valid) {
      if (this.customSpeedOverride && this.customSpeedOverride > 0 && solution.speed > 0) {
        const speedScale = this.customSpeedOverride / solution.speed;
        launchVel = {
          x: solution.launchVelocity.x * speedScale,
          y: solution.launchVelocity.y * speedScale,
          z: solution.launchVelocity.z * speedScale
        };
      } else {
        launchVel = solution.launchVelocity;
      }
    } else {
      const theta = (this.launchAngleDeg * Math.PI) / 180;
      const v0 = this.customSpeedOverride || this.targetLaunchSpeed || 8.5;
      const vr0 = v0 * Math.cos(theta);
      const vy0 = v0 * Math.sin(theta);
      launchVel = {
        x: vr0 * cosH,
        y: vy0,
        z: -vr0 * sinH
      };
    }

    // Galilean velocity addition: ball inherits the robot's current linear velocity
    const robotVel = typeof robot.getVelocity === 'function' ? robot.getVelocity() : { x: 0, y: 0, z: 0 };
    const totalLaunchVel = {
      x: launchVel.x + (robotVel.x || 0),
      y: launchVel.y + (robotVel.y || 0),
      z: launchVel.z + (robotVel.z || 0)
    };

    // 1. Release ball from robot containment and transition ball lifecycle to IN_FLIGHT
    if (robot.intake) {
      robot.intake.releaseBall(ballToShoot);
      robot.intake.ballState = 'IN_FLIGHT';
    }

    if (typeof ballToShoot.setState === 'function') {
      ballToShoot.setState('IN_FLIGHT');
      ballToShoot.shotCooldownTimer = 1.5;
    } else {
      ballToShoot.state = 'IN_FLIGHT';
      ballToShoot.isPossessed = false;
      ballToShoot.isAvailable = false;
      ballToShoot.shotCooldownTimer = 1.5;
    }

    // 2. Position ball at muzzle exit and apply launch velocity into Rapier physics
    if (ballToShoot.rigidBody) {
      ballToShoot.rigidBody.setTranslation(muzzleWorld, true);
      ballToShoot.rigidBody.setLinvel(totalLaunchVel, true);

      // Backspin around lateral horizontal axis perpendicular to shot direction
      const backspinSpeed = 18.0; // rad/s (~170 RPM)
      ballToShoot.rigidBody.setAngvel({
        x: -sinH * backspinSpeed,
        y: 0,
        z: -cosH * backspinSpeed
      }, true);
      ballToShoot.rigidBody.wakeUp();
    }

    // 3. Notify hoop detector to begin tracking trajectory for scoring
    if (hoopDetector) {
      hoopDetector.notifyShotFired({
        id: Date.now(),
        ball: ballToShoot,
        distance: solution.horizontalDistance || Math.hypot(target.x - muzzleWorld.x, target.z - muzzleWorld.z),
        launchSpeed: (this.customSpeedOverride && this.customSpeedOverride > 0) ? this.customSpeedOverride : (solution.valid ? solution.speed : 8.5),
        launchAngleDeg: this.launchAngleDeg,
        predictedApex: solution.apexHeight || (muzzleWorld.y + 2.5),
        predictedFlightTime: solution.flightTime || 1.1
      });
    }

    // Transition to cooldown
    this.timer = 0.0;
    this.state = 'COOLDOWN';
    this.customSpeedOverride = null;
    return true;
  }

  /**
   * Updates shooter state timers, accelerates flywheels, and rotates visual flywheel meshes.
   * @param {number} dt Frame time step in seconds
   */
  update(dt) {
    // Target flywheel angular velocity (rad/s): proportional to launch speed
    const maxFlywheelOmega = (this.targetLaunchSpeed / 0.075) * 1.5;

    switch (this.state) {
      case 'SPINNING_UP':
        this.timer += dt;
        const spinProgress = Math.min(1.0, this.timer / this.spinUpDuration);
        this.currentFlywheelSpeed = spinProgress * maxFlywheelOmega;

        if (this.timer >= this.spinUpDuration) {
          this.state = 'READY';
          this.currentFlywheelSpeed = maxFlywheelOmega;
        }
        break;

      case 'READY':
        this.currentFlywheelSpeed = maxFlywheelOmega;
        break;

      case 'COOLDOWN':
        this.timer += dt;
        // Flywheels decelerate smoothly back to idle
        this.currentFlywheelSpeed = Math.max(0, maxFlywheelOmega * (1.0 - this.timer / this.cooldownDuration));
        if (this.timer >= this.cooldownDuration) {
          this.state = 'IDLE';
          this.currentFlywheelSpeed = 0.0;
        }
        break;

      case 'IDLE':
      default:
        this.currentFlywheelSpeed = 0.0;
        break;
    }

    // Accumulate visual flywheel rotation
    this.flywheelAngle += this.currentFlywheelSpeed * dt;
  }

  /**
   * Resets shooting mechanism to initial state.
   */
  reset() {
    this.state = 'IDLE';
    this.timer = 0.0;
    this.currentFlywheelSpeed = 0.0;
    this.flywheelAngle = 0.0;
    this.customSpeedOverride = null;
    this.statusMessage = 'Shooter idle';
    this.lastRejectReason = null;
  }

  /**
   * Telemetry summary.
   */
  getTelemetry() {
    return {
      state: this.state,
      isReady: this.state === 'READY',
      targetLaunchSpeed: this.targetLaunchSpeed,
      launchAngleDeg: this.launchAngleDeg,
      flywheelRpm: (this.currentFlywheelSpeed * 30) / Math.PI,
      statusMessage: this.statusMessage,
      lastRejectReason: this.lastRejectReason
    };
  }
}
