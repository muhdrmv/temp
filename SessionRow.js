import {IconButton, TableCell, Tooltip} from "@material-ui/core";
import AssignmentIcon from "@material-ui/icons/Assignment";
import VideoLibraryIcon from "@material-ui/icons/VideoLibrary";
import {changeTimeZone} from "../../../utilities/Utils";
import React, { useEffect } from "react";
import {useHistory} from "react-router-dom";
import BlockIcon from "@material-ui/icons/Block";
import {gql, useMutation,useLazyQuery} from "@apollo/client";
import Modal from './Modal';
import DesktopWindowsIcon from '@material-ui/icons/DesktopWindows';
import TitleIcon from '@material-ui/icons/Title';

const ACTION_SESS_DISCONNECT = gql`
mutation ($sessionId: uuid!) {
  action_sess_disconnect(sessionId: $sessionId) {
    success
  }
}
`;

const QUERY_SESSION = gql`
query ($id: uuid!) {
  sessions_by_pk(id: $id){
    id
    meta
    status
    created_at
  }
}
`;

const SessionRow = ({row}) => {
    const history = useHistory();
    
    const checkFileStatus = async (id, format) => {
        const url = process.env.REACT_APP_RECORDING_URL + `?sessionId=${id}&format=${format}`;
        const fetchResult = await fetch(url, {
            method: 'head',
        });
        const isAvailable = fetchResult.status === 200 || fetchResult.status === 304
        if (isAvailable) {
            return {url};
        }
        try {
            const {message} = await fetchResult.json()
            return {message};
        } catch (e) {}//not a json
        return {};
    }

    const handleClickPlayback = async id => {
        const status = await checkFileStatus(id, 'recording');
        if (status?.url) {
            const playerUrl = process.env.REACT_APP_PLAYBACK_URL + '?s=' + btoa(status.url);
            window.open(playerUrl, '_blank');
        } else {
            const message = status?.message || 'Recording not available';
            alert(message);
        }
    }

    const handleViewClick = id => {
        history.push('/dashboard/sessions-history/' + id+'/view');
    }

    const [sessDisconnect,] = useMutation(ACTION_SESS_DISCONNECT);

    const handleClickDisconnect = async id => {
        const result = await sessDisconnect({variables: {sessionId: id}});
        console.log(result);
        if (result?.data?.action_sess_disconnect?.success) {
            alert('Session has been terminated');
        }else{
            alert('Session has not been terminated');
        }
    }

    return (
        <>
            <TableCell align="right" style={{width: 250, paddingRight: 0}}>

                { row?.meta?.transparentMode && 
                    <> 
                        <Tooltip title="Transparent Mode">
                            <IconButton
                                        style={{color: '#d50000'}}
                                        aria-label="view">
                                <TitleIcon fontSize="small"/>
                            </IconButton>
                        </Tooltip>
                    </>
                }

                { row.status === 'live' && 
                    <>
                        <Tooltip title="Disconnect" >
                            <IconButton onClick={e => handleClickDisconnect(row.id)}
                                        color="primary"
                                        aria-label="view">
                                <BlockIcon fontSize="small"/>
                            </IconButton>
                        </Tooltip>
                        { !row?.meta?.transparentMode && 
                            <> 
                                <Tooltip title="Live">
                                    <Modal sessionId={row.id} /> 
                                </Tooltip> 
                            </>
                        }  

                        { row?.meta?.transparentMode && 
                            <> 
                            <Tooltip title="Live In Transparent Mode">
                                <IconButton
                                        color="primary"
                                        aria-label="view">
                                    <DesktopWindowsIcon fontSize="small"/>
                                </IconButton>
                            </Tooltip>
                            </>
                        }   

                    </>
                }
                <Tooltip title="Details">
                    <IconButton onClick={e => handleViewClick(row.id)}
                                color="primary"
                                aria-label="edit">
                        <AssignmentIcon fontSize="small"/>
                    </IconButton>
                </Tooltip>

                { !row?.meta?.transparentMode && 
                    <> 
                        <Tooltip title="Playback">
                            <IconButton onClick={e => handleClickPlayback(row.id)}
                                        color="primary"
                                        aria-label="view">
                                <VideoLibraryIcon fontSize="small"/>
                            </IconButton>
                        </Tooltip>
                    </>
                }

                

            </TableCell>
            <TableCell>{row.user.username}</TableCell>
            <TableCell>{row.connection.name}</TableCell>
            <TableCell>{row.access_rule.name}</TableCell>
            <TableCell>{row.status}</TableCell>
            <TableCell>
                {row?.meta?.liveAt ? changeTimeZone(row.meta.liveAt) : changeTimeZone(row.created_at)}
                <br/>
                {row?.meta?.closedAt && changeTimeZone(row.meta.closedAt)}
            </TableCell>
        </>
    )
}

export default SessionRow;