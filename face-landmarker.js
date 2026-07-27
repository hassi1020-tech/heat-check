import {FaceLandmarker,FilesetResolver} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm";
const MODEL="https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
let detector, promise, lastTime=-1;
let session={start:0,samples:[],blinkCount:0,closedSince:0,maxClosed:0,longClosed:0,wasClosed:false};

const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const get=(m,k)=>Number(m[k])||0;

async function init(){
  if(detector)return detector;
  if(promise)return promise;
  promise=(async()=>{
    const vision=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm");
    detector=await FaceLandmarker.createFromOptions(vision,{
      baseOptions:{modelAssetPath:MODEL,delegate:"GPU"},runningMode:"VIDEO",numFaces:1,
      minFaceDetectionConfidence:.55,minFacePresenceConfidence:.55,minTrackingConfidence:.5,
      outputFaceBlendshapes:true,outputFacialTransformationMatrixes:true
    });
    return detector;
  })();
  return promise;
}
function reset(){
  session={start:performance.now(),samples:[],blinkCount:0,closedSince:0,maxClosed:0,longClosed:0,wasClosed:false};
}
function updateEye(l,r,t){
  const closed=l>.58&&r>.58;
  if(closed&&!session.wasClosed)session.closedSince=t;
  if(!closed&&session.wasClosed){
    const d=t-session.closedSince;
    session.maxClosed=Math.max(session.maxClosed,d);
    if(d>=70&&d<=800)session.blinkCount++;
    if(d>800)session.longClosed++;
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
  if(video.currentTime===lastTime&&session.samples.length)return session.samples.at(-1).result;
  lastTime=video.currentTime;
  const raw=d.detectForVideo(video,performance.now());
  const cats=raw?.faceBlendshapes?.[0]?.categories;
  if(!cats?.length)return {available:false};
  const m=Object.fromEntries(cats.map(x=>[x.categoryName,x.score]));
  const t=performance.now(),l=get(m,"eyeBlinkLeft"),r=get(m,"eyeBlinkRight");
  updateEye(l,r,t);
  const expression=clamp(
    avg([get(m,"browDownLeft"),get(m,"browDownRight"),get(m,"browInnerUp")])*38+
    avg([get(m,"eyeSquintLeft"),get(m,"eyeSquintRight")])*28+
    avg([get(m,"mouthFrownLeft"),get(m,"mouthFrownRight")])*22+
    avg([get(m,"mouthPressLeft"),get(m,"mouthPressRight")])*12
  );
  const openness=clamp(100-avg([l,r])*100);
  const elapsed=Math.max(1,(t-session.start)/60000);
  const headMotion=matrixMotion(raw);
  const poseData=raw?.facialTransformationMatrixes?.[0]?.data;
  const pose={x:Number(poseData?.[12])||0,y:Number(poseData?.[13])||0,z:Number(poseData?.[14])||0};
  const result={
    available:true,expressionRisk:Math.round(expression),eyeRisk:Math.round(clamp(
      Math.max(0,65-openness)*1.7+session.maxClosed/20+session.longClosed*25
    )),
    openness:+openness.toFixed(1),blinkCount:session.blinkCount,
    blinkRate:+(session.blinkCount/elapsed).toFixed(1),maxClosureMs:Math.round(session.maxClosed),
    prolongedClosureCount:session.longClosed,eyeAsymmetry:+(Math.abs(l-r)*100).toFixed(1),
    headMotion:+headMotion.toFixed(2)
  };
  session.samples.push({t,pose,result});
  if(session.samples.length>400)session.samples.shift();
  return result;
}
window.FaceAI={init,reset,analyze};
init().catch(console.warn);