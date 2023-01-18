
const checkFileStatus = async (id, format) => {
    const recUrl = process.env.REACT_APP_RECORDING_URL + `?sessionId=${id}&format=${format}`;
    const fetchResult = await fetch(recUrl, {
        method: 'head',
    });
    if (fetchResult.status === 200 || fetchResult.status === 304) {
        return recUrl;
    } else {
        return false;
    }
}

const extractSessionKeystrokes = async (mutateSessionVideo, id) => {
    const result = await mutateSessionVideo({variables: {sessionId: id, task: 'keystrokes'}});
    const encoderStatus = (result?.data?.action_mgmt_encoder?.meta?.status);
    if (encoderStatus === 'started') {
        return {success: true};
    }
}

const renderSessionVideo = async (mutateSessionVideo, session) => {
    if(session?.meta?.transparentMode){
        // request to the server Transparent
        const result = await mutateSessionVideo({variables: {sessionId: session?.id, task: 'transparentVideo'}});

    }else{
        const result = await mutateSessionVideo({variables: {sessionId: session?.id, task: 'video'}});
        const encoderStatus = (result?.data?.action_mgmt_encoder?.meta?.status);
        if (encoderStatus === 'started') {
            return {success: true};
        }
    }
}

const renderSessionOcr = async (mutateSessionVideo, id) => {
    const result = await mutateSessionVideo({variables: {sessionId: id, task: 'ocr'}});
    const encoderStatus = (result?.data?.action_mgmt_encoder?.meta?.status);
    if (encoderStatus === 'started') {
        return {success: true};
    }
}

const renderTransparentVideo = async (transparentIpAddress, session) => {
    const url = `${transparentIpAddress}:3030/session/request-video-rendering`;

    const body = JSON.stringify({PamSessionId: session?.id});
    const requestTransparentRenderingVideo = await fetch(url, {
        method: 'POST',
        body,
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
    });
    console.log(requestTransparentRenderingVideo);
}

export {extractSessionKeystrokes, renderSessionVideo, renderSessionOcr, renderTransparentVideo}
