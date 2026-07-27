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
      features:{}
    };
  }

  const m=categoryMap(shapes);
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
      features:{}
    };
  }
}

window.FaceExpressionAI={
  initialize,
  analyze,
  get ready(){return !!landmarker;}
};

initialize().catch(()=>{});
