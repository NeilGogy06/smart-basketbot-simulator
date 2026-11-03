/**
 * HoopDetection.js
 * Simulated perception subsystem for basketball hoop detection.
 * Identifies:
 * - Regulation rim target center and tempered glass backboard
 * - Projection into camera screen space and screen bounding box
 * - Relative 3D vector, distance, azimuth bearing, and elevation angle
 * - Backboard aspect angle (face-on vs edge-on aspect angle penalty)
 * - Raycast line-of-sight occlusion verification
 * - Sensor observation confidence scoring.
 */

import * as THREE from 'three';

export class HoopDetection {
  /**
   * @param {import('./CameraSystem.js').CameraSystem} cameraSystem
   * @param {Object} [options]
   * @param {number} [options.minConfidence=0.15] Minimum confidence for visibility declaration
   * @param {boolean} [options.enableOcclusion=true]
   */
  constructor(cameraSystem, options = {}) {
    this.cameraSystem = cameraSystem;
    this.minConfidence = options.minConfidence ?? 0.15;
    this.enableOcclusion = options.enableOcclusion ?? true;

    this.raycaster = new THREE.Raycaster();
    this.occluderObjects = [];
  }

  /**
   * Registers solid meshes that can occlude the hoop.
   * @param {Array<THREE.Object3D>} objects
   */
  setOccluders(objects = []) {
    this.occluderObjects = objects.filter(Boolean);
  }

