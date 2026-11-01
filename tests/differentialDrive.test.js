import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { DifferentialDriveController } from '../src/robot/DifferentialDriveController.js';
import { PhysicsWorld } from '../src/simulation/PhysicsWorld.js';
import { Robot } from '../src/robot/Robot.js';

describe('DifferentialDriveController', () => {
  let controller;

  beforeEach(() => {
    controller = new DifferentialDriveController({
      wheelRadius: 0.10,
      trackWidth: 0.64,
      maxLinearVelocity: 2.0,
      maxAngularVelocity: 3.0,
      maxLinearAcceleration: 4.0,   // 4 m/s²
      maxAngularAcceleration: 6.0,  // 6 rad/s²
      maxWheelAngularVelocity: 22.0 // rad/s
    });
  });

  describe('Forward Movement', () => {
    it('accelerates smoothly and drives both wheels at equal positive speeds', () => {
      controller.setTargetVelocity(1.5, 0.0);
      expect(controller.mode).toBe('MANUAL');

      // Step 0.2s: max change = 4.0 * 0.2 = 0.8 m/s
      controller.update(0.2, 0.0);
      expect(controller.currentLinearVelocity).toBeCloseTo(0.8, 4);

      // Step another 0.2s: reaches 1.5 m/s target
      controller.update(0.2, 0.0);
      expect(controller.currentLinearVelocity).toBeCloseTo(1.5, 4);
      expect(controller.currentAngularVelocity).toBeCloseTo(0.0, 4);

      // Wheel linear velocities and RPM
      expect(controller.vLeft).toBeCloseTo(1.5, 4);
      expect(controller.vRight).toBeCloseTo(1.5, 4);
      expect(controller.omegaLeft).toBeCloseTo(15.0, 4);
      expect(controller.omegaRight).toBeCloseTo(15.0, 4);
      expect(controller.rpmLeft).toBeGreaterThan(140);
      expect(controller.rpmRight).toBeGreaterThan(140);

      const cmd = controller.generatePhysicsCommand(0.0);
      expect(cmd.movementState).toBe('FORWARD');
      expect(cmd.worldLinvelX).toBeCloseTo(1.5, 4);
      expect(cmd.worldLinvelZ).toBeCloseTo(0.0, 4);
    });
  });

  describe('Reverse Movement', () => {
    it('drives both wheels in reverse with negative speeds', () => {
      controller.setTargetVelocity(-1.2, 0.0);

      // Step until target velocity is reached
      for (let i = 0; i < 4; i++) {
        controller.update(0.1, 0.0);
      }

      expect(controller.currentLinearVelocity).toBeCloseTo(-1.2, 4);
      expect(controller.vLeft).toBeCloseTo(-1.2, 4);
      expect(controller.vRight).toBeCloseTo(-1.2, 4);
      expect(controller.omegaLeft).toBeCloseTo(-12.0, 4);
      expect(controller.omegaRight).toBeCloseTo(-12.0, 4);
      expect(controller.rpmLeft).toBeLessThan(0);
      expect(controller.rpmRight).toBeLessThan(0);

      const cmd = controller.generatePhysicsCommand(0.0);
      expect(cmd.movementState).toBe('REVERSE');
      expect(cmd.worldLinvelX).toBeCloseTo(-1.2, 4);
    });
  });

  describe('Rotation in Both Directions', () => {
    it('executes in-place counter-clockwise (left) rotation', () => {
      controller.setTargetVelocity(0.0, 2.0);

      for (let i = 0; i < 4; i++) {
        controller.update(0.1, 0.0);
      }

      expect(controller.currentLinearVelocity).toBeCloseTo(0.0, 4);
      expect(controller.currentAngularVelocity).toBeCloseTo(2.0, 4);

      // Left wheel reverse, Right wheel forward
      expect(controller.vLeft).toBeLessThan(0);
      expect(controller.vRight).toBeGreaterThan(0);
      expect(controller.vRight).toBeCloseTo(-controller.vLeft, 4);

      const cmd = controller.generatePhysicsCommand(0.0);
      expect(cmd.movementState).toBe('TURNING_LEFT');
      expect(cmd.worldAngvelY).toBeCloseTo(2.0, 4);
    });

    it('executes in-place clockwise (right) rotation', () => {
      controller.setTargetVelocity(0.0, -2.0);

      for (let i = 0; i < 4; i++) {
        controller.update(0.1, 0.0);
      }

      expect(controller.currentAngularVelocity).toBeCloseTo(-2.0, 4);
      expect(controller.vLeft).toBeGreaterThan(0);
      expect(controller.vRight).toBeLessThan(0);

      const cmd = controller.generatePhysicsCommand(0.0);
      expect(cmd.movementState).toBe('TURNING_RIGHT');
      expect(cmd.worldAngvelY).toBeCloseTo(-2.0, 4);
    });
  });

  describe('Zero-Velocity Stopping', () => {
    it('smoothly decelerates to complete stop and enters STOPPED state', () => {
      controller.setTargetVelocity(1.6, 0.0);
      controller.update(0.5, 0.0);
      expect(controller.currentLinearVelocity).toBeGreaterThan(1.0);

      // Command stop
      controller.stop();

      // Step until deceleration completes (1.6 / 4.0 = 0.4s)
      controller.update(0.2, 0.0);
      expect(controller.currentLinearVelocity).toBeLessThan(1.0);

      controller.update(0.3, 0.0);
      expect(controller.currentLinearVelocity).toBeCloseTo(0.0, 4);
      expect(controller.currentAngularVelocity).toBeCloseTo(0.0, 4);

      const cmd = controller.generatePhysicsCommand(0.0);
      expect(cmd.movementState).toBe('STOPPED');
    });
  });

  describe('Wheel Speed Constraints', () => {
    it('scales both wheel velocities proportionally when exceeding maxWheelAngularVelocity', () => {
      // With r = 0.1, L = 0.64, maxWheelAngularVelocity = 22.0 rad/s
      // If we request v = 2.0 m/s, omega = 3.0 rad/s:
      // Unconstrained:
      // v_right = 2.0 + (3.0 * 0.64)/2 = 2.0 + 0.96 = 2.96 m/s -> omega_right = 29.6 rad/s (exceeds 22.0)
      controller.setTargetVelocity(2.0, 3.0);

      // Step enough to attempt reaching high velocity
      for (let i = 0; i < 10; i++) {
        controller.update(0.1, 0.0);
      }

      // Neither wheel angular velocity should exceed max limit
      expect(Math.abs(controller.omegaLeft)).toBeLessThanOrEqual(22.0 + 1e-4);
      expect(Math.abs(controller.omegaRight)).toBeLessThanOrEqual(22.0 + 1e-4);

      // Trajectory curvature (omega / v) should be preserved
      const unconstrainedRatio = 3.0 / 2.0; // 1.5 rad/m
      const actualRatio = controller.currentAngularVelocity / controller.currentLinearVelocity;
      expect(actualRatio).toBeCloseTo(unconstrainedRatio, 3);
    });
  });

  describe('Emergency Stop', () => {
    it('immediately zeroes all velocities and enters E_STOP mode', () => {
      controller.setTargetVelocity(1.8, 1.2);
      controller.update(0.5, 0.0);
      expect(controller.currentLinearVelocity).toBeGreaterThan(1.0);

      // Trigger E-STOP
      controller.emergencyStop();

      expect(controller.mode).toBe('E_STOP');
      expect(controller.currentLinearVelocity).toBe(0.0);
      expect(controller.currentAngularVelocity).toBe(0.0);
      expect(controller.vLeft).toBe(0.0);
      expect(controller.vRight).toBe(0.0);
      expect(controller.omegaLeft).toBe(0.0);
      expect(controller.omegaRight).toBe(0.0);

      const cmd = controller.generatePhysicsCommand(0.0);
      expect(cmd.movementState).toBe('E_STOP');
    });
  });
});

