import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { PhysicsWorld } from '../src/simulation/PhysicsWorld.js';
import { Robot } from '../src/robot/Robot.js';
import { Basketball } from '../src/environment/Basketball.js';
import { TrajectoryCalculator } from '../src/robot/TrajectoryCalculator.js';
import { HoopDetector } from '../src/robot/HoopDetector.js';
import { AdaptiveShotCorrector } from '../src/robot/AdaptiveShotCorrector.js';
import { ClosedLoopShootingController } from '../src/robot/ClosedLoopShootingController.js';
import { AutonomousShooterWorkflow } from '../src/navigation/AutonomousShooterWorkflow.js';

describe('Milestone 5: Autonomous Shooting Accuracy, Trajectory Optimization & Closed-Loop Control', () => {
  let scene;
  let physicsWorld;
  let robot;
  let basketball;
  let hoopDetector;

  beforeEach(async () => {
    scene = new THREE.Scene();
    physicsWorld = new PhysicsWorld();
    await physicsWorld.initialize();

    // Create court floor collider
    physicsWorld.createStaticBox(0, -0.25, 0, 30, 0.5, 20, 0.5, 0.7);

    robot = new Robot(scene, physicsWorld);
    basketball = new Basketball(scene, physicsWorld);
    hoopDetector = new HoopDetector({
      rimCenter: { x: 12.425, y: 3.05, z: 0.0 },
      rimRadius: 0.225
    });
  });

  afterEach(() => {
    if (robot) robot.destroy();
    if (physicsWorld) physicsWorld.destroy();
  });

  // =========================================================================
  // 1. TRAJECTORY OPTIMIZATION & APPARENT RIM APERTURE
  // =========================================================================
  describe('TrajectoryCalculator & Apparent Rim Aperture Kinematics', () => {
    let calc;
    const launchPos = { x: 8.2, y: 0.45, z: 0.0 };
    const targetHoop = { x: 12.425, y: 3.05, z: 0.0 };

    beforeEach(() => {
      calc = new TrajectoryCalculator({ gravity: 9.81 });
    });

    it('evaluates multiple candidate trajectories across elevation angle sweep', () => {
      const candidates = calc.evaluateCandidateTrajectories(launchPos, targetHoop, {
        minAngleDeg: 48,
        maxAngleDeg: 68,
        angleStepDeg: 2.0
      });

      expect(candidates.length).toBeGreaterThan(0);
      for (const cand of candidates) {
        expect(cand.launchAngleDeg).toBeGreaterThanOrEqual(48);
        expect(cand.launchAngleDeg).toBeLessThanOrEqual(68);
        expect(cand.speed).toBeGreaterThan(0);
        expect(cand.flightTime).toBeGreaterThan(0);
        expect(cand.apexHeight).toBeGreaterThan(targetHoop.y);
      }
    });

    it('enforces descending entry constraint (d * tan(theta) > 2h)', () => {
      const d = Math.hypot(targetHoop.x - launchPos.x, targetHoop.z - launchPos.z);
      const h = targetHoop.y - launchPos.y;
      const minDescAngleRad = Math.atan((2 * h) / d);
      const minDescAngleDeg = (minDescAngleRad * 180) / Math.PI;

      // An angle shallower than minDescAngleDeg will arrive moving upward or flat
      const shallowAngle = Math.max(30, minDescAngleDeg - 5);
      const sol = calc.calculateSolution(launchPos, targetHoop, shallowAngle);
      expect(sol.isPhysicallySuitable).toBe(false);
    });

    it('calculates entry angle and apparent rim diameter ellipse (D_eff = D_rim * sin(theta_entry))', () => {
      const candidate = calc.calculateSolution(launchPos, targetHoop, 60.0);
      expect(candidate).not.toBeNull();
      expect(candidate.valid).toBe(true);
      expect(candidate.entryAngleDeg).toBeGreaterThan(20.0);

      // Apparent aperture should equal rimDiameter * sin(entryAngle)
      const expectedAperture = 0.45 * Math.sin((candidate.entryAngleDeg * Math.PI) / 180);
      expect(candidate.effectiveRimDiameter).toBeCloseTo(expectedAperture, 3);

      // Clearance margin should be effective diameter minus ball diameter (0.24m)
      expect(candidate.rimClearanceMargin).toBeCloseTo(candidate.effectiveRimDiameter - 0.24, 3);
    });

    it('optimizes trajectory by selecting highest composite entry steepness and clearance score', () => {
      const opt = calc.optimizeTrajectory(launchPos, targetHoop);
      expect(opt.valid).toBe(true);
      expect(opt.solution).not.toBeNull();
      expect(opt.solution.launchAngleDeg).toBeGreaterThanOrEqual(50.0);
      expect(opt.solution.launchAngleDeg).toBeLessThanOrEqual(70.0);
      expect(opt.solution.entryAngleDeg).toBeGreaterThanOrEqual(38.0);
      expect(opt.solution.score).toBeGreaterThan(0);
      expect(opt.solution.rimClearanceMargin).toBeGreaterThan(0.04); // At least 4 cm clearance margin
    });

    it('gracefully reports invalid when target is unreachable or exceeds maximum ceiling', () => {
      const impossibleTarget = { x: 8.2, y: 25.0, z: 0.0 };
      const opt = calc.optimizeTrajectory(launchPos, impossibleTarget);
      expect(opt.valid).toBe(false);
      expect(opt.solution).toBeNull();
    });
  });

  // =========================================================================
  // 2. DETAILED SHOT OUTCOME CLASSIFICATION (HoopDetector)
  // =========================================================================
  describe('HoopDetector Outcome Classification', () => {
    it('initializes with empty history and NO SHOTS result', () => {
      expect(hoopDetector.totalAttempts).toBe(0);
      expect(hoopDetector.successfulBaskets).toBe(0);
      expect(hoopDetector.missedShots).toBe(0);
      expect(hoopDetector.lastShotResult).toBe('NONE');
      expect(hoopDetector.shotHistory).toHaveLength(0);
    });

    it('classifies successful shot as SCORED on downward rim penetration', () => {
      hoopDetector.notifyShotFired({ distance: 4.22, launchSpeed: 8.8, launchAngleDeg: 58.0 });
      expect(hoopDetector.activeShot).not.toBeNull();

      // Step 1: Ball flies above rim plane
      hoopDetector.update({ x: 12.0, y: 3.5, z: 0.0 }, { x: 3.0, y: 1.0, z: 0.0 }, 0.1);
      expect(hoopDetector.activeShot.passedAboveRim).toBe(true);

      // Step 2: Ball penetrates rim downward inside rim cylinder
      hoopDetector.update({ x: 12.42, y: 3.02, z: 0.01 }, { x: 0.5, y: -2.5, z: 0.0 }, 0.05);
      expect(hoopDetector.activeShot.enteredRimPlane).toBe(true);

      // Step 3: Ball exits net below rim
      const res = hoopDetector.update({ x: 12.42, y: 2.70, z: 0.01 }, { x: 0.2, y: -3.0, z: 0.0 }, 0.1);
      expect(res).toBe('SCORED');
      expect(hoopDetector.lastShotResult).toBe('SCORED');
      expect(hoopDetector.successfulBaskets).toBe(1);
      expect(hoopDetector.lastShotDetails.outcome).toBe('SCORED');
    });

    it('classifies shot as MISSED_SHORT when ball falls short of rim', () => {
      hoopDetector.notifyShotFired({ distance: 4.22, launchSpeed: 8.0, launchAngleDeg: 58.0 });

      // Ball misses short: dx < -0.15m at rim height, then hits floor
      hoopDetector.update({ x: 12.10, y: 3.05, z: 0.0 }, { x: 1.0, y: -3.0, z: 0.0 }, 0.016);
      hoopDetector.update({ x: 12.20, y: 0.12, z: 0.0 }, { x: 0.5, y: -1.0, z: 0.0 }, 0.016);

      expect(hoopDetector.lastShotResult).toBe('MISSED');
      expect(hoopDetector.lastShotDetails.outcome).toBe('MISSED_SHORT');
      expect(hoopDetector.shotHistory[0].outcome).toBe('MISSED_SHORT');
    });

    it('classifies shot as MISSED_LONG when ball sails past rim', () => {
      hoopDetector.notifyShotFired({ distance: 4.22, launchSpeed: 9.8, launchAngleDeg: 58.0 });

      // Ball misses long: dx > +0.18m at rim height, hits backboard/floor
      hoopDetector.update({ x: 12.75, y: 3.05, z: 0.0 }, { x: 1.0, y: -3.0, z: 0.0 }, 0.016);
      hoopDetector.update({ x: 12.80, y: 0.12, z: 0.0 }, { x: 0.5, y: -1.0, z: 0.0 }, 0.016);

      expect(hoopDetector.lastShotResult).toBe('MISSED');
      expect(hoopDetector.lastShotDetails.outcome).toBe('MISSED_LONG');
    });

    it('classifies shot as MISSED_LEFT when lateral deviation is positive (z > +0.14m)', () => {
      hoopDetector.notifyShotFired({ distance: 4.22, launchSpeed: 8.8, launchAngleDeg: 58.0 });

      hoopDetector.update({ x: 12.425, y: 3.05, z: 0.25 }, { x: 0.5, y: -3.0, z: 0.0 }, 0.016);
      hoopDetector.update({ x: 12.425, y: 0.12, z: 0.28 }, { x: 0.2, y: -1.0, z: 0.0 }, 0.016);

      expect(hoopDetector.lastShotDetails.outcome).toBe('MISSED_LEFT');
    });

    it('classifies shot as MISSED_RIGHT when lateral deviation is negative (z < -0.14m)', () => {
      hoopDetector.notifyShotFired({ distance: 4.22, launchSpeed: 8.8, launchAngleDeg: 58.0 });

      hoopDetector.update({ x: 12.425, y: 3.05, z: -0.25 }, { x: 0.5, y: -3.0, z: 0.0 }, 0.016);
      hoopDetector.update({ x: 12.425, y: 0.12, z: -0.28 }, { x: 0.2, y: -1.0, z: 0.0 }, 0.016);

      expect(hoopDetector.lastShotDetails.outcome).toBe('MISSED_RIGHT');
    });

    it('maintains a rolling history of the last 20 shots with detailed telemetry', () => {
      for (let i = 0; i < 25; i++) {
        hoopDetector.notifyShotFired({ shotId: i + 1, distance: 4.0 });
        hoopDetector.update({ x: 12.0, y: 3.5, z: 0.0 }, { x: 0, y: 1, z: 0 }, 0.05);
        hoopDetector.update({ x: 12.42, y: 3.02, z: 0.0 }, { x: 0, y: -2, z: 0 }, 0.05);
        hoopDetector.update({ x: 12.42, y: 2.70, z: 0.0 }, { x: 0, y: -2, z: 0 }, 0.05);
      }

      expect(hoopDetector.totalAttempts).toBe(25);
      expect(hoopDetector.shotHistory.length).toBe(20);
      expect(hoopDetector.shotHistory[0].shotNumber).toBe(25);
    });
  });

  // =========================================================================
  // 3. ADAPTIVE SHOT CORRECTOR (DETERMINISTIC FEEDBACK CONTROL)
  // =========================================================================
  describe('AdaptiveShotCorrector (Bounded Integral Feedback)', () => {
    let corrector;

    beforeEach(() => {
      corrector = new AdaptiveShotCorrector({
        velocityStep: 0.25,
        maxVelocityBias: 1.5,
        headingStep: 0.015,
        maxHeadingBias: 0.06,
        elevationStep: 0.5,
        maxElevationBias: 3.0,
        decayFactor: 0.60
      });
    });

    it('increases velocity bias when shot is MISSED_SHORT', () => {
      corrector.recordShotOutcome({ outcome: 'MISSED_SHORT', deltaX: -0.22 });
      expect(corrector.velocityBias).toBe(0.25);
      expect(corrector.headingBias).toBe(0.0);
    });

    it('decreases velocity bias when shot is MISSED_LONG', () => {
      corrector.recordShotOutcome({ outcome: 'MISSED_LONG', deltaX: 0.30 });
      expect(corrector.velocityBias).toBe(-0.25);
    });

    it('adjusts heading bias clockwise for MISSED_LEFT and counter-clockwise for MISSED_RIGHT', () => {
      corrector.recordShotOutcome({ outcome: 'MISSED_LEFT', deltaZ: 0.20 });
      expect(corrector.headingBias).toBe(-0.015);

      corrector.recordShotOutcome({ outcome: 'MISSED_RIGHT', deltaZ: -0.20 });
      expect(corrector.headingBias).toBeCloseTo(0.0, 5);
    });

    it('decays biases towards zero upon SCORED basket', () => {
      corrector.recordShotOutcome({ outcome: 'MISSED_SHORT' });
      corrector.recordShotOutcome({ outcome: 'MISSED_SHORT' });
      expect(corrector.velocityBias).toBe(0.50);

      corrector.recordShotOutcome({ outcome: 'SCORED' });
      expect(corrector.velocityBias).toBeCloseTo(0.30, 4);
    });

    it('strictly clamps biases at configured saturation bounds', () => {
      for (let i = 0; i < 15; i++) {
        corrector.recordShotOutcome({ outcome: 'MISSED_SHORT' });
      }
      expect(corrector.velocityBias).toBe(1.5);

      for (let i = 0; i < 30; i++) {
        corrector.recordShotOutcome({ outcome: 'MISSED_LONG' });
      }
      expect(corrector.velocityBias).toBe(-1.5);
    });

    it('applies calibrated corrections to nominal trajectory parameters', () => {
      corrector.recordShotOutcome({ outcome: 'MISSED_SHORT' });
      const nominal = { speed: 8.5, launchAngleDeg: 55.0, requiredHeadingRad: 0.0 };
      const corrected = corrector.applyCorrection(nominal);

      expect(corrected.speed).toBe(8.75);
      expect(corrected.launchAngleDeg).toBe(55.0);
      expect(corrected.biases.velocityBias).toBe(0.25);
    });

    it('resets all calibration biases cleanly', () => {
      corrector.recordShotOutcome({ outcome: 'MISSED_SHORT' });
      corrector.reset();
      expect(corrector.velocityBias).toBe(0.0);
      expect(corrector.elevationBias).toBe(0.0);
      expect(corrector.headingBias).toBe(0.0);
      expect(corrector.history).toHaveLength(0);
    });
  });

  // =========================================================================
  // 4. CLOSED-LOOP SHOOTING CONTROLLER (ClosedLoopShootingController)
  // =========================================================================
  describe('ClosedLoopShootingController Execution & Interlocks', () => {
    let controller;

    beforeEach(() => {
      controller = new ClosedLoopShootingController({
        robot,
        basketball,
        hoopDetector,
        headingToleranceRad: 0.035, // ~2.0 deg
        alignmentTimeout: 3.0,
        spinUpTimeout: 3.0
      });
    });

    it('initializes in IDLE state', () => {
      expect(controller.state).toBe('IDLE');
      expect(controller.isActive).toBe(false);
    });

    it('refuses to start sequence when ball is NOT captured in intake', () => {
      robot.intake.isBallCaptured = false;
      const started = controller.startShootingSequence();
      expect(started).toBe(false);
      expect(controller.state).toBe('FAILED');
      expect(controller.statusMessage).toContain('no ball captured');
    });

    it('cancels autonomous navigation controller on sequence start to avoid controller contention', () => {
      robot.intake.isBallCaptured = true;
      let navCancelled = false;
      robot.navController.cancel = () => { navCancelled = true; };

      const started = controller.startShootingSequence();
      expect(started).toBe(true);
      expect(navCancelled).toBe(true);
      expect(controller.state).toBe('OPTIMIZING_TRAJECTORY');
    });

    it('advances through alignment, flywheel spinup, and firing when interlocks are satisfied', () => {
      robot.intake.isBallCaptured = true;
      controller.startShootingSequence();

      // Step 1: Trajectory optimization -> ALIGNING
      controller.update(0.016);
      expect(controller.state).toBe('ALIGNING');
      expect(controller.activeSolution).not.toBeNull();

      // Align robot heading with target heading
      const h = controller.targetHeading;
      robot.rigidBody.setRotation({ x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) }, true);

      // Step 2: Alignment achieved -> SPINNING_UP
      controller.update(0.016);
      expect(controller.state).toBe('SPINNING_UP');

      // Fast-forward flywheel spin-up to READY
      robot.shooter.flywheelRpm = robot.shooter.targetFlywheelRpm;
      robot.shooter.state = 'READY';

      // Step 3: Flywheel ready -> READY -> FIRING/COOLDOWN
      controller.update(0.016);
      expect(controller.state).toBe('READY');
      controller.update(0.016);
      expect(controller.state).toBe('COOLDOWN');

      // Step 4: After firing cooldown -> COMPLETED
      controller.update(0.5);
      expect(controller.state).toBe('COMPLETED');
    });

    it('transitions to FAILED if alignment timeout elapses without achieving target heading', () => {
      robot.intake.isBallCaptured = true;
      controller.startShootingSequence();
      controller.update(0.016); // -> ALIGNING

      // Heading remains misaligned (misaligned by 0.5 rad)
      const h = controller.targetHeading + 0.5;
      robot.rigidBody.setRotation({ x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) }, true);

      // Elapse alignment timeout (3.0 seconds)
      controller.update(3.5);

      expect(controller.state).toBe('FAILED');
      expect(controller.statusMessage).toContain('timed out');
      expect(robot.driveController.mode).toBe('STOPPED');
    });

    it('aborts sequence cleanly on cancel()', () => {
      robot.intake.isBallCaptured = true;
      controller.startShootingSequence();
      controller.update(0.016);
      expect(controller.isActive).toBe(true);

      controller.cancel();
      expect(controller.state).toBe('CANCELLED');
      expect(controller.isActive).toBe(false);
      expect(robot.shooter.state).toBe('IDLE');
    });
  });

  // =========================================================================
  // 5. INTEGRATED AUTONOMOUS WORKFLOW & ADAPTIVE CLOSING LOOP
  // =========================================================================
  describe('AutonomousShooterWorkflow with Adaptive Closed-Loop Integration', () => {
    let workflow;

    beforeEach(() => {
      workflow = new AutonomousShooterWorkflow({
        robot,
        basketball,
        hoopDetector,
        targetHoop: { x: 12.425, y: 3.05, z: 0.0 }
      });
    });

    it('incorporates adaptive corrector into trajectory optimization', () => {
      workflow.corrector.recordShotOutcome({ outcome: 'MISSED_SHORT', deltaX: -0.20 });
      expect(workflow.corrector.velocityBias).toBe(0.15);

      robot.intake.isBallCaptured = true;
      robot.intake.ballState = 'CAPTURED';
      workflow.startSequence();

      // Trigger key arrival & alignment
      workflow.stage = 'ALIGNING_WITH_HOOP';
      const dx = workflow.hoopTarget.x - robot.getPosition().x;
      const dz = workflow.hoopTarget.z - robot.getPosition().z;
      const targetHeading = Math.atan2(-dz, dx);
      robot.rigidBody.setRotation({ x: 0, y: Math.sin(targetHeading / 2), z: 0, w: Math.cos(targetHeading / 2) }, true);

      workflow.update(0.016);

      expect(workflow.activeTrajectorySolution).not.toBeNull();
      expect(workflow.stage).toBe('SPINNING_UP');
    });

    it('records completed shot outcome into corrector on trajectory resolution', () => {
      workflow.stage = 'TRACKING_TRAJECTORY';
      workflow.isActive = true;

      // Simulate hoop detector resolving shot as MISSED_LONG
      hoopDetector.stats.lastShotResult = 'MISSED';
      hoopDetector.lastShotDetails = {
        outcome: 'MISSED_LONG',
        deltaX: 0.25,
        deltaZ: 0.02
      };

      workflow.update(0.016);

      expect(workflow.stage).toBe('COMPLETED');
      expect(workflow.corrector.velocityBias).toBe(-0.15);
      expect(workflow.corrector.history.length).toBe(1);
    });

    it('exposes comprehensive closed-loop telemetry object', () => {
      const tel = workflow.getTelemetry();
      expect(tel).toHaveProperty('stage');
      expect(tel).toHaveProperty('isActive');
      expect(tel).toHaveProperty('statusMessage');
      expect(tel).toHaveProperty('ballCaptured');
      expect(tel).toHaveProperty('activeSolution');
      expect(tel).toHaveProperty('adaptiveBiases');
      expect(tel).toHaveProperty('shootingController');
    });
  });
});
