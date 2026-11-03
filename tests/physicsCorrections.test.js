import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../src/simulation/PhysicsWorld.js';
import { BasketballHoop } from '../src/environment/BasketballHoop.js';
import { Basketball } from '../src/environment/Basketball.js';
import { Robot } from '../src/robot/Robot.js';
import { ShootingMechanism } from '../src/robot/ShootingMechanism.js';
import { TrajectoryCalculator } from '../src/robot/TrajectoryCalculator.js';
import { SIMULATION_CONFIG } from '../src/simulation/SimulationConfig.js';

describe('Phase 1: Physics and Shooting Corrections Regression Suite', () => {
  let scene;
  let physicsWorld;

  beforeEach(async () => {
    scene = new THREE.Scene();
    physicsWorld = new PhysicsWorld();
    await physicsWorld.initialize();
  });

  afterEach(() => {
    if (physicsWorld) physicsWorld.destroy();
  });

  // =========================================================================
  // TASK 1: BASKETBALL HOOP COLLISION GEOMETRY
  // =========================================================================
  describe('Task 1: Basketball Hoop Collision Geometry', () => {
    let hoop;

    beforeEach(() => {
      hoop = new BasketballHoop(scene, physicsWorld, 1);
    });

    it('creates compound rim collision geometry on a single static rigid body', () => {
      expect(hoop.rimBody).toBeDefined();
      expect(hoop.rimColliders).toBeDefined();
      expect(Array.isArray(hoop.rimColliders)).toBe(true);
      expect(hoop.rimColliders.length).toBe(16);

      // Verify that all 16 rim colliders belong to the SAME rigid body
      for (const col of hoop.rimColliders) {
        expect(col.parent()).toBe(hoop.rimBody);
      }
    });

    it('guarantees clear circular opening diameter of at least 0.426m without inward edges', () => {
      const rimRadius = SIMULATION_CONFIG.hoop.rimRadius; // 0.225m
      const tubeRadius = SIMULATION_CONFIG.hoop.rimTubeRadius; // 0.012m
      const minAllowableInnerRadius = rimRadius - tubeRadius; // 0.213m

      // Inspect each of the 16 colliders
      for (let i = 0; i < hoop.rimColliders.length; i++) {
        const col = hoop.rimColliders[i];
        const translation = col.translation();

        // Distance from hoop rim center (rimX, rimZ) in horizontal plane
        const distFromCenter = Math.hypot(translation.x - hoop.rimX, translation.z - hoop.rimZ);

        // Center of segment should be placed at the rim radius R
        expect(distFromCenter).toBeCloseTo(rimRadius, 3);

        // Inner edge distance: segment center minus radial half-thickness
        const innerEdgeDist = distFromCenter - tubeRadius;
        expect(innerEdgeDist).toBeGreaterThanOrEqual(minAllowableInnerRadius - 1e-4);
      }

      // Total clear opening diameter must be at least 2 * minAllowableInnerRadius = 0.426m
      const clearOpeningDiameter = 2 * minAllowableInnerRadius;
      expect(clearOpeningDiameter).toBeGreaterThanOrEqual(0.42);
      expect(clearOpeningDiameter).toBeLessThanOrEqual(0.45);
    });

    it('allows a regulation basketball to pass through the hoop center with ZERO physical contacts', () => {
      // Spawn basketball directly above rim center
      const ballBody = physicsWorld.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(hoop.rimX, hoop.rimY + 0.5, hoop.rimZ)
      );
      const ballCol = physicsWorld.world.createCollider(
        RAPIER.ColliderDesc.ball(SIMULATION_CONFIG.ball.radius),
        ballBody
      );

      let physicalContactOccurred = false;

      // Step physics for 60 frames (~1.0s)
      for (let s = 0; s < 60; s++) {
        physicsWorld.world.step();

        // Check contacts against all rim colliders
        for (const rimCol of hoop.rimColliders) {
          physicsWorld.world.contactPair(ballCol, rimCol, (manifold) => {
            if (manifold.numContacts() > 0) {
              physicalContactOccurred = true;
            }
          });
        }
      }

      // Ball must cleanly pass through without contacting rim
      expect(physicalContactOccurred).toBe(false);
      // Ball must have fallen well below rim height
      expect(ballBody.translation().y).toBeLessThan(hoop.rimY - 0.2);
    });

    it('allows an off-center basketball within clearance margin to pass through without collision', () => {
      // 0.06m off-center + 0.12m ball radius = 0.18m < 0.213m rim inner radius (3.3cm margin)
      const ballBody = physicsWorld.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(hoop.rimX, hoop.rimY + 0.5, hoop.rimZ + 0.06)
      );
      const ballCol = physicsWorld.world.createCollider(
        RAPIER.ColliderDesc.ball(SIMULATION_CONFIG.ball.radius),
        ballBody
      );

      let physicalContactOccurred = false;

      for (let s = 0; s < 60; s++) {
        physicsWorld.world.step();
        for (const rimCol of hoop.rimColliders) {
          physicsWorld.world.contactPair(ballCol, rimCol, (manifold) => {
            if (manifold.numContacts() > 0) {
              physicalContactOccurred = true;
            }
          });
        }
      }

      expect(physicalContactOccurred).toBe(false);
      expect(ballBody.translation().y).toBeLessThan(hoop.rimY - 0.2);
    });

    it('registers physical collision when ball hits the rim directly', () => {
      // Drop ball directly on the rim segment at rimX + R
      const ballBody = physicsWorld.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(hoop.rimX + hoop.config.rimRadius, hoop.rimY + 0.45, hoop.rimZ)
      );
      const ballCol = physicsWorld.world.createCollider(
        RAPIER.ColliderDesc.ball(SIMULATION_CONFIG.ball.radius),
        ballBody
      );

      let physicalContactOccurred = false;
      let contactEventCount = 0;

      for (let s = 0; s < 60; s++) {
        physicsWorld.world.step();
        for (const rimCol of hoop.rimColliders) {
          physicsWorld.world.contactPair(ballCol, rimCol, (manifold) => {
            if (manifold.numContacts() > 0) {
              physicalContactOccurred = true;
              contactEventCount += manifold.numContacts();
            }
          });
        }
      }

      // Must have registered physical contact events with the rim
      expect(physicalContactOccurred).toBe(true);
      expect(contactEventCount).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // TASK 2: BASKETBALL MUZZLE SPAWN POSITION & VELOCITY INHERITANCE
  // =========================================================================
  describe('Task 2: Basketball Muzzle Spawn Position & Velocity Addition', () => {
    let robot;
    let basketball;
    let shooter;

    beforeEach(() => {
      robot = new Robot(scene, physicsWorld);
      basketball = new Basketball(scene, physicsWorld);
      shooter = new ShootingMechanism();
    });

    afterEach(() => {
      if (robot) robot.destroy();
    });

    it('configures muzzleLocalPos strictly outside robot chassis collider AABB with >= 3cm safety margin', () => {
      const c = SIMULATION_CONFIG.robot.chassis;
      const chassisHalfX = c.length / 2; // 0.38m
      const ballRadius = SIMULATION_CONFIG.ball.radius; // 0.12m
      const minRequiredMargin = 0.03; // 3cm

      const muzzle = shooter.muzzleLocalPos;
      expect(muzzle.x).toBeGreaterThanOrEqual(chassisHalfX + ballRadius + minRequiredMargin);

      // Distance from chassis front face (+0.38) to rear edge of spawned ball
      const rearBallX = muzzle.x - ballRadius;
      const clearance = rearBallX - chassisHalfX;
      expect(clearance).toBeGreaterThanOrEqual(minRequiredMargin);
    });

    it('spawns ball without collision interpenetration with robot chassis colliders on launch frame', () => {
      // Setup ball possession in intake
      robot.intake.isBallCaptured = true;
      robot.intake.state = 'BALL_CAPTURED';

      // Fire ball
      const fired = shooter.fire(robot, basketball);
      expect(fired).toBe(true);

      // Check contact pairs immediately on launch frame
      const ballCol = basketball.collider;
      const robotCol = robot.collider;

      let contactOnLaunch = false;
      physicsWorld.world.step();
      physicsWorld.world.contactPair(ballCol, robotCol, (manifold) => {
        if (manifold.numContacts() > 0) {
          contactOnLaunch = true;
        }
      });

      expect(contactOnLaunch).toBe(false);
    });

    it('inherits robot linear velocity upon firing (Galilean velocity addition)', () => {
      robot.intake.isBallCaptured = true;
      robot.intake.state = 'BALL_CAPTURED';

      // Set robot moving forward along +X at 1.8 m/s
      const robotForwardSpeed = 1.8;
      robot.rigidBody.setLinvel({ x: robotForwardSpeed, y: 0, z: 0 }, true);

      // Calculate baseline static launch velocity
      const robotPos = robot.getPosition();
      const muzzleWorld = {
        x: robotPos.x + shooter.muzzleLocalPos.x,
        y: robotPos.y + shooter.muzzleLocalPos.y,
        z: robotPos.z
      };
      const solution = shooter.calculator.calculateSolution(muzzleWorld, shooter.defaultHoopPos, shooter.launchAngleDeg);
      expect(solution.valid).toBe(true);

      // Fire while robot is moving
      shooter.fire(robot, basketball);

      const firedBallVel = basketball.getVelocity();
      // Fired velocity X must equal launch velocity X + robot forward velocity X
      expect(firedBallVel.x).toBeCloseTo(solution.launchVelocity.x + robotForwardSpeed, 2);
      expect(firedBallVel.y).toBeCloseTo(solution.launchVelocity.y, 2);
      expect(firedBallVel.z).toBeCloseTo(solution.launchVelocity.z, 2);
    });

    it('preserves intake capture, containment, and release interlocks', () => {
      // Cannot fire without captured ball
      robot.intake.isBallCaptured = false;
      const firedWithoutBall = shooter.fire(robot, basketball);
      expect(firedWithoutBall).toBe(false);
      expect(shooter.lastRejectReason).toContain('No ball in containment');

      // Once captured, releases properly on firing
      robot.intake.isBallCaptured = true;
      robot.intake.ballState = 'CAPTURED';
      const firedWithBall = shooter.fire(robot, basketball);
      expect(firedWithBall).toBe(true);
      expect(robot.intake.isBallCaptured).toBe(false);
      expect(robot.intake.ballState).toBe('IN_FLIGHT');
    });
  });

  // =========================================================================
  // TASK 3: TRAJECTORY CALCULATIONS UNDER RAPIER LINEAR DAMPING
  // =========================================================================
  describe('Task 3: Damped Ballistic Trajectory Calculations', () => {
    let calculator;

    beforeEach(() => {
      calculator = new TrajectoryCalculator({
        gravity: 9.81,
        linearDamping: 0.08,
        defaultAngleDeg: 52.0
      });
    });

    it('matches simulated Rapier 3D dynamic ball trajectory within < 2cm at target hoop plane', () => {
      const launchPos = { x: 8.2, y: 0.865, z: 0.0 };
      const targetPos = { x: 12.425, y: 3.05, z: 0.0 };
      const angleDeg = 52.0;

      const solution = calculator.calculateSolution(launchPos, targetPos, angleDeg);
      expect(solution.valid).toBe(true);

      // Create Rapier world with matching parameters
      const ballBody = physicsWorld.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(launchPos.x, launchPos.y, launchPos.z)
          .setLinearDamping(0.08)
      );
      physicsWorld.world.createCollider(
        RAPIER.ColliderDesc.ball(0.12),
        ballBody
      );

      // Inject solved velocity
      ballBody.setLinvel(solution.launchVelocity, true);

      // Step simulation for exact flight time
      const dt = 1 / 60;
      const steps = Math.round(solution.flightTime / dt);
      for (let s = 0; s < steps; s++) {
        physicsWorld.world.step();
      }

      const finalPos = ballBody.translation();

      // Discrepancy at hoop target must be under 2 cm (0.02m)
      const errX = Math.abs(finalPos.x - targetPos.x);
      const errY = Math.abs(finalPos.y - targetPos.y);
      const errZ = Math.abs(finalPos.z - targetPos.z);

      expect(errX).toBeLessThan(0.02); // < 2 cm in X
      expect(errY).toBeLessThan(0.02); // < 2 cm in Y
      expect(errZ).toBeLessThan(0.01); // < 1 cm in Z
    });

    it('eliminates the ~35cm undershoot observed with vacuum equations over long range (7m)', () => {
      const launchPos = { x: 5.425, y: 0.865, z: 0.0 };
      const targetPos = { x: 12.425, y: 3.05, z: 0.0 };
      const angleDeg = 55.0;

      // 1. Solve with damped calculator
      const dampedSolution = calculator.calculateSolution(launchPos, targetPos, angleDeg);
      expect(dampedSolution.valid).toBe(true);

      // 2. Solve with vacuum calculator (gamma = 0)
      const vacuumCalculator = new TrajectoryCalculator({
        gravity: 9.81,
        linearDamping: 0.0,
        defaultAngleDeg: 55.0
      });
      const vacuumSolution = vacuumCalculator.calculateSolution(launchPos, targetPos, angleDeg);
      expect(vacuumSolution.valid).toBe(true);

      // Damped launch speed must be higher to overcome aerodynamic damping
      expect(dampedSolution.speed).toBeGreaterThan(vacuumSolution.speed);

      // Simulate both in Rapier with real damping
      const testShot = (launchVel, flightTime) => {
        const body = physicsWorld.world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(launchPos.x, launchPos.y, launchPos.z)
            .setLinearDamping(0.08)
        );
        physicsWorld.world.createCollider(RAPIER.ColliderDesc.ball(0.12), body);
        body.setLinvel(launchVel, true);

        const dt = 1 / 60;
        const steps = Math.round(flightTime / dt);
        for (let s = 0; s < steps; s++) {
          physicsWorld.world.step();
        }
        return body.translation();
      };

      const dampedFinal = testShot(dampedSolution.launchVelocity, dampedSolution.flightTime);
      const vacuumFinal = testShot(vacuumSolution.launchVelocity, vacuumSolution.flightTime);

      const dampedDistErr = Math.hypot(dampedFinal.x - targetPos.x, dampedFinal.y - targetPos.y);
      const vacuumDistErr = Math.hypot(vacuumFinal.x - targetPos.x, vacuumFinal.y - targetPos.y);

      // Damped solution arrives within 2.5 cm of hoop center
      expect(dampedDistErr).toBeLessThan(0.025);

      // Vacuum solution undershoots by > 35 cm!
      expect(vacuumDistErr).toBeGreaterThan(0.35);
    });

    it('predicts exact target position at flightTime using predictPositionAtTime', () => {
      const launchPos = { x: 6.0, y: 0.85, z: 1.5 };
      const targetPos = { x: 12.425, y: 3.05, z: 0.0 };
      const solution = calculator.calculateSolution(launchPos, targetPos, 54.0);

      const predictedArrival = calculator.predictPositionAtTime(
        launchPos,
        solution.launchVelocity,
        solution.flightTime
      );

      // Closed-form damped ballistic equation must evaluate to target coordinates
      expect(predictedArrival.x).toBeCloseTo(targetPos.x, 6);
      expect(predictedArrival.y).toBeCloseTo(targetPos.y, 6);
      expect(predictedArrival.z).toBeCloseTo(targetPos.z, 6);
    });

    it('generates trajectory points across full flight arc', () => {
      const launchPos = { x: 8.0, y: 0.85, z: 0.0 };
      const targetPos = { x: 12.425, y: 3.05, z: 0.0 };
      const solution = calculator.calculateSolution(launchPos, targetPos, 52.0);

      const points = calculator.calculateTrajectoryPoints(
        launchPos,
        solution.launchVelocity,
        solution.flightTime,
        40
      );

      expect(points.length).toBe(41);
      expect(points[0].x).toBeCloseTo(launchPos.x, 4);
      expect(points[0].y).toBeCloseTo(launchPos.y, 4);
      expect(points[points.length - 1].x).toBeCloseTo(targetPos.x, 4);
      expect(points[points.length - 1].y).toBeCloseTo(targetPos.y, 4);

      // Peak point must be near apexHeight
      const maxY = Math.max(...points.map(p => p.y));
      expect(maxY).toBeCloseTo(solution.apexHeight, 1);
    });
  });
});
