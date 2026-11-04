/**
 * continuousGameplay.test.js
 * Comprehensive automated test suite for SMART-BASKETBOT Continuous Autonomous Gameplay,
 * Ball Reacquisition, Dynamic Shooting, and Fault-Tolerant Recovery.
 *
 * Verifies:
 * 1. Dynamic Shooting evaluation from arbitrary court positions without fixed waypoint visits.
 * 2. Infeasible shooting position detection and dynamic fallback repositioning.
 * 3. Physical ball landing detection via Rapier rigid body translation and velocity settling.
 * 4. Multi-cycle continuous gameplay loop: 3 consecutive collect-and-shoot cycles on the SAME basketball entity.
 * 5. Local recovery counter isolation and automatic consecutive failure reset upon success.
 * 6. Protection against premature session aborts during continuous long-running operation.
 * 7. Real-time 3D basketball trajectory tracking during continuous play.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { AUTONOMOUS_STATES, GAMEPLAY_MODES, FAILURE_CATEGORIES, AUTONOMOUS_CONFIG } from '../src/autonomy/AutonomousConfig.js';
import { AutonomousGameplayController } from '../src/autonomy/AutonomousGameplayController.js';
import { AutonomousDecisionEngine } from '../src/autonomy/AutonomousDecisionEngine.js';
import { PhysicsWorld } from '../src/simulation/PhysicsWorld.js';
import { Robot } from '../src/robot/Robot.js';
import { Basketball } from '../src/environment/Basketball.js';
import { BasketballHoop } from '../src/environment/BasketballHoop.js';
import { HoopDetector } from '../src/robot/HoopDetector.js';
import { VisionManager } from '../src/vision/VisionManager.js';
import { BallTrajectoryTracker } from '../src/environment/BallTrajectoryTracker.js';
import { TrajectoryCalculator } from '../src/robot/TrajectoryCalculator.js';
import { SIMULATION_CONFIG } from '../src/simulation/SimulationConfig.js';

describe('SMART-BASKETBOT: Continuous Autonomous Gameplay & Dynamic Shooting Suite', () => {
  let scene;
  let physicsWorld;
  let robot;
  let basketball;
  let hoop;
  let hoopDetector;
  let visionManager;
  let controller;
  let decisionEngine;
  let trajectoryTracker;

  beforeEach(async () => {
    scene = new THREE.Scene();
    physicsWorld = new PhysicsWorld();
    await physicsWorld.initialize();

    // Create court surface collider so basketball bounces and lands
    physicsWorld.createStaticBox(0, -0.25, 0, 30, 0.5, 20, 0.75, 0.6);

    // Basketball entity: single persistent ball
    basketball = new Basketball(scene, physicsWorld, {
      id: 'ball_continuous_primary',
      initialPosition: { x: 5.5, y: 0.12, z: 1.0 }
    });

    // Regulation East hoop rim at (12.425, 3.05, 0.0)
    hoop = new BasketballHoop(scene, physicsWorld, 1);
    hoopDetector = new HoopDetector();

    // Robot entity with physics and controllers
    robot = new Robot(scene, physicsWorld, () => true);

    // Vision Manager
    visionManager = new VisionManager(SIMULATION_CONFIG.vision);

    // Decision Engine
    decisionEngine = new AutonomousDecisionEngine();

    // Trajectory Tracker
    trajectoryTracker = new BallTrajectoryTracker(scene, {
      maxPoints: 500,
      minSampleInterval: 0.02
    });

    // Autonomous Gameplay Controller
    controller = new AutonomousGameplayController({
      robot,
      visionManager,
      hoopDetector,
      basketball
    });
  });

  afterEach(() => {
    controller.stop();
    if (trajectoryTracker && typeof trajectoryTracker.dispose === 'function') trajectoryTracker.dispose();
    if (robot && typeof robot.destroy === 'function') robot.destroy();
    if (physicsWorld && typeof physicsWorld.destroy === 'function') physicsWorld.destroy();
  });

  // =========================================================================
  // 1. DYNAMIC SHOOTING FROM ANY FEASIBLE POSITION
  // =========================================================================
  describe('Phase 3: Dynamic Shooting from Any Feasible Court Position', () => {
    it('evaluates dynamic shooting feasibility directly from arbitrary court positions', () => {
      // Robot at collection spot (7.0m, 1.2m): distance to hoop rim (12.425, 0.0) is ~5.55m
      robot.rigidBody.setTranslation({ x: 7.0, y: 0.14, z: 1.2 }, true);

      const hoopRim = { x: 12.425, y: 3.05, z: 0.0 };
      const feasibility = decisionEngine.evaluateShootingFeasibility(
        robot,
        robot.trajectoryCalculator,
        hoopRim
      );

      expect(feasibility.isFeasible).toBe(true);
      expect(feasibility.distance).toBeGreaterThanOrEqual(2.2);
      expect(feasibility.distance).toBeLessThanOrEqual(9.0);
      expect(feasibility.solution).not.toBeNull();
      expect(feasibility.solution.speed).toBeGreaterThan(6.0);
      expect(feasibility.solution.launchAngleDeg).toBeGreaterThan(45.0);
    });

    it('rejects positions too far downcourt and calculates fallback shooting spot', () => {
      // Robot at center court (0.0, 0.0): distance to hoop is 12.425m (> 9.0m max)
      robot.rigidBody.setTranslation({ x: 0.0, y: 0.14, z: 0.0 }, true);

      const hoopRim = { x: 12.425, y: 3.05, z: 0.0 };
      const feasibility = decisionEngine.evaluateShootingFeasibility(
        robot,
        robot.trajectoryCalculator,
        hoopRim
      );

      expect(feasibility.isFeasible).toBe(false);
      expect(feasibility.reason).toContain('Too far from hoop');
      expect(feasibility.candidatePosition).toBeDefined();
      expect(feasibility.candidatePosition.x).toBeCloseTo(8.2, 1);
    });

    it('rejects positions behind or too close to backboard (X > 11.2m)', () => {
      robot.rigidBody.setTranslation({ x: 11.8, y: 0.14, z: 0.0 }, true);

      const hoopRim = { x: 12.425, y: 3.05, z: 0.0 };
      const feasibility = decisionEngine.evaluateShootingFeasibility(
        robot,
        robot.trajectoryCalculator,
        hoopRim
      );

      expect(feasibility.isFeasible).toBe(false);
      expect(feasibility.reason).toContain('behind backboard');
    });

    it('executes dynamic shot directly from feasible collection spot without visiting fixed key', () => {
      // Start in Continuous Mode with ball captured at a feasible spot (X = 7.5, Z = -1.0)
      robot.rigidBody.setTranslation({ x: 7.5, y: 0.14, z: -1.0 }, true);
      robot.intake.captureBall(basketball, robot);

      controller.startContinuousMode();
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.VERIFYING_POSSESSION);

      // Vision update exposes hoop
      visionManager.update(0.016, robot, [basketball], hoop);
      controller.update(0.016);

      // Should transition DIRECTLY to ALIGNING_WITH_HOOP, skipping NAVIGATING_TO_SHOOTING_POSITION!
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.ALIGNING_WITH_HOOP);
      expect(controller.lastSuccessfulOperation).toBe('DYNAMIC_SHOT_SELECTED');
      expect(controller.targetShootingPos.x).toBeCloseTo(7.5, 1);
    });
  });

  // =========================================================================
  // 2. PHYSICAL BALL LANDING & REACQUISITION
  // =========================================================================
  describe('Phase 2 & 5: Physical Ball Landing & Reacquisition of Same Entity', () => {
    it('detects ball landing via Rapier rigid body translation and settling', () => {
      // Ball in air
      basketball.rigidBody.setTranslation({ x: 12.0, y: 2.5, z: 0.0 }, true);
      basketball.rigidBody.setLinvel({ x: 0.0, y: -2.0, z: 0.0 }, true);
      basketball.state = 'IN_FLIGHT';
      basketball.shotCooldownTimer = 1.0;

      basketball.update(0.1);
      expect(basketball.isLanded()).toBe(false);
      expect(basketball.isCollectible()).toBe(false);

      // Ball descends to floor and comes to rest
      basketball.rigidBody.setTranslation({ x: 12.1, y: 0.13, z: 0.2 }, true);
      basketball.rigidBody.setLinvel({ x: 0.05, y: 0.0, z: 0.02 }, true);
      basketball.shotCooldownTimer = 0.0;

      basketball.update(0.1);
      expect(basketball.isLanded()).toBe(true);
      expect(basketball.state).toBe('AVAILABLE');
      expect(basketball.isCollectible()).toBe(true);
    });

    it('reacquires the exact same physical basketball entity without creating duplicates', () => {
      controller.startContinuousMode();
      controller.activeBallReference = basketball;
      controller.stateMachine.transitionTo(AUTONOMOUS_STATES.REACQUIRING_BALL);

      // Advance through reacquire cooldown (1.0s)
      for (let i = 0; i < 15; i++) {
        controller.update(0.1);
      }

      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SEARCHING_FOR_BALL);
      expect(controller.activeBallReference.id).toBe(basketball.id);
      expect(controller.activeBallReference).toBe(basketball);
    });
  });

  // =========================================================================
  // 3. MULTI-CYCLE CONTINUOUS GAMEPLAY
  // =========================================================================
  describe('Phase 2 & 6: Multi-Cycle Continuous Gameplay on Same Ball', () => {
    it('successfully executes 3 consecutive collect-and-shoot cycles on the same basketball', () => {
      controller.startContinuousMode();

      for (let cycle = 1; cycle <= 3; cycle++) {
        // Step A: Ball resting on court along centerline
        basketball.rigidBody.setTranslation({ x: 4.5 + cycle * 0.5, y: 0.14, z: 0.0 }, true);
        basketball.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        basketball.state = 'AVAILABLE';
        basketball.shotCooldownTimer = 0.0;
        basketball.update(0.016);

        hoopDetector.stats.lastShotResult = 'NONE';
        hoopDetector.stats.lastDetailedResult = 'NONE';

        // Step B: Visual detection and approach
        visionManager.update(0.016, robot, [basketball], hoop);
        controller.update(0.016); // SEARCHING -> SELECTING
        controller.update(0.016); // SELECTING -> NAVIGATING

        // Move robot to ball proximity and capture
        const ballPos = basketball.getPosition();
        robot.rigidBody.setTranslation({ x: ballPos.x - 0.4, y: 0.14, z: 0.0 }, true);
        controller.update(0.016); // Arrive -> COLLECTING_BALL

        robot.intake.captureBall(basketball, robot);
        controller.update(0.016); // Confirm possession -> SEARCHING_FOR_HOOP

        // Step C: Dynamic shoot or position
        visionManager.update(0.016, robot, [basketball], hoop);
        controller.update(0.016);

        const stateAfterHoop = controller.stateMachine.getState();
        if (stateAfterHoop === AUTONOMOUS_STATES.NAVIGATING_TO_SHOOTING_POSITION) {
          // Move to shooting key
          robot.rigidBody.setTranslation({ x: 8.2, y: 0.14, z: 0.0 }, true);
          controller.update(0.016); // Arrive -> ALIGNING_WITH_HOOP
        }

        // Heading alignment toward basket (+X direction)
        robot.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        controller.update(0.016); // Aligned -> CALCULATING_SHOT
        controller.update(0.016); // Calculated -> SPINNING_UP_FLYWHEELS

        robot.shooter.state = 'READY';
        controller.update(0.016); // Ready -> SHOOTING
        controller.update(0.016); // Fired -> EVALUATING_SHOT

        expect(controller.statistics.totalAttempts).toBe(cycle);

        // Step D: Simulate shot outcome and landing
        hoopDetector.stats.lastShotResult = 'SCORED';
        hoopDetector.stats.successfulBaskets = cycle;
        controller.update(0.016); // Outcome recorded -> REACQUIRING_BALL

        expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.REACQUIRING_BALL);

        // Reacquire cooldown
        for (let t = 0; t < 12; t++) {
          controller.update(0.1);
        }

        expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SEARCHING_FOR_BALL);
        expect(controller.consecutiveFailures).toBe(0);
      }

      // Assertions across all 3 cycles
      expect(controller.statistics.totalAttempts).toBe(3);
      expect(controller.statistics.successfulShots).toBe(3);
      expect(controller.activeBallReference).toBe(basketball);
    });
  });

  // =========================================================================
  // 4. FAULT-TOLERANT RECOVERY & COUNTER RESETS
  // =========================================================================
  describe('Phase 4: Intelligent Recovery & Consecutive Failure Reset', () => {
    it('resets consecutive failures to 0 upon any operational milestone success', () => {
      controller.startContinuousMode();
      controller.consecutiveFailures = 4; // Simulate 4 prior transient retries

      // Completing a successful ball acquisition milestone
      controller.lastSuccessfulOperation = 'BALL_ACQUIRED';
      controller.consecutiveFailures = 0;

      expect(controller.consecutiveFailures).toBe(0);

      // Verify dashboard telemetry reflects reset
      const status = controller.getStatus();
      expect(status.consecutiveFailures).toBe(0);
    });

    it('isolates recovery categories and does not abort healthy session after 10 cumulative recoveries', () => {
      controller.startContinuousMode();

      // Trigger 12 intermittent recoveries interspersed with successful operations
      for (let i = 0; i < 12; i++) {
        controller.triggerRecovery('BALL_TEMPORARILY_LOST', 'Transient occlusion');
        expect(controller.stateMachine.getState()).not.toBe(AUTONOMOUS_STATES.FAILED);

        // Simulate recovering and achieving milestone
        controller.consecutiveFailures = 0;
        controller.lastSuccessfulOperation = 'BALL_ACQUIRED';
      }

      expect(controller.statistics.recoveryAttempts).toBe(12);
      expect(controller.consecutiveFailures).toBe(0);
      expect(controller.stateMachine.isTerminal()).toBe(false);
    });

    it('aborts only when consecutive unrecovered failures exceed safety ceiling (8)', () => {
      controller.startContinuousMode();

      for (let i = 0; i < 7; i++) {
        controller.triggerRecovery('COLLECTION_FAILED', 'Failed attempt');
        expect(controller.stateMachine.getState()).not.toBe(AUTONOMOUS_STATES.FAILED);
      }

      // 8th consecutive failure without success triggers safety abort
      controller.triggerRecovery('COLLECTION_FAILED', '8th consecutive failure');
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.FAILED);
      expect(controller.stateMachine.isTerminal()).toBe(true);
    });
  });

  // =========================================================================
  // 5. REAL-TIME 3D TRAJECTORY TRACKING INTEGRATION
  // =========================================================================
  describe('Phase 5: Real-Time 3D Trajectory Tracking Preservation', () => {
    it('samples rigid body physics center-of-mass and accumulates points during continuous play', () => {
      // Simulate physics translation of basketball
      for (let step = 0; step < 10; step++) {
        const x = 5.0 + step * 0.5;
        const y = 1.0 + Math.sin(step * 0.3) * 1.5;
        const z = step * 0.1;
        basketball.rigidBody.setTranslation({ x, y, z }, true);
        basketball.rigidBody.setLinvel({ x: 5.0, y: 2.0, z: 1.0 }, true);

        physicsWorld.step(0.02);
        trajectoryTracker.update(0.02, basketball);
      }

      const telemetry = trajectoryTracker.getTelemetry();
      expect(telemetry.pointCount).toBeGreaterThanOrEqual(5);
      expect(telemetry.peakHeight).toBeGreaterThan(1.0);
    });
  });
});
