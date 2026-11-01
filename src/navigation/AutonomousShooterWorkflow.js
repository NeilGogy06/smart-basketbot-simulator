/**
 * AutonomousShooterWorkflow.js
 * High-level autonomous coordinator orchestrating the full basketball acquisition,
 * containment, navigation to key, hoop alignment, and ballistic shooting sequence.
 */

import { SIMULATION_CONFIG } from '../simulation/SimulationConfig.js';
import { RobotKinematics } from '../robot/RobotKinematics.js';
import { TrajectoryCalculator } from '../robot/TrajectoryCalculator.js';
import { AdaptiveShotCorrector } from '../robot/AdaptiveShotCorrector.js';
import { ClosedLoopShootingController } from '../robot/ClosedLoopShootingController.js';

export class AutonomousShooterWorkflow {
  /**
   * @param {Object} options
   * @param {Object} options.robot Reference to Robot instance
   * @param {Object} options.basketball Reference to Basketball instance
   * @param {import('../robot/HoopDetector.js').HoopDetector} options.hoopDetector
   * @param {AdaptiveShotCorrector} [options.adaptiveCorrector]
   * @param {TrajectoryCalculator} [options.trajectoryCalculator]
   * @param {{ x: number, y: number, z: number }} [options.hoopTarget]
   */
  constructor(options) {
    this.robot = options.robot;
    this.basketball = options.basketball;
    this.hoopDetector = options.hoopDetector;

    this.calculator = options.trajectoryCalculator ?? new TrajectoryCalculator();
    this.corrector = options.adaptiveCorrector ?? new AdaptiveShotCorrector();

    const courtLen = SIMULATION_CONFIG.court.length;
    const overhang = SIMULATION_CONFIG.court.basketCenterOverhang;
    this.hoopTarget = options.hoopTarget ?? {
      x: courtLen / 2 - overhang,
      y: SIMULATION_CONFIG.hoop.rimHeight,
      z: 0.0
    };

    // Dedicated closed-loop shooting controller
    this.shootingController = new ClosedLoopShootingController({
      robot: this.robot,
      basketball: this.basketball,
      hoopDetector: this.hoopDetector,
      trajectoryCalculator: this.calculator,
      adaptiveCorrector: this.corrector,
      hoopTarget: this.hoopTarget
    });

    // Default shooting position (Free-throw line key: X = 8.2, Z = 0.0)
    this.defaultShootingPos = { x: 8.2, z: 0.0 };
    this.targetShootingPos = { ...this.defaultShootingPos };

    // Alignment configuration parameters
    this.alignmentToleranceRad = options.alignmentToleranceRad ?? 0.04; // ~2.3 degrees
    this.alignmentTimeout = options.alignmentTimeout ?? 3.5; // seconds timeout

    // Sequence States:
    // 'IDLE', 'NAVIGATING_TO_BALL', 'APPROACHING_AND_INTAKING', 'CAPTURING_BALL',
    // 'NAVIGATING_TO_SHOOT_POS', 'ALIGNING_WITH_HOOP', 'SPINNING_UP', 'FIRING',
    // 'TRACKING_TRAJECTORY', 'COMPLETED', 'CANCELLED', 'FAILED'
    this.stage = 'IDLE';

    this.timer = 0.0;
    this.statusMessage = 'Autonomous workflow idle';
    this.activeSolution = null;
  }

  /**
   * Starts the end-to-end autonomous acquisition and shooting sequence.
   * @param {{ x: number, z: number }} [customShootingPos]
   */
  startSequence(customShootingPos = null) {
    if (this.robot.driveController.mode === 'E_STOP') {
      this.statusMessage = 'Cannot start workflow while Emergency Stop is active';
      return false;
    }

    if (customShootingPos) {
      this.targetShootingPos = { ...customShootingPos };
    } else {
      this.targetShootingPos = { ...this.defaultShootingPos };
    }

    this.timer = 0.0;

    // If ball is already in possession, skip acquisition and proceed directly to shooting position!
    if (this.robot.intake && this.robot.intake.isBallCaptured) {
      this.transitionTo('NAVIGATING_TO_SHOOT_POS', 'Ball already possessed: driving to shooting position');
      this.robot.startAutonomousNavigation(this.targetShootingPos.x, this.targetShootingPos.z);
      return true;
    }

    // Step 1: Navigate to the ball's location on court
    const ballPos = this.basketball.getPosition();
    this.transitionTo('NAVIGATING_TO_BALL', `Acquiring ball at (${ballPos.x.toFixed(1)}, ${ballPos.z.toFixed(1)})`);

    // Target a spot 0.45m in front of the ball
    this.robot.startAutonomousNavigation(ballPos.x, ballPos.z);
    return true;
  }

