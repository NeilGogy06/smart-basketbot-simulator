/**
 * CameraSystem.js
 * Simulated robot-mounted vision sensor system.
 * Manages:
 * - Three.js PerspectiveCamera mounted on the robot sensor mast
 * - Dynamic 6-DOF transform updates following robot translation and yaw heading
 * - Configurable field of view (vertical & horizontal), aspect ratio, and range
 * - Offscreen WebGLRenderTarget for capturing the robot's visual perspective
 * - Frustum calculation for geometric visibility checks
 * - Telemetry reporting and clean resource lifecycle disposal.
 */

import * as THREE from 'three';

export class CameraSystem {
  /**
   * @param {Object} [options]
   * @param {number} [options.fov=70] Vertical field of view in degrees
   * @param {number} [options.aspect=4/3] Aspect ratio (width / height)
   * @param {number} [options.near=0.1] Near clipping plane (meters)
   * @param {number} [options.far=18.0] Far clipping plane / max detection distance (meters)
   * @param {number} [options.width=320] Camera sensor pixel width
   * @param {number} [options.height=240] Camera sensor pixel height
   * @param {{ x: number, y: number, z: number }} [options.mountOffset] Camera position relative to robot origin
   * @param {number} [options.pitchDeg=-4.0] Fixed camera pitch tilt (negative = tilted slightly downward)
   */
  constructor(options = {}) {
    this.fov = options.fov ?? 70.0;
    this.aspect = options.aspect ?? (4 / 3);
    this.near = options.near ?? 0.1;
    this.far = options.far ?? 18.0;

    this.width = options.width ?? 320;
    this.height = options.height ?? 240;

    // Physical mount offset on robot (front sensor mast)
    this.mountOffset = options.mountOffset ?? { x: 0.14, y: 0.35, z: 0.0 };
    this.pitchDeg = options.pitchDeg ?? -4.0;

    // Three.js Camera instance
    this.camera = new THREE.PerspectiveCamera(this.fov, this.aspect, this.near, this.far);
    this.camera.name = 'RobotVisionCamera';

    // Frustum for geometric visibility & culling
    this.frustum = new THREE.Frustum();
    this.projScreenMatrix = new THREE.Matrix4();

    // World pose registers
    this.worldPosition = new THREE.Vector3();
    this.forwardVector = new THREE.Vector3(1, 0, 0);
    this.headingRad = 0.0;

    // WebGL Render Target for offscreen video capture
    this.renderTarget = null;
    this.pixelBuffer = null;
    this.imageData = null;

    // Performance capture throttling (target ~20 FPS capture for UI display)
    this.captureInterval = 1 / 20; // seconds
    this.captureTimer = 0.0;
    this.hasNewFrame = false;

    // Operational state
    this.isActive = true;

    this.initRenderTarget();
  }