  /**
   * Detects and evaluates hoop visibility relative to the robot's camera.
   * @param {Object} hoop BasketballHoop instance or hoop specification object
   * @returns {Object} Observation record
   */
  detect(hoop) {
    if (!this.cameraSystem || !this.cameraSystem.isActive || !hoop) {
      return this.createEmptyObservation();
    }

    // 1. Resolve 3D target coordinates for rim center
    let rimPos;
    let backboardNormal = new THREE.Vector3(-1, 0, 0); // East hoop faces -X (West)

    if (typeof hoop.rimX === 'number') {
      rimPos = { x: hoop.rimX, y: hoop.rimY, z: hoop.rimZ };
      // If hoop has side property (1 for East, -1 for West)
      if (hoop.side) {
        backboardNormal.set(-hoop.side, 0, 0);
      }
    } else if (hoop.position) {
      rimPos = { x: hoop.position.x, y: hoop.position.y, z: hoop.position.z };
    } else {
      // Default regulation East hoop coordinates
      rimPos = { x: 12.425, y: 3.05, z: 0.0 };
    }

    // 2. Project rim center to screen space
    const proj = this.cameraSystem.projectToScreen(rimPos);

    if (!proj.inView || proj.isBehind) {
      return {
        ...this.createEmptyObservation(),
        distance: Number(proj.distance.toFixed(3)),
        isBehind: proj.isBehind
      };
    }

    // 3. Occlusion check via Raycaster
    if (this.enableOcclusion && this.occluderObjects.length > 0) {
      if (this.isOccluded(rimPos, proj.distance, hoop)) {
        return {
          ...this.createEmptyObservation(),
          distance: Number(proj.distance.toFixed(3)),
          isOccluded: true
        };
      }
    }

    // 4. Relative position and angles in camera local frame
    const local = this.cameraSystem.worldToCameraLocal(rimPos);

    // 5. Backboard corners projection for bounding box calculation
    // Regulation backboard: 1.8m width (lateral Z), 1.05m height (vertical Y)
    const bw = hoop.config?.backboardWidth ?? 1.8;
    const bh = hoop.config?.backboardHeight ?? 1.05;
    const bbX = hoop.backboardX ?? (rimPos.x + 0.375);
    const bbY = (hoop.config?.backboardBottomHeight ?? 2.9) + bh / 2;

    const corners = [
      { x: bbX, y: bbY + bh / 2, z: rimPos.z - bw / 2 },
      { x: bbX, y: bbY + bh / 2, z: rimPos.z + bw / 2 },
      { x: bbX, y: bbY - bh / 2, z: rimPos.z - bw / 2 },
      { x: bbX, y: bbY - bh / 2, z: rimPos.z + bw / 2 },
      // Include rim front lip
      { x: rimPos.x - 0.225, y: rimPos.y, z: rimPos.z }
    ];

    let minX = proj.screenX;
    let maxX = proj.screenX;
    let minY = proj.screenY;
    let maxY = proj.screenY;

    for (let i = 0; i < corners.length; i++) {
      const cp = this.cameraSystem.projectToScreen(corners[i]);
      if (!cp.isBehind) {
        minX = Math.min(minX, cp.screenX);
        maxX = Math.max(maxX, cp.screenX);
        minY = Math.min(minY, cp.screenY);
        maxY = Math.max(maxY, cp.screenY);
      }
    }

    // Add margin for visual clarity
    const bbox = {
      x: Math.round(minX - 4),
      y: Math.round(minY - 4),
      width: Math.max(12, Math.round(maxX - minX + 8)),
      height: Math.max(10, Math.round(maxY - minY + 8))
    };

    // 6. Aspect angle: angle between camera line of sight and backboard normal
    // Vector from rim to camera
    const toCam = new THREE.Vector3().subVectors(this.cameraSystem.worldPosition, new THREE.Vector3(rimPos.x, rimPos.y, rimPos.z)).normalize();
    const aspectDot = Math.max(0, toCam.dot(backboardNormal));
    const aspectAngleDeg = (Math.acos(Math.min(1.0, aspectDot)) * 180) / Math.PI;

    // 7. Confidence estimation
    const confidence = this.computeConfidence(proj.distance, proj.ndcX, proj.ndcY, aspectDot);
    const isVisible = confidence >= this.minConfidence;

    return {
      type: 'HOOP',
      visible: isVisible,
      targetRimPosition: { x: rimPos.x, y: rimPos.y, z: rimPos.z },
      relativePosition: { x: local.x, y: local.y, z: local.z },
      distance: Number(proj.distance.toFixed(3)),
      azimuthDeg: Number(local.azimuthDeg.toFixed(2)),
      elevationDeg: Number(local.elevationDeg.toFixed(2)),
      aspectAngleDeg: Number(aspectAngleDeg.toFixed(1)),
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
   * Checks if line of sight to rim is blocked by obstacles.
   */
  isOccluded(targetPos, distance, hoop) {
    const camPos = this.cameraSystem.worldPosition;
    const dir = new THREE.Vector3(targetPos.x - camPos.x, targetPos.y - camPos.y, targetPos.z - camPos.z).normalize();

    this.raycaster.set(camPos, dir);
    this.raycaster.near = this.cameraSystem.near;
    this.raycaster.far = distance - 0.25;

    // Filter out hoop's own meshes from occluder list to avoid self-occlusion
    const validOccluders = hoop.group ? this.occluderObjects.filter(obj => obj !== hoop.group && !hoop.group.getObjectById(obj.id)) : this.occluderObjects;

    const hits = this.raycaster.intersectObjects(validOccluders, true);
    return hits.length > 0;
  }

  /**
   * Computes detection confidence based on distance, visual centrality, and aspect angle.
   */
  computeConfidence(distance, ndcX, ndcY, aspectDot) {
    const maxDist = this.cameraSystem.far;
    const distRatio = Math.min(1.0, distance / maxDist);
    const distFactor = Math.max(0.0, 1.0 - Math.pow(distRatio, 1.2));

    // Centering factor
    const radial = Math.hypot(ndcX, ndcY);
    const centerFactor = Math.max(0.35, 1.0 - (radial * 0.40));

    // Aspect factor (viewing face-on has higher confidence than severe grazing angle)
    const aspectFactor = Math.max(0.40, aspectDot);

    const raw = distFactor * centerFactor * aspectFactor;
    return Math.max(0.05, Math.min(0.99, raw));
  }

  /**
   * Default empty observation when hoop is outside view or occluded.
   */
  createEmptyObservation() {
    return {
      type: 'HOOP',
      visible: false,
      targetRimPosition: null,
      relativePosition: { x: 0, y: 0, z: 0 },
      distance: 0,
      azimuthDeg: 0,
      elevationDeg: 0,
      aspectAngleDeg: 0,
      screenPosition: { x: 0, y: 0 },
      screen: { x: 0, y: 0 },
      boundingBox: null,
      screenBoundingBox: null,
      confidence: 0.0,
      timestamp: Date.now()
    };
  }
}
