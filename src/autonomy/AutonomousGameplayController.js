/**
 * AutonomousGameplayController.js
 * Master autonomous coordinator for SMART-BASKETBOT Milestone 7 & Continuous Gameplay Redesign.
 *
 * Implements a 14-state continuous autonomous basketball gameplay cycle:
 * 1. SEARCHING_FOR_BALL
 * 2. TRACKING_BALL / SELECTING_TARGET
 * 3. APPROACHING_BALL / NAVIGATING_TO_BALL
 * 4. ALIGNING_FOR_INTAKE
 * 5. COLLECTING_BALL
 * 6. VERIFYING_POSSESSION
 * 7. SELECTING_SHOT (Dynamic shooting evaluation from current position)
 * 8. POSITIONING_FOR_SHOT_IF_NEEDED (Only when current position is physically infeasible)
 * 9. ALIGNING_WITH_HOOP (Heading PID alignment toward basket)
 * 10. CALCULATING_SHOT / OPTIMIZING_TRAJECTORY
 * 11. SPINNING_UP_FLYWHEELS
 * 12. EXECUTING_SHOT / SHOOTING
 * 13. TRACKING_SHOT / WAITING_FOR_BALL_TO_LAND
 * 14. REACQUIRING_BALL / RETURNING_TO_SEARCHING
 *
 * Designed for indefinite continuous operation with the same physical basketball,
 * intelligent non-fatal recovery, and dynamic shooting from any feasible court position.
 */