  /**
   * Cancels the active sequence and stops all subsystem operations.
   */
  cancelSequence() {
    this.transitionTo('CANCELLED', 'Autonomous sequence cancelled by user');
    if (this.robot.intake) this.robot.intake.stopIntake();
    if (this.robot.shooter) this.robot.shooter.cancel();
    this.robot.cancelAutonomousNavigation();
    if (this.robot.driveController) this.robot.driveController.stop();
  }

  /**
   * Emergency stop abort.
   */
  emergencyStop() {
    this.transitionTo('CANCELLED', 'Emergency Stop engaged: workflow halted');
    if (this.robot.intake) this.robot.intake.stopIntake();
    if (this.robot.shooter) this.robot.shooter.cancel();
    this.robot.cancelAutonomousNavigation();
    if (this.robot.driveController) this.robot.driveController.emergencyStop();
  }

  /**
   * Helper to set stage and status message.
   */
  transitionTo(stage, message) {
    this.stage = stage;
    this.statusMessage = message;
    this.timer = 0.0;
  }

  /**
   * Updates autonomous sequence state machine.
   * @param {number} dt Frame time step in seconds
   */
  update(dt) {
    if (this.stage === 'IDLE' || this.stage === 'COMPLETED' || this.stage === 'CANCELLED' || this.stage === 'FAILED') {
      return;
    }

    this.timer += dt;
    const robotPos = this.robot.getPosition();
    const heading = this.robot.getHeading();
    const ballPos = this.basketball.getPosition();
    const distToBall = Math.hypot(ballPos.x - robotPos.x, ballPos.z - robotPos.z);

    switch (this.stage) {
      case 'NAVIGATING_TO_BALL': {
        // As robot approaches the ball (< 0.90m), disengage path follower and transition to active intake approach
        if (distToBall < 0.90) {
          this.robot.navController.cancel();
          this.transitionTo('APPROACHING_AND_INTAKING', 'Approaching ball: intake rollers active');
          this.robot.intake.startIntake();
        }
        break;
      }

      case 'APPROACHING_AND_INTAKING': {
        // Direct robot towards ball while intake rollers spin
        const dx = ballPos.x - robotPos.x;
        const dz = ballPos.z - robotPos.z;
        const targetHeading = Math.atan2(-dz, dx);

        // Drive slowly forward into ball
        this.robot.driveController.setTargetHeading(targetHeading, 0.65);

        // Check if ball enters intake or optical sensor triggers
        if (this.robot.intake.isBallCaptured || this.robot.intake.opticalSensorActive) {
          this.robot.driveController.stop();
          this.transitionTo('CAPTURING_BALL', 'Ball entered intake: confirming capture');
        } else if (this.timer > 6.0 && distToBall > 1.2) {
          // Ball bounced away, re-acquire
          this.transitionTo('NAVIGATING_TO_BALL', 'Re-acquiring ball position');
          this.robot.startAutonomousNavigation(ballPos.x, ballPos.z);
        }
        break;
      }

      case 'CAPTURING_BALL': {
        this.robot.intake.stopIntake();
        if (this.robot.intake.isBallCaptured) {
          this.transitionTo('NAVIGATING_TO_SHOOT_POS', 'Ball secured: navigating to shooting position');
          this.robot.startAutonomousNavigation(this.targetShootingPos.x, this.targetShootingPos.z);
        } else {
          this.transitionTo('APPROACHING_AND_INTAKING', 'Resuming ball intake');
          this.robot.intake.startIntake();
        }
        break;
      }

      case 'NAVIGATING_TO_SHOOT_POS': {
        const distToShootPos = Math.hypot(
          this.targetShootingPos.x - robotPos.x,
          this.targetShootingPos.z - robotPos.z
        );

        if (this.robot.navController.state === 'GOAL_REACHED' || distToShootPos < 0.35) {
          this.robot.cancelAutonomousNavigation();
          this.robot.driveController.stop();
          this.transitionTo('ALIGNING_WITH_HOOP', 'Arrived at shooting position: aligning with basket');
        }
        break;
      }

      case 'ALIGNING_WITH_HOOP': {
        const dx = this.hoopTarget.x - robotPos.x;
        const dz = this.hoopTarget.z - robotPos.z;
        const nominalHeading = Math.atan2(-dz, dx);
        const targetHeading = RobotKinematics.normalizeAngle(nominalHeading + this.corrector.headingBias);
        const headingErr = RobotKinematics.normalizeAngle(targetHeading - heading);

        // Turn in place to aim directly at hoop with adaptive heading offset
        this.robot.driveController.setTargetHeading(targetHeading, 0.0);

        if (Math.abs(headingErr) <= this.alignmentToleranceRad) {
          this.robot.driveController.stop();

          // Calculate and optimize ballistic launch parameters
          const muzzleLocal = this.robot.shooter?.muzzleLocalPos ?? { x: 0.20, y: 0.45, z: 0.0 };
          const cosH = Math.cos(heading);
          const sinH = Math.sin(heading);
          const muzzleWorld = {
            x: robotPos.x + cosH * muzzleLocal.x,
            y: robotPos.y + muzzleLocal.y,
            z: robotPos.z - sinH * muzzleLocal.x
          };

          const opt = this.calculator.optimizeTrajectory(muzzleWorld, this.hoopTarget);
          if (opt.valid && opt.solution) {
            const adapted = this.corrector.applyCorrection({
              speed: opt.solution.speed,
              launchAngleDeg: opt.solution.launchAngleDeg,
              requiredHeadingRad: opt.solution.requiredHeadingRad
            });

            this.activeSolution = {
              ...opt.solution,
              speed: adapted.speed,
              launchAngleDeg: adapted.launchAngleDeg,
              biases: adapted.biases
            };

            this.robot.shooter.setLaunchAngle(this.activeSolution.launchAngleDeg);
            this.robot.shooter.spinUp(this.activeSolution.speed);
          } else {
            this.robot.shooter.prepareShotAtHoop(this.robot, this.hoopTarget);
          }

          this.transitionTo('SPINNING_UP', 'Aligned with basket: spinning up flywheels');
        } else if (this.timer >= this.alignmentTimeout) {
          this.robot.driveController.stop();
          const errDeg = ((Math.abs(headingErr) * 180) / Math.PI).toFixed(1);
          const tolDeg = ((this.alignmentToleranceRad * 180) / Math.PI).toFixed(1);
          this.transitionTo('FAILED', `Hoop alignment timed out: heading error ${errDeg}° exceeds tolerance ${tolDeg}°`);
        }
        break;
      }

      case 'SPINNING_UP': {
        if (this.robot.shooter.state === 'READY') {
          this.transitionTo('FIRING', 'Flywheels ready: firing shot!');
          const fired = this.robot.shooter.fire(this.robot, this.basketball, this.hoopDetector, this.hoopTarget);
          if (!fired) {
            this.transitionTo('FAILED', `Shooter failed to fire: ${this.robot.shooter.lastRejectReason || ''}`);
          }
        }
        break;
      }

      case 'FIRING': {
        const shotInfo = {
          id: Date.now(),
          distance: Math.hypot(this.hoopTarget.x - robotPos.x, this.hoopTarget.z - robotPos.z),
          launchSpeed: this.activeSolution ? this.activeSolution.speed : this.robot.shooter.targetLaunchSpeed,
          launchAngleDeg: this.activeSolution ? this.activeSolution.launchAngleDeg : this.robot.shooter.launchAngleDeg,
          headingErrorDeg: ((this.targetHeading - heading) * 180) / Math.PI,
          predictedApex: this.activeSolution ? this.activeSolution.apexHeight : 0,
          predictedFlightTime: this.activeSolution ? this.activeSolution.flightTime : 0
        };

        if (this.hoopDetector) {
          this.hoopDetector.notifyShotFired(shotInfo);
        }

        this.transitionTo('TRACKING_TRAJECTORY', 'Ball in flight: tracking ballistic trajectory');
        break;
      }

      case 'TRACKING_TRAJECTORY': {
        const shotResult = this.hoopDetector.stats.lastShotResult;
        if (shotResult === 'SCORED' || shotResult === 'MISSED' || this.timer > 5.5) {
          // Record shot outcome into adaptive corrector
          if (this.hoopDetector.lastShotDetails) {
            this.corrector.recordShotOutcome(this.hoopDetector.lastShotDetails);
          }
          const detailed = this.hoopDetector.stats.lastDetailedResult || shotResult;
          if (shotResult === 'SCORED') {
            this.transitionTo('COMPLETED', `BASKET SCORED! (${detailed})`);
          } else {
            this.transitionTo('COMPLETED', `Shot finished: ${detailed}`);
          }
        }
        break;
      }
    }
  }

  /**
   * Resets workflow to initial state.
   */
  reset() {
    this.stage = 'IDLE';
    this.statusMessage = 'Autonomous workflow idle';
    this.timer = 0.0;
    this.activeSolution = null;
    if (this.shootingController) {
      this.shootingController.reset();
    }
  }

  /**
   * Telemetry summary.
   */
  getTelemetry() {
    return {
      stage: this.stage,
      statusMessage: this.statusMessage,
      timer: this.timer,
      isActive: (this.stage !== 'IDLE' && this.stage !== 'COMPLETED' && this.stage !== 'CANCELLED' && this.stage !== 'FAILED'),
      ballCaptured: this.robot?.intake?.isBallCaptured ?? false,
      activeSolution: this.activeSolution,
      adaptiveBiases: this.corrector ? this.corrector.getTelemetry() : {},
      shootingController: this.shootingController ? this.shootingController.getTelemetry() : {}
    };
  }
}
