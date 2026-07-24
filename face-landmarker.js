
import {
  FaceLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs";

let landmarker = null;
let initPromise = null;
let lastVideoTime = -1;
let lastNose = null;
let blinkHistory = [];

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function rectFromPoints(points, indices, paddingX = 0.012, paddingY = 0.012) {
  const selected = indices.map(i => points[i]).filter(Boolean);
  if (!selected.length) return null;
  const xs = selected.map(p => p.x);
  const ys = selected.map(p => p.y);
  const x1 = clamp(Math.min(...xs) - paddingX, 0, 1);
  const y1 = clamp(Math.min(...ys) - paddingY, 0, 1);
  const x2 = clamp(Math.max(...xs) + paddingX, 0, 1);
  const y2 = clamp(Math.max(...ys) + paddingY, 0, 1);
  return { x:x1, y:y1, w:Math.max(0.01,x2-x1), h:Math.max(0.01,y2-y1) };
}

function eyeAspectRatio(points, top, bottom, left, right) {
  return distance(points[top], points[bottom]) / Math.max(0.001, distance(points[left], points[right]));
}

function analyze(points, timestamp) {
  const leftEyeOuter = points[33];
  const rightEyeOuter = points[263];
  const nose = points[1];
  const chin = points[152];
  const foreheadTop = points[10];
  const eyeMid = {
    x:(leftEyeOuter.x + rightEyeOuter.x)/2,
    y:(leftEyeOuter.y + rightEyeOuter.y)/2
  };
  const eyeDistance = Math.max(0.001, distance(leftEyeOuter, rightEyeOuter));

  const rollDeg = Math.atan2(
    rightEyeOuter.y-leftEyeOuter.y,
    rightEyeOuter.x-leftEyeOuter.x
  ) * 180 / Math.PI;

  const yawIndex = (nose.x-eyeMid.x)/eyeDistance;
  const faceHeight = Math.max(0.001, chin.y-foreheadTop.y);
  const pitchIndex = ((nose.y-foreheadTop.y)/faceHeight)-0.52;

  const leftEar = eyeAspectRatio(points,159,145,33,133);
  const rightEar = eyeAspectRatio(points,386,374,362,263);
  const ear = (leftEar+rightEar)/2;
  const blink = ear < 0.16;
  blinkHistory.push({t:timestamp, blink});
  blinkHistory = blinkHistory.filter(x=>timestamp-x.t<10000);
  let blinkCount = 0;
  for(let i=1;i<blinkHistory.length;i++){
    if(blinkHistory[i].blink && !blinkHistory[i-1].blink) blinkCount++;
  }

  let headMovement = 0;
  if(lastNose){
    headMovement = Math.hypot(nose.x-lastNose.x,nose.y-lastNose.y)*1000;
  }
  lastNose = {x:nose.x,y:nose.y};

  const positionScore = clamp(
    100 - Math.abs(rollDeg)*2.1 - Math.abs(yawIndex)*115 - Math.abs(pitchIndex)*95,
    0, 100
  );

  return {
    regions: {
      forehead: rectFromPoints(points,[10,338,297,332,284,251,389,356,151,9],0.008,0.006),
      leftCheek: rectFromPoints(points,[50,101,205,206,187,123,116,117],0.008,0.008),
      rightCheek: rectFromPoints(points,[280,330,425,426,411,352,345,346],0.008,0.008)
    },
    pose: {
      rollDeg,
      yawIndex,
      pitchIndex,
      positionScore,
      positionLabel: positionScore>=75 ? "良好" : positionScore>=50 ? "注意" : "不良"
    },
    blink: {ear, detected:blink, count10s:blinkCount},
    headMovement,
    points
  };
}

async function init() {
  if(landmarker) return true;
  if(initPromise) return initPromise;
  initPromise = (async()=>{
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
    );
    landmarker = await FaceLandmarker.createFromOptions(vision,{
      baseOptions:{modelAssetPath:MODEL_URL,delegate:"GPU"},
      runningMode:"VIDEO",
      numFaces:1,
      minFaceDetectionConfidence:0.55,
      minFacePresenceConfidence:0.55,
      minTrackingConfidence:0.55,
      outputFaceBlendshapes:false,
      outputFacialTransformationMatrixes:false
    });
    return true;
  })().catch(async()=>{
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
    );
    landmarker = await FaceLandmarker.createFromOptions(vision,{
      baseOptions:{modelAssetPath:MODEL_URL,delegate:"CPU"},
      runningMode:"VIDEO",
      numFaces:1,
      minFaceDetectionConfidence:0.5,
      minFacePresenceConfidence:0.5,
      minTrackingConfidence:0.5
    });
    return true;
  });
  return initPromise;
}

function detect(video, timestamp = performance.now()) {
  if(!landmarker || !video || video.readyState < 2) return null;
  if(video.currentTime === lastVideoTime) return null;
  lastVideoTime = video.currentTime;
  const result = landmarker.detectForVideo(video, timestamp);
  const points = result?.faceLandmarks?.[0];
  return points?.length ? analyze(points,timestamp) : null;
}

function reset() {
  lastNose = null;
  blinkHistory = [];
  lastVideoTime = -1;
}

window.FaceLandmarkTracker = {
  init,
  detect,
  reset,
  get ready(){ return !!landmarker; }
};
