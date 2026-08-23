
# Tripo3D Model Exporter

A browser-based utility for exporting a Tripo3D model that is already loaded in the browser into a standard `.glb` (GLTF Binary) file.

## Features

* Export the currently loaded Tripo3D model to `.glb`
* Detect the Three.js scene used by Tripo Studio
* Locate the loaded `tripo_node_*` model
* Preserve the model's geometry
* Preserve geometry groups
* Preserve available materials
* Preserve available textures when supported by the browser's loaded material data
* Export the result directly from the browser
* No separate server required

## How It Works

Tripo Studio renders the model using Three.js/TresJS.

The exporter:

1. Locates the Vue application.
2. Finds the current Tripo Studio page component.
3. Locates the TresJS rendering context.
4. Obtains the active Three.js scene.
5. Finds the loaded `tripo_node_*` mesh.
6. Reads its geometry and material information.
7. Creates a clean export scene.
8. Uses Three.js `GLTFExporter`.
9. Generates a binary GLB file.
10. Starts the browser download.

```text
Tripo Studio
     │
     ▼
Vue / Nuxt
     │
     ▼
TresJS
     │
     ▼
Three.js Scene
     │
     ▼
tripo_node_*
     │
     ├── Geometry
     ├── Geometry Groups
     ├── Materials
     └── Textures
     │
     ▼
GLTFExporter
     │
     ▼
complete_model.glb
```

## Requirements

* Google Chrome, Microsoft Edge, or another Chromium-based browser
* Access to a Tripo Studio model page
* The 3D model must be completely loaded before running the exporter
* Browser DevTools access

## Usage

### 1. Open your Tripo Studio model

Open the model in Tripo Studio and wait until the model has completely loaded.

### 2. Open Developer Tools

Press:

```text
F12
```

or:

```text
Ctrl + Shift + J
```

### 3. Open the Console

Select the **Console** tab.

### 4. Paste the exporter

Copy the JavaScript exporter from this repository and paste it into the console.

### 5. Run it

The exporter will inspect the loaded Three.js scene and create:

```text
tripo_complete_model.glb
```

The browser will then start the download.

## Example Console Output

```text
==============================================
      TRIPO COMPLETE MODEL GLB EXPORTER
==============================================

✓ Vue application found
✓ Page component found
✓ TresJS Context found
✓ Three.js scene found
✓ Tripo model found

----------------------------------------------
MODEL GEOMETRY
----------------------------------------------

Vertices: 1003088
Normals: 1003088
UVs: 1003088
Indices: 5868288

----------------------------------------------
GEOMETRY GROUPS
----------------------------------------------

Groups: 1

----------------------------------------------
MATERIALS
----------------------------------------------

Material count: 1

✓ GLTFExporter loaded
✓ Complete model added to export scene

----------------------------------------------
EXPORTING GLB...
----------------------------------------------

✓ Valid GLB generated
Size: XX.XX MB

==============================================
             ✓ EXPORT COMPLETE
==============================================
```

## Important: Scene Meshes vs Model Parts

The Tripo Studio scene can contain additional Three.js meshes that are not part of the actual model.

For example, transform controls can contain objects named:

```text
X
Y
Z
XY
YZ
XZ
XYZ
START
END
```

These are editor/interface objects and should **not** be exported as model geometry.

The exporter therefore specifically searches for the actual:

```text
tripo_node_*
```

model mesh instead of exporting every mesh in the scene.

## Limitations

This project exports the model data that is available in the browser's loaded Three.js scene.

It does not guarantee that every Tripo feature is represented in that scene.

In particular:

* Rigging may not be present in the loaded model scene.
* Animation data may not be present in the loaded model scene.
* Server-side project data is not automatically exported.
* Export quality depends on the geometry/material/texture data actually loaded by the browser.
* Some compressed or proprietary resources may require additional processing.

## Privacy

The exporter is designed to operate locally in the browser.

The model is processed from the Three.js scene already loaded by the browser and is not intentionally uploaded to a separate server by the exporter.

## Legal / Usage Notice

Use this project only with models and content that you are authorized to export.

This project is intended for educational, development, testing, and legitimate model-export workflows.

It does not provide a method for bypassing authentication, subscriptions, credits, permissions, or access controls.

Users are responsible for complying with Tripo's terms, applicable licenses, and the rights associated with the models they export.

## Technology

* JavaScript
* Three.js
* GLTF / GLB
* TresJS
* Vue / Nuxt
* Browser DevTools

## Contributing

Pull requests and improvements are welcome.

Useful contributions include:

* Better model detection
* Improved texture handling
* Better GLB validation
* Support for additional Three.js material types
* Animation detection
* Skeleton/rig detection
* Improved error messages
* Support for different Tripo Studio versions

## Disclaimer

This is an independent browser-side utility and is not affiliated with or endorsed by Tripo3D.

Tripo3D and related trademarks belong to their respective owners.
