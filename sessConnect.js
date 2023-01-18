import {queryRaw, queryWhere, queryPk, insertOne, updatePk} from "../graphql.js";
import {sessionAttributes, sessionAttributesRDP, sessionAttributesSSH} from "./sessConnectionAttributeBuilder.js";
import mysql from 'mysql2/promise';
import crypto from "crypto";
import fetch from "node-fetch";
import {isLicenseValid, pamExpiryDate} from "./lic.js";
import {isLicenseChallengeValid} from "./licChallenge.js";
import {checkTimeConstraints} from "./sess/checkTimeConstraints.js";
import {checkHAConstraints} from './ha/checkHAConstraints.js'
import fs from 'fs';

const sessConnect = async (config, connectionId, accessRuleId, userId, extra) => {
    const lic = await isLicenseValid(config);
    if (!lic?.isLicenseValid)
        return {success: false, message: 'Invalid license, ' + ( lic.remainingDays ?? 'n/a' ) };
    if (!lic?.isHwValid)
        return {success: false, message: 'Invalid token' };

    let expiryDate = await pamExpiryDate();

    if(expiryDate){
        expiryDate = parseInt(expiryDate);
        if(expiryDate && new Date(expiryDate) < new Date()){
            return {success: false, message: 'The session could not be established: contact the support team' };
        }
    }
    // Dont complain about license challenge if license is issued in less than 5 days
    const licChallenge = await isLicenseChallengeValid();
    const licenseAgeDays = (Date.now()/1000 - lic.issued_at) / (24*3600);
    if (licenseAgeDays > 5 && lic?.features?.includes('chn') && licChallenge?.isValid !== true)
        return {success: false, message: 'Please renew challenge answer' };

    const connectionIds = (await queryWhere(config, 'connections', {id: {_is_null: false}}, ['id'])).map(i => i.id);
    const connectionIndex = connectionIds.indexOf(connectionId);
    // console.log(`lic conn used: ${connectionIndex} / ${lic.connection_limit} `)
    if (lic.connection_limit && lic.connection_limit < connectionIndex)
        return {success: false, message: 'License connections overused, ' + ( lic.connection_limit ?? 'n/a' ) };

    const liveSessions = await queryWhere(config, 'sessions', {status: {_eq:'live'}}, ['id']);
    // console.log(`lic sess used: ${liveSessions.length} / ${lic.session_limit} `)
    if (lic.session_limit && lic.session_limit < liveSessions.length)
        return {success: false, message: 'License sessions overused, ' + ( lic.session_limit  ?? 'n/a' ) };

    if (!userId)
        return {success: false, message: 'UserId not available'};

    const connection = await queryPk(config, 'connections', connectionId, ['id', 'name', 'hostname', 'meta', 'protocol']);
    const accessRule = await queryPk(config, 'access_rules', accessRuleId, ['id', 'name', 'meta']);
    let attributes = {hostname: connection.hostname, port: connection?.meta?.port};

    // Check Access Rule
    const hasPermission = await userHasAccess(config, userId, connectionId, accessRuleId);
    if (!hasPermission)
        return {success: false, message: 'Access rule not found'};

    // Check username/password
    // if (connection?.meta?.promptCredentials) {
    //     if (!extra?.credentials?.username || !extra?.credentials?.password)
    //         return {success: false, promptCredentials: true, message: 'Credentials missing'};
    //     else
    //         attributes = {...attributes, username: extra?.credentials?.username, password: extra?.credentials?.password};
    // }

    // checking time constraints
    let sessionShouldDisconnectAt = null;
    try {
        sessionShouldDisconnectAt = checkTimeConstraints(accessRule.meta);
        console.log('sessionShouldDisconnectAt', sessionShouldDisconnectAt)
    } catch (e) {
        return {success: false, message: e.message};
    }

    // checking high availability
    try {
        await checkHAConstraints();
    } catch (e) {
        return {success: false, message: e.message};
    }

    // all checks passed try to create session
    const {username} = await queryPk(config, 'users',userId, ['username']);

    const sessionInput = {
        user_id: userId,
        connection_id: connectionId,
        access_rule_id: accessRuleId,
        status: "initializing",
        meta: {
            byUsername: username,
            sessionShouldDisconnectAt
        }
    };
    const session = await insertOne(config, 'sessions', sessionInput);
    const sessionId = session.id;

    // Start Transparent Mode
    let transparentMode = (accessRule?.meta?.transparentMode) ? true : false ;

    if(!transparentMode){
        const randomUsername = crypto.randomBytes(10).toString('hex');
        const randomPassword = crypto.randomBytes(10).toString('hex');

        attributes = {...attributes, ...sessionAttributes(config, connection.meta, accessRule.meta, sessionId)};
        if (connection.protocol === 'rdp') {
            attributes = {...attributes, ...sessionAttributesRDP(config, connection.meta, accessRule.meta, sessionId)};
        }
        if (connection.protocol === 'ssh') {
            attributes = {...attributes, ...sessionAttributesSSH(config, connection.meta, accessRule.meta)};
        }

        let connectionProps = {
            'protocol': connection.protocol,
            'connection_name' : connection.name,
            'proxy_hostname': null,
            'proxy_port': null,
            'proxy_encryption_method': null,
        };

        /*
        const settingsUseLegacyTunnel = await queryWhere(config, 'settings', {name: {_eq:'useLegacyTunnel'}}, ['value']);
        if (settingsUseLegacyTunnel?.[0]?.value === "true") {
            console.log('useLegacyTunnel is enabled');
            connectionProps = {...connectionProps,
                'proxy_hostname': 'tunnel-bridge-service-legacy',
                'proxy_port': 4822,
                'proxy_encryption_method': 'NONE'
            };
        } else {
            console.log('useLegacyTunnel is disabled', settingsUseLegacyTunnel);
        }
        */

        let manipulateDBResult = await manipulateDB(config.tunnelDatabaseService, randomUsername, randomPassword, connectionProps, attributes);

        const loginResult = await tunnelLoginAttempt(config.tunnelService.tokenUrl, randomUsername, randomPassword);
        if (!loginResult.authToken) {
            return {success: false, message: 'Invalid tunnel response'};
        }

        await updatePk(config, 'sessions', sessionId, {
            status: "ready",
            meta: {
                byUsername: username,
                sessionShouldDisconnectAt,
                authToken: loginResult.authToken,
                sharingProfileId: manipulateDBResult.sharingProfileId
            }
        });

        return {success: true, tokenPayload: JSON.stringify(loginResult), license: lic};
    }else{

        // if(!lic?.features?.includes('trs')) return {success: false, message: 'Your license is not able to use transparent mode' };

        const allowToUseRDPTransparent = await queryWhere( null, 'settings',
            {_and: [{type: {_eq: 'system'}}, {name: {_eq: 'transparentModeRDP'}}]},
            ['value']
        );

        const transparentIpAddress = await queryWhere( null, 'settings',
            {_and: [{type: {_eq: 'system'}}, {name: {_eq: 'transparentIpAddress'}}]},
            ['value']
        );
        
        
        if( !allowToUseRDPTransparent?.[0]?.value || !transparentIpAddress?.[0].value ) return {success: false, message: 'Configure transparent mode requirements in the settings menu' };

        let url = `${transparentIpAddress?.[0].value}:8080/v1/graphql`;

        const createTransparentSession = await queryRaw( MUTATION_CREATE_SESSION, {
            pamSessionId : sessionId,
            user_id : userId,
            destinatonServerIp : connection?.hostname,
            destinatonServerPort: connection?.port ? connection?.port : '3389',

        }, { endpointUrl: url, headers: {'x-hasura-admin-secret': process.env.HASURA_ADMIN_SECRET} } );
        
        if(!createTransparentSession?.action_create_session?.config?.success){
            return {success: false, message: createTransparentSession?.action_create_session?.config?.message};
        }

        if (!createTransparentSession?.action_create_session?.config?.download) {
            return {success: false, message: 'The file Not prepared from Transparent Server!'};
        }

        await updatePk(config, 'sessions', sessionId, {
            status: "ready",
            meta: {
                byUsername: username,
                sessionShouldDisconnectAt,
                transparentMode: true
            }
        });
        let filename = createTransparentSession?.action_create_session?.config?.download?.filename;
        let rdpConnection = createTransparentSession?.action_create_session?.config?.download?.rdpConnection;

        fs.writeFile(`${process.env.RDP_CONNECTION}/${filename}`, rdpConnection, (err) => {
            if(err) {
                return {success: false, message: err};
            }
        });

        return {success: true, tokenPayload: JSON.stringify({"transparentFile" : filename}), license: lic };
    }
};

