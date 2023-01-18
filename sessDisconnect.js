import 'dotenv/config';
import {queryPk, queryWhere} from "../graphql.js";
import fetch from "node-fetch";


const sessDisconnect = async (sessionId) => {
    const sessionRow = await queryPk(null, 'sessions', sessionId, ['id', 'meta']);

    if(!sessionRow?.meta?.transparentMode){

        const disconnectUrl = process.env.TUNNEL_SERVICE_URL + '/api/tunnel-control/invalidate-session';

        const authToken = sessionRow?.meta?.authToken;
        const url = disconnectUrl + '/' + authToken;
        try {
            const fResult = await fetch(url);
            const result = await fResult.json();
            console.log(result);
            return !!result?.ok;
        } catch (e) {
            console.debug('sessDisconnect failed: ', e.message);
            return false;
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
        let url = `${transparentIpAddress?.[0].value}:3030/session/terminate-session`;
        const body = JSON.stringify({sessionId});
        const terminateSessionRequest = await fetch(url, {
            method: 'POST',
            body,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
        });

        let terminateSessionResult = await terminateSessionRequest.json();
        if(terminateSessionResult?.result){
            return true;
        }else{
            console.log(terminateSessionResult?.message);
            return false;
        }
    }
};

export {sessDisconnect};