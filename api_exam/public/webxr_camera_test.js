let xrSession = null;
let gl = null;
let xrRefSpace = null;
let isCaptureRequested = false;

document.getElementById("start").addEventListener("click", async () => {
    if (!navigator.xr) {
        alert("WebXR을 지원하지 않습니다.");
        return;
    }

    try {
        xrSession = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["local", "camera-access"]
        });

        const canvas = document.createElement("canvas");
        canvas.style.width = "100vw";
        canvas.style.height = "100vh";
        document.body.appendChild(canvas);

        const ctx = canvas.getContext("webgl", { xrCompatible: true, preserveDrawingBuffer: true });
        await xrSession.updateRenderState({ baseLayer: new XRWebGLLayer(xrSession, ctx) });

        gl = ctx;

        xrRefSpace = await xrSession.requestReferenceSpace("local");

        xrSession.requestAnimationFrame(onXRFrame);
    } catch (err) {
        console.error("WebXR 세션 실패:", err);
        alert("WebXR 세션을 시작할 수 없습니다.");
    }
    });

    document.getElementById("capture").addEventListener("click", () => {
    if (!xrSession || !gl) {
        alert("WebXR 세션이 활성화되지 않았습니다.");
        return;
    }
    isCaptureRequested = true;
    });

    function onXRFrame(time, frame) {
    xrSession.requestAnimationFrame(onXRFrame);

    const pose = frame.getViewerPose(xrRefSpace);
    if (!pose) return;

    const baseLayer = xrSession.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, baseLayer.framebuffer);

    // (필요 시 gl.clear() 등 추가 가능)

    if (isCaptureRequested) {
        isCaptureRequested = false;
        const width = gl.drawingBufferWidth;
        const height = gl.drawingBufferHeight;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx2D = canvas.getContext("2d");

        const imgData = new ImageData(new Uint8ClampedArray(pixels), width, height);
        ctx2D.putImageData(flipImage(imgData), 0, 0);

        canvas.toBlob(blob => {
        if (!blob) return alert("이미지 변환 실패");
        const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
        uploadImage(file);
        }, 'image/jpeg', 0.9);
    }
    }

    function flipImage(imageData) {
    const { width, height, data } = imageData;
    const flipped = new Uint8ClampedArray(data.length);
    for (let row = 0; row < height; row++) {
        const src = row * width * 4;
        const dst = (height - row - 1) * width * 4;
        flipped.set(data.subarray(src, src + width * 4), dst);
    }
    return new ImageData(flipped, width, height);
    }

    async function uploadImage(file) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("intrinsics", JSON.stringify([[500, 0, 320], [0, 500, 240], [0, 0, 1]]));

    try {
        const res = await fetch("/estimate-pose", {
        method: "POST",
        body: formData
        });
        const result = await res.json();
        console.log("📥 서버 응답:", result);
        alert("이미지 전송 완료");
    } catch (err) {
        console.error("❌ 서버 전송 실패:", err);
        alert("전송 실패");
    }
}