const manipulateDB = async (config, randomUsername, randomPassword, connectionProps, attributes) => {

    const sha256 = m => crypto.createHash('sha256').update(m).digest('hex');
    const passwordSalt = sha256(crypto.randomBytes(10).toString('hex')).toUpperCase();
    const passwordHash = sha256(randomPassword + passwordSalt).toUpperCase();

    // connect to mysql
    const {host, user, password, database} = config;
    const connection = await mysql.createConnection({host, user, password, database});

    connection.connect();

    const [rowsIn, fieldsIn] = await connection.execute('INSERT INTO guacamole_entity (name, type) VALUES (?,\'USER\');', [randomUsername]);
    const entityId = rowsIn.insertId;

    const [rowsIn2, fieldsIn2] = await connection.execute('INSERT INTO `guacamole_user` (`entity_id`, `password_hash`, `password_salt`, `password_date`) VALUES (?, UNHEX(?), UNHEX(?), NOW());',
        [entityId, passwordHash, passwordSalt]);
    const userId = rowsIn2.insertId;

    const [rowsIn3, fieldsIn3] = await connection.execute('INSERT INTO `guacamole_connection` ' +
        '(`connection_name`, `protocol`, `failover_only`, `proxy_hostname`, `proxy_port`, `proxy_encryption_method`) VALUES (?, ?, ?, ?, ?, ?);',
        [connectionProps.connection_name, connectionProps.protocol, 0, connectionProps.proxy_hostname, connectionProps.proxy_port, connectionProps.proxy_encryption_method]);
    const connectionId = rowsIn3.insertId;

    for (let attr in attributes) {
        if (attributes[attr] === null) continue;
        await connection.execute('INSERT INTO `guacamole_connection_parameter` (`connection_id`, `parameter_name`, `parameter_value`) VALUES (?, ?, ?);',
            [connectionId, attr, attributes[attr]]);
    }

    await connection.execute('INSERT INTO `guacamole_connection_permission` (`entity_id`, `connection_id`, `permission`) VALUES (?, ?, \'READ\');',
        [entityId, connectionId]);

    const [rowsIn4, fieldsIn4] =  await connection.execute('INSERT INTO `guacamole_sharing_profile` (`sharing_profile_name`, `primary_connection_id`) VALUES (?, ?);',
        [randomUsername, connectionId]);
    const sharingProfileId = rowsIn4.insertId;
    
    await connection.execute('INSERT INTO `guacamole_sharing_profile_parameter` (`sharing_profile_id`, `parameter_name`, `parameter_value`) VALUES (?, ?, \'true\');',
        [sharingProfileId, 'read-only']);

    await connection.execute('INSERT INTO `guacamole_sharing_profile_permission` (`entity_id`, `sharing_profile_id`, `permission`) VALUES (?, ?, \'READ\');',
        [entityId, sharingProfileId]);

    await connection.execute('INSERT INTO `guacamole_sharing_profile_permission` (`entity_id`, `sharing_profile_id`, `permission`) VALUES (?, ?, \'UPDATE\');',
        [entityId, sharingProfileId]);

    await connection.execute('INSERT INTO `guacamole_sharing_profile_permission` (`entity_id`, `sharing_profile_id`, `permission`) VALUES (?, ?, \'DELETE\');',
        [entityId, sharingProfileId]);

    await connection.execute('INSERT INTO `guacamole_sharing_profile_permission` (`entity_id`, `sharing_profile_id`, `permission`) VALUES (?, ?, \'ADMINISTER\');',
        [entityId, sharingProfileId]);

    connection.end();
    // console.log('tunnel manipulateDB done');
    return {sharingProfileId};
}

