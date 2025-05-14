import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.175.0/build/three.module.js';

const posePairs = [];   // 페어 저장용 배열
const intrinsicsMatrix = [[500, 0, 320], [0, 500, 240], [0, 0, 1]];

let xrSession = null;
let xrReferenceSpace = null;
let renderer = null;
let scene = null;
let cubesAdded = [false, false, false, false]; // 이미지별 중복 방지

// AR 세션 시작
document.getElementById('start-ar').addEventListener('click', async () => {
    const imgIds = ["marker-1", "marker-2", "marker-3", "marker-4"];
    const imageBitmaps = [];

    for (const id of imgIds) {
        const img = document.getElementById(id);
        if (!img.complete || img.naturalWidth === 0) {
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
            });
        }
        imageBitmaps.push(await createImageBitmap(img));
    }

    const trackedImages = imageBitmaps.map(bitmap => ({ image: bitmap, widthInMeters: 0.2 }));

    try {
        xrSession = await navigator.xr.requestSession("immersive-ar", {
            requiredFeatures: ["local", "hit-test", "camera-access", "image-tracking"],
            trackedImages,
            optionalFeatures: ["dom-overlay"],
            domOverlay: { root: document.body }
        });

        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.xr.enabled = true;
        renderer.xr.setReferenceSpaceType('local');
        document.body.appendChild(renderer.domElement);
        await renderer.xr.setSession(xrSession);

        xrReferenceSpace = await xrSession.requestReferenceSpace("local");

        scene = new THREE.Scene();
        scene.background = null;

        // 경로 정의 (마커 index 기준)
        const markerPaths = [
            [ // Marker 0
                [0, 0, 0],
                [-0.1, -0.1, 0],
                [0, 0, -0.5],
                [0.2, 0, -1.0],
                [0.4, 0, -1.5]
            ],
            [ // Marker 1
                [0, 0, 0],
                [0.1, 0, -0.3],
                [0.3, 0, -0.7],
                [0.5, 0, -1.2]
            ],
            [ // Marker 2
                [0, 0, 0],
                [-0.2, 0.1, -0.2],
                [-0.3, 0.1, -0.8]
            ],
            [ // Marker 3
                [0, 0, 0],
                [0.15, -0.05, -0.2],
                [0.25, -0.1, -0.6],
                [0.35, -0.1, -1.0]
            ]
        ];

        // 애니메이션 루프
        renderer.setAnimationLoop((timestamp, xrFrame) => {
            if (!xrFrame || !xrReferenceSpace) return;

            const results = xrFrame.getImageTrackingResults();
            for (const result of results) {
                const pose = xrFrame.getPose(result.imageSpace, xrReferenceSpace);
                const idx = result.index;

                if (pose && result.trackingState === "tracked" && !cubesAdded[idx]) {
                    const base = pose.transform.position;
                    const nodePositions = markerPaths[idx].map(offset =>
                        new THREE.Vector3(
                            base.x + offset[0],
                            base.y + offset[1],
                            base.z + offset[2]
                        )
                    );

                    nodePositions.forEach((pos, i) => {
                        const color = i === 0 ? 0x00ff00 : (i === nodePositions.length - 1 ? 0xff0000 : 0xffff00);
                        const cube = new THREE.Mesh(
                            new THREE.BoxGeometry(0.15, 0.15, 0.15),
                            new THREE.MeshBasicMaterial({ color })
                        );
                        cube.position.copy(pos);
                        scene.add(cube);
                    });

                    for (let i = 0; i < nodePositions.length - 1; i++) {
                        const from = nodePositions[i];
                        const to = nodePositions[i + 1];
                        const direction = new THREE.Vector3().subVectors(to, from).normalize();
                        const length = from.distanceTo(to);
                        const arrow = new THREE.ArrowHelper(direction, from, length, 0x0000ff);
                        scene.add(arrow);
                    }

                    const pathGeometry = new THREE.BufferGeometry().setFromPoints(nodePositions);
                    const pathLine = new THREE.Line(
                        pathGeometry,
                        new THREE.LineBasicMaterial({ color: 0xffffff })
                    );
                    scene.add(pathLine);

                    cubesAdded[idx] = true;
                }
            }

            const viewerPose = xrFrame.getViewerPose(xrReferenceSpace);
            if (viewerPose) {
                const camera = renderer.xr.getCamera();
                renderer.render(scene, camera);
            }
        });

    } catch (err) {
        console.error("AR 세션 시작 실패:", err);
        alert("AR 세션을 시작할 수 없습니다: " + err.message);
    }
});
