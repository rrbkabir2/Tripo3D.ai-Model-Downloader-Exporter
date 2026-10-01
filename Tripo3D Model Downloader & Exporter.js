/**
 * Tripo3D Model Exporter - Upgraded
 *
 * Browser-side exporter for a Tripo Studio model already loaded in the
 * authorized browser session. Designed as an upgrade of the existing
 * exporter, not a replacement with the reference implementation.
 *
 * Main improvements:
 * - robust Vue/Nuxt/TresJS discovery
 * - model-tree/root detection instead of assuming one mesh is the whole model
 * - safer SkinnedMesh/skeleton handling
 * - broader animation discovery with isolated private-API access
 * - runtime Three.js revision detection when exposed
 * - GLTFExporter as the primary exporter
 * - stronger GLB validation
 * - structured diagnostics and export summary
 *
 * Usage: paste into DevTools Console on a loaded Tripo Studio model page.
 */
(async function exportTripoModelUpgraded() {
    'use strict';

    const CONFIG = Object.freeze({
        maxVNodeDepth: 100,
        defaultThreeRevision: '183',
        importerBase: 'https://esm.sh/three@',
        downloadFilename: 'tripo_model_upgraded.glb',
        revokeDelayMs: 30_000,
        blockedNamePattern: /(?:transform|gizmo|helper|control|grid|axis|camera|light|orbit|editor|manipulator)/i,
        modelNamePattern: /^tripo_node_/i,
    });

    const log = (...args) => console.log('[tripo-export]', ...args);
    const warn = (...args) => console.warn('[tripo-export]', ...args);

    function fail(message, cause) {
        const error = new Error(message);
        if (cause) error.cause = cause;
        throw error;
    }

    function isObject(value) {
        return !!value && typeof value === 'object';
    }

    function addUnique(list, value) {
        if (value && !list.includes(value)) list.push(value);
    }

    // -------------------------------------------------------------------------
    // Vue / TresJS discovery
    // -------------------------------------------------------------------------

    function findVueApp() {
        const appEl = document.querySelector('[data-v-app]') || document.querySelector('#__nuxt');
        if (!appEl?.__vue_app__) {
            fail('Vue application not found. Open a Tripo Studio model page and wait until the viewer finishes loading.');
        }
        return appEl.__vue_app__;
    }

    function findTresContext(vnode, depth = 0, visited = new Set()) {
        if (!vnode || !isObject(vnode) || depth > CONFIG.maxVNodeDepth || visited.has(vnode)) return null;
        visited.add(vnode);

        if (vnode.component) {
            const component = vnode.component;
            const name = component.type?.name || component.type?.__name || '';
            if (name === 'Context') return component;

            const nested = findTresContext(component.subTree, depth + 1, visited);
            if (nested) return nested;
        }

        if (Array.isArray(vnode.children)) {
            for (const child of vnode.children) {
                const nested = findTresContext(child, depth + 1, visited);
                if (nested) return nested;
            }
        }

        return null;
    }

    function getScene(vueApp) {
        const router = vueApp?.config?.globalProperties?.$router;
        const route = router?.currentRoute?.value;
        if (!route) fail('Current Vue route is unavailable.');

        const matched = route.matched?.[0];
        if (!matched) fail('No matched Vue route was found. Open a Tripo Studio model page.');

        const pageInternal = matched.instances?.default?._;
        if (!pageInternal) fail('The current page component instance could not be inspected.');

        const context = findTresContext(pageInternal.subTree);
        if (!context) {
            fail('TresJS Context was not found. Tripo Studio may have changed its Vue/TresJS structure.');
        }

        const useTres = context.provides?.useTres;
        if (!useTres) fail('TresJS useTres provider was not found.');

        const scene = useTres.scene?.value ?? useTres.scene;
        if (!scene?.isScene) {
            fail('A valid Three.js Scene was not found. Wait for the 3D viewer to finish loading.');
        }

        return scene;
    }

    // -------------------------------------------------------------------------
    // Three.js object/tree helpers
    // -------------------------------------------------------------------------

    function collectObjects(root) {
        const objects = [];
        root?.traverse?.(object => objects.push(object));
        return objects;
    }

    function isBlockedObject(object) {
        return CONFIG.blockedNamePattern.test(String(object?.name || ''));
    }

    function meshCount(root) {
        let count = 0;
        root?.traverse?.(object => {
            if (object?.isMesh || object?.isSkinnedMesh) count++;
        });
        return count;
    }

    function vertexCount(root) {
        let count = 0;
        root?.traverse?.(object => {
            count += object?.geometry?.attributes?.position?.count || 0;
        });
        return count;
    }

    function containsSkinnedMesh(root) {
        let found = false;
        root?.traverse?.(object => {
            if (object?.isSkinnedMesh) found = true;
        });
        return found;
    }

    function containsBone(root) {
        let found = false;
        root?.traverse?.(object => {
            if (object?.isBone) found = true;
        });
        return found;
    }

    function rootCandidateScore(root, explicit = false) {
        const name = String(root?.name || '');
        let score = 0;

        if (explicit) score += 10_000;
        if (CONFIG.modelNamePattern.test(name)) score += 5_000;
        if (root?.isGroup || root?.isObject3D) score += 100;
        if (containsSkinnedMesh(root)) score += 2_000;
        if (containsBone(root)) score += 1_500;

        const meshes = meshCount(root);
        const vertices = vertexCount(root);
        score += Math.min(meshes * 150, 1_500);
        score += Math.min(vertices / 1_000, 1_000);

        if (isBlockedObject(root)) score -= 10_000;
        return score;
    }

    /**
     * Finds the actual Tripo model object first, then chooses the smallest
     * useful ancestor that represents the model tree without climbing into
     * the whole viewer Scene. This fixes the old "single mesh = whole model"
     * assumption while avoiding export of editor helpers.
     */
    function findModelTree(scene) {
        const objects = collectObjects(scene);

        const explicit = objects
            .filter(object => CONFIG.modelNamePattern.test(String(object?.name || '')))
            .filter(object => object?.isMesh || object?.isSkinnedMesh || object?.isObject3D)
            .sort((a, b) => rootCandidateScore(b, true) - rootCandidateScore(a, true));

        if (explicit.length) {
            const modelObject = explicit[0];
            const root = chooseTreeRoot(modelObject, scene);
            return {
                modelObject,
                root,
                strategy: root === modelObject ? 'explicit tripo_node_* object' : 'explicit tripo_node_* + model ancestor'
            };
        }

        const meshCandidates = objects
            .filter(object => object?.isMesh || object?.isSkinnedMesh)
            .filter(object => !isBlockedObject(object))
            .sort((a, b) => modelMeshScore(b) - modelMeshScore(a));

        if (!meshCandidates.length) {
            fail('No plausible model mesh was found. The model may not be loaded, or Tripo may have changed its scene structure.');
        }

        const modelObject = meshCandidates[0];
        const root = chooseTreeRoot(modelObject, scene);
        return { modelObject, root, strategy: 'scored mesh fallback + model ancestor' };
    }

    function modelMeshScore(object) {
        let score = 0;
        const name = String(object?.name || '');
        const vertices = object?.geometry?.attributes?.position?.count || 0;

        if (object?.isSkinnedMesh) score += 3_000;
        if (CONFIG.modelNamePattern.test(name)) score += 10_000;
        if (/tripo/i.test(name)) score += 1_000;
        if (object?.geometry?.attributes?.position) score += 300;
        score += Math.min(vertices / 1_000, 2_000);
        if (isBlockedObject(object)) score -= 20_000;

        return score;
    }

    function chooseTreeRoot(modelObject, scene) {
        // If the identified Tripo object already owns a meaningful subtree,
        // retain it. This is the preferred full-model-tree path.
        const ownMeshes = meshCount(modelObject);
        const ownBones = containsBone(modelObject);
        if (modelObject.children?.length && (ownMeshes > 1 || ownBones)) {
            return modelObject;
        }

        // Walk ancestors. Stop before Scene and reject obvious viewer helpers.
        // Prefer the nearest ancestor whose subtree contains model geometry and
        // no obvious editor-only name.
        let current = modelObject.parent;
        let best = modelObject;
        while (current && current !== scene) {
            if (!isBlockedObject(current)) {
                const meshes = meshCount(current);
                const vertices = vertexCount(current);
                if (meshes > 0 && (CONFIG.modelNamePattern.test(String(current.name || '')) || containsBone(current))) {
                    best = current;
                } else if (meshes === 1 && !current.children?.some(child => isBlockedObject(child))) {
                    // Keep only a simple ancestor when it does not look like a viewer container.
                    best = current;
                }
            }
            current = current.parent;
        }

        return best;
    }

    // -------------------------------------------------------------------------
    // Rig / skeleton analysis
    // -------------------------------------------------------------------------

    function collectRigInfo(scene, modelObject, modelRoot) {
        const skinnedMeshes = [];
        const bones = [];
        const skeletons = [];

        scene.traverse(object => {
            if (object?.isSkinnedMesh) addUnique(skinnedMeshes, object);
            if (object?.isBone) addUnique(bones, object);
            if (object?.skeleton) addUnique(skeletons, object.skeleton);
        });

        const selectedGeometry = modelObject?.geometry;
        const hasSkinIndex = !!selectedGeometry?.attributes?.skinIndex;
        const hasSkinWeight = !!selectedGeometry?.attributes?.skinWeight;
        const selectedSkeleton = modelObject?.skeleton || null;
        const modelTreeSkinned = containsSkinnedMesh(modelRoot);

        return {
            skinnedMeshes,
            bones,
            skeletons,
            selectedSkeleton,
            hasSkinIndex,
            hasSkinWeight,
            modelIsSkinned: !!modelObject?.isSkinnedMesh,
            modelTreeSkinned,
            boneCount: selectedSkeleton?.bones?.length || bones.length,
        };
    }

    // -------------------------------------------------------------------------
    // Animation discovery
    // -------------------------------------------------------------------------

    function isAnimationClip(value) {
        return !!value && typeof value === 'object' &&
            Array.isArray(value.tracks) &&
            typeof value.duration === 'number';
    }

    function collectClipValue(value, source, entries, visited = new Set()) {
        if (!value || typeof value !== 'object') return;
        if (visited.has(value)) return;
        visited.add(value);

        if (isAnimationClip(value)) {
            entries.push({ clip: value, source });
            return;
        }

        if (Array.isArray(value)) {
            for (const item of value) collectClipValue(item, source, entries, visited);
        }
    }

    function getClipKey(clip) {
        const tracks = Array.isArray(clip.tracks) ? clip.tracks : [];
        const trackSignature = tracks.map(track => {
            const name = track?.name || '';
            const type = track?.ValueTypeName || track?.constructor?.name || '';
            const count = track?.times?.length || 0;
            return `${name}:${type}:${count}`;
        }).join('|');

        return [
            clip.name || '(unnamed)',
            Number.isFinite(clip.duration) ? clip.duration.toFixed(6) : 'NaN',
            tracks.length,
            trackSignature
        ].join('::');
    }

    function isAnimationMixer(value) {
        return !!value && typeof value === 'object' && value.constructor?.name === 'AnimationMixer';
    }

    function collectAnimationInfo(scene, modelRoot, modelObject) {
        const entries = [];
        const mixers = [];
        const objects = collectObjects(scene);

        collectClipValue(scene.animations, 'scene.animations', entries);
        collectClipValue(modelRoot.animations, 'modelRoot.animations', entries);
        collectClipValue(modelObject.animations, 'modelObject.animations', entries);

        for (const object of objects) {
            const label = object.name || object.type || 'Object3D';
            collectClipValue(object.animations, `${label}.animations`, entries);
            collectClipValue(object.userData?.animations, `${label}.userData.animations`, entries);
            collectClipValue(object.userData?.animationClips, `${label}.userData.animationClips`, entries);
        }

        // Private fields are isolated here so future Three.js changes are easy to adapt.
        const mixerHosts = [scene, modelRoot, modelObject, ...objects];
        const visitedHosts = new Set();

        for (const host of mixerHosts) {
            if (!host || visitedHosts.has(host)) continue;
            visitedHosts.add(host);

            if (isAnimationMixer(host)) addUnique(mixers, host);

            for (const key of ['mixer', 'animationMixer', '_mixer']) {
                try {
                    const candidate = host[key];
                    if (isAnimationMixer(candidate)) addUnique(mixers, candidate);
                } catch (_) {
                    // Ignore inaccessible/private fields.
                }
            }
        }

        for (const mixer of mixers) {
            try {
                for (const action of mixer._actions || []) {
                    if (action?._clip) {
                        collectClipValue(action._clip, 'AnimationMixer._actions', entries);
                    }
                }
            } catch (error) {
                warn('AnimationMixer inspection failed for one mixer:', error);
            }
        }

        const uniqueEntries = [];
        const seenKeys = new Set();
        for (const entry of entries) {
            const clip = entry.clip;
            if (!isAnimationClip(clip)) continue;
            if (!Array.isArray(clip.tracks) || clip.tracks.length === 0) continue;
            if (!Number.isFinite(clip.duration) || clip.duration < 0) continue;

            const key = getClipKey(clip);
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            uniqueEntries.push(entry);
        }

        return {
            clips: uniqueEntries.map(entry => entry.clip),
            entries: uniqueEntries,
            mixers,
        };
    }

    // -------------------------------------------------------------------------
    // Exporter loading / cloning
    // -------------------------------------------------------------------------

    function getRuntimeThreeRevision() {
        const revision = globalThis.THREE?.REVISION;
        if (revision && /^\d+(?:\.\d+)?$/.test(String(revision))) return String(revision);
        return CONFIG.defaultThreeRevision;
    }

    async function loadExporterModules() {
        const revision = getRuntimeThreeRevision();
        const candidates = [revision];
        if (!candidates.includes(CONFIG.defaultThreeRevision)) candidates.push(CONFIG.defaultThreeRevision);

        let exporterModule = null;
        let usedRevision = null;
        let lastError = null;

        for (const candidate of candidates) {
            try {
                exporterModule = await import(`${CONFIG.importerBase}${candidate}/examples/jsm/exporters/GLTFExporter.js`);
                usedRevision = candidate;
                break;
            } catch (error) {
                lastError = error;
                warn(`Could not load GLTFExporter for Three.js r${candidate}.`, error);
            }
        }

        if (!exporterModule?.GLTFExporter) {
            fail('GLTFExporter could not be loaded. Check network access and Three.js version compatibility.', lastError);
        }

        let skeletonUtils = null;
        try {
            const module = await import(`${CONFIG.importerBase}${usedRevision}/examples/jsm/utils/SkeletonUtils.js`);
            skeletonUtils = module?.clone || null;
        } catch (error) {
            warn('SkeletonUtils unavailable; using Object3D.clone(true). Skinned exports should be verified carefully.', error);
        }

        return {
            GLTFExporter: exporterModule.GLTFExporter,
            skeletonClone: skeletonUtils,
            runtimeRevision: revision,
            exporterRevision: usedRevision,
        };
    }

    function prepareExportRoot(modelRoot, skeletonClone) {
        if (skeletonClone) {
            try {
                return skeletonClone(modelRoot);
            } catch (error) {
                warn('SkeletonUtils.clone failed; falling back to Object3D.clone(true).', error);
            }
        }

        return modelRoot.clone(true);
    }

    // -------------------------------------------------------------------------
    // GLB validation
    // -------------------------------------------------------------------------

    function readU32(view, offset) {
        if (offset < 0 || offset + 4 > view.byteLength) fail(`GLB validation attempted to read beyond the file at byte ${offset}.`);
        return view.getUint32(offset, true);
    }

    function validateGLB(arrayBuffer, expected) {
        if (!(arrayBuffer instanceof ArrayBuffer)) fail('Exporter did not return an ArrayBuffer.');
        if (arrayBuffer.byteLength < 20) fail('Generated GLB is too small to contain a valid header and JSON chunk.');

        const view = new DataView(arrayBuffer);
        const magic = readU32(view, 0);
        const version = readU32(view, 4);
        const declaredLength = readU32(view, 8);

        if (magic !== 0x46546C67) fail('Generated GLB has an invalid magic header.');
        if (version !== 2) fail(`Generated GLB uses unsupported glTF version ${version}; expected version 2.`);
        if (declaredLength !== arrayBuffer.byteLength) {
            fail(`Generated GLB length mismatch: header=${declaredLength}, actual=${arrayBuffer.byteLength}.`);
        }

        let offset = 12;
        let jsonFound = false;
        let binFound = false;
        let jsonObject = null;

        while (offset < arrayBuffer.byteLength) {
            if (offset + 8 > arrayBuffer.byteLength) fail(`GLB chunk header is truncated at byte ${offset}.`);

            const chunkLength = readU32(view, offset);
            const chunkType = readU32(view, offset + 4);
            offset += 8;

            if (offset + chunkLength > arrayBuffer.byteLength) {
                fail(`GLB chunk exceeds file boundary at byte ${offset}.`);
            }

            if (chunkType === 0x4E4F534A) {
                jsonFound = true;
                try {
                    const bytes = new Uint8Array(arrayBuffer, offset, chunkLength);
                    const text = new TextDecoder().decode(bytes).replace(/\s+$/u, '');
                    jsonObject = JSON.parse(text);
                } catch (error) {
                    fail('GLB JSON chunk exists but could not be parsed.', error);
                }
            } else if (chunkType === 0x004E4942) {
                binFound = true;
            }

            offset += chunkLength;
        }

        if (offset !== arrayBuffer.byteLength) fail('GLB chunk parsing ended at an unexpected file offset.');
        if (!jsonFound) fail('Generated GLB contains no JSON chunk.');

        const meshCount = jsonObject?.meshes?.length || 0;
        const nodeCount = jsonObject?.nodes?.length || 0;
        const animationCount = jsonObject?.animations?.length || 0;
        const skinCount = jsonObject?.skins?.length || 0;

        if (meshCount === 0) fail('Generated GLB is structurally valid but contains no meshes.');
        if (expected.skinned && expected.bones > 0 && skinCount === 0) {
            warn('Source scene contained rigging, but generated GLB contains no glTF skin. Verify the exported skeleton hierarchy.');
        }
        if (expected.animationCount > 0 && animationCount === 0) {
            warn('Animation clips were detected in the source, but generated GLB contains no animations. Verify clip bindings and export compatibility.');
        }

        return {
            sizeBytes: arrayBuffer.byteLength,
            sizeMB: (arrayBuffer.byteLength / 1024 / 1024).toFixed(2),
            meshCount,
            nodeCount,
            animationCount,
            skinCount,
            jsonFound,
            binFound,
        };
    }

    // -------------------------------------------------------------------------
    // Download
    // -------------------------------------------------------------------------

    function downloadGLB(arrayBuffer, filename) {
        const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), CONFIG.revokeDelayMs);
        return blob.size;
    }

    async function runExporter(GLTFExporter, exportScene, clips) {
        const exporter = new GLTFExporter();
        const options = {
            binary: true,
            onlyVisible: false,
            trs: false,
            includeCustomExtensions: true,
            animations: clips,
        };

        return await new Promise((resolve, reject) => {
            try {
                exporter.parse(
                    exportScene,
                    result => {
                        if (result instanceof ArrayBuffer) resolve(result);
                        else reject(new Error('GLTFExporter returned a non-binary result while binary=true.'));
                    },
                    error => reject(error instanceof Error ? error : new Error(String(error))),
                    options
                );
            } catch (error) {
                reject(error);
            }
        });
    }

    // -------------------------------------------------------------------------
    // Diagnostics
    // -------------------------------------------------------------------------

    function printTree(root, maxDepth = 8) {
        console.log('MODEL TREE:');
        function visit(object, depth) {
            if (!object || depth > maxDepth) return;
            const indent = '  '.repeat(depth);
            const flags = [
                object.isSkinnedMesh ? 'SkinnedMesh' : null,
                object.isMesh ? 'Mesh' : null,
                object.isBone ? 'Bone' : null,
                object.isGroup ? 'Group' : null,
            ].filter(Boolean).join(', ');
            const meshes = object.isMesh || object.isSkinnedMesh ? ` vertices=${object.geometry?.attributes?.position?.count || 0}` : '';
            console.log(`${indent}- ${object.name || '(unnamed)'} [${object.type || 'Object3D'}${flags ? ` | ${flags}` : ''}]${meshes}`);
            for (const child of object.children || []) visit(child, depth + 1);
        }
        visit(root, 0);
    }

    function summarizeMaterials(root) {
        const materials = [];
        root?.traverse?.(object => {
            const list = Array.isArray(object.material) ? object.material : [object.material];
            for (const material of list) {
                if (material) addUnique(materials, material);
            }
        });

        return materials.map(material => ({
            type: material.type,
            name: material.name || '(unnamed)',
            map: !!material.map,
            normalMap: !!material.normalMap,
            roughnessMap: !!material.roughnessMap,
            metalnessMap: !!material.metalnessMap,
            alphaMap: !!material.alphaMap,
            transparent: !!material.transparent,
            alphaTest: material.alphaTest || 0,
        }));
    }

    function validateSourceModel(modelObject, modelRoot) {
        if (!modelObject) fail('No model object was selected.');
        if (!modelObject.geometry?.attributes?.position) {
            fail(`Selected object "${modelObject.name || modelObject.type}" has no position attribute and cannot be exported as a model.`);
        }
        if (!modelRoot?.clone) fail('The selected model tree cannot be cloned for export.');
    }

    // -------------------------------------------------------------------------
    // Main
    // -------------------------------------------------------------------------

    try {
        console.clear();
        console.log('================================================');
        console.log('      TRIPO3D MODEL EXPORTER - UPGRADED');
        console.log('================================================');

        const vueApp = findVueApp();
        log('✓ Vue application found');

        const scene = getScene(vueApp);
        log('✓ TresJS / Three.js scene found');
        log('Scene children:', scene.children?.length || 0);

        const detected = findModelTree(scene);
        const modelObject = detected.modelObject;
        const modelRoot = detected.root;
        validateSourceModel(modelObject, modelRoot);

        log('✓ Model object:', modelObject.name || modelObject.type);
        log('✓ Model tree root:', modelRoot.name || modelRoot.type);
        log('Detection strategy:', detected.strategy);

        printTree(modelRoot);

        const rig = collectRigInfo(scene, modelObject, modelRoot);
        const animation = collectAnimationInfo(scene, modelRoot, modelObject);
        const materialSummary = summarizeMaterials(modelRoot);
        const geometry = modelObject.geometry;
        const position = geometry.attributes.position;

        console.log('');
        console.log('--------------------------------------------');
        console.log('SOURCE MODEL');
        console.log('--------------------------------------------');
        console.log('Selected object:', modelObject.name || '(unnamed)');
        console.log('Export root:', modelRoot.name || modelRoot.type);
        console.log('Export-tree meshes:', meshCount(modelRoot));
        console.log('Export-tree vertices:', vertexCount(modelRoot));
        console.log('Selected vertices:', position.count);
        console.log('Selected indices:', geometry.index?.count || 0);
        console.log('Selected geometry groups:', geometry.groups?.length || 0);
        console.log('Unique materials:', materialSummary.length);

        console.log('');
        console.log('--------------------------------------------');
        console.log('RIG / SKINNING');
        console.log('--------------------------------------------');
        console.log('Skinned meshes in scene:', rig.skinnedMeshes.length);
        console.log('Bones in scene:', rig.bones.length);
        console.log('Skeleton objects:', rig.skeletons.length);
        console.log('Model tree contains SkinnedMesh:', rig.modelTreeSkinned);
        console.log('Selected skinIndex:', rig.hasSkinIndex ? '✓' : '—');
        console.log('Selected skinWeight:', rig.hasSkinWeight ? '✓' : '—');
        console.log('Selected skeleton bones:', rig.selectedSkeleton?.bones?.length || 0);

        console.log('');
        console.log('--------------------------------------------');
        console.log('ANIMATIONS');
        console.log('--------------------------------------------');
        console.log('Animation mixers:', animation.mixers.length);
        console.log('Valid animation clips:', animation.clips.length);
        animation.entries.forEach((entry, index) => {
            const clip = entry.clip;
            console.log(
                `[${index + 1}] ${clip.name || '(unnamed)'} | duration=${clip.duration.toFixed(3)}s | tracks=${clip.tracks.length} | source=${entry.source}`
            );
        });

        if (!animation.clips.length) {
            warn('No valid AnimationClip data was detected. Static/rigged export can still proceed.');
        }

        console.log('');
        console.log('--------------------------------------------');
        console.log('LOADING EXPORTER');
        console.log('--------------------------------------------');

        const modules = await loadExporterModules();
        log(`✓ GLTFExporter loaded for Three.js r${modules.exporterRevision}`);
        if (modules.runtimeRevision !== modules.exporterRevision) {
            warn(`Runtime Three.js revision is r${modules.runtimeRevision}, exporter module is r${modules.exporterRevision}. Verify output if compatibility is uncertain.`);
        }
        if (modules.skeletonClone) log('✓ SkeletonUtils available');

        const exportScene = new scene.constructor();
        exportScene.name = 'Tripo_Complete_Model';

        const modelClone = prepareExportRoot(modelRoot, modules.skeletonClone);
        modelClone.name = modelClone.name || 'Tripo_Model';
        exportScene.add(modelClone);
        exportScene.updateMatrixWorld(true);

        log('✓ Full model tree cloned for export');

        console.log('');
        console.log('--------------------------------------------');
        console.log('EXPORT');
        console.log('--------------------------------------------');
        console.log('Meshes in export tree:', meshCount(modelClone));
        console.log('Animations requested:', animation.clips.length);

        const glb = await runExporter(modules.GLTFExporter, exportScene, animation.clips);

        const validation = validateGLB(glb, {
            skinned: rig.modelTreeSkinned || rig.modelIsSkinned,
            bones: rig.boneCount,
            animationCount: animation.clips.length,
        });

        const filename = CONFIG.downloadFilename;
        downloadGLB(glb, filename);

        console.log('');
        console.log('================================================');
        console.log('             ✓ EXPORT COMPLETE');
        console.log('================================================');
        console.log('File:', filename);
        console.log('Size:', `${validation.sizeMB} MB`);
        console.log('GLB JSON:', validation.jsonFound ? '✓' : '✗');
        console.log('GLB BIN:', validation.binFound ? '✓' : '⚠');
        console.log('GLB meshes:', validation.meshCount);
        console.log('GLB nodes:', validation.nodeCount);
        console.log('GLB skins:', validation.skinCount);
        console.log('GLB animations:', validation.animationCount);
        console.log('Source animations:', animation.clips.length);
        console.log('Source bones:', rig.boneCount);
        console.log('Three runtime revision:', modules.runtimeRevision);
        console.log('Exporter revision:', modules.exporterRevision);
        console.log('================================================');

        return {
            filename,
            sizeMB: validation.sizeMB,
            modelObject: modelObject.name || modelObject.type,
            modelRoot: modelRoot.name || modelRoot.type,
            modelDetectionStrategy: detected.strategy,
            exportTreeMeshes: meshCount(modelRoot),
            exportTreeVertices: vertexCount(modelRoot),
            sourceBones: rig.boneCount,
            sourceAnimationClips: animation.clips.length,
            exportedMeshes: validation.meshCount,
            exportedNodes: validation.nodeCount,
            exportedSkins: validation.skinCount,
            exportedAnimations: validation.animationCount,
            runtimeThreeRevision: modules.runtimeRevision,
            exporterThreeRevision: modules.exporterRevision,
        };
    } catch (error) {
        console.error('');
        console.error('================================================');
        console.error('             ✗ EXPORT FAILED');
        console.error('================================================');
        console.error(error);
        if (error?.cause) console.error('Cause:', error.cause);
        console.error('');
        console.error('Try:');
        console.error('1. Reload the Tripo Studio model page.');
        console.error('2. Wait until the complete 3D model is visible.');
        console.error('3. Run the exporter again.');
        console.error('4. If model detection is the failure, inspect the MODEL TREE printed above.');
        console.error('5. If GLB validation reports missing skins/animations, inspect the source rig/animation section.');
        console.error('================================================');
        throw error;
    }
})();
