/**
 * AutonomousGameplayController.js
 * Master autonomous coordinator for SMART-BASKETBOT Milestone 7.
 * Unifies simulated vision perception, A* navigation, intake manipulation,
 * closed-loop trajectory optimization, and adaptive shot evaluation into
 * a robust, self-directing basketball-playing robotics intelligence.
 */

import { AUTONOMOUS_CONFIG, AUTONOMOUS_STATES, GAMEPLAY_MODES } from './AutonomousConfig.js';
import { AutonomousStateMachine } from './AutonomousStateMachine.js';
import { AutonomousDecisionEngine } from './AutonomousDecisionEngine.js';
import { RobotKinematics } from '../robot/RobotKinematics.js';

export class AutonomousGameplayController {
  /**
   * @param {Object} options
   * @param {import('../robot/Robot.js').Robot} options.robot
   * @param {import('../vision/VisionManager.js').VisionManager} options.visionManager
   * @param {import('../robot/HoopDetector.js').HoopDetector} options.hoopDetector
   * @param {import('../environment/Basketball.js').Basketball} options.basketball
   * @param {Object} [options.config] Custom parameter overrides
   */
  constructor(options) {
    this.robot = options.robot;
    this.visionManager = options.visionManager;
    this.hoopDetector = options.hoopDetector;
    this.basketball = options.basketball;

    this.config = { ...AUTONOMOUS_CONFIG, ...options.config };

    // Core autonomy components
    this.stateMachine = new AutonomousStateMachine({ initialState: AUTONOMOUS_STATES.IDLE });
    this.decisionEngine = new AutonomousDecisionEngine(this.config);

    // Gameplay session parameters
    this.mode = this.config.defaultMode;
    this.targetShots = this.config.defaultTargetShots;

    // Session statistics
    this.statistics = {
      successfulShots: 0,
      totalAttempts: 0,
      missedShots: 0,
      accuracyPercent: 0.0,
      recoveryAttempts: 0,
      startTime: null,
      sessionDuration: 0.0
    };

    // Active operational targets and state
    this.currentTarget = null;            // Selected basketball target { id, worldPosition, approachPosition }
    this.targetShootingPos = null;        // Target spot on court for shooting { x, z, hoopTarget }
    this.activeTrajectorySolution = null; // Ballistic trajectory parameters from TrajectoryCalculator
    this.recoveryContext = null;          // Active recovery action and parameters

    // Retries counters per category
    this.retries = {
      collection: 0,
      navigation: 0,
      alignment: 0,
      spinUp: 0
    };

    // Tracking prior shot counter to detect newly scored/missed shots
    this._lastEvaluatedShotId = null;
    this._shotOutcomeRecorded = false;

    // Register state change listener
    this.stateMachine.onStateChange((from, to, reason) => {
      this.handleStateChange(from, to, reason);
    });
  }

  // =========================================================================
  // PUBLIC CONTROL API
  // =========================================================================

  /**
   * Initiates Continuous Gameplay mode.
   * The robot continuously searches, collects, positions, shoots, and repeats.
   */
  startContinuousMode() {
    return this.startSession(GAMEPLAY_MODES.CONTINUOUS, 0);
  }

  /**
   * Initiates Fixed Successful-Shot Target mode.
   * The robot plays until targetShots successful baskets are verified.
   * @param {number} targetShots Number of successful shots required
   */
  startFixedTargetMode(targetShots = 5) {
    const validTarget = Math.max(1, Math.round(Number(targetShots) || 5));
    return this.startSession(GAMEPLAY_MODES.FIXED_TARGET, validTarget);
  }

  /**
   * Internal session start handler.
   */
  startSession(mode, targetShots) {
    if (this.robot && this.robot.driveController?.mode === 'E_STOP') {
      this.stateMachine.fail('Cannot start autonomous gameplay: Emergency Stop is engaged');
      return false;
    }

    this.mode = mode;
    this.targetShots = targetShots;
    this.statistics.startTime = Date.now();
    this._shotOutcomeRecorded = false;
    this.resetRetries();

    // Prevent controller conflicts: assign autonomous mode and yield manual keys
    if (this.robot) {
      this.robot.setControlMode('AUTONOMOUS');
      this.robot.inputController?.resetKeys();
      if (typeof this.robot.navController?.cancel === 'function') {
        this.robot.navController.cancel();
      }
      if (typeof this.robot.shootingController?.cancel === 'function') {
        this.robot.shootingController.cancel();
      }
    }

    // Check if robot already possesses a ball in its cradle
    const possession = this.decisionEngine.evaluatePossession(this.robot);
    if (possession.hasBall) {
      this.stateMachine.transitionTo(
        AUTONOMOUS_STATES.SEARCHING_FOR_HOOP,
        'Starting session with ball already in cradle: locating hoop'
      );
    } else {
      this.stateMachine.transitionTo(
        AUTONOMOUS_STATES.SEARCHING_FOR_BALL,
        'Starting session: initiating visual search for basketball'
      );
    }

    return true;
  }