  /**
   * Initializes or recreates the offscreen WebGLRenderTarget and pixel buffer.
   */
  initRenderTarget() {
    this.disposeRenderTarget();

    // Check if running in browser with WebGL capability
    if (typeof document !== 'undefined') {
      try {
        this.renderTarget = new THREE.WebGLRenderTarget(this.width, this.height, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          type: THREE.UnsignedByteType,
          depthBuffer: true,
          stencilBuffer: false
        });

        this.pixelBuffer = new Uint8Array(this.width * this.height * 4);
        this.imageData = new ImageData(this.width, this.height);
      } catch (err) {
        // Headless test environment
        this.renderTarget = null;
        this.pixelBuffer = null;
        this.imageData = null;
      }
    }
  }

  /**
   * Updates camera world position, orientation, and view frustum from robot pose.
   * @param {Object} robot Reference to Robot instance
   */
  update(robot) {
    if (!robot) return;

    const robotPos = typeof robot.getPosition === 'function' ? robot.getPosition() : (robot.position || { x: 0, y: 0, z: 0 });
    const heading = typeof robot.getHeading === 'function' ? robot.getHeading() : (robot.heading || 0);

    this.headingRad = heading;

    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);

    // 1. Calculate camera mount position in world coordinates
    // Forward along local X, lateral along local Z
    const camWorldX = robotPos.x + cosH * this.mountOffset.x + sinH * this.mountOffset.z;
    const camWorldY = robotPos.y + this.mountOffset.y;
    const camWorldZ = robotPos.z - sinH * this.mountOffset.x + cosH * this.mountOffset.z;

    this.worldPosition.set(camWorldX, camWorldY, camWorldZ);
    this.camera.position.copy(this.worldPosition);

    // 2. Calculate forward viewing target direction
    const pitchRad = (this.pitchDeg * Math.PI) / 180;
    const cosP = Math.cos(pitchRad);
    const sinP = Math.sin(pitchRad);

    // Forward vector in simulator world frame (cos(H)*cos(P), sin(P), -sin(H)*cos(P))
    const lookDirX = cosH * cosP;
    const lookDirY = sinP;
    const lookDirZ = -sinH * cosP;

    this.forwardVector.set(lookDirX, lookDirY, lookDirZ).normalize();

    const targetLookAt = new THREE.Vector3(
      camWorldX + lookDirX * 10.0,
      camWorldY + lookDirY * 10.0,
      camWorldZ + lookDirZ * 10.0
    );

    this.camera.lookAt(targetLookAt);
    this.camera.updateMatrixWorld(true);

    // 3. Update view frustum
    this.projScreenMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
  }

  /**
   * Alias for update(robot).
   * @param {Object} robot
   */
  updatePose(robot) {
    return this.update(robot);
  }

  /**
   * Returns current world position of the camera.
   * @returns {{ x: number, y: number, z: number }}
   */
  getCameraPosition() {
    return {
      x: this.worldPosition.x,
      y: this.worldPosition.y,
      z: this.worldPosition.z
    };
  }

  /**
   * Returns clone of camera optical forward vector in world coordinates.
   * @returns {THREE.Vector3}
   */
  getForwardVector() {
    return this.forwardVector.clone();
  }

  /**
   * Alias for setMaxDetectionDistance.
   * @param {number} maxDist
   */
  setMaxDistance(maxDist) {
    this.setMaxDetectionDistance(maxDist);
  }

  /**
   * Renders the 3D scene from the robot camera perspective into the offscreen buffer.
   * Throttled to ~20 FPS for optimal performance.
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {number} dt Frame delta time
   */
  renderFeed(renderer, scene, dt = 0.016) {
    if (!this.isActive || !renderer || !scene || !this.renderTarget) return;

    this.captureTimer += dt;
    if (this.captureTimer < this.captureInterval) {
      return;
    }
    this.captureTimer = 0.0;

    const currentRenderTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.renderTarget);
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(currentRenderTarget);

    // Read pixels for canvas overlay rendering
    if (this.pixelBuffer && this.imageData) {
      renderer.readRenderTargetPixels(
        this.renderTarget,
        0,
        0,
        this.width,
        this.height,
        this.pixelBuffer
      );

      // WebGL reads pixels upside down (origin at bottom-left); flip vertically into ImageData
      const data = this.imageData.data;
      const w = this.width;
      const h = this.height;
      const rowBytes = w * 4;

      for (let y = 0; y < h; y++) {
        const srcRow = (h - 1 - y) * rowBytes;
        const dstRow = y * rowBytes;
        data.set(this.pixelBuffer.subarray(srcRow, srcRow + rowBytes), dstRow);
      }

      this.hasNewFrame = true;
    }
  }

  /**
   * Sets vertical field of view and updates projection matrix.
   * @param {number} fovDeg Field of view in degrees (e.g. 45° to 90°)
   */
  setFOV(fovDeg) {
    this.fov = Math.max(30, Math.min(110, fovDeg));
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Returns calculated horizontal field of view in degrees.
   */
  getHorizontalFOV() {
    const vFovRad = (this.fov * Math.PI) / 180;
    const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * this.aspect);
    return (hFovRad * 180) / Math.PI;
  }

  /**
   * Sets maximum detection distance (far plane).
   * @param {number} distanceMeters
   */
  setMaxDetectionDistance(distanceMeters) {
    this.far = Math.max(3.0, Math.min(40.0, distanceMeters));
    this.camera.far = this.far;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Configures camera capture resolution.
   * @param {number} width
   * @param {number} height
   */
  setResolution(width, height) {
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    this.aspect = width / height;
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    this.initRenderTarget();
  }

  /**
   * Sets pitch tilt angle in degrees.
   * @param {number} pitchDeg
   */
  setPitch(pitchDeg) {
    this.pitchDeg = Math.max(-30, Math.min(30, pitchDeg));
  }

  /**
   * Enables or disables vision camera.
   * @param {boolean} active
   */
  setActive(active) {
    this.isActive = Boolean(active);
  }

  /**
   * Projects a 3D world coordinate into camera screen space [0..width, 0..height].
   * @param {{ x: number, y: number, z: number }} worldPos
   * @returns {{
   *   inView: boolean,
   *   isBehind: boolean,
   *   distance: number,
   *   screenX: number,
   *   screenY: number,
   *   ndcX: number,
   *   ndcY: number,
   *   ndcZ: number
   * }}
   */
  projectToScreen(worldPos) {
    const v = new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z);
    const dist = v.distanceTo(this.worldPosition);

    // Vector from camera to target point
    const toTarget = new THREE.Vector3().subVectors(v, this.worldPosition);

    // Check if behind camera plane (dot product with forward vector <= 0)
    const isBehind = toTarget.dot(this.forwardVector) <= 0.05;

    // Project point into Normalized Device Coordinates [-1, 1]
    v.project(this.camera);

    const inNdc = (
      v.x >= -1.0 && v.x <= 1.0 &&
      v.y >= -1.0 && v.y <= 1.0 &&
      v.z >= -1.0 && v.z <= 1.0
    );

    const inDistance = dist <= this.far && dist >= this.near;
    const inView = !isBehind && inNdc && inDistance;

    // Map NDC [-1, 1] to screen pixel coordinates [0, width] and [0, height]
    const screenX = (v.x * 0.5 + 0.5) * this.width;
    const screenY = (-v.y * 0.5 + 0.5) * this.height;

    return {
      inView,
      isBehind,
      distance: dist,
      screenX,
      screenY,
      ndcX: v.x,
      ndcY: v.y,
      ndcZ: v.z
    };
  }

  /**
   * Transforms a 3D world position into the camera's local coordinate frame.
   * In Three.js camera space: +X is right, +Y is up, -Z is forward.
   * @param {{ x: number, y: number, z: number }} worldPos
   * @returns {{ x: number, y: number, z: number, distance: number, azimuthDeg: number, elevationDeg: number }}
   */
  worldToCameraLocal(worldPos) {
    const v = new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z);
    v.applyMatrix4(this.camera.matrixWorldInverse);

    const dist = Math.hypot(v.x, v.y, v.z);
    // Azimuth: angle in horizontal plane relative to optical axis (-Z)
    // Positive azimuth is to the right (+X)
    const azimuthRad = Math.atan2(v.x, -v.z);
    // Elevation: angle above horizontal optical axis (+Y)
    const elevationRad = Math.atan2(v.y, Math.hypot(v.x, v.z));

    return {
      x: v.x,
      y: v.y,
      z: v.z,
      distance: dist,
      azimuthDeg: (azimuthRad * 180) / Math.PI,
      elevationDeg: (elevationRad * 180) / Math.PI
    };
  }

  /**
   * Returns latest rendered camera frame ImageData or null if unavailable.
   * @returns {ImageData|null}
   */
  getFrameImageData() {
    if (!this.isActive || !this.imageData) {
      return null;
    }
    return this.imageData;
  }

  /**
   * Camera telemetry summary.
   */
  getTelemetry() {
    return {
      active: this.isActive,
      fov: this.fov,
      horizontalFov: this.getHorizontalFOV(),
      aspect: this.aspect,
      near: this.near,
      maxDistance: this.far,
      resolution: { width: this.width, height: this.height },
      pitchDeg: this.pitchDeg,
      headingDeg: (this.headingRad * 180) / Math.PI,
      position: {
        x: this.worldPosition.x,
        y: this.worldPosition.y,
        z: this.worldPosition.z
      }
    };
  }

  /**
   * Disposes WebGL render target resources.
   */
  disposeRenderTarget() {
    if (this.renderTarget) {
      this.renderTarget.dispose();
      this.renderTarget = null;
    }
  }

  /**
   * Clean destruction of all allocated buffers and targets.
   */
  destroy() {
    this.isActive = false;
    this.disposeRenderTarget();
    this.pixelBuffer = null;
    this.imageData = null;
  }
}
