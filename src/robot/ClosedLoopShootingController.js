/**
 * ClosedLoopShootingController.js
 * Dedicated closed-loop shooting subsystem controller.
 * Orchestrates:
 * - Trajectory optimization for target hoop geometry
 * - Precision heading alignment using heading hold PID
 * - Interlocked dual-flywheel spin-up and readiness verification
 * - Ball possession interlock checking
 * - Shot execution and telemetry reporting
 * - Avoids conflicts with the autonomous navigation controller.
 */

import { SIMULATION_CONFIG } from '../simulation/SimulationConfig.js';
import { RobotKinematics } from './RobotKinematics.js';
import { TrajectoryCalculator } from './TrajectoryCalculator.js';
import { AdaptiveShotCorrector } from './AdaptiveShotCorrector.js';

export class ClosedLoopShootingController {
  /**
   * @param {Object} options
   * @param {import('./Robot.js').Robot} options.robot Reference to Robot instance
   * @param {import('../environment/Basketball.js').Basketball} options.basketball Reference to Basketball instance
   * @param {import('./HoopDetector.js').HoopDetector} options.hoopDetector Reference to HoopDetector instance
   * @param {TrajectoryCalculator} [options.trajectoryCalculator]
   * @param {AdaptiveShotCorrector} [options.adaptiveCorrector]
   * @param {{ x: number, y: number, z: number }} [options.hoopTarget]
   * @param {number} [options.headingToleranceRad=0.035] Heading error tolerance (~2.0 degrees)
   * @param {number} [options.alignmentTimeout=4.0] Timeout in seconds for heading alignment
   * @param {number} [options.spinUpTimeout=3.0] Timeout in seconds for flywheel spin-up
   */
  constructor(options) {
    this.robot = options.robot;
    this.basketball = options.basketball;
    this.hoopDetector = options.hoopDetector;

    this.calculator = options.trajectoryCalculator ?? new TrajectoryCalculator();
    this.corrector = options.adaptiveCorrector ?? new AdaptiveShotCorrector();

    const courtLen = SIMULATION_CONFIG.court.length;
    const overhang = SIMULATION_CONFIG.court.basketCenterOverhang;
    this.targetHoop = options.hoopTarget ?? {
      x: courtLen / 2 - overhang, // East hoop center: 12.425m
      y: SIMULATION_CONFIG.hoop.rimHeight, // 3.05m
      z: 0.0
    };

    this.headingToleranceRad = options.headingToleranceRad ?? 0.035; // ~2.0 degrees
    this.alignmentTimeout = options.alignmentTimeout ?? 4.0;
    this.spinUpTimeout = options.spinUpTimeout ?? 3.0;

    // Controller states:
    // 'IDLE', 'OPTIMIZING_TRAJECTORY', 'ALIGNING', 'SPINNING_UP', 'READY', 'FIRING', 'COOLDOWN', 'COMPLETED', 'FAILED', 'CANCELLED'
    this.state = 'IDLE';
    this.timer = 0.0;
    this.statusMessage = 'Closed-loop shooting controller idle';

    // Active planned trajectory solution
    this.activeSolution = null;
    this.headingError = 0.0;
    this.targetHeading = 0.0;
    this.distanceToHoop = 0.0;
  }

  /**
   * Whether controller is actively pursuing targeting, alignment, spinup, or firing.
   */
  get isActive() {
    return this.state !== 'IDLE' && this.state !== 'COMPLETED' && this.state !== 'FAILED' && this.state !== 'CANCELLED';
  }

  /**
   * Initiates the closed-loop targeting and shooting sequence.
   * @param {{ x: number, y: number, z: number }} [customHoopTarget]
   * @returns {boolean} Whether sequence initiated successfully
   */
  startShootingSequence(customHoopTarget = null) {
    if (this.robot.driveController.mode === 'E_STOP') {
      this.transitionTo('FAILED', 'Cannot start shooting while Emergency Stop is engaged');
      return false;
    }

    if (customHoopTarget) {
      this.targetHoop = { ...customHoopTarget };
    }

    // Possession check: genuine ball capture in containment cradle is strictly required
    if (!this.robot.intake || !this.robot.intake.isBallCaptured) {
      this.transitionTo('FAILED', 'Shooting aborted: no ball captured in robot containment');
      return false;
    }

    // Safety: ensure autonomous navigation is cancelled so motion controllers do not conflict
    if (this.robot.navController) {
      this.robot.navController.cancel();
    }

    this.transitionTo('OPTIMIZING_TRAJECTORY', 'Evaluating candidate ballistic trajectories for hoop target');
    return true;
  }