  /**
   * Pauses active autonomous gameplay session while preserving robot state.
   */
  pause() {
    if (!this.stateMachine.isActive) return false;

    if (this.robot) {
      this.robot.driveController?.stop();
      this.robot.stopIntake();
      if (this.robot.shooter) this.robot.shooter.cancel();
    }

    return this.stateMachine.pause('Session paused by user');
  }

  /**
   * Resumes a paused autonomous gameplay session.
   */
  resume() {
    if (!this.stateMachine.isPaused()) return false;

    if (this.robot) {
      this.robot.setControlMode('AUTONOMOUS');
    }
    return this.stateMachine.resume();
  }

  /**
   * Stops and cancels the active autonomous gameplay session.
   */
  stop() {
    this.haltAllActuators();
    if (this.robot) {
      this.robot.setControlMode('MANUAL');
    }
    return this.stateMachine.cancel('Autonomous gameplay stopped by user');
  }

  /**
   * Resets entire autonomous intelligence session and statistics back to IDLE.
   */
  reset() {
    this.haltAllActuators();
    if (this.robot) {
      this.robot.setControlMode('MANUAL');
      if (typeof this.robot.navController?.reset === 'function') {
        this.robot.navController.reset();
      }
      if (typeof this.robot.shootingController?.reset === 'function') {
        this.robot.shootingController.reset();
      }
    }
    this.stateMachine.reset();
    this.currentTarget = null;
    this.targetShootingPos = null;
    this.activeTrajectorySolution = null;
    this.recoveryContext = null;
    this.resetRetries();

    this.statistics = {
      successfulShots: 0,
      totalAttempts: 0,
      missedShots: 0,
      accuracyPercent: 0.0,
      recoveryAttempts: 0,
      startTime: null,
      sessionDuration: 0.0
    };
    this._lastEvaluatedShotId = null;
    this._shotOutcomeRecorded = false;
  }

  /**
   * Resets internal category retry counters.
   */
  resetRetries() {
    this.retries.collection = 0;
    this.retries.navigation = 0;
    this.retries.alignment = 0;
    this.retries.spinUp = 0;
  }

  /**
   * Safely halts all motors, intake rollers, and flywheels.
   */
  haltAllActuators() {
    if (this.robot) {
      this.robot.driveController?.stop();
      this.robot.stopIntake();
      if (this.robot.shooter) this.robot.shooter.cancel();
      if (this.robot.navController) this.robot.navController.cancel();
      if (this.robot.shootingController) this.robot.shootingController.cancel();
    }
  }

  /**
   * Helper to set robot drive velocities compatibly across DifferentialDriveController and test mocks.
   * @param {number} linearVelocity
   * @param {number} angularVelocity
   */
  setRobotDriveVelocities(linearVelocity, angularVelocity) {
    if (!this.robot || !this.robot.driveController) return;
    if (typeof this.robot.driveController.setDriveVelocities === 'function') {
      this.robot.driveController.setDriveVelocities(linearVelocity, angularVelocity);
    } else if (typeof this.robot.driveController.setTargetVelocity === 'function') {
      this.robot.driveController.setTargetVelocity(linearVelocity, angularVelocity);
    }
  }

  // =========================================================================
  // MAIN AUTONOMOUS UPDATE LOOP
  // =========================================================================

