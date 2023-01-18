import 'dotenv/config';
import fs from 'fs';
import fetch from "node-fetch";
import {checkAuth} from "./auth.js";
import recReadableText from "./recReadableText.js";
import {sendEncoderTask, sendOcrTask} from "./recUtils.js";
import {queryWhere} from "../graphql.js";

let config = {
    recordingsPath: process.env.RECORDINGS_DIR,
    drivePath: process.env.DRIVE_DIR,
    sharePath: process.env.SHARE_DIR,
    playPath: process.env.PLAY_DIR,
    transparentRDPPath : process.env.RDP_CONNECTION
};

const live = async (req, res) => {
    res.json({live: true});
};

const recording = async (req, res) => {
    try {
        const user = checkAuth(req);

        if (['administrator', 'auditor', 'moderator', 'supervisor' , 'user'].includes(user?.role) && req.query.format == 'transparent-rdp-connection') {

            const sessionId = req.query.sessionId;
            let path = config?.transparentRDPPath + '/' + sessionId
            console.log(path);
            try {
                res.download(path);
                return;
            } catch (e) {
                res.status(404).send({message: e.message});
                return;
            }
        }

        if (!['administrator', 'auditor'].includes(user?.role)) {
            res.status(403).json({message: 'Users with administrator or auditor role can view recordings'});
            return;
        }
    } catch (e) {
        res.status(403).json({message: e.message});
        return;
    }
    const sessionId = req.query.sessionId;
    const format = req.query.format;
    let path = config.recordingsPath + '/' + sessionId;
    switch (format) {
        case 'recording-play':
            path = config.playPath + '/' + sessionId + '.recording';
            break;
        case 'recording':
            path = path + '.recording';
            break;
        case 'video':
            path = path + '.m4v';
            break;
        case 'video-part':
            path = path + '.recording.m4v';
            break;
        case 'keystrokes':
            path = path + '.txt';
            break;
        case 'keystrokes-part':
            path = path + '.recording.txt';
            break;
        case 'ocr':
            path = path + '.ocr.txt';
            break;
        case 'ocr-part':
            path = path + '.ocr-part.txt';
            break;
        default:
            res.status(404).send({message: 'Format not supported'});
            return;
    }
    try {
        res.download(path);
    } catch (e) {
        res.status(404).send({message: e.message});
    }
};

const search = async (req, res) => {
    const {
        input: {
            filter: {
                text
            }
        }
    } = req.body;
    if (text.trim() === '' || text.trim().length < 2) {
        res.json([]);
        return;
    }
    const results = [];
    const dirPath = config.recordingsPath;
    // searching .txt files
    const txtFiles = fs.readdirSync(dirPath).filter(e => e.endsWith('.txt'));
    console.log(`sessionsSearch for ${text}, in  ${txtFiles.length} files`);
    for (const txtFile of txtFiles) {
        const txtContent = fs.readFileSync(`${dirPath}/${txtFile}`, 'utf8');
        if (txtContent.includes(text)) {
            const id = txtFile.split('.')[0];
            results.push(id);
        }
    }
    // searching .ocr.txt files
    // const ocrTxtFiles = fs.readdirSync(dirPath).filter(e => e.endsWith('.ocr.txt'));
    // for (const txtFile of ocrTxtFiles) {
    //     const txtContent = fs.readFileSync(`${dirPath}/${txtFile}`, 'utf8');
    //     const txtContentLines = txtContent.split('\n');
    //     for (const [lineNumber, txtContentLine] of txtContentLines) {
    //         if (txtContentLine.includes(text)) {
    //             const id = txtFile.split('.')[0];
    //             results.push(id);
    //         }
    //     }
    // }
    const resultSessions = [...new Set(results)].map(i => ({id: i}));
    res.json(resultSessions);
};

const encode = async (req, res) => {
    let {
        input: {
            sessionId,
            task
        }
    } = req.body;
    let transparentIpAddress = null;
    if(task == 'transparentVideo' || task == 'transparentVideoInfo'){
        const transparentIpAddressResult = await queryWhere( null, 'settings',
            {_and: [{type: {_eq: 'system'}}, {name: {_eq: 'transparentIpAddress'}}]},
            ['value']
        );
        if(transparentIpAddressResult.length > 0) transparentIpAddress = transparentIpAddressResult[0]?.value;
    }

    let sendEncoderTaskResult = await sendEncoderTask(sessionId, task, transparentIpAddress);
    console.log("sendEncoderTaskResult",sendEncoderTaskResult);
    res.json({meta: {status: 'started'}});
}

const webhook = async (req, res) => {
    res.json({success: true});
    let {
        sessionId,
        task,
        result
    } = req.body;

    const ocr = req.query?.ocr;

    if (task === 'log') {
        await createReadableTxt(sessionId);
    }

    if (task === 'encode') {
        console.log('REC WEBHOOK for encode task', sessionId);
    }

    if (ocr) {
        console.log("Starting OCR task:", sessionId);
        sendOcrTask(sessionId);
    }
}

const createReadableTxt = async sessionId => {
    const txtFileName = config.recordingsPath + '/' + sessionId + '.txt';
    const keystrokes = await fs.readFileSync(txtFileName);
    const readableKeystrokes = recReadableText(keystrokes.toString());
    await fs.writeFileSync(txtFileName.replace('.txt', '.readable.txt'), readableKeystrokes);
}

export {live, recording, search, encode, webhook};