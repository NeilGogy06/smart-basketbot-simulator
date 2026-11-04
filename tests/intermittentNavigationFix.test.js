/**
 * tests/intermittentNavigationFix.test.js
 * Comprehensive integration test suite for verifying the fix for intermittent
 * ball detection-to-navigation failures in SMART-BASKETBOT.
 *
 * Covers all 14 required verification scenarios:
 * 1. Ball detected and successfully selected
 * 2. Ball detected but temporarily below confidence threshold
 * 3. Ball detection becoming valid after previously being invalid
 * 4. Stale detections being rejected appropriately
 * 5. Ball selected and navigation successfully started
 * 6. Navigation target coordinates being correct
 * 7. Repeated detections not restarting navigation unnecessarily
 * 8. Navigation cancellation and recovery
 * 9. Ball becoming temporarily occluded
 * 10. Ball being reacquired
 * 11. Multiple detected balls
 * 12. Same basketball becoming collectible after shooting
 * 13. Navigation continuing until the robot reaches the ball
 * 14. Invalid coordinates being handled safely
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { AUTONOMOUS_CONFIG, AUTONOMOUS_STATES, FAILURE_CATEGORIES, GAMEPLAY_MODES } from '../src/autonomy/AutonomousConfig.js';
import { AutonomousDecisionEngine } from '../src/autonomy/AutonomousDecisionEngine.js';
import { AutonomousGameplayController } from '../src/autonomy/AutonomousGameplayController.js';
import { BallDetection } from '../src/vision/BallDetection.js';
import { ObjectTracker } from '../src/vision/ObjectTracker.js';
import { CameraSystem } from '../src/vision/CameraSystem.js';
import { NavigationGrid } from '../src/navigation/NavigationGrid.js';
import { ObstacleManager } from '../src/navigation/ObstacleManager.js';
import { AStarPlanner } from '../src/navigation/AStarPlanner.js';
import { AutonomousNavController } from '../src/navigation/AutonomousNavController.js';

// Mock minimal differential drive controller
class MockDriveController {
  constructor() {
    this.mode = 'STOPPED';
    this.linearVelocity = 0;
    this.angularVelocity = 0;
    this.targetHeading = 0;
  }
  setDriveVelocities(v, w) {
    this.mode = 'VELOCITY';
    this.linearVelocity = v;
    this.angularVelocity = w;
  }
  setTargetVelocity(v, w) {
    this.setDriveVelocities(v, w);
  }
  setTargetHeading(heading, speed) {
    this.mode = 'HEADING_HOLD';
    this.targetHeading = heading;
    this.linearVelocity = speed;
  }
  stop() {
    this.mode = 'STOPPED';
    this.linearVelocity = 0;
    this.angularVelocity = 0;
  }
  emergencyStop() {
    this.mode = 'E_STOP';
    this.linearVelocity = 0;
    this.angularVelocity = 0;
  }
  update() {
    return { linearVelocity: this.linearVelocity, angularVelocity: this.angularVelocity };
  }
}

// Mock Robot with full navigation integration
class MockRobot {
  constructor(x = 0, z = 0, heading = 0) {
    this.position = { x, y: 0.15, z };
    this.heading = heading;
    this.controlMode = 'AUTONOMOUS';
    this.driveController = new MockDriveController();

    this.grid = new NavigationGrid();
    this.obstacleManager = new ObstacleManager(this.grid);
    this.planner = new AStarPlanner(this.grid);
    this.navController = new AutonomousNavController({
      driveController: this.driveController,
      obstacleManager: this.obstacleManager,
      planner: this.planner
    });

    this.intake = {
      isBallCaptured: false,
      ballState: 'FIELD',
      opticalSensorActive: false,
      startIntake: () => {},
      stopIntake: () => {},
      captureBall: () => { this.intake.isBallCaptured = true; }
    };
    this.shooter = {
      state: 'IDLE',
      cancel: () => {},
      reset: () => {}
    };
    this.adaptiveCorrector = {
      recordOutcome: () => {},
      headingBias: 0
    };
    this.trajectoryCalculator = {
      optimizeTrajectory: () => ({ speed: 7.5, launchAngleDeg: 55, targetDistance: 4.5 })
    };
  }

  getPosition() {
    return { ...this.position };
  }
  getHeading() {
    return this.heading;
  }
  getPose() {
    return { x: this.position.x, z: this.position.z, heading: this.heading };
  }
  setControlMode(m) {
    this.controlMode = m;
  }
  startIntake() {
    this.intake.startIntake();
  }
  stopIntake() {
    this.intake.stopIntake();
  }
  startAutonomousNavigation(x, z) {
    this.controlMode = 'AUTONOMOUS';
    return this.navController.navigateTo(x, z, this.getPose());
  }
  cancelAutonomousNavigation() {
    this.navController.cancel();
    this.driveController.stop();
  }
}

describe('SMART-BASKETBOT: Intermittent Ball Detection-to-Navigation Fix Suite', () => {
  let decisionEngine;
  let tracker;
  let cameraSystem;
  let ballDetection;
  let mockRobot;

  beforeEach(() => {
    decisionEngine = new AutonomousDecisionEngine();
    tracker = new ObjectTracker();
    cameraSystem = new CameraSystem();
    cameraSystem.update({ x: 0, y: 0.15, z: 0 }, 0);
    ballDetection = new BallDetection(cameraSystem);
    mockRobot = new MockRobot(0, 0, 0);
  });

  afterEach(() => {
    tracker.reset();
  });

  // =========================================================================
  // 1. Ball detected and successfully selected
  // =========================================================================
  it('1. selects a valid, visible, collectible basketball within court bounds', () => {
    const ballPos = { x: 4.0, y: 0.12, z: 0.0 };
    const rawDet = ballDetection.evaluateSingleBall({ getPosition: () => ballPos });
    expect(rawDet).not.toBeNull();

    const tracks = tracker.update([rawDet]);
    expect(tracks.length).toBe(1);

    const mockVision = {
      getTrackedBasketballs: () => tracker.getActiveTracks(),
      getSelectedBasketball: () => tracker.getSelectedTrack(),
      latestRawBallDetections: [rawDet]
    };

    const target = decisionEngine.selectBestBasketballTarget(mockVision, mockRobot);
    expect(target).not.toBeNull();
    expect(target.id).toBe(tracks[0].id);
    expect(target.confidence).toBeGreaterThanOrEqual(AUTONOMOUS_CONFIG.minBallConfidence);

    const diag = decisionEngine.getTargetSelectionDiagnostics();
    expect(diag.selectionStatus).toBe('SELECTED');
    expect(diag.primaryRejectionReason).toBe('NONE');
  });

  // =========================================================================
  // 2. Ball detected but temporarily below confidence threshold
  // =========================================================================
  it('2. rejects detection temporarily below minBallConfidence with LOW_CONFIDENCE diagnostic', () => {
    const trackBelowThresh = {
      id: 'BALL_LOW',
      instanceId: 'ball_low_1',
      status: 'TRACKED',
      isVisible: true,
      confidence: 0.18, // Below 0.30
      worldPosition: { x: 5.0, y: 0.12, z: 0.0 },
      distance: 5.0,
      azimuthDeg: 0,
      timeSinceLastSeen: 0.0,
      reference: { isPossessed: false, state: 'AVAILABLE' }
    };

    const mockVision = {
      getTrackedBasketballs: () => [trackBelowThresh],
      getSelectedBasketball: () => trackBelowThresh,
      latestRawBallDetections: [trackBelowThresh]
    };

    const target = decisionEngine.selectBestBasketballTarget(mockVision, mockRobot);
    expect(target).toBeNull();

    const diag = decisionEngine.getTargetSelectionDiagnostics();
    expect(diag.selectionStatus).toBe('TARGET_REJECTED');
    expect(diag.primaryRejectionReason).toBe('LOW_CONFIDENCE');
    expect(diag.candidates[0].rejectionReason).toBe('LOW_CONFIDENCE');
  });

  // =========================================================================
  // 3. Ball detection becoming valid after previously being invalid
  // =========================================================================
  it('3. transitions from TARGET_REJECTED to SELECTED when confidence rises above threshold', () => {
    // Frame 1: Low confidence
    const candidateTrack = {
      id: 'BALL_TEST',
      instanceId: 'ball_dyn_1',
      status: 'TRACKED',
      isVisible: true,
      confidence: 0.22,
      worldPosition: { x: 5.0, y: 0.12, z: 0.0 },
      distance: 5.0,
      azimuthDeg: 0,
      timeSinceLastSeen: 0.0,
      reference: { isPossessed: false, state: 'AVAILABLE' }
    };

    let target = decisionEngine.selectBestBasketballTarget({
      getTrackedBasketballs: () => [candidateTrack]
    }, mockRobot);
    expect(target).toBeNull();
    expect(decisionEngine.getTargetSelectionDiagnostics().selectionStatus).toBe('TARGET_REJECTED');

    // Frame 2: Confidence improves
    candidateTrack.confidence = 0.65;
    target = decisionEngine.selectBestBasketballTarget({
      getTrackedBasketballs: () => [candidateTrack]
    }, mockRobot);

    expect(target).not.toBeNull();
    expect(target.id).toBe('BALL_TEST');
    expect(decisionEngine.getTargetSelectionDiagnostics().selectionStatus).toBe('SELECTED');
  });

  // =========================================================================
  // 4. Stale detections being rejected appropriately
  // =========================================================================
  it('4. rejects stale LOST detections exceeding lostBallGracePeriod with LOST_TIMEOUT', () => {
    const staleTrack = {
      id: 'BALL_STALE',
      status: 'LOST',
      isVisible: false,
      confidence: 0.70,
      timeSinceLastSeen: 2.5, // Exceeds lostBallGracePeriod (1.2s)
      worldPosition: { x: 4.0, y: 0.12, z: 0.0 },
      distance: 4.0,
      azimuthDeg: 0,
      reference: { isPossessed: false, state: 'AVAILABLE' }
    };

    const target = decisionEngine.selectBestBasketballTarget({
      getTrackedBasketballs: () => [staleTrack]
    }, mockRobot);

    expect(target).toBeNull();
    const diag = decisionEngine.getTargetSelectionDiagnostics();
    expect(diag.primaryRejectionReason).toBe('LOST_TIMEOUT');
  });

  // =========================================================================
  // 5. Ball selected and navigation successfully started
  // =========================================================================
  it('5. starts autonomous navigation smoothly when ball target is selected', () => {
    const controller = new AutonomousGameplayController({
      robot: mockRobot,
      visionManager: {
        getTrackedBasketballs: () => [{
          id: 'BALL_NAV',
          status: 'TRACKED',
          isVisible: true,
          confidence: 0.80,
          worldPosition: { x: 5.0, y: 0.12, z: 0.0 },
          distance: 5.0,
          azimuthDeg: 0,
          timeSinceLastSeen: 0,
          reference: { isPossessed: false, state: 'AVAILABLE' }
        }],
        getSelectedBasketball: () => ({ id: 'BALL_NAV', worldPosition: { x: 5.0, y: 0.12, z: 0.0 } }),
        getHoopObservation: () => ({ visible: false })
      },
      basketball: { getPosition: () => ({ x: 5.0, y: 0.12, z: 0.0 }) }
    });

    controller.startContinuousMode();
    expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SEARCHING_FOR_BALL);

    // Step 1: Detects and transitions to SELECTING_TARGET
    controller.update(0.016);
    expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SELECTING_TARGET);
    expect(controller.targetSelectionStatus).toBe('SELECTED');

    // Step 2: Plans path and transitions to NAVIGATING_TO_BALL
    controller.update(0.016);
    expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.NAVIGATING_TO_BALL);
    expect(controller.targetSelectionStatus).toBe('NAVIGATING');
    expect(mockRobot.navController.state).toBe('NAVIGATING');
    expect(controller.lastNavigationCommandTimestamp).toBeGreaterThan(0);
  });

  // =========================================================================
  // 6. Navigation target coordinates being correct
  // =========================================================================
  it('6. calculates approach waypoint offset 0.45m in front of ball within court boundaries', () => {
    const ballPos = { x: 6.0, y: 0.12, z: 0.0 };
    const robotPos = { x: 0.0, y: 0.15, z: 0.0 };

    const appPos = decisionEngine.calculateApproachPosition(ballPos, robotPos);
    // Along X axis, approach should be at 6.0 - 0.45 = 5.55m
    expect(appPos.x).toBeCloseTo(5.55, 2);
    expect(appPos.z).toBeCloseTo(0.0, 2);

    // Clamping test for ball near boundary
    const boundaryBall = { x: 14.8, z: 7.2 };
    const clampedApp = decisionEngine.calculateApproachPosition(boundaryBall, robotPos);
    expect(clampedApp.x).toBeLessThanOrEqual(13.8);
    expect(clampedApp.z).toBeLessThanOrEqual(6.8);
  });

  // =========================================================================
  // 7. Repeated detections not restarting navigation unnecessarily
  // =========================================================================
  it('7. preserves active navigation path without thrashing or restarting on continuous perception updates', () => {
    const ballTrack = {
      id: 'BALL_LOCK',
      status: 'TRACKED',
      isVisible: true,
      confidence: 0.85,
      worldPosition: { x: 5.0, y: 0.12, z: 0.0 },
      distance: 5.0,
      azimuthDeg: 0,
      timeSinceLastSeen: 0,
      reference: { isPossessed: false, state: 'AVAILABLE' }
    };

    const controller = new AutonomousGameplayController({
      robot: mockRobot,
      visionManager: {
        getTrackedBasketballs: () => [ballTrack],
        getSelectedBasketball: () => ballTrack,
        getHoopObservation: () => ({ visible: false })
      },
      basketball: { getPosition: () => ({ x: 5.0, y: 0.12, z: 0.0 }) }
    });

    controller.startContinuousMode();
    controller.update(0.016); // -> SELECTING_TARGET
    controller.update(0.016); // -> NAVIGATING_TO_BALL

    const initialNavTime = controller.lastNavigationCommandTimestamp;
    expect(initialNavTime).toBeGreaterThan(0);

    // Simulate 10 frames of steady observations of the stationary ball
    for (let f = 0; f < 10; f++) {
      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.NAVIGATING_TO_BALL);
      expect(controller.lastNavigationCommandTimestamp).toBe(initialNavTime);
    }
  });

  // =========================================================================
  // 8. Navigation cancellation and recovery
  // =========================================================================
  it('8. records cancellation reason and enters non-fatal replanning recovery when navigation is blocked', () => {
    mockRobot.startAutonomousNavigation(5.0, 0.0);
    expect(mockRobot.navController.state).toBe('NAVIGATING');

    mockRobot.navController.cancel('Path blocked by dynamic obstacle');
    expect(mockRobot.navController.state).toBe('CANCELLED');
    expect(mockRobot.navController.cancellationReason).toBe('Path blocked by dynamic obstacle');

    // Replan succeeds once destination is cleared
    mockRobot.navController.destination = { x: 5.0, z: 0.0 };
    const replanResult = mockRobot.navController.replan(mockRobot.getPose());
    expect(replanResult).toBe(true);
    expect(mockRobot.navController.state).toBe('NAVIGATING');
  });

  // =========================================================================
  // 9. Ball becoming temporarily occluded
  // =========================================================================
  it('9. maintains target lock and navigation heading during temporary ball occlusion', () => {
    const ballTrack = {
      id: 'BALL_OCC',
      status: 'TRACKED',
      isVisible: true,
      confidence: 0.80,
      worldPosition: { x: 5.0, y: 0.12, z: 0.0 },
      distance: 5.0,
      azimuthDeg: 0,
      timeSinceLastSeen: 0,
      reference: { isPossessed: false, state: 'AVAILABLE' }
    };

    const controller = new AutonomousGameplayController({
      robot: mockRobot,
      visionManager: {
        getTrackedBasketballs: () => [ballTrack],
        getSelectedBasketball: () => (ballTrack.isVisible ? ballTrack : null),
        getHoopObservation: () => ({ visible: false })
      },
      basketball: { getPosition: () => ({ x: 5.0, y: 0.12, z: 0.0 }) }
    });

    controller.startContinuousMode();
    controller.update(0.016); // SELECTING_TARGET
    controller.update(0.016); // NAVIGATING_TO_BALL

    // Ball becomes occluded for 0.4 seconds
    ballTrack.isVisible = false;
    ballTrack.status = 'LOST';
    ballTrack.timeSinceLastSeen = 0.4;

    controller.update(0.016);
    // Navigation should continue smoothly because target lock is maintained
    expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.NAVIGATING_TO_BALL);
    expect(mockRobot.navController.state).toBe('NAVIGATING');
  });

  // =========================================================================
  // 10. Ball being reacquired
  // =========================================================================
  it('10. reacquires visible ball and locks target automatically after search scan', () => {
    let ballVisible = false;
    const testBall = {
      id: 'BALL_REACQ',
      status: 'TRACKED',
      isVisible: true,
      confidence: 0.75,
      worldPosition: { x: 4.5, y: 0.12, z: 1.0 },
      distance: 4.6,
      azimuthDeg: 12.0,
      timeSinceLastSeen: 0,
      reference: { isPossessed: false, state: 'AVAILABLE' }
    };

    const controller = new AutonomousGameplayController({
      robot: mockRobot,
      visionManager: {
        getTrackedBasketballs: () => (ballVisible ? [testBall] : []),
        getSelectedBasketball: () => (ballVisible ? testBall : null),
        getHoopObservation: () => ({ visible: false })
      },
      basketball: { getPosition: () => ({ x: 4.5, y: 0.12, z: 1.0 }) }
    });

    controller.startContinuousMode();
    controller.update(0.016); // SEARCHING_FOR_BALL
    expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SEARCHING_FOR_BALL);
    expect(controller.targetSelectionStatus).toBe('SEARCHING');

    // Ball enters camera FOV
    ballVisible = true;
    controller.update(0.016);
    expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SELECTING_TARGET);
    expect(controller.targetSelectionStatus).toBe('SELECTED');
    expect(controller.currentTarget.id).toBe('BALL_REACQ');
  });

  // =========================================================================
  // 11. Multiple detected balls
  // =========================================================================
  it('11. scores and selects optimal candidate among multiple visible basketballs', () => {
    const ballFar = {
      id: 'BALL_FAR',
      confidence: 0.85,
      worldPosition: { x: 12.0, y: 0.12, z: 4.0 },
      distance: 12.6,
      azimuthDeg: 20.0,
      timeSinceLastSeen: 0,
      status: 'TRACKED',
      isVisible: true,
      reference: { isPossessed: false, state: 'AVAILABLE' }
    };

    const ballClose = {
      id: 'BALL_CLOSE',
      confidence: 0.85,
      worldPosition: { x: 3.5, y: 0.12, z: 0.2 },
      distance: 3.5,
      azimuthDeg: 3.0,
      timeSinceLastSeen: 0,
      status: 'TRACKED',
      isVisible: true,
      reference: { isPossessed: false, state: 'AVAILABLE' }
    };

    const target = decisionEngine.selectBestBasketballTarget({
      getTrackedBasketballs: () => [ballFar, ballClose]
    }, mockRobot);

    expect(target).not.toBeNull();
    expect(target.id).toBe('BALL_CLOSE');

    const diag = decisionEngine.getTargetSelectionDiagnostics();
    expect(diag.candidateCount).toBe(2);
    expect(diag.selectedTargetId).toBe('BALL_CLOSE');
  });

  // =========================================================================
  // 12. Same basketball becoming collectible after shooting
  // =========================================================================
  it('12. allows the same physical basketball to be reacquired after landing', () => {
    const ballEntity = {
      id: 'BALL_PHYSICAL',
      isPossessed: false,
      state: 'IN_FLIGHT',
      shotCooldownTimer: 0.2,
      getPosition: () => ({ x: 8.0, y: 1.8, z: 0.0 }) // High altitude
    };

    const track = {
      id: 'BALL_TRACK_1',
      instanceId: 'ball_main',
      status: 'TRACKED',
      isVisible: true,
      confidence: 0.80,
      worldPosition: { x: 8.0, y: 1.8, z: 0.0 },
      distance: 8.0,
      azimuthDeg: 0,
      timeSinceLastSeen: 0,
      reference: ballEntity
    };

    // Phase A: While in flight, rejected
    let target = decisionEngine.selectBestBasketballTarget({
      getTrackedBasketballs: () => [track]
    }, mockRobot);
    expect(target).toBeNull();
    expect(decisionEngine.getTargetSelectionDiagnostics().primaryRejectionReason).toBe('SHOT_COOLDOWN');

    // Phase B: Ball lands and settles on floor
    ballEntity.state = 'AVAILABLE';
    ballEntity.shotCooldownTimer = 0.0;
    ballEntity.getPosition = () => ({ x: 8.5, y: 0.12, z: -0.2 });
    track.worldPosition = { x: 8.5, y: 0.12, z: -0.2 };

    target = decisionEngine.selectBestBasketballTarget({
      getTrackedBasketballs: () => [track]
    }, mockRobot);

    expect(target).not.toBeNull();
    expect(target.id).toBe('BALL_TRACK_1');
    expect(decisionEngine.getTargetSelectionDiagnostics().selectionStatus).toBe('SELECTED');
  });

  // =========================================================================
  // 13. Navigation continuing until the robot reaches the ball
  // =========================================================================
  it('13. transitions from NAVIGATING_TO_BALL to ALIGNING_FOR_INTAKE upon entering capture distance', () => {
    const ballTrack = {
      id: 'BALL_PROX',
      status: 'TRACKED',
      isVisible: true,
      confidence: 0.90,
      worldPosition: { x: 2.0, y: 0.12, z: 0.0 },
      distance: 2.0,
      azimuthDeg: 0,
      timeSinceLastSeen: 0,
      reference: { isPossessed: false, state: 'AVAILABLE' }
    };

    const controller = new AutonomousGameplayController({
      robot: mockRobot,
      visionManager: {
        getTrackedBasketballs: () => [ballTrack],
        getSelectedBasketball: () => ballTrack,
        getHoopObservation: () => ({ visible: false })
      },
      basketball: { getPosition: () => ({ x: 2.0, y: 0.12, z: 0.0 }) }
    });

    controller.startContinuousMode();
    controller.update(0.016); // SELECTING_TARGET
    controller.update(0.016); // NAVIGATING_TO_BALL
    expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.NAVIGATING_TO_BALL);

    // Robot translates forward until within ballCaptureDistance (0.50m)
    mockRobot.position.x = 1.65; // Distance to ball = 2.0 - 1.65 = 0.35m < 0.55m
    controller.update(0.016);

    expect(controller.targetSelectionStatus).toBe('ARRIVED');
    expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.COLLECTING_BALL);
  });

  // =========================================================================
  // 14. Invalid coordinates being handled safely
  // =========================================================================
  it('14. safely rejects tracks with NaN or out-of-bounds coordinates without throwing exceptions', () => {
    const nanTrack = {
      id: 'BALL_NAN',
      status: 'TRACKED',
      isVisible: true,
      confidence: 0.80,
      worldPosition: { x: NaN, y: 0.12, z: NaN },
      distance: 5.0,
      azimuthDeg: 0,
      timeSinceLastSeen: 0,
      reference: { isPossessed: false, state: 'AVAILABLE' }
    };

    const oobTrack = {
      id: 'BALL_OOB',
      status: 'TRACKED',
      isVisible: true,
      confidence: 0.80,
      worldPosition: { x: 25.0, y: 0.12, z: 0.0 }, // Beyond court (+/- 14.5m)
      distance: 25.0,
      azimuthDeg: 0,
      timeSinceLastSeen: 0,
      reference: { isPossessed: false, state: 'AVAILABLE' }
    };

    expect(() => {
      const targetNaN = decisionEngine.selectBestBasketballTarget({
        getTrackedBasketballs: () => [nanTrack]
      }, mockRobot);
      expect(targetNaN).toBeNull();
      expect(decisionEngine.getTargetSelectionDiagnostics().primaryRejectionReason).toBe('INVALID_COORDINATES');

      const targetOOB = decisionEngine.selectBestBasketballTarget({
        getTrackedBasketballs: () => [oobTrack]
      }, mockRobot);
      expect(targetOOB).toBeNull();
      expect(decisionEngine.getTargetSelectionDiagnostics().primaryRejectionReason).toBe('OUT_OF_BOUNDS');
    }).not.toThrow();
  });
});