describe('Physics Integration and Robot Movement', () => {
  let scene;
  let physicsWorld;
  let robot;

  beforeEach(async () => {
    scene = new THREE.Scene();
    physicsWorld = new PhysicsWorld();
    await physicsWorld.initialize();

    // Create ground collider
    physicsWorld.createStaticBox(0, -0.25, 0, 30, 0.5, 20, 0.5, 0.7);

    // Create robot on ground
    robot = new Robot(scene, physicsWorld);
  });

  afterEach(() => {
    if (robot) robot.destroy();
    if (physicsWorld) physicsWorld.destroy();
  });

  it('translates robot in Rapier physics world according to differential drive commands', () => {
    const startPos = robot.getPosition();
    const initialX = startPos.x;

    // Command forward drive
    robot.driveController.setTargetVelocity(1.5, 0.0);

    // Step physics and robot controller for 0.5 seconds
    const dt = 1 / 60;
    for (let step = 0; step < 30; step++) {
      robot.update(dt);
      physicsWorld.step(dt);
    }

    const currentPos = robot.getPosition();
    // With initial heading = 0 (pointing +X), robot should have driven forward in +X
    expect(currentPos.x).toBeGreaterThan(initialX + 0.1);

    // Robot should remain solidly grounded without falling or floating
    expect(currentPos.y).toBeGreaterThan(0.0);
    expect(currentPos.y).toBeLessThan(1.0);

    // Visual wheels should have accumulated rotation
    expect(robot.driveController.wheelAngleLeft).toBeGreaterThan(0.5);
    expect(robot.driveController.wheelAngleRight).toBeGreaterThan(0.5);
  });

  it('rotates robot heading in Rapier physics world during turn commands', () => {
    const initialHeading = robot.getHeading();

    // Command left turn in place
    robot.driveController.setTargetVelocity(0.0, 2.0);

    const dt = 1 / 60;
    for (let step = 0; step < 30; step++) {
      robot.update(dt);
      physicsWorld.step(dt);
    }

    const currentHeading = robot.getHeading();
    // Heading should have increased counter-clockwise (positive yaw)
    expect(currentHeading).toBeGreaterThan(initialHeading);
  });

  it('resets robot kinematics and physics pose cleanly', () => {
    robot.driveController.setTargetVelocity(1.5, 1.0);
    for (let i = 0; i < 20; i++) {
      robot.update(1 / 60);
      physicsWorld.step(1 / 60);
    }

    robot.reset();

    const tel = robot.getDriveTelemetry();
    expect(tel.linearVelocity).toBe(0.0);
    expect(tel.angularVelocity).toBe(0.0);
    expect(tel.vLeft).toBe(0.0);
    expect(tel.vRight).toBe(0.0);
    expect(tel.mode).toBe('STOPPED');
  });
});
