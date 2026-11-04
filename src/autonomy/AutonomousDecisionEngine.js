/**
 * AutonomousDecisionEngine.js
 * High-level cognitive decision engine for SMART-BASKETBOT.
 * Evaluates vision observations, possession state, navigation geometry,
 * shooter readiness, dynamic shooting feasibility, and historical outcomes
 * to generate optimal autonomous actions for continuous basketball gameplay.
 */

import { AUTONOMOUS_CONFIG, FAILURE_CATEGORIES, GAMEPLAY_MODES } from './AutonomousConfig.js';
import { RobotKinematics } from '../robot/RobotKinematics.js';

export class AutonomousDecisionEngine {
  /**
   * @param {Object} [config] Custom overrides for AUTONOMOUS_CONFIG
   */
  constructor(config = {}) {
    this.config = { ...AUTONOMOUS_CONFIG, ...config };
    this.lastTargetSelectionDiagnostics = {
      timestamp: Date.now(),
      candidateCount: 0,
      candidates: [],
      selectedTargetId: null,
      selectionStatus: 'NONE_DETECTED',
      primaryRejectionReason: 'NONE'
    };
  }

  /**
   * Calculates a safe approach waypoint offset in front of the ball target toward the robot.
   * Clamps the approach coordinates within court boundaries.
   *
   * @param {{ x: number, z: number }} targetWorldPos Ball world position
   * @param {{ x: number, z: number }} robotPos Robot world position
   * @returns {{ x: number, z: number }}
   */
  calculateApproachPosition(targetWorldPos, robotPos) {
    const targetX = Number.isFinite(targetWorldPos.x) ? targetWorldPos.x : 0;
    const targetZ = Number.isFinite(targetWorldPos.z) ? targetWorldPos.z : 0;
    const rX = Number.isFinite(robotPos.x) ? robotPos.x : 0;
    const rZ = Number.isFinite(robotPos.z) ? robotPos.z : 0;

    const dx = targetX - rX;
    const dz = targetZ - rZ;
    const totalDist = Math.hypot(dx, dz);

    let approachX = targetX;
    let approachZ = targetZ;
    const offset = this.config.ballApproachOffset ?? 0.45;

    if (totalDist > offset) {
      const unitX = dx / totalDist;
      const unitZ = dz / totalDist;
      approachX = targetX - unitX * offset;
      approachZ = targetZ - unitZ * offset;
    }

    // Safely clamp approach position inside traversable court bounds with safety margin
    approachX = Math.max(-13.8, Math.min(13.8, approachX));
    approachZ = Math.max(-6.8, Math.min(6.8, approachZ));

    return { x: approachX, z: approachZ };
  }

