/**
 * BasketballHoop.js
 * Builds a regulation FIBA basketball hoop assembly complete with:
 * - Heavy-duty hydraulic stanchion post and boom arm with safety padding
 * - Tempered glass backboard with regulation target square markings
 * - Regulation orange breakaway rim and tapered net mesh
 * - Rapier physics colliders for backboard, segmented rim perimeter, and base stanchion.
 */

import * as THREE from 'three';
import { SIMULATION_CONFIG } from '../simulation/SimulationConfig.js';

export class BasketballHoop {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../simulation/PhysicsWorld.js').PhysicsWorld} physicsWorld
   * @param {number} side 1 for +X baseline hoop, -1 for -X baseline hoop
   */
  constructor(scene, physicsWorld, side = 1) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.side = side;
    this.config = SIMULATION_CONFIG.hoop;
    this.courtConfig = SIMULATION_CONFIG.court;

    this.group = new THREE.Group();
    this.group.name = `BasketballHoop_${side > 0 ? 'East' : 'West'}`;

    // World coordinates of hoop components
    this.baselineX = side * (this.courtConfig.length / 2);
    // Backboard hangs 1.2m inside baseline
    this.backboardX = this.baselineX - side * this.config.backboardOffsetFromBaseline;
    this.rimX = this.baselineX - side * this.courtConfig.basketCenterOverhang;
    this.rimY = this.config.rimHeight;
    this.rimZ = 0;

    // Stanchion post sits behind baseline
    this.stanchionX = this.baselineX + side * this.config.supportPostDistance;

    this.buildVisuals();
    this.buildPhysics();

