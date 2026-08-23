(async function exportTripoModelWithAnimation() {

    console.clear();

    console.log("================================================");
    console.log("   TRIPO MODEL + RIG + ANIMATION GLB EXPORTER");
    console.log("================================================");


    // ============================================================
    // 1. FIND VUE APP
    // ============================================================

    const appEl =
        document.querySelector('[data-v-app]') ||
        document.querySelector('#__nuxt');

    if (!appEl || !appEl.__vue_app__) {
        throw new Error(
            "Vue app not found. Open the Tripo Studio model page first."
        );
    }

    const vueApp = appEl.__vue_app__;

    console.log("✓ Vue application found");


    // ============================================================
    // 2. FIND PAGE
    // ============================================================

    const router =
        vueApp.config.globalProperties.$router;

    const route =
        router.currentRoute.value;

    const matched =
        route.matched?.[0];

    if (!matched) {
        throw new Error("Current route not found.");
    }

    const pageInternal =
        matched.instances?.default?._;

    if (!pageInternal) {
        throw new Error(
            "Page component instance not found."
        );
    }

    console.log("✓ Page component found");


    // ============================================================
    // 3. FIND TRES CONTEXT
    // ============================================================

    function findContext(vnode, depth = 0) {

        if (!vnode || depth > 60) {
            return null;
        }

        if (vnode.component) {

            const component =
                vnode.component;

            const name =
                component.type?.name ||
                component.type?.__name ||
                "";

            if (name === "Context") {
                return component;
            }

            const found =
                findContext(
                    component.subTree,
                    depth + 1
                );

            if (found) {
                return found;
            }
        }

        if (Array.isArray(vnode.children)) {

            for (const child of vnode.children) {

                const found =
                    findContext(
                        child,
                        depth + 1
                    );

                if (found) {
                    return found;
                }
            }
        }

        return null;
    }


    const context =
        findContext(
            pageInternal.subTree
        );

    if (!context) {
        throw new Error(
            "TresJS Context not found."
        );
    }

    console.log("✓ TresJS Context found");


    // ============================================================
    // 4. GET THREE.JS SCENE
    // ============================================================

    const useTres =
        context.provides?.useTres;

    if (!useTres) {
        throw new Error(
            "useTres not found."
        );
    }

    const scene =
        useTres.scene?.value ??
        useTres.scene;

    if (!scene || !scene.isScene) {
        throw new Error(
            "Three.js scene not found."
        );
    }

    console.log("✓ Three.js scene found");


    // ============================================================
    // 5. FIND TRIPO MODEL
    // ============================================================

    let tripoMesh = null;

    scene.traverse((object) => {

        if (
            object.isMesh &&
            typeof object.name === "string" &&
            object.name.startsWith("tripo_node_")
        ) {

            if (!tripoMesh) {
                tripoMesh = object;
            }
        }
    });


    if (!tripoMesh) {
        throw new Error(
            "tripo_node_* model not found."
        );
    }

    console.log(
        "✓ Tripo model found:",
        tripoMesh.name
    );


    // ============================================================
    // 6. DETECT SKELETON / RIG
    // ============================================================

    const skinnedMeshes = [];
    const bones = [];

    scene.traverse((object) => {

        if (object.isSkinnedMesh) {
            skinnedMeshes.push(object);
        }

        if (object.isBone) {
            bones.push(object);
        }
    });


    console.log("");
    console.log("--------------------------------------------");
    console.log("RIG INFORMATION");
    console.log("--------------------------------------------");

    console.log(
        "Skinned meshes:",
        skinnedMeshes.length
    );

    console.log(
        "Bones:",
        bones.length
    );


    if (skinnedMeshes.length) {
        console.log("✓ Skeleton detected");
    } else {
        console.log(
            "⚠ No SkinnedMesh detected"
        );
    }


    if (bones.length) {
        console.log("✓ Bones detected");
    } else {
        console.log(
            "⚠ No bones detected"
        );
    }


    // ============================================================
    // 7. FIND ANIMATION CLIPS
    // ============================================================

    const animationClips = [];
    const animationSources = [];


    function addAnimationClip(clip, source) {

        if (!clip) {
            return;
        }

        // Single AnimationClip
        if (
            typeof clip === "object" &&
            clip.name &&
            Array.isArray(clip.tracks)
        ) {

            if (!animationClips.includes(clip)) {

                animationClips.push(clip);

                animationSources.push({
                    clip,
                    source
                });
            }

            return;
        }

        // Array of clips
        if (Array.isArray(clip)) {

            for (const item of clip) {

                addAnimationClip(
                    item,
                    source
                );
            }
        }
    }


    // ------------------------------------------------------------
    // Scene-level animations
    // ------------------------------------------------------------

    addAnimationClip(
        scene.animations,
        "scene.animations"
    );


    // ------------------------------------------------------------
    // Model-level animations
    // ------------------------------------------------------------

    addAnimationClip(
        tripoMesh.animations,
        "tripoMesh.animations"
    );


    // ------------------------------------------------------------
    // Search every object
    // ------------------------------------------------------------

    scene.traverse((object) => {

        addAnimationClip(
            object.animations,
            `${object.name || object.type}.animations`
        );


        // Some applications store animation data in userData
        if (object.userData) {

            addAnimationClip(
                object.userData.animations,
                `${object.name || object.type}.userData.animations`
            );

            addAnimationClip(
                object.userData.animationClips,
                `${object.name || object.type}.userData.animationClips`
            );
        }
    });


    // ------------------------------------------------------------
    // Search scene userData
    // ------------------------------------------------------------

    if (scene.userData) {

        addAnimationClip(
            scene.userData.animations,
            "scene.userData.animations"
        );

        addAnimationClip(
            scene.userData.animationClips,
            "scene.userData.animationClips"
        );
    }


    // ============================================================
    // 8. SEARCH ANIMATION MIXERS
    // ============================================================

    const possibleMixers = [];


    function scanForMixers(obj, depth = 0) {

        if (
            !obj ||
            typeof obj !== "object" ||
            depth > 20
        ) {
            return;
        }


        if (
            obj.constructor?.name ===
            "AnimationMixer"
        ) {

            possibleMixers.push(obj);
        }


        const keys = [
            "mixer",
            "animationMixer",
            "_mixer"
        ];


        for (const key of keys) {

            try {

                const value =
                    obj[key];

                if (
                    value &&
                    value.constructor?.name ===
                    "AnimationMixer"
                ) {

                    possibleMixers.push(value);
                }

            } catch (_) {}
        }
    }


    scanForMixers(scene);
    scanForMixers(tripoMesh);


    console.log(
        "Possible animation mixers:",
        possibleMixers.length
    );


    // ------------------------------------------------------------
    // Read clips from mixer actions
    // ------------------------------------------------------------

    for (const mixer of possibleMixers) {

        try {

            const actions =
                mixer._actions || [];

            for (const action of actions) {

                if (action?._clip) {

                    addAnimationClip(
                        action._clip,
                        "AnimationMixer"
                    );
                }
            }

        } catch (error) {

            console.warn(
                "Could not inspect mixer:",
                error
            );
        }
    }


    // Remove duplicate clips
    const uniqueClips = [];

    const clipNames =
        new Set();


    for (const clip of animationClips) {

        const key =
            `${clip.name}:${clip.duration}:${clip.tracks.length}`;

        if (!clipNames.has(key)) {

            clipNames.add(key);

            uniqueClips.push(clip);
        }
    }


    console.log("");
    console.log("--------------------------------------------");
    console.log("ANIMATIONS");
    console.log("--------------------------------------------");

    console.log(
        "Animation clips found:",
        uniqueClips.length
    );


    uniqueClips.forEach((clip, index) => {

        console.log(
            `[${index + 1}]`,
            clip.name || "(unnamed)",
            "| duration:",
            clip.duration.toFixed(3),
            "seconds",
            "| tracks:",
            clip.tracks.length
        );
    });


    if (!uniqueClips.length) {

        console.warn(
            "⚠ No AnimationClip data was found in the loaded scene."
        );

        console.warn(
            "The exported GLB will contain the model/rig if available, but no animation."
        );
    }


    // ============================================================
    // 9. MODEL GEOMETRY
    // ============================================================

    const geometry =
        tripoMesh.geometry;

    const position =
        geometry.attributes?.position;

    console.log("");
    console.log("--------------------------------------------");
    console.log("MODEL");
    console.log("--------------------------------------------");

    console.log(
        "Vertices:",
        position?.count || 0
    );

    console.log(
        "Geometry groups:",
        geometry.groups?.length || 0
    );


    // ============================================================
    // 10. MATERIALS
    // ============================================================

    const materials =
        Array.isArray(tripoMesh.material)
            ? tripoMesh.material
            : [tripoMesh.material];


    console.log(
        "Materials:",
        materials.length
    );


    // ============================================================
    // 11. LOAD GLTF EXPORTER
    // ============================================================

    console.log("");
    console.log(
        "Loading GLTFExporter..."
    );


    let GLTFExporter;


    try {

        const module =
            await import(
                "https://esm.sh/three@0.183.1/examples/jsm/exporters/GLTFExporter.js"
            );

        GLTFExporter =
            module.GLTFExporter;

    } catch (error) {

        console.error(error);

        throw new Error(
            "Could not load GLTFExporter."
        );
    }


    console.log(
        "✓ GLTFExporter loaded"
    );


    // ============================================================
    // 12. CREATE EXPORT SCENE
    // ============================================================

    const ExportScene =
        new scene.constructor();

    ExportScene.name =
        "Tripo_Complete_Model";


    // ============================================================
    // 13. CLONE MODEL
    // ============================================================

    tripoMesh.updateWorldMatrix(
        true,
        false
    );


    const modelClone =
        tripoMesh.clone(true);


    modelClone.matrix.copy(
        tripoMesh.matrixWorld
    );

    modelClone.matrixAutoUpdate =
        false;


    modelClone.geometry =
        tripoMesh.geometry;

    modelClone.material =
        tripoMesh.material;


    modelClone.name =
        "Tripo_Model";


    ExportScene.add(
        modelClone
    );


    console.log(
        "✓ Model added to export scene"
    );


    // ============================================================
    // 14. EXPORT
    // ============================================================

    const exporter =
        new GLTFExporter();


    const options = {

        binary: true,

        onlyVisible: false,

        trs: false,

        includeCustomExtensions: true,

        /*
         * THIS IS THE IMPORTANT PART:
         *
         * Pass detected AnimationClips to GLTFExporter.
         */

        animations:
            uniqueClips
    };


    console.log("");
    console.log("--------------------------------------------");
    console.log("EXPORT");
    console.log("--------------------------------------------");

    console.log(
        "Animations being exported:",
        options.animations.length
    );


    const glb =
        await new Promise(
            (resolve, reject) => {

                exporter.parse(

                    ExportScene,

                    (result) => {

                        if (
                            result instanceof ArrayBuffer
                        ) {

                            resolve(result);

                        } else {

                            reject(
                                new Error(
                                    "Exporter did not return a GLB."
                                )
                            );
                        }
                    },

                    (error) => {

                        reject(error);
                    },

                    options
                );
            }
        );


    // ============================================================
    // 15. VALIDATE GLB
    // ============================================================

    const view =
        new DataView(glb);


    const magic =
        view.getUint32(
            0,
            true
        );


    if (
        magic !== 0x46546c67
    ) {

        throw new Error(
            "Invalid GLB generated."
        );
    }


    const sizeMB =
        (
            glb.byteLength /
            1024 /
            1024
        ).toFixed(2);


    // ============================================================
    // 16. DOWNLOAD
    // ============================================================

    const blob =
        new Blob(
            [glb],
            {
                type:
                    "model/gltf-binary"
            }
        );


    const url =
        URL.createObjectURL(blob);


    const link =
        document.createElement("a");


    link.href =
        url;


    link.download =
        "tripo_model_rig_animation.glb";


    document.body.appendChild(
        link
    );


    link.click();

    link.remove();


    setTimeout(
        () => URL.revokeObjectURL(url),
        30000
    );


    // ============================================================
    // DONE
    // ============================================================

    console.log("");
    console.log("================================================");
    console.log("             ✓ EXPORT COMPLETE");
    console.log("================================================");

    console.log(
        "File:",
        "tripo_model_rig_animation.glb"
    );

    console.log(
        "Size:",
        `${sizeMB} MB`
    );

    console.log(
        "Vertices:",
        position?.count || 0
    );

    console.log(
        "Skinned meshes:",
        skinnedMeshes.length
    );

    console.log(
        "Bones:",
        bones.length
    );

    console.log(
        "Animation clips:",
        uniqueClips.length
    );

    console.log("================================================");


})();