  /**
   * Evaluates all tracked basketballs from VisionManager and selects the optimal target.
   * Ensures the same physical basketball can be reacquired repeatedly after shooting
   * without permanent blacklisting. Implements target-lock hysteresis and comprehensive
   * perception-to-action diagnostic reporting.
   *
   * @param {import('../vision/VisionManager.js').VisionManager} visionManager
   * @param {import('../robot/Robot.js').Robot} robot
   * @param {Object} [currentTarget=null] Currently locked target for hysteresis
   * @returns {Object|null} Selected target descriptor or null if no valid target
   */
  selectBestBasketballTarget(visionManager, robot, currentTarget = null) {
    if (!visionManager || !robot) {
      this.lastTargetSelectionDiagnostics = {
        timestamp: Date.now(),
        candidateCount: 0,
        candidates: [],
        selectedTargetId: null,
        selectionStatus: 'TARGET_REJECTED',
        primaryRejectionReason: 'ROBOT_OR_VISION_MISSING'
      };
      return null;
    }

    const tracks = visionManager.getTrackedBasketballs ? visionManager.getTrackedBasketballs() : [];
    if (!tracks || tracks.length === 0) {
      this.lastTargetSelectionDiagnostics = {
        timestamp: Date.now(),
        candidateCount: 0,
        candidates: [],
        selectedTargetId: null,
        selectionStatus: 'NONE_DETECTED',
        primaryRejectionReason: 'NO_BALL_TRACKS'
      };
      return null;
    }

    const robotPos = robot.getPosition();
    const robotHeading = robot.getHeading();

    let bestTrack = null;
    let highestScore = -Infinity;
    const candidateEvals = [];
    let primaryRejectionReason = null;

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      let eligible = true;
      let rejectionReason = null;

      // Coordinate validity check
      const wx = track.worldPosition?.x;
      const wz = track.worldPosition?.z;
      if (!Number.isFinite(wx) || !Number.isFinite(wz)) {
        eligible = false;
        rejectionReason = 'INVALID_COORDINATES';
      }

      // Court bounds check
      if (eligible && (Math.abs(wx) > 14.5 || Math.abs(wz) > 7.5)) {
        eligible = false;
        rejectionReason = 'OUT_OF_BOUNDS';
      }

      // Hysteresis confidence threshold: if currently locked to this track, use retention threshold
      const isLockedTarget = currentTarget && (
        track.id === currentTarget.id ||
        (track.instanceId && currentTarget.track?.instanceId && track.instanceId === currentTarget.track.instanceId)
      );
      const minConfidence = isLockedTarget
        ? (this.config.minBallConfidence * 0.75)
        : this.config.minBallConfidence;

      if (eligible && track.confidence < minConfidence) {
        eligible = false;
        rejectionReason = 'LOW_CONFIDENCE';
      }

      // Track freshness / grace period check
      if (eligible && track.status === 'LOST' && track.timeSinceLastSeen > this.config.lostBallGracePeriod) {
        eligible = false;
        rejectionReason = 'LOST_TIMEOUT';
      }

      // Collectibility and lifecycle checks
      if (eligible && track.reference) {
        const ref = track.reference;
        if (ref.isPossessed || ref.state === 'POSSESSED') {
          eligible = false;
          rejectionReason = 'POSSESSED';
        } else if (ref.state === 'BEING_COLLECTED') {
          eligible = false;
          rejectionReason = 'BEING_COLLECTED';
        } else if (ref.shotCooldownTimer && ref.shotCooldownTimer > 0) {
          eligible = false;
          rejectionReason = 'SHOT_COOLDOWN';
        } else {
          const ballY = (typeof ref.getPosition === 'function')
            ? ref.getPosition().y
            : track.worldPosition.y;
          if (ballY > 0.35 && ref.state === 'IN_FLIGHT') {
            eligible = false;
            rejectionReason = 'IN_FLIGHT';
          }
        }
      }

      let totalScore = -Infinity;
      if (eligible) {
        // Distance scoring: closer targets score higher (normalized 0..1 over 18m)
        const dist = track.distance ?? Math.hypot(wx - robotPos.x, wz - robotPos.z);
        const distScore = Math.max(0.0, 1.0 - (dist / 18.0));

        // Heading alignment scoring: targets directly ahead score higher
        const dx = wx - robotPos.x;
        const dz = wz - robotPos.z;
        const angleToTarget = Math.atan2(-dz, dx);
        const headingDiff = RobotKinematics.normalizeAngle(angleToTarget - robotHeading);
        const alignScore = Math.max(0.0, Math.cos(headingDiff));

        // Track quality & freshness
        const confScore = track.confidence ?? 0.5;
        const freshnessScore = track.isVisible ? 1.0 : Math.max(0.2, 1.0 - track.timeSinceLastSeen);

        // Hysteresis lock bonus to prevent target thrashing
        const lockBonus = isLockedTarget ? 0.15 : 0.0;

        // Composite multi-factor utility score
        totalScore = (distScore * 0.40) + (alignScore * 0.30) + (confScore * 0.15) + (freshnessScore * 0.15) + lockBonus;

        if (totalScore > highestScore) {
          highestScore = totalScore;
          bestTrack = track;
        }
      } else if (!primaryRejectionReason) {
        primaryRejectionReason = rejectionReason;
      }

      candidateEvals.push({
        id: track.id,
        confidence: track.confidence,
        distance: track.distance,
        worldPosition: { ...track.worldPosition },
        detectionAge: track.timeSinceLastSeen ?? 0,
        eligible,
        rejectionReason,
        score: eligible ? totalScore : null
      });
    }

    this.lastTargetSelectionDiagnostics = {
      timestamp: Date.now(),
      candidateCount: tracks.length,
      candidates: candidateEvals,
      selectedTargetId: bestTrack ? bestTrack.id : null,
      selectionStatus: bestTrack ? 'SELECTED' : 'TARGET_REJECTED',
      primaryRejectionReason: bestTrack ? 'NONE' : (primaryRejectionReason || 'NO_ELIGIBLE_TARGETS')
    };

