# Tripo3D Model Exporter — Upgraded

A browser-side utility for exporting a Tripo Studio model that is already loaded in the user's authorized browser session to a standard `.glb` file.

This version treats the user's existing exporter as the primary codebase and incorporates selected ideas from the reference implementation without replacing the existing animation/rigging architecture.

## What was upgraded

- More defensive Vue/Nuxt/TresJS discovery.
- More robust Tripo model detection.
- Full model-tree detection instead of assuming one mesh is the whole model.
- Avoids obvious viewer/editor helpers such as gizmos, controls, cameras and lights.
- Rig and skinning diagnostics for `SkinnedMesh`, bones, skeletons, `skinIndex`, and `skinWeight`.
- Broader animation discovery from scene/model/object/userData sources.
- AnimationMixer discovery isolated in one compatibility layer.
- Duplicate and invalid animation clips are filtered.
- Uses the runtime Three.js revision when `THREE.REVISION` is exposed, with a documented fallback.
- Uses `SkeletonUtils.clone()` when available for safer skinned-model cloning.
- Keeps `GLTFExporter` as the primary exporter because the project needs GLTF skinning and animation support.
- Stronger GLB header, chunk, JSON and exported-content validation.
- Better diagnostics and an export summary.

## What was deliberately not copied

The reference implementation manually assembles a GLB from raw geometry buffers and a PNG texture. That is useful for low-level static geometry extraction, but it is not a better replacement for the current `GLTFExporter` architecture when the goal is to preserve a model tree, skinning, skeletons and animations.

Therefore this upgrade uses the reference implementation as a source of techniques, not as a replacement codebase.

## Requirements

- Modern Chromium-based browser.
- Access to a Tripo Studio model page.
- The model must be loaded before running the script.
- Browser DevTools Console.
- Internet access may be required to dynamically load `GLTFExporter` and `SkeletonUtils` from `esm.sh`.

## Usage

1. Open the Tripo Studio model in your browser.
2. Wait until the complete model is visible.
3. Open DevTools with `F12` or `Ctrl + Shift + J`.
4. Open the **Console** tab.
5. Paste `tripo3d_model_exporter_upgraded.js`.
6. Press Enter.
7. The script prints the detected model tree, rigging information, animation information and export validation.
8. The browser downloads:

```text
tripo_model_upgraded.glb
```

## Export flow

```text
Tripo Studio
    ↓
Vue / Nuxt
    ↓
TresJS Context
    ↓
Three.js Scene
    ↓
Model detection
    ↓
Full model tree
    ├── Meshes
    ├── Materials
    ├── Textures
    ├── SkinnedMesh
    ├── Bones / Skeleton
    └── AnimationClips
    ↓
SkeletonUtils clone when available
    ↓
GLTFExporter
    ↓
GLB validation
    ↓
Download
```

## Model-tree detection

The exporter first looks for the known Tripo naming pattern:

```text
tripo_node_*
```

If that is unavailable, it scores plausible mesh/skinned-mesh candidates.

It then chooses a useful model-tree root instead of automatically exporting every mesh in the entire viewer scene.

The goal is to preserve a hierarchy such as:

```text
Tripo model root
├── body
├── accessories
├── clothing
├── SkinnedMesh
└── Armature / Bones
    ├── Root
    ├── Spine
    ├── Head
    ├── Arm
    └── Leg
```

while avoiding obvious editor objects such as:

```text
Camera
Light
Grid
Gizmo
Transform Controls
Orbit Controls
Helpers
```

The exact hierarchy depends on what Tripo exposes in the current browser scene.

## Rigging and skinning

The exporter reports:

- `SkinnedMesh` count
- bone count
- skeleton count
- `skinIndex`
- `skinWeight`
- selected skeleton bone count

When available, `SkeletonUtils.clone()` is used because ordinary `Object3D.clone(true)` is not always sufficient for complex skinned hierarchies.

