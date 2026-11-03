/**
 * BasketballCourt.js
 * Generates a realistic FIBA-standard basketball court with procedural hardwood
 * parquet texture, painted keys, center circle emblem, accurate regulation lines,
 * and Rapier static ground physics colliders.
 */

import * as THREE from 'three';
import { SIMULATION_CONFIG } from '../simulation/SimulationConfig.js';

export class BasketballCourt {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../simulation/PhysicsWorld.js').PhysicsWorld} physicsWorld
   */
  constructor(scene, physicsWorld) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.config = SIMULATION_CONFIG.court;
    this.group = new THREE.Group();
    this.group.name = 'BasketballCourt';

    this.floorMesh = null;
    this.groundCollider = null;

    this.buildCourtVisuals();
    this.buildCourtPhysics();
  }

  /**
   * Generates procedural canvas texture with hardwood planks, boundary lines,
   * painted keys, center circle, and 3-point arcs.
   */
  createCourtTexture() {
    if (typeof document === 'undefined') {
      return null;
    }
    const canvas = document.createElement('canvas');
    // High resolution canvas matching court proportions (28m x 15m) + apron
    const totalLength = this.config.length + this.config.apron * 2; // 32m
    const totalWidth = this.config.width + this.config.apron * 2;   // 19m
    const scale = 80; // pixels per meter
    canvas.width = Math.round(totalLength * scale); // 2560 px
    canvas.height = Math.round(totalWidth * scale); // 1520 px

    const ctx = canvas.getContext('2d');

    // Coordinate conversion helpers: Court space (-L/2..L/2, -W/2..W/2) to Canvas px
    const toPxX = (x) => (x + totalLength / 2) * scale;
    const toPxZ = (z) => (z + totalWidth / 2) * scale;
    const toPxDist = (m) => m * scale;

    // 1. Draw outer apron (stadium floor border)
    ctx.fillStyle = '#0f172a'; // Deep sleek slate perimeter
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Draw court hardwood area
    const courtX0 = toPxX(-this.config.length / 2);
    const courtZ0 = toPxZ(-this.config.width / 2);
    const courtW = toPxDist(this.config.length);
    const courtH = toPxDist(this.config.width);

    // Hardwood plank base
    ctx.save();
    ctx.beginPath();
    ctx.rect(courtX0, courtZ0, courtW, courtH);
    ctx.clip();

    // Draw individual wood planks
    const plankWidthMeters = 0.15;
    const plankWidthPx = toPxDist(plankWidthMeters);
    const numPlanks = Math.ceil(this.config.width / plankWidthMeters);

    const woodTones = ['#e5b67a', '#dca969', '#e8be86', '#d39e5c', '#eac48f', '#dba464'];

    for (let i = 0; i < numPlanks; i++) {
      const pZ = courtZ0 + i * plankWidthPx;
      const toneIndex = (i * 7 + 3) % woodTones.length;
      ctx.fillStyle = woodTones[toneIndex];
      ctx.fillRect(courtX0, pZ, courtW, plankWidthPx);

      // Subtle plank divider line
      ctx.fillStyle = 'rgba(100, 70, 35, 0.2)';
      ctx.fillRect(courtX0, pZ + plankWidthPx - 1, courtW, 1);

      // Subtle vertical plank breaks
      for (let xBreak = courtX0 + (i % 5) * 80; xBreak < courtX0 + courtW; xBreak += 320) {
        ctx.fillStyle = 'rgba(90, 60, 25, 0.25)';
        ctx.fillRect(xBreak, pZ, 2, plankWidthPx);
      }
    }

    // 3. Painted key / paint area (Both sides)
    const keyLenPx = toPxDist(this.config.keyLength);
    const keyWidthPx = toPxDist(this.config.keyWidth);

    ctx.fillStyle = 'rgba(21, 55, 102, 0.85)'; // Classic team navy painted key

    // Left key (-X)
    ctx.fillRect(courtX0, toPxZ(-this.config.keyWidth / 2), keyLenPx, keyWidthPx);
    // Right key (+X)
    ctx.fillRect(courtX0 + courtW - keyLenPx, toPxZ(-this.config.keyWidth / 2), keyLenPx, keyWidthPx);

    // 4. Center court emblem / center circle
    const centerCirclePx = toPxDist(this.config.centerCircleRadius);
    ctx.fillStyle = 'rgba(21, 55, 102, 0.85)';
    ctx.beginPath();
    ctx.arc(toPxX(0), toPxZ(0), centerCirclePx, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore(); // Undo court clip

    // Line drawing setup
    ctx.lineWidth = toPxDist(0.05); // Regulation 5cm line width
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';

    // 5. Outer court boundary lines (white rectangle)
    ctx.strokeRect(courtX0, courtZ0, courtW, courtH);

    // 6. Half-court line
    ctx.beginPath();
    ctx.moveTo(toPxX(0), courtZ0);
    ctx.lineTo(toPxX(0), courtZ0 + courtH);
    ctx.stroke();

    // 7. Center circle outlines
    ctx.beginPath();
    ctx.arc(toPxX(0), toPxZ(0), centerCirclePx, 0, Math.PI * 2);
    ctx.stroke();

    // Center dot / emblem ring
    ctx.beginPath();
    ctx.arc(toPxX(0), toPxZ(0), toPxDist(0.4), 0, Math.PI * 2);
    ctx.stroke();

    // Center text / emblem
    ctx.fillStyle = '#f0883e';
    ctx.font = `bold ${Math.round(scale * 0.45)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SMART-BASKETBOT', toPxX(0), toPxZ(0));

    // 8. Draw markings on both halves of the court
    const halves = [-1, 1]; // -1 for Left half, 1 for Right half

    halves.forEach((side) => {
      const baselineX = side * (this.config.length / 2);
      const basketX = baselineX - side * this.config.basketCenterOverhang;
      const freeThrowX = baselineX - side * this.config.freeThrowDistance;
      const freeThrowRadius = toPxDist(1.8);

      // Key perimeter
      ctx.beginPath();
      ctx.rect(
        toPxX(Math.min(baselineX, freeThrowX)),
        toPxZ(-this.config.keyWidth / 2),
        Math.abs(toPxX(baselineX) - toPxX(freeThrowX)),
        toPxDist(this.config.keyWidth)
      );
      ctx.stroke();

      // Free throw circle (solid half outside key, dashed half inside key)
      const ftCenterPxX = toPxX(freeThrowX);
      const ftCenterPxZ = toPxZ(0);

      // Outer solid semi-circle (facing center court)
      ctx.beginPath();
      const startAngle = side === 1 ? Math.PI / 2 : -Math.PI / 2;
      const endAngle = side === 1 ? (3 * Math.PI) / 2 : Math.PI / 2;
      ctx.arc(ftCenterPxX, ftCenterPxZ, freeThrowRadius, startAngle, endAngle, false);
      ctx.stroke();

      // Inner dashed semi-circle (inside the key)
      ctx.save();
      ctx.setLineDash([toPxDist(0.2), toPxDist(0.15)]);
      ctx.beginPath();
      ctx.arc(ftCenterPxX, ftCenterPxZ, freeThrowRadius, endAngle, startAngle, false);
      ctx.stroke();
      ctx.restore();

      // Restricted area arc (1.25m radius from basket center)
      ctx.beginPath();
      ctx.arc(
        toPxX(basketX),
        toPxZ(0),
        toPxDist(1.25),
        side === 1 ? Math.PI / 2 : -Math.PI / 2,
        side === 1 ? (3 * Math.PI) / 2 : Math.PI / 2,
        false
      );
      ctx.stroke();

      // 9. Three-point line
      // FIBA 3-pt line consists of straight parallel segments 0.9m from sideline,
      // transitioning into a 6.75m radius arc centered at basket plumb point.
      const threePtR = this.config.threePointRadius;
      const sidelineY = this.config.width / 2 - this.config.threePointStraightDist; // 7.5 - 0.9 = 6.6m
      const arcIntersectDeltaX = Math.sqrt(Math.max(0, threePtR * threePtR - sidelineY * sidelineY));
      const arcTransitionX = basketX - side * arcIntersectDeltaX;

      ctx.beginPath();
      // Bottom straight corner 3
      ctx.moveTo(toPxX(baselineX), toPxZ(-sidelineY));
      ctx.lineTo(toPxX(arcTransitionX), toPxZ(-sidelineY));

      // Circular arc
      const arcStartAngle = Math.atan2(-sidelineY, -side * arcIntersectDeltaX);
      const arcEndAngle = Math.atan2(sidelineY, -side * arcIntersectDeltaX);

      if (side === 1) {
        ctx.arc(toPxX(basketX), toPxZ(0), toPxDist(threePtR), arcStartAngle, arcEndAngle, false);
      } else {
        ctx.arc(toPxX(basketX), toPxZ(0), toPxDist(threePtR), arcStartAngle, arcEndAngle, true);
      }

      // Top straight corner 3
      ctx.lineTo(toPxX(baselineX), toPxZ(sidelineY));
      ctx.stroke();

      // Key lane tick marks (rebound spots)
      const tickMarks = [1.75, 2.60, 3.45, 4.30];
      const tickLength = toPxDist(0.15);
      tickMarks.forEach((dist) => {
        const tickX = toPxX(baselineX - side * dist);
        const topY = toPxZ(this.config.keyWidth / 2);
        const botY = toPxZ(-this.config.keyWidth / 2);

        ctx.beginPath();
        ctx.moveTo(tickX, topY);
        ctx.lineTo(tickX, topY + tickLength);
        ctx.moveTo(tickX, botY);
        ctx.lineTo(tickX, botY - tickLength);
        ctx.stroke();
      });
    });

    // 10. Baseline apron text
    ctx.fillStyle = '#475569';
    ctx.font = `bold ${Math.round(scale * 0.7)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Left apron text
    ctx.save();
    ctx.translate(toPxX(-this.config.length / 2 - 1.0), toPxZ(0));
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('AUTONOMOUS ROBOTICS ARENA', 0, 0);
    ctx.restore();

    // Right apron text
    ctx.save();
    ctx.translate(toPxX(this.config.length / 2 + 1.0), toPxZ(0));
    ctx.rotate(Math.PI / 2);
    ctx.fillText('SMART-BASKETBOT SIMULATOR', 0, 0);
    ctx.restore();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 16;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;

    return texture;
  }

  /**
   * Constructs the 3D court mesh and surrounding stadium boundary.
   */
  buildCourtVisuals() {
    const totalLength = this.config.length + this.config.apron * 2;
    const totalWidth = this.config.width + this.config.apron * 2;
    const courtHeight = this.config.floorThickness;

    const courtTexture = this.createCourtTexture();

    // Main playing floor
    const geometry = new THREE.BoxGeometry(totalLength, courtHeight, totalWidth);

    // Apply materials: top face has court texture, sides and bottom have polished dark wood
    const edgeMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.6,
      metalness: 0.1
    });

    const topMaterial = new THREE.MeshStandardMaterial({
      map: courtTexture,
      roughness: 0.35, // Gives authentic polished basketball hardwood reflections
      metalness: 0.05
    });

    // Materials array for BoxGeometry: [+X, -X, +Y (top), -Y, +Z, -Z]
    const materials = [
      edgeMaterial,
      edgeMaterial,
      topMaterial,
      edgeMaterial,
      edgeMaterial,
      edgeMaterial
    ];

    this.floorMesh = new THREE.Mesh(geometry, materials);
    this.floorMesh.name = 'CourtFloor';
    // Center at Y = -courtHeight / 2 so the playing surface is exactly at Y = 0.0
    this.floorMesh.position.set(0, -courtHeight / 2, 0);
    this.floorMesh.receiveShadow = true;
    this.group.add(this.floorMesh);

    // Arena sub-floor / surrounding base foundation
    const foundationGeom = new THREE.BoxGeometry(totalLength + 6, 0.4, totalWidth + 6);
    const foundationMat = new THREE.MeshStandardMaterial({
      color: 0x090d13,
      roughness: 0.9,
      metalness: 0.2
    });
    const foundationMesh = new THREE.Mesh(foundationGeom, foundationMat);
    foundationMesh.name = 'CourtFoundation';
    foundationMesh.position.set(0, -courtHeight - 0.2, 0);
    foundationMesh.receiveShadow = true;
    this.group.add(foundationMesh);

    this.group.updateMatrixWorld(true);
    this.scene.add(this.group);
  }

  /**
   * Adds static physics colliders to the Rapier PhysicsWorld.
   */
  buildCourtPhysics() {
    const totalLength = this.config.length + this.config.apron * 2;
    const totalWidth = this.config.width + this.config.apron * 2;
    const courtHeight = this.config.floorThickness;

    // Floor collider: centered at Y = -courtHeight / 2, top is exactly Y = 0.0
    this.groundCollider = this.physicsWorld.createStaticBox(
      0,
      -courtHeight / 2,
      0,
      totalLength + 2.0,
      courtHeight,
      totalWidth + 2.0,
      0.78, // High restitution for realistic basketball bounce
      0.65  // High friction
    );

    // Perimeter safety wall colliders (invisible to camera, keeps ball within bounds during tests)
    const wallHeight = 4.0;
    const wallThickness = 0.5;
    const halfL = totalLength / 2 + wallThickness / 2;
    const halfW = totalWidth / 2 + wallThickness / 2;

    // Left & Right walls
    this.physicsWorld.createStaticBox(-halfL, wallHeight / 2, 0, wallThickness, wallHeight, totalWidth + 4, 0.6, 0.3);
    this.physicsWorld.createStaticBox(halfL, wallHeight / 2, 0, wallThickness, wallHeight, totalWidth + 4, 0.6, 0.3);

    // Back & Front walls
    this.physicsWorld.createStaticBox(0, wallHeight / 2, -halfW, totalLength + 4, wallHeight, wallThickness, 0.6, 0.3);
    this.physicsWorld.createStaticBox(0, wallHeight / 2, halfW, totalLength + 4, wallHeight, wallThickness, 0.6, 0.3);
  }
}
