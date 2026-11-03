/**
 * VisionManager.js
 * Central perception coordinator for the SMART-BASKETBOT mobile robotics platform.
 * Integrates:
 * - CameraSystem: 6-DOF robot-mounted virtual camera & offscreen feed renderer
 * - BallDetection: Ball candidate evaluation, projection, and optical confidence
 * - HoopDetection: Regulation hoop, rim center, and backboard observation
 * - ObjectTracker: Temporal multi-ball association, tracking, and velocity filtering
 *
 * Exposes a structured, unified API for autonomous navigation, targeting, and HUD display.
 */

import { CameraSystem } from './CameraSystem.js';
import { BallDetection } from './BallDetection.js';
import { HoopDetection } from './HoopDetection.js';
import { ObjectTracker } from './ObjectTracker.js';

export class VisionManager {
  /**
   * @param {Object} [options]
   * @param {boolean} [options.enabled=true]
   * @param {number} [options.fov=70] Vertical FOV in degrees
   * @param {number} [options.maxDistance=18.0] Max detection range in meters
   * @param {number} [options.width=320] Frame pixel width
   * @param {number} [options.height=240] Frame pixel height
   * @param {number} [options.lostTimeout=1.5] Track loss timeout in seconds
   */
  constructor(options = {}) {
    this.isEnabled = options.enabled ?? true;

    // Subsystems
    this.cameraSystem = new CameraSystem({
      fov: options.fov ?? 70.0,
      far: options.maxDistance ?? 18.0,
      width: options.width ?? 320,
      height: options.height ?? 240
    });

    this.ballDetection = new BallDetection(this.cameraSystem);
    this.hoopDetection = new HoopDetection(this.cameraSystem);
    this.tracker = new ObjectTracker({
      lostTimeout: options.lostTimeout ?? 1.5
    });

    // References
    this.scene = null;
    this.renderer = null;

    // Latest observation caches
    this.latestRawBallDetections = [];
    this.latestHoopObservation = this.hoopDetection.createEmptyObservation();
    this.isInitialized = false;
  }

  /**
   * Initializes vision subsystem with Three.js scene and WebGL renderer.
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} renderer
   */
  initialize(scene, renderer = null) {
    this.scene = scene;
    this.renderer = renderer;

    // Register solid scene objects as candidate occluders
    this.refreshOccluders();

    this.isInitialized = true;
  }

  /**
   * Refreshes list of solid occluder meshes from scene graph.
   * Excludes basketballs, trajectory/path visualizers, and the robot's own chassis meshes.
   */
  refreshOccluders() {
    if (!this.scene) return;

    const occluders = [];
    this.scene.traverse((obj) => {
      // Collect solid static environment meshes (stanchions, backboard, obstacles)
      if (!obj.isMesh) return;
      // Exclude basketballs, path markers, and ground/floor planes
      if (obj.name === 'Basketball' || obj.name.startsWith('Path') || obj.name.startsWith('Waypoint')) return;
      if (obj.name === 'CourtFloor' || obj.name === 'CourtFoundation' || obj.name.includes('Floor')) return;

      // Exclude robot's own chassis and mechanism meshes so they do not self-occlude the camera
      let parent = obj.parent;
      let isRobotMesh = (obj.name === 'SmartBasketBot' || obj.name.startsWith('Robot'));
      while (parent) {
        if (parent.name === 'SmartBasketBot' || (parent.name && parent.name.startsWith('Robot'))) {
          isRobotMesh = true;
          break;
        }
        parent = parent.parent;
      }

      if (!isRobotMesh) {
        occluders.push(obj);
      }
    });

    this.ballDetection.setOccluders(occluders);
    this.hoopDetection.setOccluders(occluders);
  }

  /**
   * Main perception step executed every simulation frame.
   * @param {number} dt Frame time delta in seconds
   * @param {Object} robot Reference to Robot instance
   * @param {Array<Object>|Object} basketballs Single basketball or array of basketballs
   * @param {Object} hoop BasketballHoop instance or hoop specification
   */
  update(dt, robot, basketballs, hoop) {
    if (!this.isEnabled) {
      this.latestRawBallDetections = [];
      this.latestHoopObservation = this.hoopDetection.createEmptyObservation();
      return;
    }

    // 1. Update camera pose and view frustum from robot pose
    this.cameraSystem.update(robot);

    // 2. Render live camera perspective into offscreen buffer (if renderer available)
    if (this.renderer && this.scene) {
      this.cameraSystem.renderFeed(this.renderer, this.scene, dt);
    }

    // 3. Detect basketballs within camera frustum and optical range
    this.latestRawBallDetections = this.ballDetection.detect(basketballs);

    // 4. Update temporal tracker with fresh detections
    this.tracker.update(this.latestRawBallDetections, dt);

    // 5. Detect and observe basketball hoop
    if (hoop) {
      this.latestHoopObservation = this.hoopDetection.detect(hoop);
    } else {
      this.latestHoopObservation = this.hoopDetection.createEmptyObservation();
    }
  }

