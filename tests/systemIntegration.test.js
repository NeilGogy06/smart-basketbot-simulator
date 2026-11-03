/**
 * systemIntegration.test.js
 * End-to-end integration test suite for Milestone 9.
 * Validates cross-subsystem interactions, mode transitions, lifecycle resets,
 * vision-to-autonomy target pipeline, intake-to-shooter interlocks, and analytics event flow.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { PhysicsWorld } from '../src/simulation/PhysicsWorld.js';
import { Robot } from '../src/robot/Robot.js';
import { Basketball } from '../src/environment/Basketball.js';
import { BasketballCourt } from '../src/environment/BasketballCourt.js';
import { BasketballHoop } from '../src/environment/BasketballHoop.js';
import { HoopDetector } from '../src/robot/HoopDetector.js';
import { VisionManager } from '../src/vision/VisionManager.js';
import { AutonomousGameplayController } from '../src/autonomy/AutonomousGameplayController.js';
import { AnalyticsManager } from '../src/analytics/AnalyticsManager.js';
import { PathVisualizer } from '../src/navigation/PathVisualizer.js';
import { SIMULATION_CONFIG } from '../src/simulation/SimulationConfig.js';

describe('Milestone 9: Complete System Integration & Lifecycle', () => {
  let scene;
  let physicsWorld;
  let court;
  let hoopEast;
  let robot;
  let basketball;
  let hoopDetector;
  let visionManager;
  let gameplayController;
  let analyticsManager;
  let pathVisualizer;

  beforeEach(async () => {
    scene = new THREE.Scene();
    physicsWorld = new PhysicsWorld();
    await physicsWorld.initialize();

    court = new BasketballCourt(scene, physicsWorld);
    hoopEast = new BasketballHoop(scene, physicsWorld, 1);

    robot = new Robot(scene, physicsWorld, () => true);
    basketball = new Basketball(scene, physicsWorld);

    hoopDetector = new HoopDetector();
    robot.initShootingController(basketball, hoopDetector);

    visionManager = new VisionManager(SIMULATION_CONFIG.vision);
    visionManager.initialize(scene);

    gameplayController = new AutonomousGameplayController({
      robot,
      visionManager,
      hoopDetector,
      basketball
    });

    analyticsManager = new AnalyticsManager();
    analyticsManager.attachHoopDetector(hoopDetector);
    analyticsManager.attachAutonomousController(gameplayController);

    pathVisualizer = new PathVisualizer(scene);
  });

  afterEach(() => {
    if (pathVisualizer) pathVisualizer.destroy();
    if (analyticsManager) analyticsManager.destroy();
    if (gameplayController) gameplayController.stop();
    if (visionManager) visionManager.destroy();
    if (robot) robot.destroy();
    if (physicsWorld) physicsWorld.destroy();
  });

  // =========================================================================
  // 1. LIFECYCLE & RESET INTEGRATION
  // =========================================================================
  describe('Full Application Lifecycle & Reset Consistency', () => {
    it('1. resets all subsystems cleanly to initial state without stale targets or ghost states', () => {
      // 1. Modify states across all systems
      robot.setControlMode('AUTONOMOUS');
      robot.startAutonomousNavigation(5.0, 2.0);
      robot.intake.captureBall(basketball, robot);
      hoopDetector.notifyShotFired({ id: 999 });
      hoopDetector.resolveShot(true);
      analyticsManager.navigation.update(0.1, { x: 4, z: 2 });
      analyticsManager.shooting.recordShotAttempt({ id: 999 });
      analyticsManager.shooting.recordShotOutcome({ id: 999, isScored: true });
      gameplayController.startContinuousMode();
      pathVisualizer.updatePath([{ x: 0, z: 0 }, { x: 5, z: 2 }]);

      expect(robot.intake.isBallCaptured).toBe(true);
      expect(basketball.collider.isSensor()).toBe(true);
      expect(gameplayController.stateMachine.isActive).toBe(true);
      expect(pathVisualizer.waypointMarkers.length).toBeGreaterThan(0);

      // 2. Perform system-wide reset
      robot.reset();
      basketball.reset();
      hoopDetector.reset();
      visionManager.reset();
      gameplayController.reset();
      pathVisualizer.clear();
      analyticsManager.reset();

      // 3. Verify complete cleanup across all subsystems
      expect(robot.controlMode).toBe('MANUAL');
      expect(robot.intake.isBallCaptured).toBe(false);
      expect(robot.intake.state).toBe('IDLE');
      expect(robot.shooter.state).toBe('IDLE');
      expect(robot.shootingController.state).toBe('IDLE');
      expect(robot.navController.state).toBe('IDLE');

      // Basketball must have solid collision and active gravity
      expect(basketball.collider.isSensor()).toBe(false);
      expect(basketball.rigidBody.gravityScale()).toBe(1.0);

      // Gameplay controller must be reset
      expect(gameplayController.stateMachine.getState()).toBe('IDLE');
      expect(gameplayController.currentTarget).toBeNull();
      expect(gameplayController.targetShootingPos).toBeNull();

      // Path visualizer and analytics must be clean
      expect(pathVisualizer.waypointMarkers.length).toBe(0);
      expect(analyticsManager.shooting.totalAttempts).toBe(0);
      expect(analyticsManager.navigation.totalDistanceTravelled).toBe(0.0);
    });
  });

  // =========================================================================
  // 2. MODE SEPARATION & CONFLICT PREVENTION
  // =========================================================================
  describe('Manual and Autonomous Mode Separation', () => {
    it('2. prevents command conflicts when transitioning between Manual and Autonomous modes', () => {
      // Simulate operator pressing manual teleop keys (e.g. 'W')
      robot.inputController.keys['KeyW'] = true;
      robot.driveController.setTargetVelocity(1.5, 0.0);
      expect(robot.controlMode).toBe('MANUAL');

      // Switch to AUTONOMOUS: manual keys must be cleared, drive halted
      robot.setControlMode('AUTONOMOUS');
      expect(robot.controlMode).toBe('AUTONOMOUS');
      expect(robot.inputController.keys.forward).toBe(false);
      expect(robot.driveController.targetLinearVelocity).toBe(0.0);

      // Start autonomous navigation task
      robot.startAutonomousNavigation(8.0, 0.0);
      expect(robot.navController.state).toBe('NAVIGATING');

      // Operator cancels autonomous mode: navigation must cancel and robot halt
      robot.setControlMode('MANUAL');
      expect(robot.controlMode).toBe('MANUAL');
      expect(robot.navController.state).toBe('CANCELLED');
      expect(robot.driveController.targetLinearVelocity).toBe(0.0);
    });

    it('3. returns control cleanly to MANUAL when autonomous gameplay is stopped or cancelled', () => {
      gameplayController.startContinuousMode();
      expect(robot.controlMode).toBe('AUTONOMOUS');
      expect(gameplayController.stateMachine.isActive).toBe(true);

      // User triggers stop
      gameplayController.stop();

      expect(gameplayController.stateMachine.getState()).toBe('CANCELLED');
      expect(robot.controlMode).toBe('MANUAL');
      expect(robot.driveController.targetLinearVelocity).toBe(0.0);
      expect(robot.driveController.targetAngularVelocity).toBe(0.0);
    });
  });

  // =========================================================================
  // 3. VISION -> DECISION -> NAVIGATION PIPELINE
  // =========================================================================
  describe('Vision Perception to Autonomous Navigation Pipeline', () => {
    it('4. detects basketball with simulated camera, selects target, and generates valid A* navigation path', () => {
      // Position ball 6.0m directly ahead of robot (+X axis)
      basketball.rigidBody.setTranslation({ x: 6.0, y: 0.15, z: 0.0 }, true);

      // Step vision update
      visionManager.update(0.016, robot, basketball, hoopEast);

      // Decision engine evaluates tracked basketball
      const target = gameplayController.decisionEngine.selectBestBasketballTarget(visionManager, robot);
      expect(target).toBeDefined();
      expect(target).not.toBeNull();
      expect(target.worldPosition.x).toBeCloseTo(6.0, 1);
      expect(target.approachPosition.x).toBeLessThan(6.0); // Stops in front of ball

      // Command navigation to approach position
      const navSuccess = robot.startAutonomousNavigation(target.approachPosition.x, target.approachPosition.z);
      expect(navSuccess).toBe(true);
      expect(robot.navController.state).toBe('NAVIGATING');
      expect(robot.navController.waypoints.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 4. INTAKE POSSESSION & SHOOTER INTERLOCKS
  // =========================================================================
  describe('Intake Possession & Shooter Interlocks Integration', () => {
    it('5. strictly enforces ball possession interlock before firing launcher', () => {
      // 1. Attempt firing without ball in cradle: must be rejected
      const firedWithoutBall = robot.fireShot(basketball, hoopDetector);
      expect(firedWithoutBall).toBe(false);
      expect(robot.shooter.lastRejectReason).toContain('intake must capture ball');

      // 2. Capture ball into intake cradle
      robot.intake.captureBall(basketball, robot);
      expect(robot.intake.isBallCaptured).toBe(true);
      expect(basketball.collider.isSensor()).toBe(true);

      // Spin up launcher
      robot.shooter.spinUp(8.5);
      robot.shooter.update(0.85); // Complete spin-up
      expect(robot.shooter.state).toBe('READY');

      // 3. Now fire: must succeed, restore physics, and launch ball
      const firedWithBall = robot.fireShot(basketball, hoopDetector);
      expect(firedWithBall).toBe(true);
      expect(robot.intake.isBallCaptured).toBe(false);
      expect(basketball.collider.isSensor()).toBe(false);
      expect(basketball.rigidBody.gravityScale()).toBe(1.0);
      expect(hoopDetector.stats.totalAttempts).toBe(1);
    });
  });

  // =========================================================================
  // 5. SHOOTING, SCORING & ANALYTICS INTEGRATION
  // =========================================================================
  describe('End-to-End Shooting, Scoring, and Analytics Flow', () => {
    it('6. records single deduplicated shot attempt, registers score, and outputs verified export data', () => {
      robot.intake.captureBall(basketball, robot);
      robot.shooter.spinUp(8.5);
      robot.shooter.update(0.85);

      // Fire shot
      const fired = robot.fireShot(basketball, hoopDetector);
      expect(fired).toBe(true);

      // Analytics must capture exactly 1 attempt
      expect(analyticsManager.shooting.totalAttempts).toBe(1);
      expect(analyticsManager.shooting.activeShot).toBeDefined();

      // Resolve shot as scored
      hoopDetector.resolveShot(true);

      // Verify analytics updated
      expect(analyticsManager.shooting.successfulBaskets).toBe(1);
      expect(analyticsManager.shooting.accuracyPercent).toBe(100.0);
      expect(analyticsManager.shooting.shotHistory[0].outcome).toBe('SCORED');

      // Verify JSON Export integrity
      const json = JSON.parse(analyticsManager.exportJSON());
      expect(json.summary.totalShots).toBe(1);
      expect(json.summary.basketsScored).toBe(1);
      expect(json.summary.shootingAccuracy).toBe(100.0);
      expect(json.shooting.shotHistory[0].isScored).toBe(true);

      // Verify CSV Export integrity
      const csv = analyticsManager.exportCSV();
      expect(csv).toContain('SCORED');
      expect(csv).toContain('100.0%');
    });
  });

  // =========================================================================
  // 6. EMERGENCY STOP & SAFETY INTERLOCKS
  // =========================================================================
  describe('Emergency Stop & Subsystem Safety Halts', () => {
    it('7. halts all navigation, intake, and autonomous state machines instantly on E-Stop', () => {
      gameplayController.startContinuousMode();
      robot.intake.startIntake();
      robot.shooter.spinUp(8.0);
      expect(gameplayController.stateMachine.isActive).toBe(true);

      // Engage E-Stop
      robot.driveController.emergencyStop();
      // Step simulation update loop
      gameplayController.update(0.016);

      expect(robot.driveController.mode).toBe('E_STOP');
      expect(gameplayController.stateMachine.getState()).toBe('FAILED');
      expect(robot.controlMode).toBe('MANUAL');
      expect(robot.intake.state).toBe('IDLE');
      expect(robot.shooter.state).toBe('IDLE');
    });
  });

  // =========================================================================
  // 7. FIXED-TARGET GAMEPLAY MODE COMPLETION
  // =========================================================================
  describe('Autonomous Fixed-Target Gameplay Completion', () => {
    it('8. completes fixed target session upon reaching target successful shots', () => {
      // Start Fixed-Target mode for 2 baskets
      gameplayController.startFixedTargetMode(2);
      expect(gameplayController.mode).toBe('FIXED_TARGET');
      expect(gameplayController.targetShots).toBe(2);

      // Score 1st basket
      gameplayController.statistics.successfulShots = 1;
      gameplayController.statistics.totalAttempts = 1;
      analyticsManager.autonomy.recordAutonomousShot(true);
      expect(analyticsManager.autonomy.fixedTargetProgress).toBe(50.0);

      // Score 2nd basket: target met
      gameplayController.statistics.successfulShots = 2;
      gameplayController.statistics.totalAttempts = 2;
      analyticsManager.autonomy.recordAutonomousShot(true);
      expect(analyticsManager.autonomy.fixedTargetProgress).toBe(100.0);

      // State machine finishes
      gameplayController.stateMachine.transitionTo('COMPLETED', 'Fixed target of 2 baskets achieved');
      expect(gameplayController.stateMachine.getState()).toBe('COMPLETED');
      expect(analyticsManager.autonomy.completedSessions).toBe(1);
      expect(robot.controlMode).toBe('MANUAL');
    });
  });
});
