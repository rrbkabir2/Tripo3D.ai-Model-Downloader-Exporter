(async function exportTripoModelUpgraded() {
    'use strict';

    const CONFIG = Object.freeze({
        maxVNodeDepth: 80,
        maxObjectDepth: 24,
        defaultThreeRevision: '183',
        downloadFilename: 'tripo_model_rig_animation.glb',
        revokeDelayMs: 30_000,
        importerBase: 'https://esm.sh/three@'
    });

    const log = (...args) => console.log('[tripo-export]', ...args);
    const warn = (...args) => console.warn('[tripo-export]', ...args);
    const fail = (message, cause) => {
        const error = new Error(message);
        if (cause) error.cause = cause;
        throw error;
    };

    const isAnimationClip = (value) =>
        !!value && typeof value === 'object' &&
        typeof value.name === 'string' &&
        Array.isArray(value.tracks) &&
        typeof value.duration === 'number';

    const isAnimationMixer = (value) =>
        !!value && typeof value === 'object' &&
        value.constructor?.name === 'AnimationMixer';

    function addUnique(list, value) {
        if (value && !list.includes(value)) list.push(value);
    }

    function collectClips(value, source, entries, seen = new Set()) {
        if (!value || seen.has(value)) return;
        if (typeof value === 'object') seen.add(value);

        if (isAnimationClip(value)) {
            addUnique(entries, { clip: value, source });
            return;
        }

        if (Array.isArray(value)) {
            for (const item of value) collectClips(item, source, entries, seen);
        }
    }

    function clipKey(clip) {
        const trackNames = Array.isArray(clip.tracks)
            ? clip.tracks.map(track => track?.name || '').join('|')
            : '';
        return [
            clip.name || '(unnamed)',
            Number.isFinite(clip.duration) ? clip.duration.toFixed(6) : 'NaN',
            clip.tracks?.length ?? 0,
            trackNames
        ].join('::');
    }

    function findContext(vnode, depth = 0, visited = new Set()) {
        if (!vnode || depth > CONFIG.maxVNodeDepth || typeof vnode !== 'object') return null;
        if (visited.has(vnode)) return null;
        visited.add(vnode);

        if (vnode.component) {
            const component = vnode.component;
            const name = component.type?.name || component.type?.__name || '';
            if (name === 'Context') return component;

            const found = findContext(component.subTree, depth + 1, visited);
            if (found) return found;
        }

        if (Array.isArray(vnode.children)) {
            for (const child of vnode.children) {
                const found = findContext(child, depth + 1, visited);
                if (found) return found;
            }
        }

        return null;
    }

    function getVuePageInternal(vueApp) {
        const router = vueApp?.config?.globalProperties?.$router;
        const route = router?.currentRoute?.value;
        if (!route) fail('Current Vue route is unavailable. Reload the Tripo Studio model page and try again.');

        const matched = route.matched?.[0];
        if (!matched) fail('No matched Vue route was found. Make sure a Tripo Studio model page is open.');

        const pageInternal = matched.instances?.default?._;
        if (!pageInternal) fail('The current page component instance could not be inspected.');
        return pageInternal;
    }

    function findVueApp() {
        const appEl =
            document.querySelector('[data-v-app]') ||
            document.querySelector('#__nuxt');

        if (!appEl?.__vue_app__) {
            fail('Vue application not found. Open a Tripo Studio model page and wait until it finishes loading.');
        }
        return appEl.__vue_app__;
    }

    function getThreeScene(vueApp) {
        const pageInternal = getVuePageInternal(vueApp);
        const context = findContext(pageInternal.subTree);
        if (!context) fail('TresJS Context was not found. Tripo Studio may have changed its Vue/TresJS structure.');

        const useTres = context.provides?.useTres;
        if (!useTres) fail('TresJS useTres provider was not found.');

        const scene = useTres.scene?.value ?? useTres.scene;
        if (!scene?.isScene) fail('A valid Three.js Scene was not found. Wait for the 3D viewer to finish loading.');

        return { scene, context };
    }

    function collectObjects(scene) {
        const objects = [];
        scene.traverse(object => objects.push(object));
        return objects;
    }

    function scoreModelCandidate(object) {
        let score = 0;
        const name = String(object?.name || '').toLowerCase();
        const geometry = object?.geometry;
        const positionCount = geometry?.attributes?.position?.count || 0;

        if (object?.isSkinnedMesh) score += 1000;
        if (object?.isMesh) score += 300;
        if (name.startsWith('tripo_node_')) score += 5000;
        else if (name.includes('tripo')) score += 1000;
        if (geometry?.attributes?.position) score += 100;
        score += Math.min(positionCount / 1000, 500);

        // Strongly penalize common viewer/editor helpers.
        const blocked = ['transform', 'gizmo', 'helper', 'control', 'grid', 'axis', 'camera', 'light'];
        if (blocked.some(token => name.includes(token))) score -= 5000;

        return score;
    }

    function findModelObject(scene) {
        const objects = collectObjects(scene);
        const explicit = objects
            .filter(object => object?.isObject3D && typeof object.name === 'string' && object.name.startsWith('tripo_node_'))
            .sort((a, b) => scoreModelCandidate(b) - scoreModelCandidate(a));

        if (explicit.length) return { object: explicit[0], strategy: 'tripo_node_* name' };

        const candidates = objects
            .filter(object => object?.isMesh || object?.isSkinnedMesh)
            .filter(object => !/camera|light|helper|gizmo|control|grid|axis/i.test(object.name || ''))
            .sort((a, b) => scoreModelCandidate(b) - scoreModelCandidate(a));

        if (!candidates.length) {
            fail('No plausible model mesh was found. The model may not be loaded, or Tripo may have changed its internal scene structure.');
        }

        return { object: candidates[0], strategy: 'scored mesh fallback' };
    }

    function collectRigInfo(scene, modelObject) {
        const skinnedMeshes = [];
        const bones = [];
        const skeletons = [];

        scene.traverse(object => {
            if (object?.isSkinnedMesh) addUnique(skinnedMeshes, object);
            if (object?.isBone) addUnique(bones, object);
            if (object?.skeleton) addUnique(skeletons, object.skeleton);
        });

        const modelIsSkinned = !!modelObject?.isSkinnedMesh;
        const hasSkinAttributes = !!modelObject?.geometry?.attributes?.skinIndex && !!modelObject?.geometry?.attributes?.skinWeight;

        return { skinnedMeshes, bones, skeletons, modelIsSkinned, hasSkinAttributes };
    }

    function collectAnimationData(scene, modelObject) {
        const entries = [];
        const mixers = [];
        const objects = collectObjects(scene);

        collectClips(scene.animations, 'scene.animations', entries);
        collectClips(modelObject.animations, 'model.animations', entries);

        for (const object of objects) {
            collectClips(object.animations, `${object.name || object.type}.animations`, entries);
            collectClips(object.userData?.animations, `${object.name || object.type}.userData.animations`, entries);
            collectClips(object.userData?.animationClips, `${object.name || object.type}.userData.animationClips`, entries);
        }

        // Keep private Three.js access isolated to this compatibility layer.
        const mixerCandidates = [scene, modelObject];
        for (const object of objects) mixerCandidates.push(object);

        const visited = new Set();
        for (const object of mixerCandidates) {
            if (!object || visited.has(object)) continue;
            visited.add(object);

            if (isAnimationMixer(object)) addUnique(mixers, object);
            for (const key of ['mixer', 'animationMixer', '_mixer']) {
                try {
                    const value = object[key];
                    if (isAnimationMixer(value)) addUnique(mixers, value);
                } catch (_) {}
            }
        }

        for (const mixer of mixers) {
            try {
                for (const action of mixer._actions || []) {
                    if (action?._clip) collectClips(action._clip, 'AnimationMixer._actions', entries);
                }
            } catch (error) {
                warn('Could not inspect one AnimationMixer:', error);
            }
        }

        const unique = [];
        const keys = new Set();
        for (const entry of entries) {
            const clip = entry.clip;
            if (!isAnimationClip(clip)) continue;
            if (!clip.tracks.length) continue;
            if (!Number.isFinite(clip.duration) || clip.duration < 0) continue;

            const key = clipKey(clip);
            if (!keys.has(key)) {
                keys.add(key);
                unique.push(entry);
            }
        }

        return { clips: unique.map(entry => entry.clip), entries: unique, mixers };
    }

    function getRuntimeThreeRevision() {
        const revision = globalThis.THREE?.REVISION;
        if (revision && /^\d+(?:\.\d+)?$/.test(String(revision))) return String(revision);

        // Some bundled applications do not expose THREE globally. The source
        // project was tested with r183, so keep a documented fallback.
        return CONFIG.defaultThreeRevision;
    }

    async function loadExporterModules() {
        const revision = getRuntimeThreeRevision();
        const base = `${CONFIG.importerBase}${revision}`;
        let module;

        try {
            module = await import(`${base}/examples/jsm/exporters/GLTFExporter.js`);
        } catch (firstError) {
            if (revision !== CONFIG.defaultThreeRevision) {
                warn(`GLTFExporter import for Three.js r${revision} failed; retrying r${CONFIG.defaultThreeRevision}.`, firstError);
                module = await import(`${CONFIG.importerBase}${CONFIG.defaultThreeRevision}/examples/jsm/exporters/GLTFExporter.js`);
            } else {
                throw firstError;
            }
        }

        if (!module?.GLTFExporter) fail('GLTFExporter module loaded but did not expose GLTFExporter.');

        let skeletonUtils = null;
        try {
            skeletonUtils = await import(`${base}/examples/jsm/utils/SkeletonUtils.js`);
        } catch (error) {
            warn('SkeletonUtils could not be loaded. Falling back to normal Object3D cloning.', error);
        }

        return {
            GLTFExporter: module.GLTFExporter,
            skeletonClone: skeletonUtils?.clone || null,
            revision
        };
    }

    function getAncestors(object) {
        const ancestors = [];
        let current = object;
        while (current) {
            ancestors.push(current);
            current = current.parent;
        }
        return ancestors;
    }

    function findLowestCommonAncestor(objects) {
        if (!objects.length) return null;
        const firstPath = getAncestors(objects[0]);
        const otherSets = objects.slice(1).map(object => new Set(getAncestors(object)));

        for (const candidate of firstPath) {
            if (otherSets.every(set => set.has(candidate))) return candidate;
        }
        return null;
    }

    function chooseExportRoot(modelObject) {
        // For a SkinnedMesh, the skeleton bones may be siblings/ancestors rather
        // than children of the mesh. Exporting only the mesh can therefore lose
        // the bone hierarchy. Prefer the smallest common ancestor containing the
        // selected mesh and its skeleton bones.
        if (modelObject.isSkinnedMesh && modelObject.skeleton?.bones?.length) {
            const bones = modelObject.skeleton.bones.filter(Boolean);
            const lca = findLowestCommonAncestor([modelObject, ...bones]);

            if (lca && lca !== modelObject && !lca.isScene) {
                return { root: lca, strategy: 'model+skeleton lowest common ancestor' };
            }

            if (lca?.isScene) {
                warn('Model and skeleton only share the Scene as a common ancestor; exporting only the selected SkinnedMesh to avoid viewer helpers.');
            }
        }

        return { root: modelObject, strategy: 'selected model object' };
    }

    function cloneForExport(modelObject, skeletonClone) {
        modelObject.updateWorldMatrix(true, true);

        let clone;
        if (modelObject.isSkinnedMesh && skeletonClone) {
            clone = skeletonClone(modelObject);
        } else {
            clone = modelObject.clone(true);
        }

        if (!clone) fail('Model cloning returned no object.');

        clone.name = 'Tripo_Model';
        clone.updateMatrixWorld(true);

        return clone;
    }

    function validateSourceModel(modelObject) {
        const geometry = modelObject.geometry;
        const position = geometry?.attributes?.position;
        if (!position || position.count === 0) {
            fail(`Selected model "${modelObject.name || modelObject.type}" has no position attribute. It may not be the actual model.`);
        }

        if (modelObject.isSkinnedMesh) {
            const skinIndex = geometry.attributes?.skinIndex;
            const skinWeight = geometry.attributes?.skinWeight;
            if (!skinIndex || !skinWeight) {
                warn('Model is a SkinnedMesh but its geometry has no skinIndex/skinWeight attributes.');
            }
        }
    }

    function validateGLB(buffer, expected) {
        if (!(buffer instanceof ArrayBuffer)) fail('GLTFExporter did not return an ArrayBuffer.');
        if (buffer.byteLength < 20) fail('Generated GLB is too small to contain a valid GLB header.');

        const view = new DataView(buffer);
        const magic = view.getUint32(0, true);
        const version = view.getUint32(4, true);
        const declaredLength = view.getUint32(8, true);

        if (magic !== 0x46546c67) fail('Generated GLB has an invalid magic header.');
        if (version !== 2) fail(`Generated GLB uses unsupported version ${version}; expected GLB 2.`);
        if (declaredLength !== buffer.byteLength) {
            fail(`Generated GLB length mismatch: header=${declaredLength}, actual=${buffer.byteLength}.`);
        }

        let offset = 12;
        let jsonFound = false;
        let binFound = false;

        while (offset + 8 <= buffer.byteLength) {
            const chunkLength = view.getUint32(offset, true);
            const chunkType = view.getUint32(offset + 4, true);
            offset += 8;

            if (chunkLength % 4 !== 0 || offset + chunkLength > buffer.byteLength) {
                fail('Generated GLB contains an invalid chunk boundary.');
            }

            if (chunkType === 0x4E4F534A) jsonFound = true; // JSON
            if (chunkType === 0x004E4942) binFound = true;   // BIN\0
            offset += chunkLength;
        }

        if (offset !== buffer.byteLength) fail('Generated GLB has trailing bytes outside its declared chunks.');
        if (!jsonFound) fail('Generated GLB has no JSON chunk.');
        if (!binFound) warn('Generated GLB has no BIN chunk. This may be valid for a resource-light file, but verify the output.');

        if (expected.skinned && !expected.animations && expected.bones > 0) {
            warn('Source contained rigging but no animation clips were detected; the GLB may be rigged but static.');
        }

        return {
            sizeBytes: buffer.byteLength,
            sizeMB: (buffer.byteLength / 1024 / 1024).toFixed(2),
            jsonFound,
            binFound
        };
    }

    function downloadGLB(buffer, filename) {
        const blob = new Blob([buffer], { type: 'model/gltf-binary' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), CONFIG.revokeDelayMs);
        return blob.size;
    }

    async function exportWithGLTFExporter(GLTFExporter, exportScene, clips) {
        const exporter = new GLTFExporter();
        const options = {
            binary: true,
            onlyVisible: false,
            trs: false,
            includeCustomExtensions: true,
            animations: clips
        };

        return await new Promise((resolve, reject) => {
            try {
                exporter.parse(
                    exportScene,
                    result => {
                        if (result instanceof ArrayBuffer) resolve(result);
                        else reject(new Error('GLTFExporter returned a non-binary result even though binary=true.'));
                    },
                    error => reject(error instanceof Error ? error : new Error(String(error))),
                    options
                );
            } catch (error) {
                reject(error);
            }
        });
    }

    function summarizeMaterials(modelObject) {
        const materials = Array.isArray(modelObject.material)
            ? modelObject.material.filter(Boolean)
            : [modelObject.material].filter(Boolean);

        const summary = materials.map(material => ({
            type: material.type,
            name: material.name || '(unnamed)',
            map: !!material.map,
            normalMap: !!material.normalMap,
            roughnessMap: !!material.roughnessMap,
            metalnessMap: !!material.metalnessMap,
            transparent: !!material.transparent,
            alphaTest: material.alphaTest || 0
        }));

        return { materials, summary };
    }

    try {
        console.clear();
        console.log('================================================');
        console.log('   TRIPO MODEL + RIG + ANIMATION GLB EXPORTER');
        console.log('   upgraded exporter');
        console.log('================================================');

        const vueApp = findVueApp();
        log('✓ Vue application found');

        const { scene } = getThreeScene(vueApp);
        log('✓ TresJS Context / Three.js scene found');
        log('Scene children:', scene.children.length);

        const { object: modelObject, strategy } = findModelObject(scene);
        validateSourceModel(modelObject);
        log(`✓ Model found via ${strategy}:`, modelObject.name || modelObject.type);

        const geometry = modelObject.geometry;
        const position = geometry.attributes.position;
        const rig = collectRigInfo(scene, modelObject);
        const animation = collectAnimationData(scene, modelObject);
        const materials = summarizeMaterials(modelObject);

        console.log('');
        console.log('--------------------------------------------');
        console.log('SOURCE MODEL');
        console.log('--------------------------------------------');
        console.log('Name:', modelObject.name || '(unnamed)');
        console.log('Type:', modelObject.type);
        console.log('Vertices:', position.count);
        console.log('Indices:', geometry.index?.count || 0);
        console.log('Geometry groups:', geometry.groups?.length || 0);
        console.log('Materials:', materials.materials.length);
        console.log('Skin attributes:', !!geometry.attributes.skinIndex && !!geometry.attributes.skinWeight);
        console.log('');

        console.log('--------------------------------------------');
        console.log('RIG INFORMATION');
        console.log('--------------------------------------------');
        console.log('Skinned meshes in scene:', rig.skinnedMeshes.length);
        console.log('Bones in scene:', rig.bones.length);
        console.log('Skeleton objects:', rig.skeletons.length);
        console.log('Selected model is SkinnedMesh:', rig.modelIsSkinned);

        if (rig.skinnedMeshes.length) log('✓ SkinnedMesh detected');
        else warn('No SkinnedMesh detected in the loaded scene.');
        if (rig.bones.length) log('✓ Bones detected');
        else warn('No bones detected in the loaded scene.');

        console.log('');
        console.log('--------------------------------------------');
        console.log('ANIMATIONS');
        console.log('--------------------------------------------');
        console.log('Animation mixers found:', animation.mixers.length);
        console.log('Animation clips found:', animation.clips.length);

        animation.entries.forEach((entry, index) => {
            const clip = entry.clip;
            console.log(
                `[${index + 1}]`,
                clip.name || '(unnamed)',
                '| duration:',
                Number.isFinite(clip.duration) ? clip.duration.toFixed(3) : 'NaN',
                'seconds | tracks:',
                clip.tracks.length,
                '| source:',
                entry.source
            );
        });

        if (!animation.clips.length) {
            warn('No valid AnimationClip data was found. The export will contain no animation unless the exporter discovers animation data through another supported path.');
        }

        console.log('');
        console.log('--------------------------------------------');
        console.log('LOADING EXPORT MODULES');
        console.log('--------------------------------------------');

        const { GLTFExporter, skeletonClone, revision } = await loadExporterModules();
        log(`✓ GLTFExporter loaded for Three.js r${revision}`);
        if (modelObject.isSkinnedMesh && skeletonClone) log('✓ SkeletonUtils available for SkinnedMesh cloning');

        const exportScene = new scene.constructor();
        exportScene.name = 'Tripo_Complete_Model';

        const exportRootInfo = chooseExportRoot(modelObject);
        const exportRoot = exportRootInfo.root;
        const modelClone = cloneForExport(exportRoot, skeletonClone);
        exportScene.add(modelClone);
        modelClone.updateMatrixWorld(true);

        log('✓ Export scene prepared');
        log('Export root strategy:', exportRootInfo.strategy);

        console.log('');
        console.log('--------------------------------------------');
        console.log('EXPORT');
        console.log('--------------------------------------------');
        console.log('Animations being exported:', animation.clips.length);
        console.log('Source model:', modelObject.name || modelObject.type);

        const glb = await exportWithGLTFExporter(GLTFExporter, exportScene, animation.clips);

        const validation = validateGLB(glb, {
            skinned: rig.skinnedMeshes.length > 0 || rig.modelIsSkinned,
            bones: rig.bones.length,
            animations: animation.clips.length > 0
        });

        const filename = CONFIG.downloadFilename;
        downloadGLB(glb, filename);

        console.log('');
        console.log('================================================');
        console.log('             ✓ EXPORT COMPLETE');
        console.log('================================================');
        console.log('File:', filename);
        console.log('Size:', `${validation.sizeMB} MB`);
        console.log('Vertices:', position.count);
        console.log('Skinned meshes:', rig.skinnedMeshes.length);
        console.log('Bones:', rig.bones.length);
        console.log('Animation clips:', animation.clips.length);
        console.log('GLB JSON chunk:', validation.jsonFound ? '✓' : '✗');
        console.log('GLB BIN chunk:', validation.binFound ? '✓' : '⚠');
        console.log('================================================');

        return {
            filename,
            sizeMB: validation.sizeMB,
            vertices: position.count,
            indices: geometry.index?.count || 0,
            skinnedMeshes: rig.skinnedMeshes.length,
            bones: rig.bones.length,
            animations: animation.clips.length,
            threeRevision: revision,
            modelDetectionStrategy: strategy
        };
    } catch (error) {
        console.error('');
        console.error('================================================');
        console.error('             ✗ EXPORT FAILED');
        console.error('================================================');
        console.error(error);
        console.error('');
        console.error('Recommended checks:');
        console.error('1. Confirm the Tripo Studio model is fully loaded.');
        console.error('2. Confirm the model is available in your authorized browser session.');
        console.error('3. Inspect the first error above; it identifies the failed stage.');
        console.error('4. If Tripo changed its Vue/TresJS/Three.js structure, model detection may need another adapter.');
        console.error('================================================');
        throw error;
    }
})();
