/**
 * AutonomousConfig.js
 * Configuration constants, tuning parameters, and state enumerations
 * for SMART-BASKETBOT Milestone 7 & Continuous Autonomous Gameplay Redesign.
 */

export const AUTONOMOUS_STATES = Object.freeze({
  IDLE: 'IDLE',

  // 14 Continuous Gameplay Logical States & Backwards-compatible aliases
  SEARCHING_FOR_BALL: 'SEARCHING_FOR_BALL',
  TRACKING_BALL: 'SELECTING_TARGET',
  SELECTING_TARGET: 'SELECTING_TARGET',
  APPROACHING_BALL: 'NAVIGATING_TO_BALL',
  NAVIGATING_TO_BALL: 'NAVIGATING_TO_BALL',
  ALIGNING_FOR_INTAKE: 'ALIGNING_FOR_INTAKE',
  COLLECTING_BALL: 'COLLECTING_BALL',
  VERIFYING_POSSESSION: 'SEARCHING_FOR_HOOP',
  SEARCHING_FOR_HOOP: 'SEARCHING_FOR_HOOP',
  SELECTING_SHOT: 'SEARCHING_FOR_HOOP',
  POSITIONING_FOR_SHOT_IF_NEEDED: 'NAVIGATING_TO_SHOOTING_POSITION',
  NAVIGATING_TO_SHOOTING_POSITION: 'NAVIGATING_TO_SHOOTING_POSITION',
  ALIGNING_WITH_HOOP: 'ALIGNING_WITH_HOOP',
  CALCULATING_SHOT: 'OPTIMIZING_TRAJECTORY',
  OPTIMIZING_TRAJECTORY: 'OPTIMIZING_TRAJECTORY',
  SPINNING_UP_FLYWHEELS: 'SPINNING_UP_FLYWHEELS',
  EXECUTING_SHOT: 'SHOOTING',
  SHOOTING: 'SHOOTING',
  TRACKING_SHOT: 'EVALUATING_SHOT',
  WAITING_FOR_BALL_TO_LAND: 'WAITING_FOR_BALL_TO_LAND',
  EVALUATING_SHOT: 'EVALUATING_SHOT',
  REACQUIRING_BALL: 'REACQUIRING_BALL',
  RETURNING_TO_SEARCHING: 'SEARCHING_FOR_BALL',

  // Session Control States
  PAUSED: 'PAUSED',
  RECOVERING: 'RECOVERING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
});

export const FAILURE_CATEGORIES = Object.freeze({
  NONE: 'NONE',
  BALL_NOT_DETECTED: 'BALL_NOT_DETECTED',
  BALL_TEMPORARILY_LOST: 'BALL_TEMPORARILY_LOST',
  NAVIGATION_TIMEOUT: 'NAVIGATION_TIMEOUT',
  PATH_BLOCKED: 'PATH_BLOCKED',
  INTAKE_FAILED: 'INTAKE_FAILED',
  POSSESSION_VERIFICATION_FAILED: 'POSSESSION_VERIFICATION_FAILED',
  SHOT_SOLUTION_UNAVAILABLE: 'SHOT_SOLUTION_UNAVAILABLE',
  SHOOTING_EXECUTION_FAILED: 'SHOOTING_EXECUTION_FAILED',
  POST_SHOT_REACQUISITION_FAILED: 'POST_SHOT_REACQUISITION_FAILED',
  CONTROLLER_EXCEPTION: 'CONTROLLER_EXCEPTION'
});

export const GAMEPLAY_MODES = Object.freeze({
  CONTINUOUS: 'CONTINUOUS',
  FIXED_TARGET: 'FIXED_TARGET'
});

export const AUTONOMOUS_CONFIG = Object.freeze({
  // Gameplay defaults
  defaultMode: GAMEPLAY_MODES.CONTINUOUS,
  defaultTargetShots: 5,

  // Ball acquisition & intake geometry
  ballApproachOffset: 0.45,       // Distance in front of ball target to navigate to (meters)
  ballCaptureDistance: 0.55,      // Distance threshold to trigger slow intake approach (meters)
  ballCollectionDriveSpeed: 0.35, // Forward crawling speed during intake collection (m/s)
  collectionTimeout: 5.0,         // Seconds allowed in COLLECTING_BALL before failure/recovery

  // Court positioning & dynamic shooting
  minFeasibleShotDistance: 2.2,   // Minimum standoff distance from rim for direct shooting (meters)
  maxFeasibleShotDistance: 9.0,   // Maximum standoff distance from rim for direct shooting (meters)
  defaultShootingPos: { x: 8.2, z: 0.0 }, // Regulation Free-throw line key coordinates
  shootingPosTolerance: 0.35,     // Position tolerance for reaching shooting spot (meters)
  headingToleranceRad: 0.05,      // Yaw heading tolerance relative to hoop (~2.86 degrees)
  alignmentTimeout: 5.0,          // Seconds allowed for heading PID alignment
  spinUpTimeout: 3.5,             // Seconds allowed for flywheels to reach target RPM
  shotCooldown: 0.4,              // Seconds cooldown immediately after launch
  shotEvaluationTimeout: 6.0,     // Max seconds waiting for ball descent/scoring resolution

  // Search & scanning behaviors
  searchRotateSpeed: 0.70,        // Angular search scan rate (rad/s)
  searchBallTimeout: 8.0,         // Seconds for 360-deg rotation search for basketball
  searchHoopTimeout: 6.0,         // Seconds for hoop search scan
  reacquireCooldown: 0.8,         // Wait time before scanning for next ball after shot
  landingWaitTimeout: 4.5,        // Max seconds to wait for ball to land after shooting

  // Recovery & retry thresholds
  maxConsecutiveRecoveries: 8,    // Safety ceiling for consecutive unrecovered failures before FAILED
  maxTotalRecoveries: 10,         // Safety ceiling for total session recoveries in fixed mode
  maxSearchRetries: 3,            // Full rotation search retries before repositioning
  maxCollectionRetries: 3,        // Retries for failed ball collection before searching again
  maxNavigationRetries: 3,        // Retries for blocked path replanning
  maxAlignmentRetries: 3,         // Retries for alignment timeout
  maxSpinUpRetries: 2,            // Retries for flywheel readiness
  recoveryBackupDistance: 0.60,   // Distance to back up during collection recovery (meters)
  recoveryBackupSpeed: -0.30,     // Reverse speed during recovery (m/s)
  recoveryCooldown: 0.6,          // Cooldown duration in RECOVERING state (seconds)

  // Vision quality gating
  minBallConfidence: 0.30,        // Minimum optical confidence to accept ball track
  minHoopConfidence: 0.25,        // Minimum optical confidence for hoop observation
  lostBallGracePeriod: 1.2        // Seconds to tolerate track loss before triggering search
});