  /**
   * Steps the autonomous state machine and decision logic every simulation frame.
   * @param {number} dt Frame delta time in seconds
   */
  update(dt) {
    if (!this.stateMachine.isActive) {
      return;
    }

    // Step state timer and session timer
    this.stateMachine.update(dt);
    if (this.statistics.startTime) {
      this.statistics.sessionDuration = (Date.now() - this.statistics.startTime) / 1000.0;
    }

    // Safety check: Emergency Stop engagement immediately aborts gameplay
    if (this.robot && this.robot.driveController?.mode === 'E_STOP') {
      this.haltAllActuators();
      this.stateMachine.fail('Emergency Stop activated: autonomous gameplay terminated');
      return;
    }

    const state = this.stateMachine.getState();
    const timeInState = this.stateMachine.getTimeInState();

    switch (state) {
      // ---------------------------------------------------------------------
      // 1. SEARCHING_FOR_BALL: Rotate to scan court until vision detects a ball
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.SEARCHING_FOR_BALL: {
        // Query VisionManager for candidate basketball tracks
        const target = this.decisionEngine.selectBestBasketballTarget(this.visionManager, this.robot);
        if (target) {
          this.robot.driveController.stop();
          this.currentTarget = target;
          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.SELECTING_TARGET,
            `Basketball detected (${target.id} at ${target.distance.toFixed(1)}m). Locking target`
          );
          return;
        }

        // Rotate in place to conduct 360-degree camera sweep
        this.setRobotDriveVelocities(0.0, this.config.searchRotateSpeed);

        if (timeInState >= this.config.searchBallTimeout) {
          this.robot.driveController.stop();
          this.triggerRecovery('BALL_LOST', 'Visual scan completed full 360° rotation without detecting basketball');
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 2. SELECTING_TARGET: Lock approach coordinates and launch A* navigation
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.SELECTING_TARGET: {
        const target = this.currentTarget || this.decisionEngine.selectBestBasketballTarget(this.visionManager, this.robot);
        if (!target) {
          this.stateMachine.transitionTo(AUTONOMOUS_STATES.SEARCHING_FOR_BALL, 'Target lost during selection: resuming visual search');
          return;
        }

        this.currentTarget = target;
        const appPos = target.approachPosition;

        // Command autonomous A* navigation to approach waypoint
        const navSuccess = this.robot.startAutonomousNavigation(appPos.x, appPos.z);
        if (navSuccess) {
          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.NAVIGATING_TO_BALL,
            `Navigating to ball ${target.id} at (${appPos.x.toFixed(1)}, ${appPos.z.toFixed(1)})`
          );
        } else {
          this.triggerRecovery('NAV_BLOCKED', `Failed to plan navigable path to ball approach (${appPos.x.toFixed(1)}, ${appPos.z.toFixed(1)})`);
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 3. NAVIGATING_TO_BALL: Track waypoint progress and detect ball proximity
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.NAVIGATING_TO_BALL: {
        const navState = this.robot.navController?.state;
        const robotPos = this.robot.getPosition();
        const targetPos = this.currentTarget?.worldPosition;

        const distToBall = targetPos
          ? Math.hypot(targetPos.x - robotPos.x, targetPos.z - robotPos.z)
          : 999;

        // Proximity trigger: If robot arrives within ballCaptureDistance, transition to intake collection
        if (distToBall <= this.config.ballCaptureDistance || navState === 'GOAL_REACHED') {
          this.robot.navController.cancel();
          this.retries.navigation = 0;
          this.robot.startIntake();
          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.COLLECTING_BALL,
            `Within capture zone (${distToBall.toFixed(2)}m). Engaging front intake rollers`
          );
          return;
        }

        // Navigation failure handling
        if (navState === 'BLOCKED') {
          this.triggerRecovery('NAV_BLOCKED', 'Path to target basketball is blocked by obstacle');
          return;
        }

        // Timeout fallback for ball navigation
        if (timeInState >= 15.0) {
          if (distToBall <= 1.2) {
            this.robot.navController.cancel();
            this.robot.startIntake();
            this.stateMachine.transitionTo(
              AUTONOMOUS_STATES.COLLECTING_BALL,
              `Navigation timed out near ball (${distToBall.toFixed(2)}m). Switching to collection crawl`
            );
            return;
          }
          this.robot.navController.cancel();
          this.triggerRecovery('NAV_BLOCKED', `Navigation to ball timed out after ${timeInState.toFixed(1)}s`);
          return;
        }

        // Target tracking verification: Check if vision target departed significantly
        const currentObs = this.visionManager?.getSelectedBasketball();
        if (currentObs && currentObs.id === this.currentTarget.id && targetPos) {
          const shift = Math.hypot(currentObs.worldPosition.x - targetPos.x, currentObs.worldPosition.z - targetPos.z);
          // If the ball moved more than 0.6m (e.g. rolled away), dynamically re-plan
          if (shift > 0.6) {
            this.currentTarget.worldPosition = { ...currentObs.worldPosition };
            this.robot.startAutonomousNavigation(currentObs.worldPosition.x, currentObs.worldPosition.z);
          }
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 4. COLLECTING_BALL: Crawl forward with intake rollers until possession confirmed
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.COLLECTING_BALL: {
        const possession = this.decisionEngine.evaluatePossession(this.robot);

        // Possession confirmation: optical sensor active or ball captured in cradle
        if (possession.hasBall) {
          this.robot.driveController.stop();
          this.robot.stopIntake();
          this.retries.collection = 0; // Reset collection retry counter
          // Keep current target or associate captured ball so HUD shows possessed ball
          if (!this.currentTarget && this.robot.intake?.capturedBall) {
            this.currentTarget = {
              id: this.robot.intake.capturedBall.id,
              distance: 0.0,
              confidence: 1.0,
              worldPosition: this.robot.getPosition()
            };
          }

          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.SEARCHING_FOR_HOOP,
            'Ball captured securely in containment cradle. Locating basket hoop'
          );
          return;
        }

        // Steer front intake scoop actively towards the target ball during collection crawl
        const robotPos = this.robot.getPosition();
        const robotHeading = this.robot.getHeading();
        let yawCommand = 0.0;
        if (this.currentTarget?.worldPosition) {
          const dx = this.currentTarget.worldPosition.x - robotPos.x;
          const dz = this.currentTarget.worldPosition.z - robotPos.z;
          const angleToBall = Math.atan2(-dz, dx);
          const headingErr = RobotKinematics.normalizeAngle(angleToBall - robotHeading);
          yawCommand = Math.max(-1.5, Math.min(1.5, headingErr * 2.5));
        }

        this.setRobotDriveVelocities(this.config.ballCollectionDriveSpeed, yawCommand);

        if (timeInState >= this.config.collectionTimeout) {
          this.robot.driveController.stop();
          this.robot.stopIntake();
          this.triggerRecovery('COLLECTION_FAILED', `Collection timed out after ${timeInState.toFixed(1)}s without ball capture`);
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 5. SEARCHING_FOR_HOOP: Scan for regulation basketball hoop via vision
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.SEARCHING_FOR_HOOP: {
        const hoopObs = this.visionManager?.getHoopObservation();

        if (hoopObs && hoopObs.visible && hoopObs.confidence >= this.config.minHoopConfidence) {
          this.robot.driveController.stop();
          this._navShootingStarted = false;
          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.NAVIGATING_TO_SHOOTING_POSITION,
            `Hoop detected by camera (range: ${hoopObs.distance.toFixed(1)}m, conf: ${(hoopObs.confidence * 100).toFixed(0)}%). Navigating to key`
          );
          return;
        }

        // Rotate in place toward East hoop direction (+X baseline)
        this.setRobotDriveVelocities(0.0, this.config.searchRotateSpeed);

        if (timeInState >= this.config.searchHoopTimeout) {
          this.robot.driveController.stop();
          this._navShootingStarted = false;
          // Fall back to default free-throw line key coordinates
          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.NAVIGATING_TO_SHOOTING_POSITION,
            'Hoop search timed out: driving to default Free-Throw Key position'
          );
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 6. NAVIGATING_TO_SHOOTING_POSITION: Drive to optimal shooting key
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.NAVIGATING_TO_SHOOTING_POSITION: {
        // Initialize navigation on first entry
        if (!this._navShootingStarted) {
          this._navShootingStarted = true;
          const hoopObs = this.visionManager?.getHoopObservation();
          this.targetShootingPos = this.decisionEngine.calculateShootingPosition(hoopObs, this.robot);
          this.robot.startAutonomousNavigation(this.targetShootingPos.x, this.targetShootingPos.z);
        }

        const navState = this.robot.navController?.state;
        const robotPos = this.robot.getPosition();
        const distToKey = this.targetShootingPos
          ? Math.hypot(this.targetShootingPos.x - robotPos.x, this.targetShootingPos.z - robotPos.z)
          : 0;

        if (navState === 'GOAL_REACHED' || distToKey <= this.config.shootingPosTolerance) {
          this._navShootingStarted = false;
          this.robot.navController.cancel();
          this.robot.driveController.stop();
          this.retries.navigation = 0;
          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.ALIGNING_WITH_HOOP,
            `Arrived at shooting position (${this.targetShootingPos.x.toFixed(1)}, ${this.targetShootingPos.z.toFixed(1)}). Aligning with basket`
          );
          return;
        }

        if (navState === 'BLOCKED') {
          // If blocked but already within shooting range (3.5m to 7.0m from hoop), shoot from current location!
          const hoopX = this.targetShootingPos?.hoopTarget?.x || 12.425;
          const distToHoop = Math.hypot(hoopX - robotPos.x, -robotPos.z);
          if (distToHoop >= 3.5 && distToHoop <= 7.0) {
            this._navShootingStarted = false;
            this.robot.navController.cancel();
            this.robot.driveController.stop();
            this.stateMachine.transitionTo(
              AUTONOMOUS_STATES.ALIGNING_WITH_HOOP,
              `Navigation blocked but within range (${distToHoop.toFixed(1)}m): proceeding to align from current position`
            );
            return;
          }
          this._navShootingStarted = false;
          this.triggerRecovery('NAV_BLOCKED', 'Path to shooting key is obstructed');
          return;
        }

        if (timeInState >= 15.0) {
          this._navShootingStarted = false;
          this.robot.navController.cancel();
          this.robot.driveController.stop();
          const hoopX = this.targetShootingPos?.hoopTarget?.x || 12.425;
          const distToHoop = Math.hypot(hoopX - robotPos.x, -robotPos.z);
          if (distToHoop >= 3.0 && distToHoop <= 7.5) {
            this.stateMachine.transitionTo(
              AUTONOMOUS_STATES.ALIGNING_WITH_HOOP,
              `Navigation timed out but in shooting range (${distToHoop.toFixed(1)}m): proceeding to align`
            );
            return;
          }
          this.triggerRecovery('NAV_BLOCKED', `Navigation to shooting position timed out after ${timeInState.toFixed(1)}s`);
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 7. ALIGNING_WITH_HOOP: Precision heading hold PID alignment toward rim
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.ALIGNING_WITH_HOOP: {
        const hoopObs = this.visionManager?.getHoopObservation();
        const robotPos = this.robot.getPosition();
        const currentHeading = this.robot.getHeading();

        const hoopTarget = (hoopObs && hoopObs.visible && hoopObs.targetRimPosition)
          ? hoopObs.targetRimPosition
          : (this.targetShootingPos?.hoopTarget || { x: 12.425, y: 3.05, z: 0.0 });

        const dx = hoopTarget.x - robotPos.x;
        const dz = hoopTarget.z - robotPos.z;
        const nominalHeading = Math.atan2(-dz, dx);

        // Incorporate adaptive heading bias
        const headingBias = this.robot.adaptiveCorrector?.headingBias || 0.0;
        const targetHeading = RobotKinematics.normalizeAngle(nominalHeading + headingBias);
        const headingError = RobotKinematics.normalizeAngle(targetHeading - currentHeading);

        // Apply heading hold PID
        this.robot.driveController.setTargetHeading(targetHeading, 0.0);

        const angSpeed = Math.abs(typeof this.robot.getAngularVelocity === 'function' ? this.robot.getAngularVelocity().y : 0);
        const withinTol = Math.abs(headingError) <= this.config.headingToleranceRad;
        const settled = angSpeed < 0.4 || timeInState > 0.4;

        if ((withinTol && settled) || (timeInState > 2.0 && Math.abs(headingError) <= 0.08 && angSpeed < 0.3)) {
          this.robot.driveController.stop();
          this.retries.alignment = 0;
          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.OPTIMIZING_TRAJECTORY,
            `Aligned with basket (error: ${(Math.abs(headingError) * 180 / Math.PI).toFixed(1)}°). Calculating ballistic trajectory`
          );
          return;
        }

        if (timeInState >= this.config.alignmentTimeout) {
          this.robot.driveController.stop();
          this.triggerRecovery('ALIGNMENT_TIMEOUT', `Heading alignment timed out after ${timeInState.toFixed(1)}s (error: ${(Math.abs(headingError) * 180 / Math.PI).toFixed(1)}°)`);
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 8. OPTIMIZING_TRAJECTORY: Ballistic solver + adaptive feedback calibration
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.OPTIMIZING_TRAJECTORY: {
        const muzzlePos = this.getMuzzlePosition();
        const hoopTarget = this.targetShootingPos?.hoopTarget || { x: 12.425, y: 3.05, z: 0.0 };

        const opt = this.robot.trajectoryCalculator.optimizeTrajectory(muzzlePos, hoopTarget, {
          minAngleDeg: 50.0,
          maxAngleDeg: 66.0,
          angleStepDeg: 1.0,
          minEntryAngleDeg: 34.0,
          maxApexHeight: 6.8
        });

        if (!opt.valid || !opt.solution) {
          this.triggerRecovery('TRAJECTORY_INVALID', opt.message || 'No physically valid trajectory found');
          return;
        }

        // Apply adaptive velocity & elevation biases from historical feedback
        const adapted = this.robot.adaptiveCorrector.applyCorrection({
          speed: opt.solution.speed,
          launchAngleDeg: opt.solution.launchAngleDeg,
          requiredHeadingRad: opt.solution.requiredHeadingRad
        });

        this.activeTrajectorySolution = {
          ...opt.solution,
          speed: adapted.speed,
          launchAngleDeg: adapted.launchAngleDeg
        };

        // Configure launcher elevation angle
        this.robot.shooter?.setLaunchAngle(this.activeTrajectorySolution.launchAngleDeg);

        this.stateMachine.transitionTo(
          AUTONOMOUS_STATES.SPINNING_UP_FLYWHEELS,
          `Trajectory optimal: ${this.activeTrajectorySolution.launchAngleDeg.toFixed(1)}° at ${this.activeTrajectorySolution.speed.toFixed(2)} m/s. Accelerating flywheels`
        );
        break;
      }

      // ---------------------------------------------------------------------
      // 9. SPINNING_UP_FLYWHEELS: Accelerate dual flywheels to target speed
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.SPINNING_UP_FLYWHEELS: {
        if (!this.activeTrajectorySolution) {
          this.stateMachine.transitionTo(AUTONOMOUS_STATES.OPTIMIZING_TRAJECTORY, 'Trajectory missing: re-optimizing');
          return;
        }

        // Spin up flywheels to required launch speed
        this.robot.shooter?.spinUp(this.activeTrajectorySolution.speed);

        if (this.robot.shooter?.state === 'READY') {
          const interlocks = this.decisionEngine.evaluateShootingInterlocks(this.robot, this.visionManager?.getHoopObservation());
          if (interlocks.isReady) {
            this.retries.spinUp = 0;
            this.stateMachine.transitionTo(
              AUTONOMOUS_STATES.SHOOTING,
              'Flywheels at operational RPM. All interlocks verified. Executing shot'
            );
          } else {
            this.triggerRecovery('INTERLOCK_FAILED', `Interlock check failed: ${interlocks.blockers.join(', ')}`);
          }
          return;
        }

        if (timeInState >= this.config.spinUpTimeout) {
          this.robot.shooter?.cancel();
          this.triggerRecovery('SPINUP_TIMEOUT', `Flywheel spin-up timed out after ${timeInState.toFixed(1)}s`);
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 10. SHOOTING: Fire basketball into Rapier 3D ballistic trajectory
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.SHOOTING: {
        const hoopTarget = this.targetShootingPos?.hoopTarget || { x: 12.425, y: 3.05, z: 0.0 };

        const shotInfo = {
          id: Date.now(),
          distance: this.activeTrajectorySolution ? this.activeTrajectorySolution.targetDistance : 4.225,
          launchSpeed: this.activeTrajectorySolution ? this.activeTrajectorySolution.speed : 8.5,
          launchAngleDeg: this.activeTrajectorySolution ? this.activeTrajectorySolution.launchAngleDeg : 52.0
        };

        const fired = this.robot.fireShot(this.basketball, this.hoopDetector, hoopTarget);

        if (fired) {
          this.statistics.totalAttempts++;
          this._shotOutcomeRecorded = false;
          this._lastEvaluatedShotId = shotInfo.id;

          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.EVALUATING_SHOT,
            `Shot #${this.statistics.totalAttempts} launched into ballistic flight. Evaluating scoring trajectory`
          );
        } else {
          this.triggerRecovery('SHOT_REJECTED', `Shooter rejected launch: ${this.robot.shooter?.lastRejectReason || 'interlock violation'}`);
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 11. EVALUATING_SHOT: Wait for physical scoring resolution from HoopDetector
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.EVALUATING_SHOT: {
        const shotStats = this.hoopDetector?.stats;
        const lastResult = shotStats?.lastShotResult; // 'SCORED', 'MISSED', 'IN_FLIGHT'

        if (lastResult === 'SCORED') {
          if (!this._shotOutcomeRecorded) {
            this._shotOutcomeRecorded = true;
            this.statistics.successfulShots++;
            this.updateAccuracy();

            // Inform adaptive corrector of scored outcome so decay damping is applied
            const details = this.hoopDetector?.lastShotDetails;
            const corrector = this.robot.adaptiveCorrector || this.robot.adaptiveShotCorrector;
            if (details && corrector) {
              if (typeof corrector.recordShotOutcome === 'function') {
                corrector.recordShotOutcome(details);
              } else if (typeof corrector.recordOutcome === 'function') {
                corrector.recordOutcome(details);
              }
            }
          }

          // Check mission completion for FIXED_TARGET mode
          const completion = this.decisionEngine.evaluateMissionCompletion(
            this.mode,
            this.statistics.successfulShots,
            this.targetShots
          );

          if (completion.isCompleted) {
            this.haltAllActuators();
            this.stateMachine.complete(
              `Target achieved: ${this.statistics.successfulShots} successful baskets scored (${this.statistics.totalAttempts} attempts, ${this.statistics.accuracyPercent.toFixed(1)}% accuracy)!`
            );
          } else {
            const remMsg = this.mode === GAMEPLAY_MODES.FIXED_TARGET ? ` (${completion.remainingShots} remaining)` : '';
            this.stateMachine.transitionTo(
              AUTONOMOUS_STATES.REACQUIRING_BALL,
              `BASKET SCORED! Total: ${this.statistics.successfulShots}${remMsg}. Reacquiring basketball`
            );
          }
          return;
        }

        if (lastResult === 'MISSED' || (shotStats?.lastDetailedResult && shotStats.lastDetailedResult.startsWith('MISSED_'))) {
          if (!this._shotOutcomeRecorded) {
            this._shotOutcomeRecorded = true;
            this.statistics.missedShots++;
            this.updateAccuracy();

            // Inform adaptive corrector with detailed miss outcome
            const details = this.hoopDetector?.lastShotDetails;
            const corrector = this.robot.adaptiveCorrector || this.robot.adaptiveShotCorrector;
            if (details && corrector) {
              if (typeof corrector.recordShotOutcome === 'function') {
                corrector.recordShotOutcome(details);
              } else if (typeof corrector.recordOutcome === 'function') {
                corrector.recordOutcome(details);
              }
            }
          }

          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.REACQUIRING_BALL,
            `Shot missed (${shotStats?.lastDetailedResult || 'MISSED'}). Adaptive bias calibrated. Reacquiring ball`
          );
          return;
        }

        // Timeout fallback if ball did not trigger resolution within shotEvaluationTimeout
        if (timeInState >= this.config.shotEvaluationTimeout) {
          if (!this._shotOutcomeRecorded) {
            this._shotOutcomeRecorded = true;
            this.statistics.missedShots++;
            this.updateAccuracy();
          }
          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.REACQUIRING_BALL,
            'Shot trajectory evaluation timed out: registering attempt and continuing'
          );
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 12. REACQUIRING_BALL: Cooldown and transition to search for next ball
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.REACQUIRING_BALL: {
        this.robot.stopIntake();
        if (this.robot.shooter) this.robot.shooter.cancel();

        if (timeInState >= this.config.reacquireCooldown) {
          this.currentTarget = null;
          this.targetShootingPos = null;
          this.activeTrajectorySolution = null;

          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.SEARCHING_FOR_BALL,
            'Ready for next attempt: initiating visual basketball search'
          );
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 13. RECOVERING: Execute recovery maneuver (e.g. back up, replan, scan)
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.RECOVERING: {
        if (!this.recoveryContext) {
          this.stateMachine.transitionTo(AUTONOMOUS_STATES.SEARCHING_FOR_BALL, 'Recovery context clear: scanning for ball');
          return;
        }

        const action = this.recoveryContext.action;

        if (action === 'BACKUP_AND_REAPPROACH') {
          // Reverse for 0.8s to give clearance, then re-engage approach
          if (timeInState < 0.8) {
            this.setRobotDriveVelocities(this.config.recoveryBackupSpeed, 0.0);
          } else {
            this.robot.driveController.stop();
            this.stateMachine.transitionTo(AUTONOMOUS_STATES.NAVIGATING_TO_BALL, 'Back-up clearance complete: re-approaching ball');
          }
        } else if (action === 'REPLAN_NAVIGATION') {
          if (timeInState >= 0.5) {
            this.stateMachine.transitionTo(AUTONOMOUS_STATES.SELECTING_TARGET, 'Replanning navigable path to target');
          }
        } else {
          // General recovery wait
          if (timeInState >= this.config.recoveryCooldown) {
            const nextState = this.recoveryContext.nextState || AUTONOMOUS_STATES.SEARCHING_FOR_BALL;
            this.stateMachine.transitionTo(nextState, this.recoveryContext.reason || 'Recovery complete');
          }
        }
        break;
      }
    }
  }

  // =========================================================================
  // RECOVERY & FAILURE MANAGEMENT
  // =========================================================================

  /**
   * Triggers an intelligent recovery procedure based on failure context.
   * @param {string} reason Diagnostic code
   * @param {string} details Human-readable explanation
   */
  triggerRecovery(reason, details) {
    this.statistics.recoveryAttempts++;

    let categoryRetries = 0;
    if (reason === 'COLLECTION_FAILED' || reason === 'INTAKE_TIMEOUT') {
      this.retries.collection++;
      categoryRetries = this.retries.collection;
    } else if (reason === 'NAV_BLOCKED' || reason === 'PATH_PLANNING_FAILED') {
      this.retries.navigation++;
      categoryRetries = this.retries.navigation;
    } else if (reason === 'ALIGNMENT_TIMEOUT') {
      this.retries.alignment++;
      categoryRetries = this.retries.alignment;
    } else if (reason === 'SPINUP_TIMEOUT') {
      this.retries.spinUp++;
      categoryRetries = this.retries.spinUp;
    } else {
      categoryRetries = 1;
    }

    const decision = this.decisionEngine.evaluateRecoveryAction(reason, {
      retries: categoryRetries,
      totalRecoveries: this.statistics.recoveryAttempts
    });

    this.recoveryContext = decision;

    if (decision.nextState === AUTONOMOUS_STATES.FAILED) {
      this.haltAllActuators();
      this.stateMachine.fail(decision.reason);
    } else {
      this.stateMachine.transitionTo(decision.nextState, `${decision.reason} (${details})`);
    }
  }

  /**
   * Updates historical accuracy percentage.
   */
  updateAccuracy() {
    if (this.statistics.totalAttempts > 0) {
      this.statistics.accuracyPercent = (this.statistics.successfulShots / this.statistics.totalAttempts) * 100.0;
    } else {
      this.statistics.accuracyPercent = 0.0;
    }
  }

  /**
   * Helper to compute world coordinates of the robot's shooter muzzle.
   */
  getMuzzlePosition() {
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
   * Internal hook executed on every state machine transition.
   */
  handleStateChange(from, to, reason) {
    if (to === 'COMPLETED' || to === 'FAILED' || to === 'CANCELLED') {
      this.haltAllActuators();
      if (this.robot) {
        this.robot.setControlMode('MANUAL');
      }
    }
  }

  // =========================================================================
  // TELEMETRY & STATUS QUERY
  // =========================================================================

  /**
   * Returns complete status and telemetry snapshot for HUD and monitoring.
   */
  getStatus() {
    const sm = this.stateMachine.getTelemetry();
    const possession = this.decisionEngine.evaluatePossession(this.robot);
    const hoopObs = this.visionManager?.getHoopObservation();
    const target = this.currentTarget || (this.robot?.intake?.capturedBall ? {
      id: this.robot.intake.capturedBall.id,
      distance: 0.0,
      azimuthDeg: 0.0,
      confidence: 1.0,
      worldPosition: typeof this.robot.intake.capturedBall.getPosition === 'function' ? this.robot.intake.capturedBall.getPosition() : null
    } : null);

    const remainingShots = this.mode === GAMEPLAY_MODES.FIXED_TARGET
      ? Math.max(0, this.targetShots - this.statistics.successfulShots)
      : 0;

    return {
      state: sm.state,
      previousState: sm.previousState,
      timeInState: sm.timeInState,
      statusMessage: sm.statusMessage,
      isActive: sm.isActive,
      isPaused: sm.isPaused,
      isTerminal: sm.isTerminal,
      mode: this.mode,
      targetShots: this.targetShots,
      remainingShots,
      statistics: { ...this.statistics },
      target: target ? {
        id: target.id,
        distance: target.distance,
        bearingDeg: target.azimuthDeg,
        confidence: target.confidence,
        worldPosition: target.worldPosition
      } : null,
      hoop: {
        visible: hoopObs?.visible ?? false,
        distance: hoopObs?.distance ?? null,
        confidence: hoopObs?.confidence ?? 0
      },
      possession: {
        hasBall: possession.hasBall,
        opticalActive: possession.opticalActive,
        state: possession.state
      },
      shooter: {
        state: this.robot?.shooter?.state || 'IDLE',
        flywheelRpm: this.robot?.shooter?.flywheelRpm || 0,
        isReady: this.robot?.shooter?.state === 'READY'
      }
    };
  }

  /**
   * Returns gameplay statistics.
   */
  getStatistics() {
    return { ...this.statistics };
  }

  /**
   * Whether gameplay controller is actively executing.
   */
  get isActive() {
    return this.stateMachine.isActive;
  }
}
