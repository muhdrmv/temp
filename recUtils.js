import fetch from "node-fetch";
import fs from "fs";

let config = {
    secondsWaitBeforeEncode: 1
};

export const sendEncoderTask = async  (sessionId, inputTask, transparentIpAddress) => {
    let url = process.env.ENCODER_SERVICE_URL + '/encode';
    let webhook = process.env.CONTROL_SERVICE_URL + '/rec/webhook';
    let task;
    switch (inputTask) {
        case 'video':
            task = 'encode';
            break;
        case 'keystrokes':
            task = 'log';
            break;
        case 'ocr':
            try {
                sendOcrTask(sessionId);
                return;
            } catch (e) {
                // exception: video file did not exist, encode recording first,
                // set ocr flag to do ocr in webhook after encode is done
                task = 'encode';
                webhook += "?ocr=true"
            }
            break;
        case 'transparentVideo':
            task = 'transparentVideo'
            url = `${transparentIpAddress}:3030/session/request-video-rendering`;
            break;
        case 'transparentVideoInfo':
            task = 'transparentVideoInfo'
            url = `${transparentIpAddress}:3030/session/video-status`;
            break;
        default:
            return;
    }
    const body = JSON.stringify({task, sessionId, webhook});
    setTimeout(async () => {
        console.log('calling', url, body);
        const encodeResult = await fetch(url, {
            method: 'POST',
            body,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
        });
        return encodeResult?.json();
        // console.log('encodeResult', encodeResult)
    }, config.secondsWaitBeforeEncode * 1000);
};

export const sendOcrTask = (sessionId) => {
    const url = process.env.OCR_SERVICE_URL + '/ocr';
    const storagePath = process.env.RECORDINGS_DIR;
    const fileName = sessionId + '.m4v';

    const videoExists = fs.existsSync(`${storagePath}/${fileName}`);
    if (!videoExists) throw new Error("Video file does not exist");

    const webhook = process.env.CONTROL_SERVICE_URL + '/rec/webhook';
    const body = JSON.stringify({sessionId, fileName, storagePath, webhook});
    setTimeout(async () => {
        console.log('fetching', url, body);
        const encodeResult = await fetch(url, {
            method: 'POST',
            body,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
        });
        console.log('ocrResult', encodeResult)
    }, config.secondsWaitBeforeEncode * 1000);
};