  /**
   * Helper to set state, message, and reset state timer.
   */
  transitionTo(state, message) {
    this.state = state;
    this.statusMessage = message;
    this.timer = 0.0;
  }

  /**
   * Calculates world coordinates of the launcher muzzle based on robot pose.
   */
  getMuzzleWorldPosition() {
    const robotPos = this.robot.getPosition();
    const heading = this.robot.getHeading();
    const muzzleLocal = this.robot.shooter?.muzzleLocalPos ?? { x: 0.54, y: 0.45, z: 0.0 };

    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);
    const mx = muzzleLocal.x;
    const my = muzzleLocal.y;
    const mz = muzzleLocal.z || 0.0;

    return {
      x: robotPos.x + cosH * mx - sinH * mz,
      y: robotPos.y + my,
      z: robotPos.z - sinH * mx - cosH * mz
    };
  }

  /**
   * Closed-loop update step executed every frame.
   * @param {number} dt Frame time step in seconds
   */
  update(dt) {
    if (this.state === 'IDLE' || this.state === 'COMPLETED' || this.state === 'FAILED' || this.state === 'CANCELLED') {
      return;
    }

    this.timer += dt;
    const robotPos = this.robot.getPosition();
    const heading = this.robot.getHeading();
    this.distanceToHoop = Math.hypot(this.targetHoop.x - robotPos.x, this.targetHoop.z - robotPos.z);

    // Calculate line-of-sight heading towards hoop
    const dx = this.targetHoop.x - robotPos.x;
    const dz = this.targetHoop.z - robotPos.z;
    const nominalHeading = Math.atan2(-dz, dx);

    // Target heading incorporating adaptive heading bias
    this.targetHeading = RobotKinematics.normalizeAngle(nominalHeading + this.corrector.headingBias);
    this.headingError = RobotKinematics.normalizeAngle(this.targetHeading - heading);

    switch (this.state) {
      case 'OPTIMIZING_TRAJECTORY': {
        const muzzlePos = this.getMuzzleWorldPosition();
        const opt = this.calculator.optimizeTrajectory(muzzlePos, this.targetHoop, {
          minAngleDeg: 50.0,
          maxAngleDeg: 66.0,
          angleStepDeg: 1.0,
          minEntryAngleDeg: 34.0,
          maxApexHeight: 6.8
        });

        if (!opt.valid || !opt.solution) {
          this.transitionTo('FAILED', opt.message || 'No physically suitable ballistic trajectory found for hoop');
          return;
        }

        // Apply adaptive velocity & elevation biases
        const adapted = this.corrector.applyCorrection({
          speed: opt.solution.speed,
          launchAngleDeg: opt.solution.launchAngleDeg,
          requiredHeadingRad: opt.solution.requiredHeadingRad
        });

        this.activeSolution = {
          ...opt.solution,
          speed: adapted.speed,
          launchAngleDeg: adapted.launchAngleDeg,
          adaptedHeadingRad: adapted.targetHeadingRad,
          biases: adapted.biases
        };

        // Configure launcher elevation angle
        if (this.robot.shooter) {
          this.robot.shooter.setLaunchAngle(this.activeSolution.launchAngleDeg);
        }

        this.transitionTo('ALIGNING', `Optimal trajectory: ${this.activeSolution.launchAngleDeg.toFixed(1)}° at ${this.activeSolution.speed.toFixed(2)} m/s. Aligning robot...`);
        break;
      }

      case 'ALIGNING': {
        // Closed-loop yaw control: rotate robot in place using heading PID
        this.robot.driveController.setTargetHeading(this.targetHeading, 0.0);

        if (Math.abs(this.headingError) <= this.headingToleranceRad) {
          // Alignment achieved within tolerance
          this.robot.driveController.stop();
          this.transitionTo('SPINNING_UP', `Aligned with basket (error: ${(Math.abs(this.headingError) * 180 / Math.PI).toFixed(1)}°). Spinning up flywheels...`);

          // Command flywheel acceleration
          if (this.robot.shooter && this.activeSolution) {
            this.robot.shooter.spinUp(this.activeSolution.speed);
          }
        } else if (this.timer >= this.alignmentTimeout) {
          this.robot.driveController.stop();
          const errDeg = (Math.abs(this.headingError) * 180 / Math.PI).toFixed(1);
          const tolDeg = (this.headingToleranceRad * 180 / Math.PI).toFixed(1);
          this.transitionTo('FAILED', `Hoop alignment timed out after ${this.timer.toFixed(1)}s (error: ${errDeg}°, tolerance: ${tolDeg}°)`);
        }
        break;
      }

      case 'SPINNING_UP': {
        // Keep heading stabilized
        this.robot.driveController.setTargetHeading(this.targetHeading, 0.0);

        if (this.robot.shooter && this.robot.shooter.state === 'READY') {
          this.transitionTo('READY', 'Dual flywheels at operational RPM. Verifying interlocks...');
        } else if (this.timer >= this.spinUpTimeout) {
          this.robot.driveController.stop();
          if (this.robot.shooter) this.robot.shooter.cancel();
          this.transitionTo('FAILED', `Flywheel spin-up timed out after ${this.timer.toFixed(1)}s`);
        }
        break;
      }

      case 'READY': {
        // Final interlock validation prior to firing
        const hasBall = this.robot.intake && this.robot.intake.isBallCaptured;
        const shooterReady = this.robot.shooter && this.robot.shooter.state === 'READY';
        const aligned = Math.abs(this.headingError) <= (this.headingToleranceRad * 1.5);

        if (!hasBall) {
          this.transitionTo('FAILED', 'Interlock rejected: ball possession was lost');
          return;
        }

        if (!shooterReady) {
          this.transitionTo('FAILED', 'Interlock rejected: flywheels not ready');
          return;
        }

        if (!aligned) {
          this.transitionTo('ALIGNING', 'Robot drifted off alignment during spin-up: re-aligning');
          return;
        }

        // Fire shot
        this.transitionTo('FIRING', 'All interlocks satisfied: firing basketball into Rapier physics');
        const shotInfo = {
          id: Date.now(),
          distance: this.distanceToHoop,
          launchSpeed: this.activeSolution ? this.activeSolution.speed : 8.5,
          launchAngleDeg: this.activeSolution ? this.activeSolution.launchAngleDeg : 52.0,
          headingErrorDeg: (this.headingError * 180) / Math.PI,
          predictedApex: this.activeSolution ? this.activeSolution.apexHeight : 0,
          predictedFlightTime: this.activeSolution ? this.activeSolution.flightTime : 0
        };

        const fired = this.robot.shooter.fire(
          this.robot,
          this.basketball,
          this.hoopDetector,
          this.targetHoop
        );

        if (fired) {
          // Notify hoop detector with shot metadata
          if (this.hoopDetector) {
            this.hoopDetector.notifyShotFired(shotInfo);
          }
          this.transitionTo('COOLDOWN', 'Shot fired successfully. Handing over to trajectory tracking');
        } else {
          this.transitionTo('FAILED', `Shooter rejected launch: ${this.robot.shooter.lastRejectReason || 'unknown reason'}`);
        }
        break;
      }

      case 'COOLDOWN': {
        if (this.timer >= 0.4) {
          this.transitionTo('COMPLETED', 'Shooting sequence execution completed');
        }
        break;
      }
    }
  }

  /**
   * Cancels active sequence and safely halts motors and flywheels.
   */
  cancel() {
    this.transitionTo('CANCELLED', 'Shooting controller sequence cancelled by operator');
    if (this.robot.driveController) this.robot.driveController.stop();
    if (this.robot.shooter) this.robot.shooter.cancel();
  }

  /**
   * Emergency stop abort.
   */
  emergencyStop() {
    this.transitionTo('CANCELLED', 'Emergency Stop engaged: shooting aborted');
    if (this.robot.driveController) this.robot.driveController.emergencyStop();
    if (this.robot.shooter) this.robot.shooter.cancel();
  }

  /**
   * Resets controller to idle.
   */
  reset() {
    this.state = 'IDLE';
    this.timer = 0.0;
    this.activeSolution = null;
    this.headingError = 0.0;
    this.statusMessage = 'Closed-loop shooting controller idle';
  }

  /**
   * Telemetry summary for engineering dashboard.
   */
  getTelemetry() {
    return {
      state: this.state,
      statusMessage: this.statusMessage,
      targetDistance: this.distanceToHoop,
      headingErrorDeg: (this.headingError * 180) / Math.PI,
      headingToleranceDeg: (this.headingToleranceRad * 180) / Math.PI,
      targetHeadingDeg: (this.targetHeading * 180) / Math.PI,
      predictedAngleDeg: this.activeSolution ? this.activeSolution.launchAngleDeg : 0,
      predictedSpeed: this.activeSolution ? this.activeSolution.speed : 0,
      predictedFlightTime: this.activeSolution ? this.activeSolution.flightTime : 0,
      predictedApexHeight: this.activeSolution ? this.activeSolution.apexHeight : 0,
      predictedEntryAngleDeg: this.activeSolution ? this.activeSolution.entryAngleDeg : 0,
      predictedClearanceCm: this.activeSolution ? (this.activeSolution.rimClearanceMargin * 100) : 0,
      adaptiveBiases: this.corrector ? this.corrector.getTelemetry() : {},
      isReadyToFire: (this.state === 'READY')
    };
  }
}
