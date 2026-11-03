/**
 * AutonomousConfig.js
 * Configuration constants, tuning parameters, and state enumerations
 * for SMART-BASKETBOT Milestone 7: Complete Autonomous Basketball Intelligence.
 */

export const AUTONOMOUS_STATES = Object.freeze({
  IDLE: 'IDLE',
  SEARCHING_FOR_BALL: 'SEARCHING_FOR_BALL',
  SELECTING_TARGET: 'SELECTING_TARGET',
  NAVIGATING_TO_BALL: 'NAVIGATING_TO_BALL',
  COLLECTING_BALL: 'COLLECTING_BALL',
  SEARCHING_FOR_HOOP: 'SEARCHING_FOR_HOOP',
  NAVIGATING_TO_SHOOTING_POSITION: 'NAVIGATING_TO_SHOOTING_POSITION',
  ALIGNING_WITH_HOOP: 'ALIGNING_WITH_HOOP',
  OPTIMIZING_TRAJECTORY: 'OPTIMIZING_TRAJECTORY',
  SPINNING_UP_FLYWHEELS: 'SPINNING_UP_FLYWHEELS',
  SHOOTING: 'SHOOTING',
  EVALUATING_SHOT: 'EVALUATING_SHOT',
  REACQUIRING_BALL: 'REACQUIRING_BALL',
  PAUSED: 'PAUSED',
  RECOVERING: 'RECOVERING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
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

  // Court positioning & shooting
  defaultShootingPos: { x: 8.2, z: 0.0 }, // Regulation Free-throw line key coordinates
  shootingPosTolerance: 0.35,     // Position tolerance for reaching shooting spot (meters)
  headingToleranceRad: 0.05,      // Yaw heading tolerance relative to hoop (~2.86 degrees)
  alignmentTimeout: 5.0,          // Seconds allowed for heading PID alignment
  spinUpTimeout: 3.5,             // Seconds allowed for flywheels to reach target RPM
  shotCooldown: 0.4,              // Seconds cooldown immediately after launch
  shotEvaluationTimeout: 6.0,     // Max seconds waiting for ball descent/scoring resolution

  // Search & scanning behaviors
  searchRotateSpeed: 0.75,        // Angular search scan rate (rad/s)
  searchBallTimeout: 8.0,         // Seconds for 360-deg rotation search for basketball
  searchHoopTimeout: 6.0,         // Seconds for hoop search scan
  reacquireCooldown: 1.0,         // Wait time before scanning for next ball after shot

  // Recovery & retry thresholds
  maxCollectionRetries: 3,        // Retries for failed ball collection before searching again
  maxNavigationRetries: 3,        // Retries for blocked path replanning
  maxAlignmentRetries: 3,         // Retries for alignment timeout
  maxSpinUpRetries: 2,            // Retries for flywheel readiness
  maxTotalRecoveries: 10,         // Safety ceiling for total session recoveries before FAILED
  recoveryBackupDistance: 0.60,   // Distance to back up during collection recovery (meters)
  recoveryBackupSpeed: -0.30,     // Reverse speed during recovery (m/s)

  // Vision quality gating
  minBallConfidence: 0.35,        // Minimum optical confidence to accept ball track
  minHoopConfidence: 0.25,        // Minimum optical confidence for hoop observation
  lostBallGracePeriod: 0.8        // Seconds to tolerate track loss before triggering search
});
