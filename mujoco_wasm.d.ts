declare module 'mujoco_wasm' {
  const loadMujoco: (options?: unknown) => Promise<unknown>;
  export default loadMujoco;
}
