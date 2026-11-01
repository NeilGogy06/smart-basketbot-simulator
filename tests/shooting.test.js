import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { PhysicsWorld } from '../src/simulation/PhysicsWorld.js';
import { Robot } from '../src/robot/Robot.js';
import { Basketball } from '../src/environment/Basketball.js';
import { IntakeMechanism } from '../src/robot/IntakeMechanism.js';
import { ShootingMechanism } from '../src/robot/ShootingMechanism.js';
import { TrajectoryCalculator } from '../src/robot/TrajectoryCalculator.js';
import { HoopDetector } from '../src/robot/HoopDetector.js';
import { AutonomousShooterWorkflow } from '../src/navigation/AutonomousShooterWorkflow.js';

describe('Milestone 4: Basketball Acquisition, Intake Mechanism & Autonomous Shooting', () => {
  let scene;
  let physicsWorld;
  let robot;
  let basketball;

  beforeEach(async () => {
    scene = new THREE.Scene();
    physicsWorld = new PhysicsWorld();
    await physicsWorld.initialize();

    // Create court floor collider
    physicsWorld.createStaticBox(0, -0.25, 0, 30, 0.5, 20, 0.5, 0.7);

    robot = new Robot(scene, physicsWorld);
    basketball = new Basketball(scene, physicsWorld);
  });

  afterEach(() => {
    if (robot) robot.destroy();
    if (physicsWorld) physicsWorld.destroy();
  });

  // -------------------------------------------------------------
  // 1. INTAKE MECHANISM & OPTICAL SENSOR TESTS
  // -------------------------------------------------------------
  describe('Intake Mechanism & Optical Sensor', () => {
    let intake;

    beforeEach(() => {
      intake = new IntakeMechanism({ intakeSpeed: 25.0 });
    });

    it('initializes in IDLE state with clear optical sensor and FIELD ball state', () => {
      expect(intake.state).toBe('IDLE');
      expect(intake.ballState).toBe('FIELD');
      expect(intake.isBallCaptured).toBe(false);
      expect(intake.opticalSensorActive).toBe(false);
      expect(intake.currentRollerSpeed).toBe(0.0);
    });

    it('transitions to INTAKING on startIntake with positive roller speed', () => {
      intake.startIntake();
      expect(intake.state).toBe('INTAKING');
      expect(intake.currentRollerSpeed).toBe(25.0);
    });

    it('transitions to IDLE on stopIntake when no ball is possessed', () => {
      intake.startIntake();
      intake.stopIntake();
      expect(intake.state).toBe('IDLE');
      expect(intake.currentRollerSpeed).toBe(0.0);
    });

    it('transitions to REJECTING on startReject with negative roller speed', () => {
      intake.startReject();
      expect(intake.state).toBe('REJECTING');
      expect(intake.currentRollerSpeed).toBe(-25.0);
    });

    it('detects ball in front intake zone and captures ball into cradle', () => {
      intake.startIntake();

      // Position ball in front intake zone
      const rPos = robot.getPosition();
      basketball.rigidBody.setTranslation({ x: rPos.x + 0.60, y: 0.12, z: rPos.z }, true);

      // Step intake update
      intake.update(0.1, robot, basketball);
      expect(intake.state).toBe('INTAKING');

      // Now place ball at cradle position
      basketball.rigidBody.setTranslation({ x: rPos.x + 0.08, y: 0.20, z: rPos.z }, true);
      intake.update(0.1, robot, basketball);

      expect(intake.isBallCaptured).toBe(true);
      expect(intake.opticalSensorActive).toBe(true);
      expect(intake.state).toBe('BALL_CAPTURED');
      expect(intake.ballState).toBe('CAPTURED');
    });

    it('does not capture ball if ball is out of lateral intake range', () => {
      intake.startIntake();

      // Ball is 2 meters to the side
      basketball.rigidBody.setTranslation({ x: 0.35, y: 0.12, z: 2.0 }, true);
      intake.update(0.1, robot, basketball);

      expect(intake.isBallCaptured).toBe(false);
      expect(intake.opticalSensorActive).toBe(false);
      expect(intake.state).toBe('INTAKING');
    });

    it('locks ball physical transform to cradle while in possession during robot movement', () => {
      intake.isBallCaptured = true;
      intake.state = 'BALL_CAPTURED';

      // Move robot forward
      robot.rigidBody.setTranslation({ x: 5.0, y: 0.28, z: 2.0 }, true);

      intake.update(0.016, robot, basketball);

      const bPos = basketball.getPosition();
      // Ball should have followed robot exactly to (5.0 + 0.08, 0.28 - 0.08, 2.0)
      expect(bPos.x).toBeCloseTo(5.08, 2);
      expect(bPos.y).toBeCloseTo(0.20, 2);
      expect(bPos.z).toBeCloseTo(2.0, 2);
    });

    it('releases ball on releaseBall and clears optical sensor', () => {
      intake.isBallCaptured = true;
      intake.state = 'BALL_CAPTURED';
      intake.opticalSensorActive = true;

      intake.releaseBall();
      expect(intake.isBallCaptured).toBe(false);
      expect(intake.opticalSensorActive).toBe(false);
      expect(intake.ballState).toBe('FIELD');
      expect(intake.state).toBe('IDLE');
    });

    it('resets cleanly to initial state', () => {
      intake.startIntake();
      intake.isBallCaptured = true;
      intake.opticalSensorActive = true;

      intake.reset();
      expect(intake.state).toBe('IDLE');
      expect(intake.ballState).toBe('FIELD');
      expect(intake.isBallCaptured).toBe(false);
      expect(intake.opticalSensorActive).toBe(false);
      expect(intake.currentRollerSpeed).toBe(0.0);
    });

    it('provides accurate telemetry object', () => {
      intake.startIntake();
      const tel = intake.getTelemetry();
      expect(tel.state).toBe('INTAKING');
      expect(tel.hasBall).toBe(false);
      expect(tel.opticalSensorActive).toBe(false);
      expect(tel.rollerSpeedRpm).toBeGreaterThan(200);
    });
  });

  // -------------------------------------------------------------
  // 2. BALLISTIC TRAJECTORY CALCULATOR TESTS
  // -------------------------------------------------------------
  describe('TrajectoryCalculator', () => {
    let calculator;

    beforeEach(() => {
      calculator = new TrajectoryCalculator({ gravity: 9.81, defaultAngleDeg: 52.0 });
    });

    it('calculates analytical launch velocity for standard free-throw distance', () => {
      // Robot at X = 8.2, Y = 0.45, Z = 0.0
      // Rim at X = 12.425, Y = 3.05, Z = 0.0
      const launchPos = { x: 8.2, y: 0.45, z: 0.0 };
      const hoopPos = { x: 12.425, y: 3.05, z: 0.0 };

      const sol = calculator.calculateSolution(launchPos, hoopPos, 52.0);
      expect(sol.valid).toBe(true);
      expect(sol.speed).toBeGreaterThan(7.0);
      expect(sol.speed).toBeLessThan(11.0);
      expect(sol.flightTime).toBeGreaterThan(0.7);
      expect(sol.flightTime).toBeLessThan(1.8);
      expect(sol.apexHeight).toBeGreaterThan(hoopPos.y); // Apex must be above the 3.05m rim
      expect(sol.horizontalDistance).toBeCloseTo(4.225, 2);
    });

    it('computes 3D directional velocity components oriented towards target', () => {
      // Angled shot from left wing: robot at (8.0, 0.45, 3.0) to hoop at (12.425, 3.05, 0.0)
      const launchPos = { x: 8.0, y: 0.45, z: 3.0 };
      const hoopPos = { x: 12.425, y: 3.05, z: 0.0 };

      const sol = calculator.calculateSolution(launchPos, hoopPos, 55.0);
      expect(sol.valid).toBe(true);

      // Horizontal velocity vector must point towards target (+X, -Z)
      expect(sol.launchVelocity.x).toBeGreaterThan(0);
      expect(sol.launchVelocity.y).toBeGreaterThan(0);
      expect(sol.launchVelocity.z).toBeLessThan(0); // target Z (0) is less than launch Z (3.0)

      // Total vector magnitude must equal speed
      const mag = Math.hypot(sol.launchVelocity.x, sol.launchVelocity.y, sol.launchVelocity.z);
      expect(mag).toBeCloseTo(sol.speed, 4);
    });

    it('identifies invalid trajectories when target is too close or elevation is insufficient', () => {
      const launchPos = { x: 12.4, y: 0.45, z: 0.0 };
      const hoopPos = { x: 12.425, y: 3.05, z: 0.0 };

      const tooClose = calculator.calculateSolution(launchPos, hoopPos, 52.0);
      expect(tooClose.valid).toBe(false);

      // Angle too flat to clear target height
      const flat = calculator.calculateSolution({ x: 4.0, y: 0.45, z: 0.0 }, hoopPos, 5.0);
      expect(flat.valid).toBe(false);
    });
  });

  // -------------------------------------------------------------
  // 3. SHOOTING MECHANISM TESTS
  // -------------------------------------------------------------
  describe('ShootingMechanism', () => {
    let shooter;

    beforeEach(() => {
      shooter = new ShootingMechanism({ launchAngleDeg: 52.0, spinUpDuration: 0.5, cooldownDuration: 0.3 });
    });

    it('initializes in IDLE state with 0 RPM', () => {
      expect(shooter.state).toBe('IDLE');
      expect(shooter.currentFlywheelSpeed).toBe(0.0);
      expect(shooter.launchAngleDeg).toBe(52.0);
    });

    it('spins up flywheels smoothly over spinUpDuration to READY state', () => {
      shooter.spinUp(8.5);
      expect(shooter.state).toBe('SPINNING_UP');

      // Half duration: speed should be accelerating
      shooter.update(0.25);
      expect(shooter.state).toBe('SPINNING_UP');
      expect(shooter.currentFlywheelSpeed).toBeGreaterThan(0);

      // Full duration: reaches READY
      shooter.update(0.3);
      expect(shooter.state).toBe('READY');
      expect(shooter.currentFlywheelSpeed).toBeGreaterThan(50);
    });

    it('refuses to fire without ball in robot containment', () => {
      shooter.spinUp(8.5);
      shooter.update(0.6); // Ready

      robot.intake.isBallCaptured = false;
      const fired = shooter.fire(robot, basketball);
      expect(fired).toBe(false);
      expect(shooter.state).toBe('READY');
      expect(shooter.lastRejectReason).toContain('No ball in containment');
      expect(shooter.getTelemetry().lastRejectReason).toContain('No ball in containment');
    });

    it('fires basketball into Rapier physics when ball is possessed', () => {
      shooter.spinUp(8.5);
      shooter.update(0.6); // Ready

      // Capture ball
      robot.intake.isBallCaptured = true;
      robot.intake.state = 'BALL_CAPTURED';

      const fired = shooter.fire(robot, basketball);
      expect(fired).toBe(true);

      // Ball should have been released from intake
      expect(robot.intake.isBallCaptured).toBe(false);
      expect(robot.intake.ballState).toBe('IN_FLIGHT');

      // Ball should have received positive upward and forward launch velocity
      const bVel = basketball.getVelocity();
      expect(bVel.x).toBeGreaterThan(2.0);
      expect(bVel.y).toBeGreaterThan(4.0);

      // Shooter enters COOLDOWN
      expect(shooter.state).toBe('COOLDOWN');

      // After cooldown duration, returns to IDLE
      shooter.update(0.35);
      expect(shooter.state).toBe('IDLE');
      expect(shooter.currentFlywheelSpeed).toBe(0.0);
    });

    it('resets cleanly to initial state', () => {
      shooter.spinUp(8.5);
      shooter.update(0.6);
      shooter.reset();

      expect(shooter.state).toBe('IDLE');
      expect(shooter.currentFlywheelSpeed).toBe(0.0);
      expect(shooter.flywheelAngle).toBe(0.0);
    });
  });

  // -------------------------------------------------------------
  // 4. HOOP DETECTION & SHOT PERFORMANCE STATISTICS
  // -------------------------------------------------------------
  describe('HoopDetector', () => {
    let detector;

    beforeEach(() => {
      detector = new HoopDetector({
        rimX: 12.425,
        rimY: 3.05,
        rimZ: 0.0,
        rimRadius: 0.225
      });
    });

    it('initializes with 0 attempts and NO SHOTS result', () => {
      expect(detector.stats.totalAttempts).toBe(0);
      expect(detector.stats.successfulBaskets).toBe(0);
      expect(detector.stats.missedShots).toBe(0);
      expect(detector.stats.accuracyPercent).toBe(0.0);
      expect(detector.stats.lastShotResult).toBe('NONE');
    });

    it('tracks active shot flight and detects scored basket on downward penetration', () => {
      detector.notifyShotFired();
      expect(detector.stats.totalAttempts).toBe(1);
      expect(detector.stats.lastShotResult).toBe('IN_FLIGHT');

      // Step 1: Ball flies above rim plane
      detector.update({ x: 12.0, y: 3.5, z: 0.0 }, { x: 3.0, y: 1.0, z: 0.0 }, 0.1);
      expect(detector.activeShot.passedAboveRim).toBe(true);

      // Step 2: Ball penetrates rim downward inside rim cylinder (X=12.425, Y=3.05, Z=0)
      const res = detector.update({ x: 12.42, y: 3.02, z: 0.01 }, { x: 0.5, y: -2.5, z: 0.0 }, 0.05);
      expect(detector.activeShot.enteredRimPlane).toBe(true);

      // Step 3: Ball exits net below rim
      const finalRes = detector.update({ x: 12.43, y: 2.70, z: 0.01 }, { x: 0.2, y: -3.0, z: 0.0 }, 0.1);
      expect(finalRes).toBe('SCORED');
      expect(detector.stats.successfulBaskets).toBe(1);
      expect(detector.stats.accuracyPercent).toBe(100.0);
      expect(detector.stats.lastShotResult).toBe('SCORED');
    });

    it('detects missed shot when ball hits floor without penetrating rim', () => {
      detector.notifyShotFired();

      // Ball flies above, but misses rim horizontally (Z = 1.5m away)
      detector.update({ x: 12.4, y: 3.4, z: 1.5 }, { x: 1.0, y: -1.0, z: 0.0 }, 0.2);
      // Ball contacts floor (Y <= 0.15)
      const res = detector.update({ x: 13.0, y: 0.12, z: 1.5 }, { x: 0.2, y: 0.1, z: 0.0 }, 0.2);

      expect(res).toBe('MISSED');
      expect(detector.stats.missedShots).toBe(1);
      expect(detector.stats.successfulBaskets).toBe(0);
      expect(detector.stats.accuracyPercent).toBe(0.0);
      expect(detector.stats.lastShotResult).toBe('MISSED');
    });

    it('calculates correct multi-shot accuracy percentage', () => {
      // 1st shot: scored
      detector.notifyShotFired();
      detector.update({ x: 12.4, y: 3.3, z: 0.0 }, { x: 1.0, y: 1.0, z: 0.0 }, 0.1);
      detector.update({ x: 12.42, y: 3.01, z: 0.0 }, { x: 0.2, y: -2.0, z: 0.0 }, 0.05);
      detector.update({ x: 12.42, y: 2.75, z: 0.0 }, { x: 0.1, y: -2.5, z: 0.0 }, 0.05);

      // 2nd shot: missed
      detector.notifyShotFired();
      detector.update({ x: 12.4, y: 3.3, z: 1.0 }, { x: 1.0, y: 1.0, z: 0.0 }, 0.1);
      detector.update({ x: 13.0, y: 0.12, z: 1.0 }, { x: 0.1, y: 0.0, z: 0.0 }, 0.2);

      expect(detector.stats.totalAttempts).toBe(2);
      expect(detector.stats.successfulBaskets).toBe(1);
      expect(detector.stats.missedShots).toBe(1);
      expect(detector.stats.accuracyPercent).toBeCloseTo(50.0, 1);
    });

    it('resets all statistics cleanly', () => {
      detector.notifyShotFired();
      detector.reset();

      expect(detector.stats.totalAttempts).toBe(0);
      expect(detector.stats.successfulBaskets).toBe(0);
      expect(detector.stats.missedShots).toBe(0);
      expect(detector.stats.accuracyPercent).toBe(0.0);
      expect(detector.stats.lastShotResult).toBe('NONE');
    });
  });

  // -------------------------------------------------------------
  // 5. AUTONOMOUS SHOOTER WORKFLOW INTEGRATION
  // -------------------------------------------------------------
  describe('AutonomousShooterWorkflow', () => {
    let workflow;
    let hoopDetector;

    beforeEach(() => {
      hoopDetector = new HoopDetector();
      workflow = new AutonomousShooterWorkflow({
        robot,
        basketball,
        hoopDetector,
        hoopTarget: { x: 12.425, y: 3.05, z: 0.0 }
      });
    });

    it('initializes in IDLE stage with ready message', () => {
      expect(workflow.stage).toBe('IDLE');
      expect(workflow.timer).toBe(0.0);
    });

    it('transitions to NAVIGATING_TO_BALL when starting sequence with ball on field', () => {
      const ok = workflow.startSequence();
      expect(ok).toBe(true);
      expect(workflow.stage).toBe('NAVIGATING_TO_BALL');
    });

    it('transitions directly to NAVIGATING_TO_SHOOT_POS if ball is already captured', () => {
      robot.intake.isBallCaptured = true;
      robot.intake.state = 'BALL_CAPTURED';

      const ok = workflow.startSequence();
      expect(ok).toBe(true);
      expect(workflow.stage).toBe('NAVIGATING_TO_SHOOT_POS');
    });

    it('cancels active workflow gracefully and stops intake/shooter', () => {
      workflow.startSequence();
      expect(workflow.stage).toBe('NAVIGATING_TO_BALL');

      workflow.cancelSequence();
      expect(workflow.stage).toBe('CANCELLED');
      expect(robot.intake.state).toBe('IDLE');
      expect(robot.shooter.state).toBe('IDLE');
    });

    it('halts on emergencyStop abort', () => {
      workflow.startSequence();
      workflow.emergencyStop();

      expect(workflow.stage).toBe('CANCELLED');
      expect(robot.intake.state).toBe('IDLE');
      expect(robot.shooter.state).toBe('IDLE');
    });

    it('advances through approach, alignment, spinup, and firing stages', () => {
      // Setup robot at shooting position with ball possessed
      robot.intake.isBallCaptured = true;
      const rPos = robot.getPosition();
      workflow.startSequence({ x: rPos.x, z: rPos.z });
      expect(workflow.stage).toBe('NAVIGATING_TO_SHOOT_POS');

      // Robot is already at shoot position
      workflow.update(0.1);
      expect(workflow.stage).toBe('ALIGNING_WITH_HOOP');

      // Rotate robot to face target hoop to satisfy heading alignment tolerance
      const dx = workflow.hoopTarget.x - rPos.x;
      const dz = workflow.hoopTarget.z - rPos.z;
      const targetHeading = Math.atan2(-dz, dx);
      robot.rigidBody.setRotation({
        x: 0,
        y: Math.sin(targetHeading / 2),
        z: 0,
        w: Math.cos(targetHeading / 2)
      }, true);

      // Now with heading aligned within tolerance, updates to SPINNING_UP
      workflow.update(0.1);
      expect(workflow.stage).toBe('SPINNING_UP');

      // Allow shooter spin-up to complete
      robot.shooter.update(1.0);
      workflow.update(0.1);
      expect(workflow.stage).toBe('FIRING');

      // Step into trajectory tracking
      workflow.update(0.1);
      expect(workflow.stage).toBe('TRACKING_TRAJECTORY');
    });

    it('transitions to FAILED if hoop alignment cannot be achieved within timeout', () => {
      // Place robot at shooting position facing away from hoop
      robot.intake.isBallCaptured = true;
      robot.rigidBody.setTranslation({ x: 8.2, y: 0.28, z: 0.0 }, true);
      workflow.startSequence({ x: 8.2, z: 0.0 });
      workflow.update(0.1);
      expect(workflow.stage).toBe('ALIGNING_WITH_HOOP');

      // Set robot heading away from target so heading error is ~PI (> 0.04 rad)
      robot.rigidBody.setRotation({ x: 0, y: 1, z: 0, w: 0 }, true);

      // Step workflow past alignment timeout without achieving alignment
      workflow.update(workflow.alignmentTimeout + 0.1);

      expect(workflow.stage).toBe('FAILED');
      expect(workflow.statusMessage).toContain('alignment timed out');
      expect(robot.driveController.mode).toBe('STOPPED');
    });

    it('resets workflow cleanly', () => {
      workflow.startSequence();
      workflow.reset();
      expect(workflow.stage).toBe('IDLE');
      expect(workflow.timer).toBe(0.0);
    });
  });

  // -------------------------------------------------------------
  // 6. RAPIER PHYSICS INTEGRATION & SIMULATION STEPPING
  // -------------------------------------------------------------
  describe('Rapier Physics Full System Integration', () => {
    it('synchronizes robot motion, ball intake, launcher firing, and physics stepping', () => {
      // 1. Robot drives towards ball
      const rPos = robot.getPosition();
      basketball.rigidBody.setTranslation({ x: rPos.x + 0.35, y: 0.12, z: rPos.z }, true);
      robot.startIntake();

      const dt = 1 / 60;
      // Step simulation for 0.5s allowing intake pull to draw ball into cradle
      for (let i = 0; i < 35; i++) {
        robot.update(dt, basketball.getPosition(), basketball);
        physicsWorld.step(dt);
      }

      // Ball should have been pulled in and captured
      expect(robot.intake.isBallCaptured).toBe(true);
      expect(robot.intake.opticalSensorActive).toBe(true);

      // 2. Spin up shooter and fire
      robot.shooter.spinUp(8.0);
      for (let i = 0; i < 55; i++) {
        robot.update(dt, null, basketball);
        physicsWorld.step(dt);
      }
      expect(robot.shooter.state).toBe('READY');

      // 3. Fire shot into physics world
      const fired = robot.fireShot(basketball);
      expect(fired).toBe(true);
      expect(robot.intake.isBallCaptured).toBe(false);

      // 4. Step physics: ball should be airborne and moving upward
      physicsWorld.step(dt);
      const pos = basketball.getPosition();
      const vel = basketball.getVelocity();

      expect(pos.y).toBeGreaterThan(0.4);
      expect(vel.y).toBeGreaterThan(0.0);
      expect(vel.x).toBeGreaterThan(0.0);
    });
  });
});
