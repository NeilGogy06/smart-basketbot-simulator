/**
 * PathVisualizer.js
 * Renders the calculated A* navigation path and waypoint markers directly
 * on the 3D basketball court surface using Three.js line and ring meshes.
 */

import * as THREE from 'three';

export class PathVisualizer {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'NavigationPathVisualizer';

    this.pathLine = null;
    this.waypointMarkers = [];
    this.destinationMarker = null;

    this.lineMaterial = new THREE.LineBasicMaterial({
      color: 0x38bdf8, // Vibrant cyan
      linewidth: 3,
      transparent: true,
      opacity: 0.85
    });

    this.markerMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide
    });

    this.destMaterial = new THREE.MeshBasicMaterial({
      color: 0xf97316, // Orange target marker
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide
    });

    this.scene.add(this.group);
  }

  /**
   * Updates visual path geometry from world waypoints.
   * @param {Array<{ x: number, z: number }>} waypoints
   * @param {{ x: number, z: number }} [currentRobotPose]
   */
  updatePath(waypoints, currentRobotPose = null) {
    this.clear();

    if (!waypoints || waypoints.length < 2) return;

    const points = [];
    if (currentRobotPose) {
      points.push(new THREE.Vector3(currentRobotPose.x, 0.03, currentRobotPose.z));
    }

    waypoints.forEach((wp) => {
      points.push(new THREE.Vector3(wp.x, 0.03, wp.z));
    });

    // 1. Path Line
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.pathLine = new THREE.Line(geometry, this.lineMaterial);
    this.group.add(this.pathLine);

    // 2. Intermediate Waypoint Markers (small rings on floor)
    const ringGeom = new THREE.RingGeometry(0.08, 0.12, 16);
    for (let i = 0; i < waypoints.length - 1; i++) {
      const wp = waypoints[i];
      const marker = new THREE.Mesh(ringGeom, this.markerMaterial);
      marker.position.set(wp.x, 0.032, wp.z);
      marker.rotation.x = Math.PI / 2;
      this.group.add(marker);
      this.waypointMarkers.push(marker);
    }

    // 3. Destination Target Marker (dual concentric rings at goal)
    const finalWP = waypoints[waypoints.length - 1];
    const destGroup = new THREE.Group();
    destGroup.position.set(finalWP.x, 0.035, finalWP.z);
    destGroup.rotation.x = Math.PI / 2;

    const outerRing = new THREE.Mesh(new THREE.RingGeometry(0.20, 0.25, 24), this.destMaterial);
    const innerDot = new THREE.Mesh(new THREE.CircleGeometry(0.08, 16), this.destMaterial);
    destGroup.add(outerRing, innerDot);

    this.group.add(destGroup);
    this.destinationMarker = destGroup;
  }

  /**
   * Clears path lines and markers from the scene.
   */
  clear() {
    if (this.pathLine) {
      this.group.remove(this.pathLine);
      this.pathLine.geometry.dispose();
      this.pathLine = null;
    }

    this.waypointMarkers.forEach((m) => {
      this.group.remove(m);
      m.geometry.dispose();
    });
    this.waypointMarkers = [];

    if (this.destinationMarker) {
      this.group.remove(this.destinationMarker);
      this.destinationMarker = null;
    }
  }

  /**
   * Destroys visualizer resources.
   */
  destroy() {
    this.clear();
    this.lineMaterial.dispose();
    this.markerMaterial.dispose();
    this.destMaterial.dispose();
    if (this.group.parentNode) {
      this.group.parentNode.remove(this.group);
    }
  }
}
