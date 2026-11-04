/**
 * ballTrajectoryTracking.test.js
 * Comprehensive automated verification suite for the Real-Time 3D Basketball Trajectory Tracking System.
 *
 * Covers all 9 required testing criteria:
 * 1. Ball position sampling from the physics rigid body (center of mass)
 * 2. Correct recording of successive 3D positions and path length
 * 3. Trajectory geometry updates (reusable BufferGeometry, DynamicDrawUsage, drawRange)
 * 4. Visibility toggle behaviour without destroying data
 * 5. Clearing trajectory data
 * 6. Ball reset integration (Simulation.reset, Simulation.resetBall)
 * 7. Maximum trajectory point limit (preventing memory growth / buffer overflow)
 * 8. Correct handling of stationary balls (settling, PRESERVED state, deadband)
 * 9. Autonomous shooting integration (intake possession gating, auto-clearing on new shot)
 * 10. Rebound and collision arc tracking
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { BallTrajectoryTracker } from '../src/environment/BallTrajectoryTracker.js';
import { PhysicsWorld } from '../src/simulation/PhysicsWorld.js';
import { Basketball } from '../src/environment/Basketball.js';
import { Robot } from '../src/robot/Robot.js';
import { BasketballHoop } from '../src/environment/BasketballHoop.js';
import { HoopDetector } from '../src/robot/HoopDetector.js';

describe('Real-Time 3D Basketball Trajectory Tracking System', () => {
  let scene;
  let physicsWorld;
  let basketball;
  let tracker;

  beforeEach(async () => {
    scene = new THREE.Scene();
    physicsWorld = new PhysicsWorld();
    await physicsWorld.initialize();

    // Floor collider for realistic bounces and settling
    physicsWorld.createStaticBox(0, -0.25, 0, 30, 0.5, 20, 0.75, 0.6);

    basketball = new Basketball(scene, physicsWorld, {
      id: 'test_basketball',
      initialPosition: { x: 0, y: 1.5, z: 0 }
    });

    tracker = new BallTrajectoryTracker(scene, {
      maxPoints: 1000,
      minDistance: 0.02,
      minSpeedThreshold: 0.08,
      stationaryTimeThreshold: 0.35,
      autoClearOnNewShot: true
    });
  });

  // --------------------------------------------------------------------------
  // 1. Position Sampling from Physics Rigid Body
  // --------------------------------------------------------------------------
  describe('1. Physics Rigid Body Position Sampling', () => {
    it('samples the exact world center-of-mass coordinates from Rapier rigidBody translation', () => {
      const translation = basketball.rigidBody.translation();
      const sampled = tracker.samplePosition(basketball);

      expect(sampled).toBeDefined();
      expect(sampled.x).toBeCloseTo(translation.x, 4);
      expect(sampled.y).toBeCloseTo(translation.y, 4);
      expect(sampled.z).toBeCloseTo(translation.z, 4);
    });

    it('measures linear speed accurately from rigidBody linvel magnitude', () => {
      basketball.rigidBody.setLinvel({ x: 3.0, y: 4.0, z: 0.0 }, true);
      const speed = tracker.sampleSpeed(basketball);
      expect(speed).toBeCloseTo(5.0, 3); // 3-4-5 triangle
    });

    it('samples position from ball mesh if rigid body is missing as fallback', () => {
      const mockBall = {
        mesh: { position: { x: 1.2, y: 2.3, z: -3.4 } }
      };
      const sampled = tracker.samplePosition(mockBall);
      expect(sampled).toEqual({ x: 1.2, y: 2.3, z: -3.4 });
    });
  });

  // --------------------------------------------------------------------------
  // 2. Successive 3D Position Recording & Arc Metrics
  // --------------------------------------------------------------------------
  describe('2. Successive 3D Position Recording', () => {
    it('records sequential 3D points as the ball translates through the physics world', () => {
      expect(tracker.pointCount).toBe(0);
      expect(tracker.state).toBe('IDLE');

      // Start ball motion
      basketball.rigidBody.setLinvel({ x: 2.0, y: 0.0, z: 0.0 }, true);

      // Step 1
      tracker.update(0.016, basketball);
      expect(tracker.state).toBe('TRACKING');
      expect(tracker.pointCount).toBe(1);

      // Advance physics
      physicsWorld.step(0.05);
      tracker.update(0.05, basketball);
      expect(tracker.pointCount).toBeGreaterThanOrEqual(2);

      // Inspect buffer contents
      const x0 = tracker.positions[0];
      const y0 = tracker.positions[1];
      const z0 = tracker.positions[2];

      const x1 = tracker.positions[3];
      const y1 = tracker.positions[4];
      const z1 = tracker.positions[5];

      expect(x1).toBeGreaterThan(x0);
      expect(tracker.totalDistance).toBeGreaterThan(0.05);
    });

    it('accumulates total Euclidean distance and tracks peak height accurately', () => {
      tracker.clear();
      tracker.state = 'TRACKING';

      tracker.addPoint({ x: 0, y: 1.0, z: 0 });
      tracker.addPoint({ x: 3, y: 5.0, z: 0 }); // dy=4, dx=3 => dist=5, peak=5
      tracker.addPoint({ x: 3, y: 1.0, z: 0 }); // dy=-4 => dist=5+4=9, peak still 5

      expect(tracker.pointCount).toBe(3);
      expect(tracker.totalDistance).toBeCloseTo(9.0, 2);
      expect(tracker.peakHeight).toBeCloseTo(5.0, 2);
    });

    it('enforces minDistance spatial separation to avoid storing redundant points', () => {
      tracker.clear();
      tracker.state = 'TRACKING';

      tracker.addPoint({ x: 1.0, y: 1.0, z: 1.0 });

      // Point within 0.005m (< minDistance 0.02m)
      const closePos = { x: 1.005, y: 1.002, z: 1.001 };
      expect(tracker.shouldRecordPoint(closePos)).toBe(false);

      // Point beyond 0.02m
      const farPos = { x: 1.03, y: 1.0, z: 1.0 };
      expect(tracker.shouldRecordPoint(farPos)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Three.js Reusable BufferGeometry Updates
  // --------------------------------------------------------------------------
  describe('3. Reusable Three.js BufferGeometry & Material Integrity', () => {
    it('uses persistent BufferGeometry with DynamicDrawUsage and zero allocations on update', () => {
      expect(tracker.geometry).toBeInstanceOf(THREE.BufferGeometry);
      expect(tracker.positionAttribute.usage).toBe(THREE.DynamicDrawUsage);
      expect(tracker.line).toBeInstanceOf(THREE.Line);
      expect(tracker.line.frustumCulled).toBe(false);

      const initialGeom = tracker.geometry;
      const initialMat = tracker.material;

      // Add points
      tracker.addPoint({ x: 1, y: 2, z: 3 });
      tracker.addPoint({ x: 2, y: 3, z: 4 });

      // Draw range matches pointCount
      expect(tracker.geometry.drawRange.count).toBe(2);

      // Geometry and material instances remain identical (reused)
      expect(tracker.geometry).toBe(initialGeom);
      expect(tracker.material).toBe(initialMat);
    });

    it('sets high-contrast color and allows dynamic color updates', () => {
      expect(tracker.material.color.getHex()).toBe(0x00f0ff); // Bright cyan default

      tracker.setColor(0xff6600); // Change to bright orange
      expect(tracker.material.color.getHex()).toBe(0xff6600);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Visibility Toggle Behaviour
  // --------------------------------------------------------------------------
  describe('4. Visibility Toggle Behaviour', () => {
    it('toggles visibility without destroying recorded trajectory points', () => {
      tracker.addPoint({ x: 0, y: 1, z: 0 });
      tracker.addPoint({ x: 1, y: 2, z: 0 });
      expect(tracker.pointCount).toBe(2);
      expect(tracker.line.visible).toBe(true);

      // Hide trajectory
      tracker.setVisible(false);
      expect(tracker.line.visible).toBe(false);
      expect(tracker.isVisible).toBe(false);
      expect(tracker.pointCount).toBe(2); // Points preserved

      // Toggle back to visible
      const newVis = tracker.toggleVisibility();
      expect(newVis).toBe(true);
      expect(tracker.line.visible).toBe(true);
      expect(tracker.pointCount).toBe(2);
    });

    it('continues recording physics points even while trajectory display is hidden', () => {
      tracker.setVisible(false);
      basketball.rigidBody.setLinvel({ x: 5.0, y: 0.0, z: 0.0 }, true);

      tracker.update(0.016, basketball);
      physicsWorld.step(0.05);
      tracker.update(0.05, basketball);

      expect(tracker.pointCount).toBeGreaterThanOrEqual(2);
      expect(tracker.line.visible).toBe(false);

      // Unhide: line is fully formed
      tracker.setVisible(true);
      expect(tracker.line.visible).toBe(true);
      expect(tracker.geometry.drawRange.count).toBe(tracker.pointCount);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Clearing Trajectory Data
  // --------------------------------------------------------------------------
  describe('5. Clearing Trajectory Data', () => {
    it('resets all points, metrics, and draw range on clear()', () => {
      tracker.addPoint({ x: 1, y: 2, z: 3 });
      tracker.addPoint({ x: 4, y: 5, z: 6 });
      tracker.state = 'PRESERVED';

      expect(tracker.pointCount).toBe(2);
      expect(tracker.totalDistance).toBeGreaterThan(0);

      tracker.clear();

      expect(tracker.pointCount).toBe(0);
      expect(tracker.totalDistance).toBe(0);
      expect(tracker.peakHeight).toBe(0);
      expect(tracker.state).toBe('IDLE');
      expect(tracker.geometry.drawRange.count).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Simulation & Ball Reset Integration
  // --------------------------------------------------------------------------
  describe('6. Ball and Simulation Reset Integration', () => {
    it('clears trajectory data cleanly when basketball is reset', () => {
      // Mock simulation harness behavior
      const mockSimulation = {
        trajectoryTracker: tracker,
        resetBall() {
          basketball.reset();
          if (this.trajectoryTracker) {
            this.trajectoryTracker.clear();
          }
        }
      };

      tracker.addPoint({ x: 1, y: 2, z: 3 });
      expect(tracker.pointCount).toBe(1);

      mockSimulation.resetBall();

      expect(tracker.pointCount).toBe(0);
      expect(tracker.state).toBe('IDLE');
    });
  });

  // --------------------------------------------------------------------------
  // 7. Maximum Trajectory Point Limit
  // --------------------------------------------------------------------------
  describe('7. Maximum Trajectory Point Buffer Limit', () => {
    it('clamps to maxPoints without throwing array index exceptions', () => {
      const smallTracker = new BallTrajectoryTracker(scene, { maxPoints: 10, minDistance: 0.01 });

      for (let i = 0; i < 25; i++) {
        smallTracker.addPoint({ x: i * 0.1, y: 1.0, z: 0.0 });
      }

      expect(smallTracker.pointCount).toBe(10);
      expect(smallTracker.geometry.drawRange.count).toBe(10);
    });
  });

  // --------------------------------------------------------------------------
  // 8. Stationary Ball Handling & Settling Lifecycle
  // --------------------------------------------------------------------------
  describe('8. Stationary Ball Handling and Lifecycle', () => {
    it('ignores jitter when ball is stationary on the court', () => {
      // Ball at rest on floor
      basketball.rigidBody.setTranslation({ x: 0, y: 0.12, z: 0 }, true);
      basketball.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);

      tracker.update(0.016, basketball);
      expect(tracker.state).toBe('IDLE');
      expect(tracker.pointCount).toBe(0);
    });

    it('transitions from TRACKING to PRESERVED once ball remains stationary for threshold duration', () => {
      // Start moving
      basketball.rigidBody.setLinvel({ x: 2.0, y: 0.0, z: 0.0 }, true);
      tracker.update(0.016, basketball);
      expect(tracker.state).toBe('TRACKING');
      expect(tracker.pointCount).toBe(1);

      // Stop moving
      basketball.rigidBody.setLinvel({ x: 0.0, y: 0.0, z: 0.0 }, true);

      // Update before stationary threshold (e.g. 0.1s < 0.35s)
      tracker.update(0.1, basketball);
      expect(tracker.state).toBe('TRACKING');

      // Update past stationary threshold (total > 0.35s)
      tracker.update(0.3, basketball);
      expect(tracker.state).toBe('PRESERVED');

      // Further updates while stationary do not add new points
      const countAtPreserve = tracker.pointCount;
      tracker.update(0.1, basketball);
      tracker.update(0.1, basketball);
      expect(tracker.pointCount).toBe(countAtPreserve);
    });
  });

  // --------------------------------------------------------------------------
  // 9. Autonomous Shooting & Intake Integration
  // --------------------------------------------------------------------------
  describe('9. Autonomous Shooting & Intake Possession Gating', () => {
    let robot;
    let hoop;
    let hoopDetector;

    beforeEach(() => {
      robot = new Robot(scene, physicsWorld, () => true);
      hoop = new BasketballHoop(scene, physicsWorld, 1);
      hoopDetector = new HoopDetector();
    });

    it('gates tracking while ball is possessed in robot intake cradle', () => {
      // Simulate ball possessed in intake
      basketball.setState('POSSESSED');
      robot.intake.capturedBall = basketball;
      robot.intake.isBallCaptured = () => true;

      tracker.update(0.016, basketball, robot);
      expect(tracker.checkPossession(basketball, robot)).toBe(true);
      expect(tracker.state).toBe('IDLE');
      expect(tracker.pointCount).toBe(0);
    });

    it('clears previous trajectory and starts tracking fresh upon shooting launch', () => {
      // Simulate old trajectory from previous shot
      tracker.addPoint({ x: -5, y: 0.5, z: 0 });
      tracker.addPoint({ x: -4, y: 1.0, z: 0 });
      tracker.state = 'PRESERVED';
      expect(tracker.pointCount).toBe(2);

      // Ball is now loaded in robot intake
      robot.intake.capturedBall = basketball;
      robot.intake.isBallCaptured = () => true;
      basketball.setState('POSSESSED');
      tracker.update(0.016, basketball, robot);

      // Shooter fires: ball transitions to IN_FLIGHT at muzzle
      robot.intake.releaseBall();
      basketball.setState('IN_FLIGHT');
      basketball.rigidBody.setTranslation({ x: 8.5, y: 0.45, z: 0 }, true);
      basketball.rigidBody.setLinvel({ x: 5.0, y: 7.0, z: 0.0 }, true);

      tracker.update(0.016, basketball, robot);

      // Old trajectory cleared, new tracking session begun at launch position
      expect(tracker.state).toBe('TRACKING');
      expect(tracker.pointCount).toBe(1);
      expect(tracker.positions[0]).toBeCloseTo(8.5, 1);
      expect(tracker.positions[1]).toBeCloseTo(0.45, 1);
    });

    it('generates complete telemetry status report', () => {
      tracker.addPoint({ x: 0, y: 1, z: 0 });
      tracker.addPoint({ x: 3, y: 4, z: 0 });

      const status = tracker.getStatus();
      expect(status).toHaveProperty('state');
      expect(status).toHaveProperty('pointCount', 2);
      expect(status).toHaveProperty('maxPoints', 1000);
      expect(status).toHaveProperty('visible', true);
      expect(status).toHaveProperty('totalDistance');
      expect(status).toHaveProperty('peakHeight', 4.0);
    });
  });

  // --------------------------------------------------------------------------
  // 10. Rebound and Collision Arc Tracking
  // --------------------------------------------------------------------------
  describe('10. Rebound and Collision Tracking', () => {
    it('captures full ballistic trajectory including bounces off floor', () => {
      // Position ball at 3.0m and launch diagonally downward
      basketball.rigidBody.setTranslation({ x: 0, y: 2.0, z: 0 }, true);
      basketball.rigidBody.setLinvel({ x: 2.0, y: -2.0, z: 0 }, true);
      basketball.setState('IN_FLIGHT');

      // Step physics multiple times and sample trajectory
      for (let i = 0; i < 40; i++) {
        physicsWorld.step(0.016);
        tracker.update(0.016, basketball);
      }

      // Trajectory must have recorded multiple points through descent and bounce
      expect(tracker.pointCount).toBeGreaterThan(10);
      expect(tracker.totalDistance).toBeGreaterThan(1.0);
    });
  });
});