const tunnelLoginAttempt = async (url, username, password) => {
    try {
        const loginFetchResult = await fetch(url, {
            method: 'post',
            body: `username=${username}&password=${password}`,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        const result = await loginFetchResult.json();
        if (result.authToken) {
            // console.debug('tunnelLoginAttempt done');
            return result;
        } else {
            console.debug('tunnelLoginAttempt failed: ', result.message ?? 'no authToken');
            return {success: false};
        }
    } catch (e) {
        console.debug('tunnelLoginAttempt failed: ', e.message);
        return {success: false};
    }
}

// flatenUserAccessRules function reused from front-end code
const flatenUserAccessRules = data => {
    const extractAccessRuleConnections = ar => {
        let accesses = [];
        accesses = [...accesses, ...ar.access_rule_connections.map(c => c.connection)];
        accesses = accesses.map(c => ({connection: c, accessRule: ar}));
        return accesses;
    }
    const extractAccessRuleConnectionGroups = ar => {
        let accesses = [];
        ar.access_rule_connection_groups.forEach(cg => {
            accesses = [...accesses, ...cg.connection_group.connection_group_connections.map(c => c.connection)];
        });
        accesses = accesses.map(c => ({connection: c, accessRule: ar}));
        return accesses;
    };

    let user2connections = [];
    let user2connectionGroup2connection = [];
    data.access_rules.forEach(ar => {
        user2connections = [...user2connections, ...extractAccessRuleConnections(ar)];
        user2connectionGroup2connection = [...user2connectionGroup2connection, ...extractAccessRuleConnectionGroups(ar)];
    });

    let userGroup2connections = [];
    let userGroup2connectionGroup = [];
    data.user_group_user.forEach(ug => {
        ug.user_group.access_rule_user_groups.forEach(ar => {
            userGroup2connections = [...userGroup2connections, ...extractAccessRuleConnections(ar.access_rule)];
            userGroup2connectionGroup = [...userGroup2connectionGroup, ...extractAccessRuleConnectionGroups(ar.access_rule)];
        });
    });

    // aggregate and deduplicate
    const allConnectionAccesses = [...user2connections, ...user2connectionGroup2connection, ...userGroup2connections, ...userGroup2connectionGroup];
    const dedupConnectionAccesses = allConnectionAccesses.filter( (v,i,a) => a.findIndex(t => (JSON.stringify(t) === JSON.stringify(v))) === i)
    return dedupConnectionAccesses;
};

const userHasAccess = async (config, userId, connectionId, accessRuleId) => {
    const QUERY_ACCESS_RULES = `
    query ($user_id: uuid!) {
      
      access_rules(where: {access_rule_users: {user_id: {_eq: $user_id}}}) {
        
        id
        name
        
        # user to connection
        access_rule_connections {
          connection {
            id
            name
            protocol
            hostname
            meta
          }
        }
        
        # user to connection_group to connection
        access_rule_connection_groups {
          connection_group {
            connection_group_connections {
              connection {
                id
                name
                protocol
                hostname  
                meta          
              }
            }
          }
        }
      }
      
      user_group_user(where: {user_id: {_eq: $user_id}}) {
        user_group {
          access_rule_user_groups {
            access_rule {
              
              id
              name
              
              # user to user_group to connection
              access_rule_connections {
                connection {
                  id
                  name
                  protocol
                  hostname   
                  meta         
                }       
              }
              
              # user to user_group to connection_group to connection
              access_rule_connection_groups {
                connection_group {
                  connection_group_connections {
                    connection {
                      id
                      name
                      protocol
                      hostname       
                      meta     
                    }
                  }
                }            
              }
              
            }
          }
        }
      }
    }
    `;
    const data = await queryRaw(QUERY_ACCESS_RULES, {user_id: userId})
    if (!data) return false;
    const connectionAccesses = flatenUserAccessRules(data);
    for (const access of connectionAccesses) {
        if (access.accessRule.id === accessRuleId && access.connection.id === connectionId) {
            return access.connection.meta?.isDisabled !== true;
        }
    }
    return false;
}

const MUTATION_CREATE_SESSION = `
    mutation ($pamSessionId: uuid!, $user_id: uuid!, $destinatonServerIp: String!, $destinatonServerPort: String!) {
        action_create_session(pamSessionId: $pamSessionId, user_id: $user_id, destinatonServerIp: $destinatonServerIp, destinatonServerPort: $destinatonServerPort) {
        config
        }
    }
`;

export {sessConnect};