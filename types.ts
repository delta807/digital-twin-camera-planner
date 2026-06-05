/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


/**
 * DetectType defines the detection modes available in the application.
 */
export type DetectType = '2D bounding boxes' | 'Points';

/**
 * CameraIntrinsics describes the placeable "sensor" camera's optics.
 * hFovDeg + aspect fully determine the vertical FOV; near/far are the
 * useful depth range (meters) and become the frustum's near/far planes.
 */
export interface CameraIntrinsics {
  hFovDeg: number;   // horizontal field of view, degrees
  aspect: number;    // width / height (image aspect ratio)
  near: number;      // min useful depth, meters
  far: number;       // max useful depth, meters
}

export interface CameraStreamProfile {
  id: string;
  label: string;
  intrinsics: CameraIntrinsics;
}

/**
 * CameraViewToggles controls which overlays/views of the sensor camera are shown.
 */
export interface CameraViewToggles {
  enabled: boolean;    // master: show the placeable camera + gizmo at all
  frustum: boolean;    // wireframe FOV pyramid
  sensorPip: boolean;  // picture-in-picture render from the camera's POV
  footprint: boolean;  // ground polygon the FOV covers (frustum ∩ floor)
  objectTint: boolean; // highlight scene objects inside the frustum
  coverage: boolean;   // occlusion-aware visible/occluded sample grid
}

/** Live Jetson dashboard RGB stream: 848x480@30, JPEG quality 80. */
export const D435I_DASHBOARD_RGB_PRESET: CameraIntrinsics = {
  hFovDeg: 69.45,
  aspect: 848 / 480,
  near: 0.3,
  far: 3.0,
};

/** D435i RGB 4:3 mode (640x480): a horizontal crop of the 16:9 sensor — keeps V≈42.5°,
 *  narrows H to ≈54.8° (measured 54.73° in librealsense#2141). */
export const D435I_RGB_640X480_PRESET: CameraIntrinsics = {
  hFovDeg: 54.8,
  aspect: 4 / 3,
  near: 0.3,
  far: 3.0,
};

/** Intel RealSense D435i RGB/color stream preset (datasheet 69.4° × 42.5°, 16:9). */
export const D435I_RGB_PRESET: CameraIntrinsics = {
  hFovDeg: 69.4,
  aspect: 16 / 9,
  near: 0.3,
  far: 3.0,
};

/** Intel RealSense D435i depth stream planning preset. */
export const D435I_DEPTH_PRESET: CameraIntrinsics = {
  hFovDeg: 87,
  aspect: 16 / 9,
  near: 0.3,
  far: 3.0,
};

export const D435I_STREAM_PROFILES: CameraStreamProfile[] = [
  { id: 'rgb-848x480-live', label: 'Live RGB 848x480', intrinsics: D435I_DASHBOARD_RGB_PRESET },
  { id: 'rgb-1280x720', label: 'RGB 1280x720', intrinsics: D435I_RGB_PRESET },
  { id: 'rgb-640x360', label: 'RGB 640x360', intrinsics: D435I_RGB_PRESET },
  { id: 'rgb-640x480', label: 'RGB 640x480', intrinsics: D435I_RGB_640X480_PRESET },
  // 848x480 is the depth sensor's native resolution; datasheet depth FOV 87° × 58°.
  { id: 'depth-848x480', label: 'Depth 848x480', intrinsics: { hFovDeg: 87, aspect: 848 / 480, near: 0.3, far: 3.0 } },
  // 4:3 depth crop keeps V=58°, narrows H to ≈72.9° (was an over-wide 79.76°).
  { id: 'depth-640x480', label: 'Depth 640x480', intrinsics: { hFovDeg: 72.9, aspect: 4 / 3, near: 0.3, far: 3.0 } },
  { id: 'depth-published', label: 'Depth 87°×58°', intrinsics: D435I_DEPTH_PRESET },
];

// Default to a true 16:9 RGB mode (the natural "footage" aspect), not the depth-native 848x480.
// Default to RGB 1280×720 (16:9) — matches the LIVE teleop dashboard, where the D435i runs at its
// native 16:9 (the recorded training episodes are downscaled to 640×480 4:3, but the live preview
// the user actually compares against is wide). Switch to 640×480 in the dock for the training crop.
export const D435I_DEFAULT_PROFILE_ID = 'rgb-1280x720';
export const D435I_PRESET: CameraIntrinsics = { ...D435I_RGB_PRESET };

export const DEFAULT_CAMERA_TOGGLES: CameraViewToggles = {
  enabled: true,
  frustum: true,
  sensorPip: true,
  footprint: true,
  objectTint: false,
  coverage: false,
};

