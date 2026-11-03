/**
 * vision.test.js
 * Comprehensive Vitest suite for SMART-BASKETBOT Milestone 6: Simulated Vision and Object Detection.
 *
 * Verifies:
 * 1. Camera follows robot translation.
 * 2. Camera follows robot rotation.
 * 3. Ball inside FOV is detected.
 * 4. Ball outside FOV is rejected.
 * 5. Ball behind camera is rejected.
 * 6. Ball beyond max distance is rejected.
 * 7. Multiple basketballs can be detected.
 * 8. Hoop visibility is correctly determined.
 * 9. Relative positions and distances are calculated accurately.
 * 10. Object IDs remain stable across updates.
 * 11. Lost objects are handled after configured timeout.
 * 12. Reset clears tracking state and IDs.
 * 13. Disabled vision does not produce active detections.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { CameraSystem } from '../src/vision/CameraSystem.js';
import { BallDetection } from '../src/vision/BallDetection.js';
import { HoopDetection } from '../src/vision/HoopDetection.js';
import { ObjectTracker } from '../src/vision/ObjectTracker.js';
import { VisionManager } from '../src/vision/VisionManager.js';

describe('Milestone 6: Simulated Vision & Object Detection', () => {
  // Helper to create a mock robot entity
  function createMockRobot(x = 0, y = 0.1, z = 0, heading = 0) {
    return {
      getPosition: () => ({ x, y, z }),
      getHeading: () => heading,
      mesh: new THREE.Object3D()
    };
  }

  // Helper to create a mock basketball entity
  function createMockBall(x = 5, y = 0.24, z = 0, name = 'Basketball') {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshBasicMaterial()
    );
    mesh.name = name;
    mesh.position.set(x, y, z);
    return {
      getPosition: () => ({ x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }),
      mesh
    };
  }

  // Helper to create a mock regulation hoop
  function createMockHoop(side = 1) {
    const rimX = side * 13.625;
    const rimY = 3.05;
    const rimZ = 0.0;
    return {
      side,
      rimX,
      rimY,
      rimZ,
      config: {
        rimRadius: 0.225,
        backboardWidth: 1.8,
        backboardHeight: 1.05
      },
      getRimPosition: () => ({ x: rimX, y: rimY, z: rimZ })
    };
  }

  // =========================================================================
  // TEST 1: Camera follows robot translation
  // =========================================================================
  it('1. Camera follows robot translation', () => {
    const cameraSystem = new CameraSystem({
      mountOffset: { x: 0.14, y: 0.35, z: 0.0 }
    });

    const robot1 = createMockRobot(2.0, 0.1, -3.0, 0);
    cameraSystem.updatePose(robot1);

    const pos1 = cameraSystem.getCameraPosition();
    expect(pos1.x).toBeCloseTo(2.14, 2);
    expect(pos1.y).toBeCloseTo(0.45, 2);
    expect(pos1.z).toBeCloseTo(-3.0, 2);

    // Translate robot to a different location
    const robot2 = createMockRobot(8.5, 0.2, 5.0, 0);
    cameraSystem.updatePose(robot2);

    const pos2 = cameraSystem.getCameraPosition();
    expect(pos2.x).toBeCloseTo(8.64, 2);
    expect(pos2.y).toBeCloseTo(0.55, 2);
    expect(pos2.z).toBeCloseTo(5.0, 2);
  });

  // =========================================================================
  // TEST 2: Camera follows robot rotation
  // =========================================================================
  it('2. Camera follows robot rotation', () => {
    const cameraSystem = new CameraSystem({
      mountOffset: { x: 0.14, y: 0.35, z: 0.0 }
    });

    // Robot facing East (heading = 0 rad, cos(0)=1, -sin(0)=0)
    const robotFacingEast = createMockRobot(0, 0, 0, 0);
    cameraSystem.updatePose(robotFacingEast);

    const fwdEast = cameraSystem.getForwardVector();
    expect(fwdEast.x).toBeGreaterThan(0.9);
    expect(Math.abs(fwdEast.z)).toBeLessThan(0.1);

    // Rotate robot 90 deg counter-clockwise (heading = pi/2 rad)
    // Forward direction should now align with -Z (cos(pi/2)=0, -sin(pi/2)=-1)
    const robotFacingNorth = createMockRobot(0, 0, 0, Math.PI / 2);
    cameraSystem.updatePose(robotFacingNorth);

    const fwdNorth = cameraSystem.getForwardVector();
    expect(Math.abs(fwdNorth.x)).toBeLessThan(0.1);
    expect(fwdNorth.z).toBeLessThan(-0.9);
  });

  // =========================================================================
  // TEST 3: Ball inside FOV is detected
  // =========================================================================
  it('3. Ball inside FOV is detected', () => {
    const cameraSystem = new CameraSystem({ fov: 70, far: 18.0 });
    const ballDetection = new BallDetection(cameraSystem);

    const robot = createMockRobot(0, 0.1, 0, 0); // facing East (+X)
    cameraSystem.updatePose(robot);

    // Ball 5m directly ahead
    const ball = createMockBall(5.0, 0.24, 0.0);
    const detections = ballDetection.detect(ball);

    expect(detections).toHaveLength(1);
    const det = detections[0];
    expect(det.distance).toBeGreaterThan(4.5);
    expect(det.distance).toBeLessThan(5.0);
    expect(det.confidence).toBeGreaterThan(0.5);
    expect(det.screen.x).toBeGreaterThan(0);
    expect(det.screen.x).toBeLessThan(cameraSystem.width);
    expect(det.screenBoundingBox.width).toBeGreaterThan(0);
  });

  // =========================================================================
  // TEST 4: Ball outside FOV is rejected
  // =========================================================================
  it('4. Ball outside FOV is rejected', () => {
    const cameraSystem = new CameraSystem({ fov: 70, far: 18.0 });
    const ballDetection = new BallDetection(cameraSystem);

    const robot = createMockRobot(0, 0.1, 0, 0); // facing East (+X)
    cameraSystem.updatePose(robot);

    // Ball placed far to the side (angle > 65 deg from center, FOV is 70 deg total)
    const ballOutside = createMockBall(3.0, 0.24, 8.0);
    const detections = ballDetection.detect(ballOutside);

    expect(detections).toHaveLength(0);
  });

  // =========================================================================
  // TEST 5: Ball behind camera is rejected
  // =========================================================================
  it('5. Ball behind camera is rejected', () => {
    const cameraSystem = new CameraSystem({ fov: 70, far: 18.0 });
    const ballDetection = new BallDetection(cameraSystem);

    const robot = createMockRobot(0, 0.1, 0, 0); // facing East (+X)
    cameraSystem.updatePose(robot);

    // Ball placed behind the robot at -X
    const ballBehind = createMockBall(-4.0, 0.24, 0.0);
    const detections = ballDetection.detect(ballBehind);

    expect(detections).toHaveLength(0);
  });

  // =========================================================================
  // TEST 6: Ball beyond max distance is rejected
  // =========================================================================
  it('6. Ball beyond max distance is rejected', () => {
    const cameraSystem = new CameraSystem({ fov: 70, far: 12.0 }); // max range 12m
    const ballDetection = new BallDetection(cameraSystem);

    const robot = createMockRobot(0, 0.1, 0, 0);
    cameraSystem.updatePose(robot);

    // Ball 16m away (exceeds 12m)
    const ballFar = createMockBall(16.0, 0.24, 0.0);
    const detections = ballDetection.detect(ballFar);

    expect(detections).toHaveLength(0);
  });

  // =========================================================================
  // TEST 7: Multiple basketballs can be detected
  // =========================================================================
  it('7. Multiple basketballs can be detected', () => {
    const cameraSystem = new CameraSystem({ fov: 70, far: 18.0 });
    const ballDetection = new BallDetection(cameraSystem);

    const robot = createMockRobot(0, 0.1, 0, 0);
    cameraSystem.updatePose(robot);

    // 3 balls at different locations inside FOV
    const balls = [
      createMockBall(4.0, 0.24, -0.5, 'Ball_A'),
      createMockBall(6.0, 0.24, 0.2, 'Ball_B'),
      createMockBall(8.0, 0.24, 0.8, 'Ball_C')
    ];

    const detections = ballDetection.detect(balls);
    expect(detections).toHaveLength(3);

    // Verify all 3 have distinct distances in sorted order
    expect(detections[0].distance).toBeLessThan(detections[1].distance);
    expect(detections[1].distance).toBeLessThan(detections[2].distance);
  });

  // =========================================================================
  // TEST 8: Hoop visibility is correctly determined
  // =========================================================================
  it('8. Hoop visibility is correctly determined', () => {
    const cameraSystem = new CameraSystem({ fov: 70, far: 20.0 });
    const hoopDetection = new HoopDetection(cameraSystem);
    const hoopEast = createMockHoop(1); // at X = 13.625

    // Robot facing the hoop
    const robotFacingHoop = createMockRobot(5.0, 0.1, 0.0, 0); // facing +X
    cameraSystem.updatePose(robotFacingHoop);

    const obsVisible = hoopDetection.detect(hoopEast);
    expect(obsVisible.visible).toBe(true);
    expect(obsVisible.confidence).toBeGreaterThan(0.4);
    // 3D Euclidean distance between camera (x=5.14, y=0.45) and rim (x=13.625, y=3.05)
    const expectedDist = Math.hypot(13.625 - 5.14, 3.05 - 0.45);
    expect(obsVisible.distance).toBeCloseTo(expectedDist, 1);
    expect(obsVisible.screenBoundingBox).toBeDefined();
    expect(obsVisible.screenBoundingBox.width).toBeGreaterThan(0);

    // Robot facing away from the hoop (facing West, heading = Math.PI)
    const robotFacingAway = createMockRobot(5.0, 0.1, 0.0, Math.PI);
    cameraSystem.updatePose(robotFacingAway);

    const obsHidden = hoopDetection.detect(hoopEast);
    expect(obsHidden.visible).toBe(false);
    expect(obsHidden.confidence).toBe(0);
  });

  // =========================================================================
  // TEST 9: Relative positions and distances are calculated accurately
  // =========================================================================
  it('9. Relative positions and distances are calculated accurately', () => {
    const cameraSystem = new CameraSystem({
      mountOffset: { x: 0.0, y: 0.0, z: 0.0 }, // zero mount offset for simple geometry
      pitchDeg: 0.0, // horizontal optical axis
      fov: 70,
      far: 20.0
    });
    const ballDetection = new BallDetection(cameraSystem);

    const robot = createMockRobot(0, 0, 0, 0);
    cameraSystem.updatePose(robot);

    // Ball placed at (x=4, y=0, z=3) -> distance = sqrt(4^2 + 3^2) = 5.0m
    const ball = createMockBall(4.0, 0.0, 3.0);
    const detections = ballDetection.detect(ball);

    expect(detections).toHaveLength(1);
    const det = detections[0];
    expect(det.distance).toBeCloseTo(5.0, 2);

    // Bearing angle: z=3 (to the right / south), x=4 -> bearing ~ 36.87 deg
    expect(det.azimuthDeg).toBeCloseTo(36.87, 1);
  });

  // =========================================================================
  // TEST 10: Object IDs remain stable across updates
  // =========================================================================
  it('10. Object IDs remain stable across updates', () => {
    const tracker = new ObjectTracker({ associationThreshold: 1.0 });

    // Frame 1: Detection at (4, 0)
    const rawFrame1 = [
      {
        worldPosition: { x: 4.0, y: 0.24, z: 0.0 },
        screen: { x: 160, y: 120 },
        screenBoundingBox: { x: 150, y: 110, width: 20, height: 20 },
        distance: 4.0,
        azimuthDeg: 0,
        elevationDeg: 0,
        confidence: 0.95
      }
    ];

    const tracked1 = tracker.update(rawFrame1, 0.016);
    expect(tracked1).toHaveLength(1);
    expect(tracked1[0].id).toBe('BALL_1');
    expect(tracked1[0].status).toBe('TRACKED');

    // Frame 2: Ball moves slightly to (4.1, 0.05)
    const rawFrame2 = [
      {
        worldPosition: { x: 4.1, y: 0.24, z: 0.05 },
        screen: { x: 162, y: 120 },
        screenBoundingBox: { x: 152, y: 110, width: 20, height: 20 },
        distance: 4.1,
        azimuthDeg: 0.7,
        elevationDeg: 0,
        confidence: 0.94
      }
    ];

    const tracked2 = tracker.update(rawFrame2, 0.016);
    expect(tracked2).toHaveLength(1);
    expect(tracked2[0].id).toBe('BALL_1'); // Must preserve identical stable ID
    // Position filtered with alpha smoothing: 4.0 * (1 - 0.65) + 4.1 * 0.65 = 4.065
    expect(tracked2[0].worldPosition.x).toBeCloseTo(4.065, 2);
  });

  // =========================================================================
  // TEST 11: Lost objects are handled after configured timeout
  // =========================================================================
  it('11. Lost objects are handled after configured timeout', () => {
    const tracker = new ObjectTracker({ lostTimeout: 1.0 });

    // Frame 1: Track ball
    tracker.update([
      {
        worldPosition: { x: 5.0, y: 0.24, z: 0.0 },
        screen: { x: 160, y: 120 },
        screenBoundingBox: { x: 150, y: 110, width: 20, height: 20 },
        distance: 5.0,
        azimuthDeg: 0,
        elevationDeg: 0,
        confidence: 0.95
      }
    ], 0.016);

    expect(tracker.getTrackedObjects()).toHaveLength(1);
    expect(tracker.getTrackedObjects()[0].status).toBe('TRACKED');

    // Frame 2: Ball is temporarily unobserved for 0.4 seconds (below 1.0s timeout)
    tracker.update([], 0.4);
    expect(tracker.getTrackedObjects()).toHaveLength(1);
    expect(tracker.getTrackedObjects()[0].status).toBe('LOST');

    // Frame 3: Time exceeds lostTimeout (0.7s more -> total 1.1s > 1.0s)
    tracker.update([], 0.7);
    expect(tracker.getTrackedObjects()).toHaveLength(0); // Track pruned
  });

  // =========================================================================
  // TEST 12: Reset clears tracking state and IDs
  // =========================================================================
  it('12. Reset clears tracking state and IDs', () => {
    const tracker = new ObjectTracker();

    // Track 2 objects
    tracker.update([
      { worldPosition: { x: 3.0, y: 0.24, z: 0.0 }, distance: 3.0, confidence: 0.9 },
      { worldPosition: { x: 7.0, y: 0.24, z: 0.0 }, distance: 7.0, confidence: 0.85 }
    ], 0.016);

    expect(tracker.getTrackedObjects()).toHaveLength(2);

    // Call reset
    tracker.reset();
    expect(tracker.getTrackedObjects()).toHaveLength(0);

    // After reset, next detection restarts with monotonic BALL_1
    const nextTracks = tracker.update([
      { worldPosition: { x: 5.0, y: 0.24, z: 0.0 }, distance: 5.0, confidence: 0.9 }
    ], 0.016);

    expect(nextTracks).toHaveLength(1);
    expect(nextTracks[0].id).toBe('BALL_1');
  });

  // =========================================================================
  // TEST 13: Disabled vision does not produce active detections
  // =========================================================================
  it('13. Disabled vision does not produce active detections', () => {
    const visionManager = new VisionManager({ enabled: false });

    const robot = createMockRobot(0, 0.1, 0, 0);
    const ball = createMockBall(5.0, 0.24, 0.0);
    const hoop = createMockHoop(1);

    visionManager.update(0.016, robot, ball, hoop);

    const telemetry = visionManager.getTelemetry();
    expect(telemetry.enabled).toBe(false);
    expect(telemetry.balls.count).toBe(0);
    expect(telemetry.balls.tracked).toHaveLength(0);
    expect(telemetry.balls.primary).toBeNull();
    expect(telemetry.hoop.visible).toBe(false);
  });
});
