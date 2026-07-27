import {
  FaceLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let landmarker = null;
let initPromise = null;
let lastVideoTime = -1;
let lastResult = null;

const eyeTracker={
  lastTimestamp:0,
  leftClosed:false,
  rightClosed:false,
  bothClosedSince:0,
  blinkCount:0,
  prolongedClosureCount:0,
  maxClosureMs:0,
  samples:[],
  sessionStartedAt:0
};

function resetEyeSession(){
  eyeTracker.lastTimestamp=0;
  eyeTracker.leftClosed=false;
  eyeTracker.rightClosed=false;
  eyeTracker.bothClosedSince=0;
  eyeTracker.blinkCount=0;
  eyeTracker.prolongedClosureCount=0;
  eyeTracker.maxClosureMs=0;
  eyeTracker.samples=[];
  eyeTracker.sessionStartedAt=performance.now();
}

function updateEyeTracker(leftBlink,rightBlink,timestamp){
  const leftClosed=leftBlink>=0.58;
  const rightClosed=rightBlink>=0.58;
  const bothClosed=leftClosed&&rightClosed;

  if(!eyeTracker.sessionStartedAt) resetEyeSession();

  if(bothClosed && !(eyeTracker.leftClosed&&eyeTracker.rightClosed)){
    eyeTracker.bothClosedSince=timestamp;
  }

  if(!bothClosed && eyeTracker.leftClosed&&eyeTracker.rightClosed){
    const duration=Math.max(0,timestamp-eyeTracker.bothClosedSince);
    eyeTracker.maxClosureMs=Math.max(eyeTracker.maxClosureMs,duration);
    if(duration>=70 && duration<=800) eyeTracker.blinkCount++;
    if(duration>800) eyeTracker.prolongedClosureCount++;
    eyeTracker.bothClosedSince=0;
  }

  if(bothClosed && eyeTracker.bothClosedSince){
    const currentDuration=timestamp-eyeTracker.bothClosedSince;
    eyeTracker.maxClosureMs=Math.max(eyeTracker.maxClosureMs,currentDuration);
  }

  eyeTracker.leftClosed=leftClosed;
  eyeTracker.rightClosed=rightClosed;
  eyeTracker.lastTimestamp=timestamp;
  eyeTracker.samples.push({
    timestamp,
    leftBlink,
    rightBlink,
    leftClosed,
    rightClosed
  });
  if(eyeTracker.samples.length>300) eyeTracker.samples.shift();
}

function eyeSummary(){
  const samples=eyeTracker.samples;
  if(!samples.length){
    return {
      available:false,eyeRisk:0,label:"未解析",blinkCount:0,
      blinkRate:0,maxClosureMs:0,prolongedClosureCount:0,
      openness:0,asymmetry:0
    };
  }
  const durationMin=Math.max(
    1/60,
    ((samples.at(-1)?.timestamp||0)-(eyeTracker.sessionStartedAt||samples[0].timestamp))/60000
  );
  const avgLeft=samples.reduce((s,x)=>s+x.leftBlink,0)/samples.length;
  const avgRight=samples.reduce((s,x)=>s+x.rightBlink,0)/samples.length;
  const openness=Math.max(0,100-(avgLeft+avgRight)/2*100);
  const asymmetry=Math.abs(avgLeft-avgRight)*100;
  const blinkRate=eyeTracker.blinkCount/durationMin;
  const closedRatio=samples.filter(x=>x.leftClosed&&x.rightClosed).length/samples.length*100;

  const lowOpennessRisk=Math.max(0,(65-openness)*2.2);
  const closureRisk=Math.min(100,eyeTracker.maxClosureMs/18);
  const prolongedRisk=Math.min(100,eyeTracker.prolongedClosureCount*35);
  const asymmetryRisk=Math.min(100,asymmetry*4);
  const closedRatioRisk=Math.min(100,closedRatio*5);

  const eyeRisk=Math.round(clamp(
    lowOpennessRisk*0.30+
    closureRisk*0.25+
    prolongedRisk*0.20+
    asymmetryRisk*0.10+
    closedRatioRisk*0.15
  ));

  const label=
    eyeRisk>=70 ? "閉眼・開眼状態に大きな変化" :
    eyeRisk>=45 ? "目の状態に軽度変化" :
    "通常範囲";

  return {
    available:true,
    eyeRisk,
    label,
    blinkCount:eyeTracker.blinkCount,
    blinkRate:+blinkRate.toFixed(1),
    maxClosureMs:Math.round(eyeTracker.maxClosureMs),
    prolongedClosureCount:eyeTracker.prolongedClosureCount,
    openness:+openness.toFixed(1),
    asymmetry:+asymmetry.toFixed(1),
    closedRatio:+closedRatio.toFixed(1)
  };
}

function categoryMap(categories=[]){
  const map={};
  for(const item of categories){
    map[item.categoryName]=Number(item.score)||0;
  }
  return map;
}
function mean(...values){
  const nums=values.filter(Number.isFinite);
  return nums.length ? nums.reduce((a,b)=>a+b,0)/nums.length : 0;
}
function clamp(v,min=0,max=100){
  return Math.max(min,Math.min(max,v));
}
function get(map,name){
  return Number(map[name])||0;
}

async function initialize(){
  if(landmarker) return landmarker;
  if(initPromise) return initPromise;

  initPromise=(async()=>{
    const vision=await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
    );
    landmarker=await FaceLandmarker.createFromOptions(vision,{
      baseOptions:{
        modelAssetPath:MODEL_URL,
        delegate:"GPU"
      },
      runningMode:"VIDEO",
      numFaces:1,
      minFaceDetectionConfidence:0.55,
      minFacePresenceConfidence:0.55,
      minTrackingConfidence:0.50,
      outputFaceBlendshapes:true,
      outputFacialTransformationMatrixes:false
    });
    return landmarker;
  })().catch(error=>{
    console.error("Face Landmarker初期化エラー",error);
    initPromise=null;
    throw error;
  });

  return initPromise;
}