  /**
   * Enables or disables vision simulation.
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.isEnabled = Boolean(enabled);
    this.cameraSystem.setActive(this.isEnabled);
    if (!this.isEnabled) {
      this.tracker.reset();
      this.latestRawBallDetections = [];
      this.latestHoopObservation = this.hoopDetection.createEmptyObservation();
    }
  }

  /**
   * Sets camera vertical field of view in degrees.
   * @param {number} fovDeg
   */
  setCameraFOV(fovDeg) {
    this.cameraSystem.setFOV(fovDeg);
  }

  /**
   * Sets maximum detection distance in meters.
   * @param {number} maxDist
   */
  setMaxDetectionDistance(maxDist) {
    this.cameraSystem.setMaxDetectionDistance(maxDist);
  }

  /**
   * Sets camera resolution.
   * @param {number} width
   * @param {number} height
   */
  setResolution(width, height) {
    this.cameraSystem.setResolution(width, height);
  }

  /**
   * Returns current camera pose and configuration telemetry.
   */
  getCameraState() {
    return this.cameraSystem.getTelemetry();
  }

  /**
   * Returns array of all actively visible basketball detections in current frame.
   */
  getVisibleBasketballs() {
    return [...this.latestRawBallDetections];
  }

  /**
   * Returns array of all tracked basketballs (both visible and temporarily coasting).
   */
  getTrackedBasketballs() {
    return this.tracker.getActiveTracks();
  }

  /**
   * Returns the primary actionable basketball (nearest visible tracked basketball).
   * @returns {Object|null}
   */
  getSelectedBasketball() {
    return this.tracker.getSelectedTrack();
  }

  /**
   * Alias for getSelectedBasketball().
   * @returns {Object|null}
   */
  getPrimaryBasketballTarget() {
    return this.getSelectedBasketball();
  }

  /**
   * Returns latest basketball hoop observation.
   */
  getHoopObservation() {
    return { ...this.latestHoopObservation };
  }

  /**
   * Returns latest rendered camera frame ImageData or null if unavailable/offline.
   * @returns {ImageData|null}
   */
  getFrameImageData() {
    if (!this.isEnabled || !this.cameraSystem) {
      return null;
    }
    return typeof this.cameraSystem.getFrameImageData === 'function'
      ? this.cameraSystem.getFrameImageData()
      : (this.cameraSystem.imageData || null);
  }

  /**
   * Resets all tracking and perception memory.
   */
  reset() {
    this.tracker.reset();
    this.latestRawBallDetections = [];
    this.latestHoopObservation = this.hoopDetection.createEmptyObservation();
  }

  /**
   * Telemetry summary for engineering dashboard and autonomous systems.
   */
  getTelemetry() {
    const cam = this.cameraSystem.getTelemetry();
    const tracking = this.tracker.getTelemetry();
    const selected = this.getSelectedBasketball();
    const hoop = this.latestHoopObservation;

    return {
      enabled: this.isEnabled,
      camera: cam,
      balls: {
        count: this.isEnabled ? this.latestRawBallDetections.length : 0,
        tracked: this.isEnabled ? this.tracker.getActiveTracks() : [],
        primary: this.isEnabled ? selected : null
      },
      tracking: {
        totalTracks: tracking.totalTracks,
        visibleCount: tracking.visibleTracks,
        lostCount: tracking.lostTracks
      },
      selectedBall: selected ? {
        id: selected.id,
        distance: selected.distance,
        bearingDeg: selected.azimuthDeg,
        confidence: selected.confidence,
        screenX: selected.screenPosition.x,
        screenY: selected.screenPosition.y
      } : null,
      hoop: {
        visible: this.isEnabled ? hoop.visible : false,
        distance: this.isEnabled ? hoop.distance : null,
        bearingDeg: this.isEnabled ? hoop.azimuthDeg : null,
        elevationDeg: this.isEnabled ? hoop.elevationDeg : null,
        confidence: this.isEnabled ? hoop.confidence : 0,
        screenX: hoop.screenPosition?.x ?? null,
        screenY: hoop.screenPosition?.y ?? null,
        screenBoundingBox: hoop.screenBoundingBox ?? null,
        screen: hoop.screen ?? null
      },
      detections: {
        rawBallsCount: this.isEnabled ? this.latestRawBallDetections.length : 0,
        balls: this.isEnabled ? this.latestRawBallDetections.map(b => ({
          instanceId: b.instanceId,
          distance: b.distance,
          confidence: b.confidence,
          screenPosition: b.screenPosition,
          boundingBox: b.boundingBox
        })) : []
      }
    };
  }

  /**
   * Disposes all vision resources.
   */
  destroy() {
    this.cameraSystem.destroy();
    this.tracker.reset();
    this.scene = null;
    this.renderer = null;
    this.isInitialized = false;
  }
}
