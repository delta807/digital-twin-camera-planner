/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { BaseBuilder } from '../BaseBuilder';
import type { CompareSetup } from './SceneMap';

/**
 * CompareScene3D — a lightweight, self-contained WebGL view of one captured workstation setup,
 * rendered with the REAL worktop + SO-101 meshes (so it matches the workcell page). Its camera is
 * driven by the shared orbit (az/el) so two of these, side by side, turn together with the NavCube.
 * It renders on demand (orbit change / resize), not in a continuous loop — the scene is static.
 */
export function CompareScene3D({ setup, az, el, isDarkMode, makeArmClone }: {
  setup: CompareSetup;
  az: number; el: number;
  isDarkMode: boolean;
  makeArmClone: (a: { x: number; y: number; yaw: number; joints?: number[] }) => THREE.Group | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gl = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; disposables: THREE.BufferGeometry[] } | null>(null);
  const orient = useRef({ az, el });
  orient.current = { az, el };

  // Build the scene once per captured setup (geometry shared with the live arm — never disposed here).
  useEffect(() => {
    const host = hostRef.current;
    const s3 = setup.scene3d;
    if (!host || !s3) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, isDarkMode ? 0x202833 : 0x9aa6b8, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0); dir.position.set(0.6, 0.4, 1.5); scene.add(dir);

    const disposables: THREE.BufferGeometry[] = [];
    const builder = new BaseBuilder(scene);
    builder.rebuild(s3.workcell); // real worktop slab + rails + post

    for (const a of s3.arms) { const g = makeArmClone(a); if (g) scene.add(g); }

    const blockMat = new THREE.MeshStandardMaterial({ color: 0xe0772f, roughness: 0.6 });
    for (const b of s3.blocks) {
      const geo = new THREE.BoxGeometry(0.05, 0.05, 0.05); disposables.push(geo);
      const m = new THREE.Mesh(geo, blockMat); m.position.set(b.x, b.y, b.z); scene.add(m);
    }

    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 50);
    camera.up.set(0, 0, 1);
    gl.current = { renderer, scene, camera, disposables };
    renderFrame();

    const ro = new ResizeObserver(() => renderFrame());
    ro.observe(host);
    return () => {
      ro.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
      blockMat.dispose();
      disposables.forEach((g) => g.dispose());
      gl.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup, isDarkMode]);

  // Re-render whenever the shared orbit changes (position the camera; the scene is static).
  useEffect(() => { renderFrame(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [az, el]);

  function renderFrame() {
    const g = gl.current; const host = hostRef.current; if (!g || !host) return;
    const w = host.clientWidth, h = host.clientHeight; if (w === 0 || h === 0) return;
    g.renderer.setSize(w, h, false);
    g.camera.aspect = w / h; g.camera.updateProjectionMatrix();
    // Orbit around the worktop centre (z-up spherical, matching the NavCube convention).
    const { az: a, el: e } = orient.current;
    const r = 1.45, tx = 0, ty = 0, tz = 0.12;
    const ce = Math.cos(e);
    g.camera.position.set(tx + Math.sin(a) * ce * r, ty + Math.cos(a) * ce * r, tz + Math.sin(e) * r);
    g.camera.lookAt(tx, ty, tz);
    g.renderer.render(g.scene, g.camera);
  }

  return <div ref={hostRef} className="w-full h-full" style={{ cursor: 'grab', touchAction: 'none' }} />;
}
