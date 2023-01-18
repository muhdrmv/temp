var express = require('express');
var router = express.Router();
const fs = require('fs');
var rdp_prepare = require('../controllers/rdp-prepare');
const { v1 : uuidv1, v1 } = require('uuid');
const { exec } = require('child_process');

var {queryWhere, updatePk, queryRaw, deleteWhere, insertOne} = require('../db/graphql');

let config = {
  hasuraAdminSecret: process.env.HASURA_ADMIN_SECRET,
  hasuraUrl:         process.env.HASURA_URL,
};

let randomIntBetween = (min,max) => {
  return Math.floor(Math.random()*(max - min + 1)) + min
} 

let check_repetitive_port = async (port) => {
  let query_repetetive_port = await queryWhere( null, 'sessions',
      {_and: [{status: {_neq: 'closed'}}, {port: {_eq: port}}]},
      ['port']
  );

  if(query_repetetive_port?.length == 0) return false;
  else true;
}

const updateSessionStatus = async (session, status) => {

  try {
    const dateNow = new Date().toISOString();
    await updatePk(config, 'sessions', session.id, {status, closed_at: dateNow});
    return true;
  } catch (error) {
    return false
  }
}

const rendervideo = async (sessionId) => {
  exec(`docker run -v /root/rjpn/${process.env.TRANSPARENT_VERSION_FOLDER}/pyrdp_output:/home/pyrdp/pyrdp_output ${process.env.TRANSPARENT_MASTER_CONVERT} pyrdp-convert.py pyrdp_output/replays/${sessionId}.pyrdp -f 'mp4' -o /store`,async (err, stdout, stderr) => {
    if (err) return;
    console.log(err);

    let updateResult = await updatePk(config, 'renderingVideo', sessionId, {status: "done", link: `/store/${sessionId}.mp4`});
    if(updateResult?.errors){
      console.log("Error in updating renderingVideo db");
      return;
    }
  });
}

router.get('/l/:pamSessionId', function(req, res, next) {

  let pamSessionId = req.params?.pamSessionId;
  const session = await queryWhere(config, 'sessions',
          {pamSessionId : {_eq: pamSessionId}},
          ['status']);

  if(session.length < 1 ) res.json({result:'na'});
  
  if(session?.[0]?.status == 'closed') res.json({result: 'c'})

  if(session?.[0]?.status == 'initializing') res.json({result: 'i'})
  
  if(session?.[0]?.status == 'live') res.json({result: 'l'})
  
});

router.get('/creating-session', async function(req, res, next) {

  // let {
  //   pam_session_uuid, user_id, ip, meta
  // } = req.body;
  // if(!pam_session_uuid || !user_id || !ip || !meta) return;


  let id = v1(uuidv1)
      // pamSessionId  = v1(uuidv1),
      pamSessionId  = "90b79930-9186-11ed-9c3a-5f1404e4f8b1",
      user_id = "7b78eab6-46f6-45e6-b9b6-3bdfd2260f5b",
      ip = "192.168.1.120",
      username = "mv",
      password = null

  let port_available = false;
  let port = null;

  while (!port_available) {
    port = randomIntBetween(10000,65535)
    let res_repetetive_port = await check_repetitive_port(port);
    if(!res_repetetive_port) port_available = true
  }

  const sessionInput = {
    id,
    pam_session_id: pamSessionId ,
    user_id,
    ip,
    port,
    status: "initializing",
    meta: {}
  };

  let insert_session_result = await insertOne(config, 'sessions', sessionInput);
  if(!insert_session_result) return;

  if(!username || !password){
    
    exec(`docker run -d --name ${pamSessionId} -v /root/rjpn/${process.env.TRANSPARENT_VERSION_FOLDER}/pyrdp_output:/home/pyrdp/pyrdp_output  -v /store:/store -p ${port}:3389 ${process.env.TRANSPARENT_LITE} pyrdp-mitm.py -si ${pamSessionId} ${ip}`, (err, stdout, stderr) => {
      if (err||stderr) {
        console.log(err, stderr);
        return;
      }
    });
  }else{

    exec(`docker run -d --name ${pamSessionId} -v /root/rjpn/${process.env.TRANSPARENT_VERSION_FOLDER}/pyrdp_output:/home/pyrdp/pyrdp_output  -v /store:/store -p ${port}:3389 ${process.env.TRANSPARENT_LITE} pyrdp-mitm.py -si ${pamSessionId} -u ${username} -p ${password} ${ip}`, (err, stdout, stderr) => {
      if (err||stderr) {
        console.log(err, stderr);
        return;
      }
    });
  }
  
  let str = await rdp_prepare(process.env.IP_ADDRESS, port)

  let filname = `${ip}_${port}_${pamSessionId}.rdp`;

  fs.writeFile(`${process.env.RDP_CONNECTION_PATH}/${filname}`, str, (err) => {

    if (err) {
      console.log(err);
      return;
    }
    res.download(`${process.env.RDP_CONNECTION_PATH}/${filname}`)
  });

});

