import {queryRaw, queryWhere, updatePk} from '../graphql.js';
import fetch from 'node-fetch';
import {sessDisconnect} from "./sessDisconnect.js";

const sessTracker = async (config) => {
    // console.log('sessTracker', new Date());
    try {
        const unclosedSessions = await queryWhere(config, 'sessions',
            {status: {_nin: ['closed', 'initializing']}},
            ['id', 'meta', 'status']);

        for (const session of unclosedSessions) {
            // check meta and disconnect session if needed

            const disconnectAt = session.meta?.sessionShouldDisconnectAt;
            const millisToDisconnect = disconnectAt - Date.now();
            const disconnectNow = session.status === 'live' && disconnectAt && millisToDisconnect < 0;

            if (disconnectNow) {
                console.log('sessionDisconnect due to TC', session.id, disconnectAt);
                await sessDisconnect(session.id);
            }

            const tunnelStatusFetchResult = await fetchSessionTunnelStatus(config, session.meta.authToken, session );
            // console.log(tunnelStatusFetchResult);
            if (tunnelStatusFetchResult?.status !== 200) {
                await updateSessionStatus(config, session, 'closed');
                continue;
            }
            if(!session?.meta?.transparentMode){
                const tunnelStatusResult = await tunnelStatusFetchResult.json();
                // console.log(tunnelStatusResult);
                if (tunnelStatusResult.hasTunnel && session.status !== 'live') {
                    await updateSessionStatus(config, session, 'live');
                }
                if (tunnelStatusResult.hadTunnel && !tunnelStatusResult.hasTunnel) {
                    await updateSessionStatus(config, session, 'closed');
                }
            }else{
                const tunnelStatusResult = await tunnelStatusFetchResult.json();
                if (tunnelStatusResult?.result == 'na' ) {
                    await updateSessionStatus(config, session, 'closed');
                }
                if (tunnelStatusResult?.result == 'c' ) {
                    await updateSessionStatus(config, session, 'closed');
                }
                if (tunnelStatusResult?.result == 'l' && session.status !== 'live') {
                    await updateSessionStatus(config, session, 'live');
                }
            }
        }
    } catch (e) {
        console.log('sessTracker error', e.message);
    }
}

const fetchSessionTunnelStatus = async (config, authToken, session) => {

    if(!session?.meta?.transparentMode){
        const url = config.tunnelService.sessionStatusUrl + '/' + authToken;
        try {
            const statusFetchResult = await fetch(url, {method: 'get'});
            return statusFetchResult;
        } catch (e) {
            console.log('Fetch failed: ', url);
            return null;
        }
    }else{

        const transparentIpAddress = await queryWhere( null, 'settings',
            {_and: [{type: {_eq: 'system'}}, {name: {_eq: 'transparentIpAddress'}}]},
            ['value']
        );

        if( !transparentIpAddress?.[0].value ) {
            console.log("transparentIpAddress not available in setting");
            return 
        }
        // Port in transparent
        let url = `${transparentIpAddress?.[0].value}:3030/session/l/${session?.id}`;
        try {
            const statusFetchResult = await fetch(url, {method: 'get'});
            return statusFetchResult;
        } catch (e) {
            console.log('Fetch failed: ', url);
            return null;
        }
    }  
}

const updateSessionStatus = async (config, session, status) => {
    const dateNow = new Date().toISOString();
    const statusAt = status + 'At';
    await updatePk(config, 'sessions', session.id, {status, meta: {...session.meta, [statusAt]: dateNow}});
    if (status === 'closed') {
        setTimeout(() => {
            encodeKeystrokes(session.id);
        }, 10000)
    }
}

const encodeKeystrokes = (sessionId) => {
    console.log('auto-encoding-keys')
    const QUERY = `
    mutation ($sessionId: uuid!, $task: String!) {
      action_mgmt_encoder(sessionId: $sessionId, task: $task) {
        meta
      }
    }
    `;
    queryRaw(QUERY, {sessionId, task: 'keystrokes'})
}

export {
    sessTracker
};