/**
 * Lighting.js
 * Sets up professional multi-point arena illumination, soft shadow maps,
 * high-altitude stadium floodlights, and ambient fill for the 3D court environment.
 */

import * as THREE from 'three';

export class Lighting {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.lights = [];

    this.setupArenaLighting();
  }

  setupArenaLighting() {
    // 1. Ambient Light - provides soft baseline visibility
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    ambientLight.name = 'AmbientLight';
    this.scene.add(ambientLight);
    this.lights.push(ambientLight);

    // 2. Main Overhead Key Spotlight / Floodlight (Center court angle)
    const keyLight = new THREE.DirectionalLight(0xfffaed, 1.4);
    keyLight.name = 'KeyLight';
    keyLight.position.set(-6, 22, 10);
    keyLight.castShadow = true;

    // High quality shadow configuration covering the entire court
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 5;
    keyLight.shadow.camera.far = 45;
    keyLight.shadow.camera.left = -20;
    keyLight.shadow.camera.right = 20;
    keyLight.shadow.camera.top = 16;
    keyLight.shadow.camera.bottom = -16;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.radius = 2.5; // Soft shadow edges

    this.scene.add(keyLight);
    this.lights.push(keyLight);

    // 3. Secondary Arena Floodlight (Opposing angle for balanced rim lighting)
    const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.7);
    fillLight.name = 'FillLight';
    fillLight.position.set(10, 20, -10);
    fillLight.castShadow = false;
    this.scene.add(fillLight);
    this.lights.push(fillLight);

    // 4. Baseline Target Spotlights (Accentuates the hoop and robot area)
    const eastHoopLight = new THREE.SpotLight(0xfff7ed, 1.2, 35, Math.PI / 4, 0.3, 1.0);
    eastHoopLight.position.set(12, 12, 6);
    eastHoopLight.target.position.set(12.5, 3.0, 0);
    this.scene.add(eastHoopLight);
    this.scene.add(eastHoopLight.target);
    this.lights.push(eastHoopLight);

    const westHoopLight = new THREE.SpotLight(0xfff7ed, 0.8, 35, Math.PI / 4, 0.3, 1.0);
    westHoopLight.position.set(-12, 12, -6);
    westHoopLight.target.position.set(-12.5, 3.0, 0);
    this.scene.add(westHoopLight);
    this.scene.add(westHoopLight.target);
    this.lights.push(westHoopLight);

    // 5. Hemisphere light for realistic sky/court bounce reflection
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.3);
    this.scene.add(hemiLight);
    this.lights.push(hemiLight);
  }
}
