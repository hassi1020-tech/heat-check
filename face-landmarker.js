import {FaceLandmarker,FilesetResolver} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm";

const MODEL="https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
let detector, promise, lastTime=-1;
let session;

const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const stdev=a=>{
  if(a.length<2)return 0;
  const m=avg(a);
  return Math.sqrt(avg(a.map(v=>(v-m)**2)));
};
const get=(m,k)=>Number(m[k])||0;

function newSession(){
  return {
    start:performance.now(), samples:[], blinkCount:0, closedSince:0,
    maxClosed:0, longClosed:0, microSleepCount:0, wasClosed:false,
    closureDurations:[], closedMs:0, lastSampleAt:0, validFrames:0
  };
}
session=newSession();

async function init(){
  if(detector)return detector;
  if(promise)return promise;
  promise=(async()=>{
    const vision=await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
    );
    detector=await FaceLandmarker.createFromOptions(vision,{
      baseOptions:{modelAssetPath:MODEL,delegate:"GPU"},
      runningMode:"VIDEO",
      numFaces:1,
      minFaceDetectionConfidence:.55,
      minFacePresenceConfidence:.55,
      minTrackingConfidence:.5,
      outputFaceBlendshapes:true,
      outputFacialTransformationMatrixes:true
    });
    return detector;
  })();
  return promise;
}

function reset(){
  session=newSession();
  lastTime=-1;
}

function updateEye(leftBlink,rightBlink,t){
  const closureScore=avg([leftBlink,rightBlink]);
  const closed=closureScore>.58;

  if(session.lastSampleAt){
    const dt=Math.min(250,t-session.lastSampleAt);
    if(closed)session.closedMs+=Math.max(0,dt);
  }
  session.lastSampleAt=t;

  if(closed&&!session.wasClosed)session.closedSince=t;

  if(!closed&&session.wasClosed){
    const duration=t-session.closedSince;
    session.maxClosed=Math.max(session.maxClosed,duration);
    session.closureDurations.push(duration);
    if(duration>=70&&duration<=800)session.blinkCount++;
    if(duration>800)session.longClosed++;
    if(duration>=500)session.microSleepCount++;
  }

  if(closed)session.maxClosed=Math.max(session.maxClosed,t-session.closedSince);
  session.wasClosed=closed;
}

function matrixMotion(result){
  const data=result?.facialTransformationMatrixes?.[0]?.data;
  if(!data?.length)return 0;
  const x=Number(data[12])||0,y=Number(data[13])||0,z=Number(data[14])||0;
  const prev=session.samples.at(-1)?.pose;
  if(!prev)return 0;
  return Math.sqrt((x-prev.x)**2+(y-prev.y)**2+(z-prev.z)**2)*80;
}

async function analyze(video){
  if(!video||video.readyState<2)return {available:false};
  const d=await init();

  if(video.currentTime===lastTime&&session.samples.length){
    return session.samples.at(-1).result;
  }
  lastTime=video.currentTime;

  const raw=d.detectForVideo(video,performance.now());
  const cats=raw?.faceBlendshapes?.[0]?.categories;
  if(!cats?.length)return {available:false};

  const m=Object.fromEntries(cats.map(x=>[x.categoryName,x.score]));
  const t=performance.now();
  const leftBlink=get(m,"eyeBlinkLeft");
  const rightBlink=get(m,"eyeBlinkRight");
  updateEye(leftBlink,rightBlink,t);

  const browStrain=avg([
    get(m,"browDownLeft"),get(m,"browDownRight"),get(m,"browInnerUp")
  ]);
  const eyeSquint=avg([get(m,"eyeSquintLeft"),get(m,"eyeSquintRight")]);
  const mouthTension=avg([
    get(m,"mouthFrownLeft"),get(m,"mouthFrownRight"),
    get(m,"mouthPressLeft"),get(m,"mouthPressRight")
  ]);

  // 「病気」や感情を断定せず、顔筋の緊張・変化量として扱う。
  const expression=clamp(browStrain*42+eyeSquint*34+mouthTension*24);
  const openness=clamp(100-avg([leftBlink,rightBlink])*100);
  const elapsedMinutes=Math.max(1/60,(t-session.start)/60000);
  const elapsedMs=Math.max(1,t-session.start);
  const headMotion=matrixMotion(raw);

  const poseData=raw?.facialTransformationMatrixes?.[0]?.data;
  const pose={
    x:Number(poseData?.[12])||0,
    y:Number(poseData?.[13])||0,
    z:Number(poseData?.[14])||0
  };

  session.validFrames++;
  const recentExpressions=session.samples.slice(-40).map(s=>s.result.expressionRisk);
  const expressionVariability=stdev([...recentExpressions,expression]);
  const perclos=clamp(session.closedMs/elapsedMs*100,0,100);
  const avgClosureMs=avg(session.closureDurations);
  const blinkRate=session.blinkCount/elapsedMinutes;
  const blinkDurabilityRisk=clamp(
    Math.max(0,avgClosureMs-180)*.18+
    Math.max(0,session.maxClosed-450)*.10+
    session.microSleepCount*22
  );

  const eyeRisk=clamp(
    Math.max(0,68-openness)*1.45+
    perclos*2.2+
    blinkDurabilityRisk*.55+
    session.longClosed*18
  );

  const result={
    available:true,
    expressionRisk:Math.round(expression),
    expressionVariability:+expressionVariability.toFixed(1),
    browStrain:+(browStrain*100).toFixed(1),
    eyeSquint:+(eyeSquint*100).toFixed(1),
    mouthTension:+(mouthTension*100).toFixed(1),
    eyeRisk:Math.round(eyeRisk),
    openness:+openness.toFixed(1),
    blinkCount:session.blinkCount,
    blinkRate:+blinkRate.toFixed(1),
    avgClosureMs:Math.round(avgClosureMs),
    maxClosureMs:Math.round(session.maxClosed),
    prolongedClosureCount:session.longClosed,
    microSleepCount:session.microSleepCount,
    perclos:+perclos.toFixed(1),
    eyeAsymmetry:+(Math.abs(leftBlink-rightBlink)*100).toFixed(1),
    headMotion:+headMotion.toFixed(2),
    validFrameCount:session.validFrames
  };

  session.samples.push({t,pose,result});
  if(session.samples.length>500)session.samples.shift();
  return result;
}

window.FaceAI={init,reset,analyze};
init().catch(console.warn);
