(async function exportTripoModel() {

    console.clear();

    console.log("==============================================");
    console.log("      TRIPO COMPLETE MODEL GLB EXPORTER");
    console.log("==============================================");


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
    // 2. FIND ROUTER / PAGE
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
    // 4. GET THREE SCENE
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
    // 5. FIND ACTUAL TRIPO MODEL
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
            "tripo_node mesh not found."
        );
    }


    console.log("✓ Tripo model found");

    console.log(
        "Name:",
        tripoMesh.name
    );


    // ============================================================
    // 6. INSPECT GEOMETRY
    // ============================================================

    const geometry =
        tripoMesh.geometry;

    if (!geometry) {
        throw new Error(
            "Tripo model has no geometry."
        );
    }


    const position =
        geometry.attributes?.position;

    const normal =
        geometry.attributes?.normal;

    const uv =
        geometry.attributes?.uv;

    const index =
        geometry.index;


    console.log("");
    console.log("----------------------------------------------");
    console.log("MODEL GEOMETRY");
    console.log("----------------------------------------------");

    console.log(
        "Vertices:",
        position?.count || 0
    );

    console.log(
        "Normals:",
        normal?.count || 0
    );

    console.log(
        "UVs:",
        uv?.count || 0
    );

    console.log(
        "Indices:",
        index?.count || 0
    );


    // ============================================================
    // 7. CHECK GEOMETRY GROUPS
    // ============================================================

    console.log("");
    console.log("----------------------------------------------");
    console.log("GEOMETRY GROUPS");
    console.log("----------------------------------------------");

    console.log(
        "Groups:",
        geometry.groups?.length || 0
    );


    if (geometry.groups?.length) {

        geometry.groups.forEach(
            (group, i) => {

                console.log(
                    `[${i + 1}]`,
                    "start:",
                    group.start,
                    "count:",
                    group.count,
                    "materialIndex:",
                    group.materialIndex
                );
            }
        );
    }


    // ============================================================
    // 8. CHECK MATERIALS
    // ============================================================

    console.log("");
    console.log("----------------------------------------------");
    console.log("MATERIALS");
    console.log("----------------------------------------------");


    const materials =
        Array.isArray(tripoMesh.material)
            ? tripoMesh.material
            : [tripoMesh.material];


    console.log(
        "Material count:",
        materials.length
    );


    materials.forEach(
        (material, i) => {

            if (!material) {
                console.log(
                    `[${i + 1}] none`
                );
                return;
            }

            console.log(
                `[${i + 1}]`,
                material.name ||
                "(unnamed)",
                "|",
                material.type
            );


            if (material.map) {

                console.log(
                    "   ✓ diffuse texture"
                );
            }

            if (material.normalMap) {

                console.log(
                    "   ✓ normal map"
                );
            }

            if (material.roughnessMap) {

                console.log(
                    "   ✓ roughness map"
                );
            }

            if (material.metalnessMap) {

                console.log(
                    "   ✓ metalness map"
                );
            }
        }
    );


    // ============================================================
    // 9. LOAD GLTF EXPORTER
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

        console.error(
            "GLTFExporter loading failed:",
            error
        );

        throw new Error(
            "Could not load GLTFExporter."
        );
    }


    console.log(
        "✓ GLTFExporter loaded"
    );


    // ============================================================
    // 10. CREATE CLEAN EXPORT SCENE
    // ============================================================

    const ExportScene =
        new scene.constructor();

    ExportScene.name =
        "Tripo_Complete_Model";


    // ============================================================
    // 11. CLONE MODEL
    // ============================================================

    tripoMesh.updateWorldMatrix(
        true,
        false
    );


    const modelClone =
        tripoMesh.clone(true);


    /*
        Preserve world position / rotation / scale.
    */

    modelClone.matrix.copy(
        tripoMesh.matrixWorld
    );

    modelClone.matrixAutoUpdate =
        false;


    /*
        Explicitly preserve original geometry.
    */

    modelClone.geometry =
        tripoMesh.geometry;


    /*
        Explicitly preserve materials.
    */

    modelClone.material =
        tripoMesh.material;


    modelClone.name =
        "Tripo_Complete_Model";


    ExportScene.add(
        modelClone
    );


    console.log(
        "✓ Complete model added to export scene"
    );


    // ============================================================
    // 12. EXPORT GLB
    // ============================================================

    console.log("");
    console.log("----------------------------------------------");
    console.log("EXPORTING GLB...");
    console.log("----------------------------------------------");


    const exporter =
        new GLTFExporter();


    const options = {

        binary: true,

        onlyVisible: false,

        trs: false,

        includeCustomExtensions: true
    };


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
                                    "Exporter did not return GLB."
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
    // 13. CHECK GLB
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
            "Generated file is not a valid GLB."
        );
    }


    const sizeMB =
        (
            glb.byteLength /
            1024 /
            1024
        ).toFixed(2);


    console.log(
        "✓ Valid GLB generated"
    );

    console.log(
        "Size:",
        sizeMB,
        "MB"
    );


    // ============================================================
    // 14. DOWNLOAD
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
        "tripo_complete_model.glb";


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
    console.log("==============================================");
    console.log("             ✓ EXPORT COMPLETE");
    console.log("==============================================");

    console.log(
        "File: tripo_complete_model.glb"
    );

    console.log(
        "Vertices:",
        position?.count || 0
    );

    console.log(
        "Groups:",
        geometry.groups?.length || 0
    );

    console.log(
        "Materials:",
        materials.length
    );

    console.log(
        "Size:",
        sizeMB,
        "MB"
    );

    console.log("==============================================");


})();