function summarize(result){
  const shapes=result?.faceBlendshapes?.[0]?.categories;
  if(!shapes?.length){
    return {
      available:false,
      faceDetected:false,
      expressionRisk:0,
      confidence:0,
      label:"顔を検出できません",
      eye:eyeSummary(),
      features:{}
    };
  }

  const m=categoryMap(shapes);
  const eyeBlinkLeft=get(m,"eyeBlinkLeft");
  const eyeBlinkRight=get(m,"eyeBlinkRight");
  updateEyeTracker(eyeBlinkLeft,eyeBlinkRight,performance.now());
  const eyes=eyeSummary();

  const browTension=mean(
    get(m,"browDownLeft"),get(m,"browDownRight"),
    get(m,"browInnerUp")
  );
  const eyeTension=mean(
    get(m,"eyeSquintLeft"),get(m,"eyeSquintRight")
  );
  const mouthDown=mean(
    get(m,"mouthFrownLeft"),get(m,"mouthFrownRight")
  );
  const jawTension=mean(
    get(m,"jawOpen"),get(m,"mouthPressLeft"),get(m,"mouthPressRight")
  );
  const neutral=clamp(get(m,"_neutral")*100);
  const smile=mean(get(m,"mouthSmileLeft"),get(m,"mouthSmileRight"));

  // 病名や感情を断定せず、通常時から外れ得る表情変化の強さを算出
  const tensionScore=clamp(
    browTension*32 +
    eyeTension*25 +
    mouthDown*23 +
    jawTension*12 +
    Math.max(0,0.35-smile)*8
  );
  const expressionRisk=Math.round(tensionScore);
  const label=
    expressionRisk>=70 ? "大きな表情変化" :
    expressionRisk>=45 ? "軽度の表情変化" :
    "通常範囲";

  const detectConfidence=mean(
    result.faceBlendshapes?.[0]?.categories?.slice(0,8).map(x=>x.score||0).reduce((a,b)=>a+b,0)/8 || 0.6,
    0.75
  );

  return {
    available:true,
    faceDetected:true,
    expressionRisk,
    confidence:Math.round(clamp(detectConfidence*100,35,98)),
    label,
    eye:eyes,
    features:{
      browTension:+(browTension*100).toFixed(1),
      eyeTension:+(eyeTension*100).toFixed(1),
      mouthCornerDown:+(mouthDown*100).toFixed(1),
      jawActivity:+(jawTension*100).toFixed(1),
      neutral:+neutral.toFixed(1)
    }
  };
}

async function analyze(video){
  try{
    if(!video || video.readyState<2){
      return {available:false,faceDetected:false,expressionRisk:0,confidence:0,label:"映像準備中",features:{}};
    }
    const detector=await initialize();
    if(video.currentTime===lastVideoTime && lastResult) return lastResult;
    lastVideoTime=video.currentTime;
    const result=detector.detectForVideo(video,performance.now());
    lastResult=summarize(result);
    return lastResult;
  }catch(error){
    return {
      available:false,
      faceDetected:false,
      expressionRisk:0,
      confidence:0,
      label:"AIモデル利用不可",
      error:String(error?.message||error),
      eye:eyeSummary(),
      features:{}
    };
  }
}

window.FaceExpressionAI={
  initialize,
  analyze,
  resetEyeSession,
  getEyeSummary:eyeSummary,
  get ready(){return !!landmarker;}
};

initialize().catch(()=>{});