    if (!bestTrack) return null;

    const approachPos = this.calculateApproachPosition(bestTrack.worldPosition, robotPos);

    return {
      id: bestTrack.id,
      track: bestTrack,
      worldPosition: { x: bestTrack.worldPosition.x, y: bestTrack.worldPosition.y, z: bestTrack.worldPosition.z },
      approachPosition: approachPos,
      distance: bestTrack.distance,
      azimuthDeg: bestTrack.azimuthDeg,
      confidence: bestTrack.confidence,
      score: highestScore
    };
  }

  /**
   * Returns a copy of the latest target selection diagnostic report.
   * @returns {Object}
   */
  getTargetSelectionDiagnostics() {
    return { ...this.lastTargetSelectionDiagnostics };
  }

  /**
   * Evaluates whether a feasible shot can be taken directly from the robot's current position,
   * eliminating the need to drive back to a fixed shooting waypoint.
   *
   * @param {import('../robot/Robot.js').Robot} robot
   * @param {import('../robot/TrajectoryCalculator.js').TrajectoryCalculator} trajectoryCalculator
   * @param {{ x: number, y: number, z: number }} [hoopTarget]
   * @returns {{ isFeasible: boolean, reason: string, candidatePosition: { x: number, z: number }, solution: Object|null }}
   */
  evaluateShootingFeasibility(robot, trajectoryCalculator, hoopTarget = null) {
    const target = hoopTarget || { x: 12.425, y: 3.05, z: 0.0 };
    const robotPos = robot.getPosition();

    const dx = target.x - robotPos.x;
    const dz = target.z - robotPos.z;
    const distanceToHoop = Math.hypot(dx, dz);

    // Physical constraint 1: Cannot shoot from behind backboard plane or directly under rim
    // East rim is at X = 12.425. If robot X > 11.2, trajectory is obstructed by backboard.
    if (robotPos.x > 11.2) {
      return {
        isFeasible: false,
        reason: `Robot position is too close or behind backboard (X = ${robotPos.x.toFixed(1)}m > 11.2m)`,
        candidatePosition: this.calculateFallbackShootingPosition(robotPos, target, 4.225),
        solution: null
      };
    }

    // Physical constraint 2: Launcher physical distance envelope
    const minRange = this.config.minFeasibleShotDistance ?? 2.2;
    const maxRange = this.config.maxFeasibleShotDistance ?? 9.0;

    if (distanceToHoop < minRange) {
      return {
        isFeasible: false,
        reason: `Too close to hoop (${distanceToHoop.toFixed(1)}m < ${minRange}m minimum)`,
        candidatePosition: this.calculateFallbackShootingPosition(robotPos, target, 4.225),
        solution: null
      };
    }
    if (distanceToHoop > maxRange) {
      return {
        isFeasible: false,
        reason: `Too far from hoop (${distanceToHoop.toFixed(1)}m > ${maxRange}m maximum launcher range)`,
        candidatePosition: this.calculateFallbackShootingPosition(robotPos, target, 4.225),
        solution: null
      };
    }

    // Physical constraint 3: Inside playable court boundaries
    if (Math.abs(robotPos.z) > 7.0 || robotPos.x < -12.0) {
      return {
        isFeasible: false,
        reason: `Robot outside playable court bounds (${robotPos.x.toFixed(1)}, ${robotPos.z.toFixed(1)})`,
        candidatePosition: this.calculateFallbackShootingPosition(robotPos, target, 4.225),
        solution: null
      };
    }

    // Physical constraint 4: Trajectory optimization validation
    const nominalHeading = Math.atan2(-dz, dx);
    const muzzleLocal = robot.shooter?.muzzleLocalPos || { x: 0.54, y: 0.45, z: 0.0 };
    const cosH = Math.cos(nominalHeading);
    const sinH = Math.sin(nominalHeading);

    const muzzlePos = {
      x: robotPos.x + cosH * muzzleLocal.x - sinH * (muzzleLocal.z || 0.0),
      y: robotPos.y + muzzleLocal.y,
      z: robotPos.z - sinH * muzzleLocal.x - cosH * (muzzleLocal.z || 0.0)
    };

    if (trajectoryCalculator && typeof trajectoryCalculator.optimizeTrajectory === 'function') {
      const opt = trajectoryCalculator.optimizeTrajectory(muzzlePos, target, {
        minAngleDeg: 46.0,
        maxAngleDeg: 68.0,
        angleStepDeg: 1.0,
        minEntryAngleDeg: 32.0,
        maxApexHeight: 7.2,
        minSpeed: 4.5,
        maxSpeed: 13.5
      });

      if (opt.valid && opt.solution) {
        return {
          isFeasible: true,
          reason: `Feasible dynamic shot from current position (range: ${distanceToHoop.toFixed(1)}m, angle: ${opt.solution.launchAngleDeg.toFixed(1)}°, speed: ${opt.solution.speed.toFixed(1)}m/s)`,
          candidatePosition: { x: robotPos.x, z: robotPos.z },
          distance: distanceToHoop,
          solution: opt.solution
        };
      }
    }

    // Trajectory solver could not find clean descending entry angle; fall back to nearby position
    return {
      isFeasible: false,
      reason: `No physically valid trajectory from current position; adjusting position`,
      candidatePosition: this.calculateFallbackShootingPosition(robotPos, target, 5.0),
      solution: null
    };
  }

  /**
   * Calculates a feasible nearby shooting position along the vector connecting the hoop to the robot.
   * @param {{ x: number, z: number }} currentPos
   * @param {{ x: number, y: number, z: number }} hoopTarget
   * @param {number} desiredDistance Standoff distance from hoop center (meters)
   * @returns {{ x: number, z: number }}
   */
  calculateFallbackShootingPosition(currentPos, hoopTarget, desiredDistance = 5.0) {
    const dx = hoopTarget.x - currentPos.x;
    const dz = hoopTarget.z - currentPos.z;
    const dist = Math.hypot(dx, dz) || 1.0;

    // Unit vector pointing away from hoop towards robot
    const unitX = (currentPos.x - hoopTarget.x) / dist;
    const unitZ = (currentPos.z - hoopTarget.z) / dist;

    let targetX = hoopTarget.x + unitX * desiredDistance;
    let targetZ = hoopTarget.z + unitZ * desiredDistance;

    // Clamp within playable bounds
    targetX = Math.max(-10.0, Math.min(10.2, targetX));
    targetZ = Math.max(-6.0, Math.min(6.0, targetZ));

    return { x: targetX, z: targetZ };
  }

  /**
   * Calculates optimal shooting position on the court based on vision hoop observation.
   * @param {Object} hoopObservation Latest hoop observation from VisionManager
   * @param {import('../robot/Robot.js').Robot} robot
   * @returns {{ x: number, z: number, hoopTarget: { x: number, y: number, z: number }, targetDistance: number }}
   */
  calculateShootingPosition(hoopObservation, robot) {
    const defaultPos = this.config.defaultShootingPos; // { x: 8.2, z: 0.0 }
    const defaultHoopTarget = { x: 12.425, y: 3.05, z: 0.0 };

    if (!hoopObservation || !hoopObservation.visible || !hoopObservation.targetRimPosition) {
      return {
        x: defaultPos.x,
        z: defaultPos.z,
        hoopTarget: defaultHoopTarget,
        targetDistance: Math.hypot(defaultHoopTarget.x - defaultPos.x, defaultHoopTarget.z - defaultPos.z)
      };
    }

    const rim = hoopObservation.targetRimPosition;
    const idealStandoff = 4.225;

    let shootX = rim.x - idealStandoff;
    let shootZ = rim.z;

    shootX = Math.max(5.8, Math.min(9.5, shootX));
    shootZ = Math.max(-2.5, Math.min(2.5, shootZ));

    return {
      x: shootX,
      z: shootZ,
      hoopTarget: { x: rim.x, y: rim.y ?? 3.05, z: rim.z },
      targetDistance: Math.hypot(rim.x - shootX, rim.z - shootZ)
    };
  }

  /**
   * Evaluates robot ball possession state.
   * @param {import('../robot/Robot.js').Robot} robot
   * @returns {{ hasBall: boolean, opticalActive: boolean, state: string }}
   */
  evaluatePossession(robot) {
    if (!robot || !robot.intake) {
      return { hasBall: false, opticalActive: false, state: 'NO_INTAKE' };
    }
    const it = robot.intake;
    const hasBall = Boolean(it.isBallCaptured || it.ballState === 'CAPTURED' || it.capturedBall);
    const opticalActive = Boolean(it.opticalSensorActive);

    return {
      hasBall,
      opticalActive,
      state: it.state || 'IDLE'
    };
  }

  /**
   * Validates whether all interlocks for firing the shooter are satisfied.
   * @param {import('../robot/Robot.js').Robot} robot
   * @param {Object} hoopObservation
   * @returns {{ isReady: boolean, blockers: string[] }}
   */
  evaluateShootingInterlocks(robot, hoopObservation) {
    const blockers = [];

    if (!robot) {
      blockers.push('Robot reference missing');
      return { isReady: false, blockers };
    }

    // 1. Ball possession interlock
    if (!robot.intake || !robot.intake.isBallCaptured) {
      blockers.push('No basketball captured in containment cradle');
    }

    // 2. Shooter readiness interlock
    if (!robot.shooter || robot.shooter.state !== 'READY') {
      blockers.push(`Flywheel shooter not ready (state: ${robot.shooter?.state || 'NONE'})`);
    }

    // 3. E-stop interlock
    if (robot.driveController?.mode === 'E_STOP') {
      blockers.push('Emergency stop is active');
    }

    return {
      isReady: blockers.length === 0,
      blockers
    };
  }

  /**
   * Evaluates recovery action when an unexpected failure occurs.
   * Uses consecutive failure ceiling to prevent infinite loops while allowing
   * healthy continuous gameplay to run indefinitely without false aborts.
   *
   * @param {string} failureReason Diagnostic code or reason
   * @param {Object} context Diagnostic context (retries count, consecutiveFailures, etc.)
   * @returns {{ action: string, nextState: string, reason: string }}
   */
  evaluateRecoveryAction(failureReason, context = {}) {
    const retries = context.retries || 0;
    const consecutiveFailures = context.consecutiveFailures ?? retries;
    const maxConsecutive = this.config.maxConsecutiveRecoveries || 8;
    const maxTotal = this.config.maxTotalRecoveries || 10;

    // Safety ceiling: abort if consecutive unrecovered failures exceed limit,
    // or if total session recoveries explicitly exceeded safety ceiling
    const isExceeded = (context.consecutiveFailures != null && context.consecutiveFailures >= maxConsecutive) ||
                       (context.totalRecoveries != null && context.totalRecoveries >= maxTotal);

    if (isExceeded) {
      return {
        action: 'ABORT_SESSION',
        nextState: 'FAILED',
        reason: context.consecutiveFailures != null
          ? `Exceeded maximum consecutive recovery attempts (${context.consecutiveFailures}/${maxConsecutive})`
          : `Exceeded maximum total recovery attempts (${context.totalRecoveries}/${maxTotal})`
      };
    }

    switch (failureReason) {
      case 'COLLECTION_FAILED':
      case 'INTAKE_TIMEOUT':
      case FAILURE_CATEGORIES.INTAKE_FAILED: {
        if (retries < this.config.maxCollectionRetries) {
          return {
            action: 'BACKUP_AND_REAPPROACH',
            nextState: 'RECOVERING',
            reason: `Collection missed ball. Backing up and re-approaching (retry ${retries + 1}/${this.config.maxCollectionRetries})`
          };
        }
        return {
          action: 'SEARCH_NEW_TARGET',
          nextState: 'SEARCHING_FOR_BALL',
          reason: `Collection failed after ${retries} attempts. Re-scanning court for ball`
        };
      }

      case 'BALL_NOT_DETECTED':
      case 'BALL_LOST':
      case 'TARGET_DISAPPEARED':
      case FAILURE_CATEGORIES.BALL_NOT_DETECTED:
      case FAILURE_CATEGORIES.BALL_TEMPORARILY_LOST: {
        if (retries < (this.config.maxSearchRetries || 3)) {
          return {
            action: 'SCAN_COURT',
            nextState: 'SEARCHING_FOR_BALL',
            reason: `Basketball not detected in current view. Conducting visual rotation scan (attempt ${retries + 1})`
          };
        }
        // If multiple 360 scans failed from current position, drive to center court (0,0) to gain full-court view
        return {
          action: 'REPOSITION_CENTER_VIEW',
          nextState: 'RECOVERING',
          reason: 'Ball not visible after rotation scan. Repositioning to center court for broad survey'
        };
      }

      case 'NAV_BLOCKED':
      case 'PATH_PLANNING_FAILED':
      case FAILURE_CATEGORIES.NAVIGATION_TIMEOUT:
      case FAILURE_CATEGORIES.PATH_BLOCKED: {
        if (retries < this.config.maxNavigationRetries) {
          return {
            action: 'REPLAN_NAVIGATION',
            nextState: 'RECOVERING',
            reason: `Navigation path blocked or timed out. Replanning alternative path (retry ${retries + 1}/${this.config.maxNavigationRetries})`
          };
        }
        return {
          action: 'SEARCH_NEW_TARGET',
          nextState: 'SEARCHING_FOR_BALL',
          reason: `Navigation path obstructed after ${retries} attempts. Re-evaluating field`
        };
      }

      case 'HOOP_NOT_VISIBLE':
      case 'HOOP_LOST': {
        return {
          action: 'SCAN_FOR_HOOP',
          nextState: 'SEARCHING_FOR_HOOP',
          reason: 'Basketball hoop not visible in camera FOV. Orienting toward East baseline'
        };
      }

      case 'ALIGNMENT_TIMEOUT': {
        if (retries < this.config.maxAlignmentRetries) {
          return {
            action: 'RETRY_ALIGNMENT',
            nextState: 'ALIGNING_WITH_HOOP',
            reason: `Hoop alignment timed out. Re-engaging heading PID (retry ${retries + 1}/${this.config.maxAlignmentRetries})`
          };
        }
        return {
          action: 'REPOSITION',
          nextState: 'POSITIONING_FOR_SHOT_IF_NEEDED',
          reason: 'Heading alignment failed repeatedly. Repositioning for better line of sight'
        };
      }

      case 'TRAJECTORY_INVALID':
      case FAILURE_CATEGORIES.SHOT_SOLUTION_UNAVAILABLE: {
        return {
          action: 'POSITION_FOR_SHOT',
          nextState: 'POSITIONING_FOR_SHOT_IF_NEEDED',
          reason: 'Current position has no direct shooting solution. Driving to nearby shooting spot'
        };
      }

      case 'SPINUP_TIMEOUT':
      case FAILURE_CATEGORIES.SHOOTING_EXECUTION_FAILED: {
        if (retries < this.config.maxSpinUpRetries) {
          return {
            action: 'RETRY_SPINUP',
            nextState: 'SPINNING_UP_FLYWHEELS',
            reason: `Flywheel acceleration delayed. Retrying spin-up (retry ${retries + 1}/${this.config.maxSpinUpRetries})`
          };
        }
        return {
          action: 'ABORT_SHOOTING',
          nextState: 'FAILED',
          reason: 'Flywheels failed to achieve target operational RPM'
        };
      }

      case 'POST_SHOT_REACQUISITION_FAILED':
      case FAILURE_CATEGORIES.POST_SHOT_REACQUISITION_FAILED: {
        return {
          action: 'SCAN_COURT',
          nextState: 'SEARCHING_FOR_BALL',
          reason: 'Ball landing zone scan complete. Re-initiating continuous ball search'
        };
      }

      case 'CONTROLLER_EXCEPTION':
      case FAILURE_CATEGORIES.CONTROLLER_EXCEPTION: {
        return {
          action: 'HALT_ERROR',
          nextState: 'FAILED',
          reason: `Internal Exception: ${context.message || 'Subsystem fault occurred'}`
        };
      }

      default: {
        return {
          action: 'RECOVER_GENERAL',
          nextState: 'SEARCHING_FOR_BALL',
          reason: `Recovering from: ${failureReason}. Resuming ball acquisition`
        };
      }
    }
  }

  /**
   * Checks if session completion criteria have been satisfied.
   * @param {string} mode Gameplay mode from GAMEPLAY_MODES
   * @param {number} successfulShots Number of verified scored baskets
   * @param {number} targetShots Target number of baskets (for FIXED_TARGET mode)
   * @returns {{ isCompleted: boolean, remainingShots: number }}
   */
  evaluateMissionCompletion(mode, successfulShots, targetShots) {
    if (mode === GAMEPLAY_MODES.FIXED_TARGET) {
      const remaining = Math.max(0, targetShots - successfulShots);
      return {
        isCompleted: remaining === 0,
        remainingShots: remaining
      };
    }

    // Continuous mode continues playing indefinitely until manually cancelled or failed
    return {
      isCompleted: false,
      remainingShots: 0
    };
  }
}