router.post('/terminate-session', async function(req, res, next) {

  let {
    sessionId
  } = req.body; 

  const session = await queryWhere(config, 'sessions',
          {pamSessionId : {_eq: sessionId}},
          ['id', 'status']);
  ;

  if(session.length < 0 ){
    res.json({result: false, message: 'This Session not in transparent server'})
   return;
  }

  exec(`docker rm -f ${sessionId}`, async (err, stdout, stderr) => {
    console.log(stderr,err);
  
    let updateResult = await updatePk(config, 'sessions', session[0]?.id, {status: "closed", closed_at: new Date().toISOString()});
    if(updateResult?.errors){
      res.json({result: false, message: 'Error in updating session in Transparent server'})
      return;
    }
    res.json({result: true})
  });

});

router.post('/request-video-rendering', async function(req, res, next){

  let {
    sessionId
  } = req.body; 

  const session = await queryWhere(config, 'sessions',
          {pamSessionId : {_eq: sessionId}},
          ['id', 'status', 'meta']);
  ;

  if(session.length < 1){
    res.json({result: false, message: 'There is no Session'});
    return;
  }

  if(session?.[0]?.status == "live"){
    res.json({result: false, message: 'The session is still live.'});
    return;
  }

  if(session?.[0]?.meta?.videoLink){
    res.json({result: true, link: session?.[0]?.meta?.videoLink});
    return;
  }

  const renderingVideo = await queryWhere(config, 'renderingVideo',
          {pamSessionId : {_eq: sessionId}},
          ['id', 'status', 'status', 'link']);
  ;

  if(renderingVideo.length < 1){
    rendervideo(sessionId);
    const rendervideoInput = {
      pam_session_id: sessionId ,
      status: "inProgress",
    };
    let insert_session_result = await insertOne(config, 'renderingVideo', rendervideoInput);
    if(!insert_session_result){
      res.json({result: true, message: 'Error in inserting db'});
      return;
    }
  }

  if(renderingVideo[0]?.status == 'inProgress'){
    res.json({result: false, message: 'Video in progress'});
    return;
  }
  

  res.json({result: true, message: 'Rendering started ... '});

});

router.get('/export-keystrokes', async function(req, res, next) {

  // let {
  //   pam_session_uuid
  // } = req.body; 
  // if(!pamSessionId) return;

  let pamSessionId = "90b79930-9186-11ed-9c3a-5f1404e4f8b1";
  exec(`docker run -v /root/rjpn/${process.env.TRANSPARENT_VERSION_FOLDER}/pyrdp_output:/home/pyrdp/pyrdp_output ${process.env.TRANSPARENT_LITE}  -v /store:/store  pyrdp-player.py --headless pyrdp_output/replays/${pamSessionId}.pyrdp`, (err, stdout, stderr) => {

    if (err) {
      console.log(err);
      return;
    }

    let array = stdout.split("<Windows released>"); 
    let newOutput = array[1]?.replaceAll("pyrdp", "RAJA")

    fs.writeFile(`${process.env.KEYSTROKES_PATH}/${pamSessionId}.txt`, newOutput, (err) => {
      if (err) throw err;
      res.download(`${process.env.KEYSTROKES_PATH}/${pamSessionId}.txt`)
    });

  });
});

router.get('/export-video', async function(req, res, next) {

  // let {
  //   pam_session_uuid
  // } = req.body; 
  // if(!pamSessionId) return;

  exec(`docker run -v /root/rjpn/${process.env.TRANSPARENT_VERSION_FOLDER}/pyrdp_output:/home/pyrdp/pyrdp_output ${process.env.TRANSPARENT_MASTER_CONVERT} pyrdp-convert.py pyrdp_output/replays/${pamSessionId}.pyrdp -f 'mp4' -o /store/`, (err, stdout, stderr) => {

    if (err) return;
    console.log(stdout);
  });
  console.log("MUHAMMAD REZAMARVI");

});

module.exports = router;
