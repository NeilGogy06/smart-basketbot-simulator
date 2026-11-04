/**
 * BallDetection.js
 * Simulated perception subsystem for basketball detection.
 * Performs:
 * - Identification of basketball objects in the 3D scene
 * - Projection into camera screen space and pixel bounding box estimation
 * - Relative distance, azimuth, and elevation bearing calculation
 * - Field-of-view and range threshold gating
 * - Scene raycasting for line-of-sight occlusion verification
 * - Sensor observation confidence scoring based on optical geometry.
 */

import * as THREE from 'three';

export class BallDetection {
  /**
   * @param {import('./CameraSystem.js').CameraSystem} cameraSystem
   * @param {Object} [options]
   * @param {number} [options.ballRadius=0.12] Basketball physical radius (meters)
   * @param {number} [options.minConfidence=0.20] Minimum confidence threshold for valid detection
   * @param {boolean} [options.enableOcclusion=true] Whether to run raycast occlusion checking
   */
  constructor(cameraSystem, options = {}) {
    this.cameraSystem = cameraSystem;
    this.ballRadius = options.ballRadius ?? 0.12;
    this.minConfidence = options.minConfidence ?? 0.20;
    this.enableOcclusion = options.enableOcclusion ?? true;

    // Reusable raycaster for occlusion checks
    this.raycaster = new THREE.Raycaster();
    this.occluderObjects = [];
  }

  /**
   * Registers solid Three.js meshes that can occlude the ball (backboard, stanchion, obstacles).
   * @param {Array<THREE.Object3D>} objects
   */
  setOccluders(objects = []) {
    this.occluderObjects = objects.filter(Boolean);
  }

  /**
   * Evaluates all candidate basketballs against the camera frustum and optical model.
   * @param {Array<Object> | Object} basketballs Single basketball or array of basketballs
   * @returns {Array<Object>} List of valid visible detections
   */
  detect(basketballs) {
    if (!this.cameraSystem || !this.cameraSystem.isActive) {
      return [];
    }

    if (!basketballs) return [];

    const ballList = Array.isArray(basketballs) ? basketballs : [basketballs];
    const detections = [];

    for (let i = 0; i < ballList.length; i++) {
      const ball = ballList[i];
      if (!ball) continue;

      const detection = this.evaluateSingleBall(ball, i);
      if (detection && detection.confidence >= this.minConfidence) {
        detections.push(detection);
      }
    }

    // Sort detections by proximity (nearest ball first)
    detections.sort((a, b) => a.distance - b.distance);
    return detections;
  }

  /**
   * Evaluates visibility, projection, and optical confidence for a single basketball.
   * @param {Object} ball Basketball entity
   * @param {number} index Index of ball in array
   * @returns {Object|null} Detection record or null if not visible
   */
  evaluateSingleBall(ball, index = 0) {
    // 1. Query current 3D world position
    const worldPos = typeof ball.getPosition === 'function' ? ball.getPosition() : (ball.position || null);
    if (!worldPos) return null;

    // 2. Screen space projection and FOV check
    const proj = this.cameraSystem.projectToScreen(worldPos);

    // Filter: must be in front of camera, inside distance limit, and inside frustum/screen bounds
    if (!proj.inView || proj.isBehind) {
      return null;
    }

    // 3. Occlusion check via Raycaster
    if (this.enableOcclusion && this.occluderObjects.length > 0) {
      if (this.isOccluded(worldPos, proj.distance)) {
        return null;
      }
    }

    // 4. Calculate relative position in camera local coordinates
    const local = this.cameraSystem.worldToCameraLocal(worldPos);

    // 5. Estimate screen bounding box size
    // Project apparent angular diameter of the sphere to image pixels
    const vFovRad = (this.cameraSystem.fov * Math.PI) / 180;
    const apparentDiameterPx = (2 * this.ballRadius * this.cameraSystem.height) / (2 * proj.distance * Math.tan(vFovRad / 2));
    const bboxSize = Math.max(4, Math.round(apparentDiameterPx));

    const bbox = {
      x: Math.round(proj.screenX - bboxSize / 2),
      y: Math.round(proj.screenY - bboxSize / 2),
      width: bboxSize,
      height: bboxSize
    };

    // 6. Compute realistic observation confidence
    const confidence = this.computeConfidence(proj.distance, proj.ndcX, proj.ndcY, bboxSize);

    // Stable instance tag for identification
    const instanceId = ball.id || (ball.mesh && ball.mesh.uuid ? `ball_${ball.mesh.uuid.slice(0, 6)}` : `ball_${index}`);

    return {
      type: 'BASKETBALL',
      instanceId,
      reference: ball,
      worldPosition: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
      relativePosition: { x: local.x, y: local.y, z: local.z },
      distance: Number(proj.distance.toFixed(3)),
      azimuthDeg: Number(local.azimuthDeg.toFixed(2)),
      elevationDeg: Number(local.elevationDeg.toFixed(2)),
      screenPosition: {
        x: Math.round(proj.screenX),
        y: Math.round(proj.screenY)
      },
      screen: {
        x: Math.round(proj.screenX),
        y: Math.round(proj.screenY)
      },
      boundingBox: bbox,
      screenBoundingBox: bbox,
      confidence: Number(confidence.toFixed(2)),
      timestamp: Date.now()
    };
  }

  /**
   * Raycasts from camera origin to ball center to check for physical line-of-sight obstruction.
   * @param {{ x: number, y: number, z: number }} targetPos
   * @param {number} distance
   * @returns {boolean} Whether line of sight is blocked
   */
  isOccluded(targetPos, distance) {
    const camPos = this.cameraSystem.worldPosition;
    const dir = new THREE.Vector3(targetPos.x - camPos.x, targetPos.y - camPos.y, targetPos.z - camPos.z).normalize();

    this.raycaster.set(camPos, dir);
    this.raycaster.near = this.cameraSystem.near;
    this.raycaster.far = distance - this.ballRadius * 0.5;

    const hits = this.raycaster.intersectObjects(this.occluderObjects, true);

    // If an obstacle is closer than the basketball, ball is occluded
    for (let i = 0; i < hits.length; i++) {
      if (hits[i].distance < (distance - this.ballRadius * 0.9)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Computes optical confidence score in [0.0..1.0] based on physical observation conditions:
   * 1. Distance attenuation: confidence drops as distance approaches far plane
   * 2. FOV radial distortion: objects in the optical center have higher SNR than edges
   * 3. Pixel resolution footprint: objects occupying more sensor pixels have higher confidence
   */
  computeConfidence(distance, ndcX, ndcY, bboxSize) {
    const maxDist = this.cameraSystem.far;

    // Distance quality factor: non-linear dropoff with distance
    const distRatio = Math.min(1.0, distance / maxDist);
    const distFactor = Math.max(0.0, 1.0 - Math.pow(distRatio, 1.4));

    // Centering factor: distance from center in NDC [0, sqrt(2)]
    const radialDist = Math.hypot(ndcX, ndcY);
    const centerFactor = Math.max(0.4, 1.0 - (radialDist * 0.45));

    // Resolution factor: smooth scaling based on apparent pixel footprint
    // Prevents an abrupt 50% drop at 5.5m in an 18m camera range
    let sizeFactor = 1.0;
    if (bboxSize < 3) {
      sizeFactor = 0.45;
    } else if (bboxSize < 6) {
      sizeFactor = 0.72;
    } else if (bboxSize < 10) {
      sizeFactor = 0.88;
    }

    const rawConfidence = distFactor * centerFactor * sizeFactor;
    return Math.max(0.05, Math.min(0.98, rawConfidence));
  }
}