    this.scene.add(this.group);
  }

  /**
   * Builds the 3D meshes for stanchion, backboard, rim, and net.
   */
  buildVisuals() {
    // Materials
    const stanchionMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a5f, // Industrial arena navy
      roughness: 0.4,
      metalness: 0.5
    });

    const paddingMat = new THREE.MeshStandardMaterial({
      color: 0x0f233d, // Dark protective foam
      roughness: 0.8,
      metalness: 0.1
    });

    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xfa541c, // Vibrant basketball orange
      roughness: 0.25,
      metalness: 0.4
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.65,
      roughness: 0.1,
      metalness: 0.1,
      transmission: 0.85,
      thickness: 0.05
    });

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8, // Aluminum frame border
      roughness: 0.3,
      metalness: 0.7
    });

    // 1. Stanchion Base (Weighted arena floor anchor)
    const baseW = 1.4;
    const baseH = 0.9;
    const baseL = 1.8;
    const baseGeom = new THREE.BoxGeometry(baseL, baseH, baseW);
    const baseMesh = new THREE.Mesh(baseGeom, paddingMat);
    baseMesh.position.set(this.stanchionX + this.side * (baseL / 2 - 0.2), baseH / 2, 0);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    this.group.add(baseMesh);

    // 2. Angled Main Boom Arm
    // Extends from base top towards the backboard
    const armGeom = new THREE.BoxGeometry(0.25, 0.25, 3.4);
    const armMesh = new THREE.Mesh(armGeom, stanchionMat);
    armMesh.castShadow = true;

    // Position and angle the boom arm
    const armMidX = (baseMesh.position.x + this.backboardX) / 2;
    const armMidY = (baseH + this.config.backboardBottomHeight + this.config.backboardHeight / 2) / 2;
    armMesh.position.set(armMidX, armMidY, 0);

    const angleZ = Math.atan2(
      (this.config.backboardBottomHeight + 0.4) - baseH,
      (this.backboardX - baseMesh.position.x)
    );
    armMesh.rotation.y = Math.PI / 2;
    armMesh.rotation.x = angleZ;
    this.group.add(armMesh);

    // Vertical column support
    const postGeom = new THREE.CylinderGeometry(0.12, 0.14, 2.8, 16);
    const postMesh = new THREE.Mesh(postGeom, stanchionMat);
    postMesh.position.set(this.stanchionX, 1.4, 0);
    postMesh.castShadow = true;
    this.group.add(postMesh);

    // 3. Backboard Frame and Glass Plate
    const bw = this.config.backboardWidth;
    const bh = this.config.backboardHeight;
    const bt = this.config.backboardThickness;
    const backboardCenterY = this.config.backboardBottomHeight + bh / 2;

    const backboardGeom = new THREE.BoxGeometry(bt, bh, bw);
    const backboardMesh = new THREE.Mesh(backboardGeom, glassMat);
    backboardMesh.position.set(this.backboardX, backboardCenterY, 0);
    backboardMesh.castShadow = true;
    this.group.add(backboardMesh);

    // Aluminum perimeter trim around backboard
    const frameBorder = new THREE.BoxGeometry(bt * 1.5, bh + 0.04, bw + 0.04);
    const frameEdges = new THREE.EdgesGeometry(frameBorder);
    const frameLine = new THREE.LineSegments(frameEdges, new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 }));
    frameLine.position.copy(backboardMesh.position);
    this.group.add(frameLine);

    // Target rectangle painted on backboard (0.59m x 0.45m)
    // Placed directly above rim
    const targetW = this.config.targetBoxWidth;
    const targetH = this.config.targetBoxHeight;
    const targetY = this.rimY + targetH / 2;
    const targetGeom = new THREE.PlaneGeometry(targetW, targetH);
    const targetEdges = new THREE.EdgesGeometry(targetGeom);
    const targetLine = new THREE.LineSegments(targetEdges, new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 3 }));
    targetLine.position.set(this.backboardX - this.side * (bt / 2 + 0.005), targetY, 0);
    targetLine.rotation.y = this.side > 0 ? -Math.PI / 2 : Math.PI / 2;
    this.group.add(targetLine);

    // 4. Rim Mount Bracket / Spring Box
    const bracketGeom = new THREE.BoxGeometry(0.18, 0.12, 0.16);
    const bracketMesh = new THREE.Mesh(bracketGeom, rimMat);
    bracketMesh.position.set(
      this.backboardX - this.side * (0.18 / 2 + bt / 2),
      this.rimY - 0.02,
      0
    );
    bracketMesh.castShadow = true;
    this.group.add(bracketMesh);

    // 5. Basketball Rim (Torus ring)
    const rimGeom = new THREE.TorusGeometry(
      this.config.rimRadius,
      this.config.rimTubeRadius,
      12,
      32
    );
    const rimMesh = new THREE.Mesh(rimGeom, rimMat);
    rimMesh.position.set(this.rimX, this.rimY, 0);
    rimMesh.rotation.x = Math.PI / 2;
    rimMesh.castShadow = true;
    this.group.add(rimMesh);

    // 6. Net Mesh
    this.buildNetVisuals(this.rimX, this.rimY, 0);
  }

  /**
   * Constructs net geometry hanging down from the rim.
   */
  buildNetVisuals(rimX, rimY, rimZ) {
    const netHeight = 0.42;
    const topRadius = this.config.rimRadius - 0.01;
    const bottomRadius = this.config.rimRadius * 0.55;

    // Create a procedural tapered net lattice using open cylinder
    const netGeom = new THREE.CylinderGeometry(
      topRadius,
      bottomRadius,
      netHeight,
      16,
      8,
      true
    );

    // Wireframe representation gives authentic cord mesh look
    const netWireframe = new THREE.WireframeGeometry(netGeom);
    const netLine = new THREE.LineSegments(
      netWireframe,
      new THREE.LineBasicMaterial({
        color: 0xf1f5f9,
        transparent: true,
        opacity: 0.75
      })
    );
    netLine.position.set(rimX, rimY - netHeight / 2, rimZ);
    this.group.add(netLine);
  }

  /**
   * Registers Rapier static physics colliders for backboard, rim perimeter segments,
   * and stanchion base.
   */
  buildPhysics() {
    const bh = this.config.backboardHeight;
    const bw = this.config.backboardWidth;
    const bt = this.config.backboardThickness;
    const backboardCenterY = this.config.backboardBottomHeight + bh / 2;

    // 1. Backboard Solid Collider
    // Restitution: 0.72 for realistic basketball rebound
    const { body: backboardBody, collider: backboardCollider } = this.physicsWorld.createStaticBox(
      this.backboardX,
      backboardCenterY,
      0,
      bt,
      bh,
      bw,
      0.72,
      0.5
    );
    this.backboardBody = backboardBody;
    this.backboardCollider = backboardCollider;

    // 2. Segmented Rim Colliders (Compound Collider on a single fixed rigid body)
    // Approximates circular rim with 16 tangentially rotated box segments around circumference.
    // Each segment is oriented tangentially so its inner face aligns with the true inner rim perimeter,
    // preserving an unobstructed opening diameter of 2 * (R - rimTubeRadius) = 0.426m (matching 0.45m rim),
    // cleanly clearing the 0.24m basketball with a ~9.3cm clearance margin on all sides.
    const numSegments = 16;
    const R = this.config.rimRadius; // 0.225m
    const tubeRadius = this.config.rimTubeRadius; // 0.012m
    const hx = tubeRadius; // radial half-thickness = 0.012m
    const hy = tubeRadius; // vertical half-height = 0.012m
    const dTheta = (2 * Math.PI) / numSegments;
    const hz = R * Math.sin(dTheta / 2) * 1.05; // tangential half-length = ~0.046m

    const rimColliderConfigs = [];
    for (let i = 0; i < numSegments; i++) {
      const angle = i * dTheta;
      const tx = Math.cos(angle) * R;
      const tz = Math.sin(angle) * R;
      const halfAngle = -angle / 2;
      const rot = {
        x: 0,
        y: Math.sin(halfAngle),
        z: 0,
        w: Math.cos(halfAngle)
      };

      rimColliderConfigs.push({
        type: 'cuboid',
        hx,
        hy,
        hz,
        translation: { x: tx, y: 0, z: tz },
        rotation: rot,
        restitution: 0.68, // Metallic rim bounce
        friction: 0.4
      });
    }

    const { body: rimBody, colliders: rimColliders } = this.physicsWorld.createStaticCompound(
      this.rimX,
      this.rimY,
      this.rimZ,
      rimColliderConfigs
    );
    this.rimBody = rimBody;
    this.rimColliders = rimColliders;

    // 3. Stanchion Base Collider
    const { body: stanchionBody, collider: stanchionCollider } = this.physicsWorld.createStaticBox(
      this.stanchionX + this.side * 0.7,
      0.45,
      0,
      1.8,
      0.9,
      1.4,
      0.3,
      0.7
    );
    this.stanchionBody = stanchionBody;
    this.stanchionCollider = stanchionCollider;
  }

  /**
   * Returns world position coordinates of hoop rim center.
   * @returns {{ x: number, y: number, z: number }}
   */
  getRimPosition() {
    return { x: this.rimX, y: this.rimY, z: this.rimZ };
  }
}
