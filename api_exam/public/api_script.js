export async function sendPoseEstimation(imageFile, intrinsicsMatrix) {
    const formData = new FormData();
    formData.append("file", imageFile);
    formData.append("intrinsics", JSON.stringify(intrinsicsMatrix));

    const response = await fetch("/estimate-pose", {
        method: "POST",
        body: formData
    });

    // 오류 처리 강화 (옵션)
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`API Error (${response.status}): ${errorText}`);
        throw new Error(`API request failed with status ${response.status}`);
    }

    return await response.json();
}

export async function sendTransformation(posePairs) {
    const response = await fetch("/match-pairs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(posePairs)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`API Error (${response.status}): ${errorText}`);
        throw new Error(`API request failed with status ${response.status}`);
    }

    return await response.json();
}

export async function sendPathRequest(absToRel, relToAbs, start, destinationId) {
    const response = await fetch("/path-finding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            abs_to_rel: absToRel,
            rel_to_abs: relToAbs,
            start: start,
            destination_id: destinationId
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`API Error (${response.status}): ${errorText}`);
        throw new Error(`API request failed with status ${response.status}`);
    }

    return await response.json();
}
