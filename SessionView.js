import React, {useEffect, useRef, useState} from 'react'
import {makeStyles} from '@material-ui/core/styles';
import {Button, Grid, Paper, Tooltip} from '@material-ui/core';
import {useParams} from "react-router-dom";
import {gql, useMutation, useQuery, useLazyQuery} from '@apollo/client';
import TopToolbar from '../../shared-components/TopToolbar';
import 'date-fns';
import {changeTimeZone, formatBytes} from "../../../utilities/Utils";
import {extractSessionKeystrokes, renderSessionOcr, renderSessionVideo, renderTransparentVideo} from "./SessionActions";
import IconButton from "@material-ui/core/IconButton";
import RefreshIcon from "@material-ui/icons/Refresh";
import VideoLibraryIcon from "@material-ui/icons/VideoLibrary";
import Movie from "@material-ui/icons/Movie";
import {Keyboard, MovieFilter} from "@material-ui/icons";
import axios from 'axios';

const useStyles = makeStyles((theme) => ({
    root: {
        '& .MuiTextField-root': {
            marginTop: theme.spacing(2),
            marginBottom: theme.spacing(2),
        },
        '& h3': {
            margin: '3px 0',
            fontStyle: 'italic',
        },
    },
    form: {
        padding: theme.spacing(2),
    },
    paper: {
        width: '100%',
        marginBottom: theme.spacing(1),
        padding: "1px",
        paddingLeft: "10px",
        textAlign: "left",
        paddingBottom: "10px",
    },

}));

const QUERY_SESSION = gql`
query ($id: uuid!) {
  sessions_by_pk(id: $id){
    id
    meta
    status
    created_at
    access_rule {
      name
    }
    connection {
      name
    }
    user {
      username
    }  
  }
  settings(where: {name: {_eq: "transparentIpAddress"}}) {
    value
  }
}
`;

const ACTION_MGMT_ENCODER = gql`
mutation ($sessionId: uuid!, $task: String!) {
  action_mgmt_encoder(sessionId: $sessionId, task: $task) {
    meta
  }
}
`;

