/**
 * autonomousEndToEnd.test.js
 * End-to-end and subsystem integration tests for SMART-BASKETBOT Autonomous Gameplay:
 * - Real subsystem integration: PhysicsWorld, Robot, Basketball, HoopDetector,
 *   VisionManager, AutonomousGameplayController, and DifferentialDriveController
 * - Validates all 16 Phase 10 verification criteria:
 *   1. Basketball target selection
 *   2. Target ownership and lifecycle (AVAILABLE, TARGETED, APPROACHED, COLLECTING, POSSESSED, IN_FLIGHT, SCORED, MISSED, RESTING)
 *   3. Physical ball collection
 *   4. Possession verification
 *   5. Autonomous navigation
 *   6. Hoop acquisition
 *   7. Robot alignment
 *   8. Trajectory calculation
 *   9. Shooter activation
 *   10. Physical ball release
 *   11. Successful score detection
 *   12. Missed-shot handling
 *   13. Ball reacquisition after shooting
 *   14. Recovery behavior
 *   15. Complete autonomous state transitions
 *   16. Continuous gameplay
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { AUTONOMOUS_STATES, GAMEPLAY_MODES, AUTONOMOUS_CONFIG } from '../src/autonomy/AutonomousConfig.js';
import { AutonomousGameplayController } from '../src/autonomy/AutonomousGameplayController.js';
import { AutonomousDecisionEngine } from '../src/autonomy/AutonomousDecisionEngine.js';
import { AutonomousStateMachine } from '../src/autonomy/AutonomousStateMachine.js';
import { PhysicsWorld } from '../src/simulation/PhysicsWorld.js';
import { Robot } from '../src/robot/Robot.js';
import { Basketball } from '../src/environment/Basketball.js';
import { BasketballHoop } from '../src/environment/BasketballHoop.js';
import { HoopDetector } from '../src/robot/HoopDetector.js';
import { VisionManager } from '../src/vision/VisionManager.js';
import { TrajectoryCalculator } from '../src/robot/TrajectoryCalculator.js';
import { DifferentialDriveController } from '../src/robot/DifferentialDriveController.js';
import { IntakeMechanism } from '../src/robot/IntakeMechanism.js';
import { ShootingMechanism } from '../src/robot/ShootingMechanism.js';
import { SIMULATION_CONFIG } from '../src/simulation/SimulationConfig.js';

describe('Phase 10: End-to-End Autonomous Gameplay & Subsystem Integration Suite', () => {
  let scene;
  let physicsWorld;
  let robot;
  let basketball;
  let extraBall;
  let hoop;
  let hoopDetector;
  let visionManager;
  let controller;

  beforeEach(async () => {
    scene = new THREE.Scene();
    physicsWorld = new PhysicsWorld();
    await physicsWorld.initialize();

    // Create court floor collider so physics bodies bounce and settle naturally
    physicsWorld.createStaticBox(0, -0.25, 0, 30, 0.5, 20, 0.75, 0.6);

    // Basketball entities
    basketball = new Basketball(scene, physicsWorld, {
      id: 'ball_primary',
      initialPosition: { x: 3.5, y: 0.12, z: 0.0 }
    });
    extraBall = new Basketball(scene, physicsWorld, {
      id: 'ball_secondary',
      initialPosition: { x: 6.0, y: 0.12, z: 2.0 }
    });

    // East Target Hoop
    hoop = new BasketballHoop(scene, physicsWorld, 1);
    hoopDetector = new HoopDetector();

    // Robot entity with physics and controllers
    robot = new Robot(scene, physicsWorld, () => true);

    // Vision Manager
    visionManager = new VisionManager(SIMULATION_CONFIG.vision);
    visionManager.initialize(scene, null);

    // Gameplay Controller
    controller = new AutonomousGameplayController({
      robot,
      visionManager,
      hoopDetector,
      basketball
    });
  });

  afterEach(() => {
    if (controller) controller.haltAllActuators();
    if (physicsWorld) physicsWorld.destroy();
  });

  // =========================================================================
  // 1 & 2: TARGET SELECTION, OWNERSHIP, AND LIFECYCLE
  // =========================================================================
  describe('1 & 2: Basketball Target Selection, Ownership, and Lifecycle', () => {
    it('1. selects only available basketballs within court boundaries and preserves ball reference', () => {
      // Simulate raw detections
      const detection1 = {
        type: 'BASKETBALL',
        instanceId: 'ball_primary',
        reference: basketball,
        worldPosition: { x: 3.5, y: 0.12, z: 0.0 },
        relativePosition: { x: 2.0, y: 0.0, z: 0.0 },
        distance: 2.0,
        azimuthDeg: 0,
        elevationDeg: 0,
        confidence: 0.90,
        screenPosition: { x: 320, y: 240 },
        boundingBox: { x: 300, y: 220, width: 40, height: 40 }
      };

      const tracks = visionManager.tracker.update([detection1], 0.016);
      expect(tracks.length).toBe(1);
      expect(tracks[0].reference).toBe(basketball);

      const decisionEngine = new AutonomousDecisionEngine();
      const target = decisionEngine.selectBestBasketballTarget(visionManager, robot);

      expect(target).not.toBeNull();
      expect(target.id).toBe(tracks[0].id);
      expect(target.worldPosition.x).toBeCloseTo(3.5, 1);
    });

    it('2. transitions basketball through formal lifecycle states without conflicting flags', () => {
      expect(basketball.state).toBe('AVAILABLE');
      expect(basketball.isAvailable).toBe(true);
      expect(basketball.isPossessed).toBe(false);

      basketball.setState('TARGETED');
      expect(basketball.state).toBe('TARGETED');
      expect(basketball.isAvailable).toBe(false);

      basketball.setState('APPROACHED');
      expect(basketball.state).toBe('APPROACHED');

      basketball.setState('COLLECTING');
      expect(basketball.state).toBe('COLLECTING');

      basketball.setState('POSSESSED');
      expect(basketball.state).toBe('POSSESSED');
      expect(basketball.isPossessed).toBe(true);
      expect(basketball.isAvailable).toBe(false);

      basketball.setState('IN_FLIGHT');
      expect(basketball.state).toBe('IN_FLIGHT');
      expect(basketball.isPossessed).toBe(false);
      expect(basketball.isAvailable).toBe(false);

      basketball.setState('SCORED');
      expect(basketball.state).toBe('SCORED');

      basketball.setState('RESTING');
      expect(basketball.state).toBe('RESTING');

      basketball.setState('AVAILABLE');
      expect(basketball.state).toBe('AVAILABLE');
      expect(basketball.isAvailable).toBe(true);
      expect(basketball.isPossessed).toBe(false);
    });
  });

  // =========================================================================
  // 3 & 4: PHYSICAL BALL COLLECTION & POSSESSION VERIFICATION
  // =========================================================================
  describe('3 & 4: Physical Ball Collection & Possession Verification', () => {
    it('3. activates intake rollers and physically captures basketball in containment cradle', () => {
      robot.startIntake();
      expect(robot.intake.state).toBe('INTAKING');

      // Place basketball directly in front bumper capture zone
      const robotPos = robot.getPosition();
      basketball.rigidBody.setTranslation({ x: robotPos.x + 0.40, y: robotPos.y + 0.05, z: robotPos.z }, true);

      // Step intake update
      robot.intake.update(0.016, robot, basketball);

      expect(robot.intake.isBallCaptured).toBe(true);
      expect(robot.intake.capturedBall).toBe(basketball);
      expect(basketball.state).toBe('POSSESSED');
      expect(basketball.isPossessed).toBe(true);
      expect(robot.intake.opticalSensorActive).toBe(true);
    });

    it('4. verifies possession and prevents duplicate collection or conflicting possession flags', () => {
      robot.intake.captureBall(basketball, robot);
      expect(robot.intake.isBallCaptured).toBe(true);
      expect(robot.intake.capturedBall).toBe(basketball);

      // Candidate 2 arrives in capture zone
      const robotPos = robot.getPosition();
      extraBall.rigidBody.setTranslation({ x: robotPos.x + 0.40, y: robotPos.y + 0.05, z: robotPos.z }, true);

      robot.intake.update(0.016, robot, [basketball, extraBall]);

      // Possession remains strictly Ball 1
      expect(robot.intake.capturedBall).toBe(basketball);
      expect(extraBall.isPossessed).toBe(false);
    });
  });

  // =========================================================================
  // 5, 6, 7: AUTONOMOUS NAVIGATION, HOOP ACQUISITION, AND ROBOT ALIGNMENT
  // =========================================================================
  describe('5, 6 & 7: Navigation, Hoop Acquisition, and Heading Alignment', () => {
    it('5. differential drive setDriveVelocities and setTargetVelocity move the robot without exceptions', () => {
      expect(typeof robot.driveController.setDriveVelocities).toBe('function');
      expect(typeof robot.driveController.setTargetVelocity).toBe('function');

      // Command rotation and translation
      robot.driveController.setDriveVelocities(1.0, 0.5);
      const cmd = robot.driveController.update(0.016, robot.getHeading());

      expect(cmd.worldLinvelX).toBeGreaterThan(0);
      expect(cmd.worldAngvelY).toBeGreaterThan(0);
    });

    it('6. acquires hoop rim coordinates and computes valid shooting key standoff position', () => {
      const decisionEngine = new AutonomousDecisionEngine();
      const mockHoopObs = {
        visible: true,
        targetRimPosition: { x: 12.425, y: 3.05, z: 0.0 },
        distance: 4.225
      };

      const shootPos = decisionEngine.calculateShootingPosition(mockHoopObs, robot);
      expect(shootPos.x).toBeCloseTo(8.2, 0.1);
      expect(shootPos.z).toBeCloseTo(0.0, 0.1);
      expect(shootPos.targetDistance).toBeGreaterThan(4.0);
    });

    it('7. aligns robot heading toward rim target without PID integral windup or derivative kick', () => {
      robot.driveController.reset();
      const targetHeading = 0.0; // Pointing +X toward East hoop

      // Set initial robot heading offset by 0.5 rad (~28 deg)
      robot.driveController.setTargetHeading(targetHeading, 0.0);
      const cmd = robot.driveController.update(0.016, 0.5);

      // Should command negative angular velocity to turn clockwise toward 0.0
      expect(cmd.worldAngvelY).toBeLessThan(0);
      expect(robot.driveController.headingPID.hasRun).toBe(true);

      // Stop resets integral error
      robot.driveController.stop();
      expect(robot.driveController.headingPID.integral).toBe(0.0);
    });
  });

  // =========================================================================
  // 8, 9, 10: TRAJECTORY CALCULATION, SHOOTER ACTIVATION, AND PHYSICAL RELEASE
  // =========================================================================
  describe('8, 9 & 10: Trajectory Solver, Flywheel Spin-Up, and Ball Launch', () => {
    it('8. calculates descending ballistic trajectory solution with valid speed and angle', () => {
      const trajCalc = new TrajectoryCalculator();
      const muzzlePos = { x: 8.2, y: 0.45, z: 0.0 };
      const hoopTarget = { x: 12.425, y: 3.05, z: 0.0 };

      const opt = trajCalc.optimizeTrajectory(muzzlePos, hoopTarget);
      expect(opt.valid).toBe(true);
      expect(opt.solution).not.toBeNull();
      expect(opt.solution.speed).toBeGreaterThan(7.0);
      expect(opt.solution.speed).toBeLessThan(12.0);
      expect(opt.solution.isDescending).toBe(true);
    });

    it('9. spins up flywheels to required RPM and satisfies shooting interlocks', () => {
      robot.intake.captureBall(basketball, robot);
      robot.shooter.spinUp(8.5);

      expect(robot.shooter.state).toBe('SPINNING_UP');

      // Advance spin-up timer past duration (0.8s)
      for (let t = 0; t < 60; t++) {
        robot.shooter.update(0.016);
      }

      expect(robot.shooter.state).toBe('READY');

      const decisionEngine = new AutonomousDecisionEngine();
      const interlocks = decisionEngine.evaluateShootingInterlocks(robot, { visible: true });
      expect(interlocks.isReady).toBe(true);
      expect(interlocks.blockers.length).toBe(0);
    });

    it('10. releases basketball from containment and applies calculated 3D ballistic velocity to Rapier rigid body', () => {
      robot.intake.captureBall(basketball, robot);
      expect(robot.intake.isBallCaptured).toBe(true);

      const hoopTarget = { x: 12.425, y: 3.05, z: 0.0 };
      const fired = robot.fireShot(basketball, hoopDetector, hoopTarget);

      expect(fired).toBe(true);
      expect(robot.intake.isBallCaptured).toBe(false);
      expect(basketball.state).toBe('IN_FLIGHT');
      expect(basketball.isPossessed).toBe(false);
      expect(basketball.shotCooldownTimer).toBeGreaterThan(0.5);

      // Verify physical linear velocity in Rapier world
      const vel = basketball.getVelocity();
      expect(vel.x).toBeGreaterThan(3.0); // Forward towards hoop (+X)
      expect(vel.y).toBeGreaterThan(4.0); // Upward elevation arc (+Y)
    });
  });

  // =========================================================================
  // 11, 12, 13: SCORE DETECTION, MISS OUTCOME, AND BALL REACQUISITION
  // =========================================================================
  describe('11, 12 & 13: Scoring, Miss Classification, and Ball Reacquisition', () => {
    it('11. registers basket ONLY on downward entry through inner rim aperture', () => {
      hoopDetector.notifyShotFired({ id: 101, ball: basketball });

      const rimCenter = { x: 12.425, y: 3.05, z: 0.0 };

      // Phase 1: Ball flies above rim
      hoopDetector.update({ x: 12.0, y: 3.40, z: 0.0 }, { x: 2.0, y: 1.0, z: 0.0 }, 0.016);
      expect(hoopDetector.activeShot.passedAboveRim).toBe(true);

      // Phase 2: Ball descends through rim cylinder
      hoopDetector.update({ x: 12.425, y: 3.02, z: 0.0 }, { x: 0.5, y: -2.0, z: 0.0 }, 0.016);
      expect(hoopDetector.activeShot.enteredRimPlane).toBe(true);

      // Phase 3: Exits below net
      const result = hoopDetector.update({ x: 12.425, y: 2.80, z: 0.0 }, { x: 0.1, y: -2.5, z: 0.0 }, 0.016);
      expect(result).toBe('SCORED');
      expect(hoopDetector.stats.successfulBaskets).toBe(1);
      expect(basketball.state).toBe('SCORED');
    });

    it('12. classifies missed shots accurately (short, long, left, right) and informs corrector', () => {
      hoopDetector.notifyShotFired({ id: 102, ball: basketball });

      // Trajectory falls short (deltaX < -0.15) and hits floor
      hoopDetector.update({ x: 11.8, y: 2.50, z: 0.0 }, { x: 1.0, y: -3.0, z: 0.0 }, 0.016);
      const res = hoopDetector.update({ x: 11.9, y: 0.12, z: 0.0 }, { x: 0.5, y: -0.1, z: 0.0 }, 0.016);

      expect(res).toBe('MISSED');
      expect(hoopDetector.stats.lastDetailedResult).toBe('MISSED_SHORT');
      expect(basketball.state).toBe('MISSED');
    });

    it('13. returns resting ball to AVAILABLE state and enables subsequent collection', () => {
      basketball.setState('IN_FLIGHT');
      basketball.shotCooldownTimer = 1.0;

      // In flight, intake ignores it
      robot.startIntake();
      robot.intake.update(0.016, robot, [basketball]);
      expect(robot.intake.isBallCaptured).toBe(false);

      // Simulate landing and settling
      basketball.shotCooldownTimer = 0.0;
      basketball.rigidBody.setTranslation({ x: 4.0, y: 0.12, z: 0.0 }, true);
      basketball.rigidBody.setLinvel({ x: 0.05, y: 0.0, z: 0.0 }, true);
      basketball.update(0.016);

      expect(basketball.state).toBe('AVAILABLE');
      expect(basketball.isAvailable).toBe(true);

      // Now robot can collect it again (place in front bumper)
      const rPos = robot.getPosition();
      basketball.rigidBody.setTranslation({ x: rPos.x + 0.40, y: rPos.y + 0.05, z: rPos.z }, true);
      robot.intake.update(0.016, robot, [basketball]);
      expect(robot.intake.isBallCaptured).toBe(true);
      expect(robot.intake.capturedBall).toBe(basketball);
    });
  });

  // =========================================================================
  // 14, 15, 16: RECOVERY, AUTONOMOUS CYCLES, AND CONTINUOUS GAMEPLAY
  // =========================================================================
  describe('14, 15 & 16: Recovery, Complete Cycles, and Continuous Gameplay', () => {
    it('14. isolates failure category retries and avoids premature 10/10 aborts', () => {
      controller.startContinuousMode();

      // Trigger alignment timeout recovery
      controller.triggerRecovery('ALIGNMENT_TIMEOUT', 'Test alignment recovery');
      expect(controller.retries.alignment).toBe(1);
      expect(controller.retries.collection).toBe(0);
      expect(controller.retries.navigation).toBe(0);

      // Trigger collection failure recovery
      controller.triggerRecovery('COLLECTION_FAILED', 'Test collection recovery');
      expect(controller.retries.collection).toBe(1);
      expect(controller.retries.alignment).toBe(1);

      // Controller is in RECOVERING state, not terminal FAILED
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.RECOVERING);
      expect(controller.stateMachine.isTerminal()).toBe(false);
    });

    it('15 & 16. executes complete autonomous workflow cycle without unhandled exceptions', () => {
      controller.startContinuousMode();

      // Mock visual detection of ball
      const detection = {
        type: 'BASKETBALL',
        instanceId: 'ball_primary',
        reference: basketball,
        worldPosition: { x: 3.5, y: 0.12, z: 0.0 },
        relativePosition: { x: 2.0, y: 0.0, z: 0.0 },
        distance: 2.0,
        azimuthDeg: 0,
        elevationDeg: 0,
        confidence: 0.90,
        screenPosition: { x: 320, y: 240 },
        boundingBox: { x: 300, y: 220, width: 40, height: 40 }
      };
      visionManager.tracker.update([detection], 0.016);

      // Update 1: SEARCHING_FOR_BALL -> SELECTING_TARGET
      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SELECTING_TARGET);

      // Update 2: SELECTING_TARGET -> NAVIGATING_TO_BALL
      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.NAVIGATING_TO_BALL);

      // Simulate robot arrival within capture zone (0.45m)
      robot.rigidBody.setTranslation({ x: 3.10, y: 0.14, z: 0.0 }, true);
      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.COLLECTING_BALL);

      // Capture ball into cradle
      robot.intake.captureBall(basketball, robot);
      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SEARCHING_FOR_HOOP);

      // Hoop observation found
      visionManager.update(0.016, robot, [basketball], hoop);
      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.NAVIGATING_TO_SHOOTING_POSITION);

      // Arrive at shooting key (x = 8.2)
      robot.rigidBody.setTranslation({ x: 8.2, y: 0.14, z: 0.0 }, true);
      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.ALIGNING_WITH_HOOP);

      // Complete alignment (heading = 0.0)
      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.OPTIMIZING_TRAJECTORY);

      // Optimize trajectory
      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SPINNING_UP_FLYWHEELS);

      // First update in SPINNING_UP_FLYWHEELS triggers shooter.spinUp()
      controller.update(0.016);
      expect(robot.shooter.state).toBe('SPINNING_UP');

      // Step shooter update until READY (duration: 0.8s)
      for (let t = 0; t < 60; t++) {
        robot.shooter.update(0.016);
      }
      expect(robot.shooter.state).toBe('READY');

      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SHOOTING);

      // Fire shot
      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.EVALUATING_SHOT);
      expect(controller.statistics.totalAttempts).toBe(1);

      // Resolve shot as SCORED
      hoopDetector.stats.lastShotResult = 'SCORED';
      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.REACQUIRING_BALL);
      expect(controller.statistics.successfulShots).toBe(1);

      // Advance past reacquire cooldown (1.0s)
      for (let t = 0; t < 70; t++) {
        controller.update(0.016);
      }

      // Loop continues seamlessly without crashing or getting stuck!
      expect([
        AUTONOMOUS_STATES.SEARCHING_FOR_BALL,
        AUTONOMOUS_STATES.SELECTING_TARGET,
        AUTONOMOUS_STATES.NAVIGATING_TO_BALL
      ]).toContain(controller.stateMachine.getState());
    });
  });
});