export interface WorkcellConfig {
  length: number;
  width: number;
  barHeight: number;
  barWidth: number;
  postHeight: number;
  shapeSides: number;
  /** Primary worktop placement — lets the main table be moved/rotated like a station (visual only;
   *  the world origin stays at 0,0 so reach/coordinate readouts are unaffected). Default 0/0/0. */
  originX?: number;
  originY?: number;
  yaw?: number;
  /** Camera-post (aluminium upright) world X/Y; origin = table centre. */
  postX: number;
  postY: number;
  /** Extra user-added upright posts (mount points) — each snappable like the main post. */
  extraPosts: Array<{ x: number; y: number; height: number }>;
  /** Additional workstations — each is its own worktop (slab + rails + post) at a world X/Y,
   *  with its own arm (added on creation). Lets you lay out a multi-cell lab. postX/postY are
   *  RELATIVE to the station's own centre. */
  stations: Array<{ id: string; x: number; y: number; yaw: number; shapeSides: number; length: number; width: number; postX: number; postY: number; postHeight: number }>;
  /** Extra placeable overhead D435i cameras (beyond the primary) — each at (x,y,z) with an euler
   *  aim (rotX/rotY/rotZ radians; 0,0,0 = straight down). Each renders its own live Feeds PIP and is
   *  selectable with a move/aim gizmo like the primary. */
  extraCameras: Array<{ id: string; x: number; y: number; z: number; rotX: number; rotY: number; rotZ: number }>;
}

export const DEFAULT_WORKCELL_CONFIG: WorkcellConfig = {
  length: 0.83,
  width: 0.83,
  barHeight: 0.024,
  barWidth: 0.024,
  postHeight: 0.84,
  shapeSides: 4,
  // ~15 cm in from the +X edge of an 0.83 m worktop, centred on Y — matches the real rig.
  postX: 0.265,
  postY: 0.0,
  extraPosts: [],
  stations: [],
  extraCameras: [],
};

export interface ArmInstance {
  id: string;
  label: string;
  x: number;
  y: number;
  yaw: number;
  primary?: boolean;
  /** Which workstation this arm belongs to (undefined = the primary worktop). Lets removing a
   *  station also remove its arm, so a station is a real "workstation clone" not just a table. */
  stationId?: string;
}

/** Length display unit. The sim is metre-native (MuJoCo); mm is offered for CAD familiarity. */
export type LengthUnit = 'm' | 'mm';

/** Format a length given in METERS into the chosen unit, with a sensible precision + suffix. */
export function formatLen(meters: number, unit: LengthUnit): string {
  return unit === 'mm' ? `${(meters * 1000).toFixed(0)} mm` : `${meters.toFixed(3)} m`;
}

/**
 * LogEntry represents a record of a vision model interaction.
 */
export interface LogEntry {
  id: string;
  timestamp: Date;
  imageSrc: string;
  prompt: string;
  fullPrompt: string;
  type: string;
  result: unknown; 
  requestData: unknown; 
}

/**
 * Interface for the result item from detection.
 */
export interface DetectedItem {
  box_2d?: number[];
  point?: number[];
  label?: string;
  [key: string]: unknown;
}

/**
 * Minimal interface for MuJoCo Model to avoid 'any'.
 */
export interface MujocoModel {
  nbody: number;
  ngeom: number;
  nsite: number;
  nu: number;
  njnt: number;
  name_siteadr: Int32Array;
  name_actuatoradr: Int32Array;
  name_bodyadr: Int32Array;
  names: Int8Array;
  jnt_qposadr: Int32Array;
  actuator_trnid: Int32Array;
  geom_group: Int32Array;
  geom_type: Int32Array;
  geom_size: Float64Array; 
  geom_pos: Float64Array;
  geom_quat: Float64Array;
  geom_matid: Int32Array;
  mat_rgba: Float32Array;
  geom_rgba: Float32Array;
  geom_dataid: Int32Array;
  mesh_vertadr: Int32Array;
  mesh_vertnum: Int32Array;
  mesh_faceadr: Int32Array;
  mesh_facenum: Int32Array;
  mesh_vert: Float32Array;
  mesh_face: Int32Array;
  geom_bodyid: Int32Array;
  body_parentid?: Int32Array;
  delete: () => void;
  [key: string]: unknown;
}

/**
 * Minimal interface for MuJoCo Data to avoid 'any'.
 */
export interface MujocoData {
  time: number;
  qpos: Float64Array;
  ctrl: Float64Array;
  xfrc_applied: Float64Array;
  xpos: Float64Array;
  xquat: Float64Array;
  ncon: number;
  contact: unknown;
  site_xpos: Float64Array;
  site_xmat: Float64Array;
  delete: () => void;
  [key: string]: unknown;
}

/**
 * Minimal interface for the MuJoCo WASM Module.
 */
export interface MujocoModule {
  MjModel: { loadFromXML: (path: string) => MujocoModel; [key: string]: unknown };
  MjData: new (model: MujocoModel) => MujocoData;
  MjvOption: new () => { delete: () => void; [key: string]: unknown };
  mj_forward: (m: MujocoModel, d: MujocoData) => void;
  mj_step: (m: MujocoModel, d: MujocoData) => void;
  mj_resetData: (m: MujocoModel, d: MujocoData) => void;
  mjtGeom: Record<string, number | {value: number}>;
  FS: {
      writeFile: (path: string, content: string | Uint8Array) => void;
      mkdir: (path: string) => void;
      unmount: (path: string) => void;
  };
  [key: string]: unknown;
}