const SessionView = ({licenseInfo}) => {
    const {id} = useParams();
    const classes = useStyles();
    const [inProgress, setInProgress] = useState(false);
    const [session, setSession] = useState({});
    const [recording, setRecording] = useState({});
    const [transparentIpAddress, setTransparentIpAdress] = useState(null)
    const [video, setVideo] = useState({});
    const [videoPart, setVideoPart] = useState({});
    const [renderVideoEnabled, setRenderVideoEnabled] = useState(true);

    const [keystrokes, setKeystrokes] = useState({});
    const [keystrokesPart, setKeystrokesPart] = useState({});
    const [extractKeystrokesEnabled, setExtractKeystrokesEnabled] = useState(true);

    const features = licenseInfo?.action_mgmt_license_info?.result?.features;
    const hasFeatureOcr = features?.includes('ocr');
    const [ocr, setOcr] = useState({});
    const [ocrPart, setOcrPart] = useState({});
    const [renderOcrEnabled, setRenderOcrEnabled] = useState(true);

    const intervalTimer = useRef();

    const {data, refetch} = useQuery(QUERY_SESSION, {variables: {id: id}});
    const [mutateSessionVideo,] = useMutation(ACTION_MGMT_ENCODER);

    useEffect(() => {

        if(data?.settings){
            setTransparentIpAdress(data?.settings?.[0]?.value);
        }
        if (data?.sessions_by_pk) {
            const sessionData = data.sessions_by_pk;
            setSession(sessionData);
            setInProgress(false);
        } else {
            setInProgress(true);
        }
    }, [data]);
    
    useEffect(() => {
        getInfo();
        intervalTimer.current = setInterval(handleClickRefresh, 5000);
        return () => {
            clearInterval(intervalTimer.current)
        }
    }, [])


    const getInfo = () => {
        getRecordingInfo();
        getKeystrokesInfo();
        getVideoInfo();
        getVideoPartInfo();
        getKeystrokesPartInfo();
        getOcrInfo();
        getOcrPartInfo();
        getTransparentVideoInfo();
    }

    const getRecordingInfo = async () => {
        const result = await headFile(id, 'recording');
        setRecording(result);
    }

    const getKeystrokesInfo = async () => {
        const result = await headFile(id, 'keystrokes');
        setKeystrokes(result);
    }

    const getVideoInfo = async () => {
        const result = await headFile(id, 'video');
        setVideo(result);
    }

    const getTransparentVideoInfo = async () => {
        const result = await headFile(id, 'transparentVideoInfo');
        console.log(result);
        setVideo(result);
    }


    const getVideoPartInfo = async () => {
        const result = await headFile(id, 'video-part');
        setVideoPart(result);
    }

    const getKeystrokesPartInfo = async () => {
        const result = await headFile(id, 'keystrokes-part');
        setKeystrokesPart(result);
    }

    const getOcrInfo = async () => {
        const result = await headFile(id, 'ocr');
        setOcr(result);
    }

    const getOcrPartInfo = async () => {
        const result = await headFile(id, 'ocr-part');
        setOcrPart(result);
    }

    const headFile = async (id, format) => {
        const recUrl = process.env.REACT_APP_RECORDING_URL + `?sessionId=${id}&format=${format}`;
        const headers = {};
        const token = window.localStorage.getItem('AuthToken');
        if (token) headers.authorization = `Bearer ${token}`
        const fetchResult = await fetch(recUrl, {
            method: 'head', headers
        });
        return {
            available: (fetchResult.status === 200 || fetchResult.status === 304),
            size: (fetchResult.status === 200 || fetchResult.status === 304) ? fetchResult?.headers?.get('Content-Length') : undefined,
            url: recUrl
        }
    }

    const handleClickPlayback = async id => {
        const recUrl = process.env.REACT_APP_RECORDING_URL + `?sessionId=${id}&format=recording`;
        const playerUrl = process.env.REACT_APP_PLAYBACK_URL + '?s=' + btoa(recUrl);
        window.open(playerUrl, '_blank');
    }

    const handleClickExtractKeystrokes = async () => {
        setExtractKeystrokesEnabled(false);
        const result = await extractSessionKeystrokes(mutateSessionVideo, id);
        console.log(result);
    }

    const handleClickRenderVideo = async () => {
        if (window.confirm('Are you sure you want to start rendering this session?')) {
            setRenderVideoEnabled(false);
            const result = await renderSessionVideo(mutateSessionVideo, session);
            if(session?.meta?.transparentMode){
               
            }
            
        }
    }

    const handleClickDownloadKeystrokes = async () => {
        const recUrl = process.env.REACT_APP_RECORDING_URL + `?sessionId=${id}&format=keystrokes`;
        window.open(recUrl);
    }

    const handleClickDownloadVideo = async () => {
        if(session?.meta?.transparentMode){
            const recUrl = `${transparentIpAddress}:3030/v/${id}`;
            window.open(recUrl);
        }else{
            const recUrl = process.env.REACT_APP_RECORDING_URL + `?sessionId=${id}&format=video`;
            window.open(recUrl);
        }
    }

    const handleClickRefresh = () => {
        refetch();
        getInfo();
    }

    const handleClickRenderOcr = async () => {
        if (window.confirm('Are you sure you want to start OCR on this session?')) {
            setRenderOcrEnabled(false);
            const result = await renderSessionOcr(mutateSessionVideo, id);
            console.log(result);
        }
    }

    const handleClickDownloadOcr = async () => {
        const recUrl = process.env.REACT_APP_RECORDING_URL + `?sessionId=${id}&format=ocr`;
        window.open(recUrl);
    }

    const ExtraIcons = () => (
        <>
            <Tooltip title="Refresh">
                <IconButton aria-label="refresh" onClick={handleClickRefresh}>
                    <RefreshIcon/>
                </IconButton>
            </Tooltip>
        </>
    );

    let videoStatus = '';
    if (video?.available)
        videoStatus = 'Available';
    if (!video?.available)
        videoStatus = 'Not Available';
    if (videoPart?.available)
        videoStatus = 'In-Progress';

    let keystrokesStatus = '';
    if (keystrokes?.available)
        keystrokesStatus = 'Available';
    if (!keystrokes?.available)
        keystrokesStatus = 'Not Available';
    if (keystrokesPart?.available)
        keystrokesStatus = 'In-Progress';

    let ocrStatus = '';
    if (ocr?.available)
        ocrStatus = 'Available';
    if (!ocr?.available)
        ocrStatus = 'Not Available';
    if (ocrPart?.available)
        ocrStatus = 'In-Progress';

    return (
        <div className={classes.root} style={{width: '100%'}}>
            <Paper className={classes.paper}>
                <TopToolbar toolbarTitle={"Session Details"} backLinkUrl="/dashboard/sessions-history"
                            inProgress={inProgress} extraIcons={ExtraIcons}/>

                <div className={classes.root} style={{padding: "20px"}}>
                    <Grid container spacing={3}>

                        <Grid item xs={3}>
                            <Paper className={classes.paper}><h3>Username</h3>
                                <span>
                                    {session?.user?.username}
                                </span>
                            </Paper>
                        </Grid>

                        <Grid item xs={3}>
                            <Paper className={classes.paper}><h3>Connection Name</h3>
                                <span>
                                    {session?.connection?.name}
                                </span>
                            </Paper>
                        </Grid>

                        <Grid item xs={3}>
                            <Paper className={classes.paper}><h3>Access Rule Name</h3>
                                <span>
                                    {session?.access_rule?.name}
                                </span>
                            </Paper>
                        </Grid>

                        <Grid item xs={3}>
                            <Paper className={classes.paper}><h3>Session Status</h3>
                                <span>
                                    {session?.status}
                                </span>
                            </Paper>
                        </Grid>

                        <Grid item xs={3}>
                            <Paper className={classes.paper}><h3>Session Started at</h3>
                                <span>
                                    {session?.meta?.liveAt ? changeTimeZone(session?.meta?.liveAt) : changeTimeZone(session?.created_at)}
                                </span>
                            </Paper>
                        </Grid>

                        <Grid item xs={3}>
                            <Paper className={classes.paper}><h3>Session Closed at</h3>
                                <span>
                                    {session?.meta?.closedAt ? changeTimeZone(session?.meta?.closedAt) : 'N/A'}
                                </span>
                            </Paper>
                        </Grid>

                        <Grid item xs={6}>
                            <Paper className={classes.paper}><h3>Session Unique ID</h3>
                                <span>
                                    {session?.id}
                                </span>
                            </Paper>
                        </Grid>

                    </Grid>
                </div>

                {
                    !session?.meta?.transparentMode &&   
                    <>
                        <h4>
                            Recording Details
                        </h4>
                        <div className={classes.root} style={{padding: "20px"}}>
                            <Grid container spacing={3}>

                                <Grid item xs={3}>
                                    <Paper className={classes.paper}><h3>Recording Status</h3>
                                        <span>
                                            {(recording?.available) ? 'Available' : 'Not Available'}
                                        </span>
                                    </Paper>
                                </Grid>

                                <Grid item xs={3}>
                                    <Paper className={classes.paper}><h3>Recording Size</h3>
                                        <span>
                                            {(recording?.size) ? formatBytes(recording?.size / 1024) : 'N/A'}
                                        </span>
                                    </Paper>
                                </Grid>

                                <Grid item xs={6}>
                                    <Paper className={classes.paper}><h3>Recording Playback</h3>
                                        <span>
                                            <Button size="small" color="primary"
                                                    startIcon={<VideoLibraryIcon/>}
                                                    onClick={() => handleClickPlayback(id)}>
                                                Playback
                                            </Button>
                                        </span>
                                    </Paper>
                                </Grid>

                            </Grid>
                        </div>
                    </>
                }
                <h4>
                    Video Details
                </h4>
                <div className={classes.root} style={{padding: "20px"}}>
                    <Grid container spacing={3}>

                        <Grid item xs={3}>
                            <Paper className={classes.paper}><h3>Video Status</h3>
                                <span>{videoStatus}</span>
                            </Paper>
                        </Grid>

                        <Grid item xs={3}>
                            <Paper className={classes.paper}><h3>Video Size</h3>
                                <span>
                                    {video?.size ? formatBytes(video.size / 1024) : 'N/A'}
                                    {videoPart?.size ? ' (Part: ' + formatBytes(videoPart.size / 1024) + ')' : ''}
                                </span>
                            </Paper>
                        </Grid>

                        <Grid item xs={6}>
                            <Paper className={classes.paper}><h3>Download Video</h3>
                                <span>
                                    <Button size="small" color="primary"
                                            startIcon={<Movie/>}
                                            onClick={handleClickRenderVideo}
                                            disabled={!renderVideoEnabled}>
                                        Render Video
                                    </Button>
                                    &nbsp; &nbsp; &nbsp;
                                    <Button size="small" color="primary"
                                            startIcon={<Movie/>}
                                            onClick={handleClickDownloadVideo}
                                            disabled={!video?.available}>
                                        Download Video
                                    </Button>
                                </span>
                            </Paper>
                        </Grid>

                    </Grid>
                </div>

                <h4>
                    Keystrokes Details
                </h4>
                <div className={classes.root} style={{padding: "20px"}}>
                    <Grid container spacing={3}>

                        <Grid item xs={3}>
                            <Paper className={classes.paper}><h3>Keystrokes Status</h3>
                                <span>
                                    {keystrokesStatus}
                                </span>
                            </Paper>
                        </Grid>

                        <Grid item xs={3}>
                            <Paper className={classes.paper}><h3>Keystrokes Size</h3>
                                <span>
                                    {keystrokes?.size ? formatBytes(keystrokes.size / 1024) : 'N/A'}
                                    {keystrokesPart?.size ? ' (Part: ' + formatBytes(keystrokesPart.size / 1024) + ')' : ''}
                                </span>
                            </Paper>
                        </Grid>

                        <Grid item xs={6}>
                            <Paper className={classes.paper}><h3>Download Keystrokes</h3>
                                <span>
                                    <Button size="small" color="primary"
                                            startIcon={<Keyboard/>}
                                            onClick={handleClickExtractKeystrokes}
                                            disabled={!extractKeystrokesEnabled}
                                    >
                                        Extract Keystrokes
                                    </Button>
                                    &nbsp; &nbsp; &nbsp;
                                    <Button size="small" color="primary"
                                            startIcon={<Keyboard/>}
                                            onClick={handleClickDownloadKeystrokes}
                                            disabled={!keystrokes?.available}>
                                        Download Keystrokes
                                    </Button>
                                </span>
                            </Paper>
                        </Grid>

                    </Grid>
                </div>

                {hasFeatureOcr && !session?.meta?.transparentMode && <>
                    <h4>
                        OCR Details
                    </h4>
                    <div className={classes.root} style={{padding: "20px"}}>
                        <Grid container spacing={3}>

                            <Grid item xs={3}>
                                <Paper className={classes.paper}><h3>OCR Status</h3>
                                    <span>{ocrStatus}</span>
                                </Paper>
                            </Grid>

                            <Grid item xs={3}>
                                <Paper className={classes.paper}><h3>OCR Size</h3>
                                    <span>
                                    {ocr?.size ? formatBytes(ocr.size / 1024) : 'N/A'}
                                        {ocrPart?.size ? ' (Part: ' + formatBytes(ocrPart.size / 1024) + ')' : ''}
                                </span>
                                </Paper>
                            </Grid>

                            <Grid item xs={6}>
                                <Paper className={classes.paper}><h3>Download OCR</h3>
                                    <span>
                                    <Button size="small" color="primary"
                                            startIcon={<MovieFilter/>}
                                            onClick={handleClickRenderOcr}
                                            disabled={!renderOcrEnabled}>
                                        Extract OCR
                                    </Button>
                                        &nbsp; &nbsp; &nbsp;
                                        <Button size="small" color="primary"
                                                startIcon={<MovieFilter/>}
                                                onClick={handleClickDownloadOcr}
                                                disabled={!video?.available}>
                                        Download OCR
                                    </Button>
                                </span>
                                </Paper>
                            </Grid>

                        </Grid>
                    </div>
                </>}

            </Paper>
        </div>


    )
}

export default SessionView
