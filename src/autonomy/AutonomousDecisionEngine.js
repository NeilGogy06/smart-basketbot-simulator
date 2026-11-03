/**
 * AutonomousDecisionEngine.js
 * High-level cognitive decision engine for SMART-BASKETBOT.
 * Evaluates vision observations, possession state, navigation geometry,
 * shooter readiness, and historical outcomes to generate optimal autonomous actions.
 */

import { AUTONOMOUS_CONFIG, GAMEPLAY_MODES } from './AutonomousConfig.js';
import { RobotKinematics } from '../robot/RobotKinematics.js';

export class AutonomousDecisionEngine {
  /**
   * @param {Object} [config] Custom overrides for AUTONOMOUS_CONFIG
   */
  constructor(config = {}) {
    this.config = { ...AUTONOMOUS_CONFIG, ...config };
  }

  /**
   * Evaluates all tracked basketballs from VisionManager and selects the optimal target.
   * Uses genuine vision observations (distance, bearing, tracking stability, confidence)
   * rather than ground-truth entity coordinates.
   *
   * @param {import('../vision/VisionManager.js').VisionManager} visionManager
   * @param {import('../robot/Robot.js').Robot} robot
   * @returns {Object|null} Selected target descriptor or null if no valid target
   */
  selectBestBasketballTarget(visionManager, robot) {
    if (!visionManager || !robot) return null;

    const tracks = visionManager.getTrackedBasketballs();
    if (!tracks || tracks.length === 0) {
      return null;
    }

    const robotPos = robot.getPosition();
    const robotHeading = robot.getHeading();

    let bestTrack = null;
    let highestScore = -Infinity;

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];

      // Gating filter 1: Must not be expired or low confidence
      if (track.confidence < this.config.minBallConfidence) continue;
      if (track.status === 'LOST' && track.timeSinceLastSeen > this.config.lostBallGracePeriod) continue;

      // Gating filter 2: Estimated world coordinates must reside inside court boundaries
      const wx = track.worldPosition.x;
      const wz = track.worldPosition.z;
      if (Math.abs(wx) > 14.5 || Math.abs(wz) > 7.5) continue;

      // Distance scoring: closer targets score higher (normalized 0..1 over 20m)
      const dist = track.distance ?? Math.hypot(wx - robotPos.x, wz - robotPos.z);
      const distScore = Math.max(0.0, 1.0 - (dist / 18.0));

      // Heading alignment scoring: targets directly ahead score higher
      const dx = wx - robotPos.x;
      const dz = wz - robotPos.z;
      const angleToTarget = Math.atan2(-dz, dx);
      const headingDiff = RobotKinematics.normalizeAngle(angleToTarget - robotHeading);
      const alignScore = Math.max(0.0, Math.cos(headingDiff));

      // Track quality & stability
      const confScore = track.confidence ?? 0.5;
      const freshnessScore = track.isVisible ? 1.0 : Math.max(0.2, 1.0 - track.timeSinceLastSeen);

      // Composite multi-factor utility score
      const totalScore = (distScore * 0.40) + (alignScore * 0.30) + (confScore * 0.15) + (freshnessScore * 0.15);

      if (totalScore > highestScore) {
        highestScore = totalScore;
        bestTrack = track;
      }
    }

    if (!bestTrack) return null;

    // Calculate approach waypoint offset in front of the ball
    // Approach position stops 0.45m before the ball along line connecting robot to ball
    const targetX = bestTrack.worldPosition.x;
    const targetZ = bestTrack.worldPosition.z;
    const dx = targetX - robotPos.x;
    const dz = targetZ - robotPos.z;
    const totalDist = Math.hypot(dx, dz);

    let approachX = targetX;
    let approachZ = targetZ;

    if (totalDist > this.config.ballApproachOffset) {
      const unitX = dx / totalDist;
      const unitZ = dz / totalDist;
      approachX = targetX - unitX * this.config.ballApproachOffset;
      approachZ = targetZ - unitZ * this.config.ballApproachOffset;
    }

    return {
      id: bestTrack.id,
      track: bestTrack,
      worldPosition: { x: targetX, y: bestTrack.worldPosition.y, z: targetZ },
      approachPosition: { x: approachX, z: approachZ },
      distance: bestTrack.distance,
      azimuthDeg: bestTrack.azimuthDeg,
      confidence: bestTrack.confidence,
      score: highestScore
    };
  }

  /**
   * Calculates optimal shooting position on the court based on vision hoop observation.
   * If hoop observation is available, calculates position facing the observed rim center;
   * otherwise defaults to standard regulation Free-Throw key coordinates.
   *
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
    // Standard ideal standoff from rim is 4.2m to 5.0m (Free throw distance)
    const idealStandoff = 4.225;

    // Standoff position along -X from East rim
    let shootX = rim.x - idealStandoff;
    let shootZ = rim.z;

    // Clamp within valid court key bounds
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
    const hasBall = Boolean(it.isBallCaptured || it.ballState === 'CAPTURED');
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
   * @param {string} failureReason Diagnostic code or reason
   * @param {Object} context Diagnostic context (retries count, target, etc.)
   * @returns {{ action: string, nextState: string, reason: string }}
   */
  evaluateRecoveryAction(failureReason, context = {}) {
    const retries = context.retries || 0;
    const totalRecoveries = context.totalRecoveries || 0;

    // Safety ceiling: prevent infinite recovery cycles
    if (totalRecoveries >= this.config.maxTotalRecoveries) {
      return {
        action: 'ABORT_SESSION',
        nextState: 'FAILED',
        reason: `Exceeded maximum total recovery attempts (${totalRecoveries}/${this.config.maxTotalRecoveries})`
      };
    }

    switch (failureReason) {
      case 'COLLECTION_FAILED':
      case 'INTAKE_TIMEOUT': {
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
          reason: `Collection failed after ${retries} attempts. Searching for alternative ball`
        };
      }

      case 'BALL_LOST':
      case 'TARGET_DISAPPEARED': {
        return {
          action: 'SCAN_COURT',
          nextState: 'SEARCHING_FOR_BALL',
          reason: 'Target basketball lost from camera view. Initiating 360° visual scan'
        };
      }

      case 'NAV_BLOCKED':
      case 'PATH_PLANNING_FAILED': {
        if (retries < this.config.maxNavigationRetries) {
          return {
            action: 'REPLAN_NAVIGATION',
            nextState: 'RECOVERING',
            reason: `Navigation path blocked. Replanning route (retry ${retries + 1}/${this.config.maxNavigationRetries})`
          };
        }
        return {
          action: 'SEARCH_NEW_TARGET',
          nextState: 'SEARCHING_FOR_BALL',
          reason: `Navigation path blocked repeatedly (${retries} retries). Re-evaluating field`
        };
      }

      case 'HOOP_NOT_VISIBLE':
      case 'HOOP_LOST': {
        return {
          action: 'SCAN_FOR_HOOP',
          nextState: 'SEARCHING_FOR_HOOP',
          reason: 'Basketball hoop not visible in camera FOV. Scanning towards East baseline'
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
          nextState: 'NAVIGATING_TO_SHOOTING_POSITION',
          reason: 'Heading alignment failed repeatedly. Repositioning at shooting key'
        };
      }

      case 'SPINUP_TIMEOUT': {
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