The generated GLB is also inspected for glTF `skins` after export.

## Animation

Animation clips are searched in:

- `scene.animations`
- model-root animations
- model-object animations
- object animations
- `userData.animations`
- `userData.animationClips`
- available `AnimationMixer` actions

Private mixer fields are isolated in the animation-discovery layer because those internals can change between Three.js versions.

Invalid clips and duplicate clips are filtered before export.

After export, the GLB JSON is checked for generated glTF animations.

## GLTFExporter vs manual GLB construction

The reference implementation constructs a GLB manually from raw position/UV/index/texture buffers.

That approach can be useful for a static mesh, but this project has a larger requirement:

```text
Model tree
+ materials
+ textures
+ skinning
+ skeleton
+ animation
```

For that reason, `GLTFExporter` remains the primary export path.

The manual builder is **not** used as a replacement because doing so could regress rigging and animation support.

## GLB validation

The exporter checks:

- GLB magic header.
- glTF version.
- declared file length.
- chunk boundaries.
- JSON chunk presence and JSON parsing.
- BIN chunk presence.
- mesh count.
- node count.
- skin count when rigging is expected.
- animation count when animation clips were detected.

A missing skin or animation is reported as a warning rather than being silently treated as success.

## Performance considerations

Large AI-generated models can consume substantial browser memory.

The exporter therefore avoids constructing a second manually packed geometry buffer and instead lets `GLTFExporter` handle GLB construction.

The model tree is cloned once for export. `SkeletonUtils` is preferred when available for skinned hierarchies.

For very large models, browser memory limits can still be reached because the browser must hold the source scene, export clone and generated GLB during the operation.

## Three.js compatibility

If the page exposes:

```js
THREE.REVISION
```

the exporter attempts to load a matching `GLTFExporter` revision from `esm.sh`.

If that fails, it falls back to the tested default revision configured in the script.

Because Tripo's bundled Three.js version and internal application structure can change, the generated GLB should be verified after major Tripo updates.

## Troubleshooting

### Vue application not found

Run the script on the actual Tripo Studio model page and wait for the application to finish loading.

### TresJS Context not found

Tripo may have changed its Vue/TresJS component structure. Reload the page and retry first.

### No model found

Check the printed scene/model diagnostics. The model may not be fully loaded, or its internal object naming/structure may have changed.

### No animations found

The current browser scene may not expose animation clips. The exporter cannot create animation data that is not available in the loaded scene.

### GLB has a model but no animation

Check:

```text
Source animations
GLB animations
```

If source animations are greater than zero but GLB animations are zero, the animation bindings or Three.js exporter compatibility need investigation.

### GLB has no skin

If the source contains a `SkinnedMesh` and bones but the generated GLB reports zero skins, inspect the printed model tree. The skeleton may be outside the selected model hierarchy or the current Three.js structure may require another cloning strategy.

### GLTFExporter failed to load

Check internet access and the browser console. The exporter dynamically imports the Three.js exporter module.

## Security and authorization

This project is intended to operate only on model data already available in the user's authorized browser session.

It does not implement:

- authentication bypasses
- subscription bypasses
- credit bypasses
- DRM circumvention
- access to unauthorized models
- server-side credential extraction

Use the exporter only with content you are authorized to export.

## Important limitation

This is a browser-side exporter that depends on Tripo Studio's current internal Vue/TresJS/Three.js scene structure.

Tripo can change those internals without notice. Therefore the exporter should be considered version-sensitive and should be tested after significant changes to Tripo Studio.

No claim is made that this script has been live-tested against every current Tripo Studio model type.

## Files

```text
tripo3d-model-exporter/
├── README.md
└── tripo3d_model_exporter_upgraded.js
```

## License

Add the license appropriate for your repository.

## Disclaimer

This is an independent browser-side utility and is not affiliated with, sponsored by, or endorsed by Tripo3D. Tripo3D and related trademarks belong to their respective owners.