import { AUTONOMOUS_CONFIG, AUTONOMOUS_STATES, FAILURE_CATEGORIES, GAMEPLAY_MODES } from './AutonomousConfig.js';
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

    // Diagnostics and recovery state
    this.consecutiveFailures = 0;
    this.lastFailureCategory = FAILURE_CATEGORIES.NONE;
    this.lastFailureReason = 'None';
    this.currentRecoveryAction = 'NONE';
    this.lastSuccessfulOperation = 'None';

    // Active operational targets and state
    this.currentTarget = null;            // Selected basketball target { id, worldPosition, approachPosition }
    this.targetShootingPos = null;        // Target spot on court for shooting { x, z, hoopTarget }
    this.activeTrajectorySolution = null; // Ballistic trajectory parameters from TrajectoryCalculator
    this.recoveryContext = null;          // Active recovery action and parameters
    this.activeBallReference = options.basketball || null; // Tracked physical basketball entity

    // Retries counters per category
    this.retries = {
      ballSearch: 0,
      collection: 0,
      navigation: 0,
      alignment: 0,
      spinUp: 0
    };

    // Tracking prior shot counter to detect newly scored/missed shots exactly once
    this._lastEvaluatedShotId = null;
    this._shotOutcomeRecorded = false;
    this._navShootingStarted = false;

    // Perception-to-action telemetry registers (Phase 3 diagnostics)
    this.targetSelectionStatus = 'DETECTED'; // DETECTED, TRACKED, SELECTED, TARGET_REJECTED, NAVIGATION_REQUESTED, NAVIGATING, ARRIVED, REPLANNING, RECOVERING
    this.targetRejectionReason = 'NONE';
    this.lastNavigationCommandTimestamp = null;
    this.lastKnownBallPose = null; // { x, z, distance, azimuthDeg, timestamp }
    this._lastLogTime = 0;
    this._lastLogMessage = '';

    // Register state change listener
    this.stateMachine.onStateChange((from, to, reason) => {
      this.handleStateChange(from, to, reason);
    });
  }

  /**
   * Throttled diagnostic logging to avoid console flooding while surfacing critical events.
   * @param {string} category
   * @param {string} message
   * @param {boolean} [force=false]
   */
  logThrottled(category, message, force = false) {
    const now = Date.now();
    if (!force && this._lastLogTime && (now - this._lastLogTime < 1000) && this._lastLogMessage === message) {
      return;
    }
    this._lastLogTime = now;
    this._lastLogMessage = message;
    console.log(`[AutonomousIntelligence] [${category}] ${message}`);
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
    this._navShootingStarted = false;
    this.consecutiveFailures = 0;
    this.lastFailureCategory = FAILURE_CATEGORIES.NONE;
    this.lastFailureReason = 'None';
    this.currentRecoveryAction = 'NONE';
    this.lastSuccessfulOperation = 'SESSION_STARTED';
    this.targetSelectionStatus = 'DETECTED';
    this.targetRejectionReason = 'NONE';
    this.lastNavigationCommandTimestamp = null;
    this.lastKnownBallPose = null;
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
        AUTONOMOUS_STATES.VERIFYING_POSSESSION,
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
    this.consecutiveFailures = 0;
    this.lastFailureCategory = FAILURE_CATEGORIES.NONE;
    this.lastFailureReason = 'None';
    this.currentRecoveryAction = 'NONE';
    this.lastSuccessfulOperation = 'None';
    this.targetSelectionStatus = 'DETECTED';
    this.targetRejectionReason = 'NONE';
    this.lastNavigationCommandTimestamp = null;
    this.lastKnownBallPose = null;
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
    this._navShootingStarted = false;
  }

  /**
   * Resets internal category retry counters.
   */
  resetRetries() {
    this.retries.ballSearch = 0;
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
   * Main autonomous execution step executed on every simulation frame.
   * @param {number} dt Delta time in seconds
   */
  update(dt = 0.016) {
    if (!this.stateMachine.isActive) return;
    this.stateMachine.update(dt);

    // Safety interlock: Emergency Stop aborts autonomous control immediately
    if (this.robot && this.robot.driveController?.mode === 'E_STOP') {
      this.haltAllActuators();
      this.stateMachine.fail('Emergency Stop activated: autonomous gameplay terminated');
      return;
    }

    const state = this.stateMachine.getState();
    const timeInState = this.stateMachine.getTimeInState();

    switch (state) {
      // ---------------------------------------------------------------------
      // 1. SEARCHING_FOR_BALL / RETURNING_TO_SEARCHING: Rotate to scan court for ball
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.SEARCHING_FOR_BALL:
      case AUTONOMOUS_STATES.RETURNING_TO_SEARCHING: {
        // Query VisionManager for candidate basketball tracks (pass currentTarget for hysteresis)
        const target = this.decisionEngine.selectBestBasketballTarget(this.visionManager, this.robot, this.currentTarget);
        const diag = typeof this.decisionEngine.getTargetSelectionDiagnostics === 'function'
          ? this.decisionEngine.getTargetSelectionDiagnostics()
          : null;

        if (target) {
          this.robot.driveController.stop();
          this.currentTarget = target;
          this.activeBallReference = target.track?.reference || this.activeBallReference || this.basketball;
          this.lastKnownBallPose = {
            x: target.worldPosition.x,
            z: target.worldPosition.z,
            distance: target.distance,
            azimuthDeg: target.azimuthDeg,
            timestamp: Date.now()
          };
          this.targetSelectionStatus = 'SELECTED';
          this.targetRejectionReason = 'NONE';
          this.retries.ballSearch = 0;
          this.consecutiveFailures = 0;
          this.lastSuccessfulOperation = 'BALL_ACQUIRED';
          this.logThrottled('TARGET_ACQUIRED', `Selected ball ${target.id} at ${target.distance.toFixed(1)}m (conf: ${target.confidence.toFixed(2)})`);

          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.SELECTING_TARGET,
            `Basketball detected (${target.id} at ${target.distance.toFixed(1)}m). Locking target`
          );
          return;
        }

        // Target not selected: update diagnostic status
        if (diag && diag.candidateCount > 0) {
          this.targetSelectionStatus = 'TARGET_REJECTED';
          this.targetRejectionReason = diag.primaryRejectionReason;
          this.logThrottled('TARGET_REJECTED', `Tracked ball rejected: ${diag.primaryRejectionReason}`);
        } else {
          const rawCount = this.visionManager?.latestRawBallDetections?.length ?? 0;
          this.targetSelectionStatus = rawCount > 0 ? 'DETECTED' : 'SEARCHING';
          this.targetRejectionReason = rawCount > 0 ? 'TRACKING_CONVERGENCE' : 'NO_BALL_DETECTED';
        }

        // Search strategy: if we recently saw a ball (< 4.0s), bias rotation toward its last known heading
        let searchYawSpeed = this.config.searchRotateSpeed;
        if (this.lastKnownBallPose && (Date.now() - this.lastKnownBallPose.timestamp < 4000)) {
          const rPos = this.robot.getPosition();
          const rHeading = this.robot.getHeading();
          const dx = this.lastKnownBallPose.x - rPos.x;
          const dz = this.lastKnownBallPose.z - rPos.z;
          const targetHeading = Math.atan2(-dz, dx);
          const headingErr = RobotKinematics.normalizeAngle(targetHeading - rHeading);
          if (Math.abs(headingErr) > 0.15) {
            searchYawSpeed = Math.sign(headingErr) * Math.min(Math.abs(headingErr) * 2.0, this.config.searchRotateSpeed);
          }
        }

        // Rotate in place to conduct smooth camera sweep
        this.setRobotDriveVelocities(0.0, searchYawSpeed);

        if (timeInState >= this.config.searchBallTimeout) {
          this.robot.driveController.stop();
          this.triggerRecovery(FAILURE_CATEGORIES.BALL_NOT_DETECTED, 'Visual scan completed 360° rotation without detecting collectible basketball');
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 2. SELECTING_TARGET / TRACKING_BALL: Lock approach coordinates and plan A* path
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.SELECTING_TARGET:
      case AUTONOMOUS_STATES.TRACKING_BALL: {
        const target = this.decisionEngine.selectBestBasketballTarget(this.visionManager, this.robot, this.currentTarget) || this.currentTarget;
        if (!target) {
          this.targetSelectionStatus = 'TARGET_REJECTED';
          this.stateMachine.transitionTo(AUTONOMOUS_STATES.SEARCHING_FOR_BALL, 'Target lost during selection: resuming visual search');
          return;
        }

        this.currentTarget = target;
        this.activeBallReference = target.track?.reference || this.activeBallReference || this.basketball;
        const appPos = target.approachPosition;

        this.targetSelectionStatus = 'NAVIGATION_REQUESTED';
        this.lastNavigationCommandTimestamp = Date.now();

        // Command autonomous A* navigation to approach waypoint
        const navSuccess = this.robot.startAutonomousNavigation(appPos.x, appPos.z);
        if (navSuccess) {
          this.targetSelectionStatus = 'NAVIGATING';
          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.NAVIGATING_TO_BALL,
            `Navigating to ball ${target.id} at (${appPos.x.toFixed(1)}, ${appPos.z.toFixed(1)})`
          );
        } else {
          this.targetSelectionStatus = 'REPLANNING';
          this.triggerRecovery(FAILURE_CATEGORIES.PATH_BLOCKED, `Failed to plan navigable path to ball approach (${appPos.x.toFixed(1)}, ${appPos.z.toFixed(1)})`);
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 3. NAVIGATING_TO_BALL / APPROACHING_BALL: Track waypoint progress
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.NAVIGATING_TO_BALL:
      case AUTONOMOUS_STATES.APPROACHING_BALL: {
        const navState = this.robot.navController?.state;
        const robotPos = this.robot.getPosition();
        const targetPos = this.currentTarget?.worldPosition;

        const distToBall = targetPos
          ? Math.hypot(targetPos.x - robotPos.x, targetPos.z - robotPos.z)
          : 999;

        // Proximity arrival: Once within capture zone, align chassis for intake scoop
        if (distToBall <= this.config.ballCaptureDistance || navState === 'GOAL_REACHED') {
          this.targetSelectionStatus = 'ARRIVED';
          this.robot.navController?.cancel('Arrived at collection area');
          this.robot.driveController.stop();
          this.retries.navigation = 0;
          this.consecutiveFailures = 0;
          this.lastSuccessfulOperation = 'APPROACH_COMPLETED';

          const robotHeading = this.robot.getHeading();
          let headingErr = 0.0;
          if (targetPos) {
            const dx = targetPos.x - robotPos.x;
            const dz = targetPos.z - robotPos.z;
            const angleToBall = Math.atan2(-dz, dx);
            headingErr = RobotKinematics.normalizeAngle(angleToBall - robotHeading);
          }

          if (Math.abs(headingErr) > 0.20) {
            this.stateMachine.transitionTo(
              AUTONOMOUS_STATES.ALIGNING_FOR_INTAKE,
              `Within capture zone (${distToBall.toFixed(2)}m). Aligning chassis heading for intake`
            );
          } else {
            this.robot.startIntake();
            this.stateMachine.transitionTo(
              AUTONOMOUS_STATES.COLLECTING_BALL,
              `Within capture zone (${distToBall.toFixed(2)}m) and aligned. Engaging intake rollers for collection`
            );
          }
          return;
        }

        // Navigation failure handling
        if (navState === 'BLOCKED') {
          this.targetSelectionStatus = 'REPLANNING';
          this.triggerRecovery(FAILURE_CATEGORIES.PATH_BLOCKED, 'Path to target basketball is blocked by obstacle');
          return;
        }

        // Timeout fallback for ball navigation
        if (timeInState >= 15.0) {
          if (distToBall <= 1.2) {
            this.robot.navController?.cancel('Navigation timeout near ball: proceeding to intake');
            this.stateMachine.transitionTo(
              AUTONOMOUS_STATES.ALIGNING_FOR_INTAKE,
              `Navigation timed out near ball (${distToBall.toFixed(2)}m). Aligning for collection crawl`
            );
            return;
          }
          this.robot.navController?.cancel('Navigation timeout exceeded');
          this.triggerRecovery(FAILURE_CATEGORIES.NAVIGATION_TIMEOUT, `Navigation to ball timed out after ${timeInState.toFixed(1)}s`);
          return;
        }

        this.targetSelectionStatus = 'NAVIGATING';

        // Dynamic re-planning: if target ball moved significantly (> 0.6m), update path to new approach waypoint
        const currentObs = this.visionManager?.getSelectedBasketball();
        if (currentObs && targetPos) {
          const isSameTarget = (currentObs.id === this.currentTarget.id) ||
                               (currentObs.instanceId && this.currentTarget.track?.instanceId && currentObs.instanceId === this.currentTarget.track.instanceId);
          if (isSameTarget) {
            const shift = Math.hypot(currentObs.worldPosition.x - targetPos.x, currentObs.worldPosition.z - targetPos.z);
            if (shift > 0.6) {
              this.currentTarget.worldPosition = { ...currentObs.worldPosition };
              const newAppPos = this.decisionEngine.calculateApproachPosition(currentObs.worldPosition, robotPos);
              this.currentTarget.approachPosition = newAppPos;
              this.robot.startAutonomousNavigation(newAppPos.x, newAppPos.z);
              this.lastNavigationCommandTimestamp = Date.now();
              this.logThrottled('DYNAMIC_REPLAN', `Target ball shifted by ${shift.toFixed(2)}m. Replanned approach to (${newAppPos.x.toFixed(1)}, ${newAppPos.z.toFixed(1)})`);
            }
          }
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 4. ALIGNING_FOR_INTAKE: Direct front scoop toward ball before intaking
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.ALIGNING_FOR_INTAKE: {
        const robotPos = this.robot.getPosition();
        const robotHeading = this.robot.getHeading();
        const targetPos = this.currentTarget?.worldPosition;

        let headingErr = 0.0;
        if (targetPos) {
          const dx = targetPos.x - robotPos.x;
          const dz = targetPos.z - robotPos.z;
          const angleToBall = Math.atan2(-dz, dx);
          headingErr = RobotKinematics.normalizeAngle(angleToBall - robotHeading);
        }

        // Rotate in place until aligned within ~0.15 rad (8.5 degrees)
        if (Math.abs(headingErr) > 0.15 && timeInState < 1.2) {
          const yawCmd = Math.max(-1.5, Math.min(1.5, headingErr * 3.0));
          this.setRobotDriveVelocities(0.0, yawCmd);
        } else {
          this.robot.driveController.stop();
          this.robot.startIntake();
          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.COLLECTING_BALL,
            'Aligned with ball. Engaging intake rollers and commencing collection crawl'
          );
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 5. COLLECTING_BALL: Crawl forward with intake rollers until possession confirmed
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.COLLECTING_BALL: {
        const possession = this.decisionEngine.evaluatePossession(this.robot);

        if (possession.hasBall) {
          this.robot.driveController.stop();
          this.robot.stopIntake();
          this.retries.collection = 0;
          this.consecutiveFailures = 0;
          this.lastSuccessfulOperation = 'BALL_COLLECTED';

          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.VERIFYING_POSSESSION,
            'Ball entry detected in intake scoop. Verifying cradle possession'
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
          this.triggerRecovery(FAILURE_CATEGORIES.INTAKE_FAILED, `Collection timed out after ${timeInState.toFixed(1)}s without ball capture`);
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 6 & 7. VERIFYING_POSSESSION / SELECTING_SHOT / SEARCHING_FOR_HOOP
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.VERIFYING_POSSESSION:
      case AUTONOMOUS_STATES.SELECTING_SHOT:
      case AUTONOMOUS_STATES.SEARCHING_FOR_HOOP: {
        this.robot.driveController.stop();
        this.robot.stopIntake();

        const possession = this.decisionEngine.evaluatePossession(this.robot);
        if (possession.hasBall) {
          if (!this.currentTarget && this.robot.intake?.capturedBall) {
            this.currentTarget = {
              id: this.robot.intake.capturedBall.id,
              distance: 0.0,
              confidence: 1.0,
              worldPosition: this.robot.getPosition()
            };
          }
          this.activeBallReference = this.robot.intake?.capturedBall || this.activeBallReference || this.basketball;
          this.lastSuccessfulOperation = 'POSSESSION_VERIFIED';
        } else if (timeInState >= 0.8) {
          this.triggerRecovery(FAILURE_CATEGORIES.POSSESSION_VERIFICATION_FAILED, 'Ball not confirmed in containment cradle');
          return;
        }

        const hoopObs = this.visionManager?.getHoopObservation();
        if (hoopObs && hoopObs.visible && hoopObs.confidence >= this.config.minHoopConfidence) {
          const hoopTarget = hoopObs.targetRimPosition || { x: 12.425, y: 3.05, z: 0.0 };

          // Evaluate whether a feasible shot can be taken directly from current position!
          const feasibility = this.decisionEngine.evaluateShootingFeasibility(
            this.robot,
            this.robot.trajectoryCalculator,
            hoopTarget
          );

          if (feasibility.isFeasible && feasibility.solution) {
            // SHOOT DIRECTLY FROM CURRENT LOCATION! No unnecessary navigation!
            this.activeTrajectorySolution = feasibility.solution;
            this.targetShootingPos = {
              x: this.robot.getPosition().x,
              z: this.robot.getPosition().z,
              hoopTarget,
              targetDistance: feasibility.solution.targetDistance
            };

            this.consecutiveFailures = 0;
            this.lastSuccessfulOperation = 'DYNAMIC_SHOT_SELECTED';

            this.stateMachine.transitionTo(
              AUTONOMOUS_STATES.ALIGNING_WITH_HOOP,
              `Feasible shot from current position (${feasibility.reason}). Aligning shooter toward hoop`
            );
            return;
          }

          // Current location is infeasible (e.g. too far downcourt, out of bounds, or behind backboard)
          // Adjust position dynamically to a nearby feasible shooting position
          const fallbackPos = feasibility.candidatePosition || { x: 8.2, z: 0.0 };
          this.targetShootingPos = {
            x: fallbackPos.x,
            z: fallbackPos.z,
            hoopTarget,
            targetDistance: Math.hypot(hoopTarget.x - fallbackPos.x, hoopTarget.z - fallbackPos.z)
          };
          this._navShootingStarted = false;

          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.NAVIGATING_TO_SHOOTING_POSITION,
            `Position infeasible (${feasibility.reason}). Navigating to optimal shooting spot (${fallbackPos.x.toFixed(1)}, ${fallbackPos.z.toFixed(1)})`
          );
          return;
        }

        // Rotate toward East baseline hoop direction (+X baseline)
        this.setRobotDriveVelocities(0.0, this.config.searchRotateSpeed);

        if (timeInState >= this.config.searchHoopTimeout) {
          this.robot.driveController.stop();
          this._navShootingStarted = false;
          const fallbackPos = { x: 8.2, z: 0.0 };
          this.targetShootingPos = {
            x: fallbackPos.x,
            z: fallbackPos.z,
            hoopTarget: { x: 12.425, y: 3.05, z: 0.0 },
            targetDistance: 4.225
          };
          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.NAVIGATING_TO_SHOOTING_POSITION,
            'Hoop search timed out: driving to default Free-Throw Key position'
          );
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 8. POSITIONING_FOR_SHOT_IF_NEEDED / NAVIGATING_TO_SHOOTING_POSITION
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.POSITIONING_FOR_SHOT_IF_NEEDED:
      case AUTONOMOUS_STATES.NAVIGATING_TO_SHOOTING_POSITION: {
        if (!this._navShootingStarted) {
          this._navShootingStarted = true;
          const targetX = this.targetShootingPos?.x ?? 8.2;
          const targetZ = this.targetShootingPos?.z ?? 0.0;
          this.robot.startAutonomousNavigation(targetX, targetZ);
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
          this.consecutiveFailures = 0;
          this.lastSuccessfulOperation = 'POSITIONING_COMPLETED';

          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.ALIGNING_WITH_HOOP,
            `Arrived at shooting position (${this.targetShootingPos.x.toFixed(1)}, ${this.targetShootingPos.z.toFixed(1)}). Aligning with basket`
          );
          return;
        }

        if (navState === 'BLOCKED') {
          // If blocked but within broad range (3.0m - 7.5m), attempt to shoot from current spot
          const hoopX = this.targetShootingPos?.hoopTarget?.x || 12.425;
          const distToHoop = Math.hypot(hoopX - robotPos.x, -robotPos.z);
          if (distToHoop >= 2.5 && distToHoop <= 8.5 && robotPos.x <= 11.2) {
            this._navShootingStarted = false;
            this.robot.navController.cancel();
            this.robot.driveController.stop();
            this.stateMachine.transitionTo(
              AUTONOMOUS_STATES.ALIGNING_WITH_HOOP,
              `Navigation blocked but in shooting range (${distToHoop.toFixed(1)}m): proceeding to align`
            );
            return;
          }
          this._navShootingStarted = false;
          this.triggerRecovery(FAILURE_CATEGORIES.PATH_BLOCKED, 'Path to shooting position is obstructed');
          return;
        }

        if (timeInState >= 15.0) {
          this._navShootingStarted = false;
          this.robot.navController.cancel();
          this.robot.driveController.stop();
          const hoopX = this.targetShootingPos?.hoopTarget?.x || 12.425;
          const distToHoop = Math.hypot(hoopX - robotPos.x, -robotPos.z);
          if (distToHoop >= 2.5 && distToHoop <= 8.5 && robotPos.x <= 11.2) {
            this.stateMachine.transitionTo(
              AUTONOMOUS_STATES.ALIGNING_WITH_HOOP,
              `Navigation timed out but in shooting range (${distToHoop.toFixed(1)}m): proceeding to align`
            );
            return;
          }
          this.triggerRecovery(FAILURE_CATEGORIES.NAVIGATION_TIMEOUT, `Navigation to shooting position timed out after ${timeInState.toFixed(1)}s`);
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 9. ALIGNING_WITH_HOOP: Direction-independent precision heading alignment
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
          this.consecutiveFailures = 0;
          this.lastSuccessfulOperation = 'HEADING_ALIGNED';

          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.CALCULATING_SHOT,
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
      // 10. CALCULATING_SHOT / OPTIMIZING_TRAJECTORY: Ballistic solver + adaptive feedback
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.CALCULATING_SHOT:
      case AUTONOMOUS_STATES.OPTIMIZING_TRAJECTORY: {
        const muzzlePos = this.getMuzzlePosition();
        const hoopTarget = this.targetShootingPos?.hoopTarget || { x: 12.425, y: 3.05, z: 0.0 };

        const opt = this.robot.trajectoryCalculator.optimizeTrajectory(muzzlePos, hoopTarget, {
          minAngleDeg: 46.0,
          maxAngleDeg: 68.0,
          angleStepDeg: 1.0,
          minEntryAngleDeg: 32.0,
          maxApexHeight: 7.2
        });

        if (!opt.valid || !opt.solution) {
          this.triggerRecovery(FAILURE_CATEGORIES.SHOT_SOLUTION_UNAVAILABLE, opt.message || 'No physically valid trajectory found');
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
          `Trajectory calculated: ${this.activeTrajectorySolution.launchAngleDeg.toFixed(1)}° at ${this.activeTrajectorySolution.speed.toFixed(2)} m/s. Accelerating flywheels`
        );
        break;
      }

      // ---------------------------------------------------------------------
      // 11. SPINNING_UP_FLYWHEELS: Accelerate dual flywheels to target speed
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.SPINNING_UP_FLYWHEELS: {
        if (!this.activeTrajectorySolution) {
          this.stateMachine.transitionTo(AUTONOMOUS_STATES.CALCULATING_SHOT, 'Trajectory missing: recalculating');
          return;
        }

        // Spin up flywheels to required launch speed
        this.robot.shooter?.spinUp(this.activeTrajectorySolution.speed);

        if (this.robot.shooter?.state === 'READY') {
          const interlocks = this.decisionEngine.evaluateShootingInterlocks(this.robot, this.visionManager?.getHoopObservation());
          if (interlocks.isReady) {
            this.retries.spinUp = 0;
            this.consecutiveFailures = 0;
            this.lastSuccessfulOperation = 'FLYWHEELS_READY';

            this.stateMachine.transitionTo(
              AUTONOMOUS_STATES.EXECUTING_SHOT,
              'Flywheels at operational RPM. All interlocks verified. Executing shot'
            );
          } else {
            this.triggerRecovery('INTERLOCK_FAILED', `Interlock check failed: ${interlocks.blockers.join(', ')}`);
          }
          return;
        }

        if (timeInState >= this.config.spinUpTimeout) {
          this.robot.shooter?.cancel();
          this.triggerRecovery(FAILURE_CATEGORIES.SHOOTING_EXECUTION_FAILED, `Flywheel spin-up timed out after ${timeInState.toFixed(1)}s`);
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 12. EXECUTING_SHOT / SHOOTING: Fire basketball into Rapier 3D physics
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.EXECUTING_SHOT:
      case AUTONOMOUS_STATES.SHOOTING: {
        const hoopTarget = this.targetShootingPos?.hoopTarget || { x: 12.425, y: 3.05, z: 0.0 };

        const ballToShoot = (this.robot.intake && this.robot.intake.capturedBall)
          ? this.robot.intake.capturedBall
          : (this.activeBallReference || this.basketball);

        const shotInfo = {
          id: Date.now(),
          ball: ballToShoot,
          distance: this.activeTrajectorySolution ? this.activeTrajectorySolution.targetDistance : 4.225,
          launchSpeed: this.activeTrajectorySolution ? this.activeTrajectorySolution.speed : 8.5,
          launchAngleDeg: this.activeTrajectorySolution ? this.activeTrajectorySolution.launchAngleDeg : 52.0
        };

        const fired = this.robot.fireShot(ballToShoot, this.hoopDetector, hoopTarget);

        if (fired) {
          this.statistics.totalAttempts++;
          this._shotOutcomeRecorded = false;
          this._lastEvaluatedShotId = shotInfo.id;
          this.activeBallReference = ballToShoot;
          this.consecutiveFailures = 0;
          this.lastSuccessfulOperation = 'SHOT_LAUNCHED';

          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.TRACKING_SHOT,
            `Shot #${this.statistics.totalAttempts} launched into ballistic flight. Tracking shot trajectory`
          );
        } else {
          this.triggerRecovery(FAILURE_CATEGORIES.SHOOTING_EXECUTION_FAILED, `Shooter rejected launch: ${this.robot.shooter?.lastRejectReason || 'interlock violation'}`);
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 13. TRACKING_SHOT / WAITING_FOR_BALL_TO_LAND / EVALUATING_SHOT
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.TRACKING_SHOT:
      case AUTONOMOUS_STATES.WAITING_FOR_BALL_TO_LAND:
      case AUTONOMOUS_STATES.EVALUATING_SHOT: {
        const shotStats = this.hoopDetector?.stats;
        const lastResult = shotStats?.lastShotResult; // 'SCORED', 'MISSED', 'IN_FLIGHT'

        // Record shot score/miss exactly once
        if ((lastResult === 'SCORED' || lastResult === 'MISSED' || (shotStats?.lastDetailedResult && shotStats.lastDetailedResult.startsWith('MISSED_'))) && !this._shotOutcomeRecorded) {
          this._shotOutcomeRecorded = true;
          if (lastResult === 'SCORED') {
            this.statistics.successfulShots++;
            this.lastSuccessfulOperation = 'BASKET_SCORED';
          } else {
            this.statistics.missedShots++;
          }
          this.updateAccuracy();

          const details = this.hoopDetector?.lastShotDetails;
          const corrector = this.robot.adaptiveCorrector || this.robot.adaptiveShotCorrector;
          if (details && corrector) {
            if (typeof corrector.recordShotOutcome === 'function') {
              corrector.recordShotOutcome(details);
            } else if (typeof corrector.recordOutcome === 'function') {
              corrector.recordOutcome(details);
            }
          }

          // Mission completion check for FIXED_TARGET mode
          if (this.mode === GAMEPLAY_MODES.FIXED_TARGET) {
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
              return;
            }
          }

          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.REACQUIRING_BALL,
            lastResult === 'SCORED'
              ? `BASKET SCORED! Total: ${this.statistics.successfulShots}. Reacquiring basketball`
              : `Shot missed (${shotStats?.lastDetailedResult || 'MISSED'}). Adaptive bias calibrated. Reacquiring ball`
          );
          return;
        }

        // Timeout fallback if ball did not resolve within shotEvaluationTimeout
        if (timeInState >= this.config.shotEvaluationTimeout) {
          if (!this._shotOutcomeRecorded) {
            this._shotOutcomeRecorded = true;
            this.statistics.missedShots++;
            this.updateAccuracy();
          }
          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.REACQUIRING_BALL,
            'Shot evaluation timed out. Reacquiring ball'
          );
        }
        break;
      }

      // ---------------------------------------------------------------------
      // 14. REACQUIRING_BALL / RETURNING_TO_SEARCHING: Continuous loop reacquisition
      // ---------------------------------------------------------------------
      case AUTONOMOUS_STATES.REACQUIRING_BALL: {
        this.robot.stopIntake();
        if (this.robot.shooter) this.robot.shooter.cancel();

        if (timeInState >= (this.config.reacquireCooldown || 1.0)) {
          // Check if the landed basketball is immediately visible to camera
          const target = this.decisionEngine.selectBestBasketballTarget(this.visionManager, this.robot);
          if (target) {
            this.currentTarget = target;
            this.activeBallReference = target.track?.reference || this.activeBallReference || this.basketball;
            this.consecutiveFailures = 0;
            this.lastSuccessfulOperation = 'BALL_REACQUIRED';

            this.stateMachine.transitionTo(
              AUTONOMOUS_STATES.SELECTING_TARGET,
              `Reacquired basketball (${target.id} at ${target.distance.toFixed(1)}m). Preparing approach`
            );
            return;
          }

          this.currentTarget = null;
          this.targetShootingPos = null;
          this.activeTrajectorySolution = null;

          this.stateMachine.transitionTo(
            AUTONOMOUS_STATES.SEARCHING_FOR_BALL,
            'Continuous gameplay: scanning court to reacquire basketball'
          );
        }
        break;
      }

      // ---------------------------------------------------------------------
      // RECOVERING: Non-fatal failure recovery maneuver
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
        } else if (action === 'REPOSITION_CENTER_VIEW') {
          // Drive toward center court (0, 0) for broad full-court survey
          if (timeInState < 1.5) {
            this.robot.startAutonomousNavigation(0.0, 0.0);
          } else {
            this.robot.driveController.stop();
            this.retries.ballSearch = 0;
            this.stateMachine.transitionTo(AUTONOMOUS_STATES.SEARCHING_FOR_BALL, 'Repositioned: resuming visual sweep');
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
  triggerRecovery(reason, details = '') {
    this.statistics.recoveryAttempts++;
    this.consecutiveFailures++;

    this.lastFailureCategory = reason;
    this.lastFailureReason = details || reason;

    let categoryRetries = 0;
    if (reason === 'COLLECTION_FAILED' || reason === 'INTAKE_TIMEOUT' || reason === FAILURE_CATEGORIES.INTAKE_FAILED) {
      this.retries.collection++;
      categoryRetries = this.retries.collection;
    } else if (reason === 'NAV_BLOCKED' || reason === 'PATH_PLANNING_FAILED' || reason === FAILURE_CATEGORIES.PATH_BLOCKED) {
      this.retries.navigation++;
      categoryRetries = this.retries.navigation;
    } else if (reason === 'ALIGNMENT_TIMEOUT') {
      this.retries.alignment++;
      categoryRetries = this.retries.alignment;
    } else if (reason === 'SPINUP_TIMEOUT') {
      this.retries.spinUp++;
      categoryRetries = this.retries.spinUp;
    } else if (reason === 'BALL_NOT_DETECTED' || reason === 'BALL_LOST' || reason === FAILURE_CATEGORIES.BALL_NOT_DETECTED) {
      this.retries.ballSearch++;
      categoryRetries = this.retries.ballSearch;
    } else {
      categoryRetries = 1;
    }

    const decision = this.decisionEngine.evaluateRecoveryAction(reason, {
      retries: categoryRetries,
      consecutiveFailures: this.consecutiveFailures,
      totalRecoveries: this.mode === GAMEPLAY_MODES.FIXED_TARGET ? this.statistics.recoveryAttempts : undefined,
      message: details
    });

    this.recoveryContext = decision;
    this.currentRecoveryAction = decision.action;

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
   * Diagnostic telemetry providing deep visibility into the perception-to-action pipeline.
   * Explains exactly why the robot is moving or stationary (Phase 3 requirements).
   * @returns {Object}
   */
  getDiagnostics() {
    const rPos = this.robot ? this.robot.getPosition() : { x: 0, y: 0, z: 0 };
    const rPose = this.robot && typeof this.robot.getPose === 'function'
      ? this.robot.getPose()
      : { x: rPos.x, z: rPos.z, heading: this.robot?.getHeading ? this.robot.getHeading() : 0 };
    const navTele = this.robot?.navController?.getTelemetry ? this.robot.navController.getTelemetry(rPose) : null;
    const trackedTrack = this.visionManager?.getSelectedBasketball ? this.visionManager.getSelectedBasketball() : null;
    const rawBallsCount = this.visionManager?.latestRawBallDetections?.length ?? 0;
    const targetDiag = this.decisionEngine?.getTargetSelectionDiagnostics ? this.decisionEngine.getTargetSelectionDiagnostics() : null;

    const ballPos = this.currentTarget?.worldPosition || trackedTrack?.worldPosition || null;
    const ballConf = this.currentTarget?.confidence ?? trackedTrack?.confidence ?? null;
    const ballAge = trackedTrack?.detectionAge ?? trackedTrack?.timeSinceLastSeen ?? 0;

    return {
      detectedBalls: rawBallsCount,
      trackedBallId: trackedTrack ? trackedTrack.id : null,
      ballTrackingConfidence: ballConf,
      ballDetectionAge: ballAge,
      ballWorldPosition: ballPos ? { ...ballPos } : null,
      robotWorldPosition: { x: Number(rPos.x.toFixed(2)), y: Number(rPos.y.toFixed(2)), z: Number(rPos.z.toFixed(2)) },
      selectedTargetBallId: this.currentTarget ? this.currentTarget.id : null,
      targetSelectionStatus: this.targetSelectionStatus,
      targetRejectionReason: this.targetRejectionReason,
      autonomousState: this.stateMachine.getState(),
      navigationState: navTele?.state || 'IDLE',
      navigationTargetCoordinates: navTele?.destination || null,
      navigationActive: navTele?.isActive ?? false,
      navigationCancellationReason: navTele?.cancellationReason ?? null,
      lastNavigationCommandTimestamp: this.lastNavigationCommandTimestamp,
      lastTargetDiagnostics: targetDiag
    };
  }

  /**
   * Provides real-time state machine status, telemetry, metrics, and diagnostics.
   */
  getStatus() {
    const sm = this.stateMachine;
    const possession = this.decisionEngine.evaluatePossession(this.robot);
    const hoopObs = this.visionManager?.getHoopObservation();
    const remainingShots = this.mode === GAMEPLAY_MODES.FIXED_TARGET
      ? Math.max(0, this.targetShots - this.statistics.successfulShots)
      : 0;

    return {
      state: sm.getState(),
      isActive: sm.isActive,
      isPaused: sm.isPaused(),
      isTerminal: sm.isTerminal(),
      timeInState: sm.getTimeInState(),
      statusMessage: typeof sm.getStatusMessage === 'function' ? sm.getStatusMessage() : (sm.statusMessage || ''),
      mode: this.mode,
      targetShots: this.targetShots,
      remainingShots,
      lastFailureCategory: this.lastFailureCategory,
      lastFailureReason: this.lastFailureReason,
      currentRecoveryAction: this.currentRecoveryAction,
      lastSuccessfulOperation: this.lastSuccessfulOperation,
      consecutiveFailures: this.consecutiveFailures,
      retries: { ...this.retries },
      targetSelectionStatus: this.targetSelectionStatus,
      targetRejectionReason: this.targetRejectionReason,
      diagnostics: this.getDiagnostics(),
      statistics: {
        ...this.statistics,
        accuracyPercent: parseFloat(this.statistics.accuracyPercent.toFixed(1)),
        sessionDuration: this.statistics.startTime
          ? parseFloat(((Date.now() - this.statistics.startTime) / 1000).toFixed(1))
          : 0.0
      },
      target: this.currentTarget ? {
        id: this.currentTarget.id,
        distance: this.currentTarget.distance ? parseFloat(this.currentTarget.distance.toFixed(2)) : 0.0,
        bearingDeg: this.currentTarget.azimuthDeg,
        confidence: this.currentTarget.confidence,
        worldPosition: this.currentTarget.worldPosition ? { ...this.currentTarget.worldPosition } : null
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
      },
      shootingPosition: this.targetShootingPos ? {
        x: parseFloat(this.targetShootingPos.x.toFixed(2)),
        z: parseFloat(this.targetShootingPos.z.toFixed(2)),
        distanceToHoop: this.targetShootingPos.targetDistance
          ? parseFloat(this.targetShootingPos.targetDistance.toFixed(2))
          : 0.0
      } : null,
      activeTrajectory: this.activeTrajectorySolution ? {
        speed: parseFloat(this.activeTrajectorySolution.speed.toFixed(2)),
        launchAngleDeg: parseFloat(this.activeTrajectorySolution.launchAngleDeg.toFixed(1)),
        targetDistance: parseFloat(this.activeTrajectorySolution.targetDistance.toFixed(2))
      } : null
    };
  }

  /**
   * Whether the autonomous intelligence system is currently executing gameplay.
   */
  get isActive() {
    return this.stateMachine.isActive;
  }
}